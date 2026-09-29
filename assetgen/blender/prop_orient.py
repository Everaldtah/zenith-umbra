"""Stand a generated two-handed weapon (hammer / axe / staff) in the game's hammer frame (src/render/Hammer.ts):
the haft runs up +Y from the pommel at the origin, the head's long axis across the top on X (the striking face on +X,
the side that faced image-right in the concept keeps +X).

blender -b -P prop_orient.py -- in.glb out.glb
"""
import bpy, sys
import numpy as np
from mathutils import Matrix, Vector

src, dst = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
ms = [o for o in bpy.context.scene.objects if o.type == "MESH"]
for o in bpy.context.scene.objects: o.select_set(o in ms)
bpy.context.view_layer.objects.active = ms[0]
if len(ms) > 1: bpy.ops.object.join()
o = bpy.context.view_layer.objects.active
o.parent = None
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for x in list(bpy.context.scene.objects):
    if x != o: bpy.data.objects.remove(x)
co = np.array([v.co[:] for v in o.data.vertices])
mean = co.mean(0)
C = np.cov((co - mean).T)
w, V = np.linalg.eigh(C)
a1 = V[:, 2]                                   # the haft: the longest axis
if a1[2] < 0: a1 = -a1                         # keep it pointing roughly up (the concept stood the weapon upright)
u = (co - mean) @ a1
lo, hi = u.min(), u.max()
def radius(m):
    d = (co[m] - mean) - np.outer(u[m], a1)
    return np.percentile(np.linalg.norm(d, axis=1), 90) if m.sum() else 0
bottom, top = radius(u < lo + (hi - lo) * 0.2), radius(u > hi - (hi - lo) * 0.2)
if bottom > top: a1 = -a1; u = -u; lo, hi = -hi, -lo            # the heavy head goes up
# the head's long axis: principal direction of the top 25% projected off the haft
head = (co[u > hi - (hi - lo) * 0.25] - mean)
head_perp = head - np.outer(head @ a1, a1)
hw, hV = np.linalg.eigh(np.cov(head_perp.T))
a2 = hV[:, 2]; a2 = a2 - a1 * (a2 @ a1); a2 /= np.linalg.norm(a2)
if a2[0] < 0: a2 = -a2                         # keep image-right (+X) as the striking face
a3 = np.cross(a1, a2)
# rows: new X = a2, new Y(=Blender -Z? no) -> build Blender frame: X = a2, Z = a1 (up), Y = Z x X
R = np.array([a2, np.cross(a1, a2), a1])       # maps original -> (X, Y, Z_up)
co2 = (co - mean) @ R.T
pommel = co2[co2[:, 2] < co2[:, 2].min() + (co2[:, 2].max() - co2[:, 2].min()) * 0.05].mean(0)
co2 -= np.array([pommel[0], pommel[1], co2[:, 2].min()])
o.data.vertices.foreach_set("co", co2.astype(np.float32).ravel()); o.data.update()
L = co2[:, 2].max()
print("PROP_DONE", {"length": round(float(L), 4), "head_width": round(float(np.ptp(co2[:, 0])), 4), "tris": sum(len(p.vertices) - 2 for p in o.data.polygons)})
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_yup=True)
