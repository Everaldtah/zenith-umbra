
# ---------------------------------------------------------------- animation: Wan 2.2 TI2V-5B image-to-video on the chosen keyframes
# (the screenplay above is inlined by cinematic/prepare.py). The benchmark showed Wan keeps the characters on model where
# LTX drifts; on a T4 it costs ~10 s per frame-step, so each clip gets exactly the frames its shot needs (16 fps).
import json, os, sys, time, glob, subprocess, traceback, urllib.request

TOPIC = os.environ.get("NTFY_TOPIC", "zu-cineanim")
OUT = "/kaggle/working/clips"; os.makedirs(OUT, exist_ok=True)
PICKS = json.loads(os.environ.get("PICKS", "{}"))
ONLY = [x for x in os.environ.get("ONLY", "").split(",") if x]
STEPS = int(os.environ.get("STEPS", "22"))
MID = "Wan-AI/Wan2.2-TI2V-5B-Diffusers"
MOTION_NEG = ("worst quality, low quality, blurry, jittery, flickering, distorted face, deformed hands, extra limbs, morphing, "
              "static image, still frame, watermark, text, subtitles, 3d render, photo")


def publish(phase, **extra):
    print("PHASE", phase, extra, flush=True)
    try:
        body = json.dumps({"topic": TOPIC, "message": json.dumps({"phase": phase, **extra})[:3800]}).encode()
        urllib.request.urlopen(urllib.request.Request("https://ntfy.sh", data=body, headers={"Content-Type": "application/json"}), timeout=15).read()
    except Exception as e:
        print("ntfy failed", e)


WORKER = r'''
import os, sys, json, time, traceback, urllib.request
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
import torch, numpy as np
from PIL import Image
from diffusers import WanImageToVideoPipeline, AutoencoderKLWan
from diffusers.utils import export_to_video
TOPIC = os.environ["NTFY_TOPIC"]; G = int(os.environ["GPU"]); OUT = os.environ["OUT"]; STEPS = int(os.environ["STEPS"])
def publish(phase, **extra):
    try:
        body = json.dumps({"topic": TOPIC, "message": json.dumps({"phase": phase, **extra})[:3800]}).encode()
        urllib.request.urlopen(urllib.request.Request("https://ntfy.sh", data=body, headers={"Content-Type": "application/json"}), timeout=15).read()
    except Exception: pass
jobs = json.loads(os.environ["JOBS"])
vae = AutoencoderKLWan.from_pretrained(os.environ["MID"], subfolder="vae", torch_dtype=torch.float16)
pipe = WanImageToVideoPipeline.from_pretrained(os.environ["MID"], vae=vae, text_encoder=None, tokenizer=None, torch_dtype=torch.float16)
# the whole model lives on this worker's GPU: two workers each holding a 13 GB CPU copy (cpu offload) overflowed the
# VM's RAM and one was always killed. On a CUDA OOM the worker falls back to offloading.
pipe.to(f"cuda:{G}")
import gc; gc.collect()
try: pipe.vae.enable_tiling()
except Exception: pass
offload = False
open(f"/tmp/loaded{G}", "w").write("1")
emb = torch.load("/tmp/embeds.pt")
for j in jobs:
    t = time.time()
    try:
        im = Image.open(j["key"]).convert("RGB")
        w, h = 832, 480
        sw, sh = im.size; k = max(w / sw, h / sh)
        im = im.resize((round(sw * k), round(sh * k)), Image.LANCZOS)
        l, u = (im.width - w) // 2, (im.height - h) // 2
        im = im.crop((l, u, l + w, u + h))
        pe = emb[j["id"]].to(f"cuda:{G}", torch.float16); ne = emb["__neg__"].to(f"cuda:{G}", torch.float16)
        frames = 16 * j["secs"] + 1
        run = lambda: pipe(image=im, prompt_embeds=pe, negative_prompt_embeds=ne, width=w, height=h, num_frames=frames, num_inference_steps=STEPS,
                           guidance_scale=5.0, generator=torch.Generator("cpu").manual_seed(7)).frames[0]
        try: out = run()
        except torch.cuda.OutOfMemoryError:
            if offload: raise
            torch.cuda.empty_cache(); pipe.to("cpu"); pipe.enable_model_cpu_offload(gpu_id=G); offload = True
            publish("offload", gpu=G); out = run()
        export_to_video(out, f"{OUT}/{j['id']}.mp4", fps=16)
        if not os.path.exists(f"{OUT}/{j['id']}.mp4"): raise RuntimeError("no file")
        publish("clip", id=j["id"], secs=round(time.time() - t), gpu=G)
    except Exception:
        publish("clip-error", id=j["id"], trace=traceback.format_exc()[-900:])
        torch.cuda.empty_cache()
publish("worker-done", gpu=G)
'''

