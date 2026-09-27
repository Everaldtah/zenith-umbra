# ---------------------------------------------------------------- game SFX on Kaggle: MMAudio text-to-audio (large_44k_v2)
# For sounds the Modal MOSS run never made (Modal credits are for emergencies): each job in SFX_JOBS (a JSON list of
# assetgen/audio/sfx_list.json entries) is rendered as TAKES takes with different seeds on the two T4s, every take is
# scored with LAION-CLAP against its prompt, and written as /kaggle/working/sfx/<id>/<take>_<clap>.wav (48 kHz) - the
# layout assetgen/audio_finish.py picks winners from.
import json, os, sys, glob, time, shutil, subprocess, traceback, urllib.request, threading

TOPIC = os.environ.get("NTFY_TOPIC", "zu-kagglesfx")
JOBS = json.loads(os.environ.get("SFX_JOBS", "[]"))
TAKES = int(os.environ.get("TAKES", "6"))
OUT = "/kaggle/working/sfx"; os.makedirs(OUT, exist_ok=True)
NEG = "music, singing, speech, voice, talking, crowd, noise floor, hiss, distortion, low quality"


def publish(phase, **extra):
    print("PHASE", phase, extra, flush=True)
    try:
        body = json.dumps({"topic": TOPIC, "message": json.dumps({"phase": phase, **extra})[:3800]}).encode()
        urllib.request.urlopen(urllib.request.Request("https://ntfy.sh", data=body, headers={"Content-Type": "application/json"}), timeout=15).read()
    except Exception as e:
        print("ntfy failed", e)


try:
    publish("boot", jobs=[j["id"] for j in JOBS]); t0 = time.time()
    r = subprocess.run("git clone -q https://github.com/hkchengrex/MMAudio.git /tmp/MMAudio && cd /tmp/MMAudio && "
                       f"{sys.executable} -m pip install -q -e .", shell=True, capture_output=True, text=True)
    publish("installed", ok=r.returncode == 0, tail=(r.stdout + r.stderr)[-600:])
    raw = "/kaggle/working/raw"; os.makedirs(raw, exist_ok=True)     # same filesystem as OUT (os.replace across devices fails)
    work = [(j, k) for j in JOBS for k in range(int(j.get("take", TAKES)))]

    def worker(g, items):
        for j, k in items:
            d = f"/tmp/o{g}/{j['id']}_{k}"; os.makedirs(d, exist_ok=True)
            secs = max(1.0, float(j.get("secs", 1.0)) + 0.5)
            cmd = [sys.executable, "demo.py", "--prompt", j["prompt"], "--negative_prompt", NEG, "--duration", f"{secs:.2f}",
                   "--seed", str(1000 + k * 7919), "--num_steps", "25", "--cfg_strength", "4.5", "--output", d, "--full_precision"]
            r = subprocess.run(cmd, cwd="/tmp/MMAudio", capture_output=True, text=True, env={**os.environ, "CUDA_VISIBLE_DEVICES": str(g)})
            got = glob.glob(f"{d}/*.flac") + glob.glob(f"{d}/*.wav")
            if got:
                subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", got[0], "-ar", "48000", "-ac", "1", f"{raw}/{j['id']}__{k}.wav"])
                publish("take", id=j["id"], k=k, gpu=g)
            else:
                publish("take-error", id=j["id"], k=k, tail=(r.stdout + r.stderr)[-700:])

    th = [threading.Thread(target=worker, args=(g, work[g::2])) for g in range(2)]
    for x in th: x.start()
    for x in th: x.join()
    # rank every take against its prompt with CLAP
    import numpy as np, soundfile as sf, torch
    from transformers import ClapModel, ClapProcessor
    clap = ClapModel.from_pretrained("laion/clap-htsat-unfused").to("cuda").eval(); cp = ClapProcessor.from_pretrained("laion/clap-htsat-unfused")
    made = {}
    for j in JOBS:
        takes = sorted(glob.glob(f"{raw}/{j['id']}__*.wav"))
        if not takes: continue
        wavs = [sf.read(p)[0].astype(np.float32) for p in takes]
        inp = cp(text=[j.get("clap", j["prompt"])] * len(wavs), audio=wavs, sampling_rate=48000, return_tensors="pt", padding=True)
        with torch.no_grad():
            o = clap(**{k: v.to("cuda") for k, v in inp.items()})
        sc = (torch.nn.functional.normalize(o.text_embeds, dim=-1) * torch.nn.functional.normalize(o.audio_embeds, dim=-1)).sum(-1).cpu().numpy().tolist()
        os.makedirs(f"{OUT}/{j['id']}", exist_ok=True)
        for i, (p, s) in enumerate(zip(takes, sc)):
            shutil.move(p, f"{OUT}/{j['id']}/{i}_{s:.3f}.wav")
        made[j["id"]] = [round(s, 3) for s in sc]
    publish("done", made=made, minutes=round((time.time() - t0) / 60, 1))
except Exception:
    publish("error", trace=traceback.format_exc()[-1500:])
