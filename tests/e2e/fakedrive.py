"""A fake Google (sign-in + Drive v3) for Playwright, built from tests/fixtures/phone/.

Install with FakeDrive(page_or_context, with_phone=True). It answers:
  accounts.google.com/o/oauth2/v2/auth   -> 302 back to redirect_uri#access_token=...&state=...
  GET  www.googleapis.com/drive/v3/about  -> the account
  GET  www.googleapis.com/drive/v3/files?q=...   (name =, 'id' in parents, mimeType =, trashed = false; paging)
  GET  www.googleapis.com/drive/v3/files/<id>?alt=media
  POST www.googleapis.com/drive/v3/files           (create folder, JSON metadata)
  POST www.googleapis.com/upload/drive/v3/files?uploadType=multipart
X media (pbs.twimg.com / video.twimg.com) is served from local fixtures.
"""
import json, re, itertools
from pathlib import Path
from urllib.parse import urlparse, parse_qs, urlencode

FIX = Path(__file__).resolve().parents[1] / 'fixtures'
PHONE = FIX / 'phone'
FOLDER = 'application/vnd.google-apps.folder'


class FakeDrive:
    def __init__(self, target, with_phone=True, extra_items=0):
        self.files = {}
        self.ids = itertools.count(1)
        self.written = []          # (name, parent name, json-or-bytes)
        self.expired = False
        self.tokens = 0
        self.auth_requests = []
        root = self.add('Quarry Sync', 'root', folder=True)
        if with_phone:
            phone = self.add('phone', root, folder=True)
            self.phone = phone
            self.actions = self.add('actions', phone, folder=True)
            self.applied = self.add('applied', phone, folder=True)
            thumbs = self.add('thumbs', phone, folder=True)
            for f in PHONE.glob('*.json'):
                data = f.read_bytes()
                if f.name == 'library.json' and extra_items:
                    j = json.loads(data)
                    base = j['items']
                    for i in range(extra_items):
                        it = dict(base[i % len(base)])
                        it['key'] = f'Bulk/item_{i:05d}.jpg'; it['folder'] = 'Bulk'
                        it['title'] = ('hand ' if i % 7 == 0 else 'pose ') + str(i)
                        j['items'].append(it)
                    data = json.dumps(j).encode()
                self.add(f.name, phone, data)
            for f in (PHONE / 'thumbs').glob('*.jpg'):
                self.add(f.name, thumbs, f.read_bytes())
        target.route('https://accounts.google.com/**', self._auth)
        target.route('https://www.googleapis.com/**', self._api)
        target.route(re.compile(r'https://(pbs|video)\.twimg\.com/.*'), self._x)

    def add(self, name, parent, data=b'', folder=False):
        fid = f'f{next(self.ids)}'
        self.files[fid] = {'id': fid, 'name': name, 'parents': [parent], 'mimeType': FOLDER if folder else 'application/json',
                           'data': data, 'modifiedTime': '2026-11-22T17:50:03Z'}
        return fid

    def by_name(self, name):
        return [f for f in self.files.values() if f['name'] == name]

    def set_json(self, folder_id, name, obj):
        for f in self.files.values():
            if f['name'] == name and folder_id in f['parents']:
                f['data'] = json.dumps(obj).encode(); return
        self.add(name, folder_id, json.dumps(obj).encode())

    def expire(self):
        self.expired = True

    # ---- routes
    def _auth(self, route):
        q = parse_qs(urlparse(route.request.url).query)
        self.auth_requests.append({k: v[0] for k, v in q.items()})
        self.tokens += 1; self.expired = False
        frag = urlencode({'access_token': f'fake{self.tokens}', 'token_type': 'Bearer', 'expires_in': '3600',
                          'state': q['state'][0], 'scope': q['scope'][0]})
        route.fulfill(status=302, headers={'Location': q['redirect_uri'][0] + '#' + frag})

    def _x(self, route):
        url = route.request.url
        if url.endswith('.mp4'):
            route.fulfill(status=200, body=(FIX / 'clip.webm').read_bytes(), headers={'Content-Type': 'video/webm', 'Access-Control-Allow-Origin': '*'})
        else:
            m = re.search(r'(\d)\.jpg', url)
            route.fulfill(status=200, body=(PHONE / f'x{m.group(1) if m else 0}.jpg').read_bytes(), headers={'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*'})

    def _json(self, route, obj, status=200):
        route.fulfill(status=status, body=json.dumps(obj), headers={'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'})

    def _api(self, route):
        req = route.request
        cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type',
                'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS'}
        if req.method == 'OPTIONS':
            return route.fulfill(status=204, headers=cors)
        auth = req.headers.get('authorization', '')
        if self.expired or not auth.startswith('Bearer fake'):
            return self._json(route, {'error': {'code': 401, 'message': 'Invalid Credentials'}}, 401)
        u = urlparse(req.url); q = {k: v[0] for k, v in parse_qs(u.query).items()}
        path = u.path
        if path == '/drive/v3/about':
            return self._json(route, {'user': {'emailAddress': 'you@example.com', 'displayName': 'You'}})
        if path == '/drive/v3/files' and req.method == 'GET':
            out = list(self.files.values())
            for cond in re.split(r'\s+and\s+', q.get('q', '')):
                cond = cond.strip()
                if not cond: continue
                m = re.match(r"name\s*=\s*'(.*)'$", cond)
                if m: out = [f for f in out if f['name'] == m.group(1).replace("\\'", "'")]; continue
                m = re.match(r"'(.+)' in parents$", cond)
                if m: out = [f for f in out if m.group(1) in f['parents']]; continue
                m = re.match(r"mimeType\s*=\s*'(.*)'$", cond)
                if m: out = [f for f in out if f['mimeType'] == m.group(1)]; continue
            size = int(q.get('pageSize', 100)); start = int(q.get('pageToken', 0) or 0)
            page = out[start:start + size]
            res = {'files': [{k: f[k] for k in ('id', 'name', 'mimeType', 'modifiedTime')} for f in page]}
            if start + size < len(out): res['nextPageToken'] = str(start + size)
            return self._json(route, res)
        m = re.match(r'/drive/v3/files/([^/]+)$', path)
        if m and req.method == 'GET' and q.get('alt') == 'media':
            f = self.files.get(m.group(1))
            if not f: return self._json(route, {'error': {'code': 404}}, 404)
            ct = 'image/jpeg' if f['name'].endswith('.jpg') else 'application/json'
            return route.fulfill(status=200, body=f['data'], headers={**cors, 'Content-Type': ct})
        if path == '/drive/v3/files' and req.method == 'POST':
            meta = json.loads(req.post_data or '{}')
            fid = self.add(meta['name'], meta['parents'][0], folder=meta.get('mimeType') == FOLDER)
            return self._json(route, {'id': fid, 'name': meta['name']})
        if path == '/upload/drive/v3/files' and req.method == 'POST':
            body = req.post_data_buffer or b''
            ctype = req.headers.get('content-type', '')
            boundary = ctype.split('boundary=')[-1].strip('"')
            parts = [p for p in body.split(('--' + boundary).encode()) if p.strip() not in (b'', b'--')]
            def content(p):
                return p.split(b'\r\n\r\n', 1)[1].rsplit(b'\r\n', 1)[0]
            meta = json.loads(content(parts[0]))
            data = content(parts[1])
            fid = self.add(meta['name'], meta['parents'][0], data)
            parent = self.files.get(meta['parents'][0], {}).get('name')
            try: payload = json.loads(data)
            except ValueError: payload = data
            self.written.append((meta['name'], parent, payload))
            return self._json(route, {'id': fid, 'name': meta['name']})
        return self._json(route, {'error': {'code': 400, 'message': 'fake drive: unhandled ' + path}}, 400)
