"""Tripo Studio auto-rig (Mixamo skeleton preset) -> the game's humanoid rig.

blender -b -P tripo_rig.py -- --glb rigged.glb --out out.glb --height 1.8 [--hd hd.glb --tris 70000] [--wings] [--chains] [--mech]

Tripo's rigged export is a retopologised (<= 20k tri) mesh skinned to a Mixamo skeleton. This script
1. rebuilds that skeleton with the game's bone names (src/render/Rig.ts): root -> hips -> spine -> spine1 -> chest -> neck
   -> head, shoulder/upperarm/forearm/hand, thigh/shin/foot (+ toe and finger bones, which just follow their parents),
   roll 0, in the rig_hero.py frame (Z up, facing -Y, feet on the ground, scaled to --height);
2. renames the skin weights to match (end bones fold into their parents);
3. optionally swaps the retopo mesh for the high-detail generation (--hd), decimated to --tris, with Tripo's weights
   transferred across (nearest-face interpolated) - geometry and 4K/8K texture of the HD model, Tripo's skinning;
4. adds the procedural bones the Animator drives: wing_L/R (--wings: the wing mass behind the back leaves the arms and
   follows the wing bones) and hair / cape / skirt spring chains (--chains: two-bone chains, weights blended in by height).
"""
import bpy, sys, os, json, math, time
import numpy as np
from mathutils import Vector, Matrix
import argparse

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--glb", required=True); ap.add_argument("--out", required=True); ap.add_argument("--height", type=float, default=1.8)
ap.add_argument("--hd", default=""); ap.add_argument("--tris", type=int, default=0)
# --hd-late: the high-detail mesh is swapped in at the END, taking the finished weights (body + chains, welded, smoothed)
# by nearest surface - for humanoids, whose HD generation is many loose shells (hair strands, cloth layers) that would
# each be classified on their own and tear apart; --hd alone swaps it in first (mechs: rigid plates, no chains)
ap.add_argument("--hd-late", action="store_true")
# --fp-arms (with --hd --hd-late): the first-person hand model - only the arms and hands of the FULL-resolution HD
# generation (no whole-body decimation: every finger keeps the generation's detail), each finger joint re-skinned from
# the finger bones' geometry, then capped at --tris
ap.add_argument("--fp-arms", action="store_true")
ap.add_argument("--wings", action="store_true"); ap.add_argument("--chains", action="store_true"); ap.add_argument("--mech", action="store_true")
# --chains: skirt panels + cape / coat tails; --hair: long hanging hair (colour-matched to the scalp, grown from the head
# so torso armour and robes never join it); --crown: hair piled on the head (topknot, buns, dreadlocks) as an upright
# chain; --sleeves: wide sleeves hanging off the forearms; --hair-rgb r,g,b overrides the sampled hair colour (0..1,
# e.g. white hair under a gold circlet); --scarf seeds the --hair chains around the neck instead of on the scalp)
ap.add_argument("--hair", action="store_true"); ap.add_argument("--crown", action="store_true"); ap.add_argument("--sleeves", action="store_true")
ap.add_argument("--hair-rgb", default=""); ap.add_argument("--hair-tol", type=float, default=0.16); ap.add_argument("--scarf", action="store_true")
ap.add_argument("--no-cape", action="store_true", help="--chains without the cape / coat-tail chain (a heavy hero's own back reads as one)")
a = ap.parse_args(argv)
T0 = time.time()
LOG = {"id": os.path.basename(a.out)[:-4]}
H = a.height

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(path))
    return [o for o in bpy.data.objects if o not in before]


sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from glbskin import skinned, fitted_joints, rest_joints, skin as skin_info

new = import_glb(a.glb)
src_arm = next((o for o in new if o.type == "ARMATURE"), None)
src_meshes = [o for o in new if o.type == "MESH" and (any(m.type == "ARMATURE" for m in o.modifiers) or (src_arm and o.parent == src_arm))]
if not src_meshes: raise SystemExit("no skinned mesh in " + a.glb)


# ---------------------------------------------------------------- Mixamo -> game bone names
def base(n):
    n = n.split(":")[-1]
    return n[len("mixamorig"):] if n.lower().startswith("mixamorig") else n


MAP = {"Hips": "hips", "Spine": "spine", "Spine1": "spine", "Spine2": "chest", "Neck": "neck", "Head": "head"}
for side, s in (("Left", "L"), ("Right", "R")):
    MAP.update({f"{side}Shoulder": f"shoulder_{s}", f"{side}Arm": f"upperarm_{s}", f"{side}ForeArm": f"forearm_{s}", f"{side}Hand": f"hand_{s}",
                f"{side}UpLeg": f"thigh_{s}", f"{side}Leg": f"shin_{s}", f"{side}Foot": f"foot_{s}", f"{side}ToeBase": f"toe_{s}"})
    for f in ("Thumb", "Index", "Middle", "Ring", "Pinky"):
        for k in (1, 2, 3): MAP[f"{side}Hand{f}{k}"] = f"{f.lower()}{k}_{s}"

# the skin, read straight from the file: Blender's importer mis-places some Tripo exports (joint nodes without transforms,
# the skeleton living only in the inverse bind matrices, in a rotated frame)
raw_names, raw_bind, P_raw, Jn_raw, Wt_raw = skinned(a.glb)
raw_parent = dict(zip(skin_info(a.glb)["names"], skin_info(a.glb)["parents"]))
rn, rp = rest_joints(a.glb)
if np.ptp(rp, 0).max() > 1e-3:
    Jraw = dict(zip(rn, rp)); LOG["joints"] = "nodes"
