"""Blender 4.2+ / 5.x: put new skin weights (UniRig's prediction, assetgen/modal_unirig.py) onto a published hero rig.

Keeps OUR armature, bone names, mesh, UVs and textures; only the vertex-group weights change. UniRig predicts on its own
(possibly simplified) copy of the mesh, so weights come across by nearest-face interpolation, then the rigger's hard
rules are re-applied (legs below the knee never follow the arms; wing feathers never follow arms or legs), each vertex
keeps its 4 strongest influences and is normalised.

  blender -b -P apply_skin.py -- --glb work/rig/kaien_plain.glb --skin work/rig/kaien_unirig.fbx --out work/rig/kaien_skinned.glb
      [--keep-held]   islands the old rig bound rigidly to a hand (weapons) keep that binding
      [--blend 0.0]   mix in this share of the old weights (0 = UniRig only)
"""
import bpy, sys, os, json, argparse
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--glb", required=True); ap.add_argument("--skin", required=True); ap.add_argument("--out", required=True)
ap.add_argument("--keep-held", action="store_true"); ap.add_argument("--blend", type=float, default=0.0)
a = ap.parse_args(argv)
LOG = {}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(a.glb))
ours = [o for o in bpy.data.objects if o.type == "MESH" and len(o.vertex_groups)]      # (the importer's "Icosphere" bone shape has none)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
before = set(bpy.data.objects)
ext = os.path.splitext(a.skin)[1].lower()
if ext == ".fbx": bpy.ops.import_scene.fbx(filepath=os.path.abspath(a.skin))
else: bpy.ops.import_scene.gltf(filepath=os.path.abspath(a.skin))
theirs = [o for o in bpy.data.objects if o not in before and o.type == "MESH" and len(o.vertex_groups)]
if not theirs: raise SystemExit("no mesh in the skin file")
bone_names = [b.name for b in arm.data.bones]


def world_co(o):
    me = o.data
    co = np.empty(len(me.vertices) * 3, dtype=np.float64); me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    M = np.array(o.matrix_world)
    return co @ M[:3, :3].T + M[:3, 3]


# ---- align their mesh to ours (FBX axis / unit conventions can differ): match world bounding boxes
P = np.concatenate([world_co(o) for o in ours]); Q = np.concatenate([world_co(o) for o in theirs])
pmin, pmax, qmin, qmax = P.min(0), P.max(0), Q.min(0), Q.max(0)
LOG["ours_bbox"] = [pmin.round(3).tolist(), pmax.round(3).tolist()]; LOG["theirs_bbox"] = [qmin.round(3).tolist(), qmax.round(3).tolist()]
ext_p, ext_q = pmax - pmin, qmax - qmin
if np.abs(ext_p - ext_q).max() > 0.02 * ext_p.max() or np.abs(pmin - qmin).max() > 0.02 * ext_p.max():
    # try the usual FBX axis swap (Y up <-> Z up) before a plain box fit
    perm = [0, 2, 1]
    if np.abs(np.sort(ext_p) - np.sort(ext_q)).max() < 0.05 * ext_p.max() and np.abs(ext_p - ext_q[perm]).max() < 0.05 * ext_p.max():
        LOG["align"] = "axis swap"
    s = float(ext_p.max() / max(1e-9, ext_q.max()))
    for o in theirs:
        o.matrix_world = o.matrix_world.copy()
    # generic: scale + translate so the boxes coincide (rotation handled by the importer's axis settings)
    for o in theirs:
        o.scale = [x * s for x in o.scale]
    bpy.context.view_layer.update()
    Q = np.concatenate([world_co(o) for o in theirs]); qmin = Q.min(0)
    for o in theirs:
        o.location = Vector(o.location) + Vector((pmin - qmin).tolist())
    bpy.context.view_layer.update()
    Q = np.concatenate([world_co(o) for o in theirs])
    LOG["align_scale"] = round(s, 4); LOG["align_err"] = round(float(np.abs(Q.min(0) - pmin).max() + np.abs(Q.max(0) - pmax).max()), 4)
