"""Tenkai-Oh's first-person gauntlets, cut from his own model.

His published rig skins both whole arms to the shoulder bones (the silhouette rigger put the arm bones outside the
mech's arms), so the first-person viewmodel has no hands to pose. This cuts each forearm + gauntlet out of the mesh in
the bind pose (the arms hang at his sides: everything past |x| > XCUT between the wrist tips and the elbow) and exports
them as two rigid pieces the viewmodel mounts on the hammer's haft (src/render/FirstPerson.ts, fpGauntlets):
  origin  = the fist's grip centre (the centroid of the hand)
  +Y      = up the forearm, toward the elbow (three.js axes)
  +Z      = the grip tunnel: forward in the bind pose (the palms face in, so a haft held there runs front to back)
  scale   = the game model's height (--height, the manifest's tenkai height)

  blender -b -P assetgen/blender/fp_gauntlets.py -- --src assetgen/out/rigged_tripo/tenkai.glb \
      --out public/models/fp/tenkai_gauntlets.glb [--height 2.334] [--tex 2048]
"""
import sys, argparse
import bpy, bmesh
from mathutils import Vector, Matrix

ap = argparse.ArgumentParser()
ap.add_argument('--src', required=True); ap.add_argument('--out', required=True)
ap.add_argument('--height', type=float, default=2.334); ap.add_argument('--tex', type=int, default=2048)
# the cut, in the source's own units (Blender Z up): arms beyond |x| > XCUT, from below the claws up to the elbow
ap.add_argument('--xcut', type=float, default=0.6); ap.add_argument('--zlo', type=float, default=1.1); ap.add_argument('--zhi', type=float, default=1.92)
# hand band (grip centre) and elbow band (forearm axis), source units
ap.add_argument('--hand', default='1.2,1.36'); ap.add_argument('--elbow', default='1.78,1.92')
a = ap.parse_args(sys.argv[sys.argv.index('--') + 1:])
hand = [float(x) for x in a.hand.split(',')]; elbow = [float(x) for x in a.elbow.split(',')]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=a.src)
body = max((o for o in bpy.context.scene.objects if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
# the bind pose, unparented: no armature, world transform baked into the vertices
for m in list(body.modifiers): body.modifiers.remove(m)
mw = body.matrix_world.copy(); body.parent = None; body.matrix_world = Matrix.Identity(4)
body.data.transform(mw)
for o in [o for o in bpy.context.scene.objects if o is not body]: bpy.data.objects.remove(o, do_unlink=True)
zs = [v.co.z for v in body.data.vertices]
H = max(zs) - min(zs)
k = a.height / H
print(f'source height {H:.3f} -> scale {k:.4f}')

# shared texture: one atlas for the body; keep it but at a viewmodel-friendly size
for img in bpy.data.images:
    if img.size[0] > a.tex: img.scale(a.tex, a.tex)

def centroid(vs):
    c = Vector(); [c.__iadd__(v) for v in vs]; return c / max(1, len(vs))

pieces = []
for side, name in ((1, 'gauntlet_L'), (-1, 'gauntlet_R')):         # +X is the character's left (glTF / Blender)
    ob = body.copy(); ob.data = body.data.copy(); ob.name = name; ob.data.name = name
    bpy.context.scene.collection.objects.link(ob)
    bm = bmesh.new(); bm.from_mesh(ob.data)
    inside = lambda v: v.co.x * side > a.xcut and a.zlo <= v.co.z <= a.zhi
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not all(inside(v) for v in f.verts)], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    hv = [v.co.copy() for v in bm.verts if hand[0] <= v.co.z <= hand[1]]
    ev = [v.co.copy() for v in bm.verts if elbow[0] <= v.co.z <= elbow[1]]
    g, e = centroid(hv), centroid(ev)
    print(f'{name}: {len(bm.faces)} faces, grip {tuple(round(x, 3) for x in g)}, elbow {tuple(round(x, 3) for x in e)}')
    # grip centre to the origin, the forearm onto +Z (Blender up = three +Y), scaled to the game model
    fa = (e - g).normalized()
    R = fa.rotation_difference(Vector((0, 0, 1))).to_matrix().to_4x4()
    bm.transform(Matrix.Scale(k, 4) @ R @ Matrix.Translation(-g))
    bm.to_mesh(ob.data); bm.free()
    ob.data.update()
    pieces.append(ob)
bpy.data.objects.remove(body, do_unlink=True)

bpy.ops.object.select_all(action='DESELECT')
for ob in pieces: ob.select_set(True)
bpy.context.view_layer.objects.active = pieces[0]
import os
os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=a.out, export_format='GLB', use_selection=True, export_image_format='JPEG',
                          export_jpeg_quality=88, export_apply=True, export_yup=True, export_skins=False, export_animations=False)
print('wrote', a.out, os.path.getsize(a.out))
