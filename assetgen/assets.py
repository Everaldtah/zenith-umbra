"""ZENITH//UMBRA asset catalogue: every image the SDXL job renders.

kinds:
  model   -> 3D-ready full-body render on white (A-pose for characters) - feeds TRELLIS
  keyart  -> anime key-visual illustration (menu / website / portraits)
  map     -> wide environment concept painting (loading screens, website, map art reference)
  sky     -> ultra-wide panorama backdrop
  tex     -> seamless tileable material
  prop    -> single environment prop on white - feeds TRELLIS
"""

MODEL_STYLE = ("stylized 3D anime hero shooter game character render, cel-shaded PBR materials, "
               "full body shot from head to feet, entire figure visible with empty space around, one character only, "
               "standing straight in a neutral A-pose with arms held slightly away from the body and legs slightly apart, "
               "front view, facing the camera, plain pure white background, soft even studio lighting, sharp focus, no text")
MECH_STYLE = ("highly detailed 3D anime super robot mecha game model render, full body from head to feet, entire robot visible with empty space around, "
              "one robot only, standing straight in a neutral A-pose with arms slightly away from the body, legs apart, front view, "
              "plain pure white background, soft even studio lighting, PBR materials, sharp focus, no text")
BOT_STYLE = ("highly detailed 3D game asset render, one single robot, entire robot fully visible with empty space around, "
             "front three-quarter view, plain pure white background, soft studio lighting, PBR materials, sharp focus, no text")
PROP_STYLE = ("highly detailed 3D game environment asset render, one single object, centered, entire object fully visible with empty space around, "
              "three-quarter view from slightly above, plain pure white background, soft studio lighting, PBR materials, stylized anime game art, no text, isolated")
KEY_STYLE = ("anime key visual illustration, dynamic heroic pose, dramatic lighting, detailed cel shading, vibrant colors, "
             "high quality anime game splash art, cinematic composition, masterpiece")
MAP_STYLE = ("anime background art, epic wide establishing shot of a hero shooter game map, detailed environment concept painting, "
             "dramatic lighting, vibrant colors, cinematic, masterpiece, no people")
TEX_STYLE = ("seamless tileable texture, perfectly flat top-down orthographic view, even flat lighting, no shadows, "
             "no perspective, high detail game material, stylized hand painted anime game texture")

NEG = ("character sheet, turnaround, multiple views, two figures, duplicate, collage, text, watermark, logo, signature, "
       "cropped, cut off feet, cut off head, blurry, lowres, deformed hands, extra limbs, background scenery, frame, border, sketch, 2d flat")
NEG_ART = "text, watermark, logo, signature, blurry, lowres, deformed, extra limbs, bad anatomy, cropped head, ugly, frame, border"

ZEN = "white, gold and sky blue color scheme, heroic"
UMB = "black, crimson and violet color scheme, villainous, menacing"

