"""Cut the film: clips retimed to the timeline, score crossfaded and ducked under dialogue, foley, title card.
    python assemble.py [--draft]   (draft: keyframe stills with a slow push-in instead of animated clips)
Inputs  work/clips/<shot>.mp4 (or work/keys/<shot>.png), work/vo/*.wav, work/music/<cue>.wav, work/sfx/<shot>.wav
Outputs work/zenith_origin.mp4 + work/zenith_origin.vtt
"""
import json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
W = os.path.join(HERE, 'work')
TL = json.load(open(os.path.join(W, 'timeline.json')))
DRAFT = '--draft' in sys.argv
FPS, RES = 24, (1920, 1080)
SEG = os.path.join(W, 'seg'); os.makedirs(SEG, exist_ok=True)


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode: print(' '.join(cmd)[:400]); print(r.stderr[-1500:]); raise SystemExit(1)


def seg(s):
    """one shot -> exactly s.secs of 1080p24 video"""
    out = os.path.join(SEG, f"{s['id']}.mp4")
    d = s['secs']
    clip = os.path.join(W, 'clips', f"{s['id']}.mp4")
    key = os.path.join(W, 'keys', f"{s['id']}.png")
    sc = f"scale={RES[0]}:{RES[1]}:force_original_aspect_ratio=increase:flags=lanczos,crop={RES[0]}:{RES[1]}"
    if os.path.exists(clip) and not DRAFT:
        dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', clip], capture_output=True, text=True).stdout or 4)
        k = d / dur
        # longer than the clip: slow it (motion interpolated) up to 1.6x, then hold the last frame
        slow = min(k, 1.6)
        vf = f"setpts={slow:.4f}*PTS,minterpolate=fps={FPS}:mi_mode=mci:mc_mode=aobmc:vsbmc=1,{sc},tpad=stop_mode=clone:stop_duration={max(0, d - dur * slow) + 0.1:.2f},format=yuv420p"
        run(['ffmpeg', '-y', '-v', 'error', '-i', clip, '-vf', vf, '-t', f'{d:.3f}', '-r', str(FPS), '-an', '-c:v', 'libx264', '-crf', '14', '-preset', 'medium', out])
    else:
        n = int(d * FPS) + 1
        vf = f"scale=3840:-2,zoompan=z='min(1+0.0009*on,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={n}:s={RES[0]}x{RES[1]}:fps={FPS},format=yuv420p"
        run(['ffmpeg', '-y', '-v', 'error', '-loop', '1', '-i', key, '-vf', vf, '-t', f'{d:.3f}', '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', out])
    return out


def title_card():
    """ZENITH//UMBRA over the last shot, in the game's display font"""
    from PIL import Image, ImageDraw, ImageFont
    font_path = os.path.join(W, 'Orbitron.ttf')
    if not os.path.exists(font_path):
        from fontTools.ttLib import TTFont
        f = TTFont(os.path.join(HERE, '..', 'public', 'fonts', 'orbitron-800.woff2')); f.flavor = None; f.save(font_path)
    img = Image.new('RGBA', RES, (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    f1 = ImageFont.truetype(font_path, 150); f2 = ImageFont.truetype(font_path, 38)
    t1, t2 = 'ZENITH//UMBRA', 'THE OATH AT DAWN'
    w1 = d.textlength(t1, font=f1); w2 = d.textlength(t2, font=f2)
    from PIL import ImageFilter
    x1 = (RES[0] - w1) / 2
    # soft golden glow behind solid lettering
    glow = Image.new('RGBA', RES, (0, 0, 0, 0)); ImageDraw.Draw(glow).text((x1, 400), t1, font=f1, fill=(255, 190, 70, 200), stroke_width=8, stroke_fill=(255, 190, 70, 200))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(22)))
    # vertical gold gradient fill, masked by the text
    mask = Image.new("L", RES, 0); ImageDraw.Draw(mask).text((x1, 400), t1, font=f1, fill=255, stroke_width=5, stroke_fill=255)
    grad = Image.new('RGBA', RES)
    for y in range(400, 600):
        k = (y - 400) / 200
        ImageDraw.Draw(grad).line([(0, y), (RES[0], y)], fill=(255, int(248 - 60 * k), int(225 - 150 * k), 255))
    img.paste(grad, (0, 0), mask)
    d.text(((RES[0] - w2) / 2, 610), t2, font=f2, fill=(230, 236, 255, 235), stroke_width=1, stroke_fill=(230, 236, 255, 235))
    p = os.path.join(W, 'title.png'); img.save(p); return p


