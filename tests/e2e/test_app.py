"""Reviews screen, routing, autosave and settings."""
from pathlib import Path

BASE = 'http://localhost:8765/'
FIX = Path(__file__).resolve().parents[1] / 'fixtures'

def home(page):
    page.goto(BASE); page.wait_for_selector('#reviews.show', timeout=8000)
    page.evaluate("async () => { const S = await import('/js/store.js'); await S.deleteAll(); }")
    page.reload(); page.wait_for_selector('#reviews.show', timeout=8000)

def new_review(page, path=FIX / 'clip.webm'):
    page.set_input_files('#file', str(path))

def in_player(page):
    page.wait_for_selector('#player', state='visible', timeout=10000)
    page.wait_for_function("document.getElementById('log2').textContent.includes('loaded in')", timeout=30000)

def back(page):
    page.click('#back'); page.wait_for_selector('#reviews.show', timeout=8000)

def cards(page): return page.locator('.rv-card')

def test_new_review_appears(page):
    home(page)
    assert 'Open a clip' in page.inner_text('#reviews')
    new_review(page); in_player(page)
    assert '#/r/' in page.url
    page.click('#annBtn'); page.click('#noteBtn'); page.fill('#noteIn', 'more overlap'); page.click('#noteOk')
    back(page)
    assert cards(page).count() == 1
    assert cards(page).first.locator('.rv-name').inner_text() == 'clip'
    assert '1 note' in cards(page).first.inner_text()
    assert cards(page).first.locator('img').count() == 1

def test_edit_survives_immediate_reload(page):
    home(page); new_review(page); in_player(page)
    page.click('#annBtn'); page.click('#noteBtn'); page.fill('#noteIn', 'keep me'); page.click('#noteOk')
    page.wait_for_timeout(30); page.reload()
    in_player(page)
    page.click('#more')
    assert 'keep me' in page.inner_text('#notes')

def test_state_restored(page):
    home(page); new_review(page); in_player(page)
    for _ in range(12): page.mouse.click(370, 400)
    page.click('#inBtn')
    for _ in range(11): page.mouse.click(370, 400)
    page.click('#outBtn')
    page.click('#secBtn'); page.click('#secRates [data-r="0.5"]')
    page.click('#rateBtn'); page.click('#rateList [data-r="0.25"]')
    back(page); cards(page).first.click(); in_player(page)
    assert page.inner_text('#viewBtn') == 'Retimed'
    assert '/ 84' in page.inner_text('#fr')
    assert page.inner_text('#rangeTxt') == 'Loop 13–36'
    assert page.inner_text('#rateBtn') == '0.25×'

def test_bad_clip_makes_no_review(page, tmp_path):
    home(page)
    bad = tmp_path / 'broken.mp4'; bad.write_text('this is not a video')
    new_review(page, bad)
    page.wait_for_function("document.getElementById('toast').textContent.includes(\"can't be opened\")", timeout=30000)
    assert page.locator('#reviews.show').count() == 1
    assert cards(page).count() == 0
    assert page.evaluate("async () => (await (await import('/js/store.js')).listReviews()).length") == 0

def test_missing_clip_repick(page):
    home(page); new_review(page); in_player(page)
    page.click('#annBtn'); page.click('#noteBtn'); page.fill('#noteIn', 'still here'); page.click('#noteOk')
    back(page)
    page.evaluate('''async () => { const db = await new Promise(r => { const q = indexedDB.open('quarry-go'); q.onsuccess = () => r(q.result); });
        await new Promise(r => { const tx = db.transaction('clips', 'readwrite'); tx.objectStore('clips').clear(); tx.oncomplete = r; }); db.close(); }''')
    cards(page).first.click()
    page.wait_for_selector('#missing.show', timeout=8000)
    assert 'missing' in page.inner_text('#missing')
    page.set_input_files('#file', str(FIX / 'clip.webm'))
    in_player(page); page.click('#more')
    assert 'still here' in page.inner_text('#notes')
    assert page.evaluate("async () => { const S = await import('/js/store.js'); const [r] = await S.listReviews(); return !!(await S.getClip(r.id)); }")

def test_rename_delete(page):
    home(page); new_review(page); in_player(page); back(page)
    bx = cards(page).first.bounding_box()
    page.mouse.move(bx['x'] + 40, bx['y'] + 40); page.mouse.down(); page.wait_for_timeout(700); page.mouse.up()
    page.wait_for_selector('#cardVeil', state='visible')
    page.fill('#renameIn', 'Brute hitreact'); page.click('#renameOk')
    page.wait_for_function("document.querySelector('.rv-name') && document.querySelector('.rv-name').textContent === 'Brute hitreact'")
    bx = cards(page).first.bounding_box()
    page.mouse.move(bx['x'] + 40, bx['y'] + 40); page.mouse.down(); page.wait_for_timeout(700); page.mouse.up()
    page.click('#deleteOne'); page.click('#confirmYes')
    page.wait_for_function("!document.querySelector('.rv-card')")
    assert page.evaluate("async () => (await (await import('/js/store.js')).usage()).bytes") == 0

def test_settings(page):
    home(page); new_review(page); in_player(page); back(page)
    page.click('#gear'); page.wait_for_selector('#settingsVeil', state='visible')
    assert 'MB' in page.inner_text('#spaceUsed')
    assert 'Version' in page.inner_text('#settingsVeil')
    page.click('#deleteAll'); page.click('#confirmYes')
    page.wait_for_function("!document.querySelector('.rv-card')")
