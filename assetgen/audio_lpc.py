"""Click detection by linear prediction - the standard way declickers find pops in speech and music: each block of
audio is modelled by an order-N linear predictor (LPC); voiced speech, sibilants and tones are predictable, an impulse
(a click, a digital pop, a crackle) isn't, so it leaves a residual many times the block's typical residual."""
import numpy as np
from scipy.linalg import solve_toeplitz


def lpc_residual(a, order=20, block=1024, hop=512):
    """prediction residual of `a` (same length), computed block-wise with a Hann-windowed autocorrelation LPC"""
    res = np.zeros_like(a)
    wsum = np.zeros_like(a)
    win = np.hanning(block)
    for s in range(0, max(1, len(a) - order), hop):
        seg = a[s:s + block]
        if len(seg) < order * 4: break
        w = seg * win[:len(seg)]
        r = np.correlate(w, w, "full")[len(w) - 1:len(w) + order]
        if r[0] < 1e-9: continue
        r[0] *= 1.0001                                   # a touch of regularisation
        try: coef = solve_toeplitz(r[:order], r[1:order + 1])
        except Exception: continue
        pred = np.zeros_like(seg)
        for k in range(1, order + 1): pred[k:] += coef[k - 1] * seg[:-k]
        e = seg - pred
        e[:order] = 0
        res[s:s + len(seg)] += e * win[:len(seg)]
        wsum[s:s + len(seg)] += win[:len(seg)]
    return res / np.maximum(wsum, 1e-3)


def find_clicks(a, sr, k=9.0, floor=0.04):
    """sample indices of clicks: residual beyond k x the local robust deviation (MAD over ~20 ms) and an absolute floor"""
    if len(a) < sr * 0.03: return np.array([], int)
    e = lpc_residual(a)
    w = max(64, int(sr * 0.02)); step = w // 4
    ae = np.abs(e)
    pad = np.pad(ae, (w, w), mode="edge")
    sig = np.array([np.median(pad[i:i + 2 * w]) for i in range(0, len(ae), step)]) * 1.4826 + 1e-6
    sig = np.repeat(sig, step)[:len(ae)]
    hit = np.flatnonzero((ae > k * sig) & (ae > floor))
    if not len(hit): return hit
    # one event per burst
    groups = np.split(hit, np.flatnonzero(np.diff(hit) > int(sr * 0.003)) + 1)
    cand = [g[np.argmax(ae[g])] for g in groups]
    # voiced speech leaves a residual pulse at every glottal closure (a train, 2-12 ms apart): a click is ISOLATED - nothing
    # comparable in the 2-12 ms on either side
    near, far = int(sr * 0.002), int(sr * 0.012)
    out = []
    for i in cand:
        l = ae[max(0, i - far):max(0, i - near)]; r = ae[i + near:i + far]
        nb = max(l.max() if len(l) else 0.0, r.max() if len(r) else 0.0)
        if nb < 0.45 * ae[i]: out.append(i)
    return np.array(out, int)
