"""Hero concept restyle on Modal: Qwen-Image-Edit-2511 (Apache-2.0) re-renders each hero's model concept in a polished
stylized hero-shooter look (appealing proportions, clean bevelled shapes, hand-painted PBR colour blocks, expressive
faces) while keeping the character - identity, outfit, colours, weapon - and the A-pose the 3D + rigging stages need.

    modal run assetgen/modal_restyle.py --heroes kaien --seeds 2          # one hero, 2 candidates
    modal run assetgen/modal_restyle.py --seeds 3                         # every hero, fanned out over containers

In:  work/ow/in/<hero>.png  (prepared by --prep from the picked concept)
Out: work/ow/concept/<hero>_<seed>.png
Weights live in the "zu-hf" Modal volume (downloaded once, ~58 GB).
"""
import io, os
import modal

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
IN = os.path.join(ROOT, "work", "ow", "in")
OUT = os.path.join(ROOT, "work", "ow", "concept")
MODEL = "Qwen/Qwen-Image-Edit-2511"

# the concept each current model was built from (assetgen/out/.../img)
PICKS = {
    "tenkai": "models2/img/model_tenkai_2.png", "gorgoth": "models2/img/model_gorgoth_0.png",
    "mirei": "mireire/img/model_mireiv4_5.png", "kaien": "models2/img/model_kaien_1.png",
    "raijin": "models2/img/model_raijin_3.png", "yuzu": "models2/img/model_yuzu_3.png",
    "nocturne": "models2/img/model_nocturne_1.png", "hex": "models2/img/model_hex_0.png",
    "kagemaru": "models2/img/model_kagemaru_3.png", "enra": "models2/img/model_enra_3.png",
    "haruto": "models2/img/model_haruto_0.png",
}

STYLE = ("Re-render this character as a finished 3D character model render in a polished, stylized AAA team hero-shooter "
         "art style: ADULT heroic proportions about seven and a half heads tall - long legs, an athletic build, broad shoulders "
         "for men, a graceful athletic figure for women, a normal-sized head (never chibi, never childlike), slightly "
         "oversized hands and boots for readability, a confident heroic stance and a bold, instantly readable silhouette; "
         "rich but clean costume design with layered armour and cloth pieces; clean sculpted forms with soft rounded bevelled edges; hand-painted PBR "
         "textures made of large clean colour blocks with subtle painted gradients (lighter at the top, a little darker "
         "toward the feet) and crisp painted edge highlights; no noise, no grunge, no tiny clutter. ")
FACE = ("The face is an attractive adult face, stylized and expressive: defined cheekbones and jaw, smooth skin with a warm "
        "subsurface glow, clear eyes with bright irises and catchlights (not oversized), a defined nose and mouth, clean eyebrows. Hair "
        "is sculpted into chunky clean clumps with a soft sheen. ")
MATS = "Materials read clearly: matte cloth, satin leather, polished metal with soft studio reflections, glowing emissive accents. "
POSE = ("Show exactly one character, full body from the top of the head to the soles of the feet with some margin, facing "
        "the camera, front view, standing straight in a relaxed A-pose: arms held away from the body at about 30 degrees, "
        "hands open or holding the weapon pointing down, legs slightly apart. Plain light grey studio background, soft even "
        "lighting, no shadows on the background, no text, no other views.")
NEG = ("chibi, child, kid, toddler, big head, super deformed, cartoon baby face, anime, cel shading, flat 2D illustration, photorealistic, realistic skin pores, noise, grunge, dirt, blurry, low "
       "detail, multiple views, turnaround sheet, character sheet, text, watermark, cropped, cut off feet, extra limbs, "
       "extra fingers, deformed hands, busy background, dramatic shadows")