else:
    CH = [(f"mixamorig:{x}", f"mixamorig:{y}") for x, y in [("Hips", "Spine"), ("Spine", "Spine1"), ("Spine1", "Spine2"), ("Spine2", "Neck"),
          ("Neck", "Head"), ("LeftArm", "LeftForeArm"), ("LeftForeArm", "LeftHand"), ("RightArm", "RightForeArm"), ("RightForeArm", "RightHand"),
          ("LeftUpLeg", "LeftLeg"), ("LeftLeg", "LeftFoot"), ("RightUpLeg", "RightLeg"), ("RightLeg", "RightFoot"), ("Head", "HeadTop_End")]]
    fn, fp, _, _, _, info = fitted_joints(a.glb, CH)
    if not np.isfinite(fp).all(): raise SystemExit("Tripo skin is unusable (weights collapsed onto one bone) - rig with rig_hero.py instead")
    Jraw = dict(zip(fn, fp)); LOG["joints"] = "fitted"; LOG["fit"] = {k: round(v, 4) for k, v in info.items()}
g2b = lambda q: Vector((float(q[0]), -float(q[2]), float(q[1])))           # glTF Y-up -> Blender Z-up
J = {base(k): g2b(v) for k, v in Jraw.items()}
JT = dict(J)
missing = [k for k in ("Hips", "Spine", "Neck", "Head", "LeftArm", "LeftForeArm", "LeftHand", "LeftUpLeg", "LeftLeg", "LeftFoot") if k not in J]
if missing: raise SystemExit(f"skeleton is not a Mixamo humanoid, missing {missing}: {sorted(J)[:40]}")
if "Spine2" not in J and "Spine1" in J: MAP["Spine1"] = "chest"      # 2-segment spines
# where every source joint's weights go: mapped joints keep theirs, end joints (HeadTop_End, *_End, *4) fold into the parent
dest = {}
for k in raw_names:
    p = k
    while p is not None and base(p) not in MAP: p = raw_parent.get(p)
    dest[k] = MAP[base(p)] if p is not None else "hips"
LOG["weights_on_hips"] = round(float((Jn_raw[np.arange(len(Jn_raw)), Wt_raw.argmax(1)] == raw_names.index(next(n for n in raw_names if base(n) == "Hips"))).mean()), 3)
if LOG["weights_on_hips"] > 0.9: raise SystemExit("Tripo skin is unusable (weights collapsed onto the hips) - rig with rig_hero.py instead")

# ---------------------------------------------------------------- frame: Z up, facing -Y, feet on the ground, height H
up = (J["Head"] - J["Hips"]).normalized()
axes = [Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))]
def snap(v):
    best = max(axes + [-x for x in axes], key=lambda x: v.dot(x)); return best
upA = snap(up)
# facing = up x (the character's right side), from the shoulder and hip lines; the toes only as a fallback - a sumo or
# wide stance splays the feet 45-90 degrees outward (Gantetsu's toe put him side-on to the camera)
side = sum(((J[f"Right{b}"] - J[f"Left{b}"]) for b in ("Arm", "UpLeg") if f"Right{b}" in J and f"Left{b}" in J), Vector((0, 0, 0)))
side -= upA * side.dot(upA)
if side.length > 1e-4:
    fwd = upA.cross(side.normalized())
else:
    toe = J.get("LeftToeBase", J["LeftFoot"] + (J["LeftFoot"] - J["LeftLeg"]).cross(Vector((1, 0, 0)))) - J["LeftFoot"]
    fwd = toe - upA * toe.dot(upA)
fwdA = snap(fwd)
# rotation taking (fwdA, upA) -> (-Y, +Z)
R_src = Matrix((fwdA.cross(upA), fwdA, upA)).transposed()       # columns: right, forward, up (source)
R_dst = Matrix(((-1, 0, 0), (0, -1, 0), (0, 0, 1))).transposed()  # right = -X, forward = -Y, up = +Z (rig_hero frame)
R = (R_dst @ R_src.inverted()).to_4x4()
LOG["frame"] = {"up": list(upA), "fwd": list(fwdA)}


allv = np.stack([P_raw[:, 0], -P_raw[:, 2], P_raw[:, 1]], 1)            # the raw mesh, Blender axes
Rn = np.array(R)[:3, :3]
rv = allv @ Rn.T
zmin, zmax = rv[:, 2].min(), rv[:, 2].max()
S = H / max(1e-6, zmax - zmin)
hipr = Rn @ np.array(J["Hips"])
T = Matrix.Translation(Vector((-hipr[0] * S, -hipr[1] * S, -zmin * S)))
X = T @ Matrix.Scale(S, 4) @ R                                   # source world -> game frame
LOG["scale"] = round(S, 5)
P = {k: X @ v for k, v in J.items()}
PT = {k: X @ v for k, v in JT.items()}

# ---------------------------------------------------------------- the game skeleton (head -> tail -> parent)
def g(k, fallback=None): return P.get(k, fallback)
bones = {"root": (Vector((0, 0, 0)), Vector((0, 0, H * 0.08)), None)}
spine1 = "Spine1" if MAP.get("Spine1") == "spine1" else None
chain_spine = ["Hips", "Spine"] + ([spine1] if spine1 else []) + (["Spine2"] if "Spine2" in P else ["Spine1"] if not spine1 else []) + ["Neck", "Head"]
for i, k in enumerate(chain_spine):
    nm = MAP[k]
    tail = P[chain_spine[i + 1]] if i + 1 < len(chain_spine) else (P["HeadTop_End"] if "HeadTop_End" in P else P["Head"] + Vector((0, 0, H * 0.12)))
    parent = "root" if i == 0 else MAP[chain_spine[i - 1]]
    bones[nm] = (P[k], tail, parent)
