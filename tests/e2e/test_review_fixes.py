"""Regression tests for the Sort/Library final review findings."""
import json
from fakedrive import FakeDrive

BASE = 'http://localhost:8765/'
P = "(await import('/js/phone.js'))"
SIGNED_IN = """
  localStorage.setItem('qg_client_id', 'test-client.apps.googleusercontent.com');
  if (!localStorage.getItem('qg_token')) { localStorage.setItem('qg_token', 'fake1'); localStorage.setItem('qg_token_exp', String(Date.now() + 3600e3)); }
  localStorage.setItem('qg_email', 'you@example.com');
"""

def start(page, hash='#/', **kw):
    fake = FakeDrive(page, **kw)
    page.add_init_script(SIGNED_IN)
    page.goto(BASE + hash); page.wait_for_load_state('domcontentloaded')
    page.evaluate("async () => { const S = await import('/js/store.js'); await S.phoneReset(); }")
    return fake

def sent(fake): return [a for _, parent, body in fake.written if parent == 'actions' for a in body['actions']]

# Critical 1: offline with an expired token must not leave the app
def test_offline_expired_token_stays_in_app(page, context):
    fake = start(page)
    page.evaluate(f"async () => {P}.refresh()")
    page.evaluate("localStorage.setItem('qg_token_exp', String(Date.now() - 1000))")
    context.set_offline(True); fake.offline = True
    page.evaluate("location.hash = '#/library'")
    page.wait_for_selector('#libGrid .lib-tile', timeout=8000)
    page.wait_for_timeout(500)
    assert page.url.startswith(BASE) and len(fake.auth_requests) == 0
    context.set_offline(False); fake.offline = False

def test_send_never_redirects(page):
    fake = start(page)
    page.evaluate(f"async () => {P}.refresh()")
    page.evaluate("localStorage.setItem('qg_token_exp', String(Date.now() - 1000))")
    page.evaluate(f"async () => {{ const p = {P}; await p.act({{ op: 'skip', id: '1800' }}); try {{ await p.send(); }} catch (e) {{}} }}")
    page.wait_for_timeout(300)
    assert len(fake.auth_requests) == 0 and page.url.startswith(BASE)

# Important 2: actions stay shown until the snapshot has caught up with them
def test_applied_before_snapshot_keeps_overlay(page):
    fake = start(page)
    page.evaluate(f"async () => {P}.refresh()")
    phone = page.evaluate(f"async () => {{ const p = {P}; await p.act({{ op: 'skip', id: '1800' }}); await p.send(); return p.phoneId(); }}")
    fake.set_json(fake.applied, f'{phone}.json', {'version': 1, 'phone': phone, 'last': 1, 'time': '2026-11-22T18:00:00', 'failed': []})
    page.evaluate(f"async () => {P}.refresh()")
    assert '1800' not in [p['id'] for p in page.evaluate(f"async () => {P}.current().queue")]

# Important 3: a snapshot whose files don't match isn't cached
def test_mixed_snapshot_not_cached(page):
    fake = start(page)
    lib = next(f for f in fake.files.values() if f['name'] == 'library.json')
    j = json.loads(lib['data']); j['snapshot'] = 2; lib['data'] = json.dumps(j).encode()
    page.evaluate(f"async () => {P}.refresh()")
    assert page.evaluate("async () => (await import('/js/store.js')).kvGet('snap')") is None
    j['snapshot'] = 3; lib['data'] = json.dumps(j).encode()
    page.evaluate(f"async () => {P}.refresh()")
    assert len(page.evaluate(f"async () => {P}.current().items")) == 6

# Important 4: a lost reply never reuses a file name
def test_lost_reply_new_file_name(page):
    fake = start(page)
    page.evaluate(f"async () => {P}.refresh()")
    fake.lose_next_reply = True
    page.evaluate(f"async () => {{ const p = {P}; await p.act({{ op: 'skip', id: '1800' }}); try {{ await p.send(); }} catch (e) {{}} await p.send(); }}")
    names = [n for n, parent, _ in fake.written if parent == 'actions']
    assert len(names) == 2 and len(set(names)) == 2

def test_signed_out_with_cache_shows_connect(page):
    start(page)
    page.evaluate(f"async () => {P}.refresh()")
    page.evaluate("localStorage.setItem('qg_needs_connect', '1')")
    page.evaluate("location.hash = '#/sort'")
    page.wait_for_selector('#soStatus .st-connect', timeout=8000)

# Important 6: a sign-in answer that doesn't match asks to connect again
def test_state_mismatch_asks_to_connect(page):
    start(page)
    page.goto(BASE + '?r=1#access_token=x&expires_in=3600&state=not-mine'); page.wait_for_load_state('domcontentloaded')
    assert page.evaluate("localStorage.getItem('qg_needs_connect')") == '1'

# Important 7: background changes don't rebuild the Sort card
def test_sort_card_survives_background_change(page):
    start(page, '#/sort')
    page.wait_for_function("document.getElementById('soCount').textContent.startsWith('4')", timeout=8000)
    page.evaluate("window.__card = document.getElementById('soCard')")
    page.evaluate(f"async () => {P}.refresh()")
    page.wait_for_timeout(200)
    assert page.evaluate("window.__card === document.getElementById('soCard')")

# Important 8: thumbnails come from the offline cache, not object URLs
def test_thumbs_served_from_cache_path(page):
    start(page)
    page.wait_for_function('navigator.serviceWorker.getRegistration().then(r => !!(r && r.active))', timeout=20000)
    page.reload(); page.wait_for_function('!!navigator.serviceWorker.controller', timeout=8000)
    page.evaluate("location.hash = '#/library'")
    page.wait_for_function("document.querySelectorAll('#libGrid .lib-tile img[src*=\"/qg-thumbs/\"]').length === 6", timeout=8000)
    ok = page.evaluate("() => Promise.all([...document.querySelectorAll('#libGrid .lib-tile img')].map(i => i.decode().then(() => i.naturalWidth > 0, () => false)))")
    assert all(ok)

# Important 10: a change keeps the grid's scroll place and tiles
def test_grid_keeps_place_on_change(page):
    start(page, '#/library', extra_items=600)
    page.wait_for_selector('#libGrid .lib-tile', timeout=8000)
    page.evaluate("document.getElementById('library').scrollTo(0, 1e6)")
    page.wait_for_function("document.querySelectorAll('#libGrid .lib-tile').length >= 240", timeout=4000)
    page.evaluate("document.getElementById('library').scrollTo(0, 3000)")
    before = page.evaluate("[document.getElementById('library').scrollTop, document.querySelectorAll('#libGrid .lib-tile').length]")
    page.evaluate(f"async () => {P}.act({{ op: 'move', key: 'Anatomy/Body/torso.jpg', folder: 'Poses' }})")
    page.wait_for_timeout(300)
    after = page.evaluate("[document.getElementById('library').scrollTop, document.querySelectorAll('#libGrid .lib-tile').length]")
    assert after[0] == before[0] and after[1] >= before[1]
    assert page.evaluate("!!document.querySelector('#libGrid .lib-tile[data-key=\"Poses/torso.jpg\"]')")
