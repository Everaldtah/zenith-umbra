"""ZENITH//UMBRA - "The Oath at Dawn": how the Zenith Vanguard came to be (~5 min anime short).

Every shot: a keyframe (anime still, the hero's key art as identity reference through IP-Adapter) animated by an
image-to-video model, plus narration / character lines (Kokoro TTS), a music cue (ACE-Step) and foley.

Structure
  I    The world that sang           - Amatsu, the Sky Shrine, Neo-Kurogane, Hangar Zero, Zenith Academy
  II   The Eclipse                    - the sky breaks; every villain's fall (Nocturne, Kagemaru, Enra, Vorn, Hex)
  III  Five who stood up              - every hero's loss and choice (Haruto, Mirei, Kaien, Raijin, Yuzu)
  IV   The Night of the Academy       - the fight: five rival duels, each won with the counter the hero was made for
  V    The Oath at Dawn + the omen    - the Vanguard is named; the Star-Forger watches
"""

STYLE = ("anime screenshot, modern anime film, cinematic composition, dramatic lighting, detailed background, "
         "masterpiece, best quality, very aesthetic, absurdres")
NEG = ("lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, cropped, worst quality, low quality, "
       "jpeg artifacts, signature, watermark, username, blurry, multiple views, 3d, photo, "
       "simple background, grey background, plain background, white background, character sheet, reference sheet, t-pose")

NARRATOR = "bm_george"
VOICES = {"haruto": "am_michael", "kaien": "bm_lewis", "mirei": "bf_emma", "nocturne": "bf_isabella", "vorn": "am_onyx",
          "raijin": "am_fenrir", "yuzu": "af_heart", "qelvaris": "bm_fable", "enra": "am_onyx", "kagemaru": "am_puck", "hex": "bm_daniel"}

# appearance tags: the text carries identity (the IP-Adapter reference only nudges faces / colours)
CHAR = {
    "mirei": "silver hair, short bob hair, glowing crystal blue mechanical wings, white and light blue armored bodysuit",
    "nocturne": "long silver hair, small black horns, red eyes, crimson and black gothic gown, red bat wings",
    "kaien": "black hair, calm face, white and blue monk robes, gold sash, prayer beads, paper talismans",
    "kagemaru": "white fox mask, black hood, dark ninja outfit, purple sash, kunai",
    "raijin": "spiky blonde hair, blue eyes, navy blue long coat, katana",
    "yuzu": "orange hair, side ponytail, orange scarf, white and gold archer outfit, golden bow",
    "haruto": "teenage boy, messy brown hair, brown eyes, red and white pilot jacket",
    "vorn": "tall stern man, short black hair, scar on face, black and red military uniform",
    "enra": "giant oni demon, curved horns, black and silver armor, red tabard, flaming mane, chained gauntlets",
    "gorgoth": "black and red mecha robot, red mono-eye, horned head, spiked shoulders, drill lance arm",
    "tenkai": "white and gold super robot, cyan chest core, golden sun crest, golden visor",
    "hex": "tall puppeteer, cracked white porcelain mask, black and violet patchwork long coat, glowing violet strings from fingers",
    "qelvaris": "alien scientist, four glowing golden eyes, violet robes, mechanical spider arms",
    "boss_genesis": "colossal gold and black robot, purple glowing core",
}
NOREF = {"haruto", "vorn"}      # key art shows the pilot suit / armour, not the man in the story beats
KEEP = {"s01": 0, "s02": 1, "s06": 0, "s08": 1, "s10": 0, "s11": 1, "s15": 1, "s16": 1, "s17": 0, "s18": 0, "s22": 1, "s24": 0,
        "s31": 0, "s33": 1, "s36": 1, "s37": 0, "s41": 0, "s61": 0, "s62": 1, "s64": 1, "s67": 0, "s68": 1}

