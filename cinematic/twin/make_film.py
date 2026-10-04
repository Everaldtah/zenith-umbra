#!/usr/bin/env python3
"""Cut "TWIN DRAGONS": Grok keyframes + grok-imagine-video-1.5-lite clips -> a 10-minute anime film.

Same cutter as cinematic/eclipse/make_film.py (The Sun That Refused to Set), with: dict shots (script.py), a timing pass
(every shot at least as long as its dialogue, then clip shots stretched up to 1.3x so the cut reaches TARGET seconds),
clip trims (script.USE), the masked-Hayate voice filter, and twin_* outputs.

    python make_film.py [--draft] [--only o01,a07] [--no-web] [--timing]
Inputs  work/keys/<shot>.jpg              keyframe per shot (keys.py: grok-imagine-image edits from key art / anchors)
        work/clips/<shot>.mp4             grok-imagine-video-1.5-lite 720p image-to-video from that keyframe (clips.py)
        work/clip_audio.json              which clips' own generated sound is clean effects (clip_audio.py, Whisper)
        work/vo/index.json + wavs         Kokoro lines (voice.py)
        ../../public/film/music/<cue>.mp3 the score cues named in the script
        ../../public/sfx/<name>/          game SFX used as accents where a clip has no usable sound
Outputs work/twin_master.mp4 (1080p24) + twin_dragons.srt, ../../public/film/twin_dragons.mp4 (720p, two-pass to WEB_MB), .vtt,
        twin_poster.webp, twin_teaser.mp4 (silent header loop), ../../src/site/film_twin.ts (chapter marks)

The look, shot by shot (script.py): episode cards are white condensed serif on black (a late-90s mecha-film card); every
other shot plays its clip, eased up to 1.34x slower (animation on twos reads fine), and a clip shorter than its shot keeps
a slow push-in through the held last frame; a shot without a clip falls back to a camera move over the painting with a
particle layer. Grain and a vignette over everything; cuts are hard, cards fade. Sound: the score follows the script's
cue per shot, crossfaded and ducked under dialogue; each clip's own effects track (unless Whisper hears invented dialogue
or music in it) is stretched with its picture and levelled under the voices; soft limiter on the master.
"""
import json, math, os, subprocess, sys, importlib.util
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
W = os.path.join(HERE, 'work')
SEG, FX = os.path.join(W, 'seg'), os.path.join(W, 'fx')
for d in (SEG, FX): os.makedirs(d, exist_ok=True)
spec = importlib.util.spec_from_file_location('script', os.path.join(HERE, 'script.py'))
SC = importlib.util.module_from_spec(spec); spec.loader.exec_module(SC)

FPS, RW, RH, SR = 24, 1920, 1080, 48000
DRAFT = '--draft' in sys.argv
ONLY = set(sys.argv[sys.argv.index('--only') + 1].split(',')) if '--only' in sys.argv else None
NAMES = SC.NAMES
TARGET = 606.0                                                # seconds: the user bought "10 minutes" of film


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        print(' '.join(map(str, cmd))[:600]); print(r.stderr[-2000:]); raise SystemExit(1)
    return r.stdout


def probe_secs(p):
    return float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]).strip() or 0)


def enc(out, crf=15):
    return ['-an', '-r', str(FPS), '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', str(crf), '-preset', 'medium', out]