# id: (kind, subject, width, height, candidates)
ASSETS = {
    # ================================================================ ZENITH VANGUARD (heroes)
    "tenkai": ("mech", f"giant heroic super robot mecha named Tenkai-Oh, massive armored body, white and gold armor plates with sky blue panels, open glass cockpit canopy in the chest with a young male pilot with red headband visible inside, glowing golden sun crest above the cockpit, V-shaped horned head crest with bright green visor eyes, huge armored fists, twin jet thrusters on the back, {ZEN}", 1024, 1024, 3),
    "mirei": ("char", f"cheerful magical girl star mage named Mirei, long silver twin-tail hair with star clips, white and sky blue frilled battle dress with gold star embroidery, translucent glowing holographic star-shaped wings on her back, holding a tall crystal star staff, white boots, {ZEN}", 1024, 1024, 3),
    "kaien": ("char", f"young warrior monk exorcist named Kaien, spiky black hair, white and indigo layered monk robes with gold trim, prayer bead gauntlet on one arm, glowing paper talisman seals floating around him, sandals with shin guards, calm expression, {ZEN}", 1024, 1024, 3),
    "raijin": ("char", f"lightning swordsman named Raijin, spiky blond hair, long dark navy high-collared battle coat with glowing yellow lightning patterns, light armor, holding a katana crackling with blue-white electricity, fingerless gloves, {ZEN}", 1024, 1024, 3),
    "yuzu": ("char", f"young archer girl named Yuzu, sunset orange ponytail hair, amber visor goggles on her head, light white and gold armored bodysuit, holding a large glowing golden solar energy longbow, quiver of light arrows, {ZEN}", 1024, 1024, 3),
    # ================================================================ UMBRA SYNDICATE (villains)
    "gorgoth": ("mech", f"giant villainous dark super robot mecha named Gorgoth, massive heavy armored body, black gunmetal armor with crimson panels and violet glowing seams, dark red glass cockpit canopy in the chest with a scarred older male pilot in black armor visible inside, single glowing red mono-eye in a horned skull-like head, spiked shoulder armor, one arm is a huge drill lance, {UMB}", 1024, 1024, 3),
    "nocturne": ("char", f"gothic vampire songstress queen named Lady Nocturne, long white hair, pale skin, crimson eyes, black and crimson armored corset ball gown, large crimson translucent bat-shaped energy wings on her back, holding a silver scepter microphone, {UMB}", 1024, 1024, 3),
    "hex": ("char", f"sinister puppeteer doctor named Hex, cracked white porcelain doll mask, tall thin figure, patchwork violet and black long coat with stitches, glowing violet marionette strings from his fingers, a creepy stitched voodoo doll floating beside him, {UMB}", 1024, 1024, 3),
    "kagemaru": ("char", f"shadow ninja assassin named Kagemaru, black and violet segmented ninja armor, snarling wolf skull mask, dual curved kunai daggers, tattered long scarf dissolving into black shadow smoke, {UMB}", 1024, 1024, 3),
    "enra": ("char", f"demon oni berserker warrior named Enra, crimson skin, two large black horns, wild white hair, black samurai armor pieces, massive gauntlets wreathed in dark purple and red flames with chains wrapped around, muscular, {UMB}", 1024, 1024, 3),
    # ================================================================ tank pilots (they eject when their mech falls)
    "haruto": ("char", f"young hot-blooded mecha pilot named Haruto Daimon, spiky brown hair, red headband, white and gold pilot plugsuit with sky blue panels, sun emblem on the chest, confident grin, {ZEN}", 1024, 1024, 2),
    "vorn": ("char", f"stern veteran villain mecha pilot named Warlord Vorn, grey slicked-back hair, scar across one eye, black and crimson armored pilot suit with a long tattered military coat, cold expression, {UMB}", 1024, 1024, 2),
    # ================================================================ training robots
    "bot_dummy": ("bot", "humanoid training dummy robot, white and orange plating, round glowing blue target on the chest, simple visor head, sturdy legs, standing", 1024, 1024, 2),
    "bot_sentry": ("bot", "four-legged training sentry walker robot with a twin blaster turret on top, white and orange armor, blue glowing sensor eye", 1024, 1024, 2),
    "bot_drone": ("bot", "flying spherical training drone robot with four small rotor pods, white and orange plating, glowing blue lens eye, floating", 1024, 1024, 2),
}

# anime key art: one per hero (hi-res splash, used for portraits, menu and website)
KEYART = {
    "tenkai": "giant white and gold super robot mecha Tenkai-Oh raising a blazing sun sword above a city at dawn, golden light rays, heroic",
    "mirei": "magical girl Mirei with silver twin tails flying through a starry night sky with glowing star wings, casting healing starlight from her staff",
    "kaien": "young monk Kaien in white and indigo robes surrounded by a spiral of glowing golden talisman seals on a floating mountain shrine, cherry blossoms",
    "raijin": "blond swordsman Raijin mid-dash in a rainy neon city at night, katana trailing blue lightning, navy coat flaring",
    "yuzu": "orange-haired archer girl Yuzu drawing a golden solar energy bow on a rooftop at sunrise, arrow of pure light",
    "gorgoth": "colossal black and crimson villain mecha Gorgoth with a red mono-eye standing in a burning hangar, drill lance arm, sparks, menacing",
    "nocturne": "white-haired vampire queen Lady Nocturne singing in a gothic cathedral under a blood red moon, crimson bat wings spread",
    "hex": "sinister masked puppeteer Hex controlling glowing violet strings in a dark twisted theater, floating stitched doll, eerie",
    "kagemaru": "wolf-masked shadow ninja Kagemaru emerging from black smoke on a moonlit rooftop, dual kunai, violet eyes glowing",
    "haruto": "young pilot Haruto Daimon with a red headband shouting inside the glowing cockpit of his white and gold super robot, gripping the control sticks, golden sunrise light, hot-blooded",
    "vorn": "scarred veteran pilot Warlord Vorn seated calmly in the dark red cockpit of his black mecha, crimson screen glow on his face, cold smile, menacing",
    "enra": "crimson oni berserker Enra roaring with flaming chain gauntlets amid a violet eclipse storm, black horns, fierce",
}

