"""Edit decision list: beat lengths from the recorded lines, shots stretched to fill their beat, music cue spans.
Writes work/timeline.json."""
import json, os
from script import BEATS

HERE = os.path.dirname(os.path.abspath(__file__))
vo = json.load(open(os.path.join(HERE, 'work', 'vo', 'index.json')))
LEAD, GAP, TAIL = 0.35, 0.25, 0.45            # silence before the first line, between lines, after the last
t = 0.0
beats, shots, cues = [], [], []
cue = None
for bi, b in enumerate(BEATS):
    lines = [x for x in vo if x['beat'] == bi]
    talk = sum(x['secs'] for x in lines) + GAP * max(0, len(lines) - 1)
    pic = sum(s[4] for s in b['shots'])
    dur = max(pic, (LEAD + talk + TAIL) if lines else pic)
    # line placement
    lt = t + LEAD if lines else t
    placed = []
    for x in lines:
        placed.append({'file': x['file'], 'at': round(lt, 2), 'secs': x['secs'], 'who': x['who'], 'text': x['text']})
        lt += x['secs'] + GAP
    # shots share the beat in proportion to their authored length
    st = t
    for s in b['shots']:
        d = dur * s[4] / pic
        shots.append({'id': s[0], 'beat': bi, 'at': round(st, 2), 'secs': round(d, 2), 'authored': s[4]})
        st += d
    if 'music' in b:
        if cue: cue['end'] = round(t, 2)
        cue = {'cue': b['music'], 'start': round(t, 2)} if b['music'] else None
        if cue: cues.append(cue)
    beats.append({'beat': bi, 'at': round(t, 2), 'secs': round(dur, 2), 'lines': placed, 'title': b.get('title')})
    t += dur
if cue: cue['end'] = round(t, 2)
for c in cues: c['secs'] = round(c['end'] - c['start'], 2)
json.dump({'total': round(t, 2), 'beats': beats, 'shots': shots, 'cues': cues}, open(os.path.join(HERE, 'work', 'timeline.json'), 'w'), indent=1)
print('total', round(t, 1), 's =', f"{int(t // 60)}:{int(t % 60):02d}")
for c in cues: print(' cue', c['cue'], c['start'], '->', c['end'], f"({c['secs']}s)")
stretch = [s['secs'] / s['authored'] for s in shots]
print('shot stretch min/max', round(min(stretch), 2), round(max(stretch), 2))
