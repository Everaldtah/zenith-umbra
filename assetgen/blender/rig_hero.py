"""Blender 5.x: turn a TRELLIS hero mesh into a game-ready rigged GLB (no baked clips - the game animates procedurally).

blender -b -P rig_hero.py -- --glb in.glb --out out.glb --height 1.8 [--tris 26000] [--wings] [--mech] [--static] [--tex 2048]

1. clean (join, drop floaters), orient (front = -Y), feet to z=0, scale to hero height, decimate
2. orthographic front render -> MediaPipe pose (system python) -> joint positions; silhouette heuristics as fallback / sanity
3. humanoid armature (names shared with src/render/Animator.ts), joint depth = median of nearby vertices
4. bone-heat weights on a voxel-remeshed proxy, transferred to the real mesh; wings / feet region fix-ups; normalise, 4 influences
"""
import bpy, bmesh, sys, os, json, math, argparse, subprocess, time
import numpy as np
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--glb", required=True); ap.add_argument("--out", required=True)
ap.add_argument("--height", type=float, default=1.8); ap.add_argument("--tris", type=int, default=26000)
ap.add_argument("--wings", action="store_true"); ap.add_argument("--mech", action="store_true"); ap.add_argument("--static", action="store_true")
ap.add_argument("--yaw", type=float, default=0.0); ap.add_argument("--python", default="python")
ap.add_argument("--debug", default="")
a = ap.parse_args(argv)
HERE = os.path.dirname(os.path.abspath(__file__))
T0 = time.time()
LOG = {"id": os.path.basename(a.out)[:-4]}

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=os.path.abspath(a.glb))
meshes = [o for o in scene.objects if o.type == "MESH"]
for o in scene.objects: o.select_set(o in meshes)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1: bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
for o in list(scene.objects):
    if o != obj: bpy.data.objects.remove(o)
obj.parent = None
bpy.ops.object.select_all(action="DESELECT"); obj.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# ---------------------------------------------------------------- floaters
bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT"); bpy.ops.mesh.separate(type="LOOSE"); bpy.ops.object.mode_set(mode="OBJECT")
parts = [o for o in scene.objects if o.type == "MESH"]
big = max(parts, key=lambda o: len(o.data.vertices))
def diag(o):
    b = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return (Vector((max(v.x for v in b), max(v.y for v in b), max(v.z for v in b))) - Vector((min(v.x for v in b), min(v.y for v in b), min(v.z for v in b)))).length
nb, db = len(big.data.vertices), diag(big)
for o in parts:
    if o is not big and len(o.data.vertices) < 0.01 * nb and diag(o) < 0.12 * db: bpy.data.objects.remove(o)
parts = [o for o in scene.objects if o.type == "MESH"]
for o in scene.objects: o.select_set(o in parts)
bpy.context.view_layer.objects.active = big
if len(parts) > 1: bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active

def verts():
    co = np.empty(len(obj.data.vertices) * 3, dtype=np.float32); obj.data.vertices.foreach_get("co", co); return co.reshape(-1, 3)
def set_verts(co): obj.data.vertices.foreach_set("co", co.astype(np.float32).ravel()); obj.data.update()

# ---------------------------------------------------------------- orient + normalise
co = verts()
yr = math.radians(a.yaw)
if a.yaw:
    c, s = math.cos(yr), math.sin(yr)
    co = np.stack([co[:, 0] * c - co[:, 1] * s, co[:, 0] * s + co[:, 1] * c, co[:, 2]], 1)
mn, mx = co.min(0), co.max(0)
S = a.height / (mx[2] - mn[2])
co = (co - np.array([(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, mn[2]])) * S
set_verts(co)
H = a.height
# ---------------------------------------------------------------- decimate
tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
if tris > a.tris:
    m = obj.modifiers.new("dec", "DECIMATE"); m.ratio = a.tris / tris; m.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier="dec")
LOG["tris"] = sum(len(p.vertices) - 2 for p in obj.data.polygons)
for p in obj.data.polygons: p.use_smooth = True
co = verts()
W = float(co[:, 0].max() - co[:, 0].min())

