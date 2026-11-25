"""Reviews screen, routing, autosave and settings."""
from pathlib import Path

BASE = 'http://localhost:8765/'
FIX = Path(__file__).resolve().parents[1] / 'fixtures'

def home(page):
    page.goto(BASE); page.wait_for_selector('#reviews.show', timeout=8000)
    page.evaluate("async () => { const S = await import('/js/store.js'); await S.deleteAll(); }")
    page.reload(); page.wait_for_selector('#reviews.show', timeout=8000)

def add(page, *paths):
    page.set_input_files('#file', [str(p) for p in paths])

def new_review(page, path=FIX / 'clip.webm'):
    # Adds the clip to today's review, then opens it.
    n = page.locator('.rv-clip').count() if '#/d/' in page.url else 0
    add(page, path)
    page.wait_for_function(f"location.hash.startsWith('#/d/') && document.querySelectorAll('.rv-clip').length > {n}", timeout=30000)
    page.locator('.rv-clip').last.click()

def in_player(page):
    page.wait_for_selector('#player', state='visible', timeout=10000)
    page.wait_for_function("document.getElementById('log2').textContent.includes('loaded in')", timeout=30000)

def back(page):
    page.click('#back'); page.wait_for_selector('#reviews.show', timeout=8000)

def cards(page): return page.locator('.rv-clip')

def test_new_review_appears(page):
    home(page)
    assert 'start today' in page.inner_text('#reviews')
    new_review(page); in_player(page)
    assert '#/r/' in page.url
    page.click('#annBtn'); page.click('#noteBtn'); page.fill('#noteIn', 'more overlap'); page.click('#noteOk')
    back(page)
    assert cards(page).count() == 1
    assert cards(page).first.locator('.rv-name').inner_text() == 'clip'
    assert '1 note' in cards(page).first.inner_text()
    assert cards(page).first.locator('img').count() == 1
    page.click('#dayBack'); page.wait_for_selector('.rv-day')
    assert 'TODAY' in page.inner_text('.rv-day') and '1 video' in page.inner_text('.rv-day')

def test_edit_survives_immediate_reload(page):
    home(page); new_review(page); in_player(page)
    page.click('#annBtn'); page.click('#noteBtn'); page.fill('#noteIn', 'keep me'); page.click('#noteOk')
    page.wait_for_timeout(30); page.reload()
    in_player(page)
    page.click('#more')
    assert 'keep me' in page.inner_text('#notes')

def test_state_restored(page):
    home(page); new_review(page); in_player(page)
    for _ in range(12): page.mouse.click(370, 170)
    page.click('#inBtn')
    for _ in range(11): page.mouse.click(370, 170)
    page.click('#outBtn')
    page.click('#secBtn'); page.click('#wShape'); page.click('#secRates [data-r="0.5"]'); page.click('#secBtn')
    page.click('#rateBtn'); page.click('#rateList [data-r="0.25"]')
    back(page); cards(page).first.click(); in_player(page)
    assert page.inner_text('#viewBtn') == 'Retimed'
    assert '/ 84' in page.inner_text('#fr')
    assert page.inner_text('#rangeTxt') == 'Loop 13–36'
    assert page.inner_text('#rateBtn') == '0.25×'

def test_bad_clip_makes_no_review(page, tmp_path):
    home(page)
    bad = tmp_path / 'broken.mp4'; bad.write_text('this is not a video')
    add(page, bad)
    page.wait_for_function("document.getElementById('toast').textContent.includes(\"can't be opened\")", timeout=30000)
    assert page.locator('#reviews.show').count() == 1
    assert cards(page).count() == 0
    assert page.evaluate("async () => (await (await import('/js/store.js')).listReviews()).length") == 0

def test_missing_clip_repick(page):
    home(page); new_review(page); in_player(page)
    page.click('#annBtn'); page.click('#noteBtn'); page.fill('#noteIn', 'still here'); page.click('#noteOk')
    back(page)
    page.wait_for_selector('.rv-clip')
    page.evaluate('''async () => { const db = await new Promise(r => { const q = indexedDB.open('quarry-go'); q.onsuccess = () => r(q.result); });
        await new Promise(r => { const tx = db.transaction('clips', 'readwrite'); tx.objectStore('clips').clear(); tx.oncomplete = r; }); db.close(); }''')
    cards(page).first.click()
    page.wait_for_selector('#missing.show', timeout=8000)
    assert 'missing' in page.inner_text('#missing')
    page.set_input_files('#file', str(FIX / 'clip.webm'))
    in_player(page); page.click('#more')
    assert 'still here' in page.inner_text('#notes')
    assert page.evaluate("async () => { const S = await import('/js/store.js'); const [r] = await S.listReviews(); return !!(await S.getClip(r.id)); }")

