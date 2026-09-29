"""ZENITH//UMBRA - "The Sun That Refused to Set" (10 min anime film, replaces The Oath at Dawn).

Look: a late-90s cel mecha film crossed with a hot-blooded super-robot show - long held frames, stark white-on-black
episode cards, crosses of red light in a black sky, power lines against a bleeding sunset, then escalation that keeps
getting bigger until a robot the size of a city swings a rocket hammer at a black sun.

Every shot has a painted keyframe (Seedance AI image editor, the hero's reference image in, 16:9 out). Twelve action peaks
are animated with Seedance image-to-video (`motion`); every other shot is a limited-animation cut built in make_film.py
(camera move, parallax drift, impact frames, speed lines, embers, rain, lens flashes, film grain). Narration and lines:
Kokoro TTS (voice.py). Score: the film cues in public/film/music.

The ten: Zenith Vanguard - Haruto Daimon / Tenkai-Oh, Mirei, Kaien, Raijin, Yuzu.
         Umbra Syndicate - Warlord Vorn / Gorgoth, Lady Nocturne, Kagemaru, Enra, Hex.
Rivals (each owns the counter to the other): Tenkai-Oh x Gorgoth (Dawn Charge vs Abyss Charge), Mirei x Nocturne (Silence
Aria vs Constellation Link), Kaien x Kagemaru (Warding Seal vs Severing Fang), Raijin x Enra (Thunder Parry vs Chain of
Oblivion), Yuzu x Hex (Revealing Dawn Arrow vs Stitched Decoy).
"""

TITLE = "THE SUN THAT REFUSED TO SET"

# appended to every keyframe prompt
STYLE = ("hand-painted 1990s cel animation film still, classic mecha anime movie, thick confident ink outlines, flat cel "
         "shading with hard-edged shadow shapes, dramatic backlight and rim light, saturated crimson, violet, gold and "
         "sky-blue palette, subtle film grain, cinematic widescreen composition, dynamic foreshortened perspective, "
         "highly detailed background painting, no text, no watermark, no speech bubbles")
# appended to every Seedance image-to-video prompt
MOTION_STYLE = ("2D cel anime animation, hand-drawn, bold ink lines, smear frames on fast motion, impact frames, "
                "speed lines, cinematic camera, 24fps anime timing, keep the character designs exactly as in the image")

