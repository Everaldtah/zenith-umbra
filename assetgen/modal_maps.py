"""Map art on Modal with Qwen-Image-Edit-2511 (Apache-2.0), drawn from written briefs (blank canvas in, image out):
key art (menus, loading screens), sky panoramas, tileable ground / wall / roof textures and prop concepts for the
image-to-3D stage (modal_trellis2.py). Same model and weights volume as modal_restyle.py / modal_concept.py.

    modal run assetgen/modal_maps.py                         # everything
    modal run assetgen/modal_maps.py --only hanabi           # one map's jobs (name prefix match)

Out: work/maps/<job>.png - then `python assetgen/maps_finish.py` makes them web assets (webp, seamless textures,
     sky strips) and copies the prop concepts to work/ow/pick/ for TRELLIS.2.
"""
import io, os
import modal

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "work", "maps")
MODEL = "Qwen/Qwen-Image-Edit-2511"

ART = ("stylized AAA team hero-shooter environment concept art: an optimistic near-future world, clean bold shapes with "
       "soft bevelled edges, hand-painted textures in large clean colour blocks, realistic architectural proportions with "
       "chunky readable details, lush oversized foliage, warm inviting lighting, strong silhouettes and clear readability. ")
TEX = ("A perfectly flat, top-down, evenly lit seamless tileable texture swatch filling the whole image edge to edge, no "
       "perspective, no shadows, no objects, no border, stylized hand-painted game texture with clean shapes and subtle "
       "painted variation: ")
PROP = ("A single isolated 3D game prop, full object visible with margin, three-quarter front view, centred on a plain light "
        "grey studio background, soft even lighting, no shadow on the background, no text, stylized AAA hero-shooter prop "
        "with clean bevelled shapes and hand-painted colour blocks: ")
SKY = ("A seamless wide panoramic sky backdrop with a distant horizon, no foreground objects, soft painted clouds, stylized "
       "hero-shooter environment art: ")
NEG = "text, watermark, logo, signature, people, characters, photorealistic, blurry, noisy, grunge, lowres, frame, border, ui"

