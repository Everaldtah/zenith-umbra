#!/usr/bin/env python3
"""Rendered takes -> the game's sound bank (desktop edition): public/sfx/**.ogg + public/sfx/bank.json.

    python assetgen/audio_finish.py            # sfx + voice
    python assetgen/audio_finish.py --only sfx

SFX (work/audio/sfx/<id>/<take>_<clap>.wav, from modal_sfx.py): the best take by CLAP score, plus any take within 0.08
of it as a variation (up to 3 - Overwatch keeps variations few so sounds stay iconic). Each is trimmed to its onset,
cut to length, given back its top end (MOSS renders at 24 kHz: `hf` sounds get a synthesised 7-16 kHz transient),
made seamless if it loops, and normalised to its category's loudness.
Voice (work/audio/voice/<voice>/<key>_<i>_<take>_<score>.wav, from modal_voice.py): the best take per line by Whisper
score, high-passed, gently compressed and levelled. The bank lists every id and line so the engine knows what exists.
"""
import argparse, glob, json, os, re, subprocess, sys
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt, resample_poly

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
WORK = os.path.join(ROOT, "work", "audio")
PUB = os.path.join(ROOT, "public", "sfx")
sys.path.insert(0, os.path.join(HERE, "audio"))

# loudness targets (RMS of the active part, dBFS) per category - weapons and impacts forward, beds far back
CAT = {
    "weapon": -15, "impact": -17, "ability": -16, "move": -21, "step": -22, "loop": -21, "amb": -27, "feedback": -17, "voice": -17,
}
WEAPONS = {"chaingun", "chaingun2", "cannon", "blaster", "shotgun", "sonic", "star", "talisman", "katana", "thunder", "bow", "note",
           "needle", "kunai", "fang", "punch", "hammer", "flamestart", "whiff", "cut", "spinup", "spindown", "reload", "bowdraw"}
IMPACTS = {"impact_stone", "impact_metal", "impact_wood", "impact_body", "boom", "barrierhit", "barrierbreak", "slam", "implode",
           "anchorhit", "arrowhit", "chainhit", "pin", "body_slam", "mechdown", "down", "botdown", "casing"}
FEEDBACK = {"hit", "crit", "kill", "healhit", "healthpack", "barrierup"}
SKIP = {"hit"}     # the body-hit tick stays the crisp synthesised one (a UI cue - CLAP can't judge it)


def cat_of(j):
    i = j["id"]
    if i.startswith("amb_"): return "amb"
    if j.get("loop"): return "loop"
    if i.startswith("step") or i in ("mechstep", "skate"): return "step"
    if i in WEAPONS: return "weapon"
    if i in IMPACTS: return "impact"
    if i in FEEDBACK: return "feedback"
    if i in ("jump", "land", "land_heavy", "mechjump", "mechland", "doublejump", "dash", "wings", "pad"): return "move"
    return "ability"


