"""Blender 4.2+ / 5.x: pack the Quaternius Universal Animation Library 1 & 2 and Mixamo clips into web-ready GLBs
for the runtime clip library (src/render/ClipLibrary.ts). No retargeting happens here: the game bakes every clip onto
its own rig-independent pose format on load (src/render/Retarget.ts), so each pack keeps its own skeleton.

  blender -b -P anim_pack.py -- --ual1 UAL1.glb --ual2 UAL2.glb --mixamo mixamo_fbx_dir --out ../../public/anim
  blender -b -P anim_pack.py -- --ual1 UAL1.glb --only "Idle|Jog|Sprint|Walk|Death|Jump|Hit|Roll|Punch" --out ...

Sources (download by hand, both CC0):
  https://quaternius.itch.io/universal-animation-library     (UAL1: 120+ clips, 8-way locomotion, jog, sprint, deaths)
  https://quaternius.itch.io/universal-animation-library-2   (UAL2: 130+ clips, parkour, melee combos split per hit)
  Mixamo (Adobe account): download "FBX Binary, Without Skin, 30 fps", In Place where offered, into one folder.

What it does per source:
  1. import (glTF / GLB / FBX); Mixamo FBXs are imported one by one and their "mixamo.com" action renamed to the file name
  2. drop the meshes (the game only needs the skeleton + actions: a 120-clip pack goes from tens of MB to a few MB);
     a single-triangle mesh skinned to the hips keeps exporters that skip bare armatures happy
  3. optional --only / --skip regex on clip names, --fps resample
  4. export one GLB per source with every action (export_animation_mode ACTIONS) and register it in manifest.json
"""
import bpy, sys, os, re, json, glob, argparse

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--ual1"); ap.add_argument("--ual2")
ap.add_argument("--mixamo", help="folder of Mixamo FBX files (one clip per file)")
ap.add_argument("--extra", nargs="*", default=[], help="more glTF / FBX animation files, packed as-is")
ap.add_argument("--out", required=True)
ap.add_argument("--only", default="", help="keep clips whose name matches this regex")
ap.add_argument("--skip", default=r"T-?Pose|A-?Pose", help="drop clips whose name matches this regex")
ap.add_argument("--fps", type=int, default=30)
ap.add_argument("--keep-mesh", action="store_true")
a = ap.parse_args(argv)
os.makedirs(a.out, exist_ok=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = a.fps


def import_any(path):
    ext = os.path.splitext(path)[1].lower()
    before = set(bpy.data.objects)
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=os.path.abspath(path))
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=os.path.abspath(path), automatic_bone_orientation=False, use_anim=True, ignore_leaf_bones=False)
    else:
        raise SystemExit(f"unsupported file: {path}")
    return [o for o in bpy.data.objects if o not in before]


def keep(name):
    if a.skip and re.search(a.skip, name, re.I): return False
    if a.only and not re.search(a.only, name, re.I): return False
    return True


def strip_meshes(arm):
    """replace the character meshes with one tiny triangle skinned to the root-most bone"""
    for o in list(bpy.data.objects):
        if o.type == "MESH": bpy.data.objects.remove(o, do_unlink=True)
    if a.keep_mesh: return
    me = bpy.data.meshes.new("stub")
    me.from_pydata([(0, 0, 0), (0.01, 0, 0), (0, 0.01, 0)], [], [(0, 1, 2)])
    ob = bpy.data.objects.new("stub", me)
    bpy.context.scene.collection.objects.link(ob)
    root = next((b for b in arm.data.bones if b.parent is None), arm.data.bones[0])
    vg = ob.vertex_groups.new(name=root.name); vg.add([0, 1, 2], 1.0, "REPLACE")
    ob.parent = arm
    mod = ob.modifiers.new("Armature", "ARMATURE"); mod.object = arm


