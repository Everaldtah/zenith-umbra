# python tests/e2e/tile_ab.py hanabi,mile [out.jpg] - classic | new side by side for render_ab.mjs shots, mean luminance each
import sys
from PIL import Image, ImageStat
ids = sys.argv[1].split(','); out = sys.argv[2] if len(sys.argv) > 2 else 'tests/e2e/shots/ab_sheet.jpg'
W, H = 800, 450
rows = [(m, k) for m in ids for k in (0, 1)]
sheet = Image.new('RGB', (W * 2, H * len(rows)))
for r, (m, k) in enumerate(rows):
    for c, mode in enumerate(('classic', 'new')):
        im = Image.open(f'tests/e2e/shots/ab_{m}_{k}_{mode}.png').convert('RGB')
        lum = ImageStat.Stat(im.convert('L').crop((0, 60, im.width, im.height - 60))).mean[0]
        print(f'{m} {k} {mode:8s} lum {lum:6.1f}')
        sheet.paste(im.resize((W, H)), (c * W, r * H))
sheet.save(out, quality=82)