def load(p, sr=48000):
    a, s = sf.read(p, always_2d=True)
    a = a.mean(1).astype(np.float64)
    if s != sr:
        g = np.gcd(s, sr); a = resample_poly(a, sr // g, s // g)
    return a


def env(a, sr, ms=5):
    w = max(1, int(sr * ms / 1000))
    return np.sqrt(np.convolve(a ** 2, np.ones(w) / w, "same"))


def db(x): return 20 * np.log10(max(1e-9, x))


def trim(a, sr, secs, loop=False, pre=0.004):
    e = env(a, sr); pk = e.max()
    if pk <= 0: return a
    on = np.where(e > pk * 10 ** (-40 / 20))[0]
    if not len(on): return a
    s = max(0, on[0] - int(pre * sr))
    # loops: the model's first instants and its last ~0.8 s (end-of-sequence hiss) never make it into the loop
    if loop: return a[s + int(0.15 * sr): max(s + int(1.0 * sr), len(a) - int(0.8 * sr))]
    # end: last point above -48 dB of the peak, plus a short tail; never longer than 1.7x the asked length
    short = secs <= 0.5                 # single rounds / clicks: tight, or they smear into each other at fire rate
    end = min(len(a), on[-1] + int(0.06 * sr), s + int(secs * (1.4 if short else 1.7) * sr))
    a = a[s:end].copy()
    f = int(len(a) * 0.35) if short else min(len(a) // 4, int(0.04 * sr))
    if f > 0: a[-f:] *= np.linspace(1, 0, f) ** 2
    return a


def single_step(a, sr):
    """footstep renders sometimes hold two or three steps: keep the strongest one"""
    e = env(a, sr, 3)
    i = int(np.argmax(e))
    s = max(0, i - int(0.012 * sr)); t = min(len(a), i + int(0.26 * sr))
    b = a[s:t].copy(); f = int(0.05 * sr); b[-f:] *= np.linspace(1, 0, f) ** 2
    return b


def add_hf(a, sr, level=0.22):
    """a 7-16 kHz transient crack on the onset (the part a 24 kHz model can't make)"""
    e = env(a, sr, 2); i = int(np.argmax(e[: int(0.15 * sr)])) if len(a) > int(0.15 * sr) else int(np.argmax(e))
    n = np.random.default_rng(7).standard_normal(int(0.06 * sr))
    n = sosfilt(butter(4, [7000, 16000], "bandpass", fs=sr, output="sos"), n)
    t = np.arange(len(n)) / sr
    n *= np.exp(-t / 0.010) * np.minimum(1, t / 0.0008)
    n /= (np.abs(n).max() + 1e-9)
    out = a.copy(); j = min(len(out), i + len(n))
    out[i:j] += n[: j - i] * np.abs(a).max() * level
    return out


def make_loop(a, sr, x=0.25):
    """seamless loop: the tail crossfades into the head (equal power)"""
    n = int(x * sr)
    if len(a) < 3 * n: return a
    head, body, tail = a[:n], a[n:-n], a[-n:]
    k = np.linspace(0, 1, n)
    mix = tail * np.cos(k * np.pi / 2) + head * np.sin(k * np.pi / 2)
    return np.concatenate([body, mix])


def level(a, sr, target_db, peak_db=-1.0):
    e = env(a, sr, 50); act = e[e > e.max() * 0.1]
    rms = np.sqrt(np.mean(act ** 2)) if len(act) else np.sqrt(np.mean(a ** 2))
    g = 10 ** ((target_db - db(rms)) / 20)
    a = a * g
    pk = np.abs(a).max(); lim = 10 ** (peak_db / 20)
    if pk > lim:   # soft-knee limiting instead of a hard scale-down (keeps the body loud)
        a = np.tanh(a / lim * 0.9) * lim / np.tanh(0.9)
    return a


def compress(a, sr, thr_db=-24, ratio=3.0):
    e = env(a, sr, 10); thr = 10 ** (thr_db / 20)
    g = np.ones_like(e); over = e > thr
    g[over] = (thr * (e[over] / thr) ** (1 / ratio)) / e[over]
    g = np.convolve(g, np.ones(int(sr * 0.005)) / int(sr * 0.005), "same")
    return a * g


def encode(a, sr, out, q=5):
    os.makedirs(os.path.dirname(out), exist_ok=True)
    tmp = out[:-4] + ".tmp.wav"
    sf.write(tmp, np.clip(a, -1, 1).astype(np.float32), sr)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-c:a", "libvorbis", "-q:a", str(q), out], check=True)
    os.remove(tmp)


def finish_sfx(bank):
    jobs = {j["id"]: j for j in json.load(open(os.path.join(HERE, "audio", "sfx_list.json"), encoding="utf-8"))}
    n = 0
    for sid, j in jobs.items():
        if sid in SKIP: continue
        takes = []
        for p in glob.glob(os.path.join(WORK, "sfx", sid, "*.wav")):
            m = re.match(r"(\d+)_(-?[\d.]+)\.wav$", os.path.basename(p))
            if m: takes.append((float(m.group(2)), p))
        if not takes: continue
        takes.sort(reverse=True)
        best = takes[0][0]
        if best < 0.12: print("  weak, skipped (synth fallback):", sid, best); continue
        pick = [p for sc, p in takes if sc >= best - 0.08][: (1 if j.get("loop") or sid.startswith("amb_") else 3)]
        c = cat_of(j); sr = 48000
        for k, p in enumerate(pick):
            a = load(p, sr)
            a = trim(a, sr, j["secs"], loop=bool(j.get("loop")))
            if sid.startswith("step") or sid in ("mechstep", "casing", "taikobeat"): a = single_step(a, sr)
            if j.get("hf"): a = add_hf(a, sr)
            a = sosfilt(butter(2, 28, "highpass", fs=sr, output="sos"), a)   # DC / sub rumble
            if j.get("loop"): a = make_loop(a, sr)
            a = level(a, sr, CAT[c])
            encode(a, sr, os.path.join(PUB, sid, f"{k}.ogg"), q=4 if c in ("amb", "loop") else 5)
        bank["sfx"][sid] = {"n": len(pick), "cat": c, **({"loop": True} if j.get("loop") else {})}
        n += 1
    print("sfx:", n, "sounds")


def synth_sonic(bank):
    """Hibiki's Subwoofer Blaster round, designed rather than generated (text-to-audio has no idea what a 'sonic blaster'
    is): a saturated sub-bass wub (90 -> 42 Hz), an FM zap riding on it (1.4 kHz -> 380 Hz), a bright transient click and
    a short dark tail. Three variations, a semitone apart."""
    sr = 48000
    for k, semi in enumerate((0.0, -0.8, 0.9)):
        r = 2 ** (semi / 12)
        n = int(0.34 * sr); t = np.arange(n) / sr
        f_sub = 42 * r + (90 - 42) * r * np.exp(-t / 0.045)
        sub = np.sin(2 * np.pi * np.cumsum(f_sub) / sr) * np.exp(-t / 0.11)
        sub = np.tanh(sub * 2.6) * 0.8
        f_zap = 380 * r + (1400 - 380) * r * np.exp(-t / 0.03)
        mod = np.sin(2 * np.pi * np.cumsum(f_zap * 2.01) / sr) * 2.2 * np.exp(-t / 0.05)
        zap = np.sin(2 * np.pi * np.cumsum(f_zap) / sr + mod) * np.exp(-t / 0.055) * 0.45
        click = np.random.default_rng(k).standard_normal(n) * np.exp(-t / 0.0025) * 0.6
        click = sosfilt(butter(2, 3000, "highpass", fs=sr, output="sos"), click)
        a = sub + zap + click
        a *= np.minimum(1, t / 0.0015)
        tail = sosfilt(butter(2, 900, "lowpass", fs=sr, output="sos"), np.random.default_rng(10 + k).standard_normal(n)) * np.exp(-t / 0.09) * 0.08
        a = add_hf(a + tail, sr, 0.15)
        a = level(a, sr, CAT["weapon"])
        encode(a, sr, os.path.join(PUB, "sonic", f"{k}.ogg"))
    bank["sfx"]["sonic"] = {"n": 3, "cat": "weapon"}


def finish_voice(bank):
    from voice_lines import LINES, BANK_OF
    bank["banks"] = BANK_OF
    n = 0
    for v in LINES:
        d = os.path.join(WORK, "voice", v)
        if not os.path.isdir(d): continue
        best = {}
        for p in glob.glob(os.path.join(d, "*.wav")):
            m = re.match(r"(.+)_(\d+)_(\d+)_([\d.]+)\.wav$", os.path.basename(p))
            if not m: continue
            key = (m.group(1), int(m.group(2))); sc = float(m.group(4))
            if key not in best or sc > best[key][0]: best[key] = (sc, p)
        vb = bank["vo"].setdefault(v, {})
        for (key, i), (sc, p) in sorted(best.items()):
            words = len(LINES[v][key][i][0].split())
            # one- and two-word shouts ("Two.", "Hakkeyoi!") are hard for ASR to spell back: a lower bar for them
            if sc < (0.25 if words <= 2 else 0.5) and not key.startswith(("pain", "death", "jump", "land", "burn")):
                print("  low-confidence line kept out:", v, key, i, sc); continue
            sr = 24000
            a = load(p, sr)
            a = trim(a, sr, 6.0)
            a = sosfilt(butter(2, 90, "highpass", fs=sr, output="sos"), a)
            a = compress(a, sr)
            a = level(a, sr, CAT["voice"] + (2 if key in ("ult", "death") else 0))
            encode(a, sr, os.path.join(PUB, "vo", v, f"{key}_{i}.ogg"), q=4)
            vb[key] = max(vb.get(key, 0), i + 1)
            n += 1
    print("voice:", n, "lines")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--only", default="")
    a = ap.parse_args()
    path = os.path.join(PUB, "bank.json")
    bank = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}
    bank.setdefault("sfx", {}); bank.setdefault("vo", {})
    if a.only in ("", "sfx"): bank["sfx"] = {}; finish_sfx(bank); synth_sonic(bank)
    if a.only in ("", "voice"): bank["vo"] = {}; finish_voice(bank)
    os.makedirs(PUB, exist_ok=True)
    json.dump(bank, open(path, "w", encoding="utf-8"), indent=1)
    print("bank ->", path)
