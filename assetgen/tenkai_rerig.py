#!/usr/bin/env python3
"""Tenkai-Oh, third person: a new skeleton fit and new skin weights on the PUBLISHED mesh, written straight into the GLB.

    python tenkai_rerig.py [--src out/rigged_tripo/tenkai.glb] [--out out/rigged_tripo/tenkai_rerig.glb] [--plot dir]

Why: rig_hero.py --mech put his shoulders at 1.95 m (the face detector anchored the neck to the chest emblem; the
silhouette said 2.7) and its loose-island pass ran on UV-split vertices, so ~12.5k of 19.9k vertices follow shoulder_L/R
and hips, spine, chest, neck, head, forearms and hands carry none - the arm bones sit ~0.5 m outside the mesh.

What stays byte-identical: positions, normals, UVs, indices, material, textures (the first-person gauntlets are cut from
this mesh by coordinates, and the game sizes him by its bounding box). What changes: JOINTS_0, WEIGHTS_0, the inverse
bind matrices and the joint nodes' rest transforms. Bone names and hierarchy are rig_hero.py's (src/render/Rig.ts BONES).

The joints are measured on the mesh (glTF space: +x his left, +y up, +z front, metres at height 3.3) and mirrored, the
weights are hard-surface: every vertex belongs to one armour part, parts blend only across their joint (a few cm), and
plates that must not shear (pauldrons, forearm shields, knee discs, backpack) ride one bone.
"""
import argparse, json, struct, sys
from pathlib import Path
import numpy as np
from scipy.sparse import coo_matrix

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import glbskin

ap = argparse.ArgumentParser()
ap.add_argument('--src', default=str(HERE / 'out' / 'rigged_tripo' / 'tenkai.glb'))
ap.add_argument('--out', default=str(HERE / 'out' / 'rigged_tripo' / 'tenkai_rerig.glb'))
ap.add_argument('--plot', default='')
a = ap.parse_args()

# ---------------------------------------------------------------- joints (left side; the right is mirrored in x)
# measured on slices of the mesh: the shoulder ball sits inside the pauldron, the elbow under its rim, the upper arm is
# short and mostly hidden; the knee is the centre of the round knee disc; the hip joint is under the skirt plates
J = {
    'hips': (0.0, 1.42, 0.08), 'spine': (0.0, 1.64, 0.08), 'chest': (0.0, 1.93, 0.06), 'neck': (0.0, 2.56, 0.06), 'head': (0.0, 2.68, 0.10),
    'head_top': (0.0, 3.0, 0.10),
    'clav': (0.12, 2.49, 0.05),                 # shoulder_L head
    'upperarm': (0.62, 2.30, 0.03), 'forearm': (0.79, 1.99, 0.07), 'hand': (0.86, 1.53, 0.14),
    'thigh': (0.30, 1.38, 0.07), 'shin': (0.43, 0.87, 0.05), 'foot': (0.55, 0.27, 0.0),
}
HAND_LEN, TOE = 0.2, (0.02, -0.24, 0.27)     # hand tip past the wrist along the forearm; toe from the ankle
BONES = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'shoulder_L', 'upperarm_L', 'forearm_L', 'hand_L', 'shoulder_R', 'upperarm_R', 'forearm_R', 'hand_R',
         'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R']
PARENT = {'hips': 'root', 'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck'}
for s in 'LR':
    PARENT |= {f'shoulder_{s}': 'chest', f'upperarm_{s}': f'shoulder_{s}', f'forearm_{s}': f'upperarm_{s}', f'hand_{s}': f'forearm_{s}',
               f'thigh_{s}': 'hips', f'shin_{s}': f'thigh_{s}', f'foot_{s}': f'shin_{s}'}


def side(p, s): return np.array([p[0] * (1 if s == 'L' else -1), p[1], p[2]], dtype=np.float64)


head, tail = {'root': np.zeros(3)}, {'root': np.array([0, 0.264, 0.0])}
for n, c in (('hips', 'spine'), ('spine', 'chest'), ('chest', 'neck'), ('neck', 'head'), ('head', 'head_top')):
    head[n], tail[n] = np.array(J[n], float), np.array(J[c], float)
