"""Blender: quick art-review renders of a (raw or rigged) hero GLB - front, 3/4, back and a face close-up, soft studio
light, Eevee. blender -b -P review_render.py -- in.glb out_prefix [--face 0.88]"""
import bpy, sys, os, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
face_h = float(argv[argv.index("--face") + 1]) if "--face" in argv else 0.9
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(src))
sc = bpy.context.scene
meshes = [o for o in sc.objects if o.type == "MESH" and o.name != "Icosphere"]
pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
ctr, size = (lo + hi) / 2, hi - lo
H = size.z
engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
sc.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
sc.render.resolution_x, sc.render.resolution_y = 768, 1024
sc.view_settings.view_transform = "AgX" if "AgX" in [v.identifier for v in bpy.types.ColorManagedViewSettings.bl_rna.properties["view_transform"].enum_items] else "Filmic"
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.42, 0.45, 0.5, 1); w.node_tree.nodes["Background"].inputs[1].default_value = 0.9
def light(name, rot, energy, color=(1, 1, 1)):
    l = bpy.data.lights.new(name, "SUN"); l.energy = energy; l.color = color; l.angle = 0.3
    o = bpy.data.objects.new(name, l); sc.collection.objects.link(o); o.rotation_euler = rot
light("key", (math.radians(50), 0, math.radians(-35)), 3.2, (1, 0.96, 0.9))
light("fill", (math.radians(65), 0, math.radians(140)), 1.2, (0.8, 0.88, 1))
light("rim", (math.radians(-60), 0, math.radians(180)), 2.5, (0.9, 0.95, 1))
cam_d = bpy.data.cameras.new("cam"); cam = bpy.data.objects.new("cam", cam_d); sc.collection.objects.link(cam); sc.camera = cam
cam_d.lens = 85
# which way does the model face? TRELLIS output faces -Y after the glTF import (+Z forward in glTF)
def shoot(tag, yaw, focus, dist, height):
    d = Vector((math.sin(yaw), -math.cos(yaw), 0))
    cam.location = focus + d * dist + Vector((0, 0, height))
    cam.rotation_euler = (focus - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = os.path.abspath(f"{out}_{tag}.png"); bpy.ops.render.render(write_still=True)
full = max(H, size.x) * 1.25 / (2 * math.tan(cam_d.angle_y / 2)) if hasattr(cam_d, "angle_y") else H * 3
shoot("front", 0, ctr, full, 0)
shoot("q34", math.radians(40), ctr, full, H * 0.05)
shoot("back", math.pi, ctr, full, 0)
head = Vector((ctr.x, ctr.y, lo.z + H * face_h))
shoot("face", math.radians(15), head, H * 0.55, 0)
print("REVIEW", out, "H", round(H, 3), "tris", sum(len(o.data.polygons) for o in meshes), "meshes", len(meshes))