# ------------------------------------------------------------------ particle layers (black background, screened on)
def fx_layer(name, secs=6):
    """a looping particle plate: rain / embers / sparks / stars / speed / glow / smoke"""
    out = os.path.join(FX, f'{name}.mp4')
    if os.path.exists(out): return out
    rng = np.random.default_rng(abs(hash(name)) % 2**32)
    n = secs * FPS
    w, h = RW // 2, RH // 2                        # drawn at half size, scaled up soft
    p = subprocess.Popen(['ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{w}x{h}', '-r', str(FPS), '-i', '-',
                          '-vf', f'scale={RW}:{RH}:flags=bicubic', *enc(out, 18)], stdin=subprocess.PIPE)
    K = {'rain': 260, 'embers': 90, 'sparks': 70, 'stars': 160, 'speed': 70, 'glow': 1, 'smoke': 18}[name]
    pos = rng.random((K, 2)) * [w, h]; vel = np.zeros((K, 2)); ph = rng.random(K) * 6.28
    if name == 'rain': vel[:] = [-2.2, 26]; vel *= rng.uniform(0.7, 1.3, (K, 1))
    if name == 'embers': vel[:, 0] = rng.normal(0, 0.5, K); vel[:, 1] = -rng.uniform(0.6, 2.2, K)
    if name == 'sparks': vel[:, 0] = rng.normal(0, 6, K); vel[:, 1] = rng.uniform(-8, 3, K)
    if name == 'smoke': vel[:, 0] = rng.uniform(0.3, 1.2, K); vel[:, 1] = -rng.uniform(0.1, 0.5, K)
    for f in range(n):
        im = Image.new('RGB', (w, h)); d = ImageDraw.Draw(im)
        t = f / FPS
        if name == 'glow':
            r = min(w, h) * (0.32 + 0.04 * math.sin(t * 2.2))
            g = Image.new('L', (w, h)); ImageDraw.Draw(g).ellipse([w / 2 - r, h / 2 - r, w / 2 + r, h / 2 + r], fill=150)
            g = g.filter(ImageFilter.GaussianBlur(r * 0.45))
            im = Image.merge('RGB', (g, g.point(lambda v: int(v * 0.78)), g.point(lambda v: int(v * 0.35))))
        elif name == 'speed':
            cx, cy = w / 2, h / 2
            for k in range(K):
                a = ph[k] + f * 0.37 * (k % 3)
                r0 = 0.28 * w + (k * 37 + f * 23) % (0.2 * w)
                r1 = r0 + 0.25 * w
                d.line([(cx + math.cos(a) * r0, cy + math.sin(a) * r0), (cx + math.cos(a) * r1, cy + math.sin(a) * r1)], fill=(235, 235, 235), width=1 + k % 2)
        else:
            pos += vel
            if name == 'sparks': vel[:, 1] += 0.35
            pos[:, 0] %= w; pos[:, 1] %= h
            for k in range(K):
                x, y = pos[k]
                if name == 'rain':
                    d.line([(x, y), (x - vel[k, 0] * 0.6, y - vel[k, 1] * 0.6)], fill=(150, 170, 200), width=1)
                elif name == 'embers':
                    b = 0.6 + 0.4 * math.sin(t * 5 + ph[k]); s = 1 + k % 3
                    d.ellipse([x - s, y - s, x + s, y + s], fill=(int(255 * b), int(140 * b), int(40 * b)))
                elif name == 'sparks':
                    d.line([(x, y), (x - vel[k, 0], y - vel[k, 1])], fill=(255, 225, 140), width=2)
                elif name == 'stars':
                    b = max(0.0, math.sin(t * 1.7 + ph[k])); s = 1 if k % 5 else 2
                    c = int(220 * b); d.ellipse([x - s, y - s, x + s, y + s], fill=(c, c, int(c * 1.1) if c < 232 else 255))
                elif name == 'smoke':
                    r = 40 + k * 3
                    d.ellipse([x - r, y - r, x + r, y + r], fill=(26, 24, 30))
            if name == 'smoke': im = im.filter(ImageFilter.GaussianBlur(28))
        p.stdin.write(im.tobytes())
    p.stdin.close(); p.wait()
    return out


# ------------------------------------------------------------------ shots
def font(size):
    for f in ['C:/Windows/Fonts/timesbd.ttf', 'C:/Windows/Fonts/georgiab.ttf', 'C:/Windows/Fonts/arialbd.ttf']:
        if os.path.exists(f): return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def card_png(sid, text):
    """a white condensed-serif card on black: lines drawn wide, then squeezed horizontally"""
    out = os.path.join(SEG, f'{sid}_card.png')
    lines = text.split('\n')
    big = Image.new('L', (int(RW * 1.45), RH))
    d = ImageDraw.Draw(big)
    sizes = [150 if len(lines) == 1 else 96] + [150] * (len(lines) - 1)
    if len(lines) > 1: sizes = [96] + [min(170, int(2400 / max(8, len(l)))) for l in lines[1:]]
    hs = [d.textbbox((0, 0), l, font=font(s)) for l, s in zip(lines, sizes)]
    total = sum(b[3] - b[1] for b in hs) + 60 * (len(lines) - 1)
    y = (RH - total) / 2
    for l, s, b in zip(lines, sizes, hs):
        x = (big.width - (b[2] - b[0])) / 2
        d.text((x, y - b[1]), l, font=font(s), fill=255)
        y += b[3] - b[1] + 60
    im = big.resize((RW, RH), Image.LANCZOS)                   # the squeeze: tall condensed letterforms
    Image.merge('RGB', (im, im, im)).save(out)
    return out


