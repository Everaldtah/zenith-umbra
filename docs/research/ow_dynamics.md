# Hair / cloth / secondary motion: how Overwatch does it -> what to change in our solver (#4 research half)

For evera-c1 to apply (src/render/Animator.ts: DYN table, the dynamics() solver). By evera-b6, 2026-09-29. Read-only
analysis of the solver at anim-upgrade 1b3f0e8. Per-hero observations from face_strip are in section 6 (added after
c1's re-publish of the 15 chained heroes).

## 1. What Overwatch actually does (public sources)
- **A blend of three sources, chosen per garment.** Blizzard tech art (NDC 2017, Hakseong Lee, on Ana): plain cloth
  simulation clipped her long coat through the floor in her slouched idle, and a fully bone-driven (animated) coat cost
  too much to author. The shipped answer blends the two: a sim that is "tuned to read enough cloth simulation" while the
  bone-driven pose keeps it out of the ground and on-model. Short hair and small accessories are simple jiggle chains;
  big cloth is a sim with pose-driven targets; emotes, highlight intros and first person are hand-keyed overlap.
- **Readability over realism** (Boehm, Gibson, Davis GDC talks): silhouettes stay clean and heroes stay recognisable at
  a glance. Secondary motion *accents* acceleration events (a start, a stop, a jump, a landing, a dash, a hit) and
  settles fast. It is never continuous flapping and never covers the face.
- **Rig budget:** up to 256 bones per hero (most use 200-225, about 70 of them in the face). Plenty of room for 3-6
  segment chains per strand or panel, so they chain short, stiff-rooted strands rather than a few long ones.
- **OW2 "improved cloth"** (Evolving the Art panel): more cloth and more particles, the same philosophy.

What that looks like in play (the target look): Mercy's ponytail and robe tails swing a beat behind her and are still
within ~0.4 s; Genji's scarf ribbon streams on a dash and falls back; Widowmaker's ponytail swings on turns; Reaper's
coat tails flare on a turn and settle; Tracer's spiky hair barely moves (tufts). Nothing jitters at rest, nothing
crosses the face, and turning the camera doesn't send hair flying.

## 2. How our solver compares
Ours is sound (a world-space Verlet/PBD spring bone like VRM SpringBone / Kawaii Physics / Dynamic Bone): 120 Hz
sub-steps, swept capsule colliders, a skirt ring, leg-driven skirt targets (the Ana-style blend, already partly there),
angular limits, and a teleport reset. The gaps against those industry solvers:

| missing | what it does in Kawaii Physics / Dynamic Bone | effect in our game now |
|---|---|---|
| **Root-to-tip curves** | stiffness, damping and inertia scaled along the chain (x = 0 root .. 1 tip) | every segment is equally stiff, so a strand is either a rod or jelly; roots near the face wobble as much as tips |
| **World damping / inertia** ("World Damping Location / Rotation", 0.5-0.8; Dynamic Bone "Inert") | how much of the character's own world motion the chain feels | we're fully world-space (1.0). At our speeds (Hibiki's groove ~20x, dashes, flash steps, blinks) hair and cloth slam to maxA every move and pierce colliders: the "patchy" look |
| **Rotation inertia separate from translation** | turning in place doesn't whip the chain as hard as running does | a 180 deg mouse flick throws every strand across the face |
| **Relative-speed clamp** | cap the apparent wind a chain feels | at 20x speed drag becomes a wall |
| **Per-hero multipliers** | per-character profiles | one table for a 2.3 m oni and a flyer's silk gown |
| **Sim weight per chain (pose blend)** | Kawaii's Alpha, Ana's blend | long panels are all sim; a 0.3-0.5 blend to the animated pose keeps them on-model |

## 3. Recommended solver changes (in priority order)
1. **Inertia (world-damping) blend** - the biggest single fix. Before the Verlet step, carry each particle with the
   anchor by `(1 - inert)` of the anchor's frame delta:
   ```
   dA = F.anchor - c.anchor                          // this frame's anchor move (world)
   for each particle: x += dA * (1 - inertT); pv += dA * (1 - inertT)
   ```
   (moving both x and prev keeps the velocity). Do the same for the anchor's yaw delta: rotate x and pv about the
   anchor by `(1 - inertR) * dYaw`. Values below (inertT = how much world lag is felt; 1 = today's behaviour).
2. **Relative speed clamp:** clamp the character-relative particle velocity to 9 m/s after the carry
   (`v = x - pv; if |v|/hs > 9 m/s scale it`). This keeps dashes readable and stops tunnelling.
3. **Root-to-tip curves:** per kind, `stiff_k = stiffRoot + (stiffTip - stiffRoot) * t^0.8` and the same for drag,
   with t = k / (n - 1). Roots hold the silhouette and near the face; tips carry the motion.
4. **Sim weight (pose blend):** after the solve, blend each particle toward its animated target by `1 - simW` (a
   final lerp, not a spring). Long skirts and capes: simW 0.65-0.75. Hair: 1.0 (the stiffness curve does it).
5. **Face guard** (c1 is doing the face exclusion in the hair masks; a runtime guard as well): a sphere 0.9 x the head
   collider radius, 0.35 x head radius *in front of* the head joint, only for hair chains anchored on the head.
   Front bangs then can't fold into the eyes whatever the motion.
6. **Rest settle:** when the hero is grounded and |v| < 0.3 m/s, multiply drag by 1.6 so chains come to rest without
   micro-jitter (OW characters are dead still at rest apart from breathing).
7. **Wind:** gameplay wind is almost nil in OW. Keep the gust, scale it by the table's `wind`, and add map wind later
   (the desert maps could use it).

## 4. Recommended values (per kind; drag and stiff per 1/60 s like today; root -> tip)
| kind | stiff root -> tip | drag root -> tip | inertT | inertR | grav | maxA (rad) | wind | simW |
|---|---|---|---|---|---|---|---|---|
| hair | 0.26 -> 0.08 | 0.08 -> 0.11 | 0.55 | 0.45 | 0.6 | 0.75 (front bangs 0.45) | 0.35 | 1.0 |
| tuft | 0.50 -> 0.30 | 0.12 -> 0.14 | 0.8 | 0.7 | 0.15 | 0.30 | 0.15 | 1.0 |
| skirt | 0.34 -> 0.12 | 0.08 -> 0.10 | 0.5 | 0.4 | 0.9 | 0.55 | 0.3 | 0.7 |
| cape | 0.24 -> 0.07 | 0.06 -> 0.09 | 0.4 | 0.35 | 1.0 | 0.80 | 0.6 | 0.75 |
| sleeve | 0.30 -> 0.09 | 0.08 -> 0.10 | 0.6 | 0.5 | 0.95 | 0.80 | 0.4 | 0.85 |

Why:
- Stiffness curves: today's single hair value (0.09) is the tip value, so roots were far too loose. Kawaii's reference
  range is 0.05-0.2 for the stiffness *base*, and its tutorials ramp stiffness down along the chain.
- inertT 0.4-0.8 is Kawaii's 0.5-0.8 world-damping range (ours is inverted: our inertT is the fraction felt).
- maxA: Kawaii suggests 45-90 deg for ribbons and capes, 30-60 for tails. Hair near the face is tighter.
- skirt/cape simW < 1 is the Ana blend.

## 5. Per weight class (multiply the table)
| class | heroes | stiff | drag | maxA | inertT | notes |
|---|---|---|---|---|---|---|
| heavy | gantetsu, tomoe, enra, gorgoth (pilot vorn) | x1.25 | x1.2 | x0.85 | x0.9 | heavy cloth: less flap, slower swing |
| medium | raijin, kaien, kagemaru, hex, hibiki, hayate, seiran, haruto | x1.0 | x1.0 | x1.0 | x1.0 | |
| light / flyers | mirei, nocturne, yuzu | x0.85 | x0.9 | x1.1 | x1.05 | flowing hair, silk and gowns; flyers keep chains more alive in the air |
| mechs | tenkai | no chains | | | | |
Hero overrides worth having from day one: hibiki (tuft dreads -> inertT 0.5 while grooving, or they whip at 20x);
nocturne (gown hem as cape with simW 0.6: its ragged hem reads better with less sim); kaien and seiran (wide sleeves:
sleeve maxA 0.65 so they don't wall off the view in third person either).

## 6. Per-hero observations (face_strip at 258a002, idle vs run, 4 frames x 250 ms, front + 3/4)
Sheets: C:\Users\evera\Projects\zu-maps\work\qc_face_run_0.jpg, qc_face_run_1.jpg, qc_face_cmp.jpg (front row, idle vs run).

**The biggest thing isn't the hair: it's the head.** At idle every face is clear (raijin, enra, seiran, kaien, yuzu,
haruto). Running, the head pitches down ~20-30 deg with the run lean, so the camera sees the crown, the bangs and spikes
cover the eyes, and the faces "disappear". OW heroes keep the head level with the aim while the body leans into the run
(the stabilised gun-carry head of every shooter). **Recommendation: head stabilisation in the Animator's locomotion
layer.** Neck and head counter-rotate the spine's run lean so the head's pitch tracks the aim pitch, with 80-90%
compensation, a spring of ~8 Hz and zeta 0.9, and bob amplitude on the head capped at 1.5 cm. It fixes all of these at
once, and it's how the faces read in OW gameplay footage.

Per hero (after the re-publish):
| hero | idle | run | cause | change |
|---|---|---|---|---|
| raijin | face clear under the spikes | spikes over the whole face | head pitch (spikes are tufts, fine) | head stabilisation |
| enra | face clear | the white fire-mane drapes over the face | mane solved as `hair` (hangs and swings forward) | classify the mane chains as `tuft` (a flame mane stands up) or give them hair with maxA 0.35 plus the face guard |
| seiran | clear | the long front strands swing across the mouth and nose | front strands on loose `hair` settings | face guard + front-strand maxA 0.45 + stiff roots (the root-to-tip curve) |
| kaien | clear | bangs over the eyes, face in shadow | head pitch | head stabilisation; fringe maxA 0.45 |
| yuzu | clear | bangs over the eyes; one bun shows a small flap (c1 knows) | head pitch; bun chain | head stabilisation; tuft maxA 0.26 is right |
| haruto | clear | eyes under the fringe | head pitch | head stabilisation |
| mirei | clear; the wing tip pokes into the hair at the left of the head | same | wing chain vs head | add `head` to the wing chains' colliders (or 0.1 rad less maxA toward the head) |
| nocturne | clear, the tiara rides well | same | - | none |
| gantetsu, tomoe, hayate, hex, kagemaru | clear | clear | - | none |
| hibiki | head leaves the strip's frame when running (the skater tuck) | - | framing | not a dynamics issue; the headphone band in hair_T (c1 knows) |

## 7. How to check (for whoever applies it)
- `node tests/e2e/face_strip.mjs <ids> idle,run`: no strand crosses the eyes; strands trail on run and settle within
  about 0.4 s when stopping.
- A 180 deg turn in place: hair swings but stays behind the ears (the inertR test).
- Hibiki at full groove: dreads trail, no clipping through the head.
- The unit tests that cover the Animator.

## Sources
- NDC 2017, how Overwatch tech artists built Ana (cloth sim + bone-driven pose blend): https://www.invenglobal.com/articles/1701/ndc-2017-how-technical-artists-streamline-overwatch-character-development-in-the-case-of-ana
- Overwatch rig budget (Scott Goffman): https://www.gosugamers.net/overwatch/news/35188-interesting-insight-into-overwatch-tech-art
- GDC 2017 The Animation Pipeline of Overwatch (Jesse Davis): https://www.gdcvault.com/play/1024267/The-Animation-Pipeline-of-Overwatch
- GDC 2016 Overwatch: How A Hero Is Mei'd (David Gibson): https://gdcvault.com/play/1023473/Animation-Bootcamp-Overwatch-How-A
- OW2 Evolving the Art panel: https://overwatch.blizzard.com/en-us/news/23189038/revving-up-the-engine-overwatch-2-evolving-the-art-panel-recap/
- Kawaii Physics parameters (Damping 0.1-0.3, Stiffness 0.05-0.2, World Damping 0.5-0.8, root-to-tip curves, Limit Angle): https://github.com/pafuhana1213/KawaiiPhysics/wiki/Parameters-en
- Dynamic Bone presets and distribution curves: https://gist.github.com/SrPhilippe/43c1bad021fab173d3ef1d5255d53f53
