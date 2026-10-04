"""ZENITH//UMBRA - "TWIN DRAGONS" (10 min anime film: the Koryu brothers, Hayate and Seiran).

Story (from the user's outline, expanded): two brothers of the Koryu - the clan of the Twin Dragon Koi - train in the Way of
the Koi Dragon beneath the Dragon Gate falls. When their father dies, the falls choose the younger, laughing Hayate as clan
head over Seiran, the disciplined heir. Jealousy and Warlord Vorn's offer do the rest: on a storm night Seiran cuts his
brother down and Hayate falls into the river. The river gives him back to Hangar Zero, where Haruto's father rebuilds him in
sun-alloy and the Vanguard takes him in. Years later the masked Hayate comes back for his brother. They fight; both call
the koi dragon; the dragons will not fight each other - only the Koryu blood can call them, and two koi of one river always
find each other. Hayate unmasks. Seiran comes home - to the Vanguard: Haruto, Mirei, Kaien, Raijin, Yuzu.
Echoes: the elder/younger assassin-clan brothers (dragon technique, the brother cut down and rebuilt), the rival-brothers
bond of shonen anime, and yin and yang - one black koi and one white koi, two halves of one pendant.

Every clip is grok-imagine-video-1.5-lite image-to-video (720p) from a keyframe painted by grok-imagine-image (images/edits
with the heroes' key art / our own anchor sheets as references). Budget: $20 of xAI credit, so every second is planned:
`gen` is the clip length bought, `secs` the length of the shot in the cut (clips play eased up to 1.3x slower, anime on
twos reads fine, and a short clip holds its last frame under a slow push).
"""

TITLE = "TWIN DRAGONS"

# appended to every keyframe prompt
STYLE = ("High-budget modern Japanese anime feature film still, crisp clean line art, cel shading with soft gradients, "
         "painterly detailed background, cinematic lighting, widescreen 16:9 composition, no text, no watermark, no subtitles")
# appended to every image-to-video prompt
MOTION = "2D anime animation, keep every character design exactly as in the image, smooth cinematic motion"

# who looks like what. ref = anchor sheet (work/anchors/<ref>.jpg, painted first by keys.py) or the game's key art (key_<id>)
CHAR = {
    "hayate_kid": ("young Hayate, a cheeky ten-year-old boy with spiky black hair with jade-green tips, big bright jade eyes, a "
                   "gap-toothed grin, a small teal scarf, white and teal training gi", "kids"),
    "seiran_kid": ("young Seiran, a serious twelve-year-old boy with long black hair tied in a high topknot, steel-blue eyes, "
                   "navy-blue and white training gi", "kids"),
    "hayate": ("Hayate, a lean cocky young man of nineteen with spiky black hair with jade-green tips, bright jade eyes, a "
               "confident grin, a long teal scarf, white and teal ninja gear with a violet koi crest", "hayate_y"),
    "seiran_y": ("Seiran at twenty-one, a tall disciplined young archer, long black hair in a high topknot, clean-shaven, "
                 "steel-blue eyes, navy-blue and white archer kimono, a black recurve bow", "seiran_y"),
    "seiran": ("Seiran, a stern man of thirty with long black hair in a high topknot with a single white streak, a short black "
               "beard, steel-blue eyes, navy-blue and white archer kimono, a black and silver recurve bow", "key_seiran"),
    "hayate_cy": ("Hayate the cyber-ninja, sleek white and silver sun-alloy armour with glowing teal seams, a smooth white helmet "
                  "with two short horns and a glowing teal visor slit, a long teal scarf, a nodachi on his back", "key_hayate"),
    "hayate_face": ("Hayate unmasked, a young man with spiky black hair with jade-green tips, a scar across the bridge of his "
                    "nose, one jade eye and one glowing teal cybernetic eye, his jaw and neck framed by white sun-alloy armour "
                    "plates, a teal scarf", "hayate_face"),
    "father": ("Master Koryu Tatsuo, the clan master, a stern old man with a long grey beard and grey topknot, a dark indigo "
               "haori with a white koi crest", "father"),
    "elder": ("the clan's eldest elder, a tiny ancient woman in grey robes with a koi-head walking staff", None),
    "vorn": ("Warlord Vorn, a tall stern man in his fifties with short swept-back silver-grey hair, a hard lined scowling face, a "
             "long charcoal-grey and crimson military greatcoat", "key_vorn"),
    "daimon": ("Dr. Daimon, Haruto's father, a kind engineer of forty-five with messy grey-streaked brown hair, round glasses, "
               "a white lab coat over a red and white work suit", "daimon"),
    "haruto": ("Haruto, a hot-blooded seventeen-year-old boy with messy brown hair and brown eyes, a red and white armoured "
               "pilot suit", "key_haruto"),
    "tenkai": ("Tenkai-Oh, a giant heroic white-and-gold super robot knight with sky-blue panels, a golden sun-ray crown crest "
               "and a glowing golden sun reactor in its chest", "key_tenkai"),
    "mirei": ("Mirei, a young woman with a short silver bob and bright blue eyes, a pearl-white armoured bodysuit with gold "
              "trim, wings of crystal-blue light", "key_mirei"),
    "kaien": ("Kaien, a calm young monk with a black topknot, white and indigo robes with wide sleeves, a golden talisman "
              "medallion and prayer beads", "key_kaien"),
    "raijin": ("Raijin, a cocky young swordsman with spiky golden-blond hair, a navy-blue long coat with gold lightning-bolt "
               "trims, a katana crackling with lightning", "key_raijin"),
    "yuzu": ("Yuzu, a young archer with bright orange hair in two round buns, a white and orange armoured bodysuit with gold "
             "trim, a golden recurve bow", "key_yuzu"),
    "nocturne": ("Lady Nocturne, a gothic diva with long white hair, pale skin, crimson eyes, a black and crimson corset gown",
                 "key_nocturne"),
}