MUSIC = {
    "calm": "orchestral anime soundtrack, gentle piano and strings, choir pads, hopeful, 70 bpm, cinematic",
    "dread": "dark orchestral anime soundtrack, low drones, taiko drums, dissonant strings, tension rising, 80 bpm",
    "grief": "sad anime soundtrack, solo piano, soft strings, melancholic, 65 bpm",
    "rise": "epic anime soundtrack, begins with a sad solo piano, then rising strings and choir build into driving drums, determined, heroic build-up, 120 bpm",
    "battle": "epic anime battle music, fast taiko and full orchestra, electric guitar riffs, choir, intense, 165 bpm",
    "dawn": "triumphant orchestral anime finale, brass and choir, warm, heroic theme, 90 bpm",
    "omen": "ominous sci-fi anime soundtrack, deep synth bass, distant choir, slow, 60 bpm",
}

# (id, keyframe prompt, identity ref (key art / map image), motion prompt, seconds)
BEATS = [
    # ================================================================ I. The world that sang
    {"music": "calm", "say": [("n", "Before the Eclipse, the sky had a voice.")], "shots": [
        ("s01", "floating sky islands above a sea of clouds at sunrise, ancient shrines and bridges, birds, golden light", "map_amatsu", "slow aerial drift over floating islands, clouds flowing, birds flying", 5)]},
    {"say": [("n", "Above the clouds of Amatsu, the Star Choir sang the heavens into balance, and the stars listened.")], "shots": [
        ("s02", "a choir of women in white and gold robes singing on a floating shrine at night, glowing constellations forming in the sky above them", None, "the singers sway, constellation lines of light draw themselves across the night sky", 5),
        ("s03", "1girl, young apprentice singer with silver hair and a white dress, singing with eyes closed, starlight particles around her, night sky", "mirei", "her hair drifts, starlight particles swirl upward, gentle camera push-in", 4)]},
    {"say": [("n", "Her teacher, the Choir's prima voice, promised the girl that their song would never end.")], "shots": [
        ("s04", "1girl, elegant woman singer in a white and gold gown with long dark hair, smiling gently, holding the hand of a young silver-haired girl, starry sky", "nocturne", "the woman smiles and squeezes the girl's hand, stars twinkle", 4)]},
    {"say": [("n", "On the highest island, the monk Kaien had kept the gate of the Sky Shrine alone for nine years,"),
             ("n", "guarding a sacred tree that held the seals of the world.")], "shots": [
        ("s05", "1boy, calm young monk in white and gold robes standing at a red torii gate above the clouds, prayer beads, paper talismans", "kaien", "his robes and talismans flutter in the wind, clouds drift below", 4),
        ("s06", "an enormous glowing sacred tree on a shrine island, sacred ropes and paper seals hanging from its branches, spirit lights", None, "leaves glow and drift, paper seals sway, soft light pulses", 4)]},
    {"say": [("n", "The shrine's orphan, Kagemaru, was raised beside him by the same master, and passed over for the guardian's seal.")], "shots": [
        ("s07", "1boy, a lonely orphan boy with a wolf mask pushed up on his head, watching jealously from the shadows as an old master hands a glowing seal to another boy", "kagemaru", "he clenches his fist, eyes narrow, shadows creep toward him", 4)]},
    {"say": [("n", "Far below, in the neon rain of Neo-Kurogane, Raijin was the undefeated champion of the underground duels."),
             ("n", "His mother's katana had been struck by lightning on the night of her funeral.")], "shots": [
        ("s08", "a neon cyberpunk japanese city at night in heavy rain, glowing signs, crowded streets, reflections on wet asphalt", "map_kurogane", "rain pours, neon signs flicker, camera glides down the street", 4),
        ("s09", "1boy, young swordsman with a katana in an underground dueling ring, crowd cheering, rain dripping through a grate, neon light", "raijin", "he draws the katana in a flash, sparks, crowd roars", 4),
        ("s10", "a huge ancient stone deep under a city, carved with glowing red seal runes, chains wrapped around it, something breathing in the dark", None, "the red runes pulse slowly like a heartbeat, dust falls", 4)]},
    {"say": [("n", "In Hangar Zero, a mechanic's son named Haruto Daimon swept the floor beneath two unfinished giants."),
             ("vorn", "Never hold back, Haruto. Not in the cockpit. Not in life.")], "shots": [
        ("s11", "two gigantic unfinished mecha robots side by side in a huge hangar, scaffolding, sparks from welders, one white and gold, one black and red", "map_hangar", "sparks rain from welders, work lights sweep, slow tilt up the giant robots", 5),
        ("s12", "1boy, teenage mechanic with brown hair and a wrench, looking up in awe at a giant white and gold robot", "haruto", "he looks up, smiling, hangar light glints in his eyes", 4),
        ("s13", "1man, stern tall military instructor with a scarred face and dark uniform, hand on a teenage boy's shoulder, hangar background", "vorn", "the instructor turns his head and speaks, the boy nods", 4)]},
    {"say": [("n", "And at Zenith Academy, Yuzu could split a falling leaf at three hundred metres."),
             ("yuzu", "I'll always be the better shot, little brother. Always.")], "shots": [
        ("s14", "1girl, young archer girl with short hair drawing a glowing bow on a training field at sunset, a boy with a scarf beside her laughing", "yuzu", "she draws and releases, the arrow streaks away, the boy laughs", 4),
        ("s15", "an arrow of light splitting a falling autumn leaf in half in mid air, sunset, bokeh", None, "slow motion, the arrow slices the leaf, halves spin apart", 3)]},
    # ================================================================ II. The Eclipse - how the villains fell
    {"music": "dread", "say": [("n", "Then, on the longest day of the year, the sun went black.")], "shots": [
        ("s16", "a black eclipse swallowing the sun over a city, a burning corona, the sky turning dark red, people looking up in fear", None, "the moon slides across the sun, light drains from the sky, corona flares", 5),
        ("s17", "the sky cracking open like glass, a violet rift tearing across the clouds, lightning, debris floating upward", "sky_rift", "the crack spreads across the sky with violet lightning, debris lifts", 4)]},
    {"say": [("n", "The Eclipse tore the world open. And everyone with a crack in their heart heard it calling.")], "shots": [
        ("s18", "dark silhouettes standing before a violet rift in the sky, red glowing eyes, ominous wind", None, "violet mist swirls, the silhouettes' eyes ignite red", 4)]},
    {"say": [("n", "The Choir's prima voice knelt beneath a crimson moon, and traded her light for eternal youth."),
             ("nocturne", "Forgive me, little star. Some songs must end.")], "shots": [
        ("s19", "1girl, elegant woman in a crimson gothic gown kneeling in a ruined cathedral under a huge blood red moon, bat wings unfurling from her back", "nocturne", "crimson wings unfold, the blood moon glows brighter, rose petals swirl", 5),
        ("s20", "1girl, young silver-haired girl crying alone on a dark shrine island at night, the stars going out one by one", "mirei", "tears fall, the stars above fade out one by one", 4)]},
    {"say": [("kagemaru", "Seals mean nothing. I'll prove it."),
             ("n", "Kagemaru set the sacred tree ablaze.")], "shots": [
        ("s21", "1boy, young man in a wolf mask holding a burning torch in front of an enormous sacred tree, shadows, embers", "kagemaru", "he raises the torch, flames leap into the branches", 4),
        ("s22", "an enormous sacred tree engulfed in flames at night, paper seals burning and flying away as embers", None, "fire roars up the trunk, burning seals scatter into the sky", 4),
        ("s23", "1boy, young monk reaching out in horror toward a burning tree, firelight on his face, talismans scattering", "kaien", "he runs forward, hand outstretched, sparks fly past", 4)]},
    {"say": [("n", "With the seals gone, the foundation stone of Neo-Kurogane cracked, and the oni Enra walked out of a thousand years of darkness,"),
             ("enra", "Where is the blade that cut me?")], "shots": [
        ("s24", "a giant ancient stone cracking apart, red light bursting through the cracks, a huge crater opening in a city street", None, "the stone splits, red light erupts, the street collapses", 4),
        ("s25", "a towering horned oni demon with a flaming mane and chained gauntlets rising from a burning crater in a neon city", "enra", "the oni rises and roars, flames and embers swirl, neon signs explode", 5)]},
    {"say": [("n", "He burned the district in a single night, searching for the one blade that had ever wounded him."),
             ("n", "He found it in a boy's hands, at a funeral.")], "shots": [
        ("s26", "1boy, young swordsman kneeling in the ashes of a burned neon district in the rain, holding a scorched katana, an oni silhouette in the flames behind him", "raijin", "rain falls on the ashes, he tightens his grip on the blade", 5)]},
    {"say": [("n", "In Hangar Zero, the man Haruto trusted most climbed into the twin frame. Warlord Vorn stole Gorgoth,"),
             ("n", "and tore Tenkai-Oh's fist off on his way out.")], "shots": [
        ("s27", "a black and red giant mecha robot with a single red mono-eye igniting in a dark hangar, sparks, warning lights", "gorgoth", "the red eye ignites, the robot's head turns, warning lights spin", 4),
        ("s28", "a black mecha robot ripping the giant fist off a white and gold robot in a hangar, sparks exploding, debris flying", "gorgoth", "the black robot wrenches the fist free, a shower of sparks", 4),
        ("s29", "1boy, teenage mechanic thrown to the floor by an explosion in a hangar, reaching toward a damaged giant robot", "haruto", "he is knocked back, debris falls, he looks up desperate", 4)]},
    {"say": [("n", "And in the rift, a porcelain-masked collector was waiting for lost students."),
             ("hex", "Such a pretty scarf. You'll make a perfect doll.")], "shots": [
        ("s30", "a sinister tall puppeteer in a cracked white porcelain mask and patchwork violet coat, glowing violet strings from his fingers, a violet void dimension", "hex", "the violet strings twitch and tighten, the mask tilts", 4),
        ("s31", "a boy's scarf caught on violet strings floating in a dark void, drifting away", None, "the scarf drifts slowly into the dark, strings pull it away", 4)]},
    {"say": [("n", "Together they became the Umbra Syndicate.")], "shots": [
        ("s32", "villain group shot: a crimson vampire diva, a wolf-masked ninja, a flaming oni, a black mecha robot and a porcelain-masked puppeteer standing before a violet rift, dramatic low angle", "gorgoth", "slow push-in, violet lightning behind them, capes and flames billow", 5)]},
    # ================================================================ III. Five who stood up
    {"music": "rise", "say": [("n", "In one night, five strangers lost everything the Eclipse could take.")], "shots": [
        ("s33", "a ruined city at dawn under a dark sky, smoke rising, a lone figure standing on a hill", None, "smoke drifts, ash falls like snow, slow push-in", 5)]},
    {"say": [("n", "Haruto climbed into a frame with one fist, and a reactor no one had ever woken."),
                               ("haruto", "Come on, Tenkai-Oh. Wake up!")], "shots": [
        ("s34", "1boy, teenage pilot gripping the controls inside a glowing mecha cockpit, determined, golden light on his face", "haruto", "he shouts, the cockpit screens light up gold", 4),
        ("s35", "a giant white and gold mecha robot's visor igniting with golden sunlight, a sun reactor glowing in its chest, dark hangar", "tenkai", "the visor ignites, the chest reactor blazes, steam vents", 4)]},
    {"say": [("n", "Mirei stitched new wings from the constellations her teacher had taught her, and flew after the song she had lost.")], "shots": [
        ("s36", "1girl, young woman with silver hair, glowing crystal star wings forming on her back, night sky full of stars", "mirei", "star-lines stitch themselves into wings, the wings spread wide", 4),
        ("s37", "1girl, winged heroine with silver hair flying up through clouds toward the stars, trail of starlight", "mirei", "she soars upward through the clouds, starlight trails behind her", 4)]},
    {"say": [("n", "Kaien left the mountain for the first time in nine years, with ten thousand talismans, and one name.")], "shots": [
        ("s38", "1boy, young monk walking down endless stone steps from a floating shrine, thousands of paper talismans circling him", "kaien", "he walks forward, talismans orbit him like a storm", 4)]},
    {"say": [("n", "Raijin raised his mother's katana to the storm. Lightning struck it twice.")], "shots": [
        ("s39", "1boy, young swordsman raising a katana to a storm sky, blue lightning striking the blade, rain", "raijin", "lightning strikes the raised blade, blue electricity crackles down his arm", 4)]},
    {"say": [("n", "And Yuzu kept drawing her bow until the string cut her fingers, waiting for a target worth the shot.")], "shots": [
        ("s40", "1girl, archer girl drawing a glowing bow alone at night, determined tearful eyes, a scarf tied around her wrist", "yuzu", "she draws the bow, her hand trembles, then steadies", 4)]},
    # ================================================================ IV. The Night of the Academy - the fight
    {"music": "battle", "say": [("n", "They did not find each other. The Eclipse found them, all at once, the night the Syndicate came for Zenith Academy.")], "shots": [
        ("s41", "a futuristic academy campus under attack at night, violet portals in the sky, explosions, dark figures landing", "map_training", "explosions bloom, portals spin, debris flies", 4),
        ("s42", "villains landing in a burning academy courtyard, a black mecha robot, a flaming oni, a crimson winged diva in the sky, students fleeing", "enra", "the villains land hard, shockwave of dust and fire, students run", 4)]},
    {"say": [("n", "One by one, five strangers stepped into the fire.")], "shots": [
        ("s43", "a giant white and gold mecha robot crashing down from the sky in front of fleeing students, raising a huge golden energy shield", "tenkai", "the robot slams down, cracks the ground, raises the golden shield", 4),
        ("s44", "1girl, winged silver-haired heroine descending from the night sky in a pillar of starlight", "mirei", "she descends, wings spreading, starlight bursting outward", 3),
        ("s45", "1boy, monk landing on a rooftop surrounded by a storm of glowing talismans", "kaien", "he lands, talismans swirl into a ring around him", 3),
        ("s46", "1boy, swordsman appearing in a blue lightning flash, katana drawn, rain", "raijin", "lightning flash, he appears mid-stride, blade gleaming", 3),
        ("s47", "1girl, archer girl on a rooftop drawing a blazing bow, wind in her hair", "yuzu", "she draws the bow, the arrow ignites with light", 3)]},
    # -- duel 1: Tenkai-Oh vs Gorgoth
    {"say": [("vorn", "You still hold back, boy."), ("haruto", "Not anymore!")], "shots": [
        ("s48", "a black and red mecha robot charging with a drill lance, abyss energy trail, ground tearing apart", "gorgoth", "the black robot charges at full speed toward camera, debris explodes behind it", 3),
        ("s49", "a white and gold mecha robot charging forward on rocket thrusters with a giant hammer, golden light trail", "tenkai", "the white robot rockets forward, hammer raised, thrusters blazing", 3),
        ("s50", "two giant mecha robots colliding head-on, white and gold versus black and red, a massive shockwave of sparks and light", "tenkai", "impact, shockwave ring bursts outward, the black robot staggers back stunned", 4)]},
    # -- duel 2: Mirei vs Nocturne
    {"say": [("nocturne", "Still singing my lullaby, little star?"), ("mirei", "No. I'm singing mine.")], "shots": [
        ("s51", "1girl, crimson vampire diva with bat wings singing a red sonic wave in the night sky", "nocturne", "a red sound wave ripples outward from her voice", 3),
        ("s52", "1girl, silver-haired winged heroine shielded by glowing constellation lines linking her to allies below, the red wave shattering against them", "mirei", "the constellation links flare, the red wave breaks apart into sparks", 4)]},
    # -- duel 3: Kaien vs Kagemaru
    {"say": [("kagemaru", "You can't catch a shadow, brother."), ("kaien", "I don't need to catch it. Only to seal it.")], "shots": [
        ("s53", "1boy, wolf-masked ninja dissolving into shadow smoke, kunai flying, night rooftop", "kagemaru", "he vanishes into smoke, kunai whirl through the air", 3),
        ("s54", "a huge glowing golden seal circle igniting on a rooftop, trapping a wolf-masked ninja in its light, talismans spinning", "kaien", "the seal circle blazes to life, the shadow is torn away, the ninja is pinned", 4)]},
    # -- duel 4: Raijin vs Enra
    {"say": [("enra", "That blade is mine!"), ("raijin", "Then come and take it.")], "shots": [
        ("s55", "a towering horned oni swinging a flaming chained gauntlet down at a small swordsman, fire everywhere", "enra", "the burning fist comes down, flames roar", 3),
        ("s56", "1boy, swordsman parrying a giant flaming fist with a katana, a huge burst of blue lightning, sparks", "raijin", "blade meets fist, blue lightning explodes, the oni recoils stunned", 4)]},
    # -- duel 5: Yuzu vs Hex
    {"say": [("hex", "Come, little archer. Your brother is waiting."), ("yuzu", "Let him go.")], "shots": [
        ("s57", "a porcelain-masked puppeteer pulling violet strings attached to a boy with a scarf, dark doll puppets around him", "hex", "the strings pull taut, the puppets twitch toward camera", 3),
        ("s58", "1girl, archer releasing a blazing arrow that cuts through violet puppet strings, sparks of light, a scarf falling free", "yuzu", "the arrow slices the strings in slow motion, light bursts, the scarf floats free", 4)]},
    # -- finale: together
    {"say": [("n", "A wall of dawnlight. A song of stars. A storm of seals. A blade of lightning. An arrow that does not miss.")], "shots": [
        ("s59", "five heroes attacking together, golden shield, starlight, talismans, lightning and a light arrow converging on a violet rift, epic", "tenkai", "all five attacks converge, a blinding burst of light", 4),
        ("s60", "a giant white and gold robot's glowing golden hammer smashing down, an explosion of golden light hurling villains back into a violet rift", "tenkai", "the hammer comes down, a golden shockwave blasts everything back", 4),
        ("s61", "a violet rift in the sky collapsing and closing, villains being pulled back through it, light pouring out", "sky_rift", "the rift implodes and seals shut in a flash of light", 4)]},
    # ================================================================ V. The Oath at Dawn
    {"music": "dawn", "say": [("n", "When the sun rose, it rose on five strangers standing in the ruins.")], "shots": [
        ("s62", "the sun rising over a ruined academy, golden light breaking through smoke, silhouettes of four heroes and a giant robot on a hill", None, "sunlight spreads across the ruins, smoke clears, lens flare", 5),
        ("s63", "1boy, young monk and a silver-haired winged girl and a swordsman and an archer girl standing together at dawn, battered but smiling", "kaien", "the wind blows through their hair and clothes, they look toward the sunrise", 4)]},
    {"say": [("kaien", "Then we stand together."), ("haruto", "Never again. Not one more city.")], "shots": [
        ("s64", "five hands stacked together in the middle of a circle at dawn, a giant robot's hand beside them, golden light", None, "the hands press together, golden light flares", 4)]},
    {"say": [("n", "That morning, they swore an oath. They called themselves the Zenith Vanguard.")], "shots": [
        ("s65", "heroic team shot of four anime heroes and a giant white and gold robot standing on a hill at sunrise, banner flying, epic", "tenkai", "slow heroic push-in, banner flaps, sunlight blazes behind them", 5)]},
    {"music": "omen", "say": [("n", "But far above the world, beyond the black sun, someone was watching."),
                              ("qelvaris", "Five little oath-keepers. How delightful.")], "shots": [
        ("s66", "1man, alien scientist with four glowing golden eyes and mechanical spider arms, in a violet laboratory full of giant robot schematics, space station", "qelvaris", "his four eyes glow, mechanical arms move over holographic blueprints", 5),
        ("s67", "an enormous colossus robot being built in orbit above the earth, construction drones swarming, black sun behind it", "boss_genesis", "slow pull back revealing the colossal robot in orbit", 5)]},
    {"say": [], "title": "ZENITH//UMBRA", "shots": [
        ("s68", "a black eclipse sun with a golden dawn breaking on one side, deep space, epic title background", None, "the golden light slowly spreads across the eclipse", 6)]},
]