def main():
    shots = TL['shots']
    segs = [seg(s) for s in shots]
    # ---- picture: concat with short dissolves at beat changes (hard cuts inside a beat, anime-style)
    lst = os.path.join(W, 'segs.txt')
    open(lst, 'w').write(''.join(f"file '{p.replace(os.sep, '/')}'\n" for p in segs))
    pic = os.path.join(W, 'picture.mp4')
    run(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', pic])
    total = TL['total']
    title = title_card()
    last = TL['beats'][-1]
    vf = (f"[0:v][1:v]overlay=0:0:enable='gte(t,{last['at'] + 0.8})':format=auto,"
          f"fade=t=in:st=0:d=1.5,fade=t=out:st={total - 1.5:.2f}:d=1.5[v]")
    # ---- sound
    inputs = ['-i', pic, '-loop', '1', '-i', title]
    filt, mix = [vf], []
    idx = 2
    for c in TL['cues']:
        f = os.path.join(W, 'music', f"{c['cue']}.wav")
        if not os.path.exists(f): continue
        inputs += ['-i', f]
        filt.append(f"[{idx}:a]atrim=0:{c['secs'] + 1.5:.2f},afade=t=in:d=1.2,afade=t=out:st={c['secs'] - 0.3:.2f}:d=1.8,adelay={int(c['start'] * 1000)}|{int(c['start'] * 1000)},volume=0.55[m{idx}]")
        mix.append(f"[m{idx}]"); idx += 1
    music_n = len(mix)
    vo = []
    for b in TL['beats']:
        for ln in b['lines']:
            inputs += ['-i', ln['file']]
            filt.append(f"[{idx}:a]aresample=48000,adelay={int(ln['at'] * 1000)}|{int(ln['at'] * 1000)},volume=1.6[v{idx}]")
            vo.append(f"[v{idx}]"); idx += 1
    sfx = []
    for s in shots:
        f = os.path.join(W, 'sfx', f"{s['id']}.wav")
        if not os.path.exists(f): continue
        inputs += ['-i', f]
        filt.append(f"[{idx}:a]aresample=48000,atrim=0:{s['secs']:.2f},afade=t=out:st={max(0, s['secs'] - 0.3):.2f}:d=0.3,adelay={int(s['at'] * 1000)}|{int(s['at'] * 1000)},volume=0.8[x{idx}]")
        sfx.append(f"[x{idx}]"); idx += 1
    if music_n: filt.append(''.join(mix) + f"amix=inputs={music_n}:normalize=0[music]")
    filt.append(''.join(vo) + f"amix=inputs={len(vo)}:normalize=0,asplit=2[dia][key]")
    # score ducks under dialogue
    if music_n: filt.append("[music][key]sidechaincompress=threshold=0.03:ratio=6:attack=40:release=500[ducked]")
    else: filt.append("[key]anullsink")
    beds = (['[ducked]'] if music_n else []) + ['[dia]'] + (['[fx]'] if sfx else [])
    if sfx: filt.append(''.join(sfx) + f"amix=inputs={len(sfx)}:normalize=0[fx]")
    filt.append(''.join(beds) + f"amix=inputs={len(beds)}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=out:st={total - 2:.2f}:d=2[a]")
    out = os.path.join(W, 'zenith_origin.mp4')
    run(['ffmpeg', '-y', '-v', 'error', *inputs, '-filter_complex', ';'.join(filt), '-map', '[v]', '-map', '[a]', '-t', f'{total:.2f}',
         '-c:v', 'libx264', '-crf', '20', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '192k', out])
    # ---- captions for the web player
    def ts(x): return f"{int(x // 3600):02d}:{int(x % 3600 // 60):02d}:{x % 60:06.3f}"
    names = {'n': '', 'haruto': 'HARUTO: ', 'vorn': 'VORN: ', 'yuzu': 'YUZU: ', 'nocturne': 'NOCTURNE: ', 'kagemaru': 'KAGEMARU: ', 'enra': 'ENRA: ',
             'hex': 'HEX: ', 'mirei': 'MIREI: ', 'kaien': 'KAIEN: ', 'raijin': 'RAIJIN: ', 'qelvaris': "QEL'VARIS: "}
    cues = [f"{ts(ln['at'])} --> {ts(ln['at'] + ln['secs'] + 0.2)}\n{names.get(ln['who'], '')}{ln['text']}\n" for b in TL['beats'] for ln in b['lines']]
    open(os.path.join(W, 'zenith_origin.vtt'), 'w', encoding='utf-8').write('WEBVTT\n\n' + '\n'.join(cues))
    print('wrote', out, round(os.path.getsize(out) / 1e6, 1), 'MB')


if __name__ == '__main__':
    main()