# anchor sheets painted before the shots (keys.py): id -> (refs, prompt). Each gives later keyframes a fixed face to copy.
ANCHORS = {
    "hayate_y": (["key_hayate"], "Use only the teal scarf and the white-and-teal colours of <IMAGE_0>. Draw a HUMAN young man, no "
                 "armour, no helmet: {hayate}. Full-body character sheet, front view, standing relaxed with a katana on his hip, "
                 "plain pale grey background."),
    "seiran_y": (["key_seiran"], "<IMAGE_0> is Seiran at thirty. Draw the SAME man nine years younger: {seiran_y}; no beard, no "
                 "white streak in his hair, smooth young face. Full-body character sheet, front view, standing with his bow, "
                 "plain pale grey background."),
    "kids": (["seiran_y", "hayate_y"], "<IMAGE_0> is Seiran and <IMAGE_1> is Hayate as young men. Draw the same two brothers as "
             "children: {seiran_kid}, standing beside {hayate_kid}. Same faces and hair, much younger. Full-body character "
             "sheet, front view, plain pale grey background."),
    "father": (["seiran_y"], "<IMAGE_0> is Seiran. Draw his father, with the same steel-blue eyes and the same long face: "
               "{father}. Full-body character sheet, front view, hands folded in his sleeves, plain pale grey background."),
    "hayate_face": (["hayate_y", "key_hayate"], "<IMAGE_0> is Hayate as a young man and <IMAGE_1> is his rebuilt cyber-ninja "
                    "body. Draw Hayate five years later with his helmet OFF: the same face and hair as <IMAGE_0> but with a scar "
                    "across the bridge of his nose and his left eye replaced by a glowing teal cybernetic eye, wearing the white "
                    "and silver armour of <IMAGE_1> from the neck down, the teal scarf, the helmet held under his arm. Upper-body "
                    "portrait, plain pale grey background."),
    "daimon": (["key_haruto"], "<IMAGE_0> is Haruto. Draw his father with a family resemblance: {daimon}. Full-body character "
               "sheet, front view, holding a tablet, plain pale grey background."),
}

NARRATOR = "bm_george"
VOICES = {"hayate": "am_puck", "hayate_m": "am_puck", "seiran": "am_fenrir", "hayate_kid": "af_sky", "seiran_kid": "af_nicole",
          "father": "bm_fable", "elder": "bm_daniel", "vorn": "am_onyx", "daimon": "am_eric", "haruto": "am_michael",
          "mirei": "bf_emma", "kaien": "bm_lewis", "raijin": "am_echo", "yuzu": "af_heart"}
SPEED = {"seiran": 0.9, "father": 0.86, "elder": 0.86, "vorn": 0.9, "haruto": 1.05, "hayate_kid": 1.08, "seiran_kid": 1.0,
         "raijin": 1.05, "hayate": 1.02}
NAMES = {"n": "", "hayate": "HAYATE", "hayate_m": "MASKED NINJA", "seiran": "SEIRAN", "hayate_kid": "HAYATE",
         "seiran_kid": "SEIRAN", "father": "MASTER TATSUO", "elder": "ELDER", "vorn": "VORN", "daimon": "DR. DAIMON",
         "haruto": "HARUTO", "mirei": "MIREI", "kaien": "KAIEN", "raijin": "RAIJIN", "yuzu": "YUZU"}


def shot(id, gen, secs, chars, key, motion, lines=(), cue="calm", fx=""):
    return dict(id=id, kind="clip" if gen else "still", gen=gen, secs=secs, chars=list(chars), key=key, motion=motion,
                lines=list(lines), cue=cue, fx=fx)


# clips that go wrong late: play only their good opening seconds (c08: Seiran dives over the edge after the scream;
# e15: the face under the helmet comes out as someone else - the reveal belongs to e16)
USE = {"c08": 3.2, "e15": 3.0}


def card(id, secs, text, cue="calm"):
    return dict(id=id, kind="card", gen=0, secs=secs, chars=[], key=text, motion="", lines=[], cue=cue, fx="")


RAIN_NIGHT = "night, gentle rain, deep indigo and lantern-gold palette"
STORM = "a violent storm at night, lightning, driving rain, black, violet and crimson palette"
DAWN = "sunrise, warm gold, jade and sky-blue palette"

