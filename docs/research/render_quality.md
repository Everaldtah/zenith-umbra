# Rendering quality pass: free assets and techniques (desktop edition)

2026-10-02, evera-70. Goal (user): research where shooters like Overwatch, Fortnite and Rainbow Six get their look, find
free assets that close the gap at run time, and apply them to the current maps, models and effects.

## Where the free assets come from

All of them are CC0 (public domain): no attribution needed, commercial use fine. Credits are kept anyway in
`public/env/pbr/CREDITS.txt` and `public/fx/CREDITS.txt`.

| source | what | used for | access |
|---|---|---|---|
| [Poly Haven textures](https://polyhaven.com/textures) | ~860 scanned PBR sets (albedo, OpenGL normal, AO/rough/metal packed as ARM, height) up to 8K | map surfaces | free JSON API, no key: `api.polyhaven.com/files/<id>` |
| [Poly Haven HDRIs](https://polyhaven.com/hdris) | ~980 HDR panoramas (dusk harbours, night streets, deserts, industrial yards) | image-based lighting per map | same API, `.hdr` 1K-16K |
| [ambientCG](https://ambientcg.com) | ~2,000 PBR materials, ~400 HDRIs | not needed this pass (Poly Haven covered every slot); best next stop for diamond plate, tiles, sci-fi panels | free API `ambientcg.com/api/v2/full_json` |
| [Kenney Particle Pack](https://kenney.nl/assets/particle-pack) | 80 particle sprites: smoke, sparks, flares, muzzle flashes, scorch, dirt, magic, slashes | gunfire effects | direct zip |
| Kenney Smoke Particles, [Brackeys VFX bundle](https://brackeysgames.itch.io/brackeys-vfx-bundle) (CC0, Kenney + others) | flipbook smoke / explosion sheets | next: animated explosions (Gantetsu, Tenkai) | zip |
| 3DTextures.me, ShareTextures, cgbookcase | more CC0 PBR sets | not used | |

## What the AAA hero shooters do (and what we copied)

From Blizzard's own talks and breakdowns of Overwatch's environment art ([80.lv technical overview](https://80.lv/articles/overwatch-technical-overview),
[GDC 2017 art sessions](https://80.lv/articles/gdc-2017-the-most-essential-sessions-for-an-artist)):

- **PBR with stylised colour**: real metal/roughness workflow, but saturated, clean albedo. We take photo-scanned
  relief (normal, AO, roughness) and recolour the photo albedo to each map's own painted palette.
- **Painted bevels**: edges read soft and catch a rim of light; no hard 90 degree blockout corners. We do it in the shader.
- **Material layering**: dirt at the foot of walls, moss in cracks, wear on edges. We add grime at wall bases, cavity
  darkening from the AO map and an edge lift.
- **Less ambient occlusion than you'd think**: soft, readable shadows. AO stays a setting, the cavity term is gentle.
- **Cubemap / environment reflections** on metal, glass and polished stone: each map now reflects its own HDRI.
- **Readable, comic-book effects**: exaggerated but short-lived flashes, real smoke shapes, decals that stay a while.

## What changed in the game

All of it is desktop edition only (`FULL`); `scripts/lite-strip.mjs` drops `env/pbr` and `fx` from the web build.

1. **Map surfaces** (`src/render/Surfaces.ts`, `assetgen/fetch_cc0.py`): 21 Poly Haven sets on 9 maps (ground, wall,
   roof, rock, wood, trim). Per slot either the photo albedo recoloured to the painted texture's Lab mean and contrast
   (chroma noise damped, bilateral smooth so it reads painted), the photo's own colours at the painted lightness (rusty
   iron), or the painted texture kept with only the set's relief under it (facades, shoji, marble with gold inlay).
   Each set tiles at its own real-world size. Shader layers on every map box: quarter-round bevel on top and corner
   edges (bottom edges excluded, they meet the floor), grime over a wall's first metre, AO cavity on the albedo,
   two-octave world-space macro variation against tiling, and a roughness floor per slot so stylised stone doesn't
   mirror the sky.
2. **Image-based lighting** (`src/render/EnvLight.ts`): one HDRI per map instead of three's generic RoomEnvironment:
   golden_bay (Hanabi Harbor), kloofendal partly cloudy (Cloudstep), zhengyang_gate (Kagura), cobblestone_street_night
   (Lantern), industrial_sunset (Starfall), freight_station (Foundry), goegap (Sunset Mile), goegap_road (Iron Gulch),
   wide_street_01 (Proving Grounds). Built offline: sun clamped to 8x the mean (the map's DirectionalLight is the sun;
   a second sun in the environment double-lit everything), normalised to mean luminance 1, saturation reduced (the
   hemisphere light already carries the map's mood), turned at run time so the HDRI's bright side lines up with the
   map's sun. Heroes, props and surfaces all pick it up.
3. **Post chain** (`Game.buildComposer`, `src/render/PostFx.ts`): the composer now renders into a 4x MSAA target when
   MSAA is on (before, the canvas' MSAA never reached the composer, so "MSAA" did nothing with post on); GTAO reads the
   scene's depth texture instead of re-drawing the whole scene for a normal buffer (evera-71's profile: GTAO's redraw
   was 22% of frame CPU); SMAA replaces FXAA; a per-map colour grade after tone mapping (contrast S-curve, vibrance,
   split-tone shadows/highlights, vignette).
4. **Gunfire** (`src/render/WeaponFx.ts`): Kenney star bursts mixed into the muzzle/impact flashes, real smoke wisps that
   turn as they rise, burn-mark scorch decals, and a new dust kick (grit + a dusty puff) when rounds hit the ground.

## Tuning method

`tests/e2e/render_ab.mjs` puts a free camera at the same two spots per map (from each spawn toward the objective) and
shoots the map twice: `?classic` (dev flag: painted textures, studio room, no grade) and the new path;
`tests/e2e/tile_ab.py` tiles them and prints mean frame luminance. Each map's HDRI fill (`HDRIS` mood in
fetch_cc0.py) was set so the new frame stays within a few percent of the old brightness. Findings on the way:

- ANGLE's D3D11 backend (Chrome and Electron on Windows) rejects `vec3(float, int, int)` at draw time as an ambiguous
  constructor; GLSL compiles, the program links, and the mesh just never draws. Use float literals in every constructor.
- three r186 `GTAOPass(scene, camera, w, h, { depthTexture })` throws (setGBuffer touches the normal target the default
  path makes); construct it plainly and call `setGBuffer(depth)` after.
- `EffectComposer` starts with `readBuffer = renderTarget2`, and the number of swaps per frame depends on the passes, so
  the scene pass is pinned to renderTarget2 (the one with the depth texture) by wrapping `composer.render`.
- A normalised HDRI gives less fill in shade than RoomEnvironment's bright panels: environmentIntensity x1.6 x mood.
- Blue-hour and night HDRIs tinted grey stone violet: saturation 0.2-0.3 on those maps, roughness floors, softer
  shadow tint in the grade.

## Re-running / extending

```
python assetgen/fetch_cc0.py           # fetch missing assets, rebuild public/env/pbr + public/fx (cached in assetgen/out/cc0)
python assetgen/fetch_cc0.py --force   # rebuild every output
node tests/e2e/render_ab.mjs hanabi,mile 5199 && python tests/e2e/tile_ab.py hanabi,mile
```

To give a new map surfaces: add its slots to `MAPS` and an HDRI to `HDRIS` in fetch_cc0.py, rerun, A/B it, adjust its
mood. Ideas not done yet: animated flipbook explosions (Brackeys/Kenney sheets) in Fx.ts, decals for map wear (puddles,
graffiti, posters), cascaded shadow maps for sharper near shadows, height fog with sun in-scatter.