for side, s in (("Left", "L"), ("Right", "R")):
    sh = f"{side}Shoulder"
    if sh in P: bones[f"shoulder_{s}"] = (P[sh], P[f"{side}Arm"], "chest")
    bones[f"upperarm_{s}"] = (P[f"{side}Arm"], P[f"{side}ForeArm"], f"shoulder_{s}" if sh in P else "chest")
    bones[f"forearm_{s}"] = (P[f"{side}ForeArm"], P[f"{side}Hand"], f"upperarm_{s}")
    mid = P.get(f"{side}HandMiddle1")
    htail = mid if mid is not None and (mid - P[f"{side}Hand"]).length > 1e-4 else P[f"{side}Hand"] + (P[f"{side}Hand"] - P[f"{side}ForeArm"]).normalized() * H * 0.06
    bones[f"hand_{s}"] = (P[f"{side}Hand"], htail, f"forearm_{s}")
    bones[f"thigh_{s}"] = (P[f"{side}UpLeg"], P[f"{side}Leg"], "hips")
    bones[f"shin_{s}"] = (P[f"{side}Leg"], P[f"{side}Foot"], f"thigh_{s}")
    tb = P.get(f"{side}ToeBase")
    ftail = tb if tb is not None and (tb - P[f"{side}Foot"]).length > 1e-4 else P[f"{side}Foot"] + Vector((0, -H * 0.08, -H * 0.03))
    bones[f"foot_{s}"] = (P[f"{side}Foot"], ftail, f"shin_{s}")
    if tb is not None:
        te = P.get(f"{side}Toe_End")
        bones[f"toe_{s}"] = (tb, te if te is not None and (te - tb).length > 1e-4 else tb + (tb - P[f"{side}Foot"]).normalized() * H * 0.03, f"foot_{s}")
    for f in ("Thumb", "Index", "Middle", "Ring", "Pinky"):
        prev = f"hand_{s}"
        for k in (1, 2, 3):
            key = f"{side}Hand{f}{k}"
            if key not in P: break
            nxt = P.get(f"{side}Hand{f}{k + 1}")
            tail = nxt if nxt is not None and (nxt - P[key]).length > 1e-5 else (PT[key] if (PT[key] - P[key]).length > 1e-5 else P[key] + Vector((0, 0, -H * 0.01)))
            nm = f"{f.lower()}{k}_{s}"
            bones[nm] = (P[key], tail, prev); prev = nm

# ---------------------------------------------------------------- the mesh: one object in the game frame, weights renamed
def join_meshes(objs):
    for o in scene.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


for o in src_meshes:
    for m in list(o.modifiers):
        if m.type == "ARMATURE": o.modifiers.remove(m)
body = join_meshes(src_meshes)
body.parent = None
body.matrix_world = Matrix.Identity(4)
names_out = [n for n in bones if n != "root"]
oi = {n: i for i, n in enumerate(names_out)}
if len(body.data.vertices) == len(P_raw):
    Pb = np.stack([P_raw[:, 0], -P_raw[:, 2], P_raw[:, 1]], 1)
    body.data.vertices.foreach_set("co", Pb.astype(np.float32).ravel()); body.data.update()
    body.data.transform(X)
    Wt = np.zeros((len(P_raw), len(names_out)), dtype=np.float32)
    col = np.array([oi.get(dest[n], oi["hips"]) for n in raw_names])
    for k in range(Jn_raw.shape[1]):
        np.add.at(Wt, (np.arange(len(P_raw)), col[Jn_raw[:, k]]), Wt_raw[:, k].astype(np.float32))
    LOG["mesh"] = "raw"
else:
    raise SystemExit(f"vertex count mismatch: blender {len(body.data.vertices)} vs glb {len(P_raw)}")
co = np.empty(len(body.data.vertices) * 3); body.data.vertices.foreach_get("co", co); co = co.reshape(-1, 3)


def apply_weights(obj, W):
    for vg in list(obj.vertex_groups): obj.vertex_groups.remove(vg)
    W = W.copy()
    top = np.argsort(-W, axis=1)[:, 4:]
    np.put_along_axis(W, top, 0, axis=1)
    tot = W.sum(1, keepdims=True); lost = tot[:, 0] < 1e-5
    W[lost, oi["hips"]] = 1; tot[lost] = 1
    W /= np.maximum(W.sum(1, keepdims=True), 1e-6)
    for n in names_out:
        col = W[:, oi[n]]; nz = np.where(col > 1e-3)[0]
        vg = obj.vertex_groups.new(name=n)
        if not len(nz): continue
        q = np.round(col[nz] * 100) / 100
        for val in np.unique(q):
            if val > 0: vg.add(nz[q == val].tolist(), float(val), "REPLACE")
    return int(lost.sum())


# ---------------------------------------------------------------- optional: the high-detail mesh, Tripo's weights transferred
def load_hd(ref_co):
    """the HD generation in the rig frame, fitted onto the rigged mesh's bounds, decimated to --tris"""
    hd_new = import_glb(a.hd)
    hd_meshes = [o for o in hd_new if o.type == "MESH"]
    for o in hd_new:
        if o.type == "ARMATURE": bpy.data.objects.remove(o)
    hd = join_meshes(hd_meshes)
    Mh = hd.matrix_world.copy(); hd.parent = None; hd.matrix_world = Matrix.Identity(4)
    hd.data.transform(X @ Mh)
    # Tripo re-centres / re-scales a model between generation and rigging: fit the HD bounds onto the rigged mesh's
    hv = np.empty(len(hd.data.vertices) * 3); hd.data.vertices.foreach_get("co", hv); hv = hv.reshape(-1, 3)
    lo_b, hi_b = ref_co.min(0), ref_co.max(0); lo_h, hi_h = hv.min(0), hv.max(0)
    s = float(np.median((hi_b - lo_b) / np.maximum(hi_h - lo_h, 1e-6)))
    off = (lo_b + hi_b) / 2 - (lo_h + hi_h) / 2 * s
    hd.data.transform(Matrix.Translation(Vector(off)) @ Matrix.Scale(s, 4))
    LOG["hd_fit"] = {"scale": round(s, 4), "offset": [round(float(x), 4) for x in off]}
    ntri = sum(len(p.vertices) - 2 for p in hd.data.polygons)
    if a.tris and ntri > a.tris and not a.fp_arms: decimate(hd, a.tris)
    LOG["hd_tris"] = sum(len(p.vertices) - 2 for p in hd.data.polygons)
    return hd


def decimate(obj, tris):
    ntri = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if ntri <= tris: return
    dm = obj.modifiers.new("Dec", "DECIMATE"); dm.ratio = tris / ntri; dm.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = obj; bpy.ops.object.modifier_apply(modifier=dm.name)


