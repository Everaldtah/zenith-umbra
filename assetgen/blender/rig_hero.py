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
ap.add_argument("--geodesic", action="store_true"); ap.add_argument("--keep-main", action="store_true")
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
    elif o is not big and a.keep_main:
        # props standing next to the character (stands, pedestals): drop parts whose centre is outside the body
        cb = sum((o.matrix_world @ Vector(c) for c in o.bound_box), Vector()) / 8
        bb = [big.matrix_world @ Vector(c) for c in big.bound_box]
        if not (min(v.x for v in bb) < cb.x < max(v.x for v in bb)) or cb.z < min(v.z for v in bb) + (max(v.z for v in bb) - min(v.z for v in bb)) * 0.15:
            bpy.data.objects.remove(o)
parts = [o for o in scene.objects if o.type == "MESH"]
# pieces hovering in the air (reconstruction artefacts) - anything not touching the main body is dropped
from mathutils.kdtree import KDTree
kd = KDTree(len(big.data.vertices))
for i, v in enumerate(big.data.vertices): kd.insert(big.matrix_world @ v.co, i)
kd.balance()
hover = 0
for o in parts:
    if o is big or len(o.data.vertices) > 0.03 * nb: continue
    step = max(1, len(o.data.vertices) // 200)
    dmin = min(kd.find(o.matrix_world @ o.data.vertices[i].co)[2] for i in range(0, len(o.data.vertices), step))
    if dmin > db * 0.1: bpy.data.objects.remove(o); hover += 1
LOG["hovering_removed"] = hover
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
# consistent outward winding (reconstructed meshes carry flipped faces that single-sided renderers cull as holes)
bpy.ops.object.select_all(action="DESELECT"); obj.select_set(True); bpy.context.view_layer.objects.active = obj
bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode="OBJECT")
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
if a.yaw == 999:   # auto-flip disabled: TRELLIS always puts the concept's front toward -Y, and the pose test misfired on mechs
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
def silhouette_joints():
    """Skeleton from the front silhouette alone: crotch gap, leg columns, shoulder break, A-pose arm clusters."""
    R_ = H / 100
    xs, zs = co[:, 0], co[:, 2]
    gx0 = xs.min(); nx = int((xs.max() - gx0) / R_) + 1; nz = int(H / R_) + 1
    G = np.zeros((nz, nx), dtype=bool)
    G[np.clip((zs / R_).astype(int), 0, nz - 1), np.clip(((xs - gx0) / R_).astype(int), 0, nx - 1)] = True
    for _ in range(2):   # close pin-holes
        G = G | np.roll(G, 1, 0) | np.roll(G, -1, 0) | np.roll(G, 1, 1) | np.roll(G, -1, 1)
    cx = int((0 - gx0) / R_)
    def segs(row):
        r = G[row]; out = []; i = 0
        while i < nx:
            if r[i]:
                j = i
                while j < nx and r[j]: j += 1
                out.append((i, j)); i = j
            else: i += 1
        return out
    X = lambda c: gx0 + c * R_
    # crotch: first row (going up) where the centre column is filled
    crotch = None
    for zi in range(int(0.12 * nz), int(0.65 * nz)):
        if G[zi, max(0, cx - 1):cx + 2].any(): crotch = zi * R_; break
    robe = crotch is None or crotch < 0.3 * H
    hipz = (0.47 if not a.mech else 0.44) * H if robe else min(crotch + 0.04 * H, 0.6 * H)
    # legs: two biggest segments at shin height
    ss = sorted(segs(int(0.15 * nz)), key=lambda s: s[1] - s[0], reverse=True)[:2]
    if len(ss) == 2 and not robe:
        lx = sorted([(X(s[0]) + X(s[1])) / 2 for s in ss])
        leg = (max(lx[1], H * 0.04), min(lx[0], -H * 0.04))
    else:
        leg = (H * (0.09 if a.mech else 0.06), -H * (0.09 if a.mech else 0.06))
    # torso segment (containing the centre) width per row -> shoulders at the sharpest widening below the neck
    def torso_w(zi):
        for s in segs(zi):
            if s[0] <= cx <= s[1]: return X(s[1]) - X(s[0]), X(s[0]), X(s[1])
        return 0.0, 0.0, 0.0
    best, shz = -1, (0.78 if a.mech else 0.81) * H
    prev = torso_w(int(0.92 * nz))[0]
    for zi in range(int(0.9 * nz), int(0.66 * nz), -1):
        wv = torso_w(zi)[0]
        if wv - prev > best and wv < W * 0.95: best, shz = wv - prev, zi * R_
        prev = wv
    shz = min(max(shz - 0.02 * H, (0.72 if a.mech else 0.77) * H), (0.86 if a.mech else 0.84) * H)
    tw, tl, tr = torso_w(int((shz - 0.08 * H) / R_))
    shx = max(min(abs(tl), abs(tr)) * 0.8, H * 0.08)
    # arms: occupied cells outside the torso between hip and shoulder; hand = the lowest such cell on each side
    arms = {}
    # below the pelvis the centre column is empty (gap between the legs): the legs themselves must not count as arms,
    # so there the body span is at least as wide as the pelvis row
    _, hl0, hr0 = torso_w(int(hipz / R_))
    for side, sg in (("l", 1), ("r", -1)):
        pts = []
        for zi in range(int(hipz * 0.7 / R_), int(shz / R_)):
            _, l0, r0 = torso_w(zi)
            if zi * R_ < hipz + 0.03 * H: l0, r0 = min(l0, hl0), max(r0, hr0)
            for s in segs(zi):
                c0, c1 = X(s[0]), X(s[1])
                # below the pelvis the leg columns themselves are never the arm
                if zi * R_ < hipz + 0.03 * H and not robe and min(abs((c0 + c1) / 2 - leg[0]), abs((c0 + c1) / 2 - leg[1])) < 0.1 * H: continue
                if sg > 0 and c0 > r0 + R_ and c0 > 0: pts.append(((c0 + c1) / 2, zi * R_))
                if sg < 0 and c1 < l0 - R_ and c1 < 0: pts.append(((c0 + c1) / 2, zi * R_))
        if len(pts) > 5:
            p = min(pts, key=lambda q: q[1])
            arms[side] = (p[0], p[1] + 0.03 * H)
        else:
            arms[side] = (sg * (shx + 0.12 * H), hipz + 0.02 * H)
    J2 = {"shoulder_l": (shx, shz), "shoulder_r": (-shx, shz), "wrist_l": arms["l"], "wrist_r": arms["r"],
          "hip_l": (leg[0], hipz), "hip_r": (leg[1], hipz), "ankle_l": (leg[0], 0.05 * H), "ankle_r": (leg[1], 0.05 * H), "nose": (0, 0.9 * H)}
    for s in ("l", "r"):
        J2[f"elbow_{s}"] = ((J2[f"shoulder_{s}"][0] + J2[f"wrist_{s}"][0]) / 2, (J2[f"shoulder_{s}"][1] + J2[f"wrist_{s}"][1]) / 2)
        J2[f"knee_{s}"] = (J2[f"hip_{s}"][0], 0.05 * H + (hipz - 0.05 * H) * 0.5)
    LOG["silhouette"] = {"crotch": round(crotch or 0, 3), "robe": robe, "shz": round(shz, 3)}
    return J2