HERO = {
    "tenkai": ("Keep this as a heroic giant piloted super-robot: white, gold and sky-blue armour plates, a glowing cyan reactor "
               "core in the chest, big rounded shoulder pauldrons, chunky armoured hands and feet, a noble visor face-plate. "
               "Hard-surface mech, no human face.", False),
    "gorgoth": ("Keep this as a menacing heavy war mech: gunmetal black armour with crimson panels, spiked plates, a glowing red "
                "visor slit, massive clawed hands, heavy stomping legs. Hard-surface mech, no human face.", False),
    "mirei": ("Keep her as an angelic combat medic: short silver bob hair, bright blue eyes, a sleek pearl-white armoured bodysuit "
              "with gold trims and a glowing blue star emblem on the chest, large mechanical angel wings with crystal-blue and "
              "white feathers spread behind her, a slim white feather-blade in each hand hanging down.", True),
    "kaien": ("Keep him as a warding monk in his late twenties: black hair tied in a topknot, a calm kind expression, a white and indigo robe with "
              "wide sleeves, a brown sash with a golden talisman medallion, prayer beads, loose indigo trousers and straw sandals, "
              "a fan of paper talismans in one hand.", True),
    "raijin": ("Keep him as a cocky lightning swordsman in his early twenties: spiky golden-blond hair, a confident smirk, a navy-blue long coat "
               "with gold lightning-bolt trims, dark trousers and boots, a katana held in his right hand pointing down, a second "
               "sword sheathed at his hip.", True),
    "yuzu": ("Keep her as a cheerful archer in her early twenties: bright orange hair in two round buns, a white and orange armoured bodysuit with "
             "gold trims, orange boots, a large golden recurve bow held in her left hand, a quiver of arrows on her back.", True),
    "nocturne": ("Keep her as a gothic vampire diva queen: long flowing white hair, pale skin, crimson eyes, a silver tiara, a black "
                 "and crimson corset gown with a long skirt, large crimson bat wings spread behind her.", True),
    "hex": ("Keep him as a tall slender puppeteer villain: a black Victorian long coat with purple lining, a white porcelain doll "
            "mask with a long face and dark eye holes, white gloves, puppet strings dangling from his fingers. No visible human "
            "face: the mask covers it.", False),
    "kagemaru": ("Keep him as a shinobi assassin: black ninja gear with a purple sash, a black hood with wolf ears, a white skull "
                 "half-mask, dark spiked armour plates, a kunai dagger in each hand. The mask covers the lower face.", False),
    "enra": ("Keep him as a hulking oni demon warrior: a wild white mane, curved ivory horns, a fierce oni helmet-face, black and "
             "crimson spiked armour with silver trims, massive clawed gauntlet fists glowing with ember light, no sword.", False),
    "haruto": ("Keep him as a hot-blooded young adult mech pilot: spiky brown hair, a determined grin, a red, white and black "
               "armoured pilot flight suit with fin-shaped shoulder guards, a compact yellow sun-blaster pistol in his right hand.", True),
}


def prompt(hero):
    txt, face = HERO[hero]
    return STYLE + (FACE if face else "") + MATS + txt + " " + POSE


vol = modal.Volume.from_name("zu-hf", create_if_missing=True)
image = (modal.Image.debian_slim(python_version="3.11")
         .apt_install("git", "libgl1", "libglib2.0-0")
         .pip_install("torch==2.7.1", "torchvision==0.22.1", index_url="https://download.pytorch.org/whl/cu126")
         .pip_install("git+https://github.com/huggingface/diffusers", "transformers>=4.51", "accelerate", "safetensors",
                      "huggingface_hub[hf_transfer]", "sentencepiece", "pillow", "peft")
         .env({"HF_HOME": "/hf", "HF_HUB_ENABLE_HF_TRANSFER": "1"}))
app = modal.App("zu-restyle", image=image)


@app.cls(gpu="A100-80GB", timeout=3600, volumes={"/hf": vol}, scaledown_window=120)
class Editor:
    @modal.enter()
    def load(self):
        import torch
        from diffusers import QwenImageEditPlusPipeline
        self.pipe = QwenImageEditPlusPipeline.from_pretrained(MODEL, torch_dtype=torch.bfloat16).to("cuda")
        self.pipe.set_progress_bar_config(disable=True)
        vol.commit()

    @modal.method()
    def edit(self, hero: str, png: bytes, seed: int, steps: int = 40, w: int = 928, h: int = 1232) -> bytes:
        import torch
        from PIL import Image
        img = Image.open(io.BytesIO(png)).convert("RGB")
        out = self.pipe(image=[img], prompt=prompt(hero), negative_prompt=NEG, true_cfg_scale=4.0, guidance_scale=1.0,
                        num_inference_steps=steps, width=w, height=h, generator=torch.manual_seed(seed)).images[0]
        b = io.BytesIO(); out.save(b, "PNG"); return b.getvalue()


def prep():
    """picked concept -> work/ow/in/<hero>.png, padded to 3:4 on the concept's own background grey"""
    from PIL import Image
    os.makedirs(IN, exist_ok=True)
    for h, rel in PICKS.items():
        im = Image.open(os.path.join(HERE, "out", rel)).convert("RGB")
        W, H = im.size; tw = max(W, int(H * 0.75)); th = int(tw / 0.75)
        bg = im.getpixel((4, 4))
        c = Image.new("RGB", (tw, th), bg); c.paste(im, ((tw - W) // 2, (th - H) // 2))
        c.save(os.path.join(IN, f"{h}.png")); print("prep", h, c.size)


@app.local_entrypoint()
def main(heroes: str = "", seeds: int = 2, steps: int = 40, do_prep: bool = True):
    if do_prep: prep()
    names = [h for h in (heroes.split(",") if heroes else PICKS) if h]
    os.makedirs(OUT, exist_ok=True)
    jobs = [(h, open(os.path.join(IN, f"{h}.png"), "rb").read(), 1000 + s, steps) for h in names for s in range(seeds)]
    for (h, _, seed, _), png in zip(jobs, Editor().edit.starmap(jobs, return_exceptions=True)):
        if isinstance(png, Exception): print("FAILED", h, seed, repr(png)[:300]); continue
        p = os.path.join(OUT, f"{h}_{seed}.png"); open(p, "wb").write(png); print("saved", p)
