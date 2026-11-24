"""Installable, offline after the first visit, and no requests to anywhere else."""
import json
from pathlib import Path

BASE = 'http://localhost:8765/'
FIX = Path(__file__).resolve().parents[1] / 'fixtures'
OK = ('http://localhost:8765/', 'blob:', 'data:')

def ready_sw(page):
    page.goto(BASE); page.wait_for_selector('#reviews.show', timeout=8000)
    page.wait_for_function('navigator.serviceWorker.getRegistration().then(r => !!(r && r.active))', timeout=8000)
    page.reload(); page.wait_for_selector('#reviews.show', timeout=8000)
    page.wait_for_function('!!navigator.serviceWorker.controller', timeout=8000)

def test_no_external_requests(page):
    seen = []
    page.on('request', lambda r: seen.append(r.url))
    page.goto(BASE); page.wait_for_selector('#reviews.show', timeout=8000)
    page.set_input_files('#file', str(FIX / 'clip.webm'))
    page.wait_for_selector('.rv-clip', timeout=30000); page.locator('.rv-clip').last.click()
    page.wait_for_function("document.getElementById('log2').textContent.includes('loaded in')", timeout=30000)
    page.click('#play'); page.wait_for_timeout(400); page.click('#play')
    page.click('#more')
    with page.expect_download(timeout=30000): page.click('#export')
    outside = [u for u in seen if not u.startswith(OK)]
    assert outside == []
    page.evaluate('document.fonts.ready')
    assert page.evaluate("[...document.fonts].some(f => f.family.replace(/\"/g, '') === 'Rubik' && f.status === 'loaded')")

def test_offline_reload(page, context):
    ready_sw(page)
    page.set_input_files('#file', str(FIX / 'clip.webm'))
    page.wait_for_selector('.rv-clip', timeout=30000)
    context.set_offline(True)
    page.reload(); page.wait_for_selector('.rv-clip', timeout=8000)
    page.locator('.rv-clip').first.click()
    page.wait_for_function("document.getElementById('log2').textContent.includes('loaded in')", timeout=30000)
    context.set_offline(False)

def test_manifest(page):
    page.goto(BASE)
    href = page.get_attribute('link[rel=manifest]', 'href')
    m = json.loads(page.evaluate('async h => (await fetch(h)).text()', href))
    assert m['name'] == 'Quarry Go' and m['display'] == 'standalone' and m['start_url'] == './'
    assert page.get_attribute('link[rel=apple-touch-icon]', 'href') == 'icons/icon-180.png'
    assert page.get_attribute('meta[name=apple-mobile-web-app-capable]', 'content') == 'yes'

def test_sort_library_hosts(page):
    from fakedrive import FakeDrive
    FakeDrive(page)
    page.add_init_script("""localStorage.setItem('qg_client_id','x');localStorage.setItem('qg_token','fake1');
        localStorage.setItem('qg_token_exp',String(Date.now()+3600e3));localStorage.setItem('qg_email','a@b')""")
    hosts = set()
    page.on('request', lambda r: hosts.add(r.url.split('/')[2] if r.url.startswith('http') else r.url.split(':')[0]))
    page.goto(BASE + '#/sort'); page.wait_for_function("document.getElementById('soCount').textContent.startsWith('4')", timeout=8000)
    page.click('#soSkip'); page.wait_for_timeout(400)
    page.click('#tab-library'); page.wait_for_selector('#libGrid .lib-tile')
    page.wait_for_function("[...document.querySelectorAll('#libGrid .lib-tile img')].every(i => i.src)", timeout=8000)
    allowed = {'localhost:8765', 'accounts.google.com', 'www.googleapis.com', 'pbs.twimg.com', 'video.twimg.com', 'blob', 'data'}
    assert hosts <= allowed, hosts - allowed

def test_library_offline_from_cache(page, context):
    from fakedrive import FakeDrive
    fake = FakeDrive(page)
    page.add_init_script("""localStorage.setItem('qg_client_id','x');localStorage.setItem('qg_token','fake1');
        localStorage.setItem('qg_token_exp',String(Date.now()+3600e3));localStorage.setItem('qg_email','a@b')""")
    ready_sw(page)
    page.evaluate("location.hash = '#/library'")
    page.wait_for_function("[...document.querySelectorAll('#libGrid .lib-tile img')].filter(i => i.complete && i.naturalWidth > 0).length === 6", timeout=8000)
    context.set_offline(True); fake.offline = True
    page.reload(); page.wait_for_selector('#libGrid .lib-tile', timeout=8000)
    page.wait_for_function("[...document.querySelectorAll('#libGrid .lib-tile img')].filter(i => i.complete && i.naturalWidth > 0).length === 6", timeout=8000)
    context.set_offline(False); fake.offline = False