# who looks like what (text carries identity; the reference image does the rest)
CHAR = {
    "haruto": "Haruto, a hot-blooded seventeen-year-old boy with messy brown hair and brown eyes, red and white armored pilot suit",
    "tenkai": "Tenkai-Oh, a giant heroic white-and-gold super robot knight with sky-blue panels, a golden sun-ray crown crest, a single golden visor and a glowing golden sun reactor in its chest",
    "hammer": "the Dawnbreaker, a colossal white-and-gold rocket war hammer with an octagonal gold striking face and a flaming rocket nozzle",
    "mirei": "Mirei, a young woman with a short silver bob and bright blue eyes, pearl-white armored bodysuit with gold trim, a blue star emblem, large mechanical angel wings of crystal-blue light",
    "mirei_child": "little Mirei, a small girl with a silver bob and big blue eyes in a white choir robe",
    "nocturne": "Lady Nocturne, a gothic diva with long flowing white hair, pale skin, crimson eyes, silver tiara, black and crimson corset gown, huge crimson bat wings",
    "nocturne_before": "the Star Choir's prima voice, a graceful woman with long silver hair in flowing white and gold choir robes, gentle smile",
    "kaien": "Kaien, a calm young monk with a black topknot, white and indigo robes with wide sleeves, a golden talisman medallion, prayer beads, a fan of glowing paper talismans",
    "kagemaru": "Kagemaru, a lean shadow ninja in a white fox mask and black hood, purple sash, dark armor, kunai",
    "kagemaru_young": "young Kagemaru, a sullen teenage orphan in a dark hooded shrine robe",
    "raijin": "Raijin, a cocky young swordsman with spiky golden-blond hair, navy-blue long coat with gold lightning-bolt trims, a katana crackling with lightning",
    "enra": "Enra, a towering oni demon in black and silver spiked armor, curved horns, a mane of fire, burning gauntlets and a huge black chain",
    "yuzu": "Yuzu, a young archer with bright orange hair in two round buns, white and orange armored bodysuit with gold trim, a golden recurve bow",
    "brother": "Yuzu's twin brother, a boy with orange hair and a long orange scarf",
    "hex": "Hex, a tall slender puppeteer in a black Victorian long coat with purple lining, a cracked white porcelain doll mask, white gloves, glowing violet strings from his fingers",
    "vorn": "Warlord Vorn, a tall stern man in his forties with short black hair and a scar across his face, black and crimson military flight coat",
    "gorgoth": "Gorgoth, a menacing giant war robot in gunmetal black armor with crimson panels, spiked shoulders, a glowing red visor slit, a drill-lance arm",
    "qelvaris": "Archon Qel'Varis, an alien scientist in violet robes with four glowing golden eyes and mechanical spider arms",
}
# reference image per character (scratchpad refs, uploaded to the Seedance editor)
REF = {"haruto": "haruto", "tenkai": "tenkai", "mirei": "mirei", "mirei_child": "mirei", "nocturne": "nocturne", "nocturne_before": "nocturne",
       "kaien": "kaien", "kagemaru": "kagemaru", "kagemaru_young": "kagemaru", "raijin": "raijin", "enra": "enra", "yuzu": "yuzu",
       "brother": "yuzu", "hex": "hex", "vorn": "vorn", "gorgoth": "gorgoth", "qelvaris": "qelvaris", "hammer": "hammer"}

NARRATOR = "bm_george"
VOICES = {"haruto": "am_michael", "kaien": "bm_lewis", "mirei": "bf_emma", "nocturne": "bf_isabella", "vorn": "am_onyx",
          "raijin": "am_fenrir", "yuzu": "af_heart", "qelvaris": "bm_fable", "enra": "am_onyx", "kagemaru": "am_puck",
          "hex": "bm_daniel", "all": "am_michael"}
SPEED = {"enra": 0.86, "vorn": 0.92, "hex": 0.9, "qelvaris": 0.88, "haruto": 1.08, "raijin": 1.05}

