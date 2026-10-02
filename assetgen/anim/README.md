# Free animation packs (public/anim)

The clip library (`src/render/ClipLibrary.ts`) loads every pack in `public/anim/manifest.json` and bakes it through the
retargeter (`src/render/Retarget.ts`), so any humanoid skeleton works. Research and licenses: `docs/research/animation_asset_sources.md`.

| Pack | Source | License | In git |
|---|---|---|---|
| `UAL1.glb`, `UAL2.glb` | Quaternius Universal Animation Library 1 & 2 (Standard) | CC0 | yes |
| `cmu.glb` | CMU Graphics Lab mocap, rancidmilk's Quaternius-rig glTF conversion | free to use / modify / redistribute, never sold as animations (`public/anim/LICENSE-CMU.txt`) | yes |
| `mixamo.glb` | Mixamo | royalty-free in games, no raw redistribution | **no** (gitignored, desktop build only) |
| `kevin.glb` | Kevin Iglesias Human Soldier / Melee / Spellcasting / Throwing Animations FREE | Standard Unity Asset Store EULA | **no** (gitignored, desktop build only) |

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

## Check

- `node tests/e2e/clip_strip.mjs <hero> <clip,...>` - filmstrips of clips played on a hero in the Hero Viewer
- `CLIPS=public/anim/cmu.glb npx vitest run -c tests/tools/vitest.config.ts tests/tools/clipscan.test.ts --reporter=verbose`
