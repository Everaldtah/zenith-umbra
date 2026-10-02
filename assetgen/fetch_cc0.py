# Free (CC0) surfaces and image-based lighting for the desktop maps.
#
#   python assetgen/fetch_cc0.py            fetch what's missing, rebuild public/env/pbr/*
#   python assetgen/fetch_cc0.py --force    rebuild every output (downloads stay cached in assetgen/out/cc0)
#
# Sources (all CC0 / public domain, no attribution required - credited in public/env/pbr/CREDITS.txt anyway):
#   Poly Haven textures  https://polyhaven.com/textures  (2K albedo, OpenGL normal, ARM = AO / roughness / metalness)
#   Poly Haven HDRIs     https://polyhaven.com/hdris     (1K .hdr, image-based lighting)
#   Kenney Particle Pack https://kenney.nl/assets/particle-pack (sprites for the gunfire effects -> public/fx)
#
# Each map slot keeps the map's own art direction: a photo albedo is recoloured to the painted texture it replaces
# (its mean colour and contrast in Lab, the photo's chroma noise damped, a light edge-preserving smooth so it reads
# painted rather than photographed); slots marked albedo=False keep the painted texture and only take the set's relief
# (normal) and AO / roughness. HDRIs are clamped (the sun is the scene's directional light - a second sun in the
# environment would double-light everything), normalised to a mean luminance of 1 and the sun's bearing recorded so
# the runtime can turn the sky to match the map's sun.
import json, os, sys, struct, urllib.request
import numpy as np
import cv2

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'assetgen', 'out', 'cc0')
OUT = os.path.join(ROOT, 'public', 'env', 'pbr')
PAINTED = os.path.join(ROOT, 'public', 'env')
FORCE = '--force' in sys.argv
SAT = 0.5                                 # HDRI saturation kept (see build_hdri)
UA = {'User-Agent': 'Mozilla/5.0 (zenith-umbra asset fetch)'}

# texture sets: Poly Haven id -> tile size in metres (one repeat), metal: ARM blue channel is used as metalness
SETS = {
    'japanese_stone_wall':   {'tile': 4.0},
    'japanese_cedar_planks': {'tile': 3.0},
    'grey_roof_tiles':       {'tile': 2.5},
    'grey_roof_tiles_02':    {'tile': 2.5},
    'ceramic_roof_01':       {'tile': 2.5},
    'grassy_cobblestone':    {'tile': 4.0},
    'white_stucco':          {'tile': 3.0},
    'plastered_wall':        {'tile': 3.0},
    'concrete_pavement':     {'tile': 4.0},
    'monastery_stone_floor': {'tile': 4.0},
    'marble_01':             {'tile': 4.0},
    'metal_plate':           {'tile': 2.0, 'metal': True},
    'brick_wall_10':         {'tile': 3.0},
    'rusty_corrugated_iron': {'tile': 2.5, 'metal': True},
    'cracked_red_ground':    {'tile': 5.0},
    'asphalt_02':            {'tile': 5.0},
    'cliff_side':            {'tile': 8.0},
    'dry_ground_rocks':      {'tile': 5.0},
    'weathered_planks':      {'tile': 3.0},
    'old_sandstone_02':      {'tile': 6.0},
    'concrete_floor_02':     {'tile': 4.0},
}