try:
    publish("boot")
    t0 = time.time()
    subprocess.run(f"{sys.executable} -m pip install -q -U diffusers transformers accelerate imageio imageio-ffmpeg ftfy sentencepiece", shell=True)
    keys = {}
    for p in glob.glob("/kaggle/input/**/key/*.png", recursive=True):
        src = "b" if "cinekey-b" in p else "a"
        keys[(src, os.path.basename(p)[:-4])] = p
    jobs = []
    for _, s in shots():
        if ONLY and s["id"] not in ONLY: continue
        pk = PICKS.get(s["id"], ["a", 0])
        src, k = (pk if isinstance(pk, list) else ["a", pk])
        p = keys.get((src, f"{s['id']}_{k}"))
        if not p: publish("missing-key", id=s["id"]); continue
        jobs.append({"id": s["id"], "key": p, "secs": s["secs"], "motion": s["motion"]})
    publish("inputs", n=len(jobs), keys=len(keys))
    # phase A: every motion prompt through UMT5 once, on the CPU (the encoder alone would fill a T4)
    enc = f"""
import torch, json
from transformers import UMT5EncoderModel
from diffusers import WanImageToVideoPipeline
# UMT5-XXL in fp32 split over both T4s (fp16 overflows in T5 encoders; the CPU took ~55 s a prompt)
te = UMT5EncoderModel.from_pretrained("{MID}", subfolder="text_encoder", torch_dtype=torch.float32, device_map="auto", max_memory={{0: "14GiB", 1: "14GiB", "cpu": "20GiB"}})
pipe = WanImageToVideoPipeline.from_pretrained("{MID}", transformer=None, vae=None, text_encoder=te, torch_dtype=torch.float32)
jobs = json.load(open('/tmp/jobs.json'))
out = {{}}
with torch.no_grad():
    for j in jobs:
        p = "anime scene, " + j["motion"] + ", fluid animation, detailed anime style, cinematic"
        out[j["id"]] = pipe.encode_prompt(p, None, do_classifier_free_guidance=False, device="cuda:0", dtype=torch.float32)[0].float().cpu()
    out["__neg__"] = pipe.encode_prompt({MOTION_NEG!r}, None, do_classifier_free_guidance=False, device="cuda:0", dtype=torch.float32)[0].float().cpu()
torch.save(out, '/tmp/embeds.pt')
print('EMBEDS_OK', len(out))
"""
    json.dump(jobs, open("/tmp/jobs.json", "w"))
    r = subprocess.run([sys.executable, "-c", enc], capture_output=True, text=True)
    publish("embeds", ok="EMBEDS_OK" in r.stdout, tail=(r.stdout + r.stderr)[-600:] if "EMBEDS_OK" not in r.stdout else "")
    open("/tmp/worker.py", "w").write(WORKER)
    # longest clips first, alternating GPUs, so both finish together
    order = sorted(jobs, key=lambda j: -j["secs"])
    procs = []
    for g in range(2):
        if g == 1:
            for _ in range(600):
                if os.path.exists("/tmp/loaded0") or procs[0].poll() is not None: break
                time.sleep(2)
        env = {**os.environ, "GPU": str(g), "JOBS": json.dumps(order[g::2]), "OUT": OUT, "STEPS": str(STEPS), "MID": MID, "NTFY_TOPIC": TOPIC}
        procs.append(subprocess.Popen([sys.executable, "/tmp/worker.py"], env=env, stdout=open(f"/tmp/w{g}.log", "w"), stderr=subprocess.STDOUT))
    for p in procs: p.wait()
    made = sorted(os.listdir(OUT))
    publish("done", made=len(made), of=len(jobs), minutes=round((time.time() - t0) / 60, 1),
            logs={g: open(f"/tmp/w{g}.log").read()[-1200:] for g in range(2)} if len(made) < len(jobs) else "")
except Exception:
    publish("error", trace=traceback.format_exc()[-1500:])
