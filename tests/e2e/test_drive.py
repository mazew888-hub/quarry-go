"""Google sign-in (redirect, implicit token) and the small Drive client, against FakeDrive."""
from fakedrive import FakeDrive

BASE = 'http://localhost:8765/'
D = "(await import('/js/drive.js'))"

def start(page, hash='#/library'):
    fake = FakeDrive(page)
    page.add_init_script("localStorage.setItem('qg_client_id', 'test-client.apps.googleusercontent.com')")
    page.goto(BASE + hash); page.wait_for_load_state('domcontentloaded')
    return fake

def sign_in(page):
    page.evaluate(f"async () => {{ (await import('/js/drive.js')).signIn(); }}")
    page.wait_for_function("localStorage.getItem('qg_email') !== null", timeout=8000)

def test_sign_in_round_trip(page):
    fake = start(page)
    sign_in(page)
    assert page.evaluate("location.hash") == '#/library'
    assert page.evaluate(f"async () => {D}.ready()") is True
    a = fake.auth_requests[-1]
    assert a['response_type'] == 'token' and 'https://www.googleapis.com/auth/drive' in a['scope']
    assert a['redirect_uri'] == BASE
    assert page.evaluate(f"async () => (await {D}.account()).email") == 'you@example.com'

def test_phone_folder_found(page):
    start(page); sign_in(page)
    f = page.evaluate(f"async () => {D}.phoneFolder()")
    assert f['id'] and f['actionsId'] and f['thumbsId']

def test_read_and_write(page):
    fake = start(page); sign_in(page)
    snap = page.evaluate(f"async () => {{ const d = {D}; const f = await d.phoneFolder(); return (await d.readJson(f.id, 'status.json')).snapshot; }}")
    assert snap == 3
    page.evaluate(f"async () => {{ const d = {D}; const f = await d.phoneFolder(); await d.writeJson(f.actionsId, 'p-x-00000001.json', {{ a: 1 }}); }}")
    assert fake.written == [('p-x-00000001.json', 'actions', {'a': 1})]
    names = page.evaluate(f"async () => {{ const d = {D}; const f = await d.phoneFolder(); return [...(await d.listNames(f.thumbsId)).keys()].length; }}")
    assert names == 6

def test_expired_token_renews(page):
    fake = start(page); sign_in(page)
    fake.expire()
    with page.expect_navigation(timeout=8000):
        page.evaluate("() => { import('/js/phone.js').then(p => p.refresh()); }")
    page.wait_for_function("localStorage.getItem('qg_token') === 'fake2'", timeout=8000)
    assert fake.auth_requests[-1].get('prompt') == 'none'
    assert page.evaluate("location.hash") == '#/library'
    snap = page.evaluate(f"async () => {{ const d = {D}; const f = await d.phoneFolder(); return (await d.readJson(f.id, 'status.json')).snapshot; }}")
    assert snap == 3

def test_not_set_up_message(page):
    FakeDrive(page)
    page.add_init_script("localStorage.setItem('qg_client_id', 'NOT_SET')")
    page.goto(BASE); page.wait_for_load_state('domcontentloaded')
    msg = page.evaluate(f"async () => {{ try {{ {D}.signIn(); return 'no error'; }} catch (e) {{ return e.message; }} }}")
    assert "isn't set up yet" in msg

def test_two_failing_calls_renew_once(page):
    fake = start(page); sign_in(page)
    before = len(fake.auth_requests)
    fake.expire()
    with page.expect_navigation(timeout=8000):
        page.evaluate("() => { import('/js/phone.js').then(p => { p.refresh(); p.refresh(); }); }")
    page.wait_for_function("localStorage.getItem('qg_token') === 'fake2'", timeout=8000)
    assert len(fake.auth_requests) == before + 1

def test_diagnose_reports_what_it_sees(page):
    start(page); sign_in(page)
    d = page.evaluate(f"async () => {D}.diagnose()")
    assert d['email'] == 'you@example.com' and len(d['roots']) == 1
    r = d['roots'][0]
    assert r['phone'] is True and 'status.json' in r['files'] and 'library.json' in r['files']

def test_diagnose_without_phone_folder(page):
    fake = FakeDrive(page, with_phone=False)
    page.add_init_script("localStorage.setItem('qg_client_id', 'test-client.apps.googleusercontent.com')")
    page.goto(BASE + '#/'); page.wait_for_load_state('domcontentloaded'); sign_in(page)
    d = page.evaluate(f"async () => {D}.diagnose()")
    assert d['roots'][0]['phone'] is False and d['roots'][0]['children'] == []
