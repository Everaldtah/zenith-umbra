"""tile <dir>/<n>.png into one sheet: python tests/e2e/tile.py out.png [cols] [size] [dir]
(dir defaults to tests/e2e/shots/strip; captures running in parallel pass their own)"""
import sys, os
from PIL import Image
d = sys.argv[4] if len(sys.argv) > 4 else 'tests/e2e/shots/strip'
fs = sorted((f for f in os.listdir(d) if f.endswith('.png') and f[:-4].isdigit()), key=lambda f: int(f[:-4]))
out, cols, S = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 5, int(sys.argv[3]) if len(sys.argv) > 3 else 320
ims = [Image.open(os.path.join(d, f)).convert('RGB') for f in fs]
for im in ims: im.thumbnail((S, S))
rows = (len(ims) + cols - 1) // cols
s = Image.new('RGB', (S * cols, S * rows))
for i, im in enumerate(ims): s.paste(im, ((i % cols) * S, (i // cols) * S))
s.save(out)