def key_path(sid):
    if sid in REUSE: sid = REUSE[sid]
    for ext in ('png', 'jpg', 'jpeg', 'webp'):
        p = os.path.join(W, 'keys', f'{sid}.{ext}')
        if os.path.exists(p): return p
    return None


REUSE = {s['id']: s['key'][1:] for s in SC.S if s['kind'] == 'still' and s['key'].startswith('@')}
CAM = {  # zoompan expressions over n frames (on = output frame index): zoom, x, y
    'push': ("1+0.12*on/{n}", "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"),
    'pull': ("1.12-0.12*on/{n}", "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"),
    'panL': ("1.14", "(iw-iw/zoom)*(1-on/{n})", "ih/2-(ih/zoom/2)"),
    'panR': ("1.14", "(iw-iw/zoom)*on/{n}", "ih/2-(ih/zoom/2)"),
    'tiltU': ("1.14", "iw/2-(iw/zoom/2)", "(ih-ih/zoom)*(1-on/{n})"),
    'tiltD': ("1.14", "iw/2-(iw/zoom/2)", "(ih-ih/zoom)*on/{n}"),
    'hold': ("1+0.025*on/{n}", "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"),
    'shake': ("1.1", "iw/2-(iw/zoom/2)+sin(on*1.9)*iw*0.006+sin(on*3.1)*iw*0.004", "ih/2-(ih/zoom/2)+cos(on*2.3)*ih*0.006"),
}
LOOK = "noise=alls=7:allf=t,vignette=PI/5"


def still_seg(sid, secs, cam_fx, out):
    key = key_path(sid)
    cam, *fxs = (cam_fx or 'hold').split('|')
    fxs = [f for f in fxs if f]
    n = int(round(secs * FPS))
    if not key:                                               # not painted yet: a dark plate with the shot id
        im = Image.new('RGB', (RW, RH), (12, 10, 18)); ImageDraw.Draw(im).text((60, 60), f'[{sid}]', font=font(48), fill=(90, 80, 110))
        key = os.path.join(SEG, f'{sid}_missing.png'); im.save(key)
    z, x, y = CAM.get(cam, CAM['hold'])
    zp = f"zoompan=z='{z.format(n=n)}':x='{x.format(n=n)}':y='{y.format(n=n)}':d={n}:s={RW}x{RH}:fps={FPS}"
    base = f"scale=3840:2160:force_original_aspect_ratio=increase:flags=lanczos,crop=3840:2160,{zp}"
    inputs, graph = ['-loop', '1', '-i', key], f"[0:v]{base}[v0]"
    last = 'v0'
    for i, f in enumerate(k for k in fxs if k in ('rain', 'embers', 'sparks', 'stars', 'speed', 'glow', 'smoke')):
        inputs += ['-stream_loop', '-1', '-i', fx_layer(f)]
        mode = 'multiply' if f == 'smoke' else 'screen'
        op = {'glow': 0.55, 'speed': 0.5, 'rain': 0.55, 'smoke': 0.35}.get(f, 0.85)
        if f == 'smoke':                                      # smoke darkens: invert the plate so it multiplies in shadow
            graph += f";[{i + 1}:v]negate,format=gbrp[p{i}];[{last}]format=gbrp[b{i}];[b{i}][p{i}]blend=all_mode={mode}:all_opacity={op}[v{i + 1}]"
        else:
            graph += f";[{i + 1}:v]format=gbrp[p{i}];[{last}]format=gbrp[b{i}];[b{i}][p{i}]blend=all_mode={mode}:all_opacity={op}[v{i + 1}]"
        last = f'v{i + 1}'
    tail = LOOK
    if 'flash' in fxs: tail += ",fade=t=in:st=0:d=0.35:color=white"
    graph += f";[{last}]{tail},format=yuv420p[out]"
    run(['ffmpeg', '-y', '-v', 'error', *inputs, '-filter_complex', graph, '-map', '[out]', '-t', f'{secs:.3f}', *enc(out)])


