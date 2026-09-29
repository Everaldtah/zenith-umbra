# First-person viewmodel spec (#7) - Overwatch 2 references -> our 16 viewmodels

For evera-c1 to apply (FP_STYLE in src/render/FirstPerson.ts, fp_arms.py / fp_choreo.py clips) and for system32-82's Tripo
hand/weapon assets. Written by evera-b6, 2026-09-29. Measured from `node tests/e2e/fp_strip.mjs <all> idle 1` at the
anim-upgrade head (1b3f0e8); grid: work/qc_fp_idle.jpg (in the zu-maps worktree), thirds guides in yellow.

## 0. What's wrong now (why the user sees "weird, cube-like hands")
1. **The hands are the world model's hands.** Tripo meshes have mitten hands with no separable fingers; seen from 0.4 m
   they read as tubes and blocks (Mirei, Kaien, Nocturne, Hex, Kagemaru, Gorgoth: fingerless blobs in the bottom corners).
   OW viewmodel hands are a separate high-detail FP mesh: five jointed fingers, knuckles, nails or glove seams, and a
   sleeve cut off at mid-forearm. **Fix: FP-only hand meshes (system32-82) + finger poses per grip (c1).**
2. **Procedural box guns.** Haruto's and Hibiki's weapons are stand-in boxes -> real props (Tripo).
3. **Things crowd the reticle.** Yuzu's and Seiran's bow grip sits at (0.44, 0.68) of the screen with the bow limb over
   the centre-left, and the caster heroes' hands float at y 0.65-0.73 (OW keeps idle hands below y ~0.8).
   Tenkai's hammer head fills the top-left third.

## 1. Rules taken from Overwatch (GDC 2017 "The First Person Animation of Overwatch", Matt Boehm; NDC notes)
- **Sightlines first.** Nothing sits in the centre box (x 0.40-0.60, y 0.35-0.65) at idle; only fast actions (a swing, a
  throw) cross it, for about 0.1 s. They moved Widowmaker's rifle because it blocked the right side, and moved
  Soldier: 76's reload to the left hand so it wouldn't block the view.
- **Coverage:** at idle the viewmodel covers about 12-22% of the screen (tanks up to ~25%). Hands and weapons enter from
  the bottom edge or bottom corners; the rear of a gun can leave the frame.
- **Personality lives in idle, fire and reload.** Genji: fast legs, calm steady upper body. Cassidy: the arm stretches
  out on the shot, then snaps back up. Genji's Dragonblade stretches like rubber when drawn and swung. D.Va spins her
  pistol. Roadhog smashes scrap into the gun. Exaggeration is fine because only the player sees it.
- **Aim and roll additives:** the arms lag behind camera rotation on a spring (yaw/pitch drag plus a roll into turns),
  layered on every clip.
- **Clean over detailed:** strip anything that flickers or fills the screen (sleeve cloth, tassels, big pauldrons).
  That's our existing squeeze/drape/clip, which is right.

## 2. Reference layouts (fractions of a 16:9 screen, 0,0 = top left; our FP camera is 58 deg vertical)
Conversion to FP_STYLE view metres at depth z: `x = (2fx-1)*z*0.985`, `y = (1-2fy)*z*0.554`.

