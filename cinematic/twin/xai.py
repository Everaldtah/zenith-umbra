"""Tiny xAI Imagine client: submit a video job, poll it, download it, log the cost (ledger.json).

Every call is appended to work/ledger.json (request id, model, seconds, cost in USD) so the budget is always known.
The key is read from $XAI_KEY_FILE (never stored in the repo).
"""
import base64, json, os, sys, threading, time, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
W = os.path.join(HERE, 'work')
os.makedirs(W, exist_ok=True)
LEDGER = os.path.join(W, 'ledger.json')
KEY = open(os.environ['XAI_KEY_FILE']).read().strip()
API = 'https://api.x.ai/v1'


def _req(method, path, body=None, tries=6):
    """GETs retry on network errors. A POST that dies before its answer may still have been charged: the caller logs it
    as an uncertain cost (counted against the budget) and decides whether to retry."""
    data = json.dumps(body).encode() if body is not None else None
    for k in range(tries if method == 'GET' else 1):
        r = urllib.request.Request(API + path, data=data, method=method, headers={
            'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json', 'User-Agent': 'zu-film/1.0'})
        try:
            with urllib.request.urlopen(r, timeout=180) as f: return json.loads(f.read())
        except urllib.error.HTTPError as e:
            if method == 'GET' and e.code >= 500 and k < tries - 1: time.sleep(5 * (k + 1)); continue
            raise RuntimeError(f'{e.code} {e.read().decode()[:800]}')
        except (OSError, urllib.error.URLError) as e:
            if method == 'GET' and k < tries - 1: time.sleep(5 * (k + 1)); continue
            raise NetError(str(e))


class NetError(Exception):
    pass


def data_url(path, max_side=1280):
    from PIL import Image
    import io
    im = Image.open(path).convert('RGB')
    if max(im.size) > max_side:
        s = max_side / max(im.size); im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, 'JPEG', quality=92)
    return 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()


def ledger():
    return json.load(open(LEDGER)) if os.path.exists(LEDGER) else []


def spent():
    return sum(e.get('usd', 0) for e in ledger())


_LOCK = threading.Lock()


def log(entry):
    with _LOCK:
        entry['at'] = time.strftime('%Y-%m-%d %H:%M:%S')
        L = ledger(); L.append(entry); json.dump(L, open(LEDGER, 'w'), indent=1)


def submit(body):
    return _req('POST', '/videos/generations', body)['request_id']


def wait(rid, every=6, timeout=1200):
    t0 = time.time()
    while True:
        r = _req('GET', f'/videos/{rid}')
        if r.get('status') in ('done', 'failed', 'expired'): return r
        if time.time() - t0 > timeout: raise TimeoutError(rid)
        time.sleep(every)


def fetch(url, out):
    req = urllib.request.Request(url, headers={'User-Agent': 'zu-film/1.0'})
    with urllib.request.urlopen(req, timeout=300) as f, open(out, 'wb') as o: o.write(f.read())


def edit_image(prompt, refs, out, model='grok-imagine-image', aspect='16:9', resolution='1k', shot=''):
    """keyframe from up to 5 reference images (<IMAGE_0>.. in the prompt) -> out (jpg/png); logs cost"""
    body = {'model': model, 'prompt': prompt, 'aspect_ratio': aspect, 'resolution': resolution, 'response_format': 'b64_json', 'n': 1}
    if len(refs) == 1: body['image'] = {'url': data_url(refs[0])}
    else: body['images'] = [{'url': data_url(p)} for p in refs]
    try:
        r = _req('POST', '/images/edits' if refs else '/images/generations', body if refs else {k: v for k, v in body.items() if k not in ('image', 'images')})
    except NetError as e:
        log({'shot': shot, 'kind': 'image', 'model': model, 'usd': 0.022, 'uncertain': True, 'error': str(e)[:200]})
        raise
    usd = r.get('usage', {}).get('cost_in_usd_ticks', 0) / 1e10
    d = r['data'][0]
    with open(out, 'wb') as o: o.write(base64.b64decode(d['b64_json']))
    log({'shot': shot, 'kind': 'image', 'model': model, 'usd': usd, 'refs': [os.path.basename(p) for p in refs]})
    return usd
