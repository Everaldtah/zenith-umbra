"""Find a rigged hero's painted eyes for the runtime blink: front render of the head -> MediaPipe face landmarks
(eyes_detect.py) -> raycast onto the mesh -> eye centre / size / facing plus the lid (skin) and lash colours sampled
from the render. Prints EYES_DONE {json} with positions in the exported model's (three.js, Y-up) space.

    blender -b -P eyes.py -- --glb rigged.glb --python <python with mediapipe> [--png head.png]
"""
import bpy, sys, os, json, subprocess, math
import numpy as np
from mathutils import Vector
import argparse

argv = sys.argv[sys.argv.index("--") + 1:]
ap = argparse.ArgumentParser(); ap.add_argument("--glb", required=True); ap.add_argument("--python", default="python"); ap.add_argument("--png", default="")
a = ap.parse_args(argv)
HERE = os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=os.path.abspath(a.glb))
arm = next(o for o in scene.objects if o.type == "ARMATURE")
body = next(o for o in scene.objects if o.type == "MESH")
hb = arm.data.bones.get("head"); nb = arm.data.bones.get("neck")
if hb is None: print("EYES_DONE", json.dumps({"ok": False, "why": "no head bone"})); raise SystemExit
head = arm.matrix_world @ hb.head_local
neck_z = (arm.matrix_world @ nb.head_local).z if nb else head.z - 0.1
co = np.array([(body.matrix_world @ v.co)[:] for v in body.data.vertices])
Hm = co[:, 2].max() - co[:, 2].min()
hv = co[(co[:, 2] > neck_z) & (np.abs(co[:, 0] - head.x) < Hm * 0.12)]
if len(hv) < 50: print("EYES_DONE", json.dumps({"ok": False, "why": "no head verts"})); raise SystemExit
z0, z1 = neck_z, float(np.percentile(hv[:, 2], 99.5))
cx, cz = head.x, (z0 + z1) / 2
size = max(z1 - z0, float(np.percentile(hv[:, 0], 99) - np.percentile(hv[:, 0], 1))) * 1.15

cam_data = bpy.data.cameras.new("cam"); cam_data.type = "ORTHO"; cam_data.ortho_scale = size
cam = bpy.data.objects.new("cam", cam_data); scene.collection.objects.link(cam)
cam.location = (cx, co[:, 1].min() - 5.0, cz); cam.rotation_euler = (math.pi / 2, 0, 0)
cam_data.clip_end = 50
scene.camera = cam
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "FLAT"; scene.display.shading.color_type = "TEXTURE"
scene.render.resolution_x = scene.render.resolution_y = 640
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new("w") if not scene.world else scene.world
scene.view_settings.view_transform = "Standard"
png = a.png or os.path.splitext(os.path.abspath(a.glb))[0] + "_head.png"
scene.render.filepath = png
bpy.ops.render.render(write_still=True)

r = subprocess.run([a.python, os.path.join(HERE, "eyes_detect.py"), png], capture_output=True, text=True)
line = next((l for l in r.stdout.splitlines() if l.startswith("{")), None)
det = json.loads(line) if line else {"ok": False}
if not det.get("ok"):
    print("EYES_DONE", json.dumps({"ok": False, "why": "no face found", "err": r.stderr[-300:]})); raise SystemExit

bim = bpy.data.images.load(png)
N = bim.size[1]
img = np.array(bim.pixels[:], dtype=np.float32).reshape(bim.size[1], bim.size[0], 4)[::-1, :, :3]   # rows top-down
def to_xz(u, v): return cx + (u - 0.5) * size, cz + (0.5 - v) * size
def px(u, v):
    i, j = int(np.clip(v * N, 0, N - 1)), int(np.clip(u * N, 0, N - 1))
    return img[max(0, i - 1):i + 2, max(0, j - 1):j + 2].reshape(-1, 3).mean(0)
dg = bpy.context.evaluated_depsgraph_get()
eyes = []
for e in det["eyes"]:
    cu = (e["inner"][0] + e["outer"][0] + e["top"][0] + e["bottom"][0]) / 4
    cv = (e["inner"][1] + e["outer"][1] + e["top"][1] + e["bottom"][1]) / 4
    w = abs(e["outer"][0] - e["inner"][0]) * size
    h = max(abs(e["bottom"][1] - e["top"][1]) * size, w * 0.35)
    x, z = to_xz(cu, cv)
    hit, loc, nrm, *_ = scene.ray_cast(dg, Vector((x, co[:, 1].min() - 5.0, z)), Vector((0, 1, 0)))
    if not hit: continue
    # lid colour: skin just below the lower lid; lash colour: the darkest pixels along the upper lid
    eh = abs(e["bottom"][1] - e["top"][1])
    skin = px(cu, e["bottom"][1] + max(eh, 0.01) * 0.9)
    us = np.linspace(e["inner"][0], e["outer"][0], 9)
    vs = np.linspace(e["inner"][1], e["outer"][1], 9) - 0.0
    lash = min((px(u, min(v, e["top"][1])) for u, v in zip(us, vs)), key=lambda c: c.sum())
    to3 = lambda p: [round(float(p[0]), 5), round(float(p[2]), 5), round(float(-p[1]), 5)]   # Blender Z-up -> glTF Y-up
    eyes.append({"p": to3(loc), "n": to3(nrm), "w": round(w, 5), "h": round(h, 5),
                 "skin": [round(float(c), 3) for c in skin], "lash": [round(float(c), 3) for c in lash]})
print("EYES_DONE", json.dumps({"ok": len(eyes) == 2, "eyes": eyes, "png": png}))
