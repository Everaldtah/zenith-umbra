"""Kaggle job: benchmark free image-to-video models on the T4 for the lore cinematic.
Animates the same anime key art with LTX-Video 2B (0.9.5) and Wan 2.2 TI2V-5B, reports seconds per clip.
Outputs /kaggle/working/vid/<model>.mp4 + first/mid/last frames as PNG; progress via ntfy."""
import glob, json, os, subprocess, sys, time, traceback, urllib.request

TOPIC = os.environ.get("NTFY_TOPIC", "zu-cinebench")
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
OUT = "/kaggle/working/vid"
os.makedirs(OUT, exist_ok=True)


def publish(phase, **extra):
    print("PHASE", phase, extra, flush=True)
    try:
        body = json.dumps({"topic": TOPIC, "message": json.dumps({"phase": phase, **extra})[:3800]}).encode()
        urllib.request.urlopen(urllib.request.Request("https://ntfy.sh", data=body, headers={"Content-Type": "application/json"}), timeout=15).read()
    except Exception as e:
        print("ntfy failed", e)


publish("boot")
t0 = time.time()
r = subprocess.run(f"{sys.executable} -m pip install -q -U diffusers transformers accelerate imageio imageio-ffmpeg ftfy sentencepiece", shell=True, capture_output=True, text=True)
publish("installed", ok=r.returncode == 0, tail=r.stderr[-600:], minutes=round((time.time() - t0) / 60, 1))

import torch, numpy as np
from PIL import Image
from diffusers.utils import export_to_video

src = sorted(glob.glob("/kaggle/input/**/img/key_raijin_1.png", recursive=True) + glob.glob("/kaggle/input/**/img/key_raijin_0.png", recursive=True))
publish("inputs", found=src[:3])
img = Image.open(src[0]).convert("RGB")
PROMPT = ("anime cinematic, a young swordsman with a katana stands in a rainy neon city at night, rain streaks falling, his coat and hair "
          "moving in the wind, blue lightning crackles along the blade, slow camera push-in, detailed cel shaded anime, dramatic lighting")
NEG = "worst quality, blurry, jittery, distorted, deformed face, static, still image, watermark, text"


def frames_png(frames, name):
    n = len(frames)
    for k, i in (("a", 0), ("b", n // 2), ("c", n - 1)):
        f = frames[i]
        (f if isinstance(f, Image.Image) else Image.fromarray((np.asarray(f) * (255 if np.asarray(f).max() <= 1 else 1)).astype(np.uint8))).save(f"{OUT}/{name}_{k}.png")


def run_ltx():
    from diffusers import LTXImageToVideoPipeline
    for dtype in (torch.float16, torch.bfloat16):
        try:
            pipe = LTXImageToVideoPipeline.from_pretrained("Lightricks/LTX-Video-0.9.5", torch_dtype=dtype)
            # the T5-XXL text encoder alone fills a T4: encode on the CPU once, then drop it
            pipe.text_encoder.to("cpu", torch.bfloat16)
            with torch.no_grad():
                pe, pm, ne, nm = pipe.encode_prompt(PROMPT, NEG, do_classifier_free_guidance=True, device="cpu", dtype=torch.bfloat16)
            pipe.text_encoder = None; import gc; gc.collect()
            pipe.transformer.to("cuda:0"); pipe.vae.to("cuda:0"); pipe.vae.enable_tiling()
            w, h = 768, 448
            im = img.resize((w, h), Image.LANCZOS)
            t = time.time()
            c = lambda x: x.to("cuda:0", dtype)
            out = pipe(image=im, prompt_embeds=c(pe), prompt_attention_mask=pm.to("cuda:0"), negative_prompt_embeds=c(ne), negative_prompt_attention_mask=nm.to("cuda:0"),
                       width=w, height=h, num_frames=97, num_inference_steps=40, guidance_scale=3.0, generator=torch.Generator("cuda").manual_seed(7)).frames[0]
            secs = round(time.time() - t)
            arr = np.asarray(out[len(out) // 2]).astype(np.float32)
            name = f"ltx_{str(dtype).split('.')[-1]}"
            export_to_video(out, f"{OUT}/{name}.mp4", fps=24); frames_png(out, name)
            publish("ltx", dtype=str(dtype), secs=secs, mean=float(arr.mean()), frames=len(out))
            del pipe; gc.collect(); torch.cuda.empty_cache()
            if arr.mean() > 3: return
        except Exception:
            publish("ltx-error", dtype=str(dtype), trace=traceback.format_exc()[-700:])
            import gc; gc.collect(); torch.cuda.empty_cache()


def run_wan():
    from diffusers import WanImageToVideoPipeline, AutoencoderKLWan
    for dtype in (torch.float16,):
        try:
            mid = "Wan-AI/Wan2.2-TI2V-5B-Diffusers"
            vae = AutoencoderKLWan.from_pretrained(mid, subfolder="vae", torch_dtype=torch.float32)
            pipe = WanImageToVideoPipeline.from_pretrained(mid, vae=vae, torch_dtype=dtype)
            pipe.text_encoder.to("cpu", torch.bfloat16)
            with torch.no_grad():
                pe, ne = pipe.encode_prompt(PROMPT, NEG, do_classifier_free_guidance=True, device="cpu", dtype=torch.bfloat16)
            pipe.text_encoder = None; import gc; gc.collect()
            pipe.enable_model_cpu_offload(gpu_id=1)          # transformer and VAE take turns on the GPU
            try: pipe.vae.enable_tiling()
            except Exception: pass
            w, h = 832, 480
            im = img.resize((w, h), Image.LANCZOS)
            t = time.time()
            out = pipe(image=im, prompt_embeds=pe.to('cuda:1', dtype), negative_prompt_embeds=ne.to('cuda:1', dtype), width=w, height=h, num_frames=81, num_inference_steps=30,
                       guidance_scale=5.0, generator=torch.Generator("cpu").manual_seed(7)).frames[0]
            secs = round(time.time() - t)
            arr = np.asarray(out[len(out) // 2]).astype(np.float32)
            name = f"wan_{str(dtype).split('.')[-1]}"
            export_to_video(out, f"{OUT}/{name}.mp4", fps=16); frames_png(out, name)
            publish("wan", dtype=str(dtype), secs=secs, mean=float(arr.mean()), frames=len(out))
            del pipe; gc.collect(); torch.cuda.empty_cache()
            if arr.mean() > 0.02: return
        except Exception:
            publish("wan-error", dtype=str(dtype), trace=traceback.format_exc()[-700:])
            import gc; gc.collect(); torch.cuda.empty_cache()


ONLY = os.environ.get('ONLY', 'ltx,wan').split(',')
if 'ltx' in ONLY: run_ltx()
import gc; gc.collect()
if 'wan' in ONLY: run_wan()
publish("done", made=sorted(os.listdir(OUT)), minutes=round((time.time() - t0) / 60, 1))
