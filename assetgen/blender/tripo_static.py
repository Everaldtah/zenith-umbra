"""Tripo export (any skin state) -> a static GLB of its mesh in the true bind pose (raw vertex positions), for rig_hero.py.
blender -b -P tripo_static.py -- in.glb out.glb"""
import bpy, sys, os
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from glbskin import skinned
src, dst = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(src))
meshes = [o for o in bpy.data.objects if o.type == 'MESH' and any(m.type == 'ARMATURE' for m in o.modifiers)]
_, _, P, _, _ = skinned(src)
o = meshes[0]
for m in list(o.modifiers): o.modifiers.remove(m)
o.parent = None; o.matrix_world = o.matrix_world.Identity(4)
assert len(o.data.vertices) == len(P), (len(o.data.vertices), len(P))
o.data.vertices.foreach_set('co', np.stack([P[:, 0], -P[:, 2], P[:, 1]], 1).astype(np.float32).ravel()); o.data.update()
for v in list(o.vertex_groups): o.vertex_groups.remove(v)
for x in list(bpy.data.objects):
    if x != o: bpy.data.objects.remove(x)
bpy.ops.export_scene.gltf(filepath=os.path.abspath(dst), export_format='GLB', export_yup=True, export_skins=False, export_animations=False)
print('STATIC_DONE', len(P))
