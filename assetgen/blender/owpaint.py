"""Blender (Cycles): the hand-painted hero-shooter finish, baked into a hero's base-colour texture.

Stylized team shooters paint form into the albedo instead of relying on lighting alone: soft occlusion in folds and
under overlaps, bright painted edge highlights on every convex bevel (big readable bevels are the look), and a gentle
value gradient from light at the head to darker at the feet so the eye goes to the face. All three are baked from the
model's own geometry and composited onto its texture (same UVs), so the look survives any in-game lighting.

  blender -b -P owpaint.py -- in.glb out.glb [--ao 0.3] [--edge 0.22] [--grad 0.12] [--res 2048] [--debug prefix]
"""
import bpy, sys, os, argparse
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:]
ap = argparse.ArgumentParser()
ap.add_argument("inp"); ap.add_argument("out")
ap.add_argument("--ao", type=float, default=0.3, help="occlusion strength (0 = none)")
ap.add_argument("--edge", type=float, default=0.22, help="edge highlight strength")
ap.add_argument("--grad", type=float, default=0.12, help="head-to-toe value gradient")
ap.add_argument("--res", type=int, default=2048, help="bake resolution (composited at the texture's own size)")
ap.add_argument("--debug", default="")
a = ap.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(a.inp))
sc = bpy.context.scene
objs = [o for o in sc.objects if o.type == "MESH" and o.name != "Icosphere"]
obj = max(objs, key=lambda o: len(o.data.vertices))
mat = obj.active_material
nt = mat.node_tree
bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
link = bsdf.inputs["Base Color"].links[0] if bsdf.inputs["Base Color"].links else None
tex_node = link.from_node if link and link.from_node.type == "TEX_IMAGE" else next(n for n in nt.nodes if n.type == "TEX_IMAGE")
base_img = tex_node.image
W, H = base_img.size
print("OWPAINT base", base_img.name, W, H, "tris", len(obj.data.polygons))

sc.render.engine = "CYCLES"
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for dt in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = dt; prefs.get_devices()
            if any(d.type == dt for d in prefs.devices):
                for d in prefs.devices: d.use = d.type == dt
                sc.cycles.device = "GPU"; print("OWPAINT device", dt); break
        except Exception: pass
except Exception as e: print("OWPAINT cpu", e)
sc.cycles.samples = 48
sc.render.bake.margin = 8
bpy.context.view_layer.objects.active = obj
for o in sc.objects: o.select_set(o == obj)

# a bake target node, active in the material (Cycles bakes into the active image node)
def bake(kind, setup=None, name="bake"):
    img = bpy.data.images.new(name, a.res, a.res, float_buffer=True)
    n = nt.nodes.new("ShaderNodeTexImage"); n.image = img
    for x in nt.nodes: x.select = False
    n.select = True; nt.nodes.active = n
    restore = setup() if setup else None
    bpy.ops.object.bake(type=kind)
    if restore: restore()
    px = np.array(img.pixels[:], dtype=np.float32).reshape(a.res, a.res, 4)
    nt.nodes.remove(n)
    return px

# ---- ambient occlusion
sc.world = sc.world or bpy.data.worlds.new("w")
ao = bake("AO", name="ao")[..., 0]
# ---- curvature (Cycles pointiness) and height, through emission
out_node = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
def emit_from(build):
    def setup():
        old = out_node.inputs["Surface"].links[0].from_socket if out_node.inputs["Surface"].links else None
        em = nt.nodes.new("ShaderNodeEmission"); src = build()
        nt.links.new(src, em.inputs["Color"]); nt.links.new(em.outputs[0], out_node.inputs["Surface"])
        def restore():
            nt.nodes.remove(em)
            if old: nt.links.new(old, out_node.inputs["Surface"])
        return restore
    return setup
def pointiness():
    g = nt.nodes.new("ShaderNodeNewGeometry"); return g.outputs["Pointiness"]
def height():
    g = nt.nodes.new("ShaderNodeNewGeometry"); sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(g.outputs["Position"], sep.inputs[0]); return sep.outputs["Z"]
curv = bake("EMIT", emit_from(pointiness), "curv")[..., 0]
zpos = bake("EMIT", emit_from(height), "zpos")[..., 0]

# ---- composite at the texture's resolution
def up(x):
    """bake resolution -> texture resolution (Blender's own image scaler; its bundled python has no PIL)"""
    img = bpy.data.images.new("tmp_up", x.shape[1], x.shape[0], float_buffer=True)
    px = np.zeros((x.shape[0], x.shape[1], 4), np.float32); px[..., 0] = x; px[..., 3] = 1
    img.pixels[:] = px.ravel()
    if (x.shape[1], x.shape[0]) != (W, H): img.scale(W, H)
    out = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)[..., 0]
    bpy.data.images.remove(img)
    return out
covered = zpos != 0
zmin, zmax = np.percentile(zpos[covered], 1), np.percentile(zpos[covered], 99)
zn = np.clip((zpos - zmin) / max(1e-6, zmax - zmin), 0, 1)
c = curv[covered]
edge = np.clip((curv - np.percentile(c, 60)) / max(1e-6, np.percentile(c, 99) - np.percentile(c, 60)), 0, 1) ** 1.5
aof = 1 - a.ao * (1 - np.clip(ao, 0, 1)) ** 1.2
gradf = 1 - a.grad * (1 - zn) ** 1.5
AO, EDGE, GRAD, COV = up(aof), up(edge), up(gradf), up(covered.astype(np.float32)) > 0.5
# Blender images are stored bottom-up, same as the bakes: work in that layout throughout
base = np.array(base_img.pixels[:], dtype=np.float32).reshape(H, W, 4)
rgb = base[..., :3]
lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4) if base_img.colorspace_settings.name == "sRGB" and not base_img.is_float else rgb
res = lin * (AO * GRAD)[..., None]
res = res * (1 + EDGE * a.edge * 2.5)[..., None]                 # painted edge highlight: the colour itself, lifted (black hair stays black)
res = np.where(COV[..., None], res, lin)
res = np.where(res <= 0.0031308, res * 12.92, 1.055 * np.power(np.clip(res, 0, None), 1 / 2.4) - 0.055) if base_img.colorspace_settings.name == "sRGB" and not base_img.is_float else res
base[..., :3] = np.clip(res, 0, 1)
new = bpy.data.images.new(base_img.name + "_ow", W, H, alpha=True)
new.pixels[:] = base.ravel()
new.file_format = "PNG"
tex_node.image = new
if a.debug:
    for nm, arr in (("ao", AO), ("edge", EDGE), ("grad", GRAD)):
        d = bpy.data.images.new(nm, W, H); px = np.ones((H, W, 4), np.float32); px[..., :3] = np.clip(arr, 0, 1)[..., None]
        d.pixels[:] = px.ravel(); d.filepath_raw = os.path.abspath(f"{a.debug}_{nm}.png"); d.file_format = "PNG"; d.save()
# export (keep what was there: skin, armature if any)
for o in sc.objects: o.select_set(True)
os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=os.path.abspath(a.out), export_format="GLB", use_selection=False, export_yup=True,
                          export_skins=True, export_animations=False, export_apply=False, export_image_format="AUTO")
print("OWPAINT_DONE", a.out)
