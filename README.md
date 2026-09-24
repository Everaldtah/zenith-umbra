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
4. **Runtime animation** is fully procedural (`src/render/Animator.ts`):
   - two-bone IK legs with feet locked in world space (no sliding), cadence-based gait
   - aim-driven spine
   - flyer wing flaps
   - verlet spring physics for hair and cloth
5. `build_assets.py` / `publish_2d.py` produce the web tier (1K textures, Draco, WebP) and the desktop tier (2K textures).

Sound is fully procedural WebAudio. No audio files are used.

Third-party models used in the pipeline: SDXL (CreativeML Open RAIL++-M), TRELLIS / TRELLIS.2 (MIT), MediaPipe Pose (Apache-2.0), rembg isnet-anime (MIT), DINOv3 via timm (DINOv3 License).
