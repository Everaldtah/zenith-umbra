"""New-hero concepts on Modal with Qwen-Image-Edit-2511 (Apache-2.0), the same model and house style as modal_restyle.py,
but drawn from a written brief instead of an older concept:

    modal run assetgen/modal_concept.py --hero gantetsu --stage concept --seeds 4     # blank canvas -> key concept (armed)
    modal run assetgen/modal_concept.py --hero gantetsu --stage model --src work/ow/concept/gantetsu_1002.png --seeds 3
                                                                                      # picked concept -> rig-ready A-pose

stage "concept": the full character with his weapons (hero select, portraits, the look everything else must match).
stage "model":   the same character re-posed for TRELLIS.2 + rigging: clean A-pose, EMPTY fists (the weapons are
                 procedural props in game: rotating barrels, muzzle flashes, aim along the forearm).
Out: work/ow/concept/<hero>_<stage>_<seed>.png   (pick one into work/ow/pick/<hero>.png, then modal_upscale.py,
     modal_trellis2.py --heroes <hero>, ow_finish.py --only <hero>, build_assets.py --only <hero> --unirig)
Weights come from the "zu-hf" Modal volume that modal_restyle.py filled.
"""
import io, os
import modal

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
OUT = os.path.join(ROOT, "work", "ow", "concept")
MODEL = "Qwen/Qwen-Image-Edit-2511"

STYLE = ("A finished 3D character model render in a polished, stylized AAA team hero-shooter art style: ADULT heroic "
         "proportions, a bold, instantly readable silhouette, slightly oversized hands and boots for readability; rich but "
         "clean costume design with layered armour and cloth pieces; clean sculpted forms with soft rounded bevelled edges; "
         "hand-painted PBR textures made of large clean colour blocks with subtle painted gradients (lighter at the top, a "
         "little darker toward the feet) and crisp painted edge highlights; no noise, no grunge, no tiny clutter. ")
FACE = ("The face is a characterful adult face, stylized and expressive: defined cheekbones and jaw, smooth skin with a warm "
        "subsurface glow, clear eyes with bright irises and catchlights (not oversized), a defined nose and mouth, bold eyebrows. "
        "Hair is sculpted into chunky clean clumps with a soft sheen. ")
MATS = "Materials read clearly: matte cloth, satin leather, braided rope, polished metal with soft studio reflections, glowing emissive accents. "
NEG = ("chibi, child, kid, big head, super deformed, anime, cel shading, flat 2D illustration, photorealistic, realistic skin pores, "
       "noise, grunge, dirt, blurry, low detail, multiple views, turnaround sheet, character sheet, text, watermark, logo, "
       "cropped, cut off feet, extra limbs, extra fingers, deformed hands, busy background, dramatic shadows, thin, skinny, slim")

# the brief: an original heavyweight - a disgraced grand champion of festival sumo turned prize fighter, twin rotary cannons
BRIEF = {
    "gantetsu": (
        "Gantetsu, a gigantic, jovial heavyweight brawler in his late thirties with a champion sumo wrestler's physique: "
        "a towering, massive frame about two and a half metres tall, enormous rounded shoulders, a huge barrel chest and a "
        "big powerful belly, very thick muscular arms and tree-trunk legs, a wide planted stance. Warm tan skin covered in "
        "flowing jade-green tattoos of crashing ocean waves and curling flames across both arms, shoulders and chest. "
        "A big confident laughing grin, a short thick black beard, bushy eyebrows, black hair tied up in a tall topknot bound "
        "with a crimson and gold festival headband with trailing tails. He wears an open sleeveless crimson festival happi "
        "coat with gold wave trim and a jade crest on the back, a thick braided white sacred-rope belt with zigzag white "
        "paper streamers over layered black-and-gold armoured waist plates, loose charcoal trousers wrapped with white cloth "
        "at the shins, and heavy armoured black lacquer sandal-boots with gold soles. Armoured jade and gold bracers on "
        "both forearms, a thick ammo belt of glowing ember rounds slung across his chest.",
        # the weapons (concept stage only)
        "He carries TWO huge rotary chainguns, one gripped in each fist and held low at his hips: each is a chunky "
        "six-barrel rotary cannon built like a black lacquered festival drum with gold rivets, glowing ember-orange heat "
        "vents and a round drum magazine; the left one has jade flame markings, the right one gold firework markings.",
    ),
}

CONCEPT_POSE = ("Draw exactly one character, full body from the top of the head to the soles of the feet with some margin, "
                "facing the camera, front three-quarter view, standing in a confident wide heroic stance with both chainguns "
                "held low and ready. Plain light grey studio background, soft even lighting, no shadows on the background, "
                "no text, no other views.")
