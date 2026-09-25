# ZENITH//UMBRA

*Ten heroes. Two oaths. One eclipse.*

An original anime-inspired hero shooter for PC, playable in the browser and as a GPU-tuned Windows app.

- **10 heroes**: the **Zenith Vanguard** (heroes) against the **Umbra Syndicate** (villains). Each side has one giant **piloted mecha tank** (Tenkai-Oh, piloted by Haruto Daimon; Gorgoth, piloted by Warlord Vorn), two supports (one of them flies), and two DPS.
- **Rival counters**: every hero has a rival on the other team, and each of them carries an ability built to counter the other (Dawn Anchor vs Abyss Charge, Silence Aria vs Constellation Link, Warding Seal vs Severing Fang, Thunder Parry vs Chain of Oblivion, Revealing Dawn Arrow vs Stitched Decoy). The HUD calls out every counter as it happens.
- **5 story maps + Training Grounds**: Amatsu Sky Shrine, Neo-Kurogane Rainport, Hangar Zero, Crimson Moon Cathedral, Eclipse Rift. The Zenith Academy Proving Grounds adds training dummies, sentry walkers and aerial drones.
- **Modes**: 5v5 vs AI (capture point), Training, Watch AI vs AI, **AI Test Lab**, and the **Operation Starfall** campaign.
- **Campaign**: third person, 5 levels, 5 giant space-robot bosses, and the alien scientist **Archon Qel'Varis** as the final boss. Storyboard cinematics. Play solo with AI wingmates, or **online co-op for up to 4**.
- **Hero Viewer & Skins**: rotate and zoom any hero, villain, pilot or boss, preview animations, and equip one of 5 skins per hero (Classic → Legendary).

## Controls
WASD move · Space jump / hold to fly (Mirei, Nocturne) · LMB fire · RMB secondary · Shift / E abilities · Q ultimate · R reload · V first/third person · Tab scoreboard · Esc pause · H switch hero (training)

## Play
- Web: `npm i && npm run dev`, then open `/play.html`. The landing page with the animatic is `/`.
- Windows app (Ultra graphics, 2K textures, 120 Hz physics): `cd desktop && npm i && node build.mjs --installer`
- Tests: `npm test` (headless 5v5 simulations of every map + campaign levels beaten by an AI squad), `node tests/e2e/lab.mjs <url>` (AI Test Lab report: animation states, foot sliding, wall penetration, physics, effects, sounds, perf)

## Online
`api/net.js` is a Node function on Vercel. It handles presence, squad listing and WebRTC signalling for the campaign co-op, for both the web build and the Windows app. Gameplay traffic goes peer-to-peer over WebRTC data channels, with a host-authoritative simulation and client-side prediction. If a direct connection can't be made, traffic is relayed through the Vercel node at a reduced rate. Lobby state lives in the function's memory, or in Upstash Redis when `KV_REST_API_URL` / `KV_REST_API_TOKEN` are set. If the node can't be reached, the client falls back to public MQTT brokers.

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
5. `build_assets.py` / `publish_2d.py` produce the web tier (1K textures, Draco, WebP) and the desktop tier (2K textures).

## Animation library
The clips aren't in the repo. Download them yourself (itch.io / Adobe login), pack them, and the game picks them up:
1. Get **UAL1** and **UAL2** from quaternius.itch.io/universal-animation-library(-2) (glTF). Optionally add **Mixamo** clips as *FBX Binary, Without Skin, 30 fps, In Place* in one folder.
2. `blender -b -P assetgen/blender/anim_pack.py -- --ual1 UAL1.glb --ual2 UAL2.glb --mixamo mixamo_fbx/ --out public/anim` removes the meshes, writes `UAL1.glb` / `UAL2.glb` / `mixamo.glb` and adds them to `public/anim/manifest.json`. Use `--only "Idle|Jog|..."` to trim the set.
3. That's all. On load, `src/render/Retarget.ts` maps any humanoid skeleton by bone name and hierarchy: UAL, Mixamo, Rigify, Biped, old Quaternius; T-pose or A-pose; any units, facing or up axis. It bakes each clip to rig-independent poses: bone directions plus torso rotations, in leg lengths. `src/render/ClipLibrary.ts` then sorts them into slots by name. Locomotion is sorted by the direction and speed it actually travels, measured from the planted feet, so pack naming doesn't matter. Mirroring and time reversal fill in missing strafe and backpedal directions. Pin or exclude clips with `"slots"` / `"exclude"` in the manifest. `?anim=procedural` turns the library off.
4. **Hero first-person arms** (the part that gives each hero personality): `blender -b -P assetgen/blender/fp_arms.py -- --hero raijin --model public/models/raijin.glb --setup work/fp_raijin.blend` builds an authoring scene on the hero's rig. The camera is the in-game eye, and IK hand/elbow controls come with a starter `fp_idle / fp_fire / fp_alt / fp_melee / fp_reload / fp_ability1 / fp_ability2 / fp_ult / fp_hit / fp_land` set. Polish the actions in Blender, then `blender -b work/fp_raijin.blend -P assetgen/blender/fp_arms.py -- --hero raijin --export public/anim` bakes them onto the arm bones and registers `fp_raijin.glb`.

5. **Broken auto-rigged arms**: if a hero's arm joints landed inside the chest (a held weapon or long sleeves confuse the detector), `blender -b -P assetgen/blender/fix_arms.py -- --glb <hero>_plain.glb --out fixed.glb --hero <id> --test work/<id>` moves the shoulder/elbow/wrist joints from `assetgen/blender/arm_fixes.json` (front-view x/z). It re-weights only the arms, binds a held weapon fused into the mesh rigidly to the hand, keeps every other weight, and renders deformation tests. Publish with `npx @gltf-transform/cli optimize fixed.glb public/models/<id>.glb --compress draco --texture-compress webp --texture-size 1024 --simplify false`. Raijin's arms were fixed this way.

Credits when shipping clips: *Universal Animation Library 1 & 2 by Quaternius (CC0)*; Mixamo clips are free to use in games under Adobe's terms (don't redistribute them as raw animation files).

Tests: `npm test` covers retargeting accuracy across rig styles, clip analysis, the blend space and slots, plus foot sliding in a 60 fps bot match with clips against procedural. `npm run anim:fixtures` writes GLB test packs, and `node tests/e2e/anim.mjs http://localhost:5199/` checks the library, the AI Lab and the first-person arms in the browser.

Sound is fully procedural WebAudio. No audio files are used.

Third-party models used in the pipeline: SDXL (CreativeML Open RAIL++-M), TRELLIS / TRELLIS.2 (MIT), MediaPipe Pose (Apache-2.0), rembg isnet-anime (MIT), DINOv3 via timm (DINOv3 License).