# (id, secs, kind, chars, keyframe prompt, camera/fx or motion prompt, lines[(who, text)], music cue)
#   kind: card (white-on-black episode card), still (limited animation), motion (Seedance image-to-video)
#   camera: push, pull, panL, panR, tiltU, tiltD, shake, hold   fx: rain, embers, sparks, speed, flash, stars, glow, smoke
S = [
    # ======================================================================= COLD OPEN
    ("c00", 5, "card", [], "ZENITH//UMBRA", "", [], "omen"),
    ("o01", 7, "still", ["tenkai"], "a giant super robot silhouette standing in a ruined city at dusk, only its golden visor glowing, a black sun with a burning corona in a blood-red sky behind it, power lines and utility poles cutting across the foreground", "push|embers", [("n", "They told us the sun would always rise.")], "omen"),
    ("o02", 6, "still", ["haruto"], "extreme close-up of a teenage boy's determined eyes reflected golden light, sweat and blood on his face, inside a cockpit lit red", "push|flash", [("haruto", "Then we'll drag it back up ourselves.")], "omen"),
    ("c01", 5, "card", [], "EPISODE 1\nTHE SKY THAT SANG", "", [], "calm"),
    # ======================================================================= I. THE SKY THAT SANG
    ("a01", 9, "motion", [], "floating sky islands above a sea of golden clouds at sunrise, ancient shrines, stone bridges and waterfalls falling into the clouds, flocks of white birds", "slow aerial glide between the floating islands, clouds drifting, waterfalls falling, birds flying past the camera", [("n", "Before the Eclipse, the sky had a voice.")], "calm"),
    ("a02", 8, "still", ["nocturne_before", "mirei_child"], "a crystal amphitheatre on a floating island under a sky full of stars, a graceful silver-haired choir mistress in white and gold robes kneels beside a little silver-haired girl, both singing, glowing notes of starlight rising from their voices", "panR|stars", [("n", "On the island of Amatsu, the Star Choir sang the heavens into balance.")], "calm"),
    ("a03", 7, "still", ["nocturne_before", "mirei_child"], "close-up of the gentle silver-haired choir mistress smiling down at the little girl, her hand on the child's cheek, constellations glowing behind them", "push|stars", [("nocturne", "Sing with me, little star. Our song will never end.")], "calm"),
    ("a04", 8, "still", ["kaien", "kagemaru_young"], "the gate of a mountain sky shrine above the clouds, a colossal sacred tree with paper talismans tied to its branches, two teenage orphans sparring with wooden staves beneath it, cherry petals in the wind", "panL|embers", [("n", "On the highest island, two orphans trained beneath the sacred tree.")], "calm"),
    ("a04b", 6, "still", ["kaien", "kagemaru_young"], "two teenage orphans laughing together on sunlit shrine steps above the clouds, sharing rice balls, their wooden staves leaning beside them", "panR|embers", [("n", "They grew up as brothers.")], "calm"),
    ("a05", 7, "still", ["kaien", "kagemaru_young"], "an old shrine master placing a glowing golden seal medallion into the hands of the young monk Kaien, while in the shadow of the gate behind them the hooded orphan Kagemaru watches with bitter eyes", "push|glow", [("n", "Only one of them was given the guardian's seal.")], "calm"),
    ("a06", 6, "still", ["kagemaru_young"], "extreme close-up of a hooded teenage boy's eyes in shadow, a single tear, the golden glow of a seal reflected in his pupils", "hold|glow", [("n", "The other never forgot it.")], "calm"),
    ("a07", 9, "motion", ["raijin"], "a neon-drenched underground dueling ring beneath a cyberpunk Japanese city in the rain, a crowd behind chain-link fences, a blond swordsman in a navy long coat lowering a katana that crackles with blue lightning over a fallen opponent", "the swordsman flicks the rain off his lightning katana and sheathes it with a crack of blue lightning, the crowd roars, neon signs flicker, heavy rain", [("n", "Far below, in the neon rain of Neo-Kurogane, Raijin never lost a duel.")], "calm"),
    ("a07b", 6, "still", ["raijin"], "a warm flashback in a small wooden dojo, a kind woman in a hakama teaching a small blond boy to hold a katana, rain on the paper windows", "push|rain", [("n", "His mother taught him the sword.")], "calm"),
    ("a08", 7, "still", ["raijin"], "a boy in black mourning clothes kneeling at a rain-soaked grave on a hill above a neon city at night, a katana planted in the grave, a bolt of lightning striking the blade and lighting the whole scene white-blue", "shake|flash|rain", [("n", "His mother's blade was struck by lightning the night they buried her.")], "calm"),
    ("a09", 8, "still", ["haruto", "tenkai", "gorgoth"], "a vast military hangar lit by shafts of light, two unfinished giant robots in scaffolding - one white and gold, one black and crimson - and far below them a small teenage boy with a broom looking up in awe", "tiltU|smoke", [("n", "In Hangar Zero, a mechanic's son swept the floor beneath two sleeping giants.")], "calm"),
    ("a09b", 6, "still", ["tenkai"], "a glowing golden sphere of captured sunlight being lowered by cranes into the open chest of a giant white and gold robot, engineers shielding their eyes", "tiltD|glow", [("n", "Its heart was a captured piece of the sun.")], "calm"),
    ("a10", 7, "still", ["vorn", "haruto"], "a tall scarred flight instructor in a black and crimson coat with his hand on a grinning teenage boy's shoulder, both looking up at a giant robot, warm hangar light", "push", [("vorn", "Never hold back, Haruto. Not in the cockpit. Not in life.")], "calm"),
    ("a11", 8, "still", ["yuzu", "brother"], "an academy archery range on a sunny terrace, an orange-haired girl releasing an arrow of golden light that splits a single falling maple leaf in half at great distance, her twin brother with a long orange scarf cheering behind her", "panR|speed", [("n", "And at Zenith Academy, Yuzu could split a falling leaf at three hundred metres."), ("yuzu", "I'll always be the better shot, little brother. Always.")], "calm"),
    ("a11b", 6, "still", ["yuzu", "brother"], "orange-haired twins sitting on an academy rooftop at sunset sharing one long orange scarf, laughing", "panL|glow", [], "calm"),
    # ======================================================================= II. THE LONGEST DAY
    ("c02", 5, "card", [], "EPISODE 2\nTHE LONGEST DAY", "", [], "dread"),
    ("b01", 9, "motion", [], "a sprawling Japanese megacity at midday, crowds on a crossing all looking up as the sun turns black, a burning corona around it, the sky bleeding from blue to crimson", "the sun goes black and the sky drains to crimson, the crowd freezes looking up, shadows sweep across the city, pigeons scatter", [("n", "Then, on the longest day of the year, the sun went black.")], "dread"),
    ("b01b", 6, "still", ["mirei_child"], "extreme close-up of a little silver-haired girl's wide blue eyes reflecting a black sun with a burning corona", "push|flash", [], "dread"),
    ("b02", 7, "still", [], "a giant crimson cross of light erupting on the horizon behind silhouetted power lines and a train crossing, a jagged rift of violet light tearing open the black sky above it", "pull|flash|smoke", [("n", "The sky tore open. They called it the Eclipse Rift.")], "dread"),
    ("b03", 8, "still", ["nocturne", "mirei_child"], "under a huge crimson moon, a silver-haired woman in torn choir robes drinks the red moonlight, her hair turning white, crimson bat wings bursting from her back, while a small silver-haired girl reaches out to her crying", "push|embers", [("n", "The prima voice traded her light for a song that would never end."), ("nocturne", "Forgive me, little star.")], "dread"),
    ("b04", 8, "still", ["kagemaru", "kaien"], "a masked ninja in a white fox mask standing before a colossal sacred tree engulfed in flames at night, paper talismans burning and flying into the sky, a monk running up the shrine steps too late", "shake|embers", [("kagemaru", "Seals mean nothing. I'll prove it.")], "dread"),
    ("b04b", 6, "still", ["kaien"], "a young monk kneeling before a burned black sacred tree at dawn, ash falling like snow, clutching a golden seal medallion to his chest", "pull|smoke", [("kaien", "Kagemaru... why?")], "dread"),
    ("b05", 9, "motion", ["enra"], "a colossal stone seal beneath a neon city cracking apart, a giant horned oni demon in black spiked armor with a mane of fire bursting up through the street, cars flying, fire everywhere", "the ground cracks and the oni demon erupts upward through the street, fire exploding outward, debris and cars flung into the air, the camera shakes", [("n", "Beneath Neo-Kurogane, something that had slept for a thousand years woke up hungry.")], "dread"),
    ("b06", 7, "still", ["enra", "raijin"], "a burning city district at night, a giant oni laughing with fire pouring from his mouth, a young blond swordsman standing small in the burning street in front of him, gripping a lightning katana", "tiltU|embers|shake", [("enra", "That blade. I remember that blade.")], "dread"),
    ("b06b", 6, "still", ["raijin"], "a blond swordsman screaming in a burning street, blue lightning exploding from his katana, his coat whipping in the firestorm", "shake|embers|flash", [], "dread"),
    ("b07", 9, "motion", ["gorgoth", "vorn"], "a black and crimson giant war robot in a dark hangar, its red visor slit igniting, a scarred man visible in its open cockpit, sparks and alarms", "the black robot's red eye ignites, it rips free of the scaffolding and smashes through the hangar wall into the night, alarms flashing red", [("n", "And the man who taught Haruto never to hold back stole the black giant and walked out into the dark.")], "dread"),
    ("b08", 7, "still", ["haruto", "tenkai"], "a teenage boy on his knees in a wrecked hangar full of smoke, looking up at the dark, silent white and gold giant robot with an empty open cockpit in its chest, a single shaft of light", "push|smoke", [("haruto", "Why, sensei?")], "dread"),
    ("b09", 8, "still", ["yuzu", "brother"], "a crimson rift tearing open above a training field, an orange-haired boy being pulled up into it, his long orange scarf trailing, his twin sister screaming and reaching for him", "shake|speed", [("yuzu", "Little brother! No!")], "dread"),
    ("b10", 8, "still", ["hex"], "a dark puppet theatre, a tall figure in a cracked porcelain doll mask and a black Victorian coat stitching a life-size doll on a table, violet strings glowing from his fingers, the doll wearing a long orange scarf", "panL|glow", [("hex", "Such a promising student.")], "dread"),
    ("b10b", 6, "still", ["brother"], "extreme close-up of a porcelain doll's stitched eyes snapping open with a violet glow, a long orange scarf around its neck", "push|glow", [], "dread"),
    ("b11", 8, "still", ["gorgoth", "nocturne", "kagemaru", "enra", "hex"], "five villains lined up in silhouette against a black sun and a crimson sky on top of a ruined skyscraper - a giant black war robot, a winged diva, a fox-masked ninja, a horned fire oni and a masked puppeteer - their eyes glowing", "pull|embers", [("n", "They called themselves the Umbra Syndicate.")], "dread"),
    # ======================================================================= III. THE OATH
    ("c03", 5, "card", [], "EPISODE 3\nFIVE WHO STOOD UP", "", [], "rise"),
    ("d01", 8, "still", ["mirei"], "a silver-haired young woman on a mountaintop at night pulling threads of starlight out of the sky and weaving them into large mechanical angel wings of crystal-blue light", "tiltU|stars", [("n", "Mirei stitched her wings from the stars she had sung to.")], "rise"),
    ("d01b", 6, "still", ["mirei"], "a silver-haired girl with crystal-blue light wings bursting up through a sea of clouds into the night sky for her first flight, a trail of stars behind her", "tiltU|stars|speed", [], "rise"),
    ("d02", 7, "still", ["kaien"], "a young monk walking down endless mountain steps for the first time, ten thousand glowing paper talismans swirling around him like a storm of birds", "panR|glow", [("n", "Kaien left his mountain for the first time, with ten thousand talismans and one name.")], "rise"),
    ("d03", 7, "still", ["raijin"], "a blond swordsman raising a lightning katana to a stormy sky on a rooftop in the rain, lightning striking the blade", "push|rain|flash", [("raijin", "Laugh while you can, oni.")], "rise"),
    ("d04", 7, "still", ["yuzu"], "an orange-haired archer drawing a golden bow on a rooftop at dawn, tears in her eyes, an orange scarf tied around her wrist", "push|glow", [("yuzu", "Hold on. I'm coming to get you.")], "rise"),
    ("d04b", 7, "still", ["haruto", "raijin"], "a teenage pilot in a red and white suit offering his hand to a blond swordsman in a navy coat on a rainy rooftop, neon city behind", "push|rain", [("haruto", "We could use a blade like that."), ("raijin", "Try to keep up.")], "rise"),
    ("d05", 9, "motion", ["haruto", "tenkai"], "a teenage pilot in a red and white suit climbing into the glowing golden cockpit in the chest of a giant white and gold robot, cockpit screens lighting up", "the pilot slams his hands onto the controls, the golden sun reactor in the robot's chest ignites, light floods the cockpit, the robot's golden visor blazes on", [("haruto", "Wake up, Tenkai-Oh! We're not holding back!")], "rise"),
    ("d06", 9, "motion", ["tenkai", "hammer"], "a giant white and gold super robot knight rising in a hangar with a colossal rocket war hammer, heel thrusters blazing, a golden sun-ray crest behind its head", "the giant robot rises to its full height and swings the rocket hammer up onto its shoulder, the hammer's rocket nozzle roars, dust and sparks blow past the camera, heroic low angle", [], "rise"),
    ("d06b", 6, "still", ["tenkai"], "extreme close-up of a giant robot's golden visor igniting with a blinding lens flare, the golden sun-ray crest glowing", "push|flash|glow", [], "rise"),
    ("d07", 9, "still", ["haruto", "mirei", "kaien", "raijin", "yuzu", "tenkai"], "five young heroes standing together on top of a hangar at dawn, a pilot, a winged girl, a monk, a blond swordsman and an archer, their fists together in an oath, a kneeling white and gold giant robot behind them, the sun rising", "tiltU|glow", [("n", "Five who refused to let the dark win."), ("all", "Zenith Vanguard!")], "rise"),
    # ======================================================================= IV. NIGHT OF THE CRIMSON MOON
    ("c04", 5, "card", [], "EPISODE 4\nNIGHT OF THE CRIMSON MOON", "", [], "battle"),
    ("e01", 8, "still", ["gorgoth", "nocturne", "enra"], "a neon city under a giant crimson moon, a black war robot stomping down an avenue, a winged diva flying above it, a fire oni on a rooftop, explosions and searchlights", "pull|embers|shake", [("n", "The Syndicate came for the city on the night of the crimson moon.")], "battle"),
    ("e01b", 6, "still", ["kaien"], "a monk raising a dome of glowing golden paper talismans over a crowd of fleeing civilians as fire rains down on a neon street", "tiltU|embers|glow", [("kaien", "Go! The seals will hold!")], "battle"),
    ("e02", 7, "still", ["nocturne", "mirei"], "a sky duel above the city: a white-haired diva with crimson bat wings unleashing a wave of crimson sound, facing a silver-haired girl with crystal-blue star wings, the crimson moon between them", "panR|stars", [("nocturne", "You still sing my lullaby, little star.")], "battle"),
    ("e03", 9, "motion", ["mirei", "nocturne"], "a silver-haired girl with crystal-blue light wings singing a pure blue beam of sound against a white-haired diva with crimson bat wings, crimson and blue shockwaves colliding in the sky", "the blue beam of song pushes through the crimson wave, notes of light shatter into sparks, both singers' hair and wings whip in the shockwave, the camera circles", [("mirei", "Then listen to it!")], "battle"),
    ("e04", 6, "still", ["nocturne"], "close-up of the white-haired diva faltering in midair, crimson eyes wide, a single tear, a blue note of light reflected in them", "push|stars", [("n", "For a moment, the diva remembered the girl.")], "battle"),
    ("e05", 7, "still", ["kagemaru", "kaien"], "a fox-masked ninja blinking through shadows toward a monk in white robes in a burning shrine courtyard, afterimages of the ninja in violet smoke", "speed|panL", [("kagemaru", "Your seals are paper, brother.")], "battle"),
    ("e06", 7, "still", ["kaien", "kagemaru"], "a monk raising a huge golden warding seal of glowing kanji-like sigils, a ninja's shadow blade shattering against it in a burst of golden sparks", "shake|flash|sparks", [("kaien", "Paper that remembers who we were.")], "battle"),
    ("e07", 6, "still", ["kagemaru"], "close-up of a white fox mask cracking down the middle, a young man's angry eye visible through the crack, sparks", "push|sparks", [], "battle"),
    ("e08", 7, "still", ["enra", "raijin"], "a fire oni hurling a huge flaming black chain at a young blond swordsman on a burning rooftop", "speed|embers", [("enra", "Burn with your district, boy!")], "battle"),
    ("e09", 9, "motion", ["raijin", "enra"], "a blond swordsman with a lightning katana parrying a flaming black chain, blue lightning racing up the chain toward the fire oni", "the swordsman parries, the chain wraps the lightning katana, blue lightning races up the chain and explodes against the oni's armor, sparks and fire everywhere", [("raijin", "Thunder... Parry!")], "battle"),
    ("e10", 6, "still", ["enra"], "the fire oni grown into a gigantic six-armed asura form roaring, blue lightning cracking through his black armor, the city burning below", "tiltU|shake|embers", [], "battle"),
    ("e11", 7, "still", ["hex", "yuzu"], "an orange-haired archer surrounded by a dozen identical masked puppeteers on a theatre stage lit by violet spotlights, puppet strings everywhere", "panR|glow", [("hex", "Which one is real, little archer?")], "battle"),
    ("e12", 7, "still", ["yuzu", "hex"], "an arrow of blazing golden dawn light flying through the theatre, the decoy puppets dissolving into threads, revealing the real masked puppeteer hiding behind the curtain", "speed|flash", [("yuzu", "Found you.")], "battle"),
    ("e13", 6, "still", ["brother"], "a life-size doll with orange hair and a long orange scarf lifting its head, its stitched lips whispering, violet strings on its wrists", "push|glow", [("n", "The doll whispered her name.")], "battle"),
    ("e14", 7, "still", ["tenkai", "gorgoth"], "two giant robots facing each other across a burning boulevard, a white and gold robot knight with a rocket hammer and a black and crimson war robot with a drill lance, crimson moon behind", "pull|embers", [("vorn", "You've grown, Haruto. Let's see if you listened.")], "battle"),
    ("e14b", 6, "still", ["vorn"], "inside a dark crimson cockpit, a scarred stern pilot calmly gripping the controls, red light across his face", "push|glow", [], "battle"),
    ("e15", 9, "motion", ["tenkai", "gorgoth"], "a white and gold robot charging on blazing rocket thrusters toward a black and crimson robot charging back with a drill lance, the street exploding under them", "the two giant robots charge and collide in the middle of the boulevard, a huge shockwave blasts the windows out of every building, debris flies at the camera", [("haruto", "Dawn Charge!")], "battle"),
    ("e16", 6, "still", ["gorgoth", "tenkai"], "a black robot's spinning drill lance shattering a hexagonal golden energy shield held up by a white robot, shards of golden light flying", "shake|sparks|flash", [], "battle"),
    ("e17", 9, "motion", ["gorgoth"], "a black war robot raising its arms as a black hole of gravity opens over the city, cars and rubble being pulled into it, lightning around its edge", "the black hole swells and pulls the street into the air, buildings bend toward it, violet lightning crawls around the event horizon, the camera is dragged toward it", [("vorn", "This is what power looks like.")], "battle"),
    ("e17b", 6, "still", ["yuzu", "raijin", "mirei"], "heroes being dragged into the air toward a black hole over a city, an archer firing golden arrows, a swordsman stabbing his lightning katana into the street to anchor himself, a winged girl fighting the pull", "shake|speed|sparks", [], "battle"),
    ("e18", 6, "still", ["haruto"], "inside a cockpit flashing red with warning lights, the teenage pilot bleeding from the forehead, cracked screens, gritting his teeth", "shake|flash", [("vorn", "Hold back, and you lose everything.")], "battle"),
    ("e19", 6, "still", ["haruto"], "the teenage pilot grinning fiercely through the blood, eyes blazing gold, gripping the controls", "push|glow", [("haruto", "You taught me never to hold back!")], "battle"),
    # ======================================================================= V. DAWN
    ("c05", 5, "card", [], "FINAL EPISODE\nDAWN", "", [], "dawn"),
    ("f01", 9, "motion", ["tenkai", "mirei", "kaien", "raijin", "yuzu"], "a white and gold robot knight at the center of a colossal spiral of golden light, blue starlight, golden seals, blue lightning and golden arrows flowing into it from four heroes around it", "the robot grows into a gigantic colossus inside the spiral of light, its sun reactor blazing, the four powers pouring into it, the camera pulls back and back as it becomes bigger than the skyscrapers", [("n", "Four lights answered.")], "dawn"),
    ("f02", 7, "still", ["tenkai", "hammer"], "a colossal white and gold super robot bigger than the skyscrapers raising a gigantic rocket hammer toward a black sun, the rocket nozzle blazing, tiny city below", "tiltU|glow|embers", [("haruto", "This sun... never sets!")], "dawn"),
    ("f02b", 6, "still", ["haruto", "mirei", "kaien", "raijin", "yuzu", "tenkai"], "from street level, four tiny heroes on a rooftop cheering in front of the gigantic golden eyes of a colossal robot that fills the whole sky", "tiltU|glow", [], "dawn"),
    ("f03", 9, "motion", ["tenkai", "hammer"], "a colossal robot swinging a gigantic flaming rocket hammer down into a black hole over the city", "the rocket hammer smashes into the black hole, it cracks like glass, golden dawn light bursts out of the cracks and floods the whole sky, impact frames", [], "dawn"),
    ("f04", 7, "still", [], "golden dawn light washing over the rooftops of a damaged city, the black sun cracking and shattering in the sky, people on the streets shielding their eyes and looking up", "pull|glow", [("n", "And the sun rose.")], "dawn"),
    ("f04b", 7, "still", ["tenkai"], "children on a rooftop waving at a colossal white and gold robot as it shrinks back down in a shower of golden particles over the dawn city", "pull|glow|stars", [], "dawn"),
    ("f05", 7, "still", ["nocturne", "kagemaru"], "villains retreating into the shadows at dawn: a winged diva looking back over her shoulder humming, a ninja holding a cracked fox mask", "panL|smoke", [], "dawn"),
    ("f06", 6, "still", ["yuzu"], "an orange-haired archer kneeling in a ruined theatre at dawn, holding a long orange scarf to her chest, an empty doll table behind her", "push|glow", [("yuzu", "I'll find you. I promise.")], "dawn"),
    ("f07", 7, "still", ["vorn", "gorgoth"], "a wrecked black war robot sitting in the rubble at sunrise, its scarred pilot standing on its shoulder looking into the rising sun with a faint proud smile", "push|glow", [("vorn", "Good. Never hold back.")], "dawn"),
    ("f08", 9, "still", ["haruto", "mirei", "kaien", "raijin", "yuzu", "tenkai"], "five young heroes on a rooftop at sunrise, the white and gold giant robot kneeling behind them with its hammer planted, the city below, the sky clear and golden", "pull|glow", [("n", "They called themselves the Zenith Vanguard. And the war had only just begun.")], "dawn"),
    ("f09", 8, "still", ["qelvaris"], "in orbit above the planet, an alien scientist with four glowing golden eyes watching from the bridge of a vast starship, a fleet of giant space robots behind him", "push|stars", [("qelvaris", "Fascinating. A sun that refuses to set.")], "omen"),
    ("c06", 8, "card", [], "ZENITH//UMBRA\nTHE SUN THAT REFUSED TO SET", "", [], "omen"),
]

MOTION = [s[0] for s in S if s[2] == "motion"]
TOTAL = sum(s[1] for s in S)

if __name__ == "__main__":
    print(len(S), "shots,", len(MOTION), "motion,", TOTAL, "s")