# map -> slot -> (set, albedo[, lightness lift in Lab L, 0-255 scale]). albedo: True = the photo recoloured to the painted palette, 'raw' = the photo's own colours,
# False = keep the painted texture). Slots: ground wall roof rock wood trim. A painted slot the map doesn't
# have (no roof / rock texture) is painted the way MapScene already does (the wall texture, tinted).
MAPS = {
    'hanabi':    {'ground': ('japanese_stone_wall', True, 14), 'wall': ('japanese_cedar_planks', True), 'roof': ('grey_roof_tiles', True),
                  'wood': ('japanese_cedar_planks', True), 'trim': ('plastered_wall', False)},
    'cloudstep': {'ground': ('grassy_cobblestone', True), 'wall': ('white_stucco', False), 'roof': ('ceramic_roof_01', True),
                  'wood': ('japanese_cedar_planks', True), 'trim': ('plastered_wall', False)},
    'kagura':    {'ground': ('concrete_pavement', True), 'wall': ('plastered_wall', False), 'roof': ('grey_roof_tiles', True),
                  'wood': ('japanese_cedar_planks', True), 'trim': ('plastered_wall', False)},
    'lantern':   {'ground': ('monastery_stone_floor', True, 12), 'wall': ('white_stucco', False), 'roof': ('grey_roof_tiles_02', True),
                  'wood': ('japanese_cedar_planks', True), 'trim': ('plastered_wall', False)},
    'starfall':  {'ground': ('marble_01', True), 'wall': ('marble_01', False), 'roof': ('ceramic_roof_01', True),
                  'wood': ('japanese_cedar_planks', True), 'trim': ('marble_01', False)},
    'foundry':   {'ground': ('metal_plate', True), 'wall': ('brick_wall_10', True, 22), 'roof': ('rusty_corrugated_iron', 'raw'),
                  'wood': ('weathered_planks', True), 'trim': ('metal_plate', False)},
    'mile':      {'ground': ('cracked_red_ground', True), 'wall': ('white_stucco', False), 'roof': ('asphalt_02', True),
                  'rock': ('cliff_side', True), 'wood': ('weathered_planks', True), 'trim': ('plastered_wall', False)},
    'gulch':     {'ground': ('dry_ground_rocks', True), 'wall': ('weathered_planks', True), 'roof': ('rusty_corrugated_iron', 'raw'),
                  'rock': ('old_sandstone_02', True), 'wood': ('weathered_planks', True), 'trim': ('weathered_planks', False)},
    'training':  {'ground': ('concrete_floor_02', False), 'wall': ('plastered_wall', False), 'trim': ('plastered_wall', False)},
}
# the painted colour a slot without its own texture stands for (MapScene: wood = wall x #a8744a, roof = wall x #7d6a5a)
SLOT_TINT = {'wood': (0xa8, 0x74, 0x4a), 'roof': (0x7d, 0x6a, 0x5a), 'trim': (0xd8, 0xd2, 0xc8)}

# map -> (Poly Haven HDRI, mood: its fill relative to the others - bright-sun day maps need less sky fill than dusk / night
# ones; set from tests/e2e/render_ab.mjs so each map keeps its old overall brightness[, saturation kept, default SAT])
HDRIS = {
    'hanabi': ('golden_bay', 1.0, 0.2), 'cloudstep': ('kloofendal_48d_partly_cloudy_puresky', 0.55), 'kagura': ('zhengyang_gate', 0.75),
    'lantern': ('cobblestone_street_night', 0.8, 0.3), 'starfall': ('industrial_sunset_puresky', 0.8), 'foundry': ('freight_station', 0.85),
    'mile': ('goegap', 1.1), 'gulch': ('goegap_road', 1.0), 'training': ('wide_street_01', 0.8),
}


def fetch(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0: return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    print('  get', url)
    data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120).read()
    with open(path + '.part', 'wb') as f: f.write(data)
    os.replace(path + '.part', path)
    return path


def files(asset):
    p = os.path.join(CACHE, f'{asset}.files.json')
    if not os.path.exists(p): fetch(f'https://api.polyhaven.com/files/{asset}', p)
    with open(p, encoding='utf8') as f: return json.load(f)


def set_maps(asset):
    """2K albedo, OpenGL normal, ARM jpgs of a Poly Haven texture (cached)"""
    j = files(asset)
    out = {}
    for key, kind in (('Diffuse', 'diff'), ('nor_gl', 'nor'), ('arm', 'arm')):
        url = j[key]['2k']['jpg']['url']
        out[kind] = fetch(url, os.path.join(CACHE, asset, f'{kind}_2k.jpg'))
    return out


def imread(p):
    return cv2.imdecode(np.fromfile(p, np.uint8), cv2.IMREAD_UNCHANGED)


def imwrite_webp(p, img, q):
    ok, buf = cv2.imencode('.webp', img, [cv2.IMWRITE_WEBP_QUALITY, q])
    assert ok, p
    buf.tofile(p)


def painted_stats(map_id, slot):
    """mean / std of the painted texture this slot replaces, in Lab (OpenCV 8-bit Lab)"""
    own = os.path.join(PAINTED, f'tex_{map_id}_{slot}.webp')
    tint = None
    if not os.path.exists(own):
        own = os.path.join(PAINTED, f'tex_{map_id}_wall.webp')
        tint = SLOT_TINT.get(slot)
    img = imread(own)[:, :, :3].astype(np.float32)
    if tint is not None:                      # BGR x tint (MapScene multiplies the wall texture by the slot colour)
        img = img * (np.array(tint[::-1], np.float32) / 255.0)
    lab = cv2.cvtColor(img.clip(0, 255).astype(np.uint8), cv2.COLOR_BGR2LAB).astype(np.float32)
    return lab.reshape(-1, 3).mean(0), lab.reshape(-1, 3).std(0)


