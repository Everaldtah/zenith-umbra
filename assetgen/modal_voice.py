"""Hero voice lines on Modal (desktop edition):

    modal run assetgen/modal_voice.py --probe                    # one voice, three lines: check the chain end to end
    modal run assetgen/modal_voice.py --only hibiki,gantetsu --takes 3
    modal run assetgen/modal_voice.py                            # every voice in assetgen/audio/voice_lines.py

Chain per voice:
  1. Kokoro-82M (Apache-2.0) reads the character's reference line in their cast voice; the reference is pitch-shifted
     (giants lower, etc.) - this sets the timbre.
  2. Chatterbox (Resemble AI, MIT) clones that timbre for every line, with the line's delivery driving emotion
     exaggeration / CFG (calm .4 ... scream 1.3) - so ults are shouted, deaths screamed, efforts grunted.
  3. Whisper large-v3-turbo transcribes each spoken take; takes are scored by text similarity (efforts by length and
     energy), so garbled takes lose. Out: work/audio/voice/<voice>/<key>_<i>_<take>_<score>.wav (+ ref.wav)
assetgen/audio_finish.py picks the best take per line, trims, normalises and encodes into public/sfx/vo.
"""
import io, os, sys, json
import modal

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
OUT = os.path.join(ROOT, "work", "audio", "voice")
sys.path.insert(0, os.path.join(HERE, "audio"))

vol = modal.Volume.from_name("zu-hf", create_if_missing=True)
image = (modal.Image.debian_slim(python_version="3.11")
         .apt_install("espeak-ng", "ffmpeg", "libsndfile1", "git")
         .pip_install("chatterbox-tts", "kokoro>=0.9.4", "soundfile", "librosa", "numpy", "misaki[en]")
         .env({"HF_HOME": "/hf"}))
app = modal.App("zu-voice", image=image)


@app.cls(gpu="A10G", timeout=3600, volumes={"/hf": vol}, scaledown_window=60, max_containers=7)
class Voice:
    @modal.enter()
    def load(self):
        import torch
        from kokoro import KPipeline
        from chatterbox.tts import ChatterboxTTS
        from transformers import pipeline
        self.kp = {"a": KPipeline(lang_code="a"), "b": KPipeline(lang_code="b")}
        self.tts = ChatterboxTTS.from_pretrained(device="cuda")
        self.asr = pipeline("automatic-speech-recognition", model="openai/whisper-large-v3-turbo", torch_dtype=torch.float16, device="cuda")

    def _ref(self, voice, lang, pitch, text):
        import numpy as np, soundfile as sf, librosa
        chunks = [a.numpy() if hasattr(a, "numpy") else np.asarray(a) for _, _, a in self.kp[lang](text, voice=voice, speed=1.0)]
        a = np.concatenate(chunks).astype(np.float32)
        if pitch: a = librosa.effects.pitch_shift(a, sr=24000, n_steps=pitch)
        path = f"/tmp/ref_{voice}.wav"; sf.write(path, a, 24000)
        return path, a

    @staticmethod
    def _trim(a, sr):
        import numpy as np
        env = np.abs(a); thr = max(1e-4, env.max() * 0.02)
        idx = np.where(env > thr)[0]
        if not len(idx): return a
        s, e = max(0, idx[0] - int(0.01 * sr)), min(len(a), idx[-1] + int(0.12 * sr))
        return a[s:e]

    @modal.method()
    def bank(self, vid: str, cast: tuple, lines: list, delivery: dict, takes: int = 3) -> dict:
        import torch, numpy as np, soundfile as sf, difflib, re
        kvoice, lang, pitch, reftext = cast
        ref, refa = self._ref(kvoice, lang, pitch, reftext)
        sr = self.tts.sr
        out = {"ref": self._wav(refa, 24000), "takes": []}
        norm = lambda s: re.sub(r"[^a-z ]", "", s.lower()).strip()
        for key, idx, text, dl in lines:
            ex, cfg = delivery[dl]
            for t in range(takes):
                torch.manual_seed(1000 * idx + 77 * t + len(key))
                try:
                    w = self.tts.generate(text, audio_prompt_path=ref, exaggeration=ex, cfg_weight=cfg)
                except Exception as e:
                    print("gen fail", vid, key, idx, e); continue
                a = self._trim(w.squeeze(0).cpu().numpy().astype(np.float32), sr)
                dur = len(a) / sr
                if dl == "effort" or len(norm(text).split()) <= 1 and text.count("!") and dl in ("effort", "scream"):
                    # efforts: short, loud, not a long ramble
                    rms = float(np.sqrt(np.mean(a ** 2)) + 1e-9)
                    score = max(0.0, 1.0 - abs(dur - 0.45) / 1.2) * 0.7 + min(1.0, rms * 8) * 0.3
                else:
                    hyp = self.asr({"raw": a, "sampling_rate": sr}, generate_kwargs={"language": "english"})["text"]
                    score = difflib.SequenceMatcher(None, norm(text), norm(hyp)).ratio()
                    # a clean take reads at a natural rate: penalise long tails / stalls
                    words = max(1, len(norm(text).split()))
                    if dur > 1.2 + words * 0.55: score *= 0.7
                out["takes"].append((key, idx, t, self._wav(a, sr), round(float(score), 3), round(dur, 2)))
        return out

    @staticmethod
    def _wav(a, sr):
        import soundfile as sf
        b = io.BytesIO(); sf.write(b, a, sr, format="WAV", subtype="PCM_16"); return b.getvalue()


@app.local_entrypoint()
def main(probe: bool = False, only: str = "", takes: int = 3):
    from voice_lines import CAST, LINES, DELIVERY
    vids = [v for v in LINES if not only or v in only.split(",")]
    if probe: vids = ["hibiki"]
    jobs = []
    for v in vids:
        lines = [(k, i, text, d) for k, ls in LINES[v].items() for i, (text, d) in enumerate(ls)]
        if probe: lines = [l for l in lines if (l[0], l[1]) in {("select", 0), ("ult", 0), ("kill", 1), ("heal_track", 0), ("death", 0), ("low_hp", 0)}]
        jobs.append((v, CAST[v], lines, DELIVERY, takes))
    print(f"{len(jobs)} voices, {sum(len(j[2]) for j in jobs)} lines x {takes} takes")
    V = Voice()
    for (v, *_), res in zip(jobs, V.bank.starmap(jobs, return_exceptions=True)):
        if isinstance(res, Exception): print("FAIL", v, res); continue
        d = os.path.join(OUT, v); os.makedirs(d, exist_ok=True)
        open(os.path.join(d, "ref.wav"), "wb").write(res["ref"])
        for key, idx, t, wav, score, dur in res["takes"]:
            open(os.path.join(d, f"{key}_{idx}_{t}_{score:.3f}.wav"), "wb").write(wav)
        sc = [s for *_, s, _ in res["takes"]]
        print(v, len(res["takes"]), "takes, mean score", round(sum(sc) / max(1, len(sc)), 3))