for s in 'LR':
    for n, hk, tk in (('shoulder', 'clav', 'upperarm'), ('upperarm', 'upperarm', 'forearm'), ('forearm', 'forearm', 'hand'), ('thigh', 'thigh', 'shin'), ('shin', 'shin', 'foot')):
        head[f'{n}_{s}'], tail[f'{n}_{s}'] = side(J[hk], s), side(J[tk], s)
    fa = side(J['hand'], s) - side(J['forearm'], s)
    head[f'hand_{s}'] = side(J['hand'], s); tail[f'hand_{s}'] = head[f'hand_{s}'] + fa / np.linalg.norm(fa) * HAND_LEN
    head[f'foot_{s}'] = side(J['foot'], s); tail[f'foot_{s}'] = head[f'foot_{s}'] + side(TOE, s)

# ---------------------------------------------------------------- rest matrices, the way Blender's exporter writes bones
C = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], float)      # Blender (z up, front -y) -> glTF (y up, front +z)


def bone_rot(h, t):
    """glTF-space rest rotation of a Blender bone head -> tail, roll 0 (armature.c vec_roll_to_mat3)"""
    n = C.T @ (t - h); n /= np.linalg.norm(n); x, y, z = n
    th, ta = 1 + y, x * x + z * z
    if th > 6.1e-3 or ta > 2.5e-4 ** 2:
        if th <= 6.1e-3: th = ta * 0.5 + ta * ta * 0.125
        X = np.array([1 - x * x / th, -x, -x * z / th]); Z = np.array([-x * z / th, -z, 1 - z * z / th])
    else:
        X, Z, n = np.array([-1., 0, 0]), np.array([0, 0, 1.]), np.array([0, -1., 0])
    return C @ np.stack([X, n, Z], 1)


def quat(R):
    t = np.trace(R)
    if t > 0:
        s = np.sqrt(t + 1) * 2; q = [(R[2, 1] - R[1, 2]) / s, (R[0, 2] - R[2, 0]) / s, (R[1, 0] - R[0, 1]) / s, s / 4]
    else:
        i = int(np.argmax(np.diag(R))); j, k = (i + 1) % 3, (i + 2) % 3
        s = np.sqrt(1 + R[i, i] - R[j, j] - R[k, k]) * 2
        q = [0, 0, 0, (R[k, j] - R[j, k]) / s]; q[i] = s / 4; q[j] = (R[j, i] + R[i, j]) / s; q[k] = (R[k, i] + R[i, k]) / s
    q = np.array(q); return q / np.linalg.norm(q)


WORLD = {}
for n in BONES:
    M = np.eye(4); M[:3, :3] = bone_rot(head[n], tail[n]); M[:3, 3] = head[n]; WORLD[n] = M

# ---------------------------------------------------------------- mesh
js, bin_ = glbskin.read(a.src)
bin_ = bytearray(bin_)
prim = js['meshes'][0]['primitives'][0]
P = glbskin.accessor(js, bin_, prim['attributes']['POSITION']).astype(np.float64)
F = glbskin.accessor(js, bin_, prim['indices']).reshape(-1, 3).astype(np.int64)
names0 = [js['nodes'][j]['name'] for j in js['skins'][0]['joints']]
assert names0 == BONES, names0
# UV-seam copies share a position: weld them so a plate is one piece and both copies get the same weights
key = np.round(P * 1e4).astype(np.int64)
_, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True); inv = inv.ravel()
V = P[first]; NV = len(V)
E = np.unique(np.sort(np.concatenate([inv[F[:, [0, 1]]], inv[F[:, [1, 2]]], inv[F[:, [2, 0]]]]), axis=1), axis=0)
E = E[E[:, 0] != E[:, 1]]
x, y, z = V[:, 0], V[:, 1], V[:, 2]
ax = np.abs(x); sgn = np.where(x >= 0, 1, -1)


