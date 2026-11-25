"""Reviews as days: adding several videos at once, the history, and Export notes as a zip."""
import json, py_compile, re, zipfile
from pathlib import Path

BASE = 'http://localhost:8765/'
FIX = Path(__file__).resolve().parents[1] / 'fixtures'

def home(page):
    page.goto(BASE); page.wait_for_selector('#reviews.show', timeout=8000)
    page.evaluate("async () => { const S = await import('/js/store.js'); await S.deleteAll(); }")
    page.reload(); page.wait_for_selector('#reviews.show', timeout=8000)

def add(page, *paths, rows):
    page.set_input_files('#file', [str(p) for p in paths])
    page.wait_for_function(f"location.hash.startsWith('#/d/') && document.querySelectorAll('.rv-clip').length === {rows}", timeout=40000)

def long_press(page, loc):
    bx = loc.bounding_box()
    page.mouse.move(bx['x'] + 30, bx['y'] + bx['height'] / 2); page.mouse.down(); page.wait_for_timeout(700); page.mouse.up()

def today(page): return page.evaluate("async () => (await import('/js/days.js')).today()")

def test_add_several_at_once(page):
    home(page)
    add(page, FIX / 'clip.webm', FIX / 'mixed.gif', rows=2)
    assert page.url.endswith('#/d/' + today(page))
    names = page.locator('.rv-clip .rv-name').all_inner_texts()
    assert names == ['clip', 'mixed'], names  # in the order picked
    assert '2 VIDEOS' in page.inner_text('.rv-cap').upper()
    # adding more goes into the same review
    add(page, FIX / 'solid3.gif', rows=3)
    page.click('#dayBack'); page.wait_for_selector('.rv-day')
    card = page.inner_text('.rv-day')
    assert 'TODAY' in card and '3 videos' in card
    assert page.locator('.rv-day .rv-th img').count() == 3
    page.click('.rv-day'); page.wait_for_selector('.rv-clip')
    assert page.locator('.rv-clip').count() == 3

def test_player_back_returns_to_its_review(page):
    home(page); add(page, FIX / 'clip.webm', rows=1)
    day = page.url.split('#')[1]
    page.locator('.rv-clip').first.click()
    page.wait_for_function("document.getElementById('log2').textContent.includes('loaded in')", timeout=30000)
    page.click('#back')
    page.wait_for_selector('.rv-clip', timeout=8000)
    assert page.url.endswith('#' + day)

def test_one_bad_file_leaves_the_others(page, tmp_path):
    home(page)
    bad = tmp_path / 'broken.mp4'; bad.write_text('not a video')
    add(page, bad, FIX / 'clip.webm', rows=1)
    page.wait_for_function("document.getElementById('toast').textContent.includes(\"can't be opened\")", timeout=10000)
    assert page.locator('.rv-clip .rv-name').all_inner_texts() == ['clip']

def test_history_groups_older_days_and_deletes_a_day(page):
    home(page)
    clip = list((FIX / 'solid3.gif').read_bytes())
    page.evaluate('''async bytes => { const S = await import('/js/store.js');
        const b = () => new Blob([new Uint8Array(bytes)], { type: 'image/gif' });
        for (const [day, n] of [['2026-10-30', 2], ['2026-09-03', 1]]) for (let i = 0; i < n; i++)
            await S.createReview({ name: 'v' + i, day, marks: i ? [] : [{ f: 0, type: 'note', text: 'x' }] }, b()); }''', clip)
    page.reload(); page.wait_for_selector('.rv-dayrow')
    caps = page.locator('.rv-cap').all_inner_texts()
    assert [c.upper() for c in caps] == ['OCTOBER 2026', 'SEPTEMBER 2026'], caps
    row = page.locator('.rv-dayrow').first
    assert re.search(r'Fri\s+30 Oct\s+Week 5 · 2 videos', row.inner_text()), row.inner_text()
    row.click(); page.wait_for_selector('.rv-clip')
    assert page.url.endswith('#/d/2026-10-30')
    page.click('#dayBack'); page.wait_for_selector('.rv-dayrow')
    long_press(page, page.locator('.rv-dayrow').first)
    assert '2 VIDEOS' in page.inner_text('#confirmTxt').upper()
    page.click('#confirmYes')
    page.wait_for_function("document.querySelectorAll('.rv-dayrow').length === 1")
    assert page.evaluate("async () => (await (await import('/js/store.js')).listReviews()).length") == 1