# (job, prompt, width, height)
JOBS = [
    # ---------------- Hanabi Harbor: a festival harbor town at dusk (Control)
    ("hanabi_key", ART + "Hanabi Harbor at dusk on festival night: a Japanese-inspired seaside harbor town, wooden two-storey "
     "shophouses with blue tiled roofs and paper-lantern-lit balconies, strings of red and white lanterns criss-crossing the "
     "streets, festival food stalls, a raised wooden festival stage in the central plaza, fishing boats moored at a stone "
     "pier, a lighthouse, fireworks blooming over the sea, warm orange light against a violet sky.", 1344, 768),
    ("hanabi_sky", SKY + "a violet-to-amber dusk sky over a calm sea, first stars, soft pink clouds low on the horizon, "
     "faint fireworks far away.", 1536, 640),
    ("hanabi_ground", TEX + "worn grey stone paving slabs of mixed sizes with thin mortar lines and a few moss specks.", 1024, 1024),
    ("hanabi_wall", TEX + "warm painted wooden shop facade planks, ochre and cedar brown vertical boards with dark timber "
     "beams.", 1024, 1024),
    ("hanabi_roof", TEX + "glazed blue ceramic roof tiles in neat overlapping rows.", 1024, 1024),
    ("prop_hanabi_stall", PROP + "a Japanese festival food stall with a red and white striped awning, paper lanterns, a "
     "wooden counter with bowls and skewers.", 1024, 1024),
    ("prop_hanabi_yagura", PROP + "a tall wooden festival drum tower (yagura) with a big taiko drum on top, red and white "
     "bunting and a ring of paper lanterns.", 1024, 1024),
    ("prop_hanabi_boat", PROP + "a small wooden fishing boat with a painted blue hull, a little cabin and hanging lanterns.", 1024, 1024),
    # ---------------- Cloudstep Terraces: a terraced mountain tea village above the clouds (Control)
    ("cloudstep_key", ART + "Cloudstep Terraces: a mountain tea village clinging to green terraced cliffs high above a sea of "
     "clouds, curved-roof wooden teahouses and a cable-car station on stone terraces linked by stairs and rope bridges, red "
     "cable-car gondolas gliding between peaks, oversized tea bushes and pines, crisp morning sunlight.", 1344, 768),
    ("cloudstep_sky", SKY + "a bright morning sky above a sea of white clouds with distant blue mountain peaks.", 1536, 640),
    ("cloudstep_ground", TEX + "mossy terrace flagstones, pale granite with green moss in the cracks.", 1024, 1024),
    ("cloudstep_wall", TEX + "white lime plaster wall with warm timber frame beams and a grey stone base course.", 1024, 1024),
    ("cloudstep_roof", TEX + "dark green glazed curved roof tiles in rows.", 1024, 1024),
    ("prop_cloud_gondola", PROP + "a red cable-car gondola cabin with big windows and a gold roof ornament, hanging from a "
     "grip arm.", 1024, 1024),
    ("prop_cloud_pagoda", PROP + "a small three-tiered wooden pagoda with green curved roofs and golden finials.", 1024, 1024),
    ("prop_cloud_teatree", PROP + "a big round stylized tea bush tree with glossy leaves, planted in a stone terrace box.", 1024, 1024),
    # ---------------- Kagura Avenue: a shrine-festival boulevard for Mikoshi Rush (push)
    ("kagura_key", ART + "Kagura Avenue: a long festival boulevard running between two great shrine gates in a futuristic "
     "Japanese city, a golden portable shrine float (mikoshi) carried on a glowing hover-sled down the middle of the street, "
     "three-storey buildings with shop fronts, balconies and rooftop gardens lining both sides, side alleys, lantern "
     "arches overhead, neon signs mixed with traditional wood, cherry trees, bright afternoon.", 1344, 768),
    ("kagura_sky", SKY + "a clear afternoon sky with tall white cumulus clouds and a distant futuristic city skyline.", 1536, 640),
    ("kagura_ground", TEX + "light granite street paving with a subtle red brick border pattern.", 1024, 1024),
    ("kagura_wall", TEX + "cream stucco wall with dark vermilion timber frames and shoji paper window panels.", 1024, 1024),
    ("kagura_roof", TEX + "charcoal grey clay roof tiles in rows.", 1024, 1024),
    ("prop_kagura_mikoshi", PROP + "an ornate golden Japanese portable festival shrine (mikoshi) with a phoenix on the roof, "
     "red lacquer pillars and tassels, mounted on a sleek white hover-sled with glowing cyan thrusters.", 1024, 1024),
    ("prop_kagura_gate", PROP + "a huge vermilion shrine gate (torii) with black crossbeams and a golden plaque.", 1024, 1024),
    ("prop_kagura_lamp", PROP + "a tall stone lantern post combined with a futuristic street lamp and a small neon sign.", 1024, 1024),
    # ---------------- Sunset Mile: a desert highway town under red mesas (push; a Route-66-style climbers' map)
    ("mile_key", ART + "Sunset Mile: a sun-baked desert highway town in a canyon of red sandstone mesas, an old two-lane "
     "highway running down the middle past a retro gas station with a big canopy, a chrome roadside diner with a tall "
     "neon star on a pole, a two-storey motel with an outdoor walkway, blank sun-faded billboards on the cliff tops (every "
     "sign is blank - no letters or words anywhere), saguaro cactus, a wooden water "
     "tower on a mesa ledge, warm late-afternoon sun, turquoise and cream accents, heat haze.", 1344, 768),
    ("mile_sky", SKY + "a hot late-afternoon desert sky, deep blue fading to warm gold at the horizon, thin high clouds, "
     "distant flat-topped red mesas and buttes on the horizon.", 1536, 640),
    ("mile_ground", TEX + "packed desert sand and dry red dirt with tiny pebbles, faint wind ripples and a few cracks.", 1024, 1024),
    ("mile_wall", TEX + "sun-bleached cream stucco wall with a turquoise painted band and faint cracks, retro roadside style.", 1024, 1024),
    ("mile_rock", TEX + "layered red and orange sandstone rock face with horizontal strata bands, painted smooth.", 1024, 1024),
    ("mile_roof", TEX + "sun-faded dark asphalt with fine gravel, subtle patches and cracks.", 1024, 1024),
    # ---------------- Iron Gulch: a canyon rail yard (push; a Route-66-style climbers' map)
    ("gulch_key", ART + "Iron Gulch: a frontier rail yard at the bottom of a deep ochre canyon, rows of rust-red boxcars on "
     "parallel tracks, a two-storey timber train depot with a long platform canopy, an old locomotive, a wooden water tower "
     "on a timber trestle, a mine entrance cut into the cliff with ore carts, a high wooden trestle bridge spanning the "
     "canyon, stepped cliff ledges, windpumps, golden-hour light with long shadows.", 1344, 768),
    ("gulch_sky", SKY + "a golden-hour canyon sky, warm orange and pink clouds, a pale blue zenith, jagged canyon rims and "
     "rock spires silhouetted on the horizon.", 1536, 640),
    ("gulch_ground", TEX + "dusty rail yard ground: packed ochre dirt mixed with grey gravel ballast and a few wooden splinters.", 1024, 1024),
    ("gulch_wall", TEX + "weathered vertical timber planks, sun-faded red-brown paint worn back to grey wood, a few nail heads.", 1024, 1024),
    ("gulch_rock", TEX + "ochre and burnt-orange canyon rock with broad horizontal strata bands and soft painted cracks, calm and even.", 1024, 1024),
    ("gulch_roof", TEX + "rusty corrugated metal roofing sheets with orange rust streaks and faded red paint.", 1024, 1024),
    # ---------------- shared: health pack station (small + large) for every map
    ("prop_healthpack", PROP + "a compact medical supply station: a round white and teal pedestal with a glowing plus-shaped "
     "health emblem floating above it.", 1024, 1024),
]