def smooth(e0, e1, v):
    t = np.clip((v - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)


def seg_dist(A, B, Q):
    AB = B - A; t = np.clip(((Q - A) @ AB) / (AB @ AB), 0, 1)
    return np.linalg.norm(Q - (A + t[:, None] * AB), axis=1)


def joint_blend(Q, a_, j, c, hw):
    """0 on the parent's side of joint j .. 1 on the child's, across the plane that bisects the two bones"""
    n = (j - a_) / np.linalg.norm(j - a_) + (c - j) / np.linalg.norm(c - j); n /= np.linalg.norm(n)
    return smooth(-hw, hw, (Q - j) @ n)


# ---- which armour part is a vertex on?  arm | pauldron | leg | head | torso
# the gap between the hanging arm and the body, by height (slices of the mesh)
thr = np.interp(y, [1.2, 1.6, 1.85, 2.0, 2.25, 2.6, 2.66], [0.60, 0.60, 0.58, 0.47, 0.435, 0.435, 0.55])
back = (z < -0.27) & (y > 1.75)                   # backpack, thruster cans (not the heels)
outer = (ax > thr) & ~back & (y > 1.2)
Q = np.stack([ax, y, z], 1)                        # mirrored to the left side
UA, FA, HA = np.array(J['upperarm'], float), np.array(J['forearm'], float), np.array(J['hand'], float)
HT = HA + (HA - FA) / np.linalg.norm(HA - FA) * HAND_LEN
d_ua = seg_dist(UA + (UA - FA) * 0.25, FA, Q)      # the shoulder ball and the upper arm under the pauldron
shield = (ax > 0.9) & (y < 2.16)                   # the forearm shield's flare reaches up past the elbow
arm = outer & ((y < 2.13) | ((d_ua < 0.205) & (y < 2.34))) | (outer & shield)
pauldron = outer & ~arm
head_m = (y > 2.6) & (ax < 0.34) & (z > -0.2) & ~outer
leg_w = 1 - smooth(1.22, 1.34, y)                  # thigh armour under the skirt plates
torso = ~outer

W = np.zeros((NV, len(BONES)))
bi = {n: i for i, n in enumerate(BONES)}
for s, sg in (('L', 1), ('R', -1)):
    m = sgn == sg
    # arm chain
    k = arm & m
    e = joint_blend(Q[k], UA, FA, HA, 0.035); w_ = joint_blend(Q[k], FA, HA, HT, 0.03)
    sh = shield[k]; e = np.where(sh, 1.0, e)       # the shield is one plate on the forearm
    W[k, bi[f'upperarm_{s}']] = 1 - e; W[k, bi[f'forearm_{s}']] = e * (1 - w_); W[k, bi[f'hand_{s}']] = e * w_
    # pauldron: one shell on the clavicle bone, eased into the chest along its inner edge
    k = pauldron & m
    W[k, bi[f'shoulder_{s}']] = 1
    # leg chain
    k = torso & m
    TH, SH, FO = np.array(J['thigh'], float), np.array(J['shin'], float), np.array(J['foot'], float)
    lw = leg_w[k] * (~back[k])
    kn = joint_blend(Q[k], TH, SH, FO, 0.05); an = smooth(0.31, 0.21, y[k])
    # the round knee disc (outer side of the knee, centred on the joint) turns with the shin as one piece
    disc = (np.hypot(y[k] - SH[1], z[k] - (-0.02)) < 0.27) & (ax[k] > 0.56) & (y[k] < 1.15)
    kn = np.where(disc, 1.0, kn)
    W[k, bi[f'thigh_{s}']] = lw * (1 - kn); W[k, bi[f'shin_{s}']] = lw * kn * (1 - an); W[k, bi[f'foot_{s}']] = lw * kn * an
# torso column: hips -> spine -> chest -> neck -> head, by height; the backpack rides the chest
t = torso
rest = np.where(t, 1 - leg_w * (~back), 0)
sp = smooth(1.57, 1.69, y); ch = smooth(1.87, 1.99, y)
hd = np.where(head_m, smooth(2.6, 2.7, y), 0)
ch = np.where(back, 1.0, ch); sp = np.where(back, 1.0, sp)
W[:, bi['hips']] += rest * (1 - sp)
W[:, bi['spine']] += rest * sp * (1 - ch)
W[:, bi['chest']] += rest * sp * ch * (1 - hd)
W[:, bi['neck']] += rest * sp * ch * hd * (1 - smooth(2.66, 2.74, y))
W[:, bi['head']] += rest * sp * ch * hd * smooth(2.66, 2.74, y)
assert np.allclose(W.sum(1), 1, atol=1e-6), (W.sum(1).min(), W.sum(1).max())

# ---- a light smoothing pass over the welded surface: softens the part borders, never crosses the arm / body gap
# (edges only join vertices of one surface), and leaves the rigid plates rigid
rigid = np.zeros(NV, bool)
rigid |= pauldron & (ax > thr + 0.06)
rigid |= arm & shield
A = coo_matrix((np.ones(len(E) * 2), (np.concatenate([E[:, 0], E[:, 1]]), np.concatenate([E[:, 1], E[:, 0]]))), shape=(NV, NV)).tocsr()
deg = np.maximum(np.asarray(A.sum(1)).ravel(), 1)
for _ in range(2):
    Ws = (A @ W) / deg[:, None]
    W = np.where(rigid[:, None], W, 0.5 * W + 0.5 * Ws)
# 4 influences, normalised
order = np.argsort(-W, axis=1)
W4 = np.take_along_axis(W, order[:, :4], 1); J4 = order[:, :4]
W4[W4 < 0.01] = 0
W4 /= W4.sum(1, keepdims=True)
J4 = np.where(W4 > 0, J4, 0)

# ---------------------------------------------------------------- write: same buffer layout, new numbers
acc = js['accessors']
aj, aw, ai = acc[prim['attributes']['JOINTS_0']], acc[prim['attributes']['WEIGHTS_0']], acc[js['skins'][0]['inverseBindMatrices']]


def put(accessor, arr):
    bv = js['bufferViews'][accessor['bufferView']]
    assert not bv.get('byteStride') and len(arr.tobytes()) == bv['byteLength'], (accessor, len(arr.tobytes()), bv)
    o = bv.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    bin_[o:o + bv['byteLength']] = arr.tobytes()


assert aj['componentType'] == 5121 and aw['componentType'] == 5126
put(aj, J4[inv].astype(np.uint8)); put(aw, W4[inv].astype(np.float32))
ibm = np.stack([np.linalg.inv(WORLD[n]).T for n in BONES]).astype(np.float32)      # column-major
put(ai, ibm)
node_of = {n['name']: n for n in js['nodes'] if 'name' in n}
for n in BONES:
    nd = node_of[n]
    L = WORLD[n] if n == 'root' else np.linalg.inv(WORLD[PARENT[n]]) @ WORLD[n]
    for k_ in ('matrix', 'scale', 'rotation', 'translation'): nd.pop(k_, None)
    if n != 'root':
        nd['translation'] = [float(v) for v in L[:3, 3]]; nd['rotation'] = [float(v) for v in quat(L[:3, :3])]
js['asset']['generator'] = js['asset'].get('generator', '') + ' + tenkai_rerig.py'
jb = json.dumps(js, separators=(',', ':')).encode(); jb += b' ' * (-len(jb) % 4)
bb = bytes(bin_) + b'\0' * (-len(bin_) % 4)
out = Path(a.out); out.parent.mkdir(parents=True, exist_ok=True)
out.write_bytes(b'glTF' + struct.pack('<II', 2, 12 + 8 + len(jb) + 8 + len(bb)) + struct.pack('<II', len(jb), 0x4E4F534A) + jb + struct.pack('<II', len(bb), 0x004E4942) + bb)

dom = J4[np.arange(NV), W4.argmax(1)]
rep = {'verts': int(len(P)), 'welded': int(NV), 'by_bone': {n: int((dom == i).sum()) for i, n in enumerate(BONES) if (dom == i).any()},
       'arm_len': round(float(np.linalg.norm(FA - UA) + np.linalg.norm(HA - FA)), 3), 'blended_verts': int((W4.max(1) < 0.99).sum())}
print('RERIG_DONE', json.dumps(rep))

if a.plot:
    import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
    cm = plt.get_cmap('tab20'); col = np.array([cm(i % 20) for i in range(len(BONES))])
    c = np.clip((W4[:, :, None] * col[J4]).sum(1), 0, 1)
    fig, axs = plt.subplots(1, 3, figsize=(24, 11))
    for k_, (u, v, ttl, keep) in enumerate([(0, 1, 'front', z > -0.1), (2, 1, 'left side', x > 0), (0, 1, 'back', z < 0.1)]):
        o = np.argsort(V[keep][:, 2] if k_ != 1 else V[keep][:, 0]); o = o if k_ != 2 else o[::-1]
        axs[k_].scatter(V[keep][o, u], V[keep][o, v], s=3, c=c[keep][o])
        for n in BONES:
            axs[k_].plot([head[n][u], tail[n][u]], [head[n][v], tail[n][v]], 'k-', lw=1); axs[k_].plot(head[n][u], head[n][v], 'ko', ms=3)
        axs[k_].set_aspect('equal'); axs[k_].set_title(ttl); axs[k_].grid(True, alpha=.3)
    plt.tight_layout(); plt.savefig(str(Path(a.plot) / 'tenkai_rerig_weights.png'), dpi=60)
