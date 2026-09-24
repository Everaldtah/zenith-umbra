"""Geodesic voxel skin weights (run with the system python: numpy + scipy).

    python weights.py in.npz out.npz
in.npz:  verts (N,3), faces (M,3), bones_a (B,3), bones_b (B,3)   [bone head/tail]
out.npz: w (N,B) float32

Solid-voxelise the mesh, seed each bone's voxels, Dijkstra through the solid, and weight each vertex by
inverse geodesic distance. Distances only travel through the body, so an arm never pulls on the hip it hangs
next to, and hair or capes follow the bone they are actually attached to.
"""
import sys
import numpy as np
from scipy import ndimage
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra

d = np.load(sys.argv[1])
V, F, A, B = d["verts"], d["faces"], d["bones_a"], d["bones_b"]
mn, mx = V.min(0), V.max(0)
H = float(mx[2] - mn[2])
res = H / 110.0
pad = 3
dims = np.ceil((mx - mn) / res).astype(int) + 2 * pad + 1
origin = mn - pad * res

def cell(p): return np.floor((p - origin) / res).astype(int)

# ---- surface voxels: sample every triangle densely enough to hit each voxel it crosses
occ = np.zeros(dims, dtype=bool)
tri = V[F]
edge = np.maximum(np.linalg.norm(tri[:, 1] - tri[:, 0], axis=1), np.linalg.norm(tri[:, 2] - tri[:, 0], axis=1))
steps = np.clip(np.ceil(edge / (res * 0.5)).astype(int), 1, 40)
for s in np.unique(steps):
    t = tri[steps == s]
    u, v = np.meshgrid(np.linspace(0, 1, s + 1), np.linspace(0, 1, s + 1))
    m = (u + v) <= 1
    u, v = u[m], v[m]
    P = t[:, None, 0] + u[None, :, None] * (t[:, None, 1] - t[:, None, 0]) + v[None, :, None] * (t[:, None, 2] - t[:, None, 0])
    c = cell(P.reshape(-1, 3))
    occ[c[:, 0], c[:, 1], c[:, 2]] = True
# ---- solid: close small gaps, fill the inside
solid = ndimage.binary_closing(occ, iterations=2)
solid = ndimage.binary_fill_holes(solid)
solid |= occ
# ---- bone seeds (forced inside the solid)
seeds = []
for a, b in zip(A, B):
    n = max(2, int(np.linalg.norm(b - a) / (res * 0.5)))
    pts = a[None] + np.linspace(0, 1, n)[:, None] * (b - a)[None]
    c = np.clip(cell(pts), 0, dims - 1)
    solid[c[:, 0], c[:, 1], c[:, 2]] = True
    seeds.append(c)
# ---- graph over solid voxels (26-neighbourhood)
idx = -np.ones(dims, dtype=np.int64)
coords = np.argwhere(solid)
idx[tuple(coords.T)] = np.arange(len(coords))
rows, cols, wts = [], [], []
offs = [(dx, dy, dz) for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1) if (dx, dy, dz) > (0, 0, 0)]
for o in offs:
    nb = coords + np.array(o)
    ok = np.all((nb >= 0) & (nb < dims), axis=1)
    src = np.where(ok)[0]
    dst = idx[tuple(nb[ok].T)]
    good = dst >= 0
    rows.append(src[good]); cols.append(dst[good]); wts.append(np.full(good.sum(), np.linalg.norm(o) * res))
r = np.concatenate(rows); c_ = np.concatenate(cols); w_ = np.concatenate(wts)
G = coo_matrix((np.concatenate([w_, w_]), (np.concatenate([r, c_]), np.concatenate([c_, r]))), shape=(len(coords), len(coords))).tocsr()
# ---- per-vertex voxel (nearest solid voxel to the vertex)
vc = np.clip(cell(V), 0, dims - 1)
vi = idx[tuple(vc.T)]
if (vi < 0).any():
    _, near = ndimage.distance_transform_edt(~solid, return_indices=True)
    bad = vi < 0
    nc = np.stack([near[k][tuple(vc[bad].T)] for k in range(3)], 1)
    vi[bad] = idx[tuple(nc.T)]
Dist = np.zeros((len(V), len(A)), dtype=np.float32)
for bi, s in enumerate(seeds):
    src = np.unique(idx[tuple(s.T)]); src = src[src >= 0]
    dist = dijkstra(G, indices=src, min_only=True, directed=False)
    Dist[:, bi] = dist[vi]
Dist[~np.isfinite(Dist)] = 1e3
# ---- weights: inverse distance with a sharp falloff relative to the nearest bone
dmin = Dist.min(1, keepdims=True)
Wt = np.exp(-((Dist - dmin) / (H * 0.035)) ** 2) / (1 + (Dist / (H * 0.05)) ** 2)
Wt[Dist > dmin + H * 0.12] = 0
Wt /= np.maximum(Wt.sum(1, keepdims=True), 1e-8)
np.savez(sys.argv[2], w=Wt.astype(np.float32))
print("WEIGHTS_OK", len(coords), "voxels", Wt.shape)