def plausible(J):
    sh = (J["shoulder_l"][1] + J["shoulder_r"][1]) / 2; hp = (J["hip_l"][1] + J["hip_r"][1]) / 2
    ok = J["nose"][1] > 0.78 * H and 0.64 * H < sh < 0.9 * H and 0.34 * H < hp < 0.64 * H and sh - hp > 0.18 * H
    ok &= abs(J["shoulder_l"][0] - J["shoulder_r"][0]) > 0.1 * H
    ok &= min(abs(J["wrist_l"][0] - J["wrist_r"][0]), 9) > abs(J["shoulder_l"][0] - J["shoulder_r"][0]) * 0.9   # A-pose hands outside the shoulders
    ok &= all(J[f"wrist_{s}"][1] < J[f"shoulder_{s}"][1] + 0.05 * H for s in "lr")
    return bool(ok)

if not (P.get("ok") and plausible(J)):
    LOG["pose_rejected"] = bool(P.get("ok"))
    J = silhouette_joints()
    # the face detector is reliable even when the body pose isn't: anchor neck / shoulders to the nose
    nose = pts.get("nose")
    if nose and nose[2] > 0.6 and 0.66 * H < nose[1] < 0.97 * H:
        want = nose[1] - 0.1 * H
        for s in ("l", "r"):
            x, z = J[f"shoulder_{s}"]
            J[f"shoulder_{s}"] = (x, want)
            ex, ez = J[f"elbow_{s}"]; J[f"elbow_{s}"] = (ex, min(ez, want - 0.04 * H))
        J["nose"] = (nose[0], nose[1])
        LOG["nose_anchor"] = round(float(nose[1] / H), 3)