| type (OW reference) | main hand | off hand | weapon read | idle | fire | reload / special | melee |
|---|---|---|---|---|---|---|---|
| one-hand pistol (Cassidy, D.Va light gun) | R grip (0.72, 0.86); muzzle (0.60, 0.68) | hidden, or low-left for tricks | gun ~20% of width, canted 10 deg in | slow breathe + a pistol spin every ~12 s | kick up 6-10 deg + arm stretches 3 cm forward, snaps back in 0.15 s | tip the gun in, left hand enters from bottom-left | left-hand jab or pistol-whip from the right |
| sonic blaster (Lucio) | R grip (0.73, 0.90); speaker to (0.58, 0.66) | L low (0.27, 0.97), taps the dial on song swap | chunky amp ~28% width | head-nod bob on the beat | 4-shot burst: 4 small kicks, speaker cone pulses | swap = left hand spins a dial | left forearm shove |
| scattergun + knife (Junker Queen) | R grip (0.72, 0.90); muzzle (0.60, 0.64) | L reverse-grip knife low-left (0.22, 0.95) | gun ~25% width | knife flips in the left hand | heavy kick 12 deg + pump | shells thumbed in with the left hand (knife tucked) | knife slash left to right |
| twin chainguns (Mauga) | R grip below frame (0.83, 1.08) | L mirror (0.17, 1.08) | both muzzles angled in to (0.40 / 0.60, 0.72) | barrels idle-spin | spin-up shake, alternating recoil L/R | none (overheat vents steam) | shoulder charge, both guns dip |
| bow (Hanzo) | **SUPERSEDED - see docs/research/archer_fp_study.md.** Measured: L fist at bottom-centre (0.46-0.48, 0.75-0.89); bow ~80 deg from vertical across the bottom (upper limb right); arrow down the view just below the reticle | draw hand out of frame at full draw | bottom 15-40% band only | - | draw 450-500 ms, loose | loose -> nocked 530 ms: 330 ms follow-through, then a 170 ms reach from the upper-right edge (quiver) | bow strike |
| katana (Genji Dragonblade) | R grip (0.74, 0.93); blade up-left to tip (0.58, 0.40) | L on the scabbard, low-left (0.30, 1.02) | blade crosses to the right of the reticle | blade drifts, a slow wrist roll | slash: full-screen sweep with smear frames and rubber stretch, alternating diagonals; the blade exits frame | sheathe/draw: blade drawn from lower-left across | the slash is the melee |
| thrown blades (Genji shuriken, Kiriko kunai) | R (0.72, 0.88), three blades fanned between the fingers | L (0.28, 0.90) for the alt fan | small, crisp | fingers roll the blades | flick forward to (0.60, 0.70), a fresh blade appears | new blades slide out of the sleeve | backhand |
| talismans / caster (Kiriko ofuda, Moira, Zenyatta) | R palm up (0.72-0.74, 0.84-0.90) | L palm (0.26-0.28, 0.84-0.90) | open hands with fingers splayed; the FX come from the palms | fingers flex one at a time (a wave), slow drift | the cast hand pushes forward and up 6 cm, fingers splay; FX leave the palm | talismans fan out between the fingers | palm strike |
| gauntlets (Doomfist) | R gauntlet (0.74, 0.86) | L gauntlet (0.26, 0.90) | fists big (~25% width), knuckles forward | knuckle crack / flex | both fists kick with the shot | - | the punch *is* the melee (straight right) |
| hammer (Reinhardt) | R grip (0.74, 0.97) | L grip (0.64, 1.02) | head resting up-right (0.86, 0.28), handle diagonal to the bottom-right | a slow sway, head bobbing on steps | swing: wind up right, sweep right-to-left through mid-screen, follow-through exits left, smear | shield: camera to 3rd person (done) | the swing is the melee |
| staff (Mercy) | R staff grip (0.76, 0.93), tip up-left to (0.62, 0.52) | hidden (0.26, 1.04) | staff ~6% width, a thin diagonal | the staff tip bobs gently, wings flutter in view on landing | beam: the staff points at the target and the tip glows | switch to pistol: the staff swings out bottom-right, the pistol swings in | staff bop |
| mech arms (D.Va mech) | R cannon arm (0.78, 0.92) | L (0.22, 0.92) | muzzles angled in to (0.60 / 0.40, 0.70) | cockpit hum, arms settle | alternating barrel kicks | - | mech punch |

## 3. Per hero: reference, current -> target (FP_STYLE view metres)
Current screen positions come from the current FP_STYLE; targets from the table above.