# ---------------------------------------------------------------- front render -> pose
RES = 768
def front_render(path, flip=False):
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam")); scene.collection.objects.link(cam); scene.camera = cam
    cam.data.type = "ORTHO"; span = max(H, W) * 1.08; cam.data.ortho_scale = span
    cam.location = (0, (10 if flip else -10), H / 2); cam.rotation_euler = (math.pi / 2, 0, math.pi if flip else 0)
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "FLAT"; scene.display.shading.color_type = "TEXTURE"
    scene.render.resolution_x = scene.render.resolution_y = RES
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("W"); scene.world = world; world.color = (1, 1, 1)
    try: scene.display.shading.background_type = "WORLD"
    except Exception: pass
    try: scene.view_settings.view_transform = "Standard"
    except Exception: pass
    scene.render.filepath = path; bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
    return span
def pose_of(path):
    r = subprocess.run([a.python, os.path.join(HERE, "pose.py"), path], capture_output=True, text=True)
    try: return json.loads(r.stdout.strip().splitlines()[-1])
    except Exception: return {"ok": False, "score": 0, "err": r.stderr[-400:]}

tmp = os.path.join(os.path.dirname(os.path.abspath(a.out)), f"_{LOG['id']}_front.png")
span = front_render(tmp)
P = pose_of(tmp)
# facing the wrong way? a back view gives low visibility on the face points; test the rear camera too
Pb = pose_of(front_render(tmp.replace("_front", "_back"), flip=True) and tmp.replace("_front", "_back"))
LOG["pose_front"] = round(P.get("score", 0), 3); LOG["pose_back"] = round(Pb.get("score", 0), 3)
nose_front = P.get("pts", {}).get("nose", [0, 0, 0])[2]; nose_back = Pb.get("pts", {}).get("nose", [0, 0, 0])[2]
if Pb.get("ok") and (nose_back > nose_front + 0.25) and Pb["score"] > P.get("score", 0) * 0.9:
    # the model faces +Y: spin it round so the front is -Y (three.js +Z) and use the rear detection mirrored
    co = verts(); co[:, 0] *= -1; co[:, 1] *= -1; set_verts(co); LOG["flipped"] = True
    P = {**Pb, "pts": {k: [1 - v[0], v[1], v[2]] for k, v in Pb["pts"].items()}}
if not a.debug:
    for f in (tmp, tmp.replace("_front", "_back")):
        if os.path.exists(f): os.remove(f)
co = verts()

def to3(u, v):
    """image (u right, v down) -> model x, z (camera looks +Y; image right = +X = the character's left)"""
    return (u - 0.5) * span, H / 2 + (0.5 - v) * span

pts = {}
if P.get("ok"):
    for k, (u, v, vis) in P["pts"].items():
        x, z = to3(u, v); pts[k] = (x, z, vis)

def depth(x, z, r=None):
    """median Y of vertices near (x, z) - puts joints inside the body instead of on its surface"""
    r = r or H * 0.05
    m = (np.abs(co[:, 0] - x) < r) & (np.abs(co[:, 2] - z) < r)
    if m.sum() < 5:
        m = (np.abs(co[:, 0] - x) < r * 2.5) & (np.abs(co[:, 2] - z) < r * 2.5)
    return float(np.median(co[m, 1])) if m.sum() else 0.0

# ---------------------------------------------------------------- joints: pose landmarks, sanity-checked against the silhouette
def lm(name, fallback):
    p = pts.get(name)
    return (p[0], p[1]) if p and p[2] > 0.35 else fallback

# silhouette-based defaults (A-pose humanoid proportions; mechs are stockier)
hip_z = H * (0.45 if a.mech else 0.5)
sh_z = H * (0.76 if a.mech else 0.8)
band = co[(co[:, 2] > sh_z - H * 0.03) & (co[:, 2] < sh_z + H * 0.03)]
torso_w = float(np.percentile(np.abs(band[:, 0]), 60)) if len(band) else W * 0.2
sh_x = min(torso_w, W * 0.3)
leg_x = H * (0.09 if a.mech else 0.06)
arm_reach = W / 2 * 0.92
J = {
    "shoulder_l": lm("shoulder_l", (sh_x, sh_z)), "shoulder_r": lm("shoulder_r", (-sh_x, sh_z)),
    "elbow_l": lm("elbow_l", ((sh_x + arm_reach) / 2, sh_z - H * 0.15)), "elbow_r": lm("elbow_r", (-(sh_x + arm_reach) / 2, sh_z - H * 0.15)),
    "wrist_l": lm("wrist_l", (arm_reach, sh_z - H * 0.3)), "wrist_r": lm("wrist_r", (-arm_reach, sh_z - H * 0.3)),
    "hip_l": lm("hip_l", (leg_x, hip_z)), "hip_r": lm("hip_r", (-leg_x, hip_z)),
    "knee_l": lm("knee_l", (leg_x, H * 0.27)), "knee_r": lm("knee_r", (-leg_x, H * 0.27)),
    "ankle_l": lm("ankle_l", (leg_x, H * 0.05)), "ankle_r": lm("ankle_r", (-leg_x, H * 0.05)),
    "nose": lm("nose", (0, H * 0.9)),
}
# enforce left = +X (MediaPipe's subject-left should already land there in a front view)
for k in ("shoulder", "elbow", "wrist", "hip", "knee", "ankle"):
    L, R = J[f"{k}_l"], J[f"{k}_r"]
    if L[0] < R[0]: J[f"{k}_l"], J[f"{k}_r"] = R, L
