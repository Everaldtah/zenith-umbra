"""Project the concept image's face onto a TRELLIS mesh texture (TRELLIS reconstructs faces soft and smeared, but the
mesh is built from exactly that front view, so a front orthographic projection lines the two up).

    python facebake.py in.glb concept.png out.glb [--debug dbg_prefix]

1. MediaPipe pose on the concept -> nose / ears -> an ellipse around the face in image space
2. mesh front = glTF +Z, up = +Y; mesh bbox <-> concept foreground bbox (rembg alpha) gives the image<->mesh mapping
3. triangles inside the ellipse that face the camera and are the front-most surface (z-buffer) get their texels
   re-painted from the concept by per-triangle affine warps, feathered toward the ellipse edge
"""
import argparse, json, subprocess, sys, os
import numpy as np
import cv2
import trimesh
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument('glb'); ap.add_argument('concept'); ap.add_argument('out')
ap.add_argument('--debug', default='')
ap.add_argument('--scale', type=float, default=1.0, help='face ellipse size multiplier')
a = ap.parse_args()

# ---- face location in the concept
pose = json.loads(subprocess.run([sys.executable, os.path.join(HERE, 'blender', 'pose.py'), a.concept], capture_output=True, text=True).stdout.strip().splitlines()[-1])
pts = pose['pts']
nose, el, er = np.array(pts['nose'][:2]), np.array(pts['ear_l'][:2]), np.array(pts['ear_r'][:2])
ear_d = float(np.linalg.norm(el - er))
concept = Image.open(a.concept).convert('RGB')
CW, CH = concept.size
cx, cy = nose[0] * CW, (nose[1] - 0.15 * ear_d) * CH
rx, ry = 0.62 * ear_d * CW * a.scale, 0.95 * ear_d * CH * a.scale
print('face ellipse px', round(cx), round(cy), round(rx), round(ry))

# ---- concept foreground bbox
from rembg import remove, new_session
alpha = np.asarray(remove(concept, session=new_session('isnet-general-use')).split()[-1]) > 40
ys, xs = np.where(alpha)
bx0, bx1, by0, by1 = xs.min(), xs.max(), ys.min(), ys.max()

# ---- mesh
scene = trimesh.load(a.glb, force='scene')
geoms = list(scene.geometry.items())
assert geoms, 'no geometry'
name, mesh = max(geoms, key=lambda kv: len(kv[1].vertices))
T = scene.graph.get(name)[0] if name in scene.graph.nodes else np.eye(4)
V = trimesh.transform_points(mesh.vertices, scene.graph[scene.graph.nodes_geometry[0]][0]) if scene.graph.nodes_geometry else mesh.vertices
F = mesh.faces
uv = mesh.visual.uv
mat = mesh.visual.material
tex_img = mat.baseColorTexture if hasattr(mat, 'baseColorTexture') and mat.baseColorTexture is not None else mat.image
tex = np.asarray(tex_img.convert('RGB')).copy()
TH, TW = tex.shape[:2]
xmin, ymin = V[:, 0].min(), V[:, 1].min(); xmax, ymax = V[:, 0].max(), V[:, 1].max()
print('mesh aspect', round((xmax - xmin) / (ymax - ymin), 3), 'concept aspect', round((bx1 - bx0) / (by1 - by0), 3))
# align on facial landmarks: MediaPipe on an orthographic front render of the mesh gives its nose / ears in world units;
# matching them to the concept's nose / ears fixes scale and offset (bbox fitting fails: the wings change the widths)
rp = os.path.join(os.path.dirname(os.path.abspath(a.out)), '_front.png')
r = subprocess.run(['blender', '-b', '-P', os.path.join(HERE, 'blender', 'front_render.py'), '--', os.path.abspath(a.glb), rp], capture_output=True, text=True)
cam = json.loads(r.stdout.split('FRONT_CAM ')[1].splitlines()[0])
mp_ = json.loads(subprocess.run([sys.executable, os.path.join(HERE, 'blender', 'pose.py'), rp], capture_output=True, text=True).stdout.strip().splitlines()[-1])['pts']
w2 = lambda uv: (cam['cx'] + (uv[0] - 0.5) * cam['size'], cam['cz'] + (0.5 - uv[1]) * cam['size'])   # Blender x/z == glTF x/y
mn_, ml_, mr_ = w2(mp_['nose']), w2(mp_['ear_l']), w2(mp_['ear_r'])
ear_w = float(np.hypot(ml_[0] - mr_[0], ml_[1] - mr_[1]))
sc = ear_d * CW / ear_w
print('mesh nose', [round(v, 3) for v in mn_], 'ear width', round(ear_w, 3), 'scale px/unit', round(sc, 1))
ix = nose[0] * CW + (V[:, 0] - mn_[0]) * sc
iy = nose[1] * CH - (V[:, 1] - mn_[1]) * sc
P = np.stack([ix, iy], 1)

