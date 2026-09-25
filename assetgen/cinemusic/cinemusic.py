"""Kaggle job: score for the lore cinematic with ACE-Step (Apache-2.0), one instrumental cue per section.
CUES env: JSON [{cue, prompt, secs}], two takes each. Outputs /kaggle/working/music/<cue>_<k>.wav; progress via ntfy."""
import json, os, subprocess, sys, time, traceback, urllib.request

TOPIC = os.environ.get("NTFY_TOPIC", "zu-cinemusic")
OUT = "/kaggle/working/music"; os.makedirs(OUT, exist_ok=True)
CUES = json.loads(os.environ["CUES"])


def publish(phase, **extra):
    print("PHASE", phase, extra, flush=True)
    try:
        body = json.dumps({"topic": TOPIC, "message": json.dumps({"phase": phase, **extra})[:3800]}).encode()
        urllib.request.urlopen(urllib.request.Request("https://ntfy.sh", data=body, headers={"Content-Type": "application/json"}), timeout=15).read()
    except Exception as e:
        print("ntfy failed", e)


publish("boot")
t0 = time.time()
r = subprocess.run(f"{sys.executable} -m pip install -q git+https://github.com/ace-step/ACE-Step.git", shell=True, capture_output=True, text=True)
publish("installed", ok=r.returncode == 0, tail=(r.stdout + r.stderr)[-800:], minutes=round((time.time() - t0) / 60, 1))
try:
    from acestep.pipeline_ace_step import ACEStepPipeline
    pipe = None
    for dtype in ("float16", "bfloat16", "float32"):
        try:
            pipe = ACEStepPipeline(checkpoint_dir="/kaggle/working/ace_ckpt", dtype=dtype, torch_compile=False, cpu_offload=(dtype == "float32"))
            pipe(audio_duration=5, prompt="test, piano", lyrics="[inst]", infer_step=10, guidance_scale=15, save_path=f"{OUT}/_probe.wav")
            publish("dtype", dtype=dtype); break
        except Exception:
            publish("dtype-fail", dtype=dtype, trace=traceback.format_exc()[-700:]); pipe = None
    for c in CUES:
        for k in range(2):
            t = time.time()
            # ACE-Step caps a take at 240 s; cues are well under that. A little extra tail gives the crossfade room.
            pipe(audio_duration=min(240, c["secs"] + 3), prompt=c["prompt"] + ", instrumental, no vocals", lyrics="[inst]",
                 infer_step=60, guidance_scale=15, scheduler_type="euler", cfg_type="apg", omega_scale=10, manual_seeds=[11 + k * 97],
                 save_path=f"{OUT}/{c['cue']}_{k}.wav")
            publish("cue", cue=c["cue"], k=k, secs=round(time.time() - t))
    if os.path.exists(f"{OUT}/_probe.wav"): os.remove(f"{OUT}/_probe.wav")
except Exception:
    publish("error", trace=traceback.format_exc()[-1500:])
publish("done", made=sorted(os.listdir(OUT)), minutes=round((time.time() - t0) / 60, 1))