def reskin_hands(W):
    """hand + finger weights rebuilt from the bones: each vertex the hand owns goes to its two nearest joints (the hand
    bone or a finger segment), falling off with distance - clean finger separation whatever the retopo's hands were
    (some were mitten-like, and the nearest-surface transfer smeared a finger's weight onto its neighbours). The
    forearm's share at the wrist is kept."""
    import re
    sig = H * 0.006
    for S in ("L", "R"):
        names = [f"hand_{S}"] + [n for n in names_out if re.match(rf"^(thumb|index|middle|ring|pinky)\d_{S}$", n)]
        names = [n for n in names if n in bones and n in oi and (bones[n][1] - bones[n][0]).length > 1e-5]
        if len(names) < 6: continue
        idx = [oi[n] for n in names]
        own = W[:, idx].sum(1)
        region = own > 0.5
        if not region.any(): continue
        D = np.stack([seg_dist(bones[n][0], bones[n][1]) for n in names], 1)[region]
        G = np.exp(-(D - D.min(1, keepdims=True)) / sig)
        order = np.argsort(D, 1)
        mask = np.zeros(G.shape, bool); np.put_along_axis(mask, order[:, :2], True, 1)
        G = np.where(mask, G, 0.0); G /= G.sum(1, keepdims=True)
        Wr = W[region]; Wr[:, idx] = G * own[region][:, None]; W[region] = Wr
        LOG[f"fp_hand_{S}"] = int(region.sum())
    return W


def transfer_weights(src, dst, names):
    """every named vertex group of src onto dst, interpolated from the nearest face"""
    for n in names: dst.vertex_groups.new(name=n)
    dt = dst.modifiers.new("DT", "DATA_TRANSFER"); dt.object = src
    dt.use_vert_data = True; dt.data_types_verts = {"VGROUP_WEIGHTS"}; dt.vert_mapping = "POLYINTERP_NEAREST"
    dt.layers_vgroup_select_src = "ALL"; dt.layers_vgroup_select_dst = "NAME"
    bpy.context.view_layer.objects.active = dst
    bpy.ops.object.datalayout_transfer(modifier=dt.name)
    bpy.ops.object.modifier_apply(modifier=dt.name)


if a.hd and not a.hd_late:
    hd = load_hd(co)
    # weights onto the HD mesh: body gets clean named groups first, then a data-transfer
    apply_weights(body, Wt)
    transfer_weights(body, hd, names_out)
    bpy.data.objects.remove(body)
    body = hd
    co = np.empty(len(body.data.vertices) * 3); body.data.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    Wt = np.zeros((len(co), len(names_out)), dtype=np.float32)
    gidx = {vg.index: oi[vg.name] for vg in body.vertex_groups if vg.name in oi}
    for v in body.data.vertices:
        for ge in v.groups:
            d = gidx.get(ge.group)
            if d is not None: Wt[v.index, d] += ge.weight
LOG["verts"] = len(co)
LOG["tris"] = sum(len(p.vertices) - 2 for p in body.data.polygons)


def seg_dist(A, B):
    A = np.array(A); B = np.array(B); AB = B - A
    t = np.clip(((co - A) @ AB) / max(1e-9, AB @ AB), 0, 1)
    return np.linalg.norm(co - (A + t[:, None] * AB), axis=1)


def vertex_albedo(obj):
    """per-vertex base colour (0..1, as stored) sampled from each material's base-colour texture at the loop UVs"""
    me = obj.data
    n = len(me.vertices)
    out = np.full((n, 3), np.nan)
    if not me.uv_layers: return out
    uv = np.empty(len(me.loops) * 2); me.uv_layers.active.data.foreach_get("uv", uv); uv = uv.reshape(-1, 2)
    lv = np.empty(len(me.loops), dtype=np.int64); me.loops.foreach_get("vertex_index", lv)
    pm = np.empty(len(me.polygons), dtype=np.int64); me.polygons.foreach_get("material_index", pm)
    lt = np.empty(len(me.polygons), dtype=np.int64); me.polygons.foreach_get("loop_total", lt)
    lmat = np.repeat(pm, lt)
    acc = np.zeros((n, 3)); cnt = np.zeros(n)
    for mi, mat in enumerate(me.materials):
        img = None
        if mat and mat.use_nodes:
            for nd in mat.node_tree.nodes:
                if nd.type == "BSDF_PRINCIPLED" and nd.inputs["Base Color"].links:
                    # the texture, possibly behind a Mix (Tripo multiplies it by the vertex colour)
                    todo, seen = [nd.inputs["Base Color"].links[0].from_node], set()
                    while todo and img is None:
                        fn = todo.pop(0)
                        if fn.name in seen: continue
                        seen.add(fn.name)
                        if fn.type == "TEX_IMAGE": img = fn.image
                        else: todo += [l.from_node for i in fn.inputs for l in i.links]
        if img is None or not img.size[0]: continue
        w, h = img.size
        px = np.empty(w * h * 4, dtype=np.float32); img.pixels.foreach_get(px); px = px.reshape(h, w, 4)
        sel = lmat == mi
        u = np.clip((uv[sel, 0] % 1.0) * (w - 1), 0, w - 1).astype(np.int64)
        v = np.clip((uv[sel, 1] % 1.0) * (h - 1), 0, h - 1).astype(np.int64)
        np.add.at(acc, lv[sel], px[v, u, :3]); np.add.at(cnt, lv[sel], 1)
        del px
    ok = cnt > 0
    out[ok] = acc[ok] / cnt[ok, None]
    return out


def weld_weights(W):
    """Tripo splits a vertex into copies along every UV seam: copies of one point must carry the same weights or the
    seam opens into a crack as soon as a chain moves them apart (the patchy hair and faces). Averages each point's
    copies (positions equal to 0.1 mm)."""
    key = np.round(co / 1e-4).astype(np.int64)
    _, inv, cnt = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    inv = inv.reshape(-1)
    sums = np.zeros((len(cnt), W.shape[1]), dtype=np.float64)
    np.add.at(sums, inv, W)
    return (sums / cnt[:, None])[inv].astype(np.float32), int(len(co) - len(cnt))