# maps: (display name, concept prompt, sky prompt, [texture prompts], {prop id: prop prompt})
MAPS = {
    "amatsu": ("Amatsu Sky Shrine",
               "ancient japanese shrine complex on floating islands above a sea of clouds, red torii gates, stone lanterns, cherry blossom trees, wooden bridges between islands, golden morning light",
               "ultra wide panoramic sky above a sea of white clouds at golden sunrise, distant floating islands with waterfalls, soft pink and gold light",
               {"ground": "weathered grey stone temple floor tiles with moss", "wall": "red lacquered wood planks with gold trim"},
               {"p_torii": "large red japanese torii gate with black top beam", "p_lantern": "tall stone japanese shrine lantern", "p_sakura": "blooming cherry blossom tree with pink flowers on a small rock"}),
    "kurogane": ("Neo-Kurogane Rainport",
                 "neon cyberpunk japanese city street at night in the rain, towering skyscrapers with holographic signs, elevated monorail, wet reflective streets, food stalls, blue and magenta neon",
                 "ultra wide panoramic night skyline of a futuristic neon megacity in the rain, glowing skyscrapers, flying cars, magenta and cyan haze",
                 {"ground": "wet dark asphalt road with puddles and faded road markings", "wall": "dark concrete wall panels with small neon strips and grime"},
                 {"p_vending": "futuristic glowing neon vending machine", "p_stall": "small japanese ramen food stall with a lantern and awning", "p_sign": "tall vertical holographic neon sign pole"}),
    "hangar": ("Hangar Zero",
               "enormous mecha construction hangar interior, giant robot maintenance gantries and cranes, sparks from welding, yellow hazard stripes, steel catwalks, a half-built giant robot silhouette, dramatic light shafts",
               "ultra wide panoramic view of a massive industrial hangar interior ceiling with giant cranes, floodlights and smoky haze",
               {"ground": "industrial steel floor plates with yellow black hazard stripes", "wall": "riveted metal hangar wall panels with pipes"},
               {"p_crate": "stack of military cargo crates with hazard markings", "p_crane": "industrial mecha maintenance gantry crane tower", "p_fist": "giant broken robot fist lying on the ground"}),
    "cathedral": ("Crimson Moon Cathedral",
                  "gothic vampire cathedral courtyard at night under a huge blood red full moon, tall spires, stained glass windows glowing crimson, graveyard, crimson roses, bats flying",
                  "ultra wide panoramic night sky with a huge blood red full moon, dark crimson clouds, distant gothic spires silhouettes, bats",
                  {"ground": "dark gothic cathedral stone floor with crimson cracks", "wall": "black gothic stone brick wall with carvings"},
                  {"p_spire": "gothic stone spire with a gargoyle", "p_grave": "ornate gothic tombstone with crimson roses", "p_organ": "huge gothic pipe organ"}),
    "rift": ("Eclipse Rift",
             "shattered dimension of floating black and violet crystal rock islands around a black sun eclipse with a violet corona, twisted ruins, glowing violet energy rivers, eerie",
             "ultra wide panoramic surreal sky with a black sun total eclipse and violet corona, floating shattered rocks, purple and black cosmic clouds",
             {"ground": "cracked black obsidian rock with glowing violet energy veins", "wall": "twisted dark violet crystal rock surface"},
             {"p_crystal": "large jagged glowing violet crystal cluster on black rock", "p_ruin": "broken ancient dark stone pillar with violet runes", "p_obelisk": "floating black obsidian obelisk with violet glow"}),
    "training": ("Zenith Academy Proving Grounds",
                 "clean futuristic white and sky blue training arena of a hero academy, holographic target panels, glowing blue floor lines, shooting range lanes, observation deck windows, bright daylight",
                 "ultra wide panoramic bright blue sky with soft clouds above a futuristic white academy campus, gold accents",
                 {"ground": "white sci-fi floor panels with thin glowing blue grid lines", "wall": "white and sky blue sci-fi wall panels with gold trim"},
                 {"p_barrier": "futuristic white training cover barrier wall with blue light strip", "p_target": "holographic shooting range target stand with blue glowing rings"}),
}