def export(arm, fname, actions):
    # every kept action on the armature's NLA so the exporter writes each as its own glTF animation
    arm.animation_data_create()
    for tr in list(arm.animation_data.nla_tracks): arm.animation_data.nla_tracks.remove(tr)
    for act in actions:
        tr = arm.animation_data.nla_tracks.new(); tr.name = act.name
        st = tr.strips.new(act.name, int(act.frame_range[0]), act)
        tr.mute = True
    arm.animation_data.action = None
    for o in bpy.data.objects: o.select_set(o == arm or o.parent == arm)
    bpy.context.view_layer.objects.active = arm
    out = os.path.join(a.out, fname)
    kw = dict(filepath=out, export_format="GLB", use_selection=True, export_yup=True, export_skins=True, export_animations=True,
              export_animation_mode="ACTIONS", export_force_sampling=True, export_frame_step=1, export_optimize_animation_size=True,
              export_anim_single_armature=True, export_def_bones=False, export_apply=False)
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError:
        # older exporters: fewer knobs
        for k in ("export_anim_single_armature", "export_optimize_animation_size", "export_def_bones"): kw.pop(k, None)
        bpy.ops.export_scene.gltf(**kw)
    print(f"[anim_pack] {fname}: {len(actions)} clips, {os.path.getsize(out) / 1e6:.2f} MB")
    return fname


def pack_file(path, fname):
    reset()
    import_any(path)
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if not arms: raise SystemExit(f"no armature in {path}")
    arm = max(arms, key=lambda o: len(o.data.bones))
    # Blender's glTF importer names actions "<clip>_<armature>": give the clips their pack names back
    for x in bpy.data.actions:
        for suf in (f"_{arm.name}", "_Armature"):
            if x.name.endswith(suf) and len(x.name) > len(suf): x.name = x.name[: -len(suf)]; break
    acts = [x for x in bpy.data.actions if keep(x.name)]
    strip_meshes(arm)
    return export(arm, fname, acts)


def pack_mixamo(folder):
    reset()
    # (Windows globs are case-insensitive: *.fbx and *.FBX list the same files, so de-duplicate)
    files = sorted({os.path.normcase(f): f for f in glob.glob(os.path.join(folder, "*.fbx")) + glob.glob(os.path.join(folder, "*.FBX"))}.values())
    if not files: raise SystemExit(f"no FBX files in {folder}")
    arm, acts = None, []
    for f in files:
        new = import_any(f)
        name = os.path.splitext(os.path.basename(f))[0]
        a_new = next((o for o in new if o.type == "ARMATURE"), None)
        act = a_new.animation_data.action if a_new and a_new.animation_data else None
        if act is None: print(f"[anim_pack] {name}: no animation, skipped"); continue
        act.name = name
        act.use_fake_user = True
        if keep(name): acts.append(act)
        if arm is None: arm = a_new
        else:
            # Mixamo skeletons are identical: keep the first armature, drop the rest (the actions stay)
            for o in new: bpy.data.objects.remove(o, do_unlink=True)
    if arm is None: raise SystemExit("no Mixamo clips found")
    strip_meshes(arm)
    return export(arm, "mixamo.glb", acts)


packs = []
if a.ual1: packs.append(pack_file(a.ual1, "UAL1.glb"))
if a.ual2: packs.append(pack_file(a.ual2, "UAL2.glb"))
if a.mixamo: packs.append(pack_mixamo(a.mixamo))
for e in a.extra: packs.append(pack_file(e, os.path.splitext(os.path.basename(e))[0] + ".glb"))

man_path = os.path.join(a.out, "manifest.json")
man = json.load(open(man_path)) if os.path.exists(man_path) else {}
man["packs"] = list(dict.fromkeys((man.get("packs") or []) + packs))
man.setdefault("credits", {})
if a.ual1 or a.ual2: man["credits"]["quaternius"] = "Universal Animation Library 1 & 2 by Quaternius (CC0) - quaternius.com"
if a.mixamo: man["credits"]["mixamo"] = "Animations from Mixamo (Adobe) - mixamo.com"
json.dump(man, open(man_path, "w"), indent=2)
print("[anim_pack] manifest:", man_path, man["packs"])
