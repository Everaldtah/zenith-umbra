"""Frame-strip contact sheet for clips: each row = one clip, 5 frames across its length -> work/qc/clips_<name>.jpg"""
import os, sys, subprocess
from PIL import Image, ImageDraw
HERE = os.path.dirname(os.path.abspath(__file__)); W = os.path.join(HERE, 'work'); C = os.path.join(W, 'clips')


def frames(p, n=5, w=320, h=180):
    d = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p], capture_output=True, text=True).stdout or 0)
    out = []
    for k in range(n):
        t = d * (k + 0.5) / n
        r = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{t:.2f}', '-i', p, '-frames:v', '1', '-vf', f'scale={w}:{h}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True)
        out.append(Image.frombytes('RGB', (w, h), r.stdout) if len(r.stdout) == w * h * 3 else Image.new('RGB', (w, h)))
    return out, d


name, ids = sys.argv[1], sys.argv[2:]
rows = []
for i in ids:
    p = os.path.join(C, f'{i}.mp4')
    if not os.path.exists(p): continue
    fr, d = frames(p)
    row = Image.new('RGB', (320 * 5, 180))
    for k, f in enumerate(fr): row.paste(f, (k * 320, 0))
    ImageDraw.Draw(row).text((6, 4), f'{i} {d:.1f}s', fill=(255, 255, 0))
    rows.append(row)
sheet = Image.new('RGB', (1600, 180 * len(rows)))
for k, r in enumerate(rows): sheet.paste(r, (0, k * 180))
out = os.path.join(W, 'qc', f'clips_{name}.jpg'); sheet.save(out, quality=80); print(out)
