#!/usr/bin/env python3
"""Write the Kaggle voice stage (assetgen/kagglevoice/kagglevoice.py) for some voices, with their lines inlined - the same
chain as modal_voice.py (Kokoro reference -> Chatterbox delivery -> Whisper scoring), on Kaggle's free T4 instead of Modal:

    python assetgen/kagglevoice_make.py tomoe
    python assetgen/kaggle_run.py kagglevoice          # outputs -> assetgen/out/kagglevoice/voice/<voice>/*.wav
    (copy into work/audio/voice/<voice>/ and run audio_finish.py --only voice)
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "audio"))
from voice_lines import CAST, LINES, DELIVERY

vids = sys.argv[1].split(",") if len(sys.argv) > 1 else ["tomoe"]
# optional: only these lines (key:index, comma separated), e.g. `kagglevoice_make.py tomoe select:1`
only = set(sys.argv[2].split(",")) if len(sys.argv) > 2 else None
jobs = [{"vid": v, "cast": CAST[v], "lines": [(k, i, text, d) for k, ls in LINES[v].items() for i, (text, d) in enumerate(ls) if not only or f"{k}:{i}" in only]} for v in vids]

WORKER = r'''
import io, os, sys, json, re, difflib, traceback, urllib.request
import numpy as np, soundfile as sf, torch, librosa
TOPIC = os.environ["NTFY_TOPIC"]
def publish(phase, **extra):
    try:
        body = json.dumps({"topic": TOPIC, "message": json.dumps({"phase": phase, **extra})[:3800]}).encode()
        urllib.request.urlopen(urllib.request.Request("https://ntfy.sh", data=body, headers={"Content-Type": "application/json"}), timeout=15).read()
    except Exception: pass
from kokoro import KPipeline
from chatterbox.tts import ChatterboxTTS
from transformers import pipeline
JOBS = json.loads(open("/tmp/jobs.json").read()); DELIVERY = json.loads(open("/tmp/delivery.json").read())
kp = {"a": KPipeline(lang_code="a"), "b": KPipeline(lang_code="b")}
tts = ChatterboxTTS.from_pretrained(device="cuda")
asr = pipeline("automatic-speech-recognition", model="openai/whisper-large-v3-turbo", torch_dtype=torch.float16, device="cuda")
publish("loaded")
norm = lambda s: re.sub(r"[^a-z ]", "", s.lower()).strip()
def trim(a, sr):
    env = np.abs(a); thr = max(1e-4, env.max() * 0.02); idx = np.where(env > thr)[0]
    if not len(idx): return a
    return a[max(0, idx[0] - int(0.01 * sr)): min(len(a), idx[-1] + int(0.12 * sr))]
def first_burst(x, sr, max_s):
    """efforts ("Ugh!"): Chatterbox often keeps babbling for seconds after the grunt - keep the first voiced burst only
    (up to the first 120 ms of quiet), faded out"""
    w = int(sr * 0.02)
    env = np.array([np.sqrt(np.mean(x[i:i + w] ** 2)) for i in range(0, max(1, len(x) - w), w)])
    if not len(env): return x
    thr, on, gap, end = env.max() * 0.12, False, 0, len(x)
    for i, v in enumerate(env > thr):
        if v: on, gap = True, 0
        elif on:
            gap += 1
            if gap * 0.02 >= 0.12: end = (i - gap + 1) * w + int(0.08 * sr); break
    y = x[:min(end, int(max_s * sr))].copy()
    f = min(len(y), int(0.04 * sr)); y[len(y) - f:] *= np.linspace(1, 0, f)
    return y
for job in JOBS:
    vid, (kvoice, lang, pitch, reftext) = job["vid"], job["cast"]
    out = f"/kaggle/working/voice/{vid}"; os.makedirs(out, exist_ok=True)
    a = np.concatenate([x.numpy() if hasattr(x, "numpy") else np.asarray(x) for _, _, x in kp[lang](reftext, voice=kvoice, speed=1.0)]).astype(np.float32)
    if pitch: a = librosa.effects.pitch_shift(a, sr=24000, n_steps=pitch)
    ref = f"/tmp/ref_{vid}.wav"; sf.write(ref, a, 24000); sf.write(f"{out}/ref.wav", a, 24000)
    n = 0
    for key, idx, text, dl in job["lines"]:
        ex, cfg = DELIVERY[dl]
        effort = dl == "effort" or (len(norm(text).split()) <= 1 and "!" in text and dl in ("effort", "scream"))
        for t in range(5 if effort else 3):
            torch.manual_seed(1000 * idx + 77 * t + len(key))
            try:
                w = tts.generate(text, audio_prompt_path=ref, exaggeration=ex, cfg_weight=cfg)
            except Exception as e:
                publish("gen-fail", key=key, err=str(e)[:300]); continue
            sr = tts.sr; x = trim(w.squeeze(0).cpu().numpy().astype(np.float32), sr)
            if effort: x = first_burst(x, sr, 1.4 if dl == "scream" else 1.0)
            dur = len(x) / sr
            if effort:
                rms = float(np.sqrt(np.mean(x ** 2)) + 1e-9)
                score = max(0.0, 1.0 - abs(dur - 0.45) / 1.2) * 0.7 + min(1.0, rms * 8) * 0.3
            else:
                hyp = asr({"raw": x, "sampling_rate": sr}, generate_kwargs={"language": "english"})["text"]
                score = difflib.SequenceMatcher(None, norm(text), norm(hyp)).ratio()
                if dur > 1.2 + max(1, len(norm(text).split())) * 0.55: score *= 0.7
            sf.write(f"{out}/{key}_{idx}_{t}_{score:.3f}.wav", x, sr); n += 1
        publish("line", vid=vid, key=key, idx=idx)
    publish("voice-done", vid=vid, takes=n)
'''

stage = f'''"""Kaggle job: hero voice lines (Kokoro reference -> Chatterbox delivery -> Whisper scoring) - generated by
assetgen/kagglevoice_make.py for: {", ".join(vids)}. Outputs /kaggle/working/voice/<voice>/<key>_<i>_<take>_<score>.wav"""
import json, os, sys, time, subprocess, urllib.request, traceback
TOPIC = os.environ.get("NTFY_TOPIC", "zu-kagglevoice")
JOBS = {json.dumps(jobs)!r}
DELIVERY = {json.dumps(DELIVERY)!r}
WORKER = {WORKER!r}


def publish(phase, **extra):
    print("PHASE", phase, extra, flush=True)
    try:
        body = json.dumps({{"topic": TOPIC, "message": json.dumps({{"phase": phase, **extra}})[:3800]}}).encode()
        urllib.request.urlopen(urllib.request.Request("https://ntfy.sh", data=body, headers={{"Content-Type": "application/json"}}), timeout=15).read()
    except Exception as e:
        print("ntfy failed", e)


def sh(cmd, name):
    t = time.time(); r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    publish("step", name=name, ok=r.returncode == 0, secs=round(time.time() - t), tail=(r.stdout + r.stderr)[-1200:] if r.returncode else "")
    if r.returncode: raise SystemExit(name)


try:
    publish("boot")
    subprocess.run("apt-get install -y -qq espeak-ng > /dev/null 2>&1", shell=True)
    sh(f"{{sys.executable}} -m pip install -q uv", "uv")
    sh("uv venv -q -p 3.11 --seed /tmp/venv", "venv")
    sh("/tmp/venv/bin/python -m pip install -q chatterbox-tts 'kokoro>=0.9.4' 'misaki[en]' soundfile librosa 'setuptools<81'", "deps")
    open("/tmp/jobs.json", "w").write(JOBS); open("/tmp/delivery.json", "w").write(DELIVERY); open("/tmp/worker.py", "w").write(WORKER)
    r = subprocess.run(["/tmp/venv/bin/python", "/tmp/worker.py"], env={{**os.environ, "NTFY_TOPIC": TOPIC}}, capture_output=True, text=True)
    publish("done", rc=r.returncode, tail=(r.stdout + r.stderr)[-2500:])
except SystemExit:
    raise
except Exception:
    publish("error", trace=traceback.format_exc()[-2000:])
'''
os.makedirs(os.path.join(HERE, "kagglevoice"), exist_ok=True)
open(os.path.join(HERE, "kagglevoice", "kagglevoice.py"), "w", encoding="utf-8").write(stage)
print("kagglevoice stage:", ", ".join(vids), sum(len(j["lines"]) for j in jobs), "lines")
