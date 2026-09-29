# Archer first person: Hanzo (bow) and Freja (crossbow), frame by frame -> Yuzu and Seiran

Study half by evera-b6; evera-c1 implements (fp_choreo yuzu()/seiran(), FP_STYLE rows, the bow/arrow props, the finger
grips). Frames and contact sheets live in the git-ignored `work/ref/` (not committed: game footage).
Supersedes the bow row of docs/research/fp_viewmodel_spec.md, which guessed a near-vertical bow left of the reticle.
**Overwatch doesn't hold it that way.**

## Sources
- Hanzo Ability Overview, PlayOverwatch, https://www.youtube.com/watch?v=oOVb9x0zd6M (1080p30, default skin, clean
  lighting): Storm Bow 11.2-15.9 s, Sonic Arrow 22-25 s, Dragonstrike 50-52 s / 63-65 s / 72-74 s.
- Overwatch 2 Hanzo gameplay (no commentary), https://www.youtube.com/watch?v=uW7SqHeNW8Q (1080p60, a dragon skin,
  same viewmodel rig): used to confirm the OW2 hold.
- Freja: New Hero Gameplay Trailer, https://www.youtube.com/watch?v=GM85xnXH6JQ, and Freja gameplay (no commentary),
  https://www.youtube.com/watch?v=45r158YILWI (section 2).

Conventions: screen fractions of the full 16:9 frame, (0, 0) = top-left, reticle at (0.50, 0.50). To FP_STYLE view
metres (our FP camera is 58 deg vertical) at depth z: `x = (2fx - 1) * z * 0.985`, `y = (1 - 2fy) * z * 0.554`.
Timings are from 30 fps frame counts (1 frame = 33 ms).

## 1. Hanzo: Storm Bow primary cycle (measured)

### What it looks like
The bow is not upright. It lies **across the bottom of the screen, canted ~80 deg from vertical** (about 10 deg above
horizontal), upper limb to the RIGHT. It's angled in depth too: the lower limb is near the camera, off-screen
bottom-left, and the upper limb recedes toward the right edge. The tattooed LEFT forearm enters from the bottom-left
corner and the fist grips the bow at bottom-centre. The arrow points straight down the view (it reads as a short spike
above the grip), just below the reticle. The upper 55-60% of the screen stays completely clear in every phase except
the 170 ms quiver reach.

| phase | t (ms, from loose) | bow grip (L fist) | bow line (from -> to) | arrow | draw (R) hand | visible |
|---|---|---|---|---|---|---|
| idle / nocked | - | (0.46, 0.89) | off-screen bottom-left -> (0.73, 0.85): nearly flat, in the bottom 15% | nock/tip spike at (0.51, 0.79) | out of frame | L forearm from bottom-left; bow; nothing above y 0.75 |
| draw start | -900 .. -700 | (0.48, 0.78) | (0.05, 0.92) -> right edge at (1.0, 0.62) | short forward spike above the grip | fingertips at bottom-centre (0.51, 0.95) | the bow lifts ~0.11 of screen height |
| full draw (hold) | -500 .. 0 | (0.47, 0.75) | (0.0, 1.0) -> right edge at (1.0, 0.60) | forward, tip ~(0.52, 0.72); reticle clear | out of frame: behind and below the camera, at the jaw | about the bottom 40% band |
| loose | 0 | (0.47, 0.75) | same | leaves | two open fingertips flick at bottom-centre (0.48, 0.95) for ~66 ms | string snap |
| follow-through | +33 .. +330 | drops to ~(0.47, 0.80) | flattens ~3-5 deg, right limb down to ~0.66 | - | out | bow settles back toward the idle band |
| quiver reach | +370 .. +530 | (0.48, 0.85) | lowered | the new arrow sweeps from the upper right (0.78, 0.25) down-left and is nocked upright at (0.53, 0.55 -> 0.85) | R forearm enters from the UPPER-RIGHT edge (over the shoulder, the quiver) and sweeps down-left | covers the right-centre (x 0.75-0.95) for ~100 ms; passes ~0.05 right of the reticle for 2-3 frames |
| nocked -> next draw | +530 .. +600 | (0.47, 0.86) | idle band | nocked at (0.47, 0.80) | drops out of frame | the next draw can start at ~+530 ms |

Timing summary: **nock -> full draw 450-500 ms** (ease-out: most of the lift in the first 200 ms); **loose -> nocked
530 ms** (330 ms follow-through, then the 170 ms over-the-shoulder reach and nock). Holding fire chains
draw -> loose -> reach -> draw with no idle between.
Camera: no view kick on the loose (the world doesn't move between frames); the recoil is all in the viewmodel (the
bow kicks down and flattens). No FOV change while drawing (Hanzo has no zoom).
Sonic Arrow (22-25 s): the same draw with a glowing arrowhead. Dragonstrike (50-52 s): the same draw and loose; the
spirit dragons spiral off the arrow. Storm Arrows (OW2 rapid fire), quick melee and jump/land: section 1b, next.

### 1a. Deltas: our Seiran and Yuzu today (tests/e2e/archer_fp.mjs <hero> 4, at anim-upgrade 6d5c457)
| | Hanzo | Seiran now | Yuzu now | change |
|---|---|---|---|---|
| bow orientation | ~80 deg from vertical, upper limb right, lying across the bottom | near-vertical (~12 deg), upper limb up-left, reaching the TOP of the screen (y 0.02) | near-vertical, top at y 0.1 | roll the bow ~-70 deg about the view forward axis (upper limb to the right), plus ~20-30 deg of yaw so the upper limb recedes to the right |
| screen coverage | bottom ~15% (idle) to 40% (drawn) | the whole left third, top to bottom | the left quarter, top to bottom | keep everything below y ~0.58 except the quiver reach |
| grip (L) | (0.46-0.48, 0.75-0.89) | (0.35, 0.72) | (0.30, 0.72) | idle [-0.03, -0.18, 0.50], full draw [-0.03, -0.14, 0.50] (FP_STYLE L, z = 0.5) |
| draw hand at full draw | out of frame (behind/below the camera) | big, close, right of centre (0.72, 0.80) | small at the bottom right | pull it back past the near clip at full draw; show only fingertips at bottom-centre on draw start and loose |
| arrow | points down the view, tip just below the reticle at (0.52, 0.72) | barely visible | a shaft lying toward the bottom-left | align the arrow with the view direction, tip ~0.2 of screen height below the reticle |
| loose -> ready | 530 ms, with a visible over-the-shoulder reach from the upper right | ~800 ms; the hand wanders around the lower centre and right, no quiver reach | ~800 ms, same | 330 ms bow follow-through (kick down 0.03, flatten 4 deg) + 170 ms reach from the upper-right with the arrow + nock; total 530 ms |
| draw | 450-500 ms, the bow lifts ~0.11 | the bow doesn't lift | the bow doesn't lift | lift the bow ~0.11 screen (about 0.035 m at z 0.5) as it draws |
| camera | no kick | - | - | keep the camera still; recoil in the viewmodel only |

## 2. Freja: crossbow (auto bolts, Take Aim charge, reload, Bola)
_in progress - next_