def read_weights(obj):
    W = np.zeros((len(obj.data.vertices), len(names_out)), dtype=np.float32)
    gidx = {vg.index: oi[vg.name] for vg in obj.vertex_groups if vg.name in oi}
    for v in obj.data.vertices:
        for ge in v.groups:
            d = gidx.get(ge.group)
            if d is not None: W[v.index, d] += ge.weight
    return W


def add_col(n, parent_like):
    """a new (initially empty) weight column for a procedural bone"""
    global Wt
    names_out.append(n); oi[n] = len(names_out) - 1
    Wt = np.concatenate([Wt, np.zeros((len(co), 1), dtype=np.float32)], 1)


# ---------------------------------------------------------------- wings: the mass behind the back follows wing_L / wing_R
sh_x = abs(bones["upperarm_L"][0].x)
chest = bones["chest"][0]
if a.wings:
    torso = co[(co[:, 2] > bones["hips"][0].z) & (co[:, 2] < chest.z) & (np.abs(co[:, 0]) < sh_x * 0.5)]
    back_y = float(np.percentile(torso[:, 1], 80)) if len(torso) else chest.y + H * 0.04
    W = float(co[:, 0].max() - co[:, 0].min())
    for s, sg in (("L", 1), ("R", -1)):
        bones[f"wing_{s}"] = (Vector((sg * sh_x * 0.35, back_y, chest.z + H * 0.04)), Vector((sg * W * 0.45, back_y + H * 0.05, chest.z + H * 0.14)), "chest")
        add_col(f"wing_{s}", "chest")
    armd = np.min(np.stack([seg_dist(bones[f"{b}_{s}"][0], bones[f"{b}_{s}"][1]) for b in ("upperarm", "forearm", "hand") for s in ("L", "R")]), 0)
    legd = np.min(np.stack([seg_dist(bones[f"{b}_{s}"][0], bones[f"{b}_{s}"][1]) for b in ("thigh", "shin", "foot") for s in ("L", "R")]), 0)
    wing = (co[:, 1] > back_y + H * 0.02) & (np.abs(co[:, 0]) > sh_x * 0.3) & (co[:, 2] > H * 0.12)
    wing |= (np.abs(co[:, 0]) > sh_x * 0.8) & (armd > H * 0.06) & (legd > H * 0.08) & (co[:, 2] > H * 0.12) & (co[:, 1] > chest.y - H * 0.02)
    limb = [oi[f"{b}_{s}"] for b in ("shoulder", "upperarm", "forearm", "hand", "thigh", "shin", "foot") for s in ("L", "R") if f"{b}_{s}" in oi]
    limb += [oi[n] for n in names_out if n[:-2] in {f"{f}{k}" for f in ("thumb", "index", "middle", "ring", "pinky") for k in (1, 2, 3)}]
    Wt[np.ix_(wing, limb)] = 0
    for s, sg in (("L", 1), ("R", -1)):
        m = wing & (np.sign(co[:, 0]) == sg)
        k = np.clip((np.abs(co[m, 0]) - sh_x * 0.45) / max(1e-6, W * 0.2), 0, 1)
        Wt[m] *= (1 - k)[:, None]
        Wt[m, oi[f"wing_{s}"]] += k
        # what's left on a wing root rides the chest, never an arm
        rest = Wt[m].sum(1) < 1e-4
        idx = np.where(m)[0][rest]; Wt[idx, oi["chest"]] = 1
    LOG["wing_verts"] = int(wing.sum())

# ---------------------------------------------------------------- body colliders (capsule radii measured from the mesh)
# the runtime cloth/hair solver (src/render/Dynamics.ts) pushes chain particles out of these; radius = how far the
# surface sits from the bone line, measured on the vertices each bone dominates
dom = np.argmax(Wt, 1)
COLL = {}
for n in ("hips", "spine", "chest", "neck", "head", "upperarm_L", "upperarm_R", "forearm_L", "forearm_R", "thigh_L", "thigh_R", "shin_L", "shin_R"):
    if n not in oi or n not in bones: continue
    m = dom == oi[n]
    if m.sum() < 20: continue
    d = seg_dist(bones[n][0], bones[n][1])[m]
    COLL[n] = round(float(np.percentile(d, 55)), 5)
LOG["colliders"] = COLL

