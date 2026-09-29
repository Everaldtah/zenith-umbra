#!/usr/bin/env python3
"""Screen the native audio of every work/clips/<shot>.mp4 before make_film.py lays it in as the SFX bed.

    python clip_audio.py [--force]
Grok Imagine (and the Kling / Gemini clips) come with generated sound: often exactly the right effects (rain, fire,
impacts, wind), sometimes invented dialogue or a music bed that would fight the score and the Kokoro voices. Whisper
(base) transcribes each track: confident words = 'speech', music symbols / [Music] = 'music'; both are left out of the
mix. Results are cached in work/clip_audio.json keyed by the clip's size + mtime, so only new clips are re-screened.
"""
import json, os, re, subprocess, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
W = os.path.join(HERE, 'work')
CLIPS = os.path.join(W, 'clips')
OUT = os.path.join(W, 'clip_audio.json')


def pcm16k(path):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], capture_output=True)
    return np.frombuffer(r.stdout, np.float32).copy()


def main():
    res = json.load(open(OUT)) if os.path.exists(OUT) and '--force' not in sys.argv else {}
    todo = []
    for f in sorted(os.listdir(CLIPS)):
        if not f.endswith('.mp4'): continue
        p = os.path.join(CLIPS, f); st = os.stat(p); sig = f'{st.st_size}:{int(st.st_mtime)}'
        if res.get(f[:-4], {}).get('sig') != sig: todo.append((f[:-4], p, sig))
    if not todo: print('all screened'); return
    import whisper
    model = whisper.load_model('base', device='cpu')
    for shot, p, sig in todo:
        a = pcm16k(p)
        if len(a) < 1600:
            res[shot] = {'sig': sig, 'has': False}; print(shot, 'no audio'); continue
        rms = float(np.sqrt(np.mean(a ** 2)))
        r = model.transcribe(a, language='en', fp16=False, condition_on_previous_text=False, no_speech_threshold=0.6)
        words, music = [], False
        for s in r['segments']:
            t = s['text'].strip()
            if re.search(r'[♪♫]|\[music|\(music|music\)', t, re.I): music = True; continue
            if s['no_speech_prob'] < 0.5 and s['avg_logprob'] > -0.9 and re.search(r'[a-zA-Z]{2,}', t): words.append(t)
        speech = len(' '.join(words).split()) >= 3
        res[shot] = {'sig': sig, 'has': True, 'rms': round(rms, 4), 'speech': speech, 'music': music, 'text': ' | '.join(words)[:160]}
        print(f"{shot:5s} rms={rms:.3f} speech={speech} music={music} {res[shot]['text'][:90]}", flush=True)
        json.dump(res, open(OUT, 'w'), indent=1)
    json.dump(res, open(OUT, 'w'), indent=1)
    ok = sorted(s for s, v in res.items() if v.get('has') and not v['speech'] and not v['music'])
    print(f'usable SFX beds: {len(ok)}/{len(res)}')


if __name__ == '__main__':
    main()