SLOW = {}                                                     # shot -> clip playback stretch (the SFX bed follows it)


def clip_path(sid):
    p = os.path.join(W, 'clips', f'{sid}.mp4')
    return p if os.path.exists(p) else None


def motion_seg(sid, secs, out, cam_fx=''):
    clip = clip_path(sid)
    if DRAFT or not clip:
        return still_seg(sid, secs, cam_fx or 'push|glow', out)
    dur = SC.USE.get(sid) or probe_secs(clip)
    slow = min(1.34, max(1.0, secs / max(dur, 0.1)))         # eased a touch slower (animation on twos reads fine)
    SLOW[sid] = slow
    hold = max(0.0, secs - dur * slow) + 0.1
    tail = LOOK + (",fade=t=in:st=0:d=0.35:color=white" if 'flash' in (cam_fx or '').split('|') else '')
    if hold > 0.8:                                            # a short clip: keep the camera pushing through the held frame
        n = int(round(secs * FPS))
        vf = (f"setpts={slow:.4f}*PTS,fps={FPS},scale=3840:2160:force_original_aspect_ratio=increase:flags=lanczos,crop=3840:2160,"
              f"tpad=stop_mode=clone:stop_duration={hold:.2f},"
              f"zoompan=z='1+0.07*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={RW}x{RH}:fps={FPS},{tail},format=yuv420p")
    else:
        vf = (f"setpts={slow:.4f}*PTS,scale={RW}:{RH}:force_original_aspect_ratio=increase:flags=lanczos,crop={RW}:{RH},"
              f"tpad=stop_mode=clone:stop_duration={hold:.2f},{tail},format=yuv420p")
    trim = ['-t', f'{SC.USE[sid]:.2f}'] if sid in SC.USE else []
    run(['ffmpeg', '-y', '-v', 'error', *trim, '-i', clip, '-vf', vf, '-t', f'{secs:.3f}', *enc(out)])


def card_seg(sid, secs, text, out):
    png = card_png(sid, text)
    vf = f"fade=t=in:st=0:d=0.5,fade=t=out:st={secs - 0.6:.2f}:d=0.6,format=yuv420p"
    run(['ffmpeg', '-y', '-v', 'error', '-loop', '1', '-i', png, '-vf', vf, '-t', f'{secs:.3f}', *enc(out)])