from mathutils.kdtree import KDTree
kd = KDTree(len(Q))
for i, q in enumerate(Q): kd.insert(q.tolist(), i)
kd.balance()
samp = P[:: max(1, len(P) // 4000)]
LOG["align_mean_nn"] = round(float(np.mean([kd.find(p.tolist())[2] for p in samp])) / float(ext_p.max()), 5)
missing = [n for n in bone_names if not any(n in o.vertex_groups for o in theirs)]
LOG["bones_without_weights"] = missing

# ---- one source object (join their pieces)
if len(theirs) > 1:
    bpy.ops.object.select_all(action="DESELECT")
    for o in theirs: o.select_set(True)
    bpy.context.view_layer.objects.active = theirs[0]; bpy.ops.object.join()
src = theirs[0]
for m in list(src.modifiers): src.modifiers.remove(m)

for obj in ours:
    names = [g.name for g in obj.vertex_groups]
    n = len(obj.data.vertices)
    old = np.zeros((n, len(bone_names)), dtype=np.float32)
    gi = {b: i for i, b in enumerate(bone_names)}
    for v in obj.data.vertices:
        for g in v.groups:
            nm = obj.vertex_groups[g.group].name
            if nm in gi: old[v.index, gi[nm]] = g.weight
    # held weapons: islands the old rig bound 100% to one hand (swords, bows) - optional keep
    co = world_co(obj)
    # transfer
    for g in list(obj.vertex_groups): obj.vertex_groups.remove(g)
    for b in bone_names: obj.vertex_groups.new(name=b)
    dt = obj.modifiers.new("dt", "DATA_TRANSFER"); dt.object = src; dt.use_vert_data = True
    dt.data_types_verts = {"VGROUP_WEIGHTS"}; dt.vert_mapping = "POLYINTERP_NEAREST"
    dt.layers_vgroup_select_src = "ALL"; dt.layers_vgroup_select_dst = "NAME"
    bpy.context.view_layer.objects.active = obj
    for mm in list(obj.modifiers):
        if mm.type == "ARMATURE": obj.modifiers.remove(mm)
    bpy.ops.object.modifier_apply(modifier="dt")
    new = np.zeros_like(old)
    for v in obj.data.vertices:
        for g in v.groups:
            nm = obj.vertex_groups[g.group].name
            if nm in gi: new[v.index, gi[nm]] = g.weight
    W = new if a.blend <= 0 else (1 - a.blend) * new + a.blend * old
    # ---- the rigger's hard rules
    H = co[:, 2].max() - co[:, 2].min()
    head = lambda b: np.array(arm.matrix_world @ arm.data.bones[b].head_local)
    for s in ("L", "R"):
        if f"shin_{s}" not in gi: continue
        below = co[:, 2] < head(f"shin_{s}")[2]
        for arm_b in ("upperarm", "forearm", "hand"):
            for side in ("L", "R"):
                if f"{arm_b}_{side}" in gi: W[below, gi[f"{arm_b}_{side}"]] = 0
    # bones UniRig left without any weight (it sometimes skips wings or a whole arm): the vertices the old rig gave to
    # those bones keep their old weights, so nothing ends up glued to the wrong bone
    gone = [gi[b] for b in bone_names if b != "root" and W[:, gi[b]].sum() < 1e-3 and old[:, gi[b]].sum() > 1e-3]
    if gone:
        keep_old = old[:, gone].sum(1) > 0.25
        W[keep_old] = old[keep_old]
        LOG[f"{obj.name}_kept_old"] = {"bones": [bone_names[i] for i in gone], "verts": int(keep_old.sum())}
    for s in ("L", "R"):
        wb = f"wing_{s}"
        if wb not in gi: continue
        wing = W[:, gi[wb]] > 0.5
        for b in ("shoulder", "upperarm", "forearm", "hand", "thigh", "shin", "foot"):
            for side in ("L", "R"):
                if f"{b}_{side}" in gi: W[wing, gi[f"{b}_{side}"]] = 0
    if a.keep_held:
        # the rigger binds every loose island near a hand to that hand ("held items"): right for a sword or a bow, wrong
        # for a coat panel, a hair bun or a quiver that happens to hang near the hand in the rest pose. Keep the binding
        # only for WEAPON-SHAPED islands: long (> 15% of the height) and thin (longest extent > 3x the second)
        cell = max(1e-6, H * 1e-4)
        _, weld = np.unique(np.round(co / cell).astype(np.int64), axis=0, return_inverse=True); weld = weld.ravel()
        par = np.arange(weld.max() + 1)
        def find(x):
            while par[x] != x: par[x] = par[par[x]]; x = par[x]
            return x
        for p in obj.data.polygons:
            vs = [weld[v] for v in p.vertices]
            for u in vs[1:]:
                ru, rv = find(vs[0]), find(u)
                if ru != rv: par[ru] = rv
        isl = np.array([find(weld[i]) for i in range(n)])
        for s in ("L", "R"):
            hn = f"hand_{s}"
            if hn not in gi: continue
            held = old[:, gi[hn]] > 0.999
            keep = np.zeros(n, bool)
            for k in np.unique(isl[held]):
                m = (isl == k) & held
                if m.sum() < 20: continue
                pts = co[m] - co[m].mean(0)
                ev = np.sqrt(np.maximum(np.linalg.eigvalsh(np.cov(pts.T)), 0))[::-1] * 4    # ~ extents along the principal axes
                if ev[0] > 0.15 * H and ev[0] > 3 * max(ev[1], 1e-6): keep |= m
            W[keep] = 0; W[keep, gi[hn]] = 1
            LOG[f"held_{s}"] = {"weapon": int(keep.sum()), "released": int((held & ~keep).sum())}
    # 4 strongest, normalise; vertices left empty fall back to the old weights
    top = np.argsort(-W, axis=1)[:, 4:]; np.put_along_axis(W, top, 0, axis=1)
    tot = W.sum(1)
    empty = tot < 1e-4
    W[empty] = old[empty]; tot = W.sum(1, keepdims=True); W /= np.maximum(tot, 1e-6)
    LOG[f"{obj.name}_empty"] = int(empty.sum())
    LOG[f"{obj.name}_share"] = {b: round(float(W[:, i].sum() / max(1, n)), 3) for b, i in gi.items() if W[:, i].sum() / max(1, n) > 0.02}
    for g in list(obj.vertex_groups): obj.vertex_groups.remove(g)
    for b in bone_names:
        vg = obj.vertex_groups.new(name=b); col = W[:, gi[b]]; nz = np.where(col > 1e-3)[0]
        q = np.round(col[nz] * 100) / 100
        for val in np.unique(q):
            if val > 0: vg.add(nz[q == val].tolist(), float(val), "REPLACE")
    am = obj.modifiers.new("Armature", "ARMATURE"); am.object = arm

for o in theirs:
    if o.name in bpy.data.objects: bpy.data.objects.remove(o, do_unlink=True)
for o in list(bpy.data.objects):
    if o.type == "ARMATURE" and o != arm: bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.select_all(action="DESELECT")
for o in ours: o.select_set(True)
arm.select_set(True)
os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=os.path.abspath(a.out), export_format="GLB", use_selection=True, export_yup=True, export_skins=True,
                          export_animations=False, export_apply=False)
print("APPLY_SKIN", json.dumps(LOG))