# enforce left = +X (MediaPipe's subject-left should already land there in a front view)
for k in ("shoulder", "elbow", "wrist", "hip", "knee", "ankle"):
    L, R = J[f"{k}_l"], J[f"{k}_r"]
    if L[0] < R[0]: J[f"{k}_l"], J[f"{k}_r"] = R, L
# a wrist the detector put inside the chest / above the shoulder (weapon arms confuse it): use the silhouette arm
cxb = float(np.median(co[co[:, 2] > 0.5 * H, 0])) if (co[:, 2] > 0.5 * H).any() else 0.0
Js = None
for s, sg in (("l", 1), ("r", -1)):
    wx, sx = J[f"wrist_{s}"][0] - cxb, J[f"shoulder_{s}"][0] - cxb
    if sg * wx < abs(sx) * 0.8 or J[f"wrist_{s}"][1] > J[f"shoulder_{s}"][1] + 0.05 * H:
        if Js is None:
            keep = LOG.get("silhouette"); Js = silhouette_joints()
            if keep is None: LOG.pop("silhouette", None)
            else: LOG["silhouette"] = keep
        J[f"wrist_{s}"] = Js[f"wrist_{s}"]
        J[f"elbow_{s}"] = ((J[f"shoulder_{s}"][0] + Js[f"wrist_{s}"][0]) / 2, (J[f"shoulder_{s}"][1] + Js[f"wrist_{s}"][1]) / 2)
        LOG.setdefault("wrist_fixed", []).append(s)
# legs from the geometry itself: where the two legs are separate columns, knees / ankles sit on the column centres
# (pose landmarks drift on armoured legs - crossed or splayed legs tear the mesh when the IK bends them)
def leg_columns(z):
    band = co[(co[:, 2] > z - 0.02 * H) & (co[:, 2] < z + 0.02 * H), 0]
    if len(band) < 20: return None
    R_ = H / 100; x0 = band.min()
    occ = np.zeros(int((band.max() - x0) / R_) + 3, dtype=bool); occ[((band - x0) / R_).astype(int)] = True
    occ = occ | np.roll(occ, 1) | np.roll(occ, -1)
    segs_, i = [], 0
    while i < len(occ):
        if occ[i]:
            j = i
            while j < len(occ) and occ[j]: j += 1
            segs_.append((x0 + i * R_, x0 + j * R_)); i = j
        else: i += 1
    c = float(np.median(co[co[:, 2] > 0.5 * H, 0])) if (co[:, 2] > 0.5 * H).any() else 0.0
    L_ = [s for s in segs_ if (s[0] + s[1]) / 2 > c + 0.02 * H]; R2 = [s for s in segs_ if (s[0] + s[1]) / 2 < c - 0.02 * H]
    if not L_ or not R2: return None
    l = max(L_, key=lambda s: s[1] - s[0]); r = max(R2, key=lambda s: s[1] - s[0])
    if l[0] < c < l[1] or r[0] < c < r[1]: return None
    return (l[0] + l[1]) / 2, (r[0] + r[1]) / 2