def jobs():
    """Flatten everything into (name, kind, prompt, negative, w, h, candidates)."""
    out = []
    for aid, (kind, subj, w, h, n) in ASSETS.items():
        style = MECH_STYLE if kind == "mech" else BOT_STYLE if kind == "bot" else MODEL_STYLE
        out.append((f"model_{aid}", "model", f"{subj}, {style}", NEG, w, h, n))
    for aid, p in KEYART.items():
        out.append((f"key_{aid}", "keyart", f"{p}, {KEY_STYLE}", NEG_ART, 832, 1216, 2))
    for mid, (_, concept, sky, texs, props) in MAPS.items():
        out.append((f"map_{mid}", "map", f"{concept}, {MAP_STYLE}", NEG_ART, 1344, 768, 2))
        out.append((f"sky_{mid}", "sky", f"{sky}, anime background art, masterpiece, no ground, no people", NEG_ART, 1536, 640, 1))
        for tk, tp in texs.items():
            out.append((f"tex_{mid}_{tk}", "tex", f"{TEX_STYLE}, {tp}", NEG_ART, 1024, 1024, 1))
        for pid, pp in props.items():
            out.append((f"prop_{mid}_{pid[2:]}", "prop", f"{pp}, {PROP_STYLE}", NEG, 1024, 1024, 2))
    return out


# ---- pass 2: clean, effect-free A-pose renders for image-to-3D (pass 1 drifted into key-art compositions)
MODEL2_STYLE = ("3D character model render in blender, anime style game character, full body from head to toe with both feet visible, "
                "standing in a neutral A-pose with arms slightly away from the body, symmetrical, front view, "
                "plain flat light grey background, clean even studio lighting, no effects, one character only")
MECH2_STYLE = ("3D mecha robot model render in blender, anime super robot game asset, full body from head to toe with both feet visible, "
               "standing in a neutral A-pose with arms slightly away from the body, symmetrical, front view, "
               "plain flat light grey background, clean even studio lighting, no effects, one robot only")
NEG2 = ("background scenery, city, sky, dramatic lighting, fire, flames, smoke, particles, lightning, sparks, energy effects, magic effects, glow aura, "
        "portrait, close-up, upper body, cropped, cut off feet, action pose, dynamic pose, turnaround, multiple views, two characters, text, watermark, blurry, lowres, deformed")
MODELS2 = {
    "tenkai": ("mech", "heroic super robot named Tenkai-Oh, massive armored body, white and gold armor plates with sky blue panels, round glass cockpit hatch in the center of the chest with a young pilot visible inside, sun-ray crown crest of golden spikes around the head, single horizontal golden visor across the face, huge armored fists, twin jet thrusters on the back"),
    "gorgoth": ("mech", "villainous dark super robot named Gorgoth, massive heavy armored body, black gunmetal armor with crimson panels, dark red glass cockpit hatch in the center of the chest with a pilot visible inside, single red mono-eye in a horned skull-like head, spiked shoulder armor, right arm is a huge drill lance"),
    "mirei": ("char", "cheerful anime magical girl named Mirei, long silver twin-tail hair with star clips, white and sky blue frilled battle dress with gold star embroidery, translucent holographic star-shaped wings on her back, holding a tall crystal star staff, white boots"),
    "kaien": ("char", "young anime warrior monk named Kaien, spiky black hair, white and indigo layered monk robes with gold trim, prayer bead gauntlet on one arm, paper talisman charms on his belt, sandals with shin guards"),
    "raijin": ("char", "anime swordsman named Raijin, spiky blond hair, long dark navy high-collared battle coat with yellow lightning-bolt patterns, light armor, holding a katana at his side, fingerless gloves"),
    "yuzu": ("char", "young anime archer girl named Yuzu, sunset orange ponytail hair, amber goggles on her head, light white and gold armored bodysuit, holding a large golden longbow at her side, quiver on her back"),
    "nocturne": ("char", "anime gothic vampire queen named Lady Nocturne, long white hair, pale skin, black and crimson armored corset gown, large crimson bat wings on her back, holding a silver scepter"),
    "hex": ("char", "sinister anime puppeteer named Hex, cracked white porcelain doll mask, tall thin figure, patchwork violet and black long coat with stitches, holding a wooden marionette control bar, a small stitched doll hanging from his belt"),
    "kagemaru": ("char", "anime shadow ninja named Kagemaru, black and violet segmented ninja armor, snarling wolf skull mask, dual curved kunai daggers in his hands, long tattered black scarf"),
    "enra": ("char", "anime oni demon warrior named Enra, crimson skin, two large black horns, wild white hair, black samurai armor pieces, massive crimson armored gauntlets with chains wrapped around them, muscular"),
    "haruto": ("char", "young human man anime mecha pilot named Haruto Daimon, no helmet, spiky brown hair, red headband, white and gold skin-tight pilot jumpsuit with sky blue panels, confident grin"),
    "vorn": ("char", "older human man anime villain mecha pilot named Warlord Vorn, no helmet, grey slicked-back hair, scar across one eye, black and crimson pilot jumpsuit with a long military coat, cold expression"),
}
KEY2 = {"tenkai": "giant white and gold super robot Tenkai-Oh with a golden sun-ray crown crest and a golden visor, raising a blazing sun sword above a city at dawn, golden light rays, heroic"}


