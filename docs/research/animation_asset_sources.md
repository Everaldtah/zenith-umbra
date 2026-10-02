# Where to get animation for ZENITH//UMBRA: assets, movement logic, physics (research thread)

By system32 (Opus 5.5), 2026-10-02. Read-only research, no code changed. Licenses were checked against the vendors' own
pages or repos where possible; always re-read a license before buying or shipping, because terms change.

**What we already run** (so the thread focuses on gaps): Quaternius UAL1 + UAL2 (CC0) and Mixamo clips in
`public/anim`, baked to rig-independent PoseClips by `src/render/Retarget.ts`, sorted into gameplay slots by
`ClipLibrary.ts` (8-way locomotion blend space measured from the feet, mirroring, auto-trim), a Verlet ragdoll
(`Ragdoll.ts`), Blender-authored first-person arm clips (`fp_*.glb`, `fp_arms.py`), and a custom collision layer
(`src/engine/Physics.ts`, no physics engine). **Anything humanoid that ships as FBX/GLB/BVH can enter this pipeline.**
The real filter is the license, not the format.

**Implemented 2026-10-02** (`assetgen/anim/README.md`): `cmu.glb` (10 CMU mocap clips, committed: flips, cartwheel,
vaults, dive roll, falls, a roundhouse kick), `kevin.glb` (30 Kevin Iglesias FREE clips, gitignored / desktop build only:
reloads per weapon, throws incl. a boomerang throw + catch, casts, hit reactions, deaths, melee), the retargeter now
reads DAZ (`lShldr`) and `B-` rigs, grounds / centres clips captured in absolute room space and puts travelling
one-shots in place (Mixamo's front flip had been carrying the body 7 leg lengths off its capsule), and `ClipLayer`
inertializes one-shot cuts (Bollo / Holden). Not used: Mocap Online's free pistol pack (strictest license, duplicates
pistol clips we have), Rokoko / ActorCore free clips (account-gated apps), 100STYLE (needs per-hero gaits), HY-Motion
(territory clause), Jolt / Rapier (a physics-engine swap is its own project).

---

## 1/ The license question decides almost everything

We are a **three.js** game with a **public GitHub repo**, a **public Vercel site** (LITE, GLBs downloadable by any
browser) and a **GitHub-released Electron installer** (FULL). That gives four buckets:

| Bucket | Examples | Can we use it? |
|---|---|---|
| **CC0 / free redistribution** | Quaternius UAL, Kenney, CMU mocap (not resold), 100STYLE (CC BY: credit needed) | Anywhere: repo, LITE site, FULL app |
| **Royalty-free, no raw redistribution** | Mixamo, Unity Asset Store, Fab *Standard License*, Mocap Online, Kubold, Rokoko, ActorCore | FULL app only, packed in the asar. **Never commit to the public repo, never serve from the LITE site** (the same rule `mixamo.glb` already follows) |
| **Unreal-only ("UE-Only Content")** | Epic's Game Animation Sample (GASP), Lyra, Paragon heroes | **No.** Licensed for Unreal Engine products only; fine to *study* in UE |
| **Non-commercial / no-derivatives** | Ubisoft LAFAN1 (CC BY-NC-ND), Bandai Namco Research (CC BY-NC-ND), GVHMR, SMPL body models | Prototyping and learning only. ND forbids the retarget edits we'd make anyway |