def shots():
    for bi, b in enumerate(BEATS):
        for s in b["shots"]:
            yield bi, dict(zip(("id", "prompt", "ref", "motion", "secs"), s))



# ---------------------------------------------------------------- keyframes for the lore cinematic
# (the screenplay above is inlined by cinematic/prepare.py). Animagine XL 3.1 + IP-Adapter Plus: the hero's key art
# from the live site is the identity reference, the prompt sets the new composition. 2 candidates per shot.
import json, os, time, threading, traceback, urllib.request, io, subprocess, sys

TOPIC = os.environ.get("NTFY_TOPIC", "zu-cinekey")
SITE = "https://zenith-umbra.vercel.app/"
OUT = "/kaggle/working/key"; os.makedirs(OUT, exist_ok=True)
ONLY = [x for x in os.environ.get("ONLY", "").split(",") if x]
N = int(os.environ.get("CANDIDATES", "2"))


def publish(phase, **extra):
    print("PHASE", phase, extra, flush=True)
    try:
        body = json.dumps({"topic": TOPIC, "message": json.dumps({"phase": phase, **extra})[:3800]}).encode()
        urllib.request.urlopen(urllib.request.Request("https://ntfy.sh", data=body, headers={"Content-Type": "application/json"}), timeout=15).read()
    except Exception as e:
        print("ntfy failed", e)


