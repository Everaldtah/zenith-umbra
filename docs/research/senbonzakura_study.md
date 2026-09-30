# Senbonzakura Kageyoshi (Byakuya Kuchiki, Bleach) - reference for Kaien's Divine Seal Storm

What the user asked for: "study Byakuya's bankai Senbonzakura from Bleach and apply the same type of animation to Kaien's
new paper seal storm ultimate" - a storm of explosive golden paper seals, some of them a shield on him, the rest hunting
enemies, for about 15 s. The sim (src/game/abilities.ts sealstorm / tickAbilities) fires the events; this note is what
the swarm should look like for whoever draws it (Fx / CharacterView / FirstPerson).

## How the bankai reads on screen (from the anime and the wiki, not frame-counted)

1. **The release.** Byakuya lets the sword fall point-first; it sinks into the ground as if into water. Behind him two rows
   of giant blades rise out of the floor (a corridor of upright swords, ten or so a side, taller than him), stand for a
   beat, then dissolve top-down into the petal swarm. Cast pose: still, arm lowered, palm open after the drop.
   -> Kaien: the talismans he throws by hand rise instead - two rows of tall golden seals standing up out of the ground
   behind him (fx 'sealstorm' at cast, `r` = reach, `dur` = 15 s), holding a beat, then bursting into the swarm.

2. **The swarm.** Countless tiny blades that catch the light as cherry-blossom petals. They never fly as a cloud; they move
   as **streams**: ribbons that ripple like a wave, three to six ribbons at a time, each a few metres long and a hand-span
   wide, that curve, cross and fold back on themselves. A ribbon accelerates as it leaves him and slows as it turns.
   -> Kaien: golden seal cards in ribbons, each card tumbling slowly about its long axis, the ribbon's edges brighter.

3. **Attack.** A ribbon flows to the target, wraps or sweeps across it, and the petals grind: many small hits, not one blow
   (the anime shows a rasping burst of sparks and cloth, the victim flinching repeatedly). Byakuya steers with small hand
   motions; with both hands the swarm moves twice as fast.
   -> Kaien: per victim per beat the sim fires fx 'sealstrike' (from his centre, `to` the victim's centre) and 'sealburst'
   on the victim: draw the ribbon flowing along that path, arriving in ~0.3 s, then bursting on contact (paper scraps,
   a small golden flash, red-ink sigil lines). The beat is every 0.5 s, 14 damage, so the ribbons cycle continuously.

4. **Defence.** The petals close around him into a shell - a layered wall of them a hand's width from his body, rippling,
   that opens to let his own strikes out (the "hurtless area" of 85 cm around him where nothing cuts).
   -> Kaien: the seal shield (a Shield of kind 'sealshield', 300, re-formed at 150 every 4 s once spent) is a sphere of
   seals orbiting him at ~1 m, layered like scales, gaps opening where he fires; fx 'sealshield' when it (re)forms,
   thinning as its amount drops.

5. **Senkei (the true form).** The petals gather into thousands of complete glowing swords in four rows, ringing him and
   the opponent in a slowly turning column - all offence, no shield. **Gokei** closes every petal into a sphere around one
   target that crushes inward.
   -> Optional flourishes if the budget allows: in the last 3 s of the storm the shield thins and the remaining seals form
   the turning column (Senkei); the killing blow on a low target could be a Gokei sphere collapsing on it.

6. **The end.** The petals lose their light and fall like real blossom, drifting down and fading.
   -> Kaien: at 15 s the seals go dull, flutter down as paper and fade (no burst).

## Colour and material
Gold-leaf paper, red-ink sigils, thin dark border (the seals of the published film's Kaien shots are the reference the
user gave). In flight they should catch the light like Byakuya's petals: emissive rims, a little sparkle, warm gold
(#ffe28a / #ffd27a, the hero's glow), sigils glowing red on burst.

## Sources
- https://bleach.fandom.com/wiki/Senbonzakura_Kageyoshi (mechanics: petals, hand control doubling speed, hurtless area, Senkei, Gokei)
- https://breezewiki.discard.no/bleach/wiki/Senkei (Senkei's four turning rows)
- The anime: episode 58 (first release against Ichigo) and the Bankai vs Bankai fight (episodes 59-60) for the streams, the shield and Senkei.