# ---------------------------------------------------------------- dynamic chains: long hair / capes / coat tails / skirts
# three deforming segments + a tip marker each (hair_B_1..3 + hair_B_4); skirts are split in four panels around the hips
# (front / left / back / right) with angular blending so neighbouring panels share the vertices between them (no seams)
SEG = 3
chains = []
TIPS = set()
if (a.chains or a.hair or a.crown or a.sleeves) and not a.mech:
    hz, hy, hx = bones["hips"][0].z, bones["hips"][0].y, bones["hips"][0].x
    neck_z = bones["neck"][0].z
    def ground_dist(n):
        """distance in the ground plane from each vertex to the closest point of a (leg) bone"""
        A = np.array(bones[n][0]); B = np.array(bones[n][1]); AB = B - A
        t = np.clip(((co - A) @ AB) / max(1e-9, AB @ AB), 0, 1)
        Q = A + t[:, None] * AB
        return np.hypot(co[:, 0] - Q[:, 0], co[:, 1] - Q[:, 1])
    legd = np.min(np.stack([ground_dist(f"{b}_{s}") for b in ("thigh", "shin") for s in ("L", "R")]), 0)
    armd = np.min(np.stack([seg_dist(bones[f"{b}_{s}"][0], bones[f"{b}_{s}"][1]) for b in ("forearm", "hand") for s in ("L", "R")]), 0)
    back_plane = float(np.percentile(co[(co[:, 2] > hz) & (co[:, 2] < chest.z) & (np.abs(co[:, 0]) < sh_x * 0.5), 1], 80))

    def chain(prefix, mask, parent, share=None, min_verts=90, keep_top=0.1, fade=None, up=False, min_len=0.08):
        """bones down the middle of a hanging vertex mass (or up an upright one, up=True); weights blend in along the
        chain (the attached root keeps the body's)"""
        if mask.sum() < min_verts: return False
        Pm = co[mask]
        if up: ztop, zbot = np.percentile(Pm[:, 2], 4), np.percentile(Pm[:, 2], 99)      # root low, tip high
        else: ztop, zbot = np.percentile(Pm[:, 2], 94), np.percentile(Pm[:, 2], 2)
        if abs(ztop - zbot) < H * min_len: return False
        pts = []
        for k in range(SEG + 1):
            zk = ztop - (ztop - zbot) * k / SEG
            band = Pm[np.abs(Pm[:, 2] - zk) < max(H * 0.02, abs(ztop - zbot) * 0.08)]
            root = Pm[Pm[:, 2] <= ztop] if up else Pm[Pm[:, 2] >= ztop]
            pts.append(Vector(band.mean(0) if len(band) else Pm.mean(0)) if k else Vector(root.mean(0)))
            pts[-1].z = zk
        for k in range(SEG):
            bones[f"{prefix}_{k + 1}"] = (pts[k], pts[k + 1], parent if k == 0 else f"{prefix}_{k}")
            add_col(f"{prefix}_{k + 1}", parent)
        tipdir = (pts[-1] - pts[-2]).normalized()
        bones[f"{prefix}_{SEG + 1}"] = (pts[-1], pts[-1] + tipdir * H * 0.02, f"{prefix}_{SEG}")
        TIPS.add(f"{prefix}_{SEG + 1}")
        idx = np.where(mask)[0]
        t = np.clip((ztop - co[idx, 2]) / (ztop - zbot if abs(ztop - zbot) > 1e-6 else 1e-6), 0, 1)
        w = np.clip((t - keep_top) / 0.3, 0, 1) ** 1.2 * (share[idx] if share is not None else 1) * (fade[idx] if fade is not None else 1)
        # hat functions: each segment owns the depth band around its middle
        f = t * SEG
        wseg = np.stack([np.clip(1 - np.abs(f - (k + 0.5)), 0, 1) for k in range(SEG)], 1)
        wseg[:, 0] = np.where(f < 0.5, 1, wseg[:, 0]); wseg[:, -1] = np.where(f > SEG - 0.5, 1, wseg[:, -1])
        wseg /= np.maximum(wseg.sum(1, keepdims=True), 1e-6)
        Wt[idx] *= (1 - w)[:, None]
        for k in range(SEG): Wt[idx, oi[f"{prefix}_{k + 1}"]] += w * wseg[:, k]
        chains.append(prefix)
        return True

    # skirts / robes / coat tails: below the hips, clear of both legs and the hanging hands
    leg_r = H * 0.07
    cloth = (co[:, 2] < hz - H * 0.06) & (co[:, 2] > H * 0.05) & (legd > leg_r) & (armd > H * 0.11)
    # trousers, not a skirt: the seat and crotch between the thighs, at the body's own depth. A skirt panel hangs in front
    # of or behind the legs; baggy hakama / trousers sit far enough from the leg bones to pass the test above, and bound
    # to a skirt chain they stay behind when the legs split and tear into long loops (Gantetsu's run)
    hip_half = abs(bones["thigh_L"][0].x - hx)
    thigh_r = max(COLL.get("thigh_L", H * 0.06), COLL.get("thigh_R", H * 0.06))
    crotch = (np.abs(co[:, 0] - hx) < hip_half * 1.15) & (np.abs(co[:, 1] - hy) < thigh_r * 1.25) & (co[:, 2] < hz)
    cloth &= ~crotch
    LOG["crotch_excluded"] = int(crotch.sum())
    if a.wings: cloth &= co[:, 1] <= back_plane + H * 0.02
    ang = np.arctan2(co[:, 0] - hx, -(co[:, 1] - hy))                  # 0 = front (-Y), +pi/2 = left (+X)
    panels = {"skirt_F": 0.0, "skirt_L": np.pi / 2, "skirt_B": np.pi, "skirt_R": -np.pi / 2}
    shares = {k: np.maximum(0, np.cos(ang - c)) ** 2 for k, c in panels.items()}
    live = {k: (cloth & (sh > 0.25)).sum() >= 90 for k, sh in shares.items()}
    tot = sum(shares[k] for k in panels if live[k]) if any(live.values()) else None
    for k in panels:
        if a.chains and live[k] and tot is not None:
            # cloth right beside a leg stays mostly on the leg, fading onto the panel further out (no torn triangles at the seam)
            legfade = np.clip((legd - leg_r) / (leg_r * 1.6), 0, 1) ** 0.8
            chain(k, cloth & (shares[k] > 0.02), "hips", share=shares[k] / np.maximum(tot, 1e-6), fade=legfade)
    # a cape / long coat back hanging from the shoulders
    cape = (co[:, 1] > back_plane + H * 0.02) & (co[:, 2] < neck_z - H * 0.05) & (co[:, 2] > hz - H * 0.3) & (np.abs(co[:, 0]) < sh_x * 1.1)
    cape &= ~crotch                                             # a coat tail hangs behind the seat, never between the legs
    if a.chains and not a.no_cape and not a.wings and cape.sum() > 150: chain("cape_B", cape, "chest")
    # ---- hair (and scarves): colour-matched to the hair on the scalp and grown out from the head through the mesh, so
    # the upper back, a quiver strap or a chest plate can never join a hair chain (the old geometric masks did)
    hb, ht = bones["head"][0], bones["head"][1]
    head_r = COLL.get("head", H * 0.06)
    if a.hair or a.crown:
        alb = vertex_albedo(body)
        col_ok = np.isfinite(alb).all(1)
        dxy = np.hypot(co[:, 0] - hb.x, co[:, 1] - hb.y)
        top_z = float(np.percentile(co[(dxy < head_r * 1.3) & (co[:, 2] > hb.z), 2], 99.5))
        if a.hair_rgb:
            ref = np.array([float(x) for x in a.hair_rgb.split(",")])
        else:
            scalp = col_ok & (dxy < head_r * 0.9) & (co[:, 2] > top_z - H * 0.05) & (co[:, 2] < top_z - H * 0.008)
            ref = np.median(alb[scalp], 0) if scalp.sum() > 20 else np.array([np.nan] * 3)
        LOG["hair_rgb"] = [round(float(x), 3) for x in ref]
        LOG["albedo_ok"] = round(float(col_ok.mean()), 3); LOG["top_z"] = round(top_z - hb.z, 3)
        # colour distance that forgives baked shading: hue / saturation count fully, brightness at ~0.6
        c0 = np.nan_to_num(alb); l0 = c0.mean(1, keepdims=True); lr = ref.mean()
        dist = np.sqrt((((c0 - l0) - (ref - lr)) ** 2).sum(1) * 2.0 + ((l0[:, 0] - lr) ** 2) * 0.35)
        match = col_ok & (dist < a.hair_tol)
        edges = np.empty(len(body.data.edges) * 2, dtype=np.int64); body.data.edges.foreach_get("vertices", edges); edges = edges.reshape(-1, 2)

        def grow(seed, allow):
            """vertices reachable from seed through allowed vertices along mesh edges"""
            got = seed & allow
            e = edges[allow[edges[:, 0]] & allow[edges[:, 1]]]
            for _ in range(400):
                nxt = got.copy(); nxt[e[got[e[:, 0]], 1]] = True; nxt[e[got[e[:, 1]], 0]] = True
                if nxt.sum() == got.sum(): break
                got = nxt
            return got
        head_zone = (dxy < head_r * 1.6) & (co[:, 2] > hb.z - H * 0.02)
        # the face (front half of the head, chin to brow, the width of the face): a pale face matched pale hair and
        # the hair chains dragged it (Nocturne); bangs over the brow stay hair
        face = (co[:, 1] < hb.y - head_r * 0.1) & (np.abs(co[:, 0] - hb.x) < head_r * 0.7) \
            & (co[:, 2] > hb.z - H * 0.035) & (co[:, 2] < hb.z + (top_z - hb.z) * 0.62)
        LOG["face_excluded"] = int(face.sum())
        seed = match & head_zone & (co[:, 2] > hb.z + (top_z - hb.z) * 0.35)
        if a.scarf:             # a scarf / hood cloth: seeded around the neck instead of on the scalp
            seed = match & (dxy < head_r * 2.5) & (co[:, 2] > bones["neck"][0].z - H * 0.03) & (co[:, 2] < hb.z + H * 0.05)
        if a.hair:
            # hanging hair: from the base of the skull down (not below mid-thigh), within the shoulder line
            zone = (co[:, 2] > hz - H * 0.25) & (np.abs(co[:, 0] - hb.x) < sh_x * 1.25)
            if not a.scarf: zone &= ~cloth                          # a scarf's tails may hang past the hips
            hairv = grow(seed, match & (zone | head_zone))
            if a.scarf:
                # scarf tails are often separate mesh islands: also grow across small gaps (neighbouring 1.5 cm voxels)
                allow = match & (zone | head_zone)
                vox = np.floor(co / (H * 0.009)).astype(np.int64)
                key = lambda v: (v[:, 0] * 73856093) ^ (v[:, 1] * 19349663) ^ (v[:, 2] * 83492791)
                offs = np.array([(i, j, k) for i in (-1, 0, 1) for j in (-1, 0, 1) for k in (-1, 0, 1)])
                for _ in range(200):
                    cells = set(key(vox[hairv]).tolist())
                    near = np.zeros(len(co), bool)
                    for o in offs: near |= np.isin(key(vox + o), list(cells))
                    nxt = hairv | (near & allow)
                    nxt = grow(nxt, allow)
                    if nxt.sum() == hairv.sum(): break
                    hairv = nxt
            hang = hairv & (co[:, 2] < hb.z + H * 0.015) & ~face
            back = co[:, 1] > hb.y                                  # behind the head's centre (the face looks down -Y)
            chain("hair_B", hang & back, "head", min_verts=40, min_len=0.04)
            for sd, sg in (("L", 1), ("R", -1)):                     # locks / scarf ends hanging in front, per side
                chain(f"hair_{sd}", hang & ~back & (np.sign(co[:, 0] - hb.x) == sg), "head", min_verts=30, min_len=0.035)
            LOG["hair_verts"] = int(hang.sum()); LOG["hair_match_zone"] = int((match & zone).sum())
        if a.crown:
            # hair piled on the head: everything hair-coloured above the brow, rooted at the scalp, the tips free
            crown = grow(seed, match & head_zone) & (co[:, 2] > hb.z + (top_z - hb.z) * 0.55) & ~face
            chain("hair_T", crown, "head", min_verts=60, keep_top=0.35, up=True, min_len=0.03)
            LOG["crown_verts"] = int(crown.sum())
    # ---- wide sleeves: cloth hanging below the forearm, nearer the arm than the torso, not the arm itself
    if a.sleeves:
        spine_d = np.min(np.stack([seg_dist(bones[b][0], bones[b][1]) for b in ("spine", "chest", "neck")]), 0)
        for sd in ("L", "R"):
            ua, fa, hd_ = bones[f"upperarm_{sd}"][0], bones[f"forearm_{sd}"][0], bones[f"hand_{sd}"][0]
            d_arm = np.minimum(seg_dist(ua, fa), seg_dist(fa, hd_))
            d_hand = np.linalg.norm(co - np.array(hd_), axis=1)
            arm_r = max(COLL.get(f"forearm_{sd}", H * 0.03), COLL.get(f"upperarm_{sd}", H * 0.035))
            # the arm line's height above each vertex (the sleeve hangs below it)
            A, B = np.array(ua), np.array(hd_); AB = B - A
            tt = np.clip(((co - A) @ AB) / max(1e-9, AB @ AB), 0, 1); arm_z = A[2] + tt * AB[2]
            sl = (d_arm > arm_r * 1.3) & (d_arm < H * 0.2) & (d_arm < spine_d * 0.85) & (co[:, 2] < arm_z - arm_r * 0.6) \
                & (d_hand > H * 0.05) & (tt > 0.3) & (np.sign(co[:, 0]) == (1 if sd == "L" else -1)) & ~cloth
            chain(f"sleeve_{sd}", sl, f"forearm_{sd}", min_verts=150, keep_top=0.05, min_len=0.05)