| hero | reference | grip now | R now (screen) | R target [x, y, z] | L now (screen) | L target [x, y, z] | gunScale | notes |
|---|---|---|---|---|---|---|---|---|
| tenkai | Reinhardt | hammer | (0.82, 1.12) | [0.19, -0.21, 0.40] | (0.65, 1.09) | [0.13, -0.27, 0.46] | 0.8 | hammer head rests up-right, NOT across the top-left (it covers the left third now) |
| haruto | D.Va light gun / Cassidy | pistol | (0.67, 0.77) | [0.17, -0.16, 0.40] | (0.59, 0.88) | null (hidden) | 1.0 | needs a real Sunspark Blaster prop (the box gun reads as a cube) |
| mirei | Mercy | caster | (0.68, 0.73) | [0.22, -0.20, 0.42] | (0.30, 0.76) | [-0.19, -0.24, 0.40] | - | new grip 'staff' (beam) + pistol for the star shots; asset: prop_mirei_staff |
| kaien | Kiriko (ofuda) | caster | (0.68, 0.66) | [0.21, -0.20, 0.44] | (0.31, 0.68) | [-0.21, -0.17, 0.46] | - | L holds 5 paper talismans fanned; R two-finger seal gesture with prayer beads; hands currently too high |
| raijin | Genji Dragonblade | katana | (0.74, 0.83) | [0.21, -0.21, 0.44] | (0.59, 0.89) | [-0.17, -0.24, 0.42] | - | L should hold the scabbard low-left, not sit under the blade; blade tip right of the reticle |
| yuzu | Hanzo | bow | see docs/research/archer_fp_study.md section 1a (this row's targets were wrong: an upright bow) | | | | | | |
| seiran | Hanzo | bow | see docs/research/archer_fp_study.md section 1a (this row's targets were wrong: an upright bow) | | | | | | |
| gorgoth | D.Va mech | shotgun | (0.80, 1.00) | [0.22, -0.19, 0.40] | (0.54, 0.78) | [-0.22, -0.19, 0.40] | 0.8 | mech forearms in both lower corners; the L hand now sits in the centre bottom (a black blob) |
| nocturne | Moira | caster | (0.67, 0.65) | [0.17, -0.17, 0.42] | (0.32, 0.68) | [-0.18, -0.19, 0.42] | - | long elegant fingers, dark nails; crimson beam from the R palm, an orb hovering over the L |
| hex | Moira / Zenyatta | caster | (0.67, 0.73) | [0.18, -0.16, 0.42] | (0.34, 0.73) | [-0.18, -0.16, 0.42] | - | white gloves, five fingers each, violet strings from every fingertip (needs real fingers most of all) |
| kagemaru | Kiriko kunai | kunai | (0.73, 0.77) | [0.19, -0.16, 0.40] | (0.25, 0.84) | [-0.20, -0.23, 0.40] | - | reverse-grip kunai in R; L low with shadow wisps |
| enra | Doomfist | fists | (0.73, 0.79) | [0.21, -0.18, 0.44] | (0.27, 0.79) | [-0.21, -0.20, 0.44] | - | burning gauntlets: big, clean silhouettes; the chain wrapped on the R forearm; beam from the R palm |
| gantetsu | Mauga | dual | (0.83, 1.08) | keep [0.36, -0.36, 0.56] | (0.17, 1.08) | keep | 0.8 | already right: the best-reading viewmodel now |
| hibiki | Lucio | pistol | (0.74, 0.80) | [0.20, -0.20, 0.44] | (0.20, 1.18) | [-0.18, -0.21, 0.40] | 1.0 | lower the amp; show the L hand (dial taps on song swap); needs a real blaster prop |
| tomoe | Junker Queen | shotgun | (0.74, 0.91) | keep R | (0.19, 1.19) | [-0.21, -0.19, 0.38] | - | bring the knife hand up into view (it's below the frame now) |
| hayate | Genji shuriken | kunai | (0.71, 0.69) | [0.17, -0.17, 0.40] | (0.28, 0.75) | [-0.17, -0.18, 0.40] | - | hands lower; three koi-scale shuriken fanned in the R fingers; Dragonblade uses the katana row |

(vorn: when he's given a viewmodel, use the haruto row with heavier recoil.)

## 4. Aim / roll additive (layered on clips and procedural poses)
- Yaw lag: rotate the viewmodel by `-0.035 * yawRate` rad (yawRate in rad/s), clamp at 0.12 rad (7 deg). Pitch lag:
  `-0.03 * pitchRate`, clamp 0.09 rad.
- Roll into turns: `+0.05 * yawRate` rad about the forward axis, clamp 0.14 rad.
- Critically damped spring back: about 6 Hz, zeta 0.8 (settles in ~0.2 s, no wobble).
- Walk bob: 7 mm vertical at step frequency, 5 mm lateral at half of it; sprint x1.6; Hibiki's groove x0.5 (a skater
  glides). Landing dip 30 mm, back in 0.25 s. Keep the bob frequency locked to the stride, not to time.
- Recoil: a spring on pitch and z (kick 3-6 deg and 2-4 cm back, recover in 0.12-0.2 s); pistols add Cassidy's forward
  arm stretch; shotguns add a 2 deg roll.

## 5. Assets for system32-82 (Tripo), per hero
- **FP hands:** one mesh per hero with both forearms from mid-forearm to fingertips, costume-matched gloves, cuffs and
  bracers. Five separate fingers with a visible gap between them. Relaxed open pose, palms down, fingers slightly spread
  (rigs well). 8-12k triangles per pair, 2K textures. Name: fp_hands_<hero>.glb.
- **Weapon props** that are now boxes or missing: prop_haruto_blaster, prop_hibiki_blaster, prop_mirei_staff (+ a
  pistol), prop_kaien_talismans (a fan of five), prop_hayate_shuriken, prop_kagemaru_kunai. Tomoe's axe, blade and
  shotgun are being remade (already on the #7 list).
- **Rigging (c1):** finger bones (Mixamo hand hierarchy) and a finger pose per grip: pistol (index on trigger),
  bow (grip plus the string pinch), katana (full wrap), caster (splayed), kunai (reverse grip), fists (closed).

## 6. Acceptance check
`node tests/e2e/fp_strip.mjs <hero> idle,fire,reload,melee 6 70` for every hero:
- nothing but transient frames inside the centre box;
- idle coverage 12-22% (tanks 25%);
- fingers readable at 1280x720;
- no sleeve or pauldron fills a corner.
