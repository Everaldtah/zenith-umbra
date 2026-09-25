# Animation system — handoff notes

For the next person or agent working on ZENITH//UMBRA animation. It covers the current state, the data behind the decisions, how to verify changes, and what's still open. Branch: `claude/jolly-volta-8xyujb` (commits `2faf268`, `13bc623`).

## 1. How it works

```
public/anim/manifest.json + UAL1.glb / UAL2.glb / mixamo.glb       (NOT in the repo yet: see §5)
        │  src/render/ClipLibrary.ts  loadLibrary() → bakeClips() per pack
        ▼
src/render/Retarget.ts   any humanoid skeleton → PoseClip (rig-independent)
        │  mapSkeleton(): bone names + hierarchy (UAL, Mixamo, Rigify DEF-, Bip01, old Quaternius)
        │  per frame: model-space rotation DELTA from source rest + bone head positions in LEG LENGTHS,
        │  canonical frame Y up / +Z forward / +X = character's left (auto-detected from the rest pose)
        │  analyse(): loop?, root motion stripped, travel speed + direction from planted feet, contacts, phase0
        ▼
src/render/ClipLibrary.ts  slots by name (slotOf) + locomotion gaits by MEASURED speed/direction,
        │                    missing directions filled by mirrorClip / reverseClip; blend(angle, speed)
        ▼
src/render/ClipLayer.ts  per character: idle ↔ 8-way blend (phase advanced by distance → no foot slide),
        │                  one-shots (melee combo per swing, punch, casts via CAST_SLOT, hit, jump/land, death)
        ▼
src/render/Animator.ts   procedural layer ON TOP: blends clip pose per region (legs/torso/arms) with weights,
                         adds aim pitch / flinch / recoil, IK feet locked on clip contacts, springs (hair/cloth).
                         No library → layer null → identical to the old fully procedural animation.
```

- **Stays procedural on purpose:** mechs (`frame: 'mech'`), drones, flyers while flying, Tenkai-Oh's hammer, and ability poses with `s.move`. The eligibility check is in `Animator.update`.
- **Deaths:** `CharacterView` plays a death clip (`anim.clipDeath`) instead of the tip-over when the library has one.
- **First-person arms:** `src/render/FirstPerson.ts`.
  - Each hero's own model is drawn as a viewmodel in its own render pass (`Game.ts`, after the composer, with its own depth and `localClippingEnabled`).
  - Per-hero `FP_STYLE` sets the grip, hand rest positions (view-space metres: right, up, forward), recoil, `push` and `clip`.
  - `viewmodelOffset()` moves the rig, not the grip, until the hands are within reach, with the shoulders always behind the camera.
  - Blender-authored `fp_*` clips (`lib.fp`) win per action; otherwise the procedural personality in `proc()` is used.
- **Query flags:** `?anim=procedural` turns the library off; `?animdir=/path/` loads another library (the tests use `/tests/e2e/fixtures/anim/`).

## 2. Tools (`assetgen/blender/`, Blender 4.2+ / 5.x)

| Script | What it does |
|---|---|
| `anim_pack.py` | Packs UAL1 / UAL2 / Mixamo FBX folder into mesh-less GLBs + `public/anim/manifest.json`. Strips Blender's `_<armature>` action-name suffix. |
| `fp_arms.py` | `--setup`: first-person authoring scene on a hero rig (camera = in-game eye, IK hand/elbow controller `fp_ctrl`, starter `fp_*` actions). `--export`: bakes through IK onto the arm bones → `fp_<hero>.glb` + manifest `fp` entry. Its `STYLE` / `PUSH` / `CLIP` tables MUST match `FP_STYLE` (enforced by `tests/unit/fpstyle.test.ts`). |
| `fix_arms.py` | Repairs misplaced auto-rig arm joints in a published hero GLB. Joints come from `arm_fixes.json` (`--hero id`) or `--right/--left "x,z x,z x,z x,z"` (shoulder, elbow, wrist, hand tip; front view; model faces −Y, +X = its left). Re-weights arms only, binds a held weapon fused into the mesh to the hand, and `--test prefix` renders deformation checks. |

Publishing a fixed hero model (the web tier, same as `build_assets.py`):
```
npx @gltf-transform/cli copy public/models/<id>.glb work/<id>_plain.glb        # only needed for the bpy wheel (no Draco)
blender -b -P assetgen/blender/fix_arms.py -- --glb work/<id>_plain.glb --out work/<id>_fixed.glb --hero <id> --test work/<id>
npx @gltf-transform/cli optimize work/<id>_fixed.glb public/models/<id>.glb --compress draco --texture-compress webp --texture-size 1024 --simplify false
```

## 3. Data gathered