# sanity: joints must be vertically ordered, feet near the ground
bad = []
for s in ("l", "r"):
    if not (J[f"ankle_{s}"][1] < J[f"knee_{s}"][1] < J[f"hip_{s}"][1] < J[f"shoulder_{s}"][1]): bad.append(f"leg order {s}")
    if J[f"ankle_{s}"][1] > H * 0.2: bad.append(f"ankle high {s}")
if bad:
    LOG["fallback"] = bad
    for s, sg in (("l", 1), ("r", -1)):
        J[f"hip_{s}"] = (sg * leg_x, hip_z); J[f"knee_{s}"] = (sg * leg_x, H * 0.27); J[f"ankle_{s}"] = (sg * leg_x, H * 0.05)
LOG["method"] = "pose" if P.get("ok") and not bad else "pose+heuristic" if P.get("ok") else "heuristic"
LOG["pose_score"] = round(P.get("score", 0), 3)

def V(x, z, y=None): return Vector((x, depth(x, z) if y is None else y, z))
hipL, hipR = V(*J["hip_l"]), V(*J["hip_r"])
pelvis = (hipL + hipR) / 2; pelvis.z = (hipL.z + hipR.z) / 2 + H * 0.02
shL, shR = V(*J["shoulder_l"]), V(*J["shoulder_r"])
neck = (shL + shR) / 2; neck.z = max(shL.z, shR.z) + H * 0.02
chest = pelvis.lerp(neck, 0.55)
spine = pelvis.lerp(neck, 0.22)
head_top = Vector((neck.x, neck.y, H))
head_base = neck.lerp(head_top, 0.25)
bones = {
    "root": (Vector((0, 0, 0)), Vector((0, 0, H * 0.08)), None),
    "hips": (pelvis, spine, "root"),
    "spine": (spine, chest, "hips"),
    "chest": (chest, neck, "spine"),
    "neck": (neck, head_base, "chest"),
    "head": (head_base, head_top, "neck"),
}
for s, S_ in (("l", "L"), ("r", "R")):
    sh = shL if s == "l" else shR
    el = V(*J[f"elbow_{s}"]); wr = V(*J[f"wrist_{s}"])
    hand_tip = wr + (wr - el).normalized() * H * 0.06
    clav = neck.lerp(sh, 0.15); clav.z = neck.z - H * 0.02
    bones[f"shoulder_{S_}"] = (clav, sh, "chest")
    bones[f"upperarm_{S_}"] = (sh, el, f"shoulder_{S_}")
    bones[f"forearm_{S_}"] = (el, wr, f"upperarm_{S_}")
    bones[f"hand_{S_}"] = (wr, hand_tip, f"forearm_{S_}")
    hp = hipL if s == "l" else hipR
    kn = V(*J[f"knee_{s}"]); an = V(*J[f"ankle_{s}"]); an.z = max(an.z, H * 0.035)
    kn.y = min(kn.y, (hp.y + an.y) / 2)          # knees sit slightly forward (-Y) so IK bends them the right way
    toe = Vector((an.x, an.y - H * 0.08, H * 0.01))
    bones[f"thigh_{S_}"] = (hp, kn, "hips")
    bones[f"shin_{S_}"] = (kn, an, f"thigh_{S_}")
    bones[f"foot_{S_}"] = (an, toe, f"shin_{S_}")
