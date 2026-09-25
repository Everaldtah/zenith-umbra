"""Narration + character lines with Kokoro TTS (Apache-2.0). Writes work/vo/<beat>_<k>.wav and work/vo/index.json."""
import json, os
import numpy as np, soundfile as sf
from kokoro import KPipeline
from script import BEATS, NARRATOR, VOICES

OUT = os.path.join(os.path.dirname(__file__), 'work', 'vo')
os.makedirs(OUT, exist_ok=True)
pipes = {'a': KPipeline(lang_code='a'), 'b': KPipeline(lang_code='b')}
index = []
for bi, b in enumerate(BEATS):
    for k, (who, text) in enumerate(b['say']):
        voice = NARRATOR if who == 'n' else VOICES[who]
        speed = 1.0 if who == 'n' else 1.05
        audio = np.concatenate([a for _, _, a in pipes[voice[0]](text, voice=voice, speed=speed)])
        path = os.path.join(OUT, f'{bi:02d}_{k}.wav')
        sf.write(path, audio, 24000)
        index.append({'beat': bi, 'k': k, 'who': who, 'text': text, 'file': path, 'secs': round(len(audio) / 24000, 2)})
        print(bi, k, who, index[-1]['secs'])
json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'), indent=1)
print('total', round(sum(x['secs'] for x in index), 1))