### Rig arm proportions (`public/models/*.glb`, before the Raijin fix)
A human is about 0.75–0.85 arm/leg; forearm/upper-arm is about 0.8–1.0. Low numbers mean misplaced joints or short arms.

| model | upper arm | forearm | fore/upper | arm/leg |
|---|---|---|---|---|
| **raijin (before fix)** | 0.159 | **0.055** | **0.34** | **0.32** ← broken, fixed |
| yuzu | 0.157 | 0.158 | 1.00 | 0.47 ← short arms |
| mirei | 0.212 | 0.203 | 0.96 | 0.54 ← short arms |
| kaien | 0.249 | 0.253 | 1.01 | 0.61 |
| hex | 0.282 | 0.267 | 0.95 | 0.63 |
| vorn | 0.312 | 0.243 | 0.78 | 0.65 |
| kagemaru | 0.289 | 0.271 | 0.94 | 0.72 |
| enra | 0.381 | 0.379 | 0.99 | 0.88 |
| nocturne | 0.409 | 0.373 | 0.91 | 1.06 |
| tenkai | 0.283 | 0.368 | 1.30 | 0.41 (mech) |
| gorgoth | 1.119 | 1.313 | 1.17 | 1.45 (mech) |
| haruto | 0.039 | 0.038 | 0.97 | 0.10 (different units; ratio is what matters) |

Script to regenerate this table: parse each GLB's JSON chunk and compute world positions of `upperarm_R`, `forearm_R`, `hand_R`, `thigh_R`, `shin_R`, `foot_R` (no Draco decoding needed; the skeleton is in the JSON).

**Candidates for `fix_arms.py`:** check Yuzu and Mirei visually in the Hero Viewer. Short arms can be the design (chibi proportions) or misplaced wrists. Render the front view with joint markers first (see §4.3).

### Raijin's fix (`arm_fixes.json`)
- **Right arm (x, z in m):** shoulder (−0.23, 1.22), elbow (−0.335, 1.02), wrist (−0.34, 0.86), hand tip (−0.33, 0.75).
- **Left arm:** shoulder (0.22, 1.22), elbow (0.29, 0.99), wrist (0.27, 0.84), hand tip (0.26, 0.74). The mesh is not symmetric; `--mirror` was wrong by about 7 cm.
- **Held weapons:** a forward-pointing sword in the right fist, 0.32 m along (−0.67, −0.73, −0.14), bound to `hand_R`. The left hand holds nothing: the swords that look held in the front view are worn at the back/hip, 0.45 m behind the fist (checked in a top view).
- **Result:** 3,339 arm vertices re-weighted and stray arm weight moved off 5,482 torso vertices. The rest pose is unchanged; the file went from 759 KB to 756 KB with the same bones.
- **Remaining:** some sleeve/coat stretch when the arms swing far, because the sleeves are fused to the coat in the TRELLIS mesh.
- **Not fixed yet:** the desktop HQ model (`assetgen/out/models_hq/raijin.glb`, not in the repo). Run the same command on it.

### Foot sliding (planted-foot drift ÷ body speed, `tests/unit/animsim.test.ts`, 5v5 bots, 60 fps, 90 s)
Clip-driven heroes come in at 0.001–0.003, against 0.06–0.08 for the procedural gait. Mechs are ≈0.09 in both modes because they're procedural. The browser AI Lab number is noise under software GL (a few samples at 1–2 fps), so trust the Node test.

### Retargeting accuracy (`tests/unit/anim.test.ts`)
Limb direction error < 1.5° and hips < 0.01 leg lengths across UAL/T-pose, Mixamo cm/A-pose/facing −Z/rolled bones, Z-up wrapper, and old Quaternius naming. Blender round trip: `anim_pack.py` on the UAL-style pack reproduces names, loop flags and speeds exactly.

### First-person framing (58° vertical FOV, NDC y of the wrist; −1 = bottom edge)
Targets were retuned so the wrists sit around −0.55…−0.9. Raijin needs `clip: 0.14`: without it his collar fills the screen, and with it his arms and sword show. The HUD ability bar covers the bottom centre, so viewmodel shots with the HUD visible can look empty.

## 4. How to verify

1. `npm test`: 57 tests, including `anim`, `animsim` and `fpstyle`. `npm run typecheck`, `npm run build`.
2. Browser:
   ```
   npm run anim:fixtures                        # writes tests/e2e/fixtures/anim/{UAL_test,mixamo_test}.glb + manifest
   npx vite --port 5199 --strictPort &
   node tests/e2e/anim.mjs http://localhost:5199/   # 22 checks; shots in tests/e2e/shots/anim/
   ```
   `fp_raijin.glb` in the fixtures is REAL `fp_arms.py` output on the fixed Raijin rig. Re-author it whenever the rig, `FP_STYLE`, `PUSH`, `CLIP` or the offset logic changes (`--setup` then `--export`, copy into `tests/e2e/fixtures/anim/`).