vol = modal.Volume.from_name("zu-hf", create_if_missing=True)
image = (modal.Image.debian_slim(python_version="3.11")
         .apt_install("git", "libgl1", "libglib2.0-0")
         .pip_install("torch==2.7.1", "torchvision==0.22.1", index_url="https://download.pytorch.org/whl/cu126")
         .pip_install("git+https://github.com/huggingface/diffusers", "transformers>=4.51", "accelerate", "safetensors",
                      "huggingface_hub[hf_transfer]", "sentencepiece", "pillow", "peft")
         .env({"HF_HOME": "/hf", "HF_HUB_ENABLE_HF_TRANSFER": "1"}))
app = modal.App("zu-maps", image=image)


@app.cls(gpu="A100-80GB", timeout=3600, volumes={"/hf": vol}, scaledown_window=120, max_containers=4)
class Painter:
    @modal.enter()
    def load(self):
        import torch
        from diffusers import QwenImageEditPlusPipeline
        self.pipe = QwenImageEditPlusPipeline.from_pretrained(MODEL, torch_dtype=torch.bfloat16).to("cuda")
        self.pipe.set_progress_bar_config(disable=True)

    @modal.method()
    def paint(self, job: str, prompt: str, w: int, h: int, seed: int = 11, steps: int = 40) -> bytes:
        import torch
        from PIL import Image
        blank = Image.new("RGB", (w, h), (178, 180, 184))
        out = self.pipe(image=[blank], prompt=prompt, negative_prompt=NEG, true_cfg_scale=4.0, guidance_scale=1.0,
                        num_inference_steps=steps, width=w, height=h, generator=torch.manual_seed(seed)).images[0]
        b = io.BytesIO(); out.save(b, "PNG"); return b.getvalue()


@app.local_entrypoint()
def main(only: str = ""):
    os.makedirs(OUT, exist_ok=True)
    jobs = [j for j in JOBS if not only or j[0].startswith(only) or j[0].startswith("prop_" + only)]
    for (job, *_), res in zip(jobs, Painter().paint.starmap(jobs, return_exceptions=True)):
        if isinstance(res, Exception): print("FAILED", job, repr(res)[:300]); continue
        p = os.path.join(OUT, f"{job}.png"); open(p, "wb").write(res); print("saved", p, flush=True)