def recolour(diff_path, map_id, slot, raw=False, dL=0):
    """the photo albedo in the painted texture's palette: Lab mean match, contrast eased toward the painted one, chroma
    noise damped, then an edge-preserving smooth (the painted look). raw: only the smooth and the saturation lift"""
    img = imread(diff_path)[:, :, :3]
    img = cv2.bilateralFilter(img, 7, 28, 5)
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
    m, s = lab.reshape(-1, 3).mean(0), lab.reshape(-1, 3).std(0) + 1e-3
    pm, ps = painted_stats(map_id, slot)
    if raw:                                   # the photo's own colours at the painted texture's lightness
        lab[:, :, 0] = lab[:, :, 0] - m[0] + pm[0] + dL
        out = cv2.cvtColor(lab.clip(0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)
        hsv = cv2.cvtColor(out, cv2.COLOR_BGR2HSV).astype(np.float32)
        hsv[:, :, 1] = np.clip(hsv[:, :, 1] * 1.12, 0, 255)
        return cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)
    L = (lab[:, :, 0] - m[0]) * np.clip((ps[0] / s[0]) ** 0.5, 0.6, 1.4) + pm[0] + dL
    a = (lab[:, :, 1] - m[1]) * 0.55 + pm[1]
    b = (lab[:, :, 2] - m[2]) * 0.55 + pm[2]
    out = cv2.cvtColor(np.dstack([L, a, b]).clip(0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)
    # a touch more saturation: the hero-shooter palette is clean, not dusty
    hsv = cv2.cvtColor(out, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[:, :, 1] = np.clip(hsv[:, :, 1] * 1.12, 0, 255)
    return cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)


# ---------------------------------------------------------------- HDR (Radiance RGBE) read / write (OpenCV)
def read_hdr(path):
    bgr = cv2.imdecode(np.fromfile(path, np.uint8), cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)
    return bgr[:, :, ::-1].astype(np.float32)


def write_hdr(path, rgb):
    ok, buf = cv2.imencode('.hdr', np.ascontiguousarray(rgb[:, :, ::-1]).astype(np.float32))
    assert ok, path
    buf.tofile(path)


def build_hdri(map_id, asset, mood, sat=None):
    sat = SAT if sat is None else sat
    j = files(asset)
    src = fetch(j['hdri']['1k']['hdr']['url'], os.path.join(CACHE, 'hdri', f'{asset}_1k.hdr'))
    dst = os.path.join(OUT, f'hdr_{map_id}.hdr')
    rgb = read_hdr(src)
    H, W, _ = rgb.shape
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    # the sun: the brightest blob (blurred so a lamp pixel doesn't win), its bearing in three's equirect convention
    # (column u -> phi = (u - 0.5) * 2pi = atan2(z, x); row 0 = straight up)
    blur = cv2.GaussianBlur(lum, (0, 0), 6)
    y, x = np.unravel_index(np.argmax(blur), blur.shape)
    phi = ((x + 0.5) / W - 0.5) * 2 * np.pi
    elev = (0.5 - (y + 0.5) / H) * np.pi
    # mean luminance, solid-angle weighted (equirect rows shrink toward the poles)
    wrow = np.cos((0.5 - (np.arange(H) + 0.5) / H) * np.pi)[:, None]
    mean = float((lum * wrow).sum() / (wrow.sum() * W))
    # clamp the sun and other hot spots (8x the mean): direct sunlight is the map's DirectionalLight
    cap = 8.0 * mean
    k = np.minimum(1.0, cap / np.maximum(lum, 1e-6))
    rgb = rgb * k[:, :, None]
    lum2 = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    mean2 = float((lum2 * wrow).sum() / (wrow.sum() * W))
    rgb = rgb / max(mean2, 1e-6)              # mean luminance 1 (the runtime scales by the map's environment intensity)
    # half the HDRI's own colour: the map's hemisphere light already carries its mood, and a deep blue-hour sky over a
    # stone street lit it violet (its irradiance from straight up is all sky)
    l3 = (rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32))[:, :, None]
    rgb = l3 + (rgb - l3) * sat
    if FORCE or not os.path.exists(dst): write_hdr(dst, rgb.astype(np.float32))
    return {'file': f'hdr_{map_id}.hdr', 'src': asset, 'sunPhi': round(float(phi), 4), 'sunElev': round(float(elev), 4), 'mood': mood}