def test_export_notes_zip(page, tmp_path):
    home(page)
    add(page, FIX / 'clip.webm', FIX / 'mixed.gif', FIX / 'solid3.gif', rows=3)
    # clip: a note and a box; mixed: retimed (a hold); solid3: nothing
    page.evaluate('''async () => { const S = await import('/js/store.js'); const rs = await S.listReviews();
        const by = n => rs.find(r => r.name === n).id;
        S.saveReview(by('clip'), { marks: [{ f: 5, type: 'note', text: 'Arc is flat here' }, { f: 2, type: 'box', x1: 100, y1: 100, x2: 300, y2: 200, color: '#4FA3FF', size: 4 }], holds: { 2: 3 } });
        S.saveReview(by('mixed'), { secs: [{ a: 1, b: 3, type: 'hold' }], retimed: true });
        await S.flush(); }''')
    page.reload(); page.wait_for_selector('.rv-clip')
    assert 'Retimed' in page.locator('.rv-clip').nth(1).inner_text()
    page.click('#exportNotes'); page.wait_for_selector('#exportVeil .ex-sheet')
    rows = page.locator('#exportVeil .ex-list .li')
    assert rows.count() == 2  # only videos with notes
    assert rows.nth(1).locator('.tg').count() == 4  # the retimed one has Time warp too
    assert '7 files' in page.inner_text('#exLine')  # 3 + 4
    page.click('#exOnly'); assert rows.count() == 3; page.click('#exOnly')
    # Maya off for everyone, then back on for clip only
    page.click('[data-flip="maya"]'); assert '5 files' in page.inner_text('#exLine')
    rows.nth(0).locator('[data-k="maya"]').click(); assert '6 files' in page.inner_text('#exLine')
    with page.expect_download(timeout=90000) as dl: page.click('#exGo')
    path = tmp_path / 'r.zip'; dl.value.save_as(path)
    assert dl.value.suggested_filename == f'Review {today(page)}.zip'
    z = zipfile.ZipFile(path)
    assert z.testzip() is None
    names = sorted(n.replace('.webm', '.mp4') for n in z.namelist())  # mp4 where the browser records it
    assert names == sorted(['clip/clip - notes.mp4', 'clip/clip - image plane.py', 'clip/clip.quarrynotes',
                            'mixed/mixed - notes.mp4', 'mixed/mixed - time warp.py', 'mixed/mixed.quarrynotes']), names
    assert [i.file_size for i in z.infolist() if i.filename.startswith('clip/clip - notes.')][0] > 10000
    notes = json.loads(z.read('clip/clip.quarrynotes'))
    assert notes['kind'] == 'review-notes' and notes['video']['name'] == 'clip.webm'
    assert [c['text'] for c in notes['comments']] == ['Arc is flat here'] and notes['comments'][0]['frame'] == 5
    assert notes['annotations'][0]['kind'] == 'rect' and notes['annotations'][0]['hold'] == 3
    out = tmp_path / 'x'; z.extractall(out)
    for p in ['clip/clip - image plane.py', 'mixed/mixed - time warp.py']: py_compile.compile(str(out / p), doraise=True)
    plane = (out / 'clip/clip - image plane.py').read_text()
    frames = plane.split('_FRAMES = [\n')[1].rstrip(']\n').strip().split('\n')
    assert len(frames) == 72 and all(f.startswith('"/9j/') for f in frames)  # JPGs, one per frame
    assert re.search(r"^SHOT = 'clip'  # QUARRY:SHOT$", plane, re.M)
    assert not page.locator('#exportVeil').is_visible()