ank = leg_columns(0.07 * H)
kz = (J["knee_l"][1] + J["knee_r"][1]) / 2
kne = leg_columns(min(kz, 0.3 * H))
# only when the pose detector was rejected or unsure: a confident pose beats columns (a bow tip at ankle height is a 'column')
weak_pose = "silhouette" in LOG or P.get("score", 0) < 0.8
if weak_pose and ank and kne and ank[0] - ank[1] > 0.05 * H:
    for s, k in (("l", 0), ("r", 1)):
        J[f"ankle_{s}"] = (ank[k], J[f"ankle_{s}"][1])
        J[f"knee_{s}"] = (kne[k], J[f"knee_{s}"][1])
        J[f"hip_{s}"] = ((kne[k] + J[f"hip_{s}"][0]) / 2 if abs(J[f"hip_{s}"][0] - kne[k]) < 0.06 * H else kne[k], J[f"hip_{s}"][1])
    LOG["leg_columns"] = [round(float(v), 3) for v in (*ank, *kne)]
# sanity: joints must be vertically ordered, feet near the ground
bad = []
repaired = []
for s, sg in (("l", 1), ("r", -1)):
    # repair individual joints first (the detector often snaps knees onto the hips on armoured legs)
    if J[f"ankle_{s}"][1] > H * 0.2: J[f"ankle_{s}"] = (J[f"hip_{s}"][0], H * 0.05); repaired.append(f"ankle_{s}")
    hz, az = J[f"hip_{s}"][1], J[f"ankle_{s}"][1]
    kz = J[f"knee_{s}"][1]
    if not (az + (hz - az) * 0.25 < kz < hz - (hz - az) * 0.25):
        J[f"knee_{s}"] = ((J[f"hip_{s}"][0] + J[f"ankle_{s}"][0]) / 2, az + (hz - az) * 0.52); repaired.append(f"knee_{s}")
    ez, sz, wz = J[f"elbow_{s}"][1], J[f"shoulder_{s}"][1], J[f"wrist_{s}"][1]
    if not (wz - H * 0.05 < ez < sz + H * 0.02) or abs(J[f"elbow_{s}"][0]) < abs(J[f"shoulder_{s}"][0]) * 0.6:
        J[f"elbow_{s}"] = ((J[f"shoulder_{s}"][0] + J[f"wrist_{s}"][0]) / 2, (sz + wz) / 2); repaired.append(f"elbow_{s}")
    if not (J[f"ankle_{s}"][1] < J[f"knee_{s}"][1] < J[f"hip_{s}"][1] < J[f"shoulder_{s}"][1]): bad.append(f"leg order {s}")
LOG["repaired"] = repaired
if bad:
    LOG["fallback"] = bad
    for s, sg in (("l", 1), ("r", -1)):
        J[f"hip_{s}"] = (sg * leg_x, hip_z); J[f"knee_{s}"] = (sg * leg_x, H * 0.27); J[f"ankle_{s}"] = (sg * leg_x, H * 0.05)
LOG["method"] = "silhouette" if "silhouette" in LOG else "pose" if not bad else "pose+heuristic"
LOG["pose_score"] = round(P.get("score", 0), 3)

def V(x, z, y=None): return Vector((x, depth(x, z) if y is None else y, z))
hipL, hipR = V(*J["hip_l"]), V(*J["hip_r"])
pelvis = (hipL + hipR) / 2; pelvis.z = (hipL.z + hipR.z) / 2 + H * 0.02
shL, shR = V(*J["shoulder_l"]), V(*J["shoulder_r"])
neck = (shL + shR) / 2; neck.z = max(shL.z, shR.z) + H * 0.02
chest = pelvis.lerp(neck, 0.55)
spine = pelvis.lerp(neck, 0.22)
# the head bone spans the skull, not crowns / horns / hair piled above it
head_top = Vector((neck.x, neck.y, min(H, J["nose"][1] + 0.1 * H) if J["nose"][1] > neck.z else H))
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
LOG["joints"] = {k: [round(float(v), 3) for v in J[k]] for k in J}