# Kenney Particle Pack (CC0, https://kenney.nl/assets/particle-pack): sprites for the desktop gunfire effects
# (src/render/WeaponFx.ts) -> public/fx/<name>.webp, 256 px, white with alpha (the effect tints them)
KENNEY_URL = 'https://kenney.nl/media/pages/assets/particle-pack/f8fe0f8cb8-1677578741/kenney_particle-pack.zip'
KENNEY = ['star_06', 'star_08', 'star_09', 'magic_05', 'smoke_01', 'smoke_02', 'smoke_04', 'smoke_05', 'smoke_06', 'smoke_07',
          'scorch_01', 'scorch_02', 'scorch_03', 'dirt_01', 'dirt_02', 'dirt_03', 'circle_05', 'muzzle_02', 'muzzle_03']
FX_OUT = os.path.join(ROOT, 'public', 'fx')


def build_kenney():
    import zipfile
    z = fetch(KENNEY_URL, os.path.join(CACHE, 'kenney_particle-pack.zip'))
    os.makedirs(FX_OUT, exist_ok=True)
    with zipfile.ZipFile(z) as zf:
        for name in KENNEY:
            dst = os.path.join(FX_OUT, f'{name}.webp')
            if os.path.exists(dst) and not FORCE: continue
            data = np.frombuffer(zf.read(f'PNG (Transparent)/{name}.png'), np.uint8)
            img = cv2.imdecode(data, cv2.IMREAD_UNCHANGED)
            img = cv2.resize(img, (256, 256), interpolation=cv2.INTER_AREA)
            imwrite_webp(dst, img, 90)
    with open(os.path.join(FX_OUT, 'CREDITS.txt'), 'w', encoding='utf8') as f:
        f.write('Particle sprites: Kenney Particle Pack (CC0) - https://kenney.nl/assets/particle-pack\n' + ', '.join(KENNEY) + '\n')


def main():
    build_kenney()
    os.makedirs(OUT, exist_ok=True)
    man = {'sets': {}, 'maps': {}, 'hdri': {}}
    used = sorted({spec[0] for slots in MAPS.values() for spec in slots.values()})
    for asset in used:
        print('set', asset)
        src = set_maps(asset)
        n_out, arm_out = os.path.join(OUT, f'{asset}_n.webp'), os.path.join(OUT, f'{asset}_arm.webp')
        if FORCE or not os.path.exists(n_out):
            imwrite_webp(n_out, imread(src['nor'])[:, :, :3], 90)
        if FORCE or not os.path.exists(arm_out):
            arm = cv2.resize(imread(src['arm'])[:, :, :3], (1024, 1024), interpolation=cv2.INTER_AREA)
            imwrite_webp(arm_out, arm, 90)
        man['sets'][asset] = {'tile': SETS[asset]['tile'], 'metal': bool(SETS[asset].get('metal')), 'n': f'{asset}_n.webp', 'arm': f'{asset}_arm.webp'}
    for map_id, slots in MAPS.items():
        man['maps'][map_id] = {}
        for slot, spec in slots.items():
            asset, albedo = spec[0], spec[1]
            dL = spec[2] if len(spec) > 2 else 0
            entry = {'set': asset}
            if albedo:
                c_out = os.path.join(OUT, f'{map_id}_{slot}_c.webp')
                if FORCE or not os.path.exists(c_out):
                    print('albedo', map_id, slot, '<-', asset)
                    imwrite_webp(c_out, recolour(set_maps(asset)['diff'], map_id, slot, albedo == 'raw', dL), 86)
                entry['c'] = f'{map_id}_{slot}_c.webp'
            man['maps'][map_id][slot] = entry
    for map_id, spec in HDRIS.items():
        print('hdri', map_id, '<-', spec[0])
        man['hdri'][map_id] = build_hdri(map_id, *spec)
    with open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf8') as f: json.dump(man, f, indent=1)
    with open(os.path.join(OUT, 'CREDITS.txt'), 'w', encoding='utf8') as f:
        f.write('Surfaces and HDRIs in this folder are derived from CC0 (public domain) assets by Poly Haven - https://polyhaven.com\n')
        f.write('Textures: ' + ', '.join(used) + '\n')
        f.write('HDRIs: ' + ', '.join(sorted({spec[0] for spec in HDRIS.values()})) + '\n')
    total = sum(os.path.getsize(os.path.join(OUT, x)) for x in os.listdir(OUT))
    print(f'done: {len(os.listdir(OUT))} files, {total / 1e6:.1f} MB in public/env/pbr')


if __name__ == '__main__':
    main()
