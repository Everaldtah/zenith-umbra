# App icon: dark tile, gold ring, Tenkai-Oh portrait over a crimson/blue split.
from PIL import Image, ImageDraw
from pathlib import Path
here = Path(__file__).parent
S = 256
tile = Image.new('RGBA', (S, S), (0, 0, 0, 0))
mask = Image.new('L', (S, S), 0); ImageDraw.Draw(mask).rounded_rectangle((4, 4, S - 4, S - 4), 48, fill=255)
bg = Image.new('RGBA', (S, S)); d = ImageDraw.Draw(bg)
d.polygon([(0, 0), (S * 0.62, 0), (S * 0.38, S), (0, S)], fill=(40, 120, 190, 255)); d.polygon([(S * 0.62, 0), (S, 0), (S, S), (S * 0.38, S)], fill=(170, 20, 50, 255))
por = Image.open(here.parent / 'public' / 'img' / 'portrait_tenkai.webp').convert('RGBA').resize((S - 40, S - 40), Image.LANCZOS)
bg.alpha_composite(por, (20, 20))
tile.paste(bg, (0, 0), mask)
ImageDraw.Draw(tile).rounded_rectangle((4, 4, S - 4, S - 4), 48, outline=(255, 215, 106, 255), width=8)
tile.save(here / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
tile.save(here / 'icon.png')
tile.save(here.parent / 'public' / 'img' / 'icon.png')
print('icon ok')