# ---- triangle selection: inside the ellipse, facing the camera (+Z), front-most (z-buffer on the image grid)
tri_c = P[F].mean(1)
e = ((tri_c[:, 0] - cx) / rx) ** 2 + ((tri_c[:, 1] - cy) / ry) ** 2
n = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
zc = V[F].mean(1)[:, 2]
cand = np.where((e < 1.0) & (np.abs(n[:, 2]) > 0.2))[0]
zbuf = np.full((CH // 2 + 1, CW // 2 + 1), -1e9)
gx = np.clip((tri_c[cand, 0] / 2).astype(int), 0, zbuf.shape[1] - 1); gy = np.clip((tri_c[cand, 1] / 2).astype(int), 0, zbuf.shape[0] - 1)
np.maximum.at(zbuf, (gy, gx), zc[cand])
blur = cv2.dilate(zbuf.astype(np.float32), np.ones((5, 5), np.uint8))
front = zc[cand] > blur[gy, gx] - 0.012 * (ymax - ymin)
sel = cand[front]
print('triangles: candidates', len(cand), 'front-most', len(sel))

# ---- paint: warp each triangle from the concept into texture space, feathered by the ellipse distance
src_img = np.asarray(concept).astype(np.float32)
acc = np.zeros((TH, TW, 3), np.float32); wacc = np.zeros((TH, TW), np.float32)
UVp = np.stack([uv[:, 0] * TW, (1 - uv[:, 1]) * TH], 1)      # trimesh keeps OpenGL uv (v up)
for f in sel:
    s = P[F[f]].astype(np.float32); d = UVp[F[f]].astype(np.float32)
    x0, y0 = np.floor(d.min(0)).astype(int) - 1; x1, y1 = np.ceil(d.max(0)).astype(int) + 2
    x0, y0 = max(x0, 0), max(y0, 0); x1, y1 = min(x1, TW), min(y1, TH)
    if x1 <= x0 or y1 <= y0 or (x1 - x0) * (y1 - y0) > 40000: continue
    M = cv2.getAffineTransform(s, d - np.array([x0, y0], np.float32))
    patch = cv2.warpAffine(src_img, M, (x1 - x0, y1 - y0), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    mask = np.zeros((y1 - y0, x1 - x0), np.uint8)
    cv2.fillConvexPoly(mask, np.round(d - np.array([x0, y0])).astype(np.int32), 1)
    cv2.polylines(mask, [np.round(d - np.array([x0, y0])).astype(np.int32)], True, 1, 1)
    w = float(np.clip((1 - e[f]) / 0.35, 0, 1))      # full strength in the middle, fading over the outer third
    m = mask.astype(np.float32) * w
    acc[y0:y1, x0:x1] += patch * m[..., None]; wacc[y0:y1, x0:x1] += m
# grow the painted texels a few pixels into the atlas gutters, or bilinear sampling at island borders shows the old
# texture as thin dark seams across the face
for _ in range(3):
    k = np.ones((3, 3), np.float32)
    acc_d = cv2.filter2D(acc, -1, k, borderType=cv2.BORDER_CONSTANT); w_d = cv2.filter2D(wacc, -1, k, borderType=cv2.BORDER_CONSTANT)
    grow = (wacc <= 1e-4) & (w_d > 1e-4)
    acc[grow] = acc_d[grow] / w_d[grow][:, None] * (w_d[grow] / 9)[:, None]; wacc[grow] = w_d[grow] / 9
cover = wacc > 1e-4
out = tex.astype(np.float32)
blend = np.clip(wacc * 1.6, 0, 1)[..., None]
painted = np.where(cover[..., None], acc / np.maximum(wacc, 1e-4)[..., None], out)
out = out * (1 - blend) + painted * blend
new = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
if hasattr(mat, 'baseColorTexture'): mat.baseColorTexture = new
else: mat.image = new
scene.export(a.out)
print('painted texels', int(cover.sum()), '->', a.out)
if a.debug:
    Image.fromarray(tex).save(a.debug + '_before.png'); new.save(a.debug + '_after.png')
    dbg = np.asarray(concept).copy()
    cv2.ellipse(dbg, (int(cx), int(cy)), (int(rx), int(ry)), 0, 0, 360, (255, 0, 0), 2)
    for f in sel[::7]: cv2.polylines(dbg, [P[F[f]].astype(np.int32)], True, (0, 255, 0), 1)
    Image.fromarray(dbg).save(a.debug + '_concept.png')