publish("boot")
subprocess.run(f"{sys.executable} -m pip install -q -U diffusers transformers accelerate", shell=True)
import torch
from PIL import Image
from diffusers import StableDiffusionXLPipeline, AutoencoderKL, EulerAncestralDiscreteScheduler
from transformers import CLIPVisionModelWithProjection


def ref_image(ref):
    if not ref: return None
    path = f"img/key_{ref}.webp" if not ref.startswith(("map_", "sky_")) else (f"img/{ref}.webp" if ref.startswith("map_") else "env/sky_rift.webp")
    try:
        data = urllib.request.urlopen(SITE + path, timeout=30).read()
        im = Image.open(io.BytesIO(data)).convert("RGB")
        # characters: head and shoulders only, so the reference lends a face and colours but not its pose / backdrop
        if not ref.startswith(("map_", "sky_")): im = im.crop((int(im.width * 0.15), 0, int(im.width * 0.85), int(im.height * 0.5)))
        return im
    except Exception as e:
        publish("ref-missing", ref=ref, err=str(e)[:200]); return None


jobs = [(bi, s) for bi, s in shots() if not ONLY or s["id"] in ONLY]
refs = {}
for _, s in jobs:
    if s["ref"] and s["ref"] not in refs: refs[s["ref"]] = ref_image(s["ref"])
