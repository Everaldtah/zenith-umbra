"""Blender: orthographic front render of a GLB (front = -Y after import) + camera JSON for pixel <-> world mapping.
blender -b -P front_render.py -- in.glb out.png  -> prints FRONT_CAM {"cx","cz","size","res"} (world x = cx + (u-.5)*size, z = cz + (.5-v)*size)"""
import bpy, sys, math, json, mathutils
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=argv[0])
sc = bpy.context.scene
pts = [o.matrix_world @ mathutils.Vector(c) for o in sc.objects if o.type == 'MESH' for c in o.bound_box]
mn = mathutils.Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
mx = mathutils.Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
c = (mn + mx) / 2; size = max(mx.x - mn.x, mx.z - mn.z) * 1.05; res = 1024
cam = bpy.data.objects.new("C", bpy.data.cameras.new("C")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = "ORTHO"; cam.data.ortho_scale = size
cam.location = (c.x, mn.y - 10, c.z); cam.rotation_euler = (math.pi / 2, 0, 0)
sc.render.engine = "BLENDER_WORKBENCH"; sc.display.shading.light = "FLAT"; sc.display.shading.color_type = "TEXTURE"
sc.render.resolution_x = sc.render.resolution_y = res
w = bpy.data.worlds.new("W"); sc.world = w; w.color = (1, 1, 1)
try: sc.view_settings.view_transform = "Standard"
except Exception: pass
sc.render.filepath = argv[1]; bpy.ops.render.render(write_still=True)
print("FRONT_CAM " + json.dumps({"cx": c.x, "cz": c.z, "size": size, "res": res}))