def jobs2():
    out = []
    for aid, (kind, subj) in MODELS2.items():
        out.append((f"model_{aid}", "model", f"{subj}, {MECH2_STYLE if kind == 'mech' else MODEL2_STYLE}", NEG2, 1024, 1024, 4))
    for aid, p in KEY2.items():
        out.append((f"key_{aid}", "keyart", f"{p}, {KEY_STYLE}", NEG_ART, 832, 1216, 2))
    return out


# ---- campaign: "Operation Starfall" - the Vanguard hunts the Star-Forger's space colossi
CAMPAIGN = {
    # the new villain: alien scientist of the Umbra Syndicate
    "qelvaris": ("char", "tall slender alien scientist named Archon Qel'Varis, pale violet skin, four glowing golden eyes, elongated bald head with a floating halo of tiny orbiting machine parts, long black and violet high-collared lab robe with glowing circuit lines, mechanical spider-like arms folded on his back, holding a glowing control orb"),
    # bosses (giant space robots)
    "boss_ironmaw": ("mech", "colossal space robot named Ironmaw, hunched gorilla-like frame, massive jaw full of grinding metal teeth, gunmetal and rust orange armor, violet reactor glowing in its chest, huge knuckle fists"),
    "boss_reaper": ("mech", "colossal space robot named Crescent Reaper, tall thin skeletal frame, silver and black armor, two enormous crescent scythe blade arms, single violet eye, tattered metal cape"),
    "boss_leviathan": ("mech", "colossal serpentine space robot named Hive Leviathan, long segmented metal body coiled upright, cobra-like hood with glowing violet vents, black and teal armor plates"),
    "boss_phoenix": ("mech", "colossal winged space robot named Solar Phoenix, bird-like humanoid frame, huge mechanical wings of golden-orange blade feathers, black armor, crimson-orange glowing core"),
    "boss_genesis": ("mech", "colossal final boss space robot named Omega Genesis, regal humanoid frame with a halo ring of floating blades behind it, black and violet armor with gold trim, open glass throne cockpit in the chest, six arms"),
    # minions
    "minion_swarmer": ("bot", "small flying alien attack drone robot, black and violet armor, three glowing violet eyes, blade wings"),
    "minion_lancer": ("bot", "humanoid alien soldier robot with a long energy lance, black and violet armor, glowing violet visor, thin armored limbs"),
    "minion_sentinel": ("bot", "heavy squat alien guardian robot carrying a large hexagonal energy shield, black and violet armor, glowing violet core"),
    "minion_bomber": ("bot", "floating round alien bomber robot with a glowing violet bomb core and four small thrusters, black armor plates"),
}
LEVELS = {
    "c1_shipyard": ("Kessler Shipyard", "orbital shipyard in space above earth, huge scaffolding of half-built spaceships, floating metal platforms and catwalks, debris ring, blue earth glowing below, starfield",
                    "ultra wide panoramic space view of earth from orbit with a debris ring and distant space station, starfield",
                    {"ground": "sci-fi metal deck plates with bolts and yellow markings", "wall": "sci-fi spaceship hull panels with rivets"}),
    "c2_lunar": ("Selene Foundry", "alien robot foundry built into a crater on the moon, glowing violet molten metal channels, giant assembly arms, grey lunar dust, earth in the black sky",
                 "ultra wide panoramic lunar horizon with grey craters and the earth rising in a black starry sky",
                 {"ground": "grey lunar regolith dust with small rocks", "wall": "dark alien foundry metal with violet glowing seams"}),
    "c3_ceres": ("Ceres Deep", "hollowed asteroid interior turned into an alien machine hive, teal glowing crystals, organic metal tunnels, floating rocks, eerie mist",
                 "ultra wide panoramic view of an asteroid field in deep space with teal nebula and floating rocks",
                 {"ground": "dark asteroid rock with teal crystal veins", "wall": "alien hive metal with hexagonal teal glowing pattern"}),
    "c4_helios": ("Helios Crown", "huge alien solar collector array orbiting close to the sun, golden mirror panels, blinding orange solar flares, heat shimmer, metal bridges",
                  "ultra wide panoramic view of the burning sun filling the sky with solar flares and orange corona",
                  {"ground": "golden solar panel floor with hexagonal cells", "wall": "heat scorched black alien metal with orange glow"}),
    "c5_citadel": ("Eclipse Citadel", "alien mothership throne hall inside a black sun, colossal violet crystal pillars, floating golden rings, black mirror floor, cosmic storm through huge windows",
                   "ultra wide panoramic cosmic storm around a black sun with violet corona and alien warships",
                   {"ground": "polished black mirror alien floor with gold circuit inlays", "wall": "black alien crystal wall with violet energy lines"}),
}
CINEMATIC = [
    ("cine_01", "anime cinematic still, alien scientist Qel'Varis with four golden eyes standing before a giant hologram of the earth in a dark violet laboratory, ominous"),
    ("cine_02", "anime cinematic still, a colossal black and violet giant robot descending from space toward a city at night, violet beams, people looking up in fear"),
    ("cine_03", "anime cinematic still, the Zenith Vanguard heroes, a white and gold super robot, a silver-haired magical girl with star wings, a blond swordsman, an orange-haired archer and a monk standing together on a hangar launch deck, heroic sunrise"),
    ("cine_04", "anime cinematic still, a white and gold spaceship launching from earth into orbit trailing golden light"),
    ("cine_05", "anime cinematic still, heroes fighting a giant space robot on a floating orbital shipyard, explosions, earth below"),
    ("cine_06", "anime cinematic still, alien scientist Qel'Varis on a throne inside a colossal robot cockpit laughing, black sun behind him"),
    ("cine_07", "anime cinematic still, a blazing golden sun sword cutting through a giant violet robot in space, dramatic finale"),
    ("cine_08", "anime cinematic still, heroes silhouetted against the sunrise over earth from orbit, victory, peaceful"),
]
SPACE = "sci-fi space setting, anime background art, masterpiece"