S = [
    # ===================================================================================================== COLD OPEN
    card("t00", 4, "ZENITH//UMBRA", "omen"),
    shot("o01", 5, 6.5, ["seiran"], "Seiran kneels on a stone riverbank below a colossal misty waterfall and sets a glowing paper "
         "koi lantern on the dark water, his face lit warm gold from below, sad and quiet. Medium shot, side angle. " + RAIN_NIGHT,
         "He lets go of the glowing koi lantern; it drifts away on the dark current, rain rippling the water; slow push-in.",
         [("n", "Every year, on the same night, he gives the river a lantern.")], "omen"),
    shot("o02", 6, 7, [], "A single glowing paper koi lantern drifting on a dark river toward the edge of an enormous waterfall at "
         "night, far below the falls the neon harbour city of Neo-Kurogane glows in the rain. Low angle on the water. " + RAIN_NIGHT,
         "The lantern drifts slowly toward the edge of the falls, rain ripples, mist rising, neon glow pulsing far below; slow track.",
         [("n", "And every year the river takes it, and never answers.")], "omen"),
    shot("o03", 6, 7, ["hayate_cy"], "On a far cliff above the waterfall a white cyber-ninja crouches on a rock in the rain, a "
         "silhouette against the moonlit mist, only his teal visor glowing, watching the lantern far below. Wide shot. " + RAIN_NIGHT,
         "Rain falls, his long teal scarf streams in the wind, the visor glow pulses once; he stays still, watching; very slow push-in.",
         [("n", "Tonight, someone answers.")], "omen"),
    card("t01", 5, "TWIN DRAGONS", "omen"),
    # ===================================================================================================== I. THE WAY OF THE KOI DRAGON
    card("t02", 4, "EPISODE 1\nTHE WAY OF THE KOI DRAGON", "calm"),
    shot("a01", 8, 9, [], "A colossal waterfall plunging from towering cliffs into a misty gorge, an ancient Japanese clan village of "
         "pagodas, wooden bridges and koi banners clinging to the cliffs beside it, koi ponds, cherry trees, at sunrise. Epic wide "
         "establishing shot. " + DAWN,
         "Slow crane up the face of the waterfall, mist drifting, koi banners fluttering, birds flying across the gorge.",
         [("n", "Above the harbour of Neo-Kurogane, where the river falls a thousand feet, lived the Koryu, the clan of the "
                "Twin Dragon Koi.")], "calm"),
    shot("a02", 7, 7.5, [], "A golden koi fish leaping up a huge waterfall, and at the top of the falls it transforms into a "
         "shining golden dragon, painted in the style of a classic ukiyo-e woodblock print, swirling waves and spray.",
         "The koi leaps up the falling water and turns into a dragon that coils up into the sky, ukiyo-e waves surging.",
         [("n", "Their oldest legend: a koi that climbs the Dragon Gate becomes a dragon.")], "calm"),
    shot("a03", 8, 8.5, ["seiran_kid", "hayate_kid", "father"], "Two young brothers stand waist-deep in a rushing river at the foot "
         "of the waterfall holding wooden swords up against the current, while their father watches with folded arms from a "
         "mossy boulder above them. Wide shot, morning light, spray. " + DAWN,
         "The boys brace against the rushing water, spray flying, their wooden swords trembling; the father stands still above.",
         [("n", "Two brothers were raised to climb it.")], "calm"),
    shot("a04", 7, 8, ["father"], "Close-up of the stern old clan master on the boulder, spray and morning light behind him, speaking "
         "with calm authority. " + DAWN,
         "He speaks slowly, his mouth moving, beard and sleeves stirring in the wind from the falls; slow push-in.",
         [("father", "A koi does not fight the river. It becomes the river. And then it climbs.")], "calm"),
    shot("a05", 6, 6.5, ["seiran_kid"], "Close-up of the serious twelve-year-old boy gritting his teeth, holding his stance in the "
         "rushing water, wooden sword steady, total focus. " + DAWN,
         "He holds steady against the current, water surging around him, he narrows his eyes; subtle handheld shake.", [], "calm"),
    shot("a06", 6, 6.5, ["hayate_kid", "seiran_kid"], "The cheeky ten-year-old boy has slipped into the river and bursts up out of the "
         "water laughing, splashing his serious older brother in the face. " + DAWN,
         "The little boy pops up out of the water laughing and splashes his brother, who sputters and scowls.",
         [("hayate_kid", "Ha! The river likes me better!"), ("seiran_kid", "Focus, Hayate!")], "calm"),
    shot("a07", 6, 6, ["seiran_y", "hayate"], "Two teenage brothers sparring on tall bamboo poles above a koi pond, the elder with a "
         "wooden bow-staff, the younger with a wooden sword, mid-leap, koi below, cherry petals. Dynamic low angle. " + DAWN,
         "They leap between the bamboo poles trading fast blows, petals swirling, koi scattering in the pond below.", [], "calm"),
    shot("a08", 6, 6.5, ["seiran_y"], "The elder teenage brother draws a black recurve bow on a cliff edge, aiming across the gorge at "
         "a distant straw target beside the waterfall, perfectly still. " + DAWN,
         "He releases; the arrow streaks across the gorge and strikes the centre of the distant target; he lowers the bow calmly.",
         [("n", "Seiran was the discipline.")], "calm"),
    shot("a09", 6, 6.5, ["hayate"], "The younger teenage brother running straight up the wet cliff wall beside the waterfall, laughing, "
         "teal scarf streaming behind him. Dynamic angle from below. " + DAWN,
         "He sprints up the vertical cliff face beside the falling water, kicks off and flips onto the top, laughing.",
         [("n", "Hayate was the current.")], "calm"),
    shot("a10", 8, 9, ["seiran_y", "hayate"], "Night: the two teenage brothers sit side by side on a pagoda roof above the waterfall "
         "under a sky full of stars, eating fish-shaped taiyaki pastries and laughing, lanterns glowing in the village below. "
         "Warm, peaceful, deep blue night.",
         "They eat and laugh, the younger one talks with his mouth full and gestures, the elder shakes his head smiling; stars twinkle.",
         [("hayate", "When I'm clan leader, everyone gets taiyaki. Every day."),
          ("seiran", "When you're clan leader, the clan burns down.")], "calm"),
    shot("a11", 8, 9.5, ["father", "seiran_y", "hayate"], "Inside a candlelit dojo at night, the old clan master holds out two halves of "
         "a round jade pendant to his two kneeling sons: one half carved as a black koi, the other as a white koi, together a "
         "yin and yang. Warm candlelight.",
         "The father speaks and places one half in each son's hands; candle flames flicker; slow push-in on the pendant.",
         [("father", "Two koi, one river. When two Koryu call the dragon together, the koi will always find each other.")], "calm"),
    shot("a12", 6, 6.5, [], "Extreme close-up of two young hands bringing together two halves of a round jade pendant, a black koi "
         "and a white koi, forming a glowing yin and yang symbol, candlelight.",
         "The two halves click together and a soft jade glow blooms from the joined pendant; shallow focus.", [], "calm"),
    shot("a13", 6, 6.5, ["seiran_y", "hayate"], "The two teenage brothers racing each other up the waterfall itself at sunset, leaping "
         "from rock to rock through the spray, both laughing. Wide shot, golden backlight, rainbow in the mist.",
         "They race up through the spray, leaping rock to rock side by side, laughing; rainbow shimmering in the mist.", [], "calm"),
    # ===================================================================================================== II. THE TRIAL OF THE FALLS
    card("t03", 4, "EPISODE 2\nTHE TRIAL OF THE FALLS", "dread"),
    shot("b01", 8, 9, ["seiran_y", "hayate"], "Dusk: hundreds of glowing koi lanterns float down the river below the waterfall for a "
         "funeral, the two young brothers stand on the shore in black mourning kimono, backs to us. Melancholy violet and gold.",
         "The lanterns drift past, their light trembling on the water; the brothers stand still; slow pull back.",
         [("n", "Their father died in the spring. The clan needed a head.")], "dread"),
    shot("b02", 6, 7, ["elder"], "On a wooden platform on the cliff, a tiny ancient clan elder in grey robes raises her koi-head staff "
         "before rows of kneeling clan warriors and koi banners, the waterfall behind. Low angle.",
         "She raises the staff and speaks, banners flapping, warriors bowing their heads.",
         [("elder", "By the old law, the falls will choose. Whoever rings the Dragon Bell first leads the Koryu.")], "dread"),
    shot("b03", 7, 7.5, ["seiran_y", "hayate"], "The two young brothers face each other on wet stepping stones at the base of the "
         "roaring waterfall, the elder with his bow, the younger with his katana, the whole clan watching from the cliffs above. "
         "Epic wide shot, overcast light, spray.",
         "Wind and spray whip between them; both settle into fighting stances; the crowd above leans in.", [], "battle"),
    shot("b04", 6, 6, ["seiran_y", "hayate"], "The elder brother looses three arrows at once; the younger brother deflects them with his "
         "katana in an arc of white water spray. Dynamic action frame, speed lines.",
         "Three arrows streak in; he spins his katana and knocks them aside, water spraying in a ring around him.", [], "battle"),
    shot("b05", 6, 6, ["seiran_y", "hayate"], "The younger brother dashes across the river surface and his katana clashes against his "
         "brother's bow limb, sparks and spray exploding between them. Close dynamic angle.",
         "He dashes across the water and their weapons clash, sparks and spray burst out, they push against each other.", [], "battle"),
    shot("b06", 7, 7, ["seiran_y", "hayate"], "Both brothers leap onto the waterfall and race up its face, the younger running on the "
         "falling water itself, the elder springing off arrows he has fired into the rock. Vertical epic shot from below.",
         "They race straight up the waterfall side by side, water exploding under their feet, the camera tilts up with them.", [],
         "battle"),
    shot("b07", 8, 9, ["hayate"], "At the top of the falls the younger brother strikes a great bronze temple bell with his katana's "
         "pommel, and a huge glowing violet spirit dragon made of water and light bursts up out of the waterfall behind him. Epic.",
         "He strikes the bell, a shockwave ripples out, and the violet spirit koi-dragon erupts from the falls and coils into the sky.",
         [("n", "The falls chose the younger son.")], "rise"),
    shot("b08", 6, 7, ["seiran_y"], "The elder brother on one knee on a wet ledge below, soaked, staring up, his fist clenched, his "
         "face shadowed with disbelief and jealousy, the violet dragon glow reflected in his eyes.",
         "Water runs down his face; his fist tightens; his eyes tremble; slow push-in.",
         [("seiran", "Him?")], "dread"),
    shot("b09", 6, 7, ["hayate"], "Only ONE young man in the frame: Hayate stands alone at the top of the waterfall beside the bronze "
         "bell, grey-robed clan elders bowing in the background, and he reaches one hand down toward the camera with a warm grin, "
         "as if offering it to someone below. Bright overcast light.",
         "He turns and reaches his hand down with an open grin, speaking; elders bowing behind him.",
         [("hayate", "Hey. We'll lead it together, brother.")], "dread"),
    shot("b10", 6, 7, ["seiran_y", "hayate"], "Seiran in the foreground walks away from us into the grey rain, his back turned, fists "
         "clenched; behind him in the background Hayate stands alone with his hand still held out, his grin fading. The brothers "
         "do NOT touch. Grey rain, wet stone path by the waterfall.",
         "Seiran keeps walking away into the rain without looking back; behind him Hayate slowly lowers his outstretched hand, his smile falling.",
         [("seiran", "Don't pity me.")], "dread"),
    shot("b11", 8, 9, ["seiran_y", "vorn"], "Night: the elder brother alone beside a dark koi pond, his reflection broken by rain; from "
         "the shadows of the garden steps a tall man in a black and crimson greatcoat. Crimson lantern light, menacing.",
         "The man in the greatcoat steps out of the shadows and speaks; rain ripples the reflection; the young archer turns his head.",
         [("vorn", "Your father owed the Syndicate a great deal. Your brother laughs at debts.")], "dread"),
    shot("b12", 6, 7, ["vorn"], "Close-up of Warlord Vorn smiling coldly in crimson lantern light, rain on his scarred face, offering "
         "something with one gloved hand.",
         "He speaks quietly with a cold smile, rain dripping; slow push-in.",
         [("vorn", "Kneel to me, and the clan is yours. All you must do is silence him.")], "dread"),
    shot("b13", 6, 6.5, ["seiran_y"], "Extreme close-up of the young archer's eyes in shadow, and in his fist half of a jade pendant "
         "carved as a black koi, his knuckles white.",
         "His eyes harden; his fist closes tight around the jade half; rain streaks across the frame.",
         [("n", "Jealousy is a quiet current. It only needs one night.")], "dread"),
    # ===================================================================================================== III. THE NIGHT THE RIVER TURNED RED
    card("t04", 4, "EPISODE 3\nTHE NIGHT THE RIVER TURNED RED", "dread"),
    shot("c01", 7, 7.5, [], "The top of a colossal waterfall in a violent storm at night, lightning splitting the sky, far below in "
         "the harbour black warships with crimson lights. Epic wide shot. " + STORM,
         "Lightning flashes, rain lashes, the warships' crimson lights blink in the harbour; slow push toward the falls.", [], "dread"),
    shot("c02", 7, 8.5, ["hayate", "seiran_y"], "On the stone lip of the waterfall in the storm, the younger brother in a white clan "
         "leader's haori faces his elder brother, who has an arrow drawn on him. " + STORM,
         "Rain whips between them; the younger brother speaks, pointing toward the harbour; the elder keeps the arrow drawn and answers.",
         [("hayate", "Syndicate ships in our harbour. You brought them here?"),
          ("seiran", "The clan was mine. Father trained me for it.")], "dread"),
    shot("c03", 6, 7, ["hayate"], "Close-up of the younger brother drawing his katana slowly in the storm, sad but resolved, lightning "
         "behind him. " + STORM,
         "He slowly draws the katana, rain hissing on the blade, he speaks quietly; lightning flashes.",
         [("hayate", "Then take it from me. But not for him.")], "battle"),
    shot("c04", 6, 6, ["hayate", "seiran_y"], "The two brothers fighting in the storm on the edge of the waterfall, katana against "
         "bow-blade, sparks, lightning, spray. Dynamic action frame. " + STORM,
         "They trade a flurry of fast strikes, sparks flying, lightning flashing, water exploding around their feet.", [], "battle"),
    shot("c05", 6, 6, ["hayate", "seiran_y"], "Blade lock: the brothers' faces close together over crossed weapons, rain streaming, both "
         "eyes burning. Tight close-up. " + STORM,
         "They strain against each other, weapons grinding, rain pouring between them, then they shove apart.", [], "battle"),
    shot("c06", 6, 6.5, ["hayate", "seiran_y"], "The elder brother's blade slashes across the younger brother, a spray of red, the "
         "younger brother staggers backward toward the edge of the falls. Dramatic, stylised. " + STORM,
         "The slash lands; he staggers back toward the edge, eyes wide; lightning flash.", [], "battle"),
    shot("c07", 7, 7.5, ["hayate"], "Hayate, wounded, eyes wide with shock and pain, mouth open, falling backward off the top of the "
         "colossal waterfall into the white water far below, one hand reaching up, half of a jade pendant glinting as it flies from "
         "his neck. NOT smiling. Vertical shot from above. " + STORM,
         "He falls away down the waterfall, reaching up, the pendant glinting, until the white water swallows him.", [], "dread"),
    shot("c08", 6, 4.8, ["seiran_y"], "The elder brother on his knees at the edge of the waterfall reaching down, screaming, rain and "
         "lightning. " + STORM,
         "He lunges to the edge and screams downward, reaching; lightning flashes.",
         [("seiran", "Hayate!")], "dread"),
    shot("c09", 7, 8, [], "Grey morning: crimson Syndicate banners raised over the Koryu clan village on the cliffs beside the "
         "waterfall, clan members kneeling in the mud before armoured soldiers. Bleak.",
         "The crimson banners unfurl and snap in the wind, kneeling figures bow their heads, soldiers march past.",
         [("n", "By morning the Koryu knelt to the Syndicate anyway.")], "dread"),
    shot("c10", 7, 8, ["seiran", "vorn"], "Years later: Seiran, now with a beard and a white streak in his hair, stands on a dark "
         "rooftop among Syndicate soldiers, bow on his back, while Warlord Vorn looks out over the neon city. Cold crimson light.",
         "Seiran stands motionless, his coat stirring; Vorn turns his head toward him; neon flickers below.",
         [("n", "The heir became Vorn's marksman. A man who belonged to no one.")], "dread"),
    # ===================================================================================================== IV. THE RIVER GIVES BACK
    card("t05", 4, "EPISODE 4\nTHE RIVER GIVES BACK", "calm"),
    shot("d01", 7, 8, ["haruto", "hayate"], "Dawn far downriver in pale gold mist: Hayate lies unconscious and badly hurt on his back in "
         "the shallow water among the reeds, eyes closed, his teal scarf torn; Haruto, a brown-haired boy in a red and white pilot "
         "suit (no armour wings, no helmet), kneels beside him holding his shoulder and looks back over his shoulder, shouting. "
         "Behind them the giant doors of a futuristic hangar on the riverbank.",
         "Haruto shakes the unconscious young man's shoulder and shouts back over his shoulder toward the hangar; the injured man "
         "stays still with his eyes closed; reeds sway in the mist.",
         [("haruto", "Dad! There's someone in the river. He's still breathing!")], "calm"),
    shot("d02", 8, 9, ["daimon", "hayate_cy"], "Inside Hangar Zero: under bright surgical lights the engineer with round glasses "
         "rebuilds the young man in sleek white sun-alloy cybernetic armour with teal seams, robotic arms welding, sparks. "
         "Cool white and teal light.",
         "Robotic arms weld, sparks shower, teal seams light up one by one; the engineer speaks without looking up.",
         [("daimon", "We can only save what the river left him. The rest will be sun-alloy.")], "calm"),
    shot("d03", 6, 7, ["hayate_cy"], "On the operating table the cyborg wakes, lifting his new white metal hand in front of his face, "
         "teal light pulsing in its seams. Close-up, cool light.",
         "He slowly flexes the metal fingers, teal light pulsing, and whispers a name.",
         [("hayate_m", "Seiran.")], "calm"),
    shot("d04", 6, 6, ["hayate_cy", "raijin"], "Training in Hangar Zero: the white cyber-ninja deflects a lightning slash from the "
         "blond swordsman with his blade, blue lightning and teal sparks. Dynamic action frame.",
         "The swordsman's lightning slash meets the cyber-ninja's blade; lightning splashes off; both skid back grinning.", [],
         "battle"),
    shot("d05", 7, 8, ["haruto", "hayate_cy", "tenkai", "mirei", "kaien"], "In the vast hangar the boy pilot gives the white "
         "cyber-ninja a thumbs-up, the giant white-and-gold robot Tenkai-Oh towering behind them, the silver-haired girl and the "
         "monk watching. Warm morning light through the hangar doors.",
         "The boy grins and speaks, giving a thumbs-up; the others smile; the giant robot's visor glows.",
         [("haruto", "Welcome to the Vanguard, Hayate.")], "rise"),
    shot("d06", 6, 7, ["hayate_cy"], "Close-up: the cyber-ninja lowers his horned white helmet over his face and the visor lights up "
         "teal. Dramatic rim light.",
         "The helmet slides down and seals, the teal visor line ignites; slow push-in.",
         [("n", "He took a new face, and kept one promise.")], "rise"),
    shot("d07", 8, 10, ["hayate_cy", "kaien"], "Night on the hangar roof above the river: the white cyber-ninja sits holding half of a "
         "jade pendant carved as a white koi, the calm monk sitting beside him; far upriver, a tiny glowing lantern on the water. "
         "Quiet moonlight.",
         "The monk speaks gently; the cyber-ninja turns the pendant in his fingers and answers; the distant lantern drifts.",
         [("kaien", "Your brother floats a lantern for you every year."),
          ("hayate_m", "Then this year, I'll give it back to him.")], "calm"),
    # ===================================================================================================== V. TWO KOI, ONE RIVER
    card("t06", 4, "EPISODE 5\nTWO KOI, ONE RIVER", "battle"),
    shot("e01", 7, 7.5, [], "The Dragon Gate waterfall years later, now a Syndicate fortress: crimson neon banners and steel walkways "
         "bolted onto the old pagodas, searchlights in the rain. Epic wide night shot. " + RAIN_NIGHT,
         "Searchlights sweep through the rain, neon banners flicker, the waterfall thunders; slow push-in.", [], "omen"),
    shot("e02", 7, 7.5, ["seiran", "hayate_cy"], "Seiran stands on a tiled pagoda rooftop in the rain with his bow, looking down at a "
         "lantern on the river; behind him a white cyber-ninja lands silently on the roof ridge. " + RAIN_NIGHT,
         "The cyber-ninja drops silently onto the ridge behind him; Seiran's eyes flick sideways.", [], "omen"),
    shot("e03", 6, 7.5, ["seiran", "hayate_cy"], "Seiran spins around with an arrow drawn, facing the masked cyber-ninja across the wet "
         "rooftop, both still, tense standoff, no dragons, no magic effects. " + RAIN_NIGHT,
         "Seiran draws and speaks; the cyber-ninja answers calmly, his scarf whipping in the wind.",
         [("seiran", "Vanguard. You came a long way to die."), ("hayate_m", "I came for the Koryu heir.")], "battle"),
    shot("e04", 6, 6.5, ["seiran"], "Close-up of Seiran, cold and bitter, the arrow at full draw, rain dripping from his beard. "
         + RAIN_NIGHT,
         "He speaks coldly, then looses the arrow.",
         [("seiran", "There is no Koryu. There is no heir.")], "battle"),
    shot("e05", 6, 6, ["hayate_cy"], "The cyber-ninja deflects a volley of arrows with his blade in a shower of sparks on the rooftop. "
         "Dynamic action frame. " + RAIN_NIGHT,
         "Arrows streak in and he cuts them out of the air, sparks bursting, rain spraying off the blade.", [], "battle"),
    shot("e06", 6, 6, ["hayate_cy", "seiran"], "Rooftop chase in the rain: the cyber-ninja throws spinning koi-scale shuriken while the "
         "archer kicks off the air itself in a burst of blue water to dodge. Dynamic wide action. " + RAIN_NIGHT,
         "Shuriken spin through the rain; the archer kicks off the air and flips over them; they race along the rooftops.", [],
         "battle"),
    shot("e07", 6, 6, ["seiran", "hayate_cy"], "The archer fires a singing arrow that strikes a roof beam and releases a ring of blue "
         "sonar light that reveals the dashing cyber-ninja mid-air. " + RAIN_NIGHT,
         "The arrow strikes, a blue sonar ring expands through the rain and outlines the cyber-ninja in mid-dash.", [], "battle"),
    shot("e08", 6, 6, ["seiran", "hayate_cy"], "Close combat on the roof ridge: blade against bow, sparks, rain, the waterfall behind. "
         "Dynamic action frame. " + RAIN_NIGHT,
         "They trade fast close blows along the ridge, sparks flying, tiles shattering underfoot.", [], "battle"),
    shot("e09", 7, 7.5, ["seiran"], "Seiran draws his bow to the sky and two enormous glowing azure spirit koi-dragons coil out of the "
         "rain around the arrow, his eyes blazing blue. Epic low angle. " + RAIN_NIGHT,
         "Two azure koi-dragons spiral out around the drawn arrow, roaring, his hair and coat blown back.",
         [("seiran", "Twin Koi... Torrent!")], "rise"),
    shot("e10", 7, 7.5, ["hayate_cy"], "The cyber-ninja draws a long nodachi from his back and a huge glowing violet spirit koi-dragon "
         "coils up around him, his visor blazing. Epic low angle. " + RAIN_NIGHT,
         "He draws the nodachi in one motion and the violet koi-dragon erupts and coils around him, roaring.",
         [("hayate_m", "Dragon Gate... Blade!")], "rise"),
    shot("e11", 7, 7, [], "Over the night waterfall, two azure spirit koi-dragons and one violet spirit koi-dragon collide head-on in "
         "an explosion of light and water, a shockwave spraying the rain outward. Epic wide shot.",
         "The dragons crash together, a shockwave of light and water bursts outward, the waterfall spray blasts upward.", [], "rise"),
    shot("e12", 8, 9, [], "Above the waterfall a long serpentine azure spirit koi-dragon and a long serpentine violet spirit "
         "koi-dragon - Eastern dragons with koi fins and whiskers, NO wings - stop fighting and circle each other nose to tail, "
         "their bodies forming a huge glowing yin and yang circle in the night sky, the rain turning to drifting light. Awe.",
         "The two dragons circle each other gently, nose to tail, spinning into a glowing yin and yang; the rain glitters.",
         [("n", "But two koi of the same river do not fight. They find each other.")], "rise"),
    shot("e13", 6, 7, ["seiran"], "Seiran stunned, lowering his bow, staring up at the circling dragons, the light on his face, mouth "
         "open. " + RAIN_NIGHT,
         "He slowly lowers the bow, staring, and whispers; the dragon light dances on his face.",
         [("seiran", "Impossible. Only Koryu blood can call the dragon. Who are you?")], "rise"),
    dict(id="e14", kind="still", gen=0, secs=5, chars=[], key="@a11", motion="", lines=[], cue="rise", fx="push|glow"),
    shot("e15", 7, 4.4, ["hayate_cy"], "The cyber-ninja reaches up and lifts the horned white helmet off his head, the teal visor light "
         "fading, rain on the armour. Medium close-up, from slightly behind, face still hidden in shadow.",
         "He slowly lifts the helmet away, water running off it; the camera begins to circle toward his face.", [], "rise"),
    shot("e16", 7, 8, ["hayate_face"], "Hayate's face revealed in the rain: spiky black hair with jade tips, a scar across his nose, one "
         "jade eye and one glowing teal cybernetic eye, a crooked familiar grin, the helmet under his arm. Close-up. " + RAIN_NIGHT,
         "He looks up with a crooked grin and speaks; rain drips from his hair; the cyber eye glows softly.",
         [("hayate", "You still pull your bow to the left, brother.")], "rise"),
    shot("e17", 6, 7, ["seiran"], "Extreme close-up of Seiran, tears mixing with the rain, his lips trembling. " + RAIN_NIGHT,
         "His eyes fill and his lips tremble as he whispers.",
         [("seiran", "Hayate. I killed you.")], "calm"),
    shot("e18", 6, 7, ["hayate_face"], "Hayate grinning through the rain, a little cocky, a little sad. Close-up. " + RAIN_NIGHT,
         "He shrugs and grins as he speaks.",
         [("hayate", "You missed. You always were second best.")], "calm"),
    shot("e19", 6, 6.5, [], "Close-up in the rain: two hands, one a man's hand, one a white armoured hand, bringing together two halves "
         "of a jade pendant, a black koi and a white koi, forming a glowing yin and yang.",
         "The halves meet and lock together, a soft jade light blooms; raindrops glitter around it.", [], "rise"),
    shot("e20", 8, 9.5, ["hayate_face", "seiran"], "On the rooftop Hayate offers his hand and Seiran takes it; the rain stops and the "
         "full moon breaks through the clouds behind them over the waterfall. Wide, emotional.",
         "Seiran grips the offered hand; the clouds part and moonlight floods the rooftop; Hayate speaks.",
         [("hayate", "Come home, brother. Not to the clan. To something better.")], "rise"),
    # ===================================================================================================== FINAL. THE VANGUARD
    card("t07", 4, "FINAL EPISODE\nTHE VANGUARD", "dawn"),
    shot("f01", 7, 7.5, ["hayate_cy", "seiran", "tenkai"], "Dawn: the white cyber-ninja leads the bearded archer into the vast Hangar "
         "Zero, the giant white-and-gold robot Tenkai-Oh towering over them, golden light pouring through the open doors. " + DAWN,
         "They walk in side by side, the archer looking up at the giant robot in awe; dust motes in the light.", [], "dawn"),
    shot("f02", 7, 8, ["haruto", "mirei", "kaien", "raijin", "yuzu"], "The Vanguard team turns to face the newcomers in the hangar: "
         "the boy pilot grinning in front, the silver-haired girl with crystal wings, the monk, the blond swordsman, the orange-haired "
         "archer. Warm dawn light. " + DAWN,
         "The boy pilot steps forward grinning and speaks; the others exchange glances.",
         [("haruto", "So you're the brother. He would not shut up about you.")], "dawn"),
    shot("f03", 6, 7.5, ["raijin", "mirei"], "The blond swordsman with crossed arms raises an eyebrow, while the silver-haired girl "
         "elbows him. Comic beat, warm light.",
         "He speaks with a smirk; she elbows him and says his name sharply.",
         [("raijin", "The guy who shot him off a waterfall? And we're just fine with that?"), ("mirei", "Raijin.")], "dawn"),
    shot("f04", 6, 7.5, ["yuzu", "seiran"], "Inside the steel hangar of Hangar Zero, morning light through the big doors: the orange-haired "
         "girl archer walks up to the bearded archer and looks at his bow, then up at him with a small sad smile.",
         "She studies his bow, looks up and speaks softly; he looks down at her.",
         [("yuzu", "Another archer. Good. You got your brother back. Don't lose him again.")], "dawn"),
    shot("f05", 6, 7, ["seiran"], "The bearded archer bows deeply to the team, his fist over his heart, dawn light behind him. " + DAWN,
         "He bows low and speaks, then straightens.",
         [("seiran", "I have a debt to pay. Let me pay it with you.")], "dawn"),
    shot("f06", 8, 9, ["hayate_cy", "seiran", "haruto", "mirei", "kaien"], "Group shot on the hangar deck at sunrise, the team standing "
         "together, the giant robot behind them, and in the golden sky an azure dragon and a violet dragon swirl into a glowing yin "
         "and yang. Triumphant. " + DAWN,
         "The dragons swirl together in the sky above as the camera cranes up over the team; the robot's visor glows.",
         [("n", "Two koi climbed the Dragon Gate. Two dragons came home.")], "dawn"),
    shot("f07", 7, 7.5, ["hayate_face", "seiran"], "Night on the hangar roof: the two brothers sit side by side eating fish-shaped "
         "taiyaki and laughing under the stars, Hayate in his white armour with the helmet off beside him, the river glittering "
         "below. Warm and peaceful.",
         "The younger brother says something with his mouth full; the elder says no; both burst out laughing.",
         [("hayate", "So, when I'm leader..."), ("seiran", "No.")], "calm"),
    card("t08", 6, "ZENITH//UMBRA\nTWIN DRAGONS", "dawn"),
    shot("f08", 7, 8, ["vorn", "nocturne"], "Stinger: in a crimson war room, Warlord Vorn crushes a paper koi lantern in his gloved "
         "fist, while the white-haired diva smiles behind him. Dark crimson light.",
         "He crushes the lantern slowly and speaks; she smiles behind him; red light flickers.",
         [("vorn", "Then the Koryu will drown together.")], "dread"),
    card("t09", 4, "TO BE CONTINUED", "dread"),
]

if __name__ == "__main__":
    clips = [s for s in S if s["kind"] == "clip"]
    gen = sum(s["gen"] for s in clips)
    print(len(S), "shots;", len(clips), "clips;", gen, "s of video ->", f"${gen * 0.032:.2f};",
          f"keyframes ~${len([s for s in S if s['kind'] != 'card']) * 0.022:.2f};", "cut", sum(s["secs"] for s in S), "s")