Key sources:
- Mixamo: royalty-free in games, but "any type of free distribution of character or animation raw files" is
  forbidden, and an Adobe moderator confirmed that a public GitHub repo counts.
  [Mixamo FAQ](https://community.adobe.com/t5/mixamo-discussions/mixamo-faq-licensing-royalties-ownership-eula-and-tos/m-p/13234775).
  Mixamo is still free but "in maintenance mode", with no new clips
  ([Cinevva 2026 guide](https://app.cinevva.com/guides/free-character-animations-rigging)).
- Unity Asset Store assets **are allowed in other engines**, but "cannot be redistributed as standalone items or in a
  way that allows others to extract them from your final product"
  ([Unity support](https://support.unity.com/hc/en-us/articles/34387186019988-Can-I-use-assets-from-the-Asset-Store-with-other-engines)).
  Tip: a `.unitypackage` is just a gzipped tar of GUID folders (`asset` + `pathname`), so you can pull out the raw
  FBX files without installing Unity.
- Fab's Standard License allows any engine ([Epic](https://www.unrealengine.com/blog/fab-content-marketplace-launches-in-october-publishing-portal-opens-today)).
  Epic's *own* content is the exception: GASP "is only licensed for use with Unreal Engine"
  ([Epic blog](https://www.unrealengine.com/en-US/blog/game-animation-sample)), Lyra is marked "UE-Only Content"
  ([Fab](https://www.fab.com/listings/93faede1-4434-47c0-85f1-bf27c0820ad0)), and Paragon is the same
  ([TechRaptor](https://techraptor.net/content/epic-games-paragon-assets-unreal-engine)).
- Never use ripped Overwatch, Fortnite or Valorant models or animations from "models-resource"-type sites: that's
  copyright infringement, and it breaks the project rule of original designs only.

---

## 2/ Free and safe: plug in today

| Source | What | License | Fit for us |
|---|---|---|---|
| **[CMU mocap retargeted to Quaternius rig (rancidmilk)](https://rancidmilk.itch.io/free-character-animations)** | **2,000+ clips** from the CMU database, already converted to **glTF** and FBX on CC0 Quaternius characters, plus a Blender retarget add-on | CMU terms: copy, modify and redistribute freely, including in commercial products; just don't resell the data | **Top free pick.** Same rig family as UAL, so Retarget.ts should take it directly. Covers walk/run/jump variety, fighting, acrobatics and 55 two-person interactions. It's raw mocap: expect to trim (ClipLibrary already auto-trims) |
| [CMU Graphics Lab DB](http://mocap.cs.cmu.edu) (original) | 2,548 motions in ASF/AMC, with BVH conversions on cgspeed | Same as above | Use the rancidmilk conversion instead |
| [Quaternius UAL 2 source tier](https://quaternius.itch.io/universal-animation-library-2) | The free version is about 70% of the pack; the paid **Source** tier adds the rest plus the .blend rig | CC0 | Cheap way to fill holes in the pack we already use. Preview everything at [quaternius.com/animviewer.html](https://quaternius.com/animviewer.html) |
| [Kevin Iglesias FREE packs](https://kevdev.itch.io) | Free samplers: **Soldier** (firearms), **Archer** (bow), **Spellcasting**, **Melee**, Basic Motions. Masculine and feminine versions, Blender files included | Commercial use OK, no credit required | Soldier fits gun heroes, Archer fits Seiran, Spellcasting fits casters. Keep raw files out of the repo |
| [Rokoko Motion Library](https://www.cgchannel.com/2020/03/get-150-free-mocap-moves-from-rokokos-motion-library) | **150 free** pro-studio mocap clips (Audiomotion, Centroid), exported via Rokoko Studio; extras $3–6 each | Commercial OK | Good for combat and athletic variety. FULL edition only |
| [ActorCore](https://actorcore.reallusion.com) (Reallusion) | 4,500+ paid mocap clips; a small free set (~30 at last count) in FBX | Commercial, no redistribution | Gunplay and combat series. FULL only |
| [Mocap Online free packs](https://mocaponline.itch.io) | [Free Pistol starter (20+)](https://mocaponline.itch.io/free-pistol-animation-starter-pack), [Ninja Starter (21 + 6 aim offsets)](https://mocaponline.itch.io/ninja-starter-anims) | Mocap Online Standard License | **Ninja Starter suits Hayate and Seiran.** Try it before paying for Pro |
| [Kenney Mini Characters](https://kenney.nl/assets/mini-characters) | 32 clips on a 7-joint rig | CC0 | Too simple for heroes; fine for UI and lobby filler |
| [100STYLE](https://zenodo.org/record/8127870) | Locomotion in 100 styles (proud, sneaky, heavy...) | **CC BY 4.0**: commercial OK with credit | Style variety per hero (Gantetsu heavy, Kagemaru sneaky). Raw BVH needs retargeting |
| [VRoid free .vrma pack](https://vroid.com/en/news/6HozzBIV0KkcKf9dc1fZGW) | 7 free VRM Animation clips; [BOOTH](https://booth.pm) has many more anime-style paid motions | Per item (often VN3), so read each one | Anime emotes and dances; [three-vrm](https://github.com/pixiv/three-vrm) (MIT) loads .vrma. Licenses vary a lot, so check every item |

---

## 3/ Paid packs built for shooters and hero abilities

| Vendor | Pack | Why it fits | Notes |
|---|---|---|---|
| **[Mocap Online](https://mocaponline.com)** | **Pistol Pro** (868+ clips: 372 animations, **48 aim offsets**, 36 split jumps), **Rifle Pro** (390+), **Ninja Pro** (177 clips + 39 aim offsets, *star throws*, flips, wall work), Superhero, Magic | The most hero-shooter-shaped library on the market: aim offsets in every stance, holster/swap/reload, and transitions | [Standard License](https://mocaponline.com/pages/standard-license): royalty-free and binary-only distribution, with a commercial-license threshold around $1M revenue. Bundles: [Humble FPS & TPS T1 $125 / T2 $165](https://mocaponline.com/products/unreal-humble-bundle-fps-tps-t1) (all formats despite the "Unreal" name) |
| **Kubold** (Unity Asset Store / Fab) | Rifle Animset Pro (120+), Movement Animset Pro, Sword & Shield / Longsword Animset Pro | Long-standing, clean FBX mocap on a HumanIK skeleton | Unity EULA allows other engines. [Longsword AP](https://marketplace.unity.com/packages/3d/animations/longsword-animset-pro-92239) fits Hayate |
| **[rapamotion](https://rapamotion.itch.io/mage-abilities)** | Mage Abilities, Elemental/Feminine Mage (80+ clips at 60 fps in the bundle) | Energy blasts, conjuring, power-ups: **casters and ult wind-ups** | itch.io; read the license page |
| [Ninja Mocap packs (Superhive)](https://superhivemarket.com/products/ninja-mocap-animation-packs) | 219+ ninja clips in Blender format | Blender-native, so it fits our bake scripts | Same content family as Mocap Online Ninja |
| **[KINEMATION](https://kinemation.itch.io/fps-animation-framework)** | FPS Animation Framework / FPS Animation Pack (10 weapons) / Tactical Shooter Pack | The industry-standard indie *first-person* layer: procedural recoil, ADS, sway, equip | The value is Unity/UE *code*. For us, only the FP clip data plus the ideas carry over |
| [Synty ANIMATION – Base Locomotion](https://syntystore.com/products/animation-base-locomotion) | $69.99: walks to sprints, jumps, slides; masc/fem blendable | Stylised and readable | Mecanim-oriented; extract the FBX files |
| Itch FP arm rigs | [PSX First Person Arms (free)](https://drillimpact.itch.io/psx-first-person-arms-free), [Retro FP Arms with IK](https://comp3interactive.itch.io/retro-first-person-arms) | Rig references for `fp_arms.py` | Retro/PSX style doesn't match the anime look. Use them as rig references, not shipped meshes |

**How to shop:** buy only what fills a slot we're missing. Measured from our GLBs on 2026-10-02: UAL1 = 43 clips,
UAL2 = 43, mixamo = 38. All the weapon handling is **pistol only** (`Pistol_Aim_Down/Neutral/Up`, `Pistol_Idle_Loop`,
`Pistol_Shoot`, `Pistol_Reload`). Traversal is a single `ClimbUp_1m`, there are just two throws (`OverhandThrow`,
`MX_Throw`), and there is **no wall-run, mantle-over, rifle or heavy-weapon aim set, or stun loop**. The full UAL packs list
120+ and 130+ clips, so check what the rest of the free and Source tiers add before buying elsewhere. Ninja Pro plus
the Pistol/Rifle aim offsets cover most of the remaining gaps.

---

## 4/ Make our own: AI and video mocap tools (ranked by fit)

| Tool | Input → output | Price / license | Fit |
|---|---|---|---|
| **Tripo Animate** ([guide](https://www.tripo3d.ai/blog/apply-preset-animations-to-3d-character)) | 100+ presets on the auto-rig → GLB/FBX | **Already on our Max plan** | Zero new tooling: heroes are already Tripo + Mixamo-rigged. Quick to test |
| **[Cascadeur](https://cascadeur.com/plans)** | Keyframe with AI posing + **physics** (balance, momentum) → FBX/DAE | Free = non-commercial. **Indie** $8/mo billed yearly (<$100k revenue; becomes perpetual after a year). AutoPhysics and retargeting are **Pro** only ($33/mo yearly) | Best tool for hand-authoring OW-style ability moves (leaps, slams, dashes) that obey physics |
| **[Rokoko Vision](https://www.cgchannel.com/2023/09/check-out-free-browser-based-ai-mocap-tool-rokoko-vision/)** | Phone/webcam video → FBX/BVH | **Free** for single camera; output is yours | Film yourself doing the move, clean up in Cascadeur. Cheapest path to *custom* moves |
| [Move One](https://docs.move.ai/knowledge/move-one-pricing) | iPhone video → mocap | 30 free credits; $15/mo Starter | Better quality than the free tools; clips up to 30 s on free, 60 s paid |
| [DeepMotion Animate 3D / SayMotion](https://www.cgchannel.com/2024/06/deepmotion-launches-ai-text-to-animation-service-saymotion) | Video or text → FBX/GLB/BVH | Free tier is 60 s/mo and non-commercial; paid from $15/mo | Expect foot slide on fast moves without paid smoothing |
| [Uthana](https://uthana.com/product/text-to-motion) | Text/video → 3 variants → FBX/GLB; API + Blender plugin | Free account; API | Could plug into `assetgen` like the Tripo scripts |
| [Meshy animate](https://www.meshy.ai/features/ai-animation-generator) | Auto-rig + **600+ presets** | Free tier output is CC BY 4.0; Pro $20/mo | Similar to Tripo's library, but bigger |
| [Cinevva Prompt Animations](https://app.cinevva.com/guides/ai-animation-generators-3d) | Text → 1–10 s clip → BVH/GLB | Free account; "output is yours" | Short single actions |
| [Plask](https://plask.ai) | Browser video mocap, multi-person | 15 s/day free | Commercial terms unclear: check first |
| [Motorica](https://motorica.ai) | Style-controlled locomotion synthesis → FBX | Free Lite; studio pricing | Per-hero gait personality |
| [Maya MotionMaker](https://blogs.autodesk.com/media-and-entertainment/2025/06/04/meet-motionmaker/) | Path → ML locomotion (human, dog) | Needs Maya 2026.1 | Only if Maya is ever in the pipeline |
| **[HY-Motion 1.0](https://github.com/Tencent-Hunyuan/HY-Motion-1.0)** (Tencent, open weights) | Text → SMPL-H skeletal motion (1.0B, or Lite 0.46B) | Needs **24–26 GB VRAM** (Modal A10G/L4, not a Kaggle T4). **License caveat:** commercial OK under 1M MAU, but it "does not apply in the European Union, United Kingdom and South Korea", including using or displaying outputs there | Strong quality, but the territory clause clashes with a worldwide public download. **Treat as risky for shipped content** |
| [FreeMoCap](https://github.com/freemocap/freemocap) | Multi-webcam markerless mocap | Software is AGPL-3.0 (your captures are your data) | Free; needs 2+ webcams |
| [GVHMR](https://github.com/zju3dv/GVHMR) / [WHAM](https://github.com/yohanshin/WHAM) | Research video → SMPL motion | GVHMR: **non-commercial only**. WHAM's code is MIT but depends on SMPL models (non-commercial) | Learning only |

**Recommended custom-move workflow:** phone video → Rokoko Vision (free) → Cascadeur cleanup (Indie) → FBX → Blender
bake → `public/anim/*.glb`. For signature hero moves where physical weight matters, key them directly in Cascadeur.

---

## 5/ How the big games do it (talks and articles to study)

**Overwatch**
- Matthew Boehm, GDC 2017: personality in *first-person* animation without blocking the player's view
  ([gameanim](https://www.gameanim.com/2017/04/29/first-person-animation-overwatch),
  [Inven summary](https://www.invenglobal.com/articles/1187/how-overwatchs-first-person-animation-breathed-life-into-heroes)).
- Jesse Davis, GDC 2017, *The Animation Pipeline of Overwatch*: hero rigs, FP-driven performances
  ([GDC Vault](https://www.gdcvault.com/play/1024267/The-Animation-Pipeline-of-Overwatch)).
- David Gibson, GDC 2016, animating Mei ([80.lv](https://80.lv/articles/david-gibson-animating-mei-in-overwatch)).
- Timothy Ford, GDC 2017, *Overwatch Gameplay Architecture and Netcode*: ECS, everything predicted by default,
  fixed 16 ms command frames, determinism ([GDC Vault](https://gdcvault.com/play/1024001/-Overwatch-Gameplay-Architecture-and)).
  This is *the* reference for movement logic.
- Our own notes already distil some of this: `docs/research/ow_dynamics.md`, `fp_viewmodel_spec.md`.

**Fortnite / Epic**
- Fortnite moved locomotion to **Motion Matching** at Chapter 5. GDC 2024, *UE 5.4 Animation Deep Dive*
  ([schedule](https://schedule.gdconf.com/session/unreal-engine-54-animation-deep-dive-presented-by-epic-games/904103),
  [80.lv](https://80.lv/articles/enjoy-improved-animations-in-fortnite-chapter-5)).
- GASP (UE-only, *study only*): 500+ clips, and the UE 5.7 update added a **Mover**-based character with 400 more
  locomotion clips ([80.lv](https://80.lv/articles/game-animation-sample-project-updated-for-unreal-engine-5-7)).
  [Mover](https://dev.epicgames.com/documentation/en-us/unreal-engine/mover-in-unreal-engine) is Epic's next-gen,
  rollback-networked movement: a good architecture reference for "movement modes" (walk, fall, wall-run, grind).

**Apex / Respawn**
- GDC 2024, *The Legends Behind Apex Animation*: first- and third-person, start to finish
  ([GDC Vault](https://gdcvault.com/play/1034518/Animation-Summit-The-Legends-Behind)).

**Animation tech (search by title)**
- Simon Clavet, GDC 2016, *Motion Matching and The Road to Next-Gen Animation* (For Honor).
- David Bollo, GDC 2018, *Inertialization: High-Performance Animation Transitions in Gears of War*.
- David Rosen, GDC 2014, *An Indie Approach to Procedural Animation* (Overgrowth): how a few poses plus springs read
  as full animation. Very close to our procedural Animator.
- Daniel Holden ([publications](https://www.theorangeduck.com/page/publications)): *Spring-It-On* (critically damped
  springs for game code), *Dead Blending*, *Learned Motion Matching*.

---

## 6/ Movement logic and physics code we can legally learn from or port

| Code | License | Use |
|---|---|---|
| **[orangeduck/Motion-Matching](https://github.com/orangeduck/Motion-Matching)** | **MIT** | Complete motion matching + inertialization + spring code (C++/raylib). **Can be ported to TypeScript legally.** The best upgrade path for `Animator.ts` transitions |
| **[Rapier JS](https://rapier.rs/docs/user_guides/javascript/character_controller)** | Apache-2.0 | Kinematic character controller: autostep for stairs, slope climb/slide limits, snap-to-ground, moving platforms |
| **[JoltPhysics.js](https://github.com/jrouwe/JoltPhysics.js)** | MIT | WASM port with the same API as C++ Jolt (Horizon Forbidden West's engine): CharacterVirtual and **motorised ragdolls**, which suit powered hit reactions. Has an official three.js addon ([docs](https://threejs.org/docs/pages/JoltPhysics.html)). Desktop-only candidate (WASM size) |
| **[three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh)** | MIT | Capsule-vs-BVH character movement example, no physics engine needed. Closest to our custom `Physics.ts` |
| [ecctrl](https://github.com/pmndrs/ecctrl) / [BVHEcctrl](https://github.com/pmndrs/BVHEcctrl) | MIT | R3F controllers (floating spring capsule, moving platforms). We're not on R3F, but the logic ports |
| [three CCDIKSolver](https://threejs.org/docs/pages/CCDIKSolver.html), [closed-chain-ik](https://github.com/gkjohnson/closed-chain-ik-js) | MIT | Foot IK on slopes, hands IK onto two-handed weapons |
| [Source SDK 2013](https://github.com/ValveSoftware/source-sdk-2013) (`gamemovement.cpp`) | Source 1 SDK License (non-commercial, for mods) | **Read only**, then reimplement: the air-strafe and accelerate/friction model behind bhop/surf feel |
| [Opsive springs doc](https://opsive.com/support/documentation/ultimate-character-controller/animation/springs/) | Docs | Clear write-up of spring-driven FP sway, bob and recoil (no clips needed) |
| [PWAS on Fab](https://www.fab.com/listings/7dc97b27-be73-4505-8a10-7d6b75f4acfc) | Fab | Fully procedural FP weapon animation (recoil, sway, ADS, breathing, camera kick): a feature checklist |

---

## 7/ Recommendations for ZENITH//UMBRA, in order

1. **Free, this week:** add the **rancidmilk CMU glTF pack** (redistributable, so it can even ship in LITE) and the
   **Kevin Iglesias** free Soldier/Archer/Spellcasting packs plus **Mocap Online Ninja Starter** (FULL only). Pin the
   best clips in `manifest.json` slots and `heroes`/`casts` overrides.
2. **Already paid for:** test **Tripo Animate** presets on one Tripo hero, since the rig is already Mixamo-named.
3. **If spending money:** Mocap Online **Ninja Pro** (Hayate/Seiran: star throws, flips) plus **Pistol/Rifle Pro aim
   offsets** (Haruto, gunners), or the FPS & TPS bundle T1 ($125). FULL edition only, gitignored like `mixamo.glb`.
4. **Signature ult and ability moves:** Rokoko Vision (free) → Cascadeur Indie → Blender bake.
5. **Tech upgrades** (bigger wins than more clips):
   - Port **inertialization + springs** from orangeduck (MIT) into `Animator.ts`/`ClipLayer.ts` for snappier,
     Overwatch-like transitions between clip and procedural layers.
   - Later: a small **motion-matching** database built from the CMU locomotion (orangeduck's code is the template).
   - Evaluate **Jolt motorised ragdolls** to replace or augment the Verlet `Ragdoll.ts` for *living* hit reactions
     (stagger, knockdown) on desktop.
6. **Avoid:** GASP, Lyra and Paragon (UE-only), LAFAN1 and Bandai Namco (NC-ND), GVHMR (non-commercial), HY-Motion
   outputs in a worldwide release (territory clause), and any ripped game files.