# ---------------------------------------------------------------- secondary-motion chains (hair, coat tails, skirts)
# Geodesic analysis: which bone does each vertex "hang from"? Hair below the neck that hangs from the head, and cloth
# below the hips that hangs from the hips/spine (not the legs) get their own 2-segment spring chains.
def geodesic(bnames, bdict):
    tmpn = os.path.abspath(a.out)[:-4] + "_g"
    faces = np.array([list(p.vertices)[:3] for p in obj.data.polygons], dtype=np.int64)
    np.savez(tmpn + "_in.npz", verts=verts(), faces=faces,
             bones_a=np.array([list(bdict[n][0]) for n in bnames], dtype=np.float32), bones_b=np.array([list(bdict[n][1]) for n in bnames], dtype=np.float32))
    r = subprocess.run([a.python, os.path.join(HERE, "weights.py"), tmpn + "_in.npz", tmpn + "_out.npz"], capture_output=True, text=True)
    out = None
    if "WEIGHTS_OK" in r.stdout:
        with np.load(tmpn + "_out.npz") as res: out = {k: res[k] for k in res.files}
    for f in (tmpn + "_in.npz", tmpn + "_out.npz"):
        if os.path.exists(f): os.remove(f)
    return out
chains = []
if not a.static and not a.mech:
    names0 = [n for n in bones if n != "root"]
    g = geodesic(names0, bones)
    if g is not None:
        near = g["nearest"]
        idx_of = {n: i for i, n in enumerate(names0)}
        co = verts()
        def chain(prefix, mask, parent, min_verts=120):
            if mask.sum() < min_verts: return
            P = co[mask]
            ztop, zbot = np.percentile(P[:, 2], 92), np.percentile(P[:, 2], 3)
            if ztop - zbot < H * 0.1: return
            top = P[P[:, 2] >= ztop].mean(0); bot = P[P[:, 2] <= np.percentile(P[:, 2], 8)].mean(0)
            mid = P[(P[:, 2] > (ztop + zbot) / 2 - H * 0.03) & (P[:, 2] < (ztop + zbot) / 2 + H * 0.03)]
            midp = mid.mean(0) if len(mid) else (top + bot) / 2
            bones[f"{prefix}_1"] = (Vector(top), Vector(midp), parent)
            bones[f"{prefix}_2"] = (Vector(midp), Vector(bot), f"{prefix}_1")
            tipdir = (Vector(bot) - Vector(midp)).normalized()
            bones[f"{prefix}_3"] = (Vector(bot), Vector(bot) + tipdir * H * 0.02, f"{prefix}_2")   # non-deforming tip marker
            chains.append(prefix)
        neck_z = bones["neck"][0].z; hz = bones["hips"][0].z; hy = bones["hips"][0].y
        sx = abs(bones["shoulder_L"][1].x); chest = bones["chest"][0]
        # distance of every vertex (in the ground plane) from the nearest leg bone line
        def seg_d(A, B):
            A = np.array(A); B = np.array(B); AB = B - A
            t = np.clip(((co - A) @ AB) / max(1e-9, AB @ AB), 0, 1)
            P = A + t[:, None] * AB
            return np.hypot(co[:, 0] - P[:, 0], co[:, 1] - P[:, 1])
        legd = np.min(np.stack([seg_d(bones[f"{b}_{s}"][0], bones[f"{b}_{s}"][1]) for b in ("thigh", "shin") for s in ("L", "R")]), 0)
        leg_r = H * (0.12 if a.mech else 0.075)
        def seg3(A, B):
            A = np.array(A); B = np.array(B); AB = B - A
            t = np.clip(((co - A) @ AB) / max(1e-9, AB @ AB), 0, 1)
            return np.linalg.norm(co - (A + t[:, None] * AB), axis=1)
        armd = np.min(np.stack([seg3(bones[f"{b}_{s}"][0], bones[f"{b}_{s}"][1]) for b in ("forearm", "hand") for s in ("L", "R")]), 0)
        # coat tails / skirts / gowns: below the hips, outside both legs, away from the hanging hands and weapons
        cloth = (co[:, 2] < hz - H * 0.07) & (co[:, 2] > H * 0.06) & (legd > leg_r) & (armd > H * 0.12)
        chain("skirt_B", cloth & (co[:, 1] > hy + H * 0.01), "hips")      # behind (the model faces -Y)
        chain("skirt_F", cloth & (co[:, 1] < hy - H * 0.03), "hips")
        # capes / long coats hanging behind the torso
        back_plane = float(np.percentile(co[(co[:, 2] > hz) & (co[:, 2] < chest.z) & (np.abs(co[:, 0]) < sx * 0.5), 1], 80)) if len(co) else chest.y
        cape = (co[:, 1] > back_plane + H * 0.02) & (co[:, 2] < neck_z - H * 0.05) & (co[:, 2] > hz - H * 0.25) & (np.abs(co[:, 0]) < sx * 1.1)
        if cape.sum() > 150: chain("hair_B", cape, "chest")
        else:
            # long hair: mass behind the head that hangs below the neck
            head = bones["head"][0]
            hair = (co[:, 1] > head.y + H * 0.03) & (co[:, 2] < neck_z) & (co[:, 2] > hz) & (np.abs(co[:, 0]) < sx * 1.2)
            chain("hair_B", hair, "head")