def test_repicked_clip_of_another_length_takes_its_frame_count(page):
    home(page); new_review(page); in_player(page); back(page)
    page.wait_for_selector('.rv-clip')
    page.evaluate('''async () => { const db = await new Promise(r => { const q = indexedDB.open('quarry-go'); q.onsuccess = () => r(q.result); });
        await new Promise(r => { const tx = db.transaction('clips', 'readwrite'); tx.objectStore('clips').clear(); tx.oncomplete = r; }); db.close(); }''')
    cards(page).first.click()
    page.wait_for_selector('#missing.show', timeout=8000)
    page.set_input_files('#file', str(FIX / 'mixed.gif'))
    in_player(page)
    assert page.inner_text('#fr').endswith('/ 7')
    r = page.evaluate("async () => { const S = await import('/js/store.js'); await S.flush(); const [r] = await S.listReviews(); return r; }")
    assert r['frameCount'] == 7 and r['fileName'] == 'mixed.gif'

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
    page.wait_for_function("!document.querySelector('.rv-clip')")
    assert page.evaluate("async () => (await (await import('/js/store.js')).usage()).bytes") == 0

def test_settings(page):
    home(page); new_review(page); in_player(page); back(page)
    page.click('#dayBack')  # Settings is on the history screen
    page.click('#gear'); page.wait_for_selector('#settingsVeil', state='visible')
    assert 'MB' in page.inner_text('#spaceUsed')
    assert 'Version' in page.inner_text('#settingsVeil')
    page.click('#deleteAll'); page.click('#confirmYes')
    page.wait_for_function("!document.querySelector('.rv-clip') && !document.querySelector('.rv-day')")

def test_leaving_stops_loading(page):
    home(page); new_review(page); in_player(page); back(page)
    cards(page).first.click()
    page.wait_for_selector('#player', state='visible', timeout=10000)
    page.click('#back'); page.wait_for_selector('#reviews.show', timeout=8000)
    page.wait_for_function("document.querySelectorAll('video').length === 0", timeout=1500)

def test_newest_open_wins(page):
    home(page)
    new_review(page); in_player(page); back(page)
    new_review(page, FIX / 'mixed.gif'); in_player(page); back(page)
    ids = page.evaluate("async () => (await (await import('/js/store.js')).listReviews()).map(r => [r.name, r.id])")
    ids = dict(ids)
    page.evaluate(f"location.hash = '#/r/{ids['clip']}'")
    page.wait_for_timeout(50)
    page.evaluate(f"location.hash = '#/r/{ids['mixed']}'")
    page.wait_for_timeout(4000)
    assert page.inner_text('#fr').endswith('/ 7')
    assert page.locator('#player').is_visible()

def test_old_review_drawings_keep_12_frames(page):
    home(page)
    clip = (FIX / 'clip.webm').read_bytes()
    rid = page.evaluate('''async bytes => { const S = await import('/js/store.js');
        const r = await S.createReview({ name: 'old', fps: 24, frameCount: 72, marks: [{ f: 0, type: 'box', x1: 100, y1: 100, x2: 500, y2: 300 }] },
            new Blob([new Uint8Array(bytes)], { type: 'video/webm' })); return r.id; }''', list(clip))
    page.evaluate(f"location.hash = '#/r/{rid}'"); in_player(page)
    red = "(r, g, b) => r > 230 && g > 40 && g < 80 && b > 75 && b < 110"
    # look only along the box's top edge (video 200..400, y 100), mapped to the screen
    seen = lambda: page.evaluate(f'''() => {{ const c = document.getElementById('cv'), x = c.getContext('2d'), ok = {red};
        const s = Math.min(c.width / 640, c.height / 360), ox = (c.width - 640 * s) / 2, oy = (c.height - 360 * s) / 2;
        for (let vx = 200; vx < 400; vx += 4) for (let dy = -3; dy <= 3; dy++) {{
            const [r, g, b] = x.getImageData(ox + vx * s, oy + 100 * s + dy, 1, 1).data; if (ok(r, g, b)) return true; }}
        return false; }}''')
    assert seen()
    for _ in range(11): page.mouse.click(370, 170)
    assert seen()
    page.mouse.click(370, 170)
    assert not seen()

def test_videos_from_photos_with_code_names_become_video_1_2(page, tmp_path):
    import shutil
    home(page)
    a = tmp_path / 'adf40401c68e605028d78a3d8c0b1e2f.webm'; b = tmp_path / 'ec22deccd6b1bf84d30dd0a4bdd9aa11.webm'
    shutil.copy(FIX / 'clip.webm', a); shutil.copy(FIX / 'clip.webm', b)
    add(page, a)
    page.wait_for_function("document.querySelectorAll('.rv-clip').length === 1", timeout=30000)
    add(page, b, FIX / 'clip.webm')
    page.wait_for_function("document.querySelectorAll('.rv-clip').length === 3", timeout=30000)
    names = sorted(page.locator('.rv-name').all_inner_texts())
    assert names == ['Video 1', 'Video 2', 'clip'], names
