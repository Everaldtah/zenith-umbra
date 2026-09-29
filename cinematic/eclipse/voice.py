"""Narration + character lines with Kokoro TTS (Apache-2.0) -> work/vo/<shot>_<k>.wav + work/vo/index.json.
Run with the TTS venv:  ../.venv-tts/Scripts/python.exe voice.py
"""
import json, os, sys
import numpy as np, soundfile as sf
from kokoro import KPipeline
from script import S, NARRATOR, VOICES, SPEED

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work', 'vo')
os.makedirs(OUT, exist_ok=True)
pipes = {}
index = []
only = set(sys.argv[1:])
for sid, secs, kind, chars, key, cam, lines, cue in S:
    for k, (who, text) in enumerate(lines):
        path = os.path.join(OUT, f'{sid}_{k}.wav')
        voice = NARRATOR if who == 'n' else VOICES[who]
        if not os.path.exists(path) or sid in only:
            lang = voice[0]
            if lang not in pipes: pipes[lang] = KPipeline(lang_code=lang, repo_id='hexgrad/Kokoro-82M')
            speed = 0.95 if who == 'n' else SPEED.get(who, 1.0)
            audio = np.concatenate([a.numpy() if hasattr(a, 'numpy') else a for _, _, a in pipes[lang](text, voice=voice, speed=speed)])
            sf.write(path, audio, 24000)
        d = sf.info(path).duration
        index.append({'shot': sid, 'k': k, 'who': who, 'text': text, 'file': path, 'secs': round(d, 2)})
        print(sid, k, who, round(d, 2), flush=True)
json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'), indent=1)
print('total speech', round(sum(x['secs'] for x in index), 1))