LOG["chains"] = chains

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
    if b.name == "root" or b.name.endswith("_3"): b.use_deform = False

# ---------------------------------------------------------------- weights: bone heat on a watertight proxy, transferred to the mesh
def zero_weight_fraction(o):
    zero = 0
    for v in o.data.vertices:
        if sum(g.weight for g in v.groups) < 1e-4: zero += 1
    return zero / max(1, len(o.data.vertices))

def heat_on(o):
    for g in list(o.vertex_groups): o.vertex_groups.remove(g)
    bpy.ops.object.select_all(action="DESELECT"); o.select_set(True); arm.select_set(True); bpy.context.view_layer.objects.active = arm
    try: bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    except Exception as e: LOG["heat_error"] = str(e)[:200]; return 1.0
    return zero_weight_fraction(o)

# 1) bone heat straight on a copy of the mesh (works for most TRELLIS meshes)
bpy.ops.object.select_all(action="DESELECT"); obj.select_set(True); bpy.context.view_layer.objects.active = obj
bpy.ops.object.duplicate(); proxy = bpy.context.view_layer.objects.active; proxy.name = "proxy"
for m in list(proxy.modifiers): proxy.modifiers.remove(m)
method = "heat"
zf = 1.0 if a.geodesic else heat_on(proxy)
deform_names = [n for n in bones if n != "root" and not n.endswith("_3")]
for g in list(obj.vertex_groups): obj.vertex_groups.remove(g)
for n in deform_names: obj.vertex_groups.new(name=n)
if zf <= 0.03:
    # transfer heat weights to the real mesh (same topology, so this is exact)
    bpy.ops.object.select_all(action="DESELECT"); obj.select_set(True); bpy.context.view_layer.objects.active = obj
    dt = obj.modifiers.new("dt", "DATA_TRANSFER"); dt.object = proxy; dt.use_vert_data = True
    dt.data_types_verts = {"VGROUP_WEIGHTS"}; dt.vert_mapping = "TOPOLOGY"
    dt.layers_vgroup_select_src = "ALL"; dt.layers_vgroup_select_dst = "NAME"
    bpy.ops.object.modifier_apply(modifier="dt")
else:
    # 2) geodesic voxel weights (weights.py, system python) - robust on open / self-intersecting meshes
    method = "geodesic"
    tmpn = os.path.abspath(a.out)[:-4] + "_w"
    faces = np.array([list(p.vertices)[:3] for p in obj.data.polygons], dtype=np.int64)
    np.savez(tmpn + "_in.npz", verts=verts(), faces=faces,
             bones_a=np.array([list(bones[n][0]) for n in deform_names], dtype=np.float32), bones_b=np.array([list(bones[n][1]) for n in deform_names], dtype=np.float32))
    r = subprocess.run([a.python, os.path.join(HERE, "weights.py"), tmpn + "_in.npz", tmpn + "_out.npz"], capture_output=True, text=True)
    if "WEIGHTS_OK" not in r.stdout:
        LOG["geodesic_error"] = (r.stdout + r.stderr)[-400:]
        method = "envelope"
        for g in list(proxy.vertex_groups): proxy.vertex_groups.remove(g)
        bpy.ops.object.select_all(action="DESELECT"); proxy.select_set(True); arm.select_set(True); bpy.context.view_layer.objects.active = arm
        bpy.ops.object.parent_set(type="ARMATURE_ENVELOPE")
        bpy.ops.object.select_all(action="DESELECT"); obj.select_set(True); bpy.context.view_layer.objects.active = obj
        dt = obj.modifiers.new("dt", "DATA_TRANSFER"); dt.object = proxy; dt.use_vert_data = True
        dt.data_types_verts = {"VGROUP_WEIGHTS"}; dt.vert_mapping = "TOPOLOGY"
        dt.layers_vgroup_select_src = "ALL"; dt.layers_vgroup_select_dst = "NAME"
        bpy.ops.object.modifier_apply(modifier="dt")
    else:
        with np.load(tmpn + "_out.npz") as res: Wg = res["w"]
        for bi, n in enumerate(deform_names):
            vg = obj.vertex_groups[n]; col = Wg[:, bi]; nz = np.where(col > 1e-3)[0]
            q = np.round(col[nz] * 50) / 50
            for val in np.unique(q):
                if val > 0: vg.add(nz[q == val].tolist(), float(val), "REPLACE")
    for f in (tmpn + "_in.npz", tmpn + "_out.npz"):
        if os.path.exists(f): os.remove(f)