LOG["chains"] = chains
# final collider radii: the cloth and hair now belong to their chains, so they no longer fatten the body capsules
dom = np.argmax(Wt, 1)
for n in list(COLL):
    m = dom == oi[n]
    if m.sum() >= 20: COLL[n] = round(float(np.percentile(seg_dist(bones[n][0], bones[n][1])[m], 55)), 5)
LOG["colliders"] = COLL

# ---------------------------------------------------------------- armature
arm_data = bpy.data.armatures.new("Rig"); arm = bpy.data.objects.new("Rig", arm_data); scene.collection.objects.link(arm)
for o in scene.objects: o.select_set(False)
arm.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
for n, (hd_, tl, par) in bones.items():
    eb = arm_data.edit_bones.new(n); eb.head = hd_; eb.tail = tl if (tl - hd_).length > 1e-4 else hd_ + Vector((0, 0, H * 0.02)); eb.roll = 0
for n, (hd_, tl, par) in bones.items():
    if par: arm_data.edit_bones[n].parent = arm_data.edit_bones[par]; arm_data.edit_bones[n].use_connect = False
bpy.ops.object.mode_set(mode="OBJECT")
for b in arm_data.bones:
    if b.name == "root" or b.name in TIPS: b.use_deform = False
Wt, LOG["seam_copies"] = weld_weights(Wt)
lost = apply_weights(body, Wt)
LOG["unweighted_fixed"] = lost
# smooth the weight transitions (panel seams, leg / cloth borders), keep 4 influences, renormalise
for o in scene.objects: o.select_set(o == body)
bpy.context.view_layer.objects.active = body
try:
    bpy.ops.object.mode_set(mode="WEIGHT_PAINT")
    bpy.ops.object.vertex_group_smooth(group_select_mode="ALL", factor=0.5, repeat=2)
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    LOG["smoothed"] = True
    # smoothing walks the mesh's edges, and the two sides of a seam aren't connected: weld again afterwards
    W2, _ = weld_weights(read_weights(body))
    apply_weights(body, W2)
