# ZENITH Engine Core: performance study and design

evera-71, 2026-10-02. Code: `src/engine/*` (new), `src/engine/Physics.ts` (broadphase), hooks in `src/client/Game.ts`,
`desktop/main.cjs`. Kill switch: `?engine=0` or `localStorage zu-engine=0` runs the previous loop unchanged.

## 1. What the frame cost before (measured, not guessed)

Live AI match, Sunset Mile, Ultra, 1920x1080 at 125% render scale, headless Chrome on the RTX 3050 PC
(`tests/e2e/engine_profile.mjs`, `engine_bench.mjs`):

| | |
|---|---|
| frame rate at 60 Hz vsync | 48-53 fps, 77-133 frames over 1.8x the median per 12 s, 1% low 18-21 fps |
| main thread | ~100% busy - **CPU-bound**, not GPU-bound |
| `EffectComposer.render` | 52% of all CPU |
| GTAO's G-buffer pass | 20%: a second full draw of the scene (~700 draws) with an override material whose program flips skinned/static on every draw |
| shadow map | 17%: rendered on EVERY `renderer.render` call - the post chain made two per frame |
| `updateMatrixWorld` | 7%: all 1,322 scene objects, once per `renderer.render` call |
| character views | 15% (`Animator.update` 11%), every hero every frame, near or far |
| level queries | ~9%: `ray` / `groundAt` / `collide` walked every box of the map (150-400) per query; `slab()` allocated 4 arrays per box tested |
| motion | the 120 Hz sim was drawn straight from its latest step: uneven steps per frame on any display that isn't 60/120/240 Hz |

## 2. How the big shooters solve the same problems

**Overwatch** (Tim Ford, "Overwatch Gameplay Architecture and Netcode", GDC 2017): the simulation runs in fixed
16 ms command frames (7 ms in tournament mode) on an ECS; the client predicts everything and renders between sim
states. "High Precision Mouse Input" samples the mouse at its own rate (1000 Hz) between frames; "Reduce Buffering"
trims the frames queued ahead of the GPU. The lesson for us: a fixed sim step is right (we have 120 Hz), but the renderer
must interpolate between steps, and the frame queue must be short.

**Rainbow Six Siege** (Jalal El Mansouri, "Rendering Rainbow Six Siege", GDC 2016): checkerboard rendering, half the
pixels per frame reconstructed temporally, "up to 50% faster rendering without great quality loss", to hold 60 fps on
consoles and 4K on PC. The lesson: shade fewer pixels and reconstruct. A spatial upscaler (FSR1) is the
WebGL-friendly form of that trade (no motion vectors needed).

**Fortnite / Unreal Engine** ("Dynamic Resolution", "Animation Budget Allocator" docs): screen percentage follows the
previous frames' **GPU** time against a frame budget (`r.DynamicRes.FrameTimeBudget`, a headroom %, a panic drop);
TSR upscales. With up to 100 players, the Animation Budget Allocator + Update Rate Optimisation (URO) tick a skeletal
mesh at a rate set by its significance (screen size, visibility) and hold or interpolate between updates.

**Croteam** (Alen Ladavac, "The Elusive Frame Timing", GDC 2018): games stutter even at high frame rates when they
animate with measured CPU frame times instead of the time the frame is actually displayed. Animate with
vblank-quantized time.

**Glenn Fiedler, "Fix Your Timestep!"**: the renderer produces time, the sim consumes it in fixed steps, and the
leftover fraction alpha = accumulator / dt interpolates the drawn state between the previous and current steps.

## 3. Free resources used

| resource | licence | used for |
|---|---|---|
| AMD FidelityFX FSR 1 (`ffx_fsr1.h`, EASU + RCAS) | MIT | `FsrPass.ts`, ported to GLSL ES 3.0 |
| Fiedler, Fix Your Timestep | article | `Interpolator.ts` + the Game loop |
| Ladavac (Croteam), Elusive Frame Timing | GDC talk | `FramePacer.ts` delta quantization |
| Unreal dynamic resolution / Animation Budget Allocator / URO docs | docs | `DynamicResolution.ts`, `AnimBudget.ts` |
| Amanatides & Woo, "A Fast Voxel Traversal Algorithm" (1987) | paper | `Broadphase.ts` ray walk |
| `EXT_disjoint_timer_query_webgl2` | Khronos | `GpuTimer.ts` |
| three.js r186 `GTAOPass.setGBuffer(depth)` | MIT | the GTAO fix, applied by evera-70 in buildComposer |

## 4. The engine core

