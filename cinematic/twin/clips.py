#!/usr/bin/env python3
"""Animate every keyframe with grok-imagine-video-1.5-lite image-to-video at 720p -> work/clips/<shot>.mp4.

    python clips.py [ids..]        (no ids: every clip shot that has a keyframe and no clip yet)
Four jobs run at once. Each job is priced before it is sent (gen seconds x $0.032) and refused if it would pass the cap in
budget.py; the real cost from the API's usage block goes into work/ledger.json. A submit that dies on the network is logged
as an uncertain charge and NOT retried automatically (it may have gone through).
"""
import os, sys, time, json, concurrent.futures as cf
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import xai, budget
from script import S, MOTION

K, C = os.path.join(xai.W, 'keys'), os.path.join(xai.W, 'clips')
os.makedirs(C, exist_ok=True)
PER_S = 0.032
MODEL = 'grok-imagine-video-1.5-lite'


def prompt(s):
    talk = bool(s['lines']) and any(w != 'n' for w, _ in s['lines'])
    snd = ('Sound: ambient sound effects only, no music.' if talk else
           'Sound: natural sound effects only, no speech, no voices, no music.')
    return f"{s['motion']} {MOTION}. {snd}"


def make(s):
    est = s['gen'] * PER_S
    budget.reserve(est)
    try:
        body = {'model': MODEL, 'duration': s['gen'], 'resolution': '720p', 'prompt': prompt(s),
                'image': {'url': xai.data_url(os.path.join(K, f"{s['id']}.jpg"))}}
        t = time.time()
        try:
            rid = xai.submit(body)
        except xai.NetError as e:
            xai.log({'shot': s['id'], 'kind': 'video', 'model': MODEL, 'usd': est, 'uncertain': True, 'error': str(e)[:200]})
            print('NETERROR on submit (logged as uncertain)', s['id'], e, flush=True); return
        r = xai.wait(rid)
        usd = r.get('usage', {}).get('cost_in_usd_ticks', 0) / 1e10
        v = r.get('video') or {}
        ok = r.get('status') == 'done' and v.get('url')
        if ok: xai.fetch(v['url'], os.path.join(C, f"{s['id']}.mp4"))
        xai.log({'shot': s['id'], 'kind': 'video', 'rid': rid, 'model': MODEL, 'secs': v.get('duration'), 'usd': usd,
                 'status': r.get('status'), 'moderation_ok': v.get('respect_moderation'), 'error': r.get('error'), 't': round(time.time() - t)})
        print(('done ' if ok else 'FAILED ') + s['id'], f"{v.get('duration')}s ${usd:.3f} {round(time.time() - t)}s",
              r.get('error') or '', 'spent $%.2f' % xai.spent(), flush=True)
    finally:
        budget.release(est)


if __name__ == '__main__':
    ids = sys.argv[1:]
    todo = [s for s in S if s['kind'] == 'clip' and os.path.exists(os.path.join(K, f"{s['id']}.jpg"))
            and (s['id'] in ids if ids else not os.path.exists(os.path.join(C, f"{s['id']}.mp4")))]
    print(len(todo), 'clips,', sum(s['gen'] for s in todo), 's, est $%.2f' % (sum(s['gen'] for s in todo) * PER_S), '| spent $%.2f' % xai.spent(), flush=True)
    with cf.ThreadPoolExecutor(4) as ex:
        futs = {ex.submit(make, s): s['id'] for s in todo}
        for f in cf.as_completed(futs):
            try: f.result()
            except SystemExit as e: print('STOP', futs[f], e, flush=True)
            except Exception as e: print('ERROR', futs[f], e, flush=True)
    print('total spent $%.3f' % xai.spent())
