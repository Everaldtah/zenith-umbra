# blender -b -P assetgen/blender/rig_dragon.py -- --glb in.glb --out out.glb [--length 10] [--bones 28] [--tris 16000] [--head auto|+x|-x|+y|-y]
# Rig a Tripo spirit koi-dragon (a long serpent modelled stretched out side-on) for the Koryu ultimates.
# The mesh is cleaned and decimated, laid along the spine axis (head toward three.js +Z, up +Y), straightened (the
# gentle S of the concept pose is taken out so the rest spine is a straight line), scaled to --length metres, and
# skinned to a chain of --bones spine joints with smooth two-bone weights along its length. The joints are all
# children of the armature (a flat chain), so the game places each one directly on the path the head has swum
# (SpiritDragon.ts) - the body follows the head like water through a pipe, the way Hanzo's and Genji's dragons move.
import bpy, bmesh, sys, json
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
def arg(k, d=None):
    return argv[argv.index(k) + 1] if k in argv else d
SRC, DST = arg("--glb"), arg("--out")
LENGTH, NB, TRIS, HEAD = float(arg("--length", 10)), int(arg("--bones", 28)), int(arg("--tris", 16000)), arg("--head", "auto")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
for o in meshes:
    mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
bpy.ops.object.select_all(action="DESELECT")
for o in meshes: o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1: bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.context.scene.objects):
    if o is not ob: bpy.data.objects.remove(o, do_unlink=True)

# ---- clean: weld seam splits, drop floating shards, collapse to the budget
bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.remove_doubles(threshold=2e-4); bpy.ops.object.mode_set(mode="OBJECT")
bm = bmesh.new(); bm.from_mesh(ob.data); bm.faces.ensure_lookup_table()
seen, small = set(), []
for f in bm.faces:
    if f.index in seen: continue
    stack, isl = [f], []
    seen.add(f.index)
    while stack:
        x = stack.pop(); isl.append(x)
        for e in x.edges:
            for y in e.link_faces:
                if y.index not in seen: seen.add(y.index); stack.append(y)
    if len(isl) < 0.004 * len(bm.faces): small.extend(isl)
bmesh.ops.delete(bm, geom=small, context="FACES")
bm.to_mesh(ob.data); bm.free()
ntri = sum(len(p.vertices) - 2 for p in ob.data.polygons)
if ntri > TRIS:
    m = ob.modifiers.new("dec", "DECIMATE"); m.decimate_type = "COLLAPSE"; m.ratio = TRIS / ntri; m.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=m.name)

# ---- spine axis: the longest horizontal extent (Blender Z is up)
vs = [v.co.copy() for v in ob.data.vertices]
lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
ext = hi - lo
ax = 0 if ext.x >= ext.y else 1                     # long axis index (x or y)
dp = 1 - ax                                          # the other horizontal axis: body depth
def slab_depth(t0, t1):
    a = lo[ax] + ext[ax] * t0; b = lo[ax] + ext[ax] * t1
    s = [v[dp] for v in vs if a <= v[ax] <= b]
    return (max(s) - min(s)) if s else 0.0
# the head end is the chunky one: the koi fan tail is a flat veil (thin in depth), the head is a skull with whiskers
d_lo, d_hi = slab_depth(0.0, 0.14), slab_depth(0.86, 1.0)
if HEAD == "auto": head_sign = -1 if d_lo >= d_hi else 1
else: head_sign = 1 if HEAD[0] == "+" else -1
if HEAD != "auto": ax = "xy".index(HEAD[1]); dp = 1 - ax
print("AXIS", "xy"[ax], "depth lo/hi %.3f/%.3f" % (d_lo, d_hi), "head", "+-"[head_sign < 0] + "xy"[ax])

# ---- lay the dragon along -Y (glTF/three.js +Z) with the head at -Y, centred, LENGTH long
c = (lo + hi) / 2
s = LENGTH / ext[ax]
for v in ob.data.vertices:
    p = v.co - c
    along = p[ax] * head_sign                        # +: toward the head
    side = p[dp] * (1 if ax == 0 else -1) * head_sign
    v.co = Vector((side * s, -along * s, p.z * s))

# ---- straighten: subtract the smoothed centreline (x, z) at each station so the rest spine is the Y axis
NS = 64
vs = [v.co for v in ob.data.vertices]
cx, cz, cn = [0.0] * NS, [0.0] * NS, [0] * NS
st = lambda y: min(NS - 1, max(0, int((y + LENGTH / 2) / LENGTH * NS)))
for v in vs:
    i = st(v.y); cx[i] += v.x; cz[i] += v.z; cn[i] += 1
cen = [(cx[i] / cn[i], cz[i] / cn[i]) if cn[i] else None for i in range(NS)]
for i in range(NS):                                   # fill empty stations from neighbours
    if cen[i] is None:
        j = next((k for k in range(1, NS) if (i - k >= 0 and cen[i - k]) or (i + k < NS and cen[i + k])), 1)
        cen[i] = cen[i - j] if i - j >= 0 and cen[i - j] else cen[i + j]
sm = []
for i in range(NS):                                   # moving average: follow the S of the body, not the fins
    w = [cen[k] for k in range(max(0, i - 4), min(NS, i + 5))]
    sm.append((sum(a for a, _ in w) / len(w), sum(b for _, b in w) / len(w)))
def cen_at(y):
    f = (y + LENGTH / 2) / LENGTH * NS - 0.5
    i = int(max(0, min(NS - 2, f // 1))); t = max(0.0, min(1.0, f - i))
    return (sm[i][0] * (1 - t) + sm[i + 1][0] * t, sm[i][1] * (1 - t) + sm[i + 1][1] * t)
for v in ob.data.vertices:
    ox, oz = cen_at(v.co.y); v.co.x -= ox; v.co.z -= oz
ob.data.update()

# ---- armature: NB joints on the Y axis, head (index 0) at -LENGTH/2, all children of the armature (flat chain)
arm = bpy.data.armatures.new("DragonRig"); rig = bpy.data.objects.new("DragonRig", arm)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
seg = LENGTH / (NB - 1)
ys = [-LENGTH / 2 + i * seg for i in range(NB)]
for i, y in enumerate(ys):
    b = arm.edit_bones.new("sp%02d" % i)
    b.head = Vector((0, y, 0)); b.tail = Vector((0, y - seg * 0.8, 0))   # every joint points at the head (three.js +Z)
bpy.ops.object.mode_set(mode="OBJECT")

# ---- weights: each vertex blends the two joints either side of its station (smoothstep), so bends stay round
groups = [ob.vertex_groups.new(name="sp%02d" % i) for i in range(NB)]
for v in ob.data.vertices:
    f = (v.co.y + LENGTH / 2) / seg
    i = int(max(0, min(NB - 2, f // 1))); t = max(0.0, min(1.0, f - i)); t = t * t * (3 - 2 * t)
    groups[i].add([v.index], 1 - t, "REPLACE"); groups[i + 1].add([v.index], t, "REPLACE")
ob.parent = rig
mod = ob.modifiers.new("rig", "ARMATURE"); mod.object = rig
ob.name = "Dragon"

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=DST, export_format="GLB", use_selection=True, export_skins=True, export_animations=False,
                          export_yup=True, export_apply=False)
print("RIG_DONE " + json.dumps({"tris": sum(len(p.vertices) - 2 for p in ob.data.polygons), "bones": NB, "length": LENGTH,
                                "axis": "xy"[ax], "head": head_sign, "depth_lo_hi": [round(d_lo, 3), round(d_hi, 3)]}))