| module | what it does | why |
|---|---|---|
| `FramePacer` | measures the refresh from rAF; vblank-quantized deltas with a phase-locked debt (game time stays within a frame of the wall clock, so co-op stays in sync); deadline-paced frame cap that locks to every n-th vblank when the cap divides the refresh | the old "skip if too soon" cap gave 48 fps for a 60 cap on 144 Hz and 120 for 144 on 240 |
| `Interpolator` | snapshots every actor + projectile before each fixed step; draws them at prev + (cur - prev) * alpha; the local player's aim stays live; teleports (>3 m per step) snap; restored before the sim runs | step judder |
| `EngineCore.render()` | one `scene.updateMatrixWorld` and one shadow-map render per frame, however many `renderer.render` calls the post chain makes; renderer.info counts the whole frame | 17% + 7% of CPU were repeats |
| `GpuTimer` | GPU ms per frame from timer queries, read back only when available (never stalls) | drives dynamic resolution; the perf overlay |
| `DynamicResolution` | scene scale follows GPU load only: down when GPU > 95% of budget (panic at 150% for 3 frames), up after 2 s at < 68%; 5% steps; **never lowers resolution for a CPU-bound frame** | the old controller blurred CPU-bound frames for nothing |
| `FsrPass` | last post pass: EASU upscale from the composer's scale to the screen + RCAS sharpen; linear downsample when supersampling; canvas stays native, so the first-person viewmodel draws at full resolution; all programs pre-compiled | Siege / Fortnite trade: fewer pixels, near-native image |
| `AnimBudget` | skeleton update rate by projected size: >= 110 px every frame, 50-110 px 45 Hz, smaller 30 Hz, off-screen 24 Hz; own hero, bosses, the dead, holograms, forced moves, knockdowns and Raijin's Susanoo always every frame; held views still move their root every frame; the real accumulated dt is passed (ClipLayer-safe, agreed with system32-77) | 15% of CPU on heroes nobody can see in detail |
| `Broadphase` + `Physics.ts` | uniform 6 m grid under ray / groundAt / collide / matAt / ceilingAt; candidates in original order, so results are **bit-identical** to the brute-force loop; allocation-free slab test | the sim and every camera/hitscan ray |
| `FrameGraph` | frame-time bars vs the refresh budget + GPU line in the advanced perf overlay | smoothness you can see |
| `desktop/main.cjs` | ANGLE D3D11 explicit; no throttling when overlays cover the window (native occlusion off) or in the background; V8 semi-space 32 MB (fewer minor GCs); renderer + GPU processes ABOVE_NORMAL; optional uncapped mode (`--uncapped` or `%APPDATA%/ZenithUmbra/engine.json` `{"vsync": false}`) | the shell's share of hitches and latency |

## 5. Results

* **Fixed step vs display, exact** (`tests/unit/engine.test.ts`, simulated displays): unevenness of a steady hero's
  on-screen motion (coefficient of variation): 57 Hz 0.147 -> 0.016, 144 Hz 0.45 -> < 0.03, 165 Hz 0.62 -> < 0.03;
  at 144 Hz the raw sim shows frames with no movement at all, interpolated never. A 60 cap holds 60.0 on 144 Hz.
* **Separate runs, 60 Hz, engine on vs off** (first clean pair): 58.3 vs 48.1 fps, 16 vs 133 stutters per 12 s,
  1% low 23.3 vs 18 fps, render submit 7.3 vs 10.8 ms, GPU 12.4 vs 16.9 ms. Repeated runs are noisy on a
  machine shared by several sessions, hence the next measurement.
* **Interleaved in one match** (`tests/e2e/engine_ab.mjs`, features toggled every 2.5 s, both sides already have the
  broadphase): loop CPU -13..-24%, render submit -14..-26%, character views -29..-35%, GPU -6..-8%.
* **Level queries**: 9-15x faster (Mile 15x, Kagura 13.8x), identical answers on all 14 maps
  (`tests/unit/physics_grid.test.ts`, 3,000 random queries x 7 query types per map vs the old code).
* **FSR at 67% scale** (`tests/e2e/engine_shot.mjs`, one frozen frame): edge sharpness 8.97 (native 8.72, bilinear
  6.03) at equal PSNR vs native (31.6 dB) - native-looking edges from 44% of the pixels.
* **Hitches**: `preload_check.mjs`: 0 shader programs compiled mid-match, 0 errors.
* With evera-70's GTAO-from-depth change (`render-quality`), the G-buffer redraw (20% of CPU) goes away too.

## 6. Not done here (next steps, in order of value)

1. **High-precision mouse input** (`pointerrawupdate` + coalesced events, applied to aim at fire time), as Overwatch.
2. **Static batching / BatchedMesh for map geometry** (480 main + 388 shadow draws are mostly map boxes); needs
   MapScene, which evera-70 owns.
3. **Shadow caching / cascades**: static casters rendered once and merged with a per-frame dynamic pass, or a
   camera-following cascade (sharper near shadows, fewer casters).
4. **HUD**: `Hud.update` costs ~1.7% of the frame in DOM writes; throttle nameplates and text to 30 Hz.
5. **Ragdoll start hitch**: one 100 ms frame when two heroes died together (preload_check, 12 s); profile `deathRagdoll`.
6. **Uncapped toggle in Settings** (today: launch flag / engine.json), and a temporal upscaler (TAA + FSR) once the
   renderer has motion vectors.
7. **WebGPU** (three's WebGPURenderer + TSL) would cut draw-call CPU cost further, but every ShaderMaterial,
   `onBeforeCompile` patch and post pass would need porting - a project of its own.

## 7. Checks

```
npx vitest run tests/unit/engine.test.ts tests/unit/physics_grid.test.ts
node tests/e2e/engine_ab.mjs <port> mile 6 2.5          # interleaved A/B in one match
node tests/e2e/engine_bench.mjs <port> mile 12 0 1      # ENGINE=0 for the old loop
node tests/e2e/engine_shot.mjs <port> mile 67           # FSR vs bilinear vs native
node tests/e2e/preload_check.mjs mile gantetsu 15 <port>
```
In game: Options > Video > Performance Stats = advanced (or the perf key) shows CPU/GPU ms, the display rate,
the interpolation alpha, animation LOD counts and the frame-time graph.