LOG["weights"] = method; LOG["zero_frac"] = round(zf, 3)
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
# ---- loose islands (armour plates, ribbons, accessories) move rigidly with their dominant bones - no tearing
fa = np.array([list(p.vertices)[:3] for p in obj.data.polygons], dtype=np.int64)
parent = np.arange(len(co))
def find(i):
    r = i
    while parent[r] != r: r = parent[r]
    while parent[i] != r: parent[i], i = r, parent[i]
    return r
for f0, f1, f2 in fa:
    for u, v in ((f0, f1), (f1, f2)):
        ru, rv = find(u), find(v)
        if ru != rv: parent[ru] = rv
roots = np.array([find(i) for i in range(len(co))])
uniq, inv, counts = np.unique(roots, return_inverse=True, return_counts=True)
rigid = 0
for k, cnt in enumerate(counts):
    if cnt >= 0.15 * len(co) or cnt < 3: continue
    m = inv == k
    avg = Wt[m].mean(0)
    # held items (swords, bows, staffs, orbs): anything within reach of a hand is carried by that hand -
    # except leg / hip armour (shells beside a mech's fists, holstered scabbards): pieces that follow the legs or
    # hips and never rise above the pelvis stay on the body, or the idle arm pose rips them off ("double legs")
    lower_body = names[int(np.argmax(avg))].split("_")[0] in ("thigh", "shin", "foot", "hips")
    armour = lower_body and float(co[m, 2].max()) < bones["hips"][0].z + H * 0.05
    held = None
    for s in ("L", "R") if not armour else ():
        hn = f"hand_{s}"
        if hn not in gi: continue
        A, B = np.array(bones[hn][0]), np.array(bones[hn][1])
        AB = B - A; P = co[m]
        t = np.clip(((P - A) @ AB) / max(1e-9, AB @ AB), 0, 1)
        dmin = float(np.min(np.linalg.norm(P - (A + t[:, None] * AB), axis=1)))
        if dmin < H * 0.07 and (held is None or dmin < held[1]): held = (gi[hn], dmin)
    if held is not None:
        w2 = np.zeros(Wt.shape[1], dtype=Wt.dtype); w2[held[0]] = 1
        Wt[m] = w2; rigid += 1; continue
    top2 = np.argsort(-avg)[:2]
    w2 = np.zeros_like(avg); w2[top2] = avg[top2]; w2 /= max(w2.sum(), 1e-6)
    Wt[m] = w2; rigid += 1
LOG["rigid_islands"] = rigid
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
# smooth weight transitions on the body (removes single-vertex spikes), keep 4 influences, renormalise
bpy.ops.object.select_all(action="DESELECT"); obj.select_set(True); bpy.context.view_layer.objects.active = obj
try:
    bpy.ops.object.mode_set(mode="WEIGHT_PAINT")
    bpy.ops.object.vertex_group_smooth(group_select_mode="ALL", factor=0.5, repeat=2)
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    LOG["smoothed"] = True
except Exception as e:
    LOG["smooth_error"] = str(e)[:120]
    try: bpy.ops.object.mode_set(mode="OBJECT")
    except Exception: pass
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
