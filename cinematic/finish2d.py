"""Finish the 2D film's drawings for the web.
 art: every painted key drawing -> isnet-anime cutout, trimmed, <=1100 px tall, WebP with alpha   -> public/film2d/art/<name>.webp
 bg:  every painted background -> a multiplane: depth (Depth-Anything V2) splits it into far / mid / near layers; the parts a
      nearer layer covers are inpainted in the layer behind it, so the parallax pan never reveals a ghost copy
                                                                    -> public/film2d/bg/<name>_far.webp, <name>.webp, <name>_near.webp
 manifest.json lists every file for the player's preloader.
    python finish2d.py <art dir>[,<art dir>...] [--bg <bg dir>]
"""
import argparse, glob, json, os
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.join(HERE, '..', 'public', 'film2d')
ART, BG = os.path.join(PUB, 'art'), os.path.join(PUB, 'bg')


def art(dirs):
    from rembg import remove, new_session
    sess = new_session('isnet-anime')
    os.makedirs(ART, exist_ok=True)
    for d in dirs:
        for p in sorted(glob.glob(os.path.join(d, '*.png'))):
            name = os.path.basename(p)[:-4]
            if name.endswith(('_raw', '_depth')): continue
            out = os.path.join(ART, f'{name}.webp')
            if os.path.exists(out) and os.path.getmtime(out) > os.path.getmtime(p): continue
            im = Image.open(p)
            if im.mode != 'RGBA' or np.asarray(im)[..., 3].min() == 255: im = remove(im.convert('RGB'), session=sess)
            a = np.asarray(im)[..., 3]
            a = np.where(a > 24, a, 0).astype(np.uint8)          # drop the matte's faint halo
            im.putalpha(Image.fromarray(a))
            bb = im.getbbox()
            if name.split('_', 1)[1].startswith('face'): bb = (0, 0, *im.size)   # keep portraits' framing
            elif bb: bb = (bb[0], bb[1], bb[2], im.height)                          # keep the feet line at the image bottom
            im = im.crop(bb)
            k = min(1.0, 1100 / im.height); im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
            im.save(out, quality=90, method=6)
            print('art', name, im.size, flush=True)


def bg(d):
    import cv2
    from transformers import pipeline as hf_pipeline
    dpt = hf_pipeline('depth-estimation', model='depth-anything/Depth-Anything-V2-Small-hf', device=0)
    os.makedirs(BG, exist_ok=True)
    for p in sorted(glob.glob(os.path.join(d, '*.png'))):
        name = os.path.basename(p)[:-4]
        im = Image.open(p).convert('RGB').resize((1920, 1080), Image.LANCZOS)
        im = im.filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))
        depth = np.asarray(dpt(im)['depth'].resize(im.size), dtype=np.float32)
        depth = (depth - depth.min()) / max(1e-3, np.ptp(depth))       # 1 = near
        rgb = np.asarray(im)
        t_mid, t_near = np.percentile(depth, 55), np.percentile(depth, 88)

        def layer(th):
            m = (depth >= th).astype(np.uint8) * 255
            m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
            return cv2.GaussianBlur(m, (0, 0), 2.5)

        def fill(img, mask):   # inpaint what the nearer layer hides, at half res, then upsample into the hole only
            small = cv2.resize(img, (960, 540), interpolation=cv2.INTER_AREA)
            ms = cv2.resize(cv2.dilate(mask, np.ones((15, 15), np.uint8)), (960, 540)) > 64
            f = cv2.inpaint(small, ms.astype(np.uint8) * 255, 9, cv2.INPAINT_TELEA)
            f = cv2.GaussianBlur(cv2.resize(f, (1920, 1080), interpolation=cv2.INTER_CUBIC), (0, 0), 1.5)
            k = (cv2.dilate(mask, np.ones((15, 15), np.uint8)).astype(np.float32) / 255)[..., None]
            return (img * (1 - k) + f * k).astype(np.uint8)

        mm, mn = layer(t_mid), layer(t_near)
        far = fill(rgb, mm)
        mid = fill(rgb, mn)
        Image.fromarray(far).save(os.path.join(BG, f'{name}_far.webp'), quality=88, method=6)
        Image.fromarray(np.dstack([mid, mm])).save(os.path.join(BG, f'{name}.webp'), quality=88, method=6)
        Image.fromarray(np.dstack([rgb, mn])).save(os.path.join(BG, f'{name}_near.webp'), quality=88, method=6)
        print('bg', name, flush=True)


def manifest():
    a = sorted(os.path.basename(p)[:-5] for p in glob.glob(os.path.join(ART, '*.webp')))
    b = sorted(os.path.basename(p)[:-5] for p in glob.glob(os.path.join(BG, '*.webp')))
    json.dump({'art': a, 'bg': b}, open(os.path.join(PUB, 'manifest.json'), 'w'))
    print('manifest', len(a), 'drawings', len(b), 'plate layers')


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('art', nargs='?', default=''); ap.add_argument('--bg', default='')
    a = ap.parse_args()
    if a.art: art([x for x in a.art.split(',') if x])
    if a.bg: bg(a.bg)
    manifest()