MODEL_EDIT = ("Re-pose this exact same character for a 3D model sheet: keep his face, hair, tattoos, costume, colours and "
              "his massive build exactly the same (keep the ammo bandolier across his chest), but REMOVE BOTH GUNS "
              "completely - his hands are now EMPTY, relaxed half-closed fists. Full body from the top of the head to the soles of the feet with some "
              "margin, facing the camera, front view, standing straight in a relaxed A-pose: arms held away from the body "
              "at about 35 degrees so there is clear space between the arms and the torso, legs slightly apart, feet flat. "
              "Plain light grey studio background, soft even lighting, no shadows on the background, no text, no other views.")


# stage "apose": a second pass on a gun-less sheet whose arms still hug the body - turn him square to the camera and
# lift the arms clear of the torso (the auto-rigger needs daylight between a big belly and the arms)
APOSE_EDIT = ("Turn this exact same character to face the camera DIRECTLY - a straight-on front view, shoulders square to the "
              "camera, not three-quarter. Raise both arms out to the sides into a wide A-pose, about 45 degrees down from "
              "horizontal, elbows straight, empty relaxed fists, with a wide gap of background visible between each arm and "
              "the torso and belly. Legs straight and apart, feet flat and pointing forward. Keep his face, grin, hair, "
              "tattoos, costume, colours, bandolier and massive build exactly the same. Full body from the top of the topknot "
              "to the soles of the sandals with margin. Plain light grey studio background, soft even lighting, no text.")


def prompt(hero: str, stage: str) -> str:
    body, arms = BRIEF[hero]
    if stage == "concept": return STYLE + FACE + MATS + body + " " + arms + " " + CONCEPT_POSE
    if stage == "apose": return APOSE_EDIT + " " + STYLE + MATS + body
    return MODEL_EDIT + " " + STYLE + FACE + MATS + body


vol = modal.Volume.from_name("zu-hf", create_if_missing=True)
image = (modal.Image.debian_slim(python_version="3.11")
         .apt_install("git", "libgl1", "libglib2.0-0")
         .pip_install("torch==2.7.1", "torchvision==0.22.1", index_url="https://download.pytorch.org/whl/cu126")
         .pip_install("git+https://github.com/huggingface/diffusers", "transformers>=4.51", "accelerate", "safetensors",
                      "huggingface_hub[hf_transfer]", "sentencepiece", "pillow", "peft")
         .env({"HF_HOME": "/hf", "HF_HUB_ENABLE_HF_TRANSFER": "1"}))
app = modal.App("zu-concept", image=image)


@app.cls(gpu="A100-80GB", timeout=3600, volumes={"/hf": vol}, scaledown_window=120)
class Editor:
    @modal.enter()
    def load(self):
        import torch
        from diffusers import QwenImageEditPlusPipeline
        self.pipe = QwenImageEditPlusPipeline.from_pretrained(MODEL, torch_dtype=torch.bfloat16).to("cuda")
        self.pipe.set_progress_bar_config(disable=True)

    @modal.method()
    def edit(self, hero: str, stage: str, png: bytes, seed: int, steps: int = 40, w: int = 928, h: int = 1232) -> bytes:
        import torch
        from PIL import Image
        img = Image.open(io.BytesIO(png)).convert("RGB")
        out = self.pipe(image=[img], prompt=prompt(hero, stage), negative_prompt=NEG, true_cfg_scale=4.0, guidance_scale=1.0,
                        num_inference_steps=steps, width=w, height=h, generator=torch.manual_seed(seed)).images[0]
        b = io.BytesIO(); out.save(b, "PNG"); return b.getvalue()


def blank(w=928, h=1232) -> bytes:
    from PIL import Image
    b = io.BytesIO(); Image.new("RGB", (w, h), (178, 180, 184)).save(b, "PNG"); return b.getvalue()


@app.local_entrypoint()
def main(hero: str = "gantetsu", stage: str = "concept", src: str = "", seeds: int = 4, steps: int = 40, seed0: int = 1000):
    os.makedirs(OUT, exist_ok=True)
    png = open(os.path.join(ROOT, src) if not os.path.isabs(src) else src, "rb").read() if src else blank()
    jobs = [(hero, stage, png, seed0 + s, steps) for s in range(seeds)]
    for (_, _, _, seed, _), res in zip(jobs, Editor().edit.starmap(jobs, return_exceptions=True)):
        if isinstance(res, Exception): print("FAILED", seed, repr(res)[:300]); continue
        p = os.path.join(OUT, f"{hero}_{stage}_{seed}.png"); open(p, "wb").write(res); print("saved", p, flush=True)