if a.wings:
    back_y = float(np.percentile(co[(co[:, 2] > chest.z - H * 0.1) & (np.abs(co[:, 0]) < sh_x * 0.6), 1], 75)) if len(co) else chest.y
    for S_, sg in (("L", 1), ("R", -1)):
        bones[f"wing_{S_}"] = (Vector((sg * sh_x * 0.35, back_y, chest.z + H * 0.04)), Vector((sg * W * 0.45, back_y + H * 0.05, chest.z + H * 0.14)), "chest")
LOG["joints"] = {k: [round(v, 3) for v in J[k]] for k in J}

# ---------------------------------------------------------------- armature
arm_data = bpy.data.armatures.new("Rig"); arm = bpy.data.objects.new("Rig", arm_data); scene.collection.objects.link(arm)
bpy.ops.object.select_all(action="DESELECT"); arm.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
for n, (hd, tl, par) in bones.items():
    eb = arm_data.edit_bones.new(n); eb.head = hd; eb.tail = tl if (tl - hd).length > 1e-3 else hd + Vector((0, 0, H * 0.02)); eb.roll = 0
for n, (hd, tl, par) in bones.items():
    if par: arm_data.edit_bones[n].parent = arm_data.edit_bones[par]
    if par and n not in ("hips", "shoulder_L", "shoulder_R", "thigh_L", "thigh_R", "wing_L", "wing_R"): arm_data.edit_bones[n].use_connect = False
bpy.ops.object.mode_set(mode="OBJECT")
for b in arm_data.bones:
    if b.name == "root": b.use_deform = False

# ---------------------------------------------------------------- weights: bone heat on a watertight proxy, transferred to the mesh
def zero_weight_fraction(o):
    zero = 0
    for v in o.data.vertices:
        if sum(g.weight for g in v.groups) < 1e-4: zero += 1
    return zero / max(1, len(o.data.vertices))

bpy.ops.object.select_all(action="DESELECT"); obj.select_set(True); bpy.context.view_layer.objects.active = obj
bpy.ops.object.duplicate(); proxy = bpy.context.view_layer.objects.active; proxy.name = "proxy"
rm = proxy.modifiers.new("rm", "REMESH"); rm.mode = "VOXEL"; rm.voxel_size = H / 110; rm.use_smooth_shade = True
bpy.ops.object.modifier_apply(modifier="rm")
for g in list(proxy.vertex_groups): proxy.vertex_groups.remove(g)
bpy.ops.object.select_all(action="DESELECT"); proxy.select_set(True); arm.select_set(True); bpy.context.view_layer.objects.active = arm
method = "heat"
try:
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
except Exception as e:
    method = "envelope"; LOG["heat_error"] = str(e)[:200]
if zero_weight_fraction(proxy) > 0.08:
    method = "envelope"
    for g in list(proxy.vertex_groups): proxy.vertex_groups.remove(g)
    bpy.ops.object.select_all(action="DESELECT"); proxy.select_set(True); arm.select_set(True); bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_ENVELOPE")
LOG["weights"] = method
# transfer to the real mesh
for g in list(obj.vertex_groups): obj.vertex_groups.remove(g)
for n in bones:
    if n != "root": obj.vertex_groups.new(name=n)
bpy.ops.object.select_all(action="DESELECT"); obj.select_set(True); bpy.context.view_layer.objects.active = obj
dt = obj.modifiers.new("dt", "DATA_TRANSFER"); dt.object = proxy; dt.use_vert_data = True
dt.data_types_verts = {"VGROUP_WEIGHTS"}; dt.vert_mapping = "POLYINTERP_NEAREST"
dt.layers_vgroup_select_src = "ALL"; dt.layers_vgroup_select_dst = "NAME"
bpy.ops.object.modifier_apply(modifier="dt")
bpy.data.objects.remove(proxy)

# ---- region fix-ups (numpy): feet belong to the lower leg chain, wings to wing bones
co = verts()
names = [g.name for g in obj.vertex_groups]
Wt = np.zeros((len(co), len(names)), dtype=np.float32)
for v in obj.data.vertices:
    for g in v.groups: Wt[v.index, g.group] = g.weight
gi = {n: i for i, n in enumerate(names)}
# no vertex on the legs below the knee may follow the arms (A-pose hands near thighs is the classic failure)
for s, sg in (("L", 1), ("R", -1)):
    below = co[:, 2] < bones[f"shin_{s}"][0].z
    for arm_b in ("upperarm", "forearm", "hand"):
        for side in ("L", "R"):
            Wt[below, gi[f"{arm_b}_{side}"]] = 0
    # upper leg area can't be driven by the arm on the same side unless it's clearly outside the leg
    thigh_zone = (co[:, 2] < bones[f"thigh_{s}"][0].z) & (np.sign(co[:, 0]) == sg) & (np.abs(co[:, 0]) < abs(bones[f"thigh_{s}"][0].x) + H * 0.07)
    for arm_b in ("forearm", "hand"):
        Wt[thigh_zone, gi[f"{arm_b}_{s}"]] *= 0.1
