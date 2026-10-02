"""List / extract members of a zip on an HTTP server that supports Range requests, without downloading the whole file.
usage: remote_zip.py <url | itchpage|uploadid> list [regex]  |  remote_zip.py <url> get <out dir> <regex>"""
import io, os, re, sys, zipfile, requests
# a TLS-intercepting antivirus needs its root in the bundle: point REQUESTS_CA_BUNDLE (or SSL_CERT_FILE) at it
CA = os.environ.get('REQUESTS_CA_BUNDLE') or os.environ.get('SSL_CERT_FILE') or ''
def itch_url(page, upload):
    """a fresh presigned CDN url for one upload of a free itch.io page (they expire after 60 s)"""
    s = requests.Session(); s.verify = CA if CA and os.path.exists(CA) else True; s.headers['User-Agent'] = 'Mozilla/5.0'
    h = s.get(page).text; c = re.search(r'name="csrf_token" value="([^"]+)"', h).group(1)
    u = s.post(page + '/download_url', data={'csrf_token': c}, headers={'X-Requested-With': 'XMLHttpRequest'}).json()['url']
    d = s.get(u).text; c = re.search(r'name="csrf_token" value="([^"]+)"', d).group(1)
    return s.post(f'{page}/file/{upload}', params={'source': 'game_download'}, data={'csrf_token': c}, headers={'X-Requested-With': 'XMLHttpRequest'}).json()['url']
class RangeFile(io.RawIOBase):
    def __init__(self, url):
        self.src = url
        if '|' in url: page, up = url.split('|'); self.fresh = lambda: itch_url(page, up)
        else: self.fresh = lambda: self.src
        url = self.fresh()
        self.url, self.s, self.pos = url, requests.Session(), 0
        self.s.verify = CA if CA and os.path.exists(CA) else True
        r = self.s.head(url); 
        if r.status_code >= 400 or 'content-length' not in r.headers:
            r = self.s.get(url, headers={'Range': 'bytes=0-0'}); self.size = int(r.headers['content-range'].split('/')[-1])
        else: self.size = int(r.headers['content-length'])
        self.cache = {}
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos
    def read(self, n=-1):
        if n is None or n < 0: n = self.size - self.pos
        if n == 0 or self.pos >= self.size: return b''
        end = min(self.size, self.pos + n) - 1
        # read in >=256 KB chunks to cut round trips for the many small reads zipfile makes
        lo = self.pos; hi = max(end, min(self.size - 1, lo + (1 << 18) - 1))
        key = (lo, hi)
        r = self.s.get(self.url, headers={'Range': f'bytes={lo}-{hi}'})
        if r.status_code in (400, 401, 403):
            self.url = self.fresh(); r = self.s.get(self.url, headers={'Range': f'bytes={lo}-{hi}'})
        r.raise_for_status()
        data = r.content[: end - lo + 1]
        self.pos += len(data); return data
    def readinto(self, b):
        d = self.read(len(b)); b[:len(d)] = d; return len(d)
url, cmd = sys.argv[1], sys.argv[2]
z = zipfile.ZipFile(io.BufferedReader(RangeFile(url), buffer_size=1 << 18))
if cmd == 'list':
    rx = re.compile(sys.argv[3], re.I) if len(sys.argv) > 3 else None
    for i in z.infolist():
        if not rx or rx.search(i.filename): print(i.file_size, i.filename)
else:
    out, rx = sys.argv[3], re.compile(sys.argv[4], re.I)
    for i in z.infolist():
        if rx.search(i.filename) and not i.is_dir():
            z.extract(i, out); print('got', i.filename, flush=True)
