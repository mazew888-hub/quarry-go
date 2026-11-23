"""The phone's snapshot cache and action queue, against FakeDrive."""
from fakedrive import FakeDrive

BASE = 'http://localhost:8765/'
P = "(await import('/js/phone.js'))"
SIGNED_IN = """
  localStorage.setItem('qg_client_id', 'test-client.apps.googleusercontent.com');
  localStorage.setItem('qg_token', 'fake1');
  localStorage.setItem('qg_token_exp', String(Date.now() + 3600e3));
  localStorage.setItem('qg_email', 'you@example.com');
"""

def start(page, **kw):
    fake = FakeDrive(page, **kw)
    page.add_init_script(SIGNED_IN)
    page.goto(BASE + '#/library'); page.wait_for_load_state('domcontentloaded')
    page.evaluate("async () => { const S = await import('/js/store.js'); await S.deleteAll(); await S.phoneReset(); }")
    return fake

def refresh(page):
    return page.evaluate(f"async () => {P}.refresh()")

def test_refresh_loads_snapshot(page):
    start(page)
    r = refresh(page)
    assert r['state'] == 'ok' and r['status']['snapshot'] == 3
    v = page.evaluate(f"async () => {P}.current()")
    assert len(v['items']) == 6 and len(v['queue']) == 4

def test_act_sends_file(page):
    fake = start(page); refresh(page)
    page.evaluate(f"async () => {{ const p = {P}; await p.act({{ op: 'skip', id: '1800' }}); await p.send(); }}")
    page.wait_for_function("true")
    name, parent, body = fake.written[-1]
    assert parent == 'actions' and name.endswith('-00000001.json') and name.startswith('p-')
    assert body['actions'][0]['op'] == 'skip' and body['actions'][0]['n'] == 1 and body['seq'] == 1 and body['version'] == 1
    assert 'sent' not in body['actions'][0]
    assert len(page.evaluate(f"async () => {P}.current()")['queue']) == 3

def test_offline_action_queues_and_sends(page, context):
    fake = start(page); refresh(page)
    context.set_offline(True); fake.offline = True
    page.evaluate(f"async () => {{ const p = {P}; await p.act({{ op: 'tag', key: 'Poses/standing.jpg', add: ['x'], remove: [] }}); try {{ await p.send(); }} catch (e) {{}} }}")
    assert page.evaluate(f"async () => {P}.current()")['pending'] == 1
    assert fake.written == []
    context.set_offline(False); fake.offline = False
    assert refresh(page)['state'] == 'ok'
    assert len(fake.written) == 1 and fake.written[0][2]['actions'][0]['op'] == 'tag'

def test_no_phone_folder_message(page):
    start(page, with_phone=False)
    assert refresh(page)['state'] == 'nofolder'

def test_applied_failure_shows(page):
    fake = start(page); refresh(page)
    phone = page.evaluate(f"async () => {{ const p = {P}; await p.act({{ op: 'tag', key: 'Gone/x.jpg', add: ['a'], remove: [] }}); await p.send(); return p.phoneId(); }}")
    fake.set_json(fake.applied, f'{phone}.json', {'version': 1, 'phone': phone, 'last': 1, 'failed': [{'n': 1, 'op': 'tag', 'reason': 'x'}]})
    refresh(page)
    v = page.evaluate(f"async () => {P}.current()")
    assert v['failed'][0]['reason'] == 'x' and v['pending'] == 0

def test_snapshot_cached_across_reload(page, context):
    start(page); refresh(page)
    context.set_offline(True)
    page.reload(); page.wait_for_load_state('domcontentloaded')
    assert page.evaluate(f"async () => {{ const p = {P}; await p.init(); return p.current().items.length; }}") == 6
    context.set_offline(False)

def test_thumb_url_cached(page, context):
    start(page); refresh(page)
    name = page.evaluate(f"async () => {P}.current().items[0].thumb")
    url = page.evaluate(f"async n => {P}.thumbUrl(n)", name)
    assert url.startswith('blob:')
    context.set_offline(True)
    page.reload(); page.wait_for_load_state('domcontentloaded')
    url2 = page.evaluate(f"async n => {{ const p = {P}; await p.init(); return p.thumbUrl(n); }}", name)
    assert url2 and url2.startswith('blob:')
    context.set_offline(False)
