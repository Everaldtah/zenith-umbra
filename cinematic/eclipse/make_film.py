#!/usr/bin/env python3
"""Cut "The Sun That Refused to Set": painted keyframes + Seedance 2.5 clips -> a limited-animation anime film.

    python make_film.py [--draft] [--only o01,a07] [--no-web]
Inputs  work/keys/<shot>.(jpg|png|webp)   painted keyframe per shot (Seedance AI image editor)
        work/clips/<shot>.mp4             animated cut for the `motion` shots (Seedance 2.5, first frame = the keyframe)
        work/vo/index.json + wavs         Kokoro lines (voice.py)
        ../../public/film/music/<cue>.mp3 the score cues named in the script
Outputs work/eclipse_master.mp4 (1080p24), ../../public/film/eclipse.mp4 (720p web), eclipse.vtt, eclipse_poster.webp

The look, shot by shot (script.py): episode cards are white condensed serif on black (a late-90s mecha-film card); stills
are held frames brought to life the way limited TV animation does it - a camera move over the painting (push / pull /
pan / tilt / shake), a particle layer screened over it (rain, embers, sparks, stars, speed lines, glow, smoke), impact
flashes on cuts, grain and a vignette; motion shots play the Seedance clip, eased a little slower, then hold on its last
frame. Cuts are hard (anime cutting); cards fade. The score follows the script's cue per shot, crossfaded between cues
and ducked under dialogue.
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
NAMES = {'n': '', 'haruto': 'HARUTO', 'kaien': 'KAIEN', 'mirei': 'MIREI', 'nocturne': 'NOCTURNE', 'vorn': 'VORN', 'raijin': 'RAIJIN',
         'yuzu': 'YUZU', 'qelvaris': "QEL'VARIS", 'enra': 'ENRA', 'kagemaru': 'KAGEMARU', 'hex': 'HEX', 'all': 'ALL'}


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
    for ext in ('png', 'jpg', 'jpeg', 'webp'):
        p = os.path.join(W, 'keys', f'{sid}.{ext}')
        if os.path.exists(p): return p
    return None


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


def motion_seg(sid, secs, out):
    clip = os.path.join(W, 'clips', f'{sid}.mp4')
    if DRAFT or not os.path.exists(clip):
        return still_seg(sid, secs, 'push|glow', out)
    dur = probe_secs(clip)
    slow = min(1.25, max(1.0, secs / max(dur, 0.1)))         # eased a touch slower (animation on twos reads fine)
    hold = max(0.0, secs - dur * slow) + 0.1
    vf = (f"setpts={slow:.4f}*PTS,scale={RW}:{RH}:force_original_aspect_ratio=increase:flags=lanczos,crop={RW}:{RH},"
          f"tpad=stop_mode=clone:stop_duration={hold:.2f},{LOOK},format=yuv420p")
    run(['ffmpeg', '-y', '-v', 'error', '-i', clip, '-vf', vf, '-t', f'{secs:.3f}', *enc(out)])


def card_seg(sid, secs, text, out):
    png = card_png(sid, text)
    vf = f"fade=t=in:st=0:d=0.5,fade=t=out:st={secs - 0.6:.2f}:d=0.6,format=yuv420p"
    run(['ffmpeg', '-y', '-v', 'error', '-loop', '1', '-i', png, '-vf', vf, '-t', f'{secs:.3f}', *enc(out)])


# ------------------------------------------------------------------ audio
def load_audio(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'], capture_output=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2).copy()


def mix(shots, vo):
    total = sum(s[1] for s in shots)
    N = int(total * SR) + SR
    music, voice = np.zeros((N, 2), np.float32), np.zeros((N, 2), np.float32)
    subs = []
    t0 = 0.0
    spans = []                                                # (cue, start, end)
    for s in shots:
        if spans and spans[-1][0] == s[7]: spans[-1][2] = t0 + s[1]
        else: spans.append([s[7], t0, t0 + s[1]])
        # dialogue: the shot's lines one after another from 0.4s in
        t = t0 + 0.4
        for k, (who, text) in enumerate(s[6]):
            v = vo.get((s[0], k))
            if not v or not os.path.exists(v['file']): t += 2.5; continue
            a = load_audio(v['file']) * 1.0
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
    out = music * gain[:, None] + voice * 1.1
    out /= max(1.0, np.abs(out).max() / 0.89)
    return out, subs, total


def vtt(subs, path):
    f = lambda t: f"{int(t // 3600):02d}:{int(t % 3600 // 60):02d}:{t % 60:06.3f}"
    with open(path, 'w', encoding='utf-8') as o:
        o.write('WEBVTT\n\n')
        for i, (a, b, text) in enumerate(subs, 1):
            o.write(f"{i}\n{f(a)} --> {f(b)}\n{text}\n\n")


def main():
    shots = [s for s in SC.S if not ONLY or s[0] in ONLY]
    vo = {(v['shot'], v['k']): v for v in json.load(open(os.path.join(W, 'vo', 'index.json')))}
    segs = []
    for s in shots:
        sid, secs, kind = s[0], float(s[1]), s[2]
        out = os.path.join(SEG, f'{sid}.mp4')
        if kind == 'card': card_seg(sid, secs, s[4], out)
        elif kind == 'motion': motion_seg(sid, secs, out)
        else: still_seg(sid, secs, s[5], out)
        segs.append(out); print('shot', sid, kind, secs, flush=True)
    lst = os.path.join(W, 'concat.txt')
    with open(lst, 'w') as o: o.writelines(f"file '{p.replace(os.sep, '/')}'\n" for p in segs)
    audio, subs, total = mix(shots, vo)
    wav = os.path.join(W, 'mix.f32')
    audio.astype(np.float32).tofile(wav)
    master = os.path.join(W, 'eclipse_master.mp4')
    run(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', wav,
         '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-t', f'{total:.3f}', '-movflags', '+faststart', master])
    vtt(subs, os.path.join(W, 'eclipse.vtt'))
    print('master', master, f'{total:.1f}s', flush=True)
    if '--no-web' in sys.argv or ONLY: return
    film = os.path.join(ROOT, 'public', 'film')
    run(['ffmpeg', '-y', '-v', 'error', '-i', master, '-vf', 'scale=1280:720:flags=lanczos', '-c:v', 'libx264', '-crf', '25', '-preset', 'slow',
         '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', os.path.join(film, 'eclipse.mp4')])
    vtt(subs, os.path.join(film, 'eclipse.vtt'))
    pk = key_path('f03') or key_path('o01')
    if pk: Image.open(pk).convert('RGB').resize((1280, 720), Image.LANCZOS).save(os.path.join(film, 'eclipse_poster.webp'), quality=84)
    print('web', os.path.getsize(os.path.join(film, 'eclipse.mp4')) / 1e6, 'MB')


if __name__ == '__main__':
    main()
