# Genji's shuriken throws, frame by frame -> Hayate's Koi-Scale Shuriken

Read-only study for the Hayate shuriken pass (the big Tripo star, the ricochet, the water, the throw animation in both
views). Source: Overwatch first-person footage (Overpwn, "Overwatch: Genji - Shuriken", 11 s, stepped at 1/30 s in the
browser) plus the Overwatch wiki for the numbers (reference only, CC BY-NC-SA). Overwatch names and animation stay the
reference; Hayate's own assets ship.

## 1. Numbers (OW, 2026)

| | primary (Shuriken) | secondary (Fan of Blades) |
|---|---|---|
| per shuriken | 27, x2 headshot | 27, x2 headshot |
| per press | 3, 0.09 s apart, straight down the reticle | 3 at once, 4.5 deg fan |
| recovery | 0.68 s | 0.68 s |
| projectile | 75 m/s, radius 0.125 m (Season 9), no falloff | the same |
| the star | a ~15 cm three-pronged steel shuriken, green glow lines | |

Hayate already matched them (27, 3 a burst 0.08 s apart, a 3-scale fan at 0.11 rad, 62 m/s). The ricochet adds on top
of that and is paid for in the balance ledger (`docs/BALANCE_PATCH.md`): 70% of the damage per extra target and two
wall skips, hunting only inside 12 m of him.

## 2. The hand, primary fire (t = 0.18-0.55 s of the clip)

- **Rest.** The right hand sits low right of the reticle (about 0.75, 0.75 of the frame), forearm angled in toward the
  centre, the next shuriken pinched between the first two fingers, blades flat to the lens.
- **Each throw is its own thrust.** Three shuriken, three thrusts, ~0.09 s apart. The forearm straightens *at the
  reticle*: the hand travels from low right to just below centre (0.45, 0.6), about a third of the frame width, and
  the shuriken leaves at the end of the thrust. The elbow drives it; the shoulder barely moves.
- **A wrist flick, not a wind-up.** No pull-back between throws of any size: the wrist cocks back a few degrees as the
  hand snaps forward (the blades tilt up to the lens) and flicks down as the star leaves - the release reads from the
  wrist, the way a real shuriken is thrown with a snap.
- **Snap back, settle.** After the third the hand returns to rest over ~0.25 s, slightly lower than it left, then
  drifts back up.

## 3. The hand, Fan of Blades (t = 3.0-3.35 s)

- **Load across the body.** 0.08 s: the right hand sweeps to the LEFT edge of the frame, low (0.1, 0.8), palm turning
  over so the back of the hand faces the lens - a backhand with the three stars fanned between the fingers.
- **Whip.** 0.18 s: the hand sweeps flat across the bottom of the view, left to right, through the middle at (0.5,
  0.7); the fan leaves at the middle of the sweep, all three at once, and keeps going to the right edge (0.9, 0.7).
- **Follow through and recover.** The hand overshoots right and lower, then comes back up to the rest in ~0.25 s.
  The whole fan motion is ~0.5 s; the recovery overlaps the next press.

## 4. Third person (from the Overwatch Genji reference and the hero's own idle)

The throwing arm works from the hip: a primary shuriken is a short straight punch of the forearm along the aim line,
elbow leading, snapped back; the fan is the arm loaded across the chest and whipped out level to his own side with the
hand turning over. The off arm stays on guard. Nothing in the torso - the readability (Boehm / Gibson) comes from the
arm alone, which is why Genji can fire on a dash without the run breaking.

## 5. What Hayate does with it (`src/render/FirstPerson.ts`, `src/render/Animator.ts`)

- First person: per star, the hand thrusts from the rest (0.17, -0.17, 0.4 view metres) to (0.07, -0.08, 0.6) over
  0.1 s with a 0.9 rad wrist flick, and settles back over 0.3 s; the sim fires the three 0.08 s apart and resets the
  attack clock for each, so the thrust plays three times. The fan loads to (-0.2, -0.27, 0.36) in 0.08 s with the
  wrist rolled over, whips across to (0.3, -0.19, 0.5) by 0.26 s and recovers by 0.5 s.
- Third person: the right hand thrusts from the hip (0.25, -0.5, 0.35 of the arm) 0.95 arm-lengths along the aim and
  snaps back; the fan loads across the chest (-0.45, -0.35, 0.55) and whips to (0.7, -0.2, 0.62) on his own side.
- The star: `SHURIKEN_R` 0.085 x his height (15 cm, 30 cm across) in the hand and in flight - twice Genji's, as big as
  an anime fuma shuriken, so the player using him sees it leave the fingers and arc round the corner.
- The water: two rings of tide-light spin against the star in flight and swell while it hunts, droplets spray off the
  rim and fall (Fx.syncProjectiles).