if a.wings:
    wing = (co[:, 1] > bones["chest"][0].y + H * 0.04) & (np.abs(co[:, 0]) > sh_x * 0.45) & (co[:, 2] > bones["hips"][0].z)
    for s, sg in (("L", 1), ("R", -1)):
        m = wing & (np.sign(co[:, 0]) == sg)
        k = np.clip((np.abs(co[m, 0]) - sh_x * 0.45) / (W * 0.2), 0, 1)
        Wt[m] *= (1 - k)[:, None]
        Wt[m, gi[f"wing_{s}"]] += k
    LOG["wing_verts"] = int(wing.sum())
# normalise, keep 4 strongest influences, unweighted verts go to the nearest bone
Wt[:, gi.get("root", 0)] = 0 if "root" in gi else Wt[:, 0]
top4 = np.argsort(-Wt, axis=1)[:, 4:]
np.put_along_axis(Wt, top4, 0, axis=1)
tot = Wt.sum(1)
lost = tot < 1e-4
if lost.any():
    segs = [(gi[n], np.array(bones[n][0]), np.array(bones[n][1])) for n in names if n in bones and n != "root"]
    P_ = co[lost]
    best = np.full(len(P_), 1e9); bi = np.zeros(len(P_), dtype=int)
    for g, A, B in segs:
        AB = B - A; t = np.clip(((P_ - A) @ AB) / max(1e-9, AB @ AB), 0, 1)
        d = np.linalg.norm(P_ - (A + t[:, None] * AB), axis=1)
        m = d < best; best[m] = d[m]; bi[m] = g
    idx = np.where(lost)[0]
    Wt[idx, bi] = 1
tot = Wt.sum(1, keepdims=True); Wt /= np.maximum(tot, 1e-6)
LOG["unweighted_fixed"] = int(lost.sum())
for g in list(obj.vertex_groups): obj.vertex_groups.remove(g)
for n in names:
    vg = obj.vertex_groups.new(name=n)
    col = Wt[:, gi[n]]
    nz = np.where(col > 1e-3)[0]
    q = np.round(col[nz] * 50) / 50
    for val in np.unique(q):
        if val > 0: vg.add(nz[q == val].tolist(), float(val), "REPLACE")
obj.parent = arm
for m in list(obj.modifiers):
    if m.type == "ARMATURE": obj.modifiers.remove(m)
am = obj.modifiers.new("Armature", "ARMATURE"); am.object = arm

# ---------------------------------------------------------------- deformation self-test: swing the limbs, look for exploding verts
def test_pose():
    pb = arm.pose.bones
    for b in pb: b.rotation_mode = "XYZ"
    pb["thigh_L"].rotation_euler = (math.radians(-40), 0, 0); pb["shin_L"].rotation_euler = (math.radians(60), 0, 0)
    pb["upperarm_R"].rotation_euler = (math.radians(-60), 0, 0); pb["spine"].rotation_euler = (math.radians(15), 0, 0)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get(); ev = obj.evaluated_get(dg); me = ev.to_mesh()
    c2 = np.empty(len(me.vertices) * 3, dtype=np.float32); me.vertices.foreach_get("co", c2); ev.to_mesh_clear()
    c2 = c2.reshape(-1, 3)
    move = np.linalg.norm(c2 - co, axis=1)
    for b in pb: b.rotation_euler = (0, 0, 0)
    return float(np.percentile(move, 99.5)), float(move.max())
p995, mmax = test_pose()
LOG["deform_p99.5"] = round(p995 / H, 3); LOG["deform_max"] = round(mmax / H, 3)

# ---------------------------------------------------------------- export
bpy.ops.object.select_all(action="DESELECT"); obj.select_set(True); arm.select_set(True)
os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=os.path.abspath(a.out), export_format="GLB", use_selection=True, export_yup=True, export_skins=True, export_animations=False, export_apply=False)
LOG["secs"] = round(time.time() - T0, 1)
print("RIG_DONE", json.dumps(LOG))
