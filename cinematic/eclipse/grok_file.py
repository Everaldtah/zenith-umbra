#!/usr/bin/env python3
"""File Grok Imagine downloads into work/clips by matching each video's first frame to the painted keyframes.

    python grok_file.py [--unpack] [--apply] [--force]
--unpack  split ~/Downloads/zu_pack_*.bin (a 10-digit header length, a JSON header [{n,p,size}], then the raw mp4s,
          built in the grok.com tab by window.__pack) into work/grok_dl/post_<id8>.mp4
--apply   copy the best match for each shot to work/clips/<shot>.mp4 (a shot that already has a Grok clip is kept
          unless --force); without it, only prints the matches
Grok's image-to-video starts on the uploaded image, so frame 0 identifies the shot. Variants of one shot are ranked by
how well the whole clip holds the keyframe's look (mean distance of 4 sampled frames); the best one wins.
"""
import glob, json, os, shutil, subprocess, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
W = os.path.join(HERE, 'work')
DL, CLIPS, KEYS = os.path.join(W, 'grok_dl'), os.path.join(W, 'clips'), os.path.join(W, 'keys')
LOG = os.path.join(W, 'grok_filed.json')
DOWNLOADS = os.path.expanduser('~/Downloads')
os.makedirs(DL, exist_ok=True)


def unpack():
    for f in sorted(glob.glob(os.path.join(DOWNLOADS, 'zu_pack_*.bin'))):
        with open(f, 'rb') as fh:
            data = fh.read()
        n = int(data[:10]); head = json.loads(data[10:10 + n]); off = 10 + n
        for h in head:
            if 'size' not in h: print('  missing', h); continue
            out = os.path.join(DL, f"post_{h['p'][:8]}.mp4")
            with open(out, 'wb') as o: o.write(data[off:off + h['size']])
            off += h['size']
        if off != len(data): print('  WARNING size mismatch', f, off, len(data)); continue
        os.remove(f); print('unpacked', os.path.basename(f), len(head))


def thumb(img):
    return np.asarray(img.convert('RGB').resize((64, 36), Image.BILINEAR), np.float32) / 255.0


def frame(path, t):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(t), '-i', path, '-frames:v', '1', '-vf', 'scale=64:36',
                        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True)
    if len(r.stdout) != 64 * 36 * 3: return None
    return np.frombuffer(r.stdout, np.uint8).reshape(36, 64, 3).astype(np.float32) / 255.0


def main():
    if '--unpack' in sys.argv: unpack()
    keys = {os.path.splitext(k)[0]: thumb(Image.open(os.path.join(KEYS, k))) for k in os.listdir(KEYS)}
    log = json.load(open(LOG)) if os.path.exists(LOG) else {}
    best = {}
    for v in sorted(glob.glob(os.path.join(DL, 'post_*.mp4'))):
        f0 = frame(v, 0.05)
        if f0 is None: print('unreadable', v); continue
        d = sorted((float(np.abs(f0 - k).mean()), s) for s, k in keys.items())
        (d1, shot), (d2, s2) = d[0], d[1]
        hold = np.mean([np.abs(fr - keys[shot]).mean() for fr in (frame(v, t) for t in (1.5, 3, 4.5, 5.8)) if fr is not None])
        ok = d1 < 0.06 and d2 - d1 > 0.02
        print(f"{os.path.basename(v)}  -> {shot:5s} d={d1:.3f} (next {s2} {d2:.3f}) hold={hold:.3f} {'' if ok else '?? UNSURE'}")
        if ok and (shot not in best or hold < best[shot][0]): best[shot] = (hold, v)
    if '--apply' in sys.argv:
        queued = set(json.load(open(os.path.join(W, 'grok_jobs.json'))))       # only shots that were sent to Grok
        prev = os.path.join(W, 'clips_prev'); os.makedirs(prev, exist_ok=True)
        for shot, (hold, v) in sorted(best.items()):
            if shot not in queued: print('skip (not a Grok job)', shot, os.path.basename(v)); continue
            if log.get(shot) and not '--force' in sys.argv and log[shot]['src'] != os.path.basename(v):
                if log[shot]['hold'] <= hold: continue
            dst = os.path.join(CLIPS, f'{shot}.mp4')
            if os.path.exists(dst) and not log.get(shot) and not os.path.exists(os.path.join(prev, f'{shot}.mp4')):
                shutil.copyfile(dst, os.path.join(prev, f'{shot}.mp4'))      # keep the clip this replaces
            shutil.copyfile(v, dst)
            log[shot] = {'src': os.path.basename(v), 'hold': round(float(hold), 4)}
            print('filed', shot, '<-', os.path.basename(v))
        json.dump(log, open(LOG, 'w'), indent=1)
    print('grok clips filed:', len(log), sorted(log))


if __name__ == '__main__':
    main()