# ------------------------------------------------------------------ audio
def load_audio(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'], capture_output=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2).copy()


SFX_BANK = os.path.join(ROOT, 'public', 'sfx')
# accents for shots whose clip has no usable sound of its own: (words in the shot's prompts, game SFX, gain)
ACCENTS = [(('explod', 'erupt', 'smash', 'crash'), 'boom', 0.9), (('lightning', 'thunder'), 'thunderclap', 0.7),
           (('shatter', 'cracks', 'breaks'), 'barrierbreak', 0.8), (('fire', 'flame', 'burning', 'embers'), 'flame', 0.35),
           (('wind', 'storm', 'glide'), 'wind', 0.45), (('hammer',), 'hammer', 0.8), (('katana', 'sword', 'blade'), 'katana', 0.6),
           (('wings', 'flight'), 'wings', 0.5), (('stars', 'starlight', 'constellation'), 'star', 0.35),
           (('talisman', 'seal'), 'talisman', 0.5), (('arrow', 'bow'), 'bow', 0.6), (('chain',), 'chainthrow', 0.6),
           (('drill', 'lance'), 'lance', 0.7), (('roar', 'laugh'), 'roar', 0.6), (('flash',), 'sunburst', 0.5)]


def bank_sfx(name):
    d = os.path.join(SFX_BANK, name)
    fs = sorted(os.listdir(d)) if os.path.isdir(d) else []
    return load_audio(os.path.join(d, fs[0])) if fs else None


def clip_bed(sid, secs):
    """the clip's own generated sound, stretched like its picture, levelled, faded at the cut; None if unusable"""
    scr = SCREEN.get(sid)
    clip = clip_path(sid)
    if not clip or not scr or not scr.get('has') or scr.get('speech') or scr.get('music'): return None
    slow = SLOW.get(sid, 1.0)
    trim = ['-t', f'{SC.USE[sid]:.2f}'] if sid in SC.USE else []
    raw = subprocess.run(['ffmpeg', '-v', 'error', *trim, '-i', clip, '-vn', '-af', f'atempo={1 / slow:.4f}', '-f', 'f32le', '-ac', '2',
                          '-ar', str(SR), '-'], capture_output=True).stdout
    a = np.frombuffer(raw, np.float32).reshape(-1, 2).copy()[:int(secs * SR)]
    if len(a) < SR // 4: return None
    rms = float(np.sqrt(np.mean(a ** 2))) or 1e-4
    a *= min(4.0, 0.075 / rms)                               # level every bed to about -22 dBFS RMS
    fi, fo = int(0.03 * SR), min(len(a) // 3, int(0.25 * SR))
    a[:fi] *= np.linspace(0, 1, fi)[:, None]; a[-fo:] *= np.linspace(1, 0, fo)[:, None]
    return a


def soft_limit(x, t=0.72, ceil=0.95):
    m = np.abs(x) > t
    x[m] = np.sign(x[m]) * (t + (ceil - t) * np.tanh((np.abs(x[m]) - t) / (ceil - t)))
    return x


SCREEN = {}


def mix(shots, vo):
    total = sum(s[1] for s in shots)
    N = int(total * SR) + SR
    music, voice, sfx = np.zeros((N, 2), np.float32), np.zeros((N, 2), np.float32), np.zeros((N, 2), np.float32)
    SCREEN.update(json.load(open(os.path.join(W, 'clip_audio.json'))) if os.path.exists(os.path.join(W, 'clip_audio.json')) else {})
    bank, beds, accents = {}, 0, 0
    subs = []
    t0 = 0.0
    spans = []                                                # (cue, start, end)
    for s in shots:
        if spans and spans[-1][0] == s[7]: spans[-1][2] = t0 + s[1]
        else: spans.append([s[7], t0, t0 + s[1]])
        if s[2] == 'clip':                                    # sound effects: the clip's own bed, else accents from the prompts
            i = int(t0 * SR)
            bed = clip_bed(s[0], s[1])
            if bed is not None:
                sfx[i:i + len(bed)] += bed[:N - i]; beds += 1
            else:
                words = (str(s[4]) + ' ' + str(s[5])).lower()
                for keys, name, g in [a for a in ACCENTS if any(k in words for k in a[0])][:2]:
                    x = bank.setdefault(name, bank_sfx(name))
                    if x is None: continue
                    j = i + int(0.12 * SR); x = x[:max(0, min(len(x), N - j, int(s[1] * SR)))]
                    sfx[j:j + len(x)] += x * g; accents += 1
        # dialogue: the shot's lines one after another from 0.4s in
        t = t0 + 0.4
        for k, (who, text) in enumerate(s[6]):
            v = vo.get((s[0], k))
            if not v or not os.path.exists(v['file']): t += 2.5; continue
            a = load_audio(v['file']) * 1.0
            if who == 'hayate_m':                             # behind the helmet: a short metallic comb + a touch of grit
                d = int(0.0065 * SR); b = a.copy(); b[d:] += 0.55 * a[:-d]; a = np.tanh(b * 1.15) * 0.85
            i = int(t * SR); a = a[:max(0, N - i)]
            voice[i:i + len(a)] += a
            subs.append((t, t + len(a) / SR, (NAMES.get(who, who.upper()) + ': ' if NAMES.get(who, who.upper()) else '') + text))
            t += len(a) / SR + 0.35
        t0 += s[1]
    cache = {}
    X = int(1.5 * SR)                                         # crossfade between cues
    for cue, a, b in spans:
        p = os.path.join(ROOT, 'public', 'film', 'music', f'{cue}.mp3')
        if not os.path.exists(p): continue
        m = cache.setdefault(cue, load_audio(p))
        i0, i1 = max(0, int(a * SR) - X // 2), min(N, int(b * SR) + X // 2)
        L = i1 - i0
        seg = np.tile(m, (L // len(m) + 1, 1))[:L]
        env = np.ones(L, np.float32); r = min(X, L // 2)
        env[:r] = np.linspace(0, 1, r); env[-r:] = np.linspace(1, 0, r)
        music[i0:i1] += seg * env[:, None]
    # duck the score under dialogue (smoothed envelope)
    act = (np.abs(voice).max(1) > 0.01).astype(np.float32)
    k = int(0.35 * SR); ker = np.ones(k, np.float32) / k
    duck = np.convolve(act, ker, 'same').clip(0, 1)
    gain = 0.5 - 0.3 * duck
    out = music * gain[:, None] + voice * 1.1 + sfx * (0.8 - 0.4 * duck)[:, None]
    out = soft_limit(out)
    print(f'mix: {beds} clip sound beds, {accents} accents', flush=True)
    return out, subs, total


def srt(subs, path):
    """SubRip copy of the subtitles for the YouTube upload"""
    f = lambda t: f"{int(t // 3600):02d}:{int(t % 3600 // 60):02d}:{int(t % 60):02d},{int(round(t % 1 * 1000)) % 1000:03d}"
    with open(path, 'w', encoding='utf-8') as o:
        for i, (a, b, text) in enumerate(subs, 1):
            o.write(f"{i}\n{f(a)} --> {f(b)}\n{text}\n\n")


def vtt(subs, path):
    f = lambda t: f"{int(t // 3600):02d}:{int(t % 3600 // 60):02d}:{t % 60:06.3f}"
    with open(path, 'w', encoding='utf-8') as o:
        o.write('WEBVTT\n\n')
        for i, (a, b, text) in enumerate(subs, 1):
            o.write(f"{i}\n{f(a)} --> {f(b)}\n{text}\n\n")


def timing(vo):
    """(id, secs, kind, chars, key, cam/motion, lines, cue) tuples: dialogue fits, then clips stretch toward TARGET"""
    rows = []
    for s in SC.S:
        need = 0.0
        if s['lines']:
            need = 0.4 + sum(vo[(s['id'], k)]['secs'] for k in range(len(s['lines'])) if (s['id'], k) in vo) + 0.35 * (len(s['lines']) - 1) + 0.6
        secs = max(float(s['secs']), need)
        cap = secs
        if s['kind'] == 'clip':
            cp = clip_path(s['id'])
            dur = SC.USE.get(s['id']) or (probe_secs(cp) if cp else s['gen'])
            cap = max(secs, dur * 1.3)
        cam = s['fx'] if s['kind'] == 'still' else s['motion']
        rows.append([s['id'], secs, s['kind'], s['chars'], s['key'], cam, s['lines'], s['cue'], cap])
    total = sum(r[1] for r in rows)
    room = sum(r[8] - r[1] for r in rows)
    if total < TARGET and room > 0:                           # stretch every clip shot by the same share of its headroom
        f = min(1.0, (TARGET - total) / room)
        for r in rows: r[1] = round(r[1] + (r[8] - r[1]) * f, 2)
    return [tuple(r[:8]) for r in rows]


def main():
    vo = {(v['shot'], v['k']): v for v in json.load(open(os.path.join(W, 'vo', 'index.json')))}
    shots = [s for s in timing(vo) if not ONLY or s[0] in ONLY]
    if '--timing' in sys.argv:
        t = 0.0
        for s in shots: print(f"{s[0]:4s} {s[2]:5s} {t:7.1f} +{s[1]:5.2f}"); t += s[1]
        print('total', round(t, 1), 's =', f'{int(t // 60)}:{t % 60:04.1f}'); return
    segs = []
    for s in shots:
        sid, secs, kind = s[0], float(s[1]), s[2]
        out = os.path.join(SEG, f'{sid}.mp4')
        if kind == 'card': card_seg(sid, secs, s[4], out)
        elif kind == 'clip': motion_seg(sid, secs, out)
        else: still_seg(sid, secs, s[5], out)
        segs.append(out); print('shot', sid, kind, secs, flush=True)
    lst = os.path.join(W, 'concat.txt')
    with open(lst, 'w') as o: o.writelines(f"file '{p.replace(os.sep, '/')}'\n" for p in segs)
    audio, subs, total = mix(shots, vo)
    wav = os.path.join(W, 'mix.f32')
    audio.astype(np.float32).tofile(wav)
    master = os.path.join(W, 'twin_master.mp4')
    run(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', wav,
         '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-t', f'{total:.3f}', '-movflags', '+faststart', master])
    vtt(subs, os.path.join(W, 'twin_dragons.vtt')); srt(subs, os.path.join(W, 'twin_dragons.srt'))
    print('master', master, f'{total:.1f}s', flush=True)
    if '--no-web' in sys.argv or ONLY: return
    film = os.path.join(ROOT, 'public', 'film')
    # 720p two-pass, sized to WEB_MB: the film is committed to git (GitHub refuses files over 100 MB) and served by Vercel
    kbps = int(WEB_MB * 8e3 / total) - 128
    passlog = os.path.join(W, 'x264pass')
    common = ['-vf', 'scale=1280:720:flags=lanczos', '-c:v', 'libx264', '-b:v', f'{kbps}k', '-maxrate', f'{int(kbps * 2.5)}k',
              '-bufsize', f'{kbps * 4}k', '-preset', 'slow', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-passlogfile', passlog]
    run(['ffmpeg', '-y', '-v', 'error', '-i', master, *common, '-pass', '1', '-an', '-f', 'mp4', os.devnull])
    run(['ffmpeg', '-y', '-v', 'error', '-i', master, *common, '-pass', '2', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
         os.path.join(film, 'twin_dragons.mp4')])
    vtt(subs, os.path.join(film, 'twin_dragons.vtt'))
    pk = key_path('e12') or key_path('o01')
    if pk: Image.open(pk).convert('RGB').resize((1280, 720), Image.LANCZOS).save(os.path.join(film, 'twin_poster.webp'), quality=84)
    teaser(shots, film)
    chapters(shots)
    print('web', os.path.getsize(os.path.join(film, 'twin_dragons.mp4')) / 1e6, 'MB', f'({kbps} kb/s video)')


WEB_MB = 85
TEASER = ['o03', 'a02', 'a09', 'b07', 'c04', 'c07', 'e09', 'e10', 'e11', 'e12', 'f06']   # the silent loop behind the site's title


def teaser(shots, film):
    """a ~22 s muted loop of the action peaks (2.4 s from the middle of each cut) for the site header"""
    t0, starts = 0.0, {}
    for s in shots: starts[s[0]] = (t0, s[1]); t0 += s[1]
    parts = [(starts[k][0] + max(0.0, starts[k][1] / 2 - 1.2), 2.4) for k in TEASER if k in starts]
    if not parts: return
    master = os.path.join(W, 'twin_master.mp4')
    graph = ''.join(f"[0:v]trim=start={a:.2f}:duration={d},setpts=PTS-STARTPTS[t{i}];" for i, (a, d) in enumerate(parts))
    graph += ''.join(f'[t{i}]' for i in range(len(parts))) + f"concat=n={len(parts)}:v=1:a=0,scale=1280:720:flags=lanczos,format=yuv420p[v]"
    run(['ffmpeg', '-y', '-v', 'error', '-i', master, '-filter_complex', graph, '-map', '[v]', '-an', '-c:v', 'libx264', '-crf', '28',
         '-preset', 'slow', '-movflags', '+faststart', os.path.join(film, 'twin_teaser.mp4')])


def headline(line):
    small = {'of', 'the', 'a', 'an', 'and', 'to', 'in', 'on'}
    return ' '.join(w if k and w in small else w.capitalize() for k, w in enumerate(line.strip().lower().split()))


def chapters(shots):
    """src/site/film.ts: a chapter mark at the cold open and at every episode card"""
    marks, t0 = [], 0.0
    for s in shots:
        if s[0] == 't00': marks.append((t0, 'Cold open'))
        elif s[2] == 'card' and '\n' in s[4] and 'ZENITH' not in s[4]:
            marks.append((t0, ' - '.join(headline(l) for l in s[4].split('\n'))))
        t0 += s[1]
    body = ', '.join(f'[{a:.1f}, {json.dumps(n)}]' for a, n in marks)
    with open(os.path.join(ROOT, 'src', 'site', 'film_twin.ts'), 'w', encoding='utf-8') as o:
        o.write('// chapter marks for "Twin Dragons" (written by cinematic/twin/make_film.py from script.py)\n'
                f'export const TWIN_CHAPTERS: [number, string][] = [{body}];\n'
                f'export const TWIN_LENGTH = {sum(s[1] for s in shots):.1f};\n')


if __name__ == '__main__':
    main()
