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
    page.wait_for_function("document.getElementById('log2').textContent.includes('loaded in')", timeout=30000)
    page.click('#back'); page.wait_for_selector('.rv-card', timeout=8000)
    context.set_offline(True)
    page.reload(); page.wait_for_selector('.rv-card', timeout=8000)
    page.locator('.rv-card').first.click()
    page.wait_for_function("document.getElementById('log2').textContent.includes('loaded in')", timeout=30000)
    context.set_offline(False)

def test_manifest(page):
    page.goto(BASE)
    href = page.get_attribute('link[rel=manifest]', 'href')
    m = json.loads(page.evaluate('async h => (await fetch(h)).text()', href))
    assert m['name'] == 'Quarry Go' and m['display'] == 'standalone' and m['start_url'] == './'
    assert page.get_attribute('link[rel=apple-touch-icon]', 'href') == 'icons/icon-180.png'
    assert page.get_attribute('meta[name=apple-mobile-web-app-capable]', 'content') == 'yes'
