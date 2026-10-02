# Free animation packs (public/anim)

The clip library (`src/render/ClipLibrary.ts`) loads every pack in `public/anim/manifest.json` and bakes it through the
retargeter (`src/render/Retarget.ts`), so any humanoid skeleton works. Research and licenses: `docs/research/animation_asset_sources.md`.

| Pack | Source | License | In git |
|---|---|---|---|
| `UAL1.glb`, `UAL2.glb` | Quaternius Universal Animation Library 1 & 2 (Standard) | CC0 | yes |
| `cmu.glb` | CMU Graphics Lab mocap, rancidmilk's Quaternius-rig glTF conversion | free to use / modify / redistribute, never sold as animations (`public/anim/LICENSE-CMU.txt`) | yes |
| `mixamo.glb` | Mixamo | royalty-free in games, no raw redistribution | **no** (gitignored, desktop build only) |
| `kevin.glb` | Kevin Iglesias Human Soldier / Melee / Spellcasting / Throwing Animations FREE | Standard Unity Asset Store EULA | **no** (gitignored, desktop build only) |
| `tripo.glb` | **the movement set**: Tripo Studio text-to-motion (walk / jog / run loops, idle, jump take-off + landing, stun, roll, dash, slide) | output of the project's paid Tripo account (like the Tripo hero models) | yes |

The website (lite edition) animates procedurally and never downloads the library (`scripts/lite-strip.mjs` drops `anim/`).

## Rebuild

Needs Python `requests` (behind a TLS-intercepting antivirus set `REQUESTS_CA_BUNDLE`) and Blender 5.x.

```sh
# CMU: only the clips in cmu_map.json are fetched, by HTTP range requests out of the 764 MB zip (~7 MB)
python assetgen/anim/remote_zip.py "https://rancidmilk.itch.io/free-character-animations|6912681" get <dl> "glTF.(87_03|90_08|90_14|90_02|127_25|127_33|127_23|90_16|90_18|135_07)[.]glb$"
cd assetgen/blender && blender -b -P anim_pack.py -- --folder "cmu.glb=<dl>/Anims_Only_glTF_V1/glTF" --map ../anim/cmu_map.json --out ../../public/anim

# Kevin Iglesias: the four FREE packs (Godot/Unreal downloads), unzipped one folder per pack as named in kevin_map.json
python assetgen/anim/itch_dl.py https://kevdev.itch.io/human-soldier-animations-free <dl>/kev_soldier --only Godot
#   ...human-melee-animatons-free, human-spellcasting-animations-free, human-throwing-animations-free
python assetgen/anim/stage_kevin.py <unzipped root> <stage>
cd assetgen/blender && blender -b -P anim_pack.py -- --folder "kevin.glb=<stage>" --drop-bones "B-root" --out ../../public/anim
```

`anim_pack.py --map` takes `{file stem: clip name | [clip name, start s, end s]}` - long mocap takes hold several repeats
of a move; `tests/tools/clipscan.test.ts` prints a clip's hips height / tilt / foot height timeline to pick the window.
Kevin's FBX key their axis / unit conversion on `B-root` (a -90 deg turn, x100 scale): `--drop-bones "B-root"`.

## Tripo text-to-motion (the movement set)

Tripo Studio > Animate > select a rigged hero > "Create Your Own Animation": one prompt per motion (20 credits, ~10 s
each, 5 s takes at 24 fps on the Tripo auto-rig = Mixamo bone names). Export > Number of Animations > Select All, GLB,
"Animation stay in Place" OFF (the root motion is how the library measures each gait's real direction and speed) ->
`assetgen/out/tripo/anim/tripo_motion.glb`. The prompts are the keys of `tripo_map.json`.

A take holds several strides with a start-up, so each gait is cut to ONE stride cycle whose ends match:
`CLIPS=<untrimmed pack> ONLY=Walk|Jog|Run MAX=0.95 MINSPEED=0.6 npx vitest run -c tests/tools/vitest.config.ts tests/tools/cyclefind.test.ts --reporter=verbose`
prints the window, how well it loops, and the travel direction (text-to-motion "diagonal" prompts came out as plain
strafes - check before keeping one). Near-misses are fine: the retargeter closes a seam within 2.5x the loop tolerance
(`closeSeam`). Then
`cd assetgen/blender && blender -b -P anim_pack.py -- --extra "tripo.glb=../out/tripo/anim/tripo_motion.glb" --map ../anim/tripo_map.json --fps 24 --out ../../public/anim`
and compare against the old set with `tests/tools/locoslide.test.ts` (planted-foot slide per direction and speed).

## Check

- `node tests/e2e/clip_strip.mjs <hero> <clip,...>` - filmstrips of clips played on a hero in the Hero Viewer
- `CLIPS=public/anim/cmu.glb npx vitest run -c tests/tools/vitest.config.ts tests/tools/clipscan.test.ts --reporter=verbose`
