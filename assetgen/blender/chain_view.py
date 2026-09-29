"""Front + side views of rigged heroes, textured and with the dynamic-chain weights painted (red = hair, green = skirt
panels, blue = cape, yellow = sleeves), to check which models carry cloth or long hair and that every chain grabbed the right vertices.

    blender -b -P chain_view.py -- --out sheet_dir id1 id2 ...      (reads out/rigged_tripo/<id>.glb)
Writes <out>/<id>_tex.png and <out>/<id>_chains.png (front | side, 512 px tall each).
"""
import sys
from pathlib import Path
import bpy
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
out = Path(argv[argv.index('--out') + 1]); ids = [a for i, a in enumerate(argv) if a not in ('--out', '--src') and (i == 0 or argv[i - 1] not in ('--out', '--src'))]
out.mkdir(parents=True, exist_ok=True)
ROOT = Path(argv[argv.index('--src') + 1]) if '--src' in argv else Path(__file__).resolve().parents[1] / 'out' / 'rigged_tripo'


def render(path, cam_loc, cam_rot, scale, color_type):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'FLAT' if color_type == 'VERTEX' else 'STUDIO'
    sc.display.shading.color_type = color_type
    sc.render.resolution_x, sc.render.resolution_y = 384, 512
    sc.render.film_transparent = False
    sc.world = sc.world or bpy.data.worlds.new('w')
    cam = bpy.data.objects.get('cam') or bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    if cam.name not in sc.collection.objects: sc.collection.objects.link(cam)
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = scale
    cam.location = cam_loc; cam.rotation_euler = cam_rot
    sc.camera = cam
    sc.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


for aid in ids:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(ROOT / f'{aid}.glb'))
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    zs = [(o.matrix_world @ Vector(c)).z for o in meshes for c in o.bound_box]
    H = max(zs) - min(zs); zc = (max(zs) + min(zs)) / 2
    for o in meshes:
        me = o.data
        n = len(me.vertices)
        col = np.zeros((n, 3))
        kind = {g.index: (1, 0.1, 0.1) if g.name.startswith('hair') else (0.1, 1, 0.2) if g.name.startswith('skirt')
                else (0.2, 0.4, 1) if g.name.startswith('cape') else (1, 0.85, 0) if g.name.startswith('sleeve') else None for g in o.vertex_groups}
        for v in me.vertices:
            for ge in v.groups:
                rgb = kind.get(ge.group)
                if rgb: col[v.index] += np.array(rgb) * ge.weight
        base = np.full((n, 3), 0.8)
        w = np.clip(col.max(1, keepdims=True), 0, 1)
        c = base * (1 - w) + np.clip(col, 0, 1) * w
        attr = me.color_attributes.new('chainw', 'FLOAT_COLOR', 'POINT')
        attr.data.foreach_set('color', np.concatenate([c, np.ones((n, 1))], 1).ravel().astype(np.float32))
        me.color_attributes.active_color = attr
    for kind, ct in (('tex', 'TEXTURE'), ('chains', 'VERTEX')):
        render(out / f'{aid}_{kind}_f.png', (0, -10, zc), (1.5708, 0, 0), H * 1.08, ct)
        render(out / f'{aid}_{kind}_s.png', (10, 0, zc), (1.5708, 0, 1.5708), H * 1.08, ct)
        if kind == 'chains': render(out / f'{aid}_{kind}_b.png', (0, 10, zc), (1.5708, 0, 3.14159), H * 1.08, ct)
    print('VIEW_DONE', aid, flush=True)