def test_stop_export(page):
    home(page); add(page, FIX / 'clip.webm', rows=1)
    page.evaluate('''async () => { const S = await import('/js/store.js'); const [r] = await S.listReviews();
        S.saveReview(r.id, { marks: [{ f: 0, type: 'note', text: 'n' }] }); await S.flush(); }''')
    page.reload(); page.wait_for_selector('.rv-clip')
    page.click('#exportNotes'); page.click('#exGo')
    page.wait_for_function("document.getElementById('exLine').textContent.includes('frame')", timeout=30000)
    page.click('#exCancel')
    page.wait_for_function("document.getElementById('toast').textContent.includes('stopped')", timeout=10000)
    assert page.locator('#exGo').is_enabled()

def test_a_stall_mid_export_doesnt_get_into_the_video(page, tmp_path):
    # The phone pausing mid-export (screen locked, another app, a slow frame) must not change the video's timing.
    import subprocess
    home(page); add(page, FIX / 'clip.webm', rows=1)
    page.evaluate('''async () => { const S = await import('/js/store.js'); const [r] = await S.listReviews();
        S.saveReview(r.id, { marks: [{ f: 0, type: 'note', text: 'n' }] }); await S.flush(); }''')
    page.reload(); page.wait_for_selector('.rv-clip')
    page.click('#exportNotes'); page.click('[data-flip="maya"]'); page.click('[data-flip="notes"]')
    with page.expect_download(timeout=90000) as dl:
        page.click('#exGo')
        page.wait_for_function("/video, frame (1\\d|[2-9]\\d) /.test(document.getElementById('exLine')?.textContent || '')", timeout=30000, polling=20)
        page.evaluate("() => { const t = performance.now(); while (performance.now() - t < 2500) {} }")
    path = tmp_path / 'r.zip'; dl.value.save_as(path)
    z = zipfile.ZipFile(path); name = [n for n in z.namelist() if ' - notes.' in n][0]
    assert name.endswith('.mp4'), name
    out = tmp_path / 'v.mp4'; out.write_bytes(z.read(name))
    info = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-count_frames', '-show_entries',
        'stream=nb_read_frames,duration', '-of', 'json', str(out)]))['streams'][0]
    assert int(info['nb_read_frames']) == 72, info
    assert abs(float(info['duration']) - 3.0) < 0.01, info

def test_previews_are_kept_as_bytes_and_survive_saves(page):
    # iPhone can break a stored picture when its record is saved again (WebKit), so previews are kept as bytes
    home(page); add(page, FIX / 'clip.webm', rows=1)
    kind = page.evaluate("async () => { const [r] = await (await import('/js/store.js')).listReviews(); return Object.prototype.toString.call(r.thumb); }")
    assert kind == '[object ArrayBuffer]', kind
    page.locator('.rv-clip').first.click()
    page.wait_for_function("document.getElementById('log2').textContent.includes('loaded in')", timeout=30000)
    page.click('#back'); page.wait_for_selector('.rv-clip img')
    assert page.evaluate("() => { const i = document.querySelector('.rv-clip img'); return i.complete && i.naturalWidth > 0; }")

def test_missing_or_old_previews_are_rebuilt(page):
    home(page); add(page, FIX / 'clip.webm', FIX / 'mixed.gif', rows=2)
    # one review with no preview (as if it broke), one with an old-style picture
    page.evaluate('''async () => { const S = await import('/js/store.js'); const rs = await S.listReviews();
        const a = rs.find(r => r.name === 'clip'), b = rs.find(r => r.name === 'mixed');
        S.saveReview(a.id, { thumb: null });
        S.saveReview(b.id, { thumb: new Blob([new Uint8Array(b.thumb)], { type: 'image/jpeg' }) }); await S.flush(); }''')
    page.reload(); page.wait_for_selector('.rv-clip')
    page.wait_for_function("[...document.querySelectorAll('.rv-clip img')].length === 2 && [...document.querySelectorAll('.rv-clip img')].every(i => i.complete && i.naturalWidth > 0)", timeout=30000)
    kinds = page.evaluate("async () => (await (await import('/js/store.js')).listReviews()).map(r => Object.prototype.toString.call(r.thumb))")
    assert kinds == ['[object ArrayBuffer]'] * 2, kinds
