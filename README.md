# ZENITH//UMBRA

*Ten heroes. Two oaths. One eclipse.*

An original anime-inspired hero shooter for PC. **The full game is the Windows app**; the browser build is a light demo.

## Editions
One codebase, two editions (`src/edition.ts`):
- **Full: Windows app** ([download](https://github.com/Everaldtah/zenith-umbra/releases/latest/download/ZenithUmbra-Setup.exe)). Includes:
  - **Quick Play**, **Competitive** and **AI Quick Match**. You and four AI teammates play an AI team on best-of-3 **Control** or **Mikoshi Rush**, an original push mode where you escort a festival float through the enemy gate.
  - **Role ranks**: Bronze → Champion with divisions 5 → 1. There are 5 placement matches, a hidden MMR, rank modifiers (win/loss streaks, expected, calibration, uphill/reversal, consolation) and 3 protected losses at the bottom of a division. **Career & Ranks** shows your record.
  - The Overwatch 2-style **Tab screen**: E / A / D / DMG / H / MIT for everyone, plus your weapon accuracy, crit accuracy, objective time, streak, ults and hero stats.
  - **8 maps built from buildings**: interiors, upper floors and walkable roofs, two-door spawn rooms, and small / large **health packs** inside and outside. That's the 5 rebuilt arenas plus **Hanabi Harbor**, **Cloudstep Terraces** and **Kagura Avenue**.
  - **Gantetsu**, the Iron Yokozuna (tank, dual chainguns).
  - **Hibiki**, the Street Frequency (support): a street DJ on glowing mag-skates.
    - **SHIFT** Crossmix swaps his aura track between Healing Groove (heal) and Tempo Rush (+25% speed).
    - **E** Max Volume cranks the current track.
    - **RMB** Scratch Wave is a knockback cone.
    - **Mag-Grind** rides walls while you hold SPACE; five seconds of grinding empowers his next Scratch Wave.
    - **Q** Bass Drop gives nearby allies 750 decaying overhealth.
    - Mag-Grind also **climbs buildings**: look up while riding a wall to run up it, and he mantles onto the roof. **LMB** is his grind/accelerate button by default (rebindable).
  - **Tomoe**, the Crescent Empress (tank): a white-and-gold battle queen with a scattergun, a throwing blade and a great axe. Her rival is Gantetsu.
    - **LMB** Crownfire Scattergun (10 pellets).
    - **RMB** Crescent Fang: throw a jagged blade that sticks in whatever it hits. Press RMB again to recall it. It drags a stuck enemy toward you (and pulls flyers out of the sky) and cuts everyone on its way back.
    - **SHIFT** Horagai War Call: 200 temporary health for her, 100 for allies within 15m, +30% speed.
    - **E** Crescent Reaping: a wide axe cleave, with 1s off the cooldown per enemy cut.
    - **Q** Crescent Warpath: an unstoppable 20m charge that wounds and anti-heals everyone in the lane.
    - Passive **Blood Tide**: her wounds heal her for 150% of their damage. Wounds bleed straight through armor, which is her counter to Gantetsu.
  - **Options like Overwatch 2's**: VIDEO / SOUND / CONTROLS / GAMEPLAY / ACCESSIBILITY tabs (see *Options* below).
  - **Recorded sound and voice** (see *Sound* below), plus travelling tracer rounds, muzzle flashes, impact sparks, scorch marks and brass casings.
  - Mirei's guardian-angel flight and **swoop**.
  - The animation performance layer (see `ANIMATION_NOTES.md`), Stadium and the Starfall campaign.
- **Lite: the website**. You play vs AI on the original five arenas with the original ten heroes, using procedural animation and legacy single-round rules. `npm run build` runs `scripts/lite-strip.mjs`, which removes everything desktop-only from `dist/`. The URL can't switch the site to the full edition. On the dev server, `?edition=lite` previews it.

- **10 heroes**: the **Zenith Vanguard** (heroes) against the **Umbra Syndicate** (villains). Each side has one giant **piloted mecha tank** (Tenkai-Oh, piloted by Haruto Daimon; Gorgoth, piloted by Warlord Vorn), two supports (one of them flies), and two DPS.
- **Rival counters**: every hero has a rival on the other team, and each of them carries an ability built to counter the other (Dawn Anchor vs Abyss Charge, Silence Aria vs Constellation Link, Warding Seal vs Severing Fang, Thunder Parry vs Chain of Oblivion, Revealing Dawn Arrow vs Stitched Decoy). The HUD calls out every counter as it happens.
- **5 story maps + Training Grounds**: Amatsu Sky Shrine, Neo-Kurogane Rainport, Hangar Zero, Crimson Moon Cathedral, Eclipse Rift. The Zenith Academy Proving Grounds adds training dummies, sentry walkers and aerial drones.
- **Modes**: **Play vs AI** in two flavours, as in Overwatch 2: **Normal** (first person, 5v5 on the capture point) and **Stadium** (third person, first to 4 round wins, with an **Armory** between rounds where you spend the cash you earned on weapon / ability / survival items and pick a hero **power** on rounds 1, 3, 5 and 7). Also Training, Watch AI vs AI, the **AI Test Lab**, and the **Operation Starfall** campaign.
- **Campaign**: third person, 5 levels, 5 giant space-robot bosses, and the alien scientist **Archon Qel'Varis** as the final boss. Storyboard cinematics. Play solo with AI wingmates, or **online co-op for up to 4**.
- **Hero Viewer & Skins**: rotate and zoom any hero, villain, pilot or boss, preview animations, and equip one of 5 skins per hero (Classic → Legendary).

## Options
Settings opens an Overwatch 2-style Options screen. Every change applies live and is saved; each tab has RESTORE DEFAULTS.
- **Video**:
  - Display mode, FOV, frame-rate cap, render scale, dynamic render scale.
  - Brightness, contrast, gamma, image sharpening.
  - The Graphics Quality preset, which fills in texture quality, texture filtering (1x-16x), fog, dynamic reflections, shadows, model, effects and lighting detail, antialiasing (FXAA / MSAA), refraction/glow quality, ambient occlusion (GTAO), local reflections and bloom.
  - Damage FX, and performance stats (F8: simple / advanced).
- **Sound**:
  - Master, effects, music, voice, announcer, ambience, interface and hit-marker volumes.
  - Mix presets: default / headphones (3D) / speakers / night mode.
  - Menu music, sound in background, audio latency.
- **Controls**:
  - Rebind any action to any key, mouse button or wheel notch. There are two bindings per action; a key moves off whatever action had it.
  - **Per-hero control sets and sensitivity**. For example, Hibiki grinds on LMB by default.
  - Invert Y, zoomed sensitivity, and Tenkai-Oh's barrier free-look options.
  - A **reticle designer** with live preview: type, colour, thickness, length, gap, opacity, outline, centre dot.
- **Gameplay**:
  - AI difficulty and hints.
  - Counter callouts and kill feed.
  - Damage numbers and hit markers.
  - HUD scale and opacity, and objective waypoint opacity.
  - Enemy / friendly health bars and name tags.
- **Accessibility**:
  - Subtitles for voice lines (off / critical / conversations / all), with size and background controls.
  - Colour-blind correction filters with a strength slider, and enemy / friendly UI colours.
  - Camera and screen shake, and flash reduction.

The ability bar shows the keys you actually bound.

## Controls
WASD move · Space jump / hold to fly (Mirei, Nocturne) · F swoop to an ally (Mirei; Space mid-swoop = slingshot, Ctrl = superjump) · LMB fire · RMB secondary · Shift / E abilities · Q ultimate · R reload · V first/third person (Normal is always first person, Stadium always third) · Tab scoreboard / your stats · Esc pause · H switch hero (training)

## Play
- Web: `npm i && npm run dev`, then open `/play.html`. The landing page with the animatic is `/`.
- Windows app (Ultra graphics, 2K textures, 120 Hz physics): `cd desktop && npm i && node build.mjs --installer`
- Sound and effects: `node tests/e2e/audio_check.mjs 5199 gantetsu hanabi` (bank loaded, which ids play recorded vs synth, threat mix), `node tests/e2e/audio_glitch.mjs 5199 hibiki kagura 25` (the output meter counts clipped samples and clicks in a live match; it self-checks by injecting a click), `node tests/e2e/vfx_wall.mjs 5199 gantetsu`, `node tests/e2e/hibiki_play.mjs 5199`, `node tests/e2e/tomoe_play.mjs 5199`
- Options: `node tests/e2e/settings_ui.mjs 5199`. It covers every tab, real key/mouse rebinding through input capture, per-hero overrides, the live-applied video/sound/accessibility options, persistence and restore defaults.
- Hero close-ups: `node tests/e2e/hero_look.mjs tomoe e 0.25,0.45 30` (large viewer shots at chosen moments of a state)
- Screens: `node tests/e2e/ui_tour.mjs 5199` (menus, a live match, Tab screen, Mikoshi Rush, results, every map, the lite title), `node tests/e2e/lite_check.mjs 5199` (web edition)
- Tests: `npm test` (map / Control / Mikoshi Rush / health pack / rank rules in `tests/unit/modes.test.ts`, hero kits in `kit.test.ts`, headless 5v5 simulations of every map + campaign levels beaten by an AI squad), `node tests/e2e/lab.mjs <url>` (AI Test Lab report: animation states, foot sliding, wall penetration, physics, effects, sounds, perf)

## Online
`api/net.js` is a Node function on Vercel. It handles presence, squad listing and WebRTC signalling for the campaign co-op, for both the web build and the Windows app. Gameplay traffic goes peer-to-peer over WebRTC data channels, with a host-authoritative simulation and client-side prediction. If a direct connection can't be made, traffic is relayed through the Vercel node at a reduced rate. Lobby state lives in the function's memory, or in Upstash Redis when `KV_REST_API_URL` / `KV_REST_API_TOKEN` are set. If the node can't be reached, the client falls back to public MQTT brokers.

## Sound (desktop edition)
The Windows app plays a recorded bank (`public/sfx`, about 14 MB): 138 sound effects and 496 voice lines. They are mixed the way Blizzard described Overwatch's "Play by Sound" design (GDC 2016):
- **Threat buckets**: 1 high, 2 normal, 4–10 low, the rest culled. An enemy's loudness depends on whether they're looking at you, near you, shooting, hurting you, or using an ultimate. Enemy footsteps are louder than friendly ones.
- **Occlusion** muffles sounds behind walls, and more so across floors.
- **Distance air absorption**, and HRTF panning up close.
- **Space**: a per-map reverb that crossfades to a room when there's a roof overhead, plus **quad-delay** wall reflections.
- **Physics sounds**: footsteps by surface and weight, bullet impacts by material, brass casings, skates, grinding, wind.

**Voice lines are stimulus-driven.** Each stimulus has a category, and the category decides who hears the line:
- **Critical** (ults): enemies and the caster hear the warning line; allies hear the caster's own line.
- **Death**: everyone.
- **Pain**: only the heroes involved.
- **Chatter**: the hero's team.
- **Exert** (jump/land grunts): only the player.

Lines also follow priority, cooldown and interrupt rules. Mech pilots speak over cockpit radio, and an announcer calls the objective. With subtitles on, lines show on screen with the speaker's name.

**Glitch safeguards.** No crackles, no scratchy audio:
- The mix runs at 48 kHz through a glue compressor and a brickwall true-peak limiter.
- An AudioWorklet meter on the final output counts clipped samples and clicks.
- Every one-shot gets a 2 ms fade-in; loops start and stop on fades; loops ship as sample-exact FLAC.
- Per-category voice caps, plus a load watchdog that sheds HRTF and reflections before the audio thread underruns.
- Every asset passes `assetgen/audio_qa.py`, which checks clipping, true peak, saturation, LPC click detection, edges, dropouts, DC and loop seams.
- The few sounds still synthesised at runtime use sine and triangle waves only.

How it was made:
- **Sound effects**: MOSS-SoundEffect (Apache 2.0) on Modal. The takes are ranked by LAION-CLAP, then trimmed, given back their high end, looped and loudness-matched (`assetgen/modal_sfx.py`, `audio/sfx_list.py`, `audio_finish.py`).
- **Voices**: each character's timbre comes from Kokoro-82M (Apache 2.0) and is performed by Chatterbox (MIT). Whisper transcribes every take so the best one per line is picked (`assetgen/modal_voice.py`, `audio/voice_lines.py`). Newer heroes run the same pipeline on Kaggle (`kagglevoice`).
- **Tomoe's sounds**: MMAudio (MIT) text-to-audio on Kaggle GPUs, with the same CLAP ranking (`assetgen/kagglesfx/kagglesfx.py`).
- **Web edition**: keeps the small synthesised recipes in `src/audio/Sfx.ts`.

## How the art was made (all original, generated for this project)
`assetgen/` is the whole pipeline:
1. **SDXL** on Kaggle T4×2 renders character sheets, key art, map concepts, skies, tileable textures and props (`kaggle_run.py concepts|models2|campaign`).
2. **TRELLIS / TRELLIS.2** (MIT) turns the picked renders into textured GLBs (`kaggle_run.py trellis|trellis2`).
3. **Blender auto-rigger** (`blender/rig_hero.py`):
   - Joints come from MediaPipe pose on an orthographic front render, with a silhouette-based fallback and anatomical sanity checks.
   - Skin weights use bone heat, or a geodesic voxel solver (`blender/weights.py`) when heat fails.
   - Loose armour plates and held weapons bind rigidly to the right bone.
   - Hair, cape and skirt spring-bone chains are detected automatically.
4. **Runtime animation** (`src/render/Animator.ts`) layers a mocap clip library over a procedural base:
   - **clips** (optional, `public/anim/`): Quaternius **Universal Animation Library 1 & 2** (CC0) and **Mixamo** gap-fillers, retargeted on load onto every hero (see *Animation library* below): 8-way idle/walk/jog/sprint blend space, jumps, deaths, hit reactions, melee combos one hit per swing, punches, rolls, parkour
   - **procedural**, always on top: two-bone IK legs with feet locked in world space (no sliding), aim-driven spine, recoil and flinch, Tenkai-Oh's hammer, flyers and mechs, wing flaps, verlet spring physics for hair and cloth. With no clip library the game is fully procedural, as before
   - **first-person arms** (`src/render/FirstPerson.ts`): each hero's own model as a viewmodel, with Blender-authored per-hero clips where they exist and a procedural personality per hero otherwise
5. `build_assets.py` / `publish_2d.py` produce the web tier (Draco, WebP) and the desktop tier.

**The hero-shooter rebuild (current heroes)**: every hero was rebuilt for a polished stylized team-shooter look - adult
heroic proportions, clean bevelled shapes, painted colour blocks, expressive faces:
1. `modal_restyle.py` re-renders each hero's concept with **Qwen-Image-Edit-2511** (Apache-2.0) on a Modal A100: same
   character, outfit, colours and weapon, in a clean A-pose for rigging (`--seeds N` candidates, picks go in `work/ow/pick`).
2. `modal_trellis2.py`: **TRELLIS.2** at its highest setting (1536 cascade, bf16, 4K PBR bake, remeshed) on a Modal A100.
3. `ow_finish.py`: the face from the 4x Real-ESRGAN concept (`modal_upscale.py`) projected onto the head (`facebake.py`),
   then `blender/owpaint.py` bakes occlusion, painted edge highlights and a head-to-toe value gradient into the albedo.
4. `build_assets.py --unirig`: MediaPipe rig (`rig_hero.py`, 45k tris / mechs 70k), then **UniRig** (MIT) skin weights
   predicted for that skeleton on Modal (`modal_unirig.py` -> `blender/apply_skin.py`), then web (2K) / desktop (4K) GLBs.
5. `bake_fp.py`: every hero's Overwatch-style first-person clip set (`blender/fp_choreo.py` -> `blender/fp_arms.py`).

## Animation library
Handoff notes, including measured data, open work and pitfalls: [`ANIMATION_NOTES.md`](ANIMATION_NOTES.md).

The clips aren't in the repo. Download them yourself (itch.io / Adobe login), pack them, and the game picks them up:
1. Get **UAL1** and **UAL2** from quaternius.itch.io/universal-animation-library(-2) (glTF). Optionally add **Mixamo** clips as *FBX Binary, Without Skin, 30 fps, In Place* in one folder.
2. `blender -b -P assetgen/blender/anim_pack.py -- --ual1 UAL1.glb --ual2 UAL2.glb --mixamo mixamo_fbx/ --out public/anim` removes the meshes, writes `UAL1.glb` / `UAL2.glb` / `mixamo.glb` and adds them to `public/anim/manifest.json`. Use `--only "Idle|Jog|..."` to trim the set.
3. That's all. On load, `src/render/Retarget.ts` maps any humanoid skeleton by bone name and hierarchy: UAL, Mixamo, Rigify, Biped, old Quaternius; T-pose or A-pose; any units, facing or up axis. It bakes each clip to rig-independent poses: bone directions plus torso rotations, in leg lengths. `src/render/ClipLibrary.ts` then sorts them into slots by name. Locomotion is sorted by the direction and speed it actually travels, measured from the planted feet, so pack naming doesn't matter. Mirroring and time reversal fill in missing strafe and backpedal directions. Pin or exclude clips with `"slots"` / `"exclude"` in the manifest. `?anim=procedural` turns the library off.
4. **Hero first-person arms** (the part that gives each hero personality): `blender -b -P assetgen/blender/fp_arms.py -- --hero raijin --model public/models/raijin.glb --setup work/fp_raijin.blend` builds an authoring scene on the hero's rig. The camera is the in-game eye, and IK hand/elbow controls come with a starter `fp_idle / fp_fire / fp_alt / fp_melee / fp_reload / fp_ability1 / fp_ability2 / fp_ult / fp_hit / fp_land` set. Polish the actions in Blender, then `blender -b work/fp_raijin.blend -P assetgen/blender/fp_arms.py -- --hero raijin --export public/anim` bakes them onto the arm bones and registers `fp_raijin.glb`.

5. **Broken auto-rigged arms**: if a hero's arm joints landed inside the chest (a held weapon or long sleeves confuse the detector), `blender -b -P assetgen/blender/fix_arms.py -- --glb <hero>_plain.glb --out fixed.glb --hero <id> --test work/<id>` moves the shoulder/elbow/wrist joints from `assetgen/blender/arm_fixes.json` (front-view x/z). It re-weights only the arms, binds a held weapon fused into the mesh rigidly to the hand, keeps every other weight, and renders deformation tests. Publish with `npx @gltf-transform/cli optimize fixed.glb public/models/<id>.glb --compress draco --texture-compress webp --texture-size 1024 --simplify false`. Raijin's arms were fixed this way.

Credits when shipping clips: *Universal Animation Library 1 & 2 by Quaternius (CC0)*; Mixamo clips are free to use in games under Adobe's terms (don't redistribute them as raw animation files).

Tests: `npm test` covers retargeting accuracy across rig styles, clip analysis, the blend space and slots, plus foot sliding in a 60 fps bot match with clips against procedural. `npm run anim:fixtures` writes GLB test packs, and `node tests/e2e/anim.mjs http://localhost:5199/` checks the library, the AI Lab and the first-person arms in the browser.

Sound is fully procedural WebAudio. No audio files are used.

Third-party models used in the pipeline: SDXL (CreativeML Open RAIL++-M), Qwen-Image-Edit-2511 (Apache-2.0), TRELLIS / TRELLIS.2 (MIT), UniRig (MIT), Real-ESRGAN (BSD-3), BiRefNet via rembg (MIT), MediaPipe Pose (Apache-2.0), rembg isnet-anime (MIT), DINOv3 via timm (DINOv3 License).