def jobs3():
    out = []
    for aid, (kind, subj) in CAMPAIGN.items():
        style = MECH2_STYLE if kind == "mech" else BOT_STYLE if kind == "bot" else MODEL2_STYLE
        out.append((f"model_{aid}", "model", f"{subj}, {style}", NEG2, 1024, 1024, 3))
    out.append(("key_qelvaris", "keyart", f"alien scientist Archon Qel'Varis with four glowing golden eyes and mechanical spider arms, holding a glowing orb in a dark violet laboratory full of giant robot schematics, {KEY_STYLE}", NEG_ART, 832, 1216, 2))
    for boss in ("ironmaw", "reaper", "leviathan", "phoenix", "genesis"):
        out.append((f"key_boss_{boss}", "keyart", f"{CAMPAIGN['boss_' + boss][1]}, towering in space, epic scale, {KEY_STYLE}", NEG_ART, 1344, 768, 1))
    for lid, (_, concept, sky, texs) in LEVELS.items():
        out.append((f"map_{lid}", "map", f"{concept}, {MAP_STYLE}", NEG_ART, 1344, 768, 2))
        out.append((f"sky_{lid}", "sky", f"{sky}, {SPACE}, no ground, no people", NEG_ART, 1536, 640, 1))
        for tk, tp in texs.items():
            out.append((f"tex_{lid}_{tk}", "tex", f"{TEX_STYLE}, {tp}", NEG_ART, 1024, 1024, 1))
    for cid, p in CINEMATIC:
        out.append((cid, "keyart", f"{p}, 16:9 widescreen, cinematic lighting, detailed, {KEY_STYLE}", NEG_ART, 1344, 768, 2))
    return out


# ---- hex re-render: no puppet stand (pass 2 always drew one standing on the floor beside him)
HEXFIX = [("model_hex", "model", "sinister anime puppeteer named Hex, cracked white porcelain doll mask, tall thin figure, patchwork violet and black long coat with stitches, glowing violet strings dangling from his fingertips, empty hands, nothing on the floor, " + MODEL2_STYLE, NEG2 + ", stand, tripod, pedestal, puppet, doll on the floor, props", 1024, 1024, 4)]
def jobs4(): return HEXFIX
