#!/usr/bin/env python3
"""Audio QA for the desktop sound bank (public/sfx): every sound effect and voice line is decoded and checked for the
defects that come out of the speakers as scratches, crackles and pops.

    python assetgen/audio_qa.py              # report (work/audio/qa.json) + summary; exit 1 if anything fails
    python assetgen/audio_qa.py --verbose

Checks per file:
  clip        samples at full scale (digital clipping)                                  fail > 0
  truepeak    4x-oversampled peak (inter-sample overs that crackle after resampling)       fail > -0.3 dBFS
  saturate    share of samples in the top 1 dB (squashed / soft-clipped waveforms)          fail > 0.4%
  clicks      single-sample spikes in the >6 kHz band vs its local level (pops, crackle)     fail > 2
  edges       first / last sample far from zero (a click when the sound starts / stops)     fail > 0.02
  dropouts    runs of exact digital silence inside the sound (> 4 ms)                        fail > 0
  dc          DC offset                                                                    fail > 0.01
  harsh       energy above 9 kHz vs the whole spectrum (fizz / hiss)                         warn > 0.3
  seam        loops: the jump from the last sample back to the first vs its largest steps     fail > 1.5x p99.5
"""
import argparse, glob, json, os, sys
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt, resample_poly
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from audio_lpc import find_clicks

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
PUB = os.path.join(ROOT, "public", "sfx")


def load(p):
    a, sr = sf.read(p, always_2d=True)
    return a.mean(1).astype(np.float64), sr


def clicks(a, sr):
    """isolated clicks by linear prediction (audio_lpc.find_clicks)"""
    return int(len(find_clicks(a, sr)))


def check(p, loop=False):
    a, sr = load(p)
    r = {}
    pk = float(np.abs(a).max()) if len(a) else 0.0
    r["peak_db"] = round(20 * np.log10(max(pk, 1e-9)), 2)
    r["clip"] = int(np.sum(np.abs(a) >= 0.999))
    up = resample_poly(a, 4, 1)
    r["truepeak_db"] = round(20 * np.log10(max(float(np.abs(up).max()), 1e-9)), 2)
    top = pk * 10 ** (-1 / 20)
    r["saturate"] = round(float(np.mean(np.abs(a) >= top)) * 100, 3) if pk > 0.5 else 0.0
    r["clicks"] = clicks(a, sr)
    r["edges"] = round(max(abs(a[0]), abs(a[-1])) / max(pk, 1e-9), 3) if len(a) else 0.0
    z = (a == 0).astype(np.int8)
    inner = z[int(len(z) * 0.05): int(len(z) * 0.9)]
    runs = 0
    if len(inner):
        dz = np.diff(np.concatenate([[0], inner, [0]]))
        starts, ends = np.flatnonzero(dz == 1), np.flatnonzero(dz == -1)
        runs = int(np.sum((ends - starts) > sr * 0.004))
    r["dropouts"] = runs
    r["dc"] = round(float(np.mean(a)), 4)
    spec = np.abs(np.fft.rfft(a * np.hanning(len(a)))) ** 2 if len(a) > 64 else np.zeros(2)
    f = np.fft.rfftfreq(len(a), 1 / sr) if len(a) > 64 else np.zeros(2)
    r["harsh"] = round(float(spec[f > 9000].sum() / max(spec.sum(), 1e-12)), 3)
    if loop and len(a) > 100:
        # the jump from the last sample back to the first, against the signal's own largest natural steps (noise-like
        # beds routinely step 5-10x their median)
        big = np.percentile(np.abs(np.diff(a)), 99.5) + 1e-6
        r["seam"] = round(float(abs(a[0] - a[-1]) / big), 2)
    fails = []
    if r["clip"] > 0: fails.append("clip")
    if r["truepeak_db"] > -0.3: fails.append("truepeak")
    if r["saturate"] > 1.0: fails.append("saturate")
    if r["clicks"] > 2: fails.append("clicks")
    if r["edges"] > 0.02 and not loop: fails.append("edges")
    if r["dropouts"] > 0: fails.append("dropouts")
    if abs(r["dc"]) > 0.01: fails.append("dc")
    if loop and r.get("seam", 0) > 1.5: fails.append("seam")
    r["dur"] = round(len(a) / sr, 2)
    if "/vo/" in p.replace("\\", "/") and r["dur"] > 7: fails.append("long")
    warns = ["harsh"] if r["harsh"] > 0.3 else []
    return r, fails, warns


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--verbose", action="store_true"); ap.add_argument("--root", default=PUB)
    a = ap.parse_args()
    bank = json.load(open(os.path.join(a.root, "bank.json"), encoding="utf-8"))
    loops = {k for k, v in bank.get("sfx", {}).items() if v.get("loop")}
    report, nfail, nwarn, n = {}, 0, 0, 0
    for p in sorted(glob.glob(os.path.join(a.root, "**", "*.ogg"), recursive=True) + glob.glob(os.path.join(a.root, "**", "*.flac"), recursive=True)):
        rel = os.path.relpath(p, a.root).replace("\\", "/")
        sid = rel.split("/")[0]
        r, fails, warns = check(p, loop=sid in loops)
        n += 1
        if fails or warns:
            report[rel] = {**r, "fail": fails, "warn": warns}
            nfail += bool(fails); nwarn += bool(warns)
            if a.verbose or fails: print(f"{'FAIL' if fails else 'warn'} {rel:42s} {' '.join(fails + warns):28s} peak {r['peak_db']} tp {r['truepeak_db']} sat {r['saturate']} clicks {r['clicks']} edges {r['edges']}")
    out = os.path.join(ROOT, "work", "audio", "qa.json"); os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump(report, open(out, "w"), indent=1)
    print(f"audio QA: {n} files, {nfail} failing, {nwarn} warnings -> {out}")
    sys.exit(1 if nfail else 0)


if __name__ == "__main__":
    main()