except Exception as e:
    LOG["smooth_error"] = str(e)[:120]
    try: bpy.ops.object.mode_set(mode="OBJECT")
    except Exception: pass
if a.hd and a.hd_late:
    # the finished weights - body, chains, welded and smoothed on the clean retopo - onto the HD mesh by nearest surface:
    # a loose HD shell (a hair card, a cloth layer) follows the surface it lies on, whatever chain that is
    try: bpy.ops.object.mode_set(mode="OBJECT")
    except Exception: pass
    hd = load_hd(co)
    transfer_weights(body, hd, names_out)
    bpy.data.objects.remove(body)
    body = hd
    co = np.empty(len(body.data.vertices) * 3); body.data.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    Wh, LOG["seam_copies_hd"] = weld_weights(read_weights(body))
    if a.fp_arms: Wh = reskin_hands(Wh)
    LOG["unweighted_hd"] = apply_weights(body, Wh)
    if a.fp_arms:
        # arms and hands only (the viewmodel's armsOnly cut, done once here with a margin): shoulders down
        import re, bmesh
        armre = re.compile(r"^(upperarm|forearm|hand|(thumb|index|middle|ring|pinky)\d)_[LR]$")
        ai = [oi[n] for n in names_out if armre.match(n)]
        drop = np.where(Wh[:, ai].sum(1) <= 0.3)[0]
        bm = bmesh.new(); bm.from_mesh(body.data); bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.verts[int(i)] for i in drop], context="VERTS")
        bm.to_mesh(body.data); bm.free(); body.data.update()
        LOG["fp_full_tris"] = sum(len(p.vertices) - 2 for p in body.data.polygons)
        if a.tris: decimate(body, a.tris)
        co = np.empty(len(body.data.vertices) * 3); body.data.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    LOG["verts"] = len(co); LOG["tris"] = sum(len(p.vertices) - 2 for p in body.data.polygons)
body.parent = arm
am = body.modifiers.new("Armature", "ARMATURE"); am.object = arm
# drop whatever else the imports left (the source armature, empties)
for o in list(scene.objects):
    if o not in (arm, body): bpy.data.objects.remove(o)
LOG["bones"] = len(bones)


# ---------------------------------------------------------------- deformation self-test (same as rig_hero.py)
def test_pose():
    pb = arm.pose.bones
    for b in pb: b.rotation_mode = "XYZ"
    pb["thigh_L"].rotation_euler = (math.radians(-40), 0, 0); pb["shin_L"].rotation_euler = (math.radians(60), 0, 0)
    pb["upperarm_R"].rotation_euler = (math.radians(-60), 0, 0); pb["spine"].rotation_euler = (math.radians(15), 0, 0)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get(); ev = body.evaluated_get(dg); me = ev.to_mesh()
    c2 = np.empty(len(me.vertices) * 3, dtype=np.float32); me.vertices.foreach_get("co", c2); ev.to_mesh_clear()
    move = np.linalg.norm(c2.reshape(-1, 3) - co, axis=1)
    for b in pb: b.rotation_euler = (0, 0, 0)
    bpy.context.view_layer.update()
    return float(np.percentile(move, 99.5)), float(move.max())


p995, mmax = test_pose()
LOG["deform_p99.5"] = round(p995 / H, 3); LOG["deform_max"] = round(mmax / H, 3)

for o in scene.objects: o.select_set(o in (arm, body))
os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=os.path.abspath(a.out), export_format="GLB", use_selection=True, export_yup=True, export_skins=True, export_animations=False, export_apply=False)
LOG["secs"] = round(time.time() - T0, 1)
print("RIG_DONE", json.dumps(LOG))
