# blender -b -P assetgen/blender/decimate_prop.py -- <in.glb> <out.glb> <target_tris>
# Collapse-decimate a generated prop to a triangle budget. TRELLIS meshes are split at every UV seam, which stops
# gltf-transform's meshopt simplifier cold; Blender's collapse decimator works across the seams and keeps the UVs.
import bpy, bmesh, sys

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst, target = argv[0], argv[1], int(argv[2])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
tris = lambda o: sum(len(p.vertices) - 2 for p in o.data.polygons)
total = sum(tris(o) for o in meshes)
before = total
for o in meshes:
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True); bpy.context.view_layer.objects.active = o
    # merge the seam-split duplicates first (UVs stay per-loop), then collapse to this mesh's share of the budget
    bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=2e-4); bpy.ops.object.mode_set(mode="OBJECT")
    # loose fragments: islands under 1% of the faces (floating shards from the reconstruction, and they stall the collapse)
    bm = bmesh.new(); bm.from_mesh(o.data); bm.faces.ensure_lookup_table()
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
        if len(isl) < 0.01 * len(bm.faces): small.extend(isl)
    bmesh.ops.delete(bm, geom=small, context="FACES")
    bm.to_mesh(o.data); bm.free()
    print("ISLANDS removed faces", len(small))
    ratio = min(1.0, target * tris(o) / max(1, total) / max(1, tris(o)))
    if ratio < 1.0:
        m = o.modifiers.new("dec", "DECIMATE"); m.decimate_type = "COLLAPSE"; m.ratio = ratio; m.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=m.name)
after = sum(tris(o) for o in meshes)
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB")
print(f"DECIMATED {before} -> {after}")
