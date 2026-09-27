"""Game sound effects on Modal with MOSS-SoundEffect (OpenMOSS, Apache-2.0, 48 kHz text-to-audio):

    modal run assetgen/modal_sfx.py --probe                    # load, print the API, render three test sounds
    modal run assetgen/modal_sfx.py --only w_gantetsu_fire,impact_metal --takes 6
    modal run assetgen/modal_sfx.py                            # every sound in assetgen/audio/sfx_list.json

Each sound is rendered as several takes; every take is scored with LAION-CLAP (text-audio similarity, Apache-2.0)
against its prompt and written with its score: work/audio/sfx/<id>/<take>_<score>.wav. assetgen/audio_finish.py
then picks, trims, loudness-normalises and encodes the winners into public/sfx (desktop edition only).
"""
import io, json, os
import modal

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
OUT = os.path.join(ROOT, "work", "audio", "sfx")
LIST = os.path.join(HERE, "audio", "sfx_list.json")
MODEL = "OpenMOSS-Team/MOSS-SoundEffect"
CLAP = "laion/clap-htsat-unfused"

vol = modal.Volume.from_name("zu-hf", create_if_missing=True)
image = (modal.Image.from_registry("nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04", add_python="3.11")
         .apt_install("git", "ffmpeg", "libsndfile1")
         .pip_install("torch==2.9.1", "torchaudio==2.9.1", extra_index_url="https://download.pytorch.org/whl/cu128")
         .pip_install("transformers>=5.0.0", "accelerate", "soundfile", "numpy", "librosa", "einops", "safetensors", "sentencepiece")
         .env({"HF_HOME": "/hf", "HF_HUB_ENABLE_HF_TRANSFER": "0"}))
app = modal.App("zu-sfx", image=image)


@app.cls(gpu="A100-80GB", timeout=3600, volumes={"/hf": vol}, scaledown_window=120, max_containers=3)
class Sfx:
    @modal.enter()
    def load(self):
        import torch
        from transformers import AutoModel, AutoProcessor, ClapModel, ClapProcessor
        self.proc = AutoProcessor.from_pretrained(MODEL, trust_remote_code=True)
        self.proc.audio_tokenizer = self.proc.audio_tokenizer.to("cuda")
        self.model = AutoModel.from_pretrained(MODEL, trust_remote_code=True, torch_dtype=torch.bfloat16).to("cuda").eval()
        self.sr = self.proc.model_config.sampling_rate
        self.clap = ClapModel.from_pretrained(CLAP).to("cuda").eval()
        self.clap_proc = ClapProcessor.from_pretrained(CLAP)

    @modal.method()
    def api(self) -> str:
        import inspect
        out = [f"sampling_rate={self.sr}"]
        for name, fn in [("generate", self.model.generate), ("build_user_message", self.proc.build_user_message), ("processor.__call__", self.proc.__call__)]:
            try: out.append(f"{name}{inspect.signature(fn)}")
            except Exception as e: out.append(f"{name}: {e}")
            out.append((inspect.getdoc(fn) or "")[:1500])
        return "\n".join(out)

    def _score(self, texts, wavs):
        """CLAP similarity of each take to its prompt (48 kHz audio resampled to CLAP's 48 kHz input)."""
        import torch, numpy as np
        a = self.clap_proc(text=texts, audio=[w.astype(np.float32) for w in wavs], sampling_rate=48000, return_tensors="pt", padding=True)
        a = {k: v.to("cuda") for k, v in a.items()}
        with torch.no_grad():
            o = self.clap(**a)
        ta = torch.nn.functional.normalize(o.text_embeds, dim=-1); aa = torch.nn.functional.normalize(o.audio_embeds, dim=-1)
        return (ta * aa).sum(-1).float().cpu().numpy().tolist()

    @modal.method()
    def render(self, job: dict, takes: int = 4, gen: dict | None = None) -> list[tuple[bytes, float]]:
        import torch, numpy as np, soundfile as sf, librosa
        secs = float(job.get("secs", 1.5))
        msg = {("ambient_sound" if job.get("kind") == "ambient" else "sound_event"): job["prompt"]}
        if secs: msg["tokens"] = max(4, int(round(secs * 12.5)))
        convs = [[self.proc.build_user_message(**msg)] for _ in range(takes)]
        kw = dict(max_new_tokens=int(secs * 12.5 * 1.6) + 64 if secs else 4096)
        kw.update(gen or {"audio_temperature": 1.5, "audio_top_p": 0.6, "audio_top_k": 50, "audio_repetition_penalty": 1.2})
        with torch.no_grad():
            batch = self.proc(convs, mode="generation")
            try:
                outs = self.model.generate(input_ids=batch["input_ids"].to("cuda"), attention_mask=batch["attention_mask"].to("cuda"), **kw)
            except (TypeError, ValueError) as e:   # sampling knobs named differently in this revision: fall back to the defaults
                print("generate kwargs rejected:", e)
                kw = {"max_new_tokens": kw["max_new_tokens"]}
                outs = self.model.generate(input_ids=batch["input_ids"].to("cuda"), attention_mask=batch["attention_mask"].to("cuda"), **kw)
        msgs = self.proc.decode(outs)
        wavs = []
        for m in msgs:
            a = m.audio_codes_list[0].float().cpu().numpy().reshape(-1)
            if self.sr != 48000: a = librosa.resample(a, orig_sr=self.sr, target_sr=48000)
            wavs.append(a)
        scores = self._score([job.get("clap", job["prompt"])] * len(wavs), wavs)
        res = []
        for a, s in zip(wavs, scores):
            b = io.BytesIO(); sf.write(b, a, 48000, format="WAV", subtype="PCM_16"); res.append((b.getvalue(), float(s)))
        return res


PROBE = [
    {"id": "probe_gun", "prompt": "a heavy sci-fi rotary chaingun firing a short burst, punchy mechanical gunshots, close", "secs": 1.5},
    {"id": "probe_steps", "prompt": "heavy boots walking on stone pavement, four footsteps, dry and close", "secs": 2.0},
    {"id": "probe_hit", "prompt": "a single bullet impact on sheet metal, sharp ricochet ping", "secs": 0.8},
]


@app.local_entrypoint()
def main(probe: bool = False, only: str = "", takes: int = 4, skip_done: bool = True):
    s = Sfx()
    if probe:
        print(s.api.remote())
        jobs = PROBE
    else:
        jobs = json.load(open(LIST, encoding="utf-8"))
        if only: jobs = [j for j in jobs if j["id"] in set(only.split(","))]
        if skip_done: jobs = [j for j in jobs if not os.path.isdir(os.path.join(OUT, j["id"])) or not os.listdir(os.path.join(OUT, j["id"]))]
    print(f"{len(jobs)} sounds x {takes} takes")
    for job, res in zip(jobs, s.render.starmap([(j, j.get("take", takes)) for j in jobs], return_exceptions=True)):
        d = os.path.join(OUT, job["id"]); os.makedirs(d, exist_ok=True)
        if isinstance(res, Exception): print("FAIL", job["id"], res); continue
        for i, (wav, score) in enumerate(res):
            open(os.path.join(d, f"{i}_{score:.3f}.wav"), "wb").write(wav)
        print(job["id"], " ".join(f"{sc:.2f}" for _, sc in res))
