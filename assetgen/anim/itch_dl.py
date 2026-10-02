"""Download the files of a FREE itch.io asset page (the same flow as its Download -> "No thanks, just take me to the
downloads" buttons). usage: itch_dl.py <page url> <out dir> [--list] [--only substring ...]"""
import os, re, sys, json
import requests

# a TLS-intercepting antivirus needs its root in the bundle: point REQUESTS_CA_BUNDLE (or SSL_CERT_FILE) at it
CA = os.environ.get('REQUESTS_CA_BUNDLE') or os.environ.get('SSL_CERT_FILE') or ''
VERIFY = CA if CA and os.path.exists(CA) else True
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'}

page, out = sys.argv[1].rstrip('/'), sys.argv[2]
listing = '--list' in sys.argv
url_only = '--url-only' in sys.argv
only = sys.argv[sys.argv.index('--only') + 1:] if '--only' in sys.argv else []
os.makedirs(out, exist_ok=True)
s = requests.Session(); s.headers.update(UA); s.verify = VERIFY
html = s.get(page).text
csrf = re.search(r'name="csrf_token" value="([^"]+)"', html).group(1)
r = s.post(page + '/download_url', data={'csrf_token': csrf}, headers={'X-Requested-With': 'XMLHttpRequest', 'Referer': page})
dl = r.json()['url']
from urllib.parse import unquote as _uq
key = _uq(dl.rstrip('/').split('/')[-1])
dhtml = s.get(dl).text
csrf = re.search(r'name="csrf_token" value="([^"]+)"', dhtml).group(1)
ups = re.findall(r'data-upload_id="(\d+)"', dhtml)
names = re.findall(r'<strong title="([^"]+)" class="name"', dhtml)
sizes = re.findall(r'class="file_size"><span>([^<]+)</span>', dhtml)
for i, u in enumerate(dict.fromkeys(ups)):
    name = names[i] if i < len(names) else u
    print(u, name, sizes[i] if i < len(sizes) else '?', flush=True)
    if listing or (only and not any(o.lower() in name.lower() for o in only)):
        continue
    r = s.post(f'{page}/file/{u}', params={'source': 'game_download'}, data={'csrf_token': csrf}, headers={'X-Requested-With': 'XMLHttpRequest', 'Referer': dl})
    j = r.json()
    if 'url' not in j: print('  !', j); continue
    url = j['url']
    if url_only: print('  URL', url, flush=True); continue
    with s.get(url, stream=True) as g:
        g.raise_for_status()
        from urllib.parse import urlparse, unquote
        cd = g.headers.get('content-disposition', '')
        m = re.search(r'filename="?([^";]+)"?', cd)
        dst = os.path.join(out, m.group(1) if m else unquote(os.path.basename(urlparse(g.url).path)) or re.sub(r'[^\w.-]+', '_', name))
        with open(dst, 'wb') as f:
            for c in g.iter_content(1 << 20): f.write(c)
    print('  ->', dst, os.path.getsize(dst), flush=True)