publish("inputs", shots=len(jobs), refs={k: v is not None for k, v in refs.items()})
LOCK = threading.Lock()
done = []


def worker(dev, items):
    try:
        with LOCK:
            enc = CLIPVisionModelWithProjection.from_pretrained("h94/IP-Adapter", subfolder="models/image_encoder", torch_dtype=torch.float16)
            vae = AutoencoderKL.from_pretrained("madebyollin/sdxl-vae-fp16-fix", torch_dtype=torch.float16)
            pipe = StableDiffusionXLPipeline.from_pretrained("cagliostrolab/animagine-xl-3.1", vae=vae, image_encoder=enc, torch_dtype=torch.float16)
            pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(pipe.scheduler.config)
            pipe.load_ip_adapter("h94/IP-Adapter", subfolder="sdxl_models", weight_name="ip-adapter-plus_sdxl_vit-h.safetensors")
            pipe.to(f"cuda:{dev}")
        blank = Image.new("RGB", (224, 224), (128, 128, 128))
        for bi, s in items:
            ref = refs.get(s["ref"]) if s["ref"] else None
            character = bool(s["ref"]) and not s["ref"].startswith(("map_", "sky_"))
            if character and s["ref"] in NOREF: ref = None
            tags = CHAR.get(s["ref"], "") if character else ""
            # characters: strong identity; locations: a light touch (palette / architecture) so the prompt leads
            pipe.set_ip_adapter_scale(0.3 if character and ref is not None else 0.25 if ref is not None else 0.0)
            for k in range(N):
                g = torch.Generator(f"cuda:{dev}").manual_seed(1000 + k * 77 + bi)
                prompt = f"{s['prompt']}, {tags}, detailed scenery background, {STYLE}" if tags else f"{s['prompt']}, {STYLE}"
                img = pipe(prompt=prompt, negative_prompt=NEG, ip_adapter_image=ref or blank, width=1344, height=768,
                           num_inference_steps=28, guidance_scale=6.5, generator=g).images[0]
                img.save(f"{OUT}/{s['id']}_{k}.png")
            done.append(s["id"])
            publish("progress", id=s["id"], done=len(done), total=len(jobs))
    except Exception:
        publish("error", dev=dev, trace=traceback.format_exc()[-1500:])


t0 = time.time()
th = [threading.Thread(target=worker, args=(g, jobs[g::2])) for g in range(2)]
for x in th: x.start()
for x in th: x.join()
publish("done", n=len(done), minutes=round((time.time() - t0) / 60, 1))
