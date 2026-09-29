"""Minimal GLB reader for skinned meshes: bind-space joint positions from inverse bind matrices, raw positions, weights."""
import json, struct
import numpy as np

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read(path):
    b = open(path, 'rb').read()
    assert b[:4] == b'glTF'
    off, js, bin_ = 12, None, None
    while off < len(b):
        n, t = struct.unpack_from('<II', b, off); off += 8
        if t == 0x4E4F534A: js = json.loads(b[off:off + n])
        elif t == 0x004E4942: bin_ = b[off:off + n]
        off += n
    return js, bin_


def accessor(js, bin_, i):
    a = js['accessors'][i]; bv = js['bufferViews'][a['bufferView']]
    dt = np.dtype(CT[a['componentType']]); nc = NC[a['type']]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', 0)
    if stride and stride != dt.itemsize * nc:
        rows = [np.frombuffer(bin_, dt, nc, start + k * stride) for k in range(a['count'])]
        arr = np.stack(rows)
    else:
        arr = np.frombuffer(bin_, dt, a['count'] * nc, start).reshape(a['count'], nc)
    if a.get('normalized'): arr = arr.astype(np.float32) / np.iinfo(dt).max
    return arr


def skin(path):
    """-> dict(names, parents, bind_pos (glTF Y-up, bind space), positions list per primitive)"""
    js, bin_ = read(path)
    sk = js['skins'][0]
    ibm = accessor(js, bin_, sk['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)   # column-major -> row-major
    joints = sk['joints']
    nodes = js['nodes']
    names = [nodes[j].get('name', f'joint{j}') for j in joints]
    parent_of = {}
    for pi, n in enumerate(nodes):
        for c in n.get('children', []): parent_of[c] = pi
    parents = [nodes[parent_of[j]].get('name') if j in parent_of else None for j in joints]
    bind = np.array([np.linalg.inv(m)[:3, 3] for m in ibm])
    pos = []
    for n in nodes:
        if 'mesh' in n and 'skin' in n:
            for p in js['meshes'][n['mesh']]['primitives']:
                pos.append(accessor(js, bin_, p['attributes']['POSITION']).astype(np.float64))
    return {'names': names, 'parents': parents, 'bind': bind, 'positions': pos}


if __name__ == '__main__':
    import sys
    for f in sys.argv[1:]:
        s = skin(f)
        P = np.concatenate(s['positions'])
        print(f, 'joints', len(s['names']), 'prims', len(s['positions']), 'verts', len(P), 'bbox', P.min(0).round(3), P.max(0).round(3))
        for n, b in zip(s['names'], s['bind']):
            if any(k in n for k in ('Hips', 'Head', 'LeftFoot', 'LeftHand', 'LeftUpLeg')) and not any(c.isdigit() for c in n[-1:]): print('  ', n, b.round(3))


def _trs(n):
    if 'matrix' in n: return np.array(n['matrix'], dtype=np.float64).reshape(4, 4).T
    t = np.array(n.get('translation', [0, 0, 0]), dtype=np.float64)
    x, y, z, w = n.get('rotation', [0, 0, 0, 1])
    s = np.array(n.get('scale', [1, 1, 1]), dtype=np.float64)
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    M = np.eye(4); M[:3, :3] = R * s; M[:3, 3] = t
    return M


def world_mats(js):
    nodes = js['nodes']; parent = {}
    for pi, n in enumerate(nodes):
        for c in n.get('children', []): parent[c] = pi
    W = {}
    def w(i):
        if i in W: return W[i]
        M = _trs(nodes[i]); W[i] = (w(parent[i]) @ M) if i in parent else M
        return W[i]
    for i in range(len(nodes)): w(i)
    return W


def rest_joints(path):
    """joint rest positions from the node hierarchy, in the skinned mesh node's local space (what three.js renders)"""
    js, bin_ = read(path)
    W = world_mats(js)
    mesh_node = next(i for i, n in enumerate(js['nodes']) if 'mesh' in n and 'skin' in n)
    inv = np.linalg.inv(W[mesh_node])
    joints = js['skins'][0]['joints']
    names = [js['nodes'][j].get('name', f'joint{j}') for j in joints]
    P = np.array([(inv @ W[j])[:3, 3] for j in joints])
    # the same through the inverse bind matrices (bind space) - three.js skins in bind space, then applies the mesh world
    return names, P


def skinned(path):
    """raw skinned mesh (single skin): positions (glTF space), per-vertex joints/weights, joint names, bind-space joints"""
    js, bin_ = read(path)
    sk = js['skins'][0]
    names = [js['nodes'][j].get('name', f'joint{j}') for j in sk['joints']]
    ibm = accessor(js, bin_, sk['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
    bind = np.array([np.linalg.inv(m)[:3, 3] for m in ibm])
    P, Jn, Wt = [], [], []
    for n in js['nodes']:
        if 'mesh' in n and 'skin' in n:
            for p in js['meshes'][n['mesh']]['primitives']:
                at = p['attributes']
                P.append(accessor(js, bin_, at['POSITION']).astype(np.float64))
                Jn.append(accessor(js, bin_, at['JOINTS_0']).astype(np.int64))
                Wt.append(accessor(js, bin_, at['WEIGHTS_0']).astype(np.float64))
    return names, bind, np.concatenate(P), np.concatenate(Jn), np.concatenate(Wt)


def umeyama(src, dst):
    """similarity transform (s, R, t) minimising |s R src + t - dst|"""
    ms, md = src.mean(0), dst.mean(0)
    X, Y = src - ms, dst - md
    U, S, Vt = np.linalg.svd(Y.T @ X / len(src))
    D = np.eye(3); D[2, 2] = np.sign(np.linalg.det(U @ Vt))
    R = U @ D @ Vt
    s = np.trace(np.diag(S) @ D) / (X ** 2).sum(1).mean()
    return s, R, md - s * R @ ms


def fitted_joints(path, chains):
    """joint positions in the mesh's own space: each bone's midpoint (joint -> child) is matched to the centroid of the
    vertices it dominates, and one similarity transform carries the whole skeleton onto the mesh"""
    names, bind, P, Jn, Wt = skinned(path)
    idx = {n: i for i, n in enumerate(names)}
    dom = Jn[np.arange(len(Jn)), Wt.argmax(1)]
    src, dst = [], []
    for a, b in chains:
        if a not in idx or b not in idx: continue
        m = dom == idx[a]
        if m.sum() < 30: continue
        src.append((bind[idx[a]] + bind[idx[b]]) / 2); dst.append(P[m].mean(0))
    src, dst = np.array(src), np.array(dst)
    s, R, t = umeyama(src, dst)
    fit = (s * (R @ bind.T)).T + t
    res = np.linalg.norm((s * (R @ src.T)).T + t - dst, axis=1)
    return names, fit, P, Jn, Wt, {'scale': float(s), 'resid_mean': float(res.mean()), 'resid_max': float(res.max()), 'pairs': len(src),
                                   'height': float(P[:, 1].max() - P[:, 1].min())}