3. Visual checks for rig work:
   - **Front / side / top renders:** orthographic Cycles renders with a red 5 cm grid bar layout. This is how the joint positions were read.
   - **Weight view:** vertex colours, red = upperarm/forearm, green = hand.
   - **Deformation poses:** `fix_arms.py --test`.
   - **Hero Viewer before/after:** `?anim=procedural`, `__zu.menu.viewer()`, `__zu.viewer.select(id)`, `setMode('idle'|'run'|'attack'|'alt')`, window at least 1600×900 (narrower crops the stage).

## 5. Open work (priority order)

1. **Get the real clips in.** itch.io is blocked by this environment's network policy, and Mixamo needs an Adobe login, so the user must download them: UAL1 and UAL2 (CC0) from quaternius.itch.io/universal-animation-library(-2), Mixamo as *FBX Binary, Without Skin, 30 fps, In Place*. Then run `anim_pack.py` (README "Animation library"), load the game, check the console line `[anim] N clips ... gaits ... slots ...`, and check the Hero Viewer's `clip:` readout per state. Expect to tune:
   - `slotOf()` regexes in `ClipLibrary.ts` against the real UAL clip names (they were written against guessed names like `Jog_Fwd_Loop`, `Sword_Combo_1`, `Death01`). Use manifest `"slots"` / `"exclude"` for one-offs.
   - `VARIANT` exclusions (weapon / crouch / injured locomotion).
   - `CAST_SLOT` (ability → clip) and `TARGET` durations in `ClipLayer.ts`.
   - Arm weight vs weapon guard: `wArm` in `Animator.ts` uses `(1 - readyW*0.8)`. Gun heroes keep a procedural ready stance over clip arms.
2. **Tune the viewmodels on a real GPU.** Walk each hero through idle / fire / alt / melee / reload / abilities / ult in first person (V toggles view), adjusting `FP_STYLE` and mirroring the change in `fp_arms.py` (the test enforces the match). Then author per-hero clips with `fp_arms.py`; only Raijin has a set, and it's a test fixture, not shipped in `public/anim`.
3. **Check Yuzu, Mirei and the mechs' arm rigs** (§3 table) and fix them with `fix_arms.py` if the joints are wrong.
4. **Desktop HQ Raijin model:** apply the same fix (§3).
5. Optional: stretch the viewmodel arms (bone scale) for short-armed heroes instead of relying only on the rig offset.

## 6. Pitfalls already hit (don't repeat)

- **THREE.AnimationMixer at `t == duration`** wraps a LoopRepeat action to frame 0. Baking uses `LoopOnce` + `clampWhenFinished` (`Retarget.ts`).
- **Skinned test rigs must be bound AFTER `updateMatrixWorld`.** Otherwise the inverse bind matrices are identity: three ignores that, but Blender rebuilds every bone at the origin.
- **Blender's glTF importer renames actions to `<clip>_<armature>`;** `anim_pack.py` strips it. The FBX importer uses `ignore_leaf_bones=False` because the mapper ignores `_End` bones, and dropping leaves lost Head/Hand in tests.
- **Feet are placed relative to the clip's hip joint, not the source rest pose,** so a pack whose rest has bent knees still lands the feet right (`Animator.ts` clip-feet block).
- **The clip gait phase advances by real `dt` (≤0.25 s), not the Animator's 50 ms clamp.** Otherwise locked feet fall behind on slow frames.
- **First person:** don't collapse the neck bone. High collars are weighted to it and smear across the view (Raijin); the head only. Use `clip` for collars.
- **Held weapons in TRELLIS meshes are fused to the body** (one connected island of about 19k vertices), so loose-part detection doesn't work. `fix_arms.py` fits a straight run of vertices leading away from the fist; exclude directions up the forearm, into the torso, and straight down the coat.
- **Front-view joint depth:** hanging forearms sit in front of the coat at the same (x, z), so a median depth mixes the two surfaces. Use the front surface plus half a sleeve (`--sleeve`).
- **Environment:**
  - The pip `bpy==4.2.0` wheel works for scripts but has no Draco decoder; decompress first with `gltf-transform copy`.
  - bpy often segfaults on exit after work completes; the outputs are fine.
  - Puppeteer as root needs `--no-sandbox`. Use `--use-angle=swiftshader`, which renders at 1–5 fps.
  - Scripts importing `puppeteer-core` must live inside the repo.
  - `tests/tools/*` run with `-c tests/tools/vitest.config.ts`.
  - `pkill -f` with a pattern that appears in your own command line kills your shell.
