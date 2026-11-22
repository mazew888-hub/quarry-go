"""The player, opened straight on a fixture through the localhost-only ?test=player route."""
import subprocess

BASE = 'http://localhost:8765/'

def open_clip(page, clip='clip.webm', extra=''):
    page.goto(f'{BASE}?test=player&clip={clip}{extra}')
    page.wait_for_selector('#player', state='visible', timeout=8000)

def loaded(page):
    page.wait_for_function("document.getElementById('log2').textContent.includes('loaded in')", timeout=30000)

def step(page, k, x=370):
    for _ in range(k): page.mouse.click(x, 400)

def fr(page): return page.inner_text('#fr')

def scrub_to(page, f, n):
    bx = page.locator('#scrub').bounding_box()
    page.mouse.click(bx['x'] + bx['width'] * (f + 0.5) / n, bx['y'] + bx['height'] / 2)

def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries',
                          'stream=width,nb_read_frames', '-of', 'csv=p=0', path], capture_output=True, text=True).stdout
    w, n = out.strip().split(','); return int(w), int(n)

def test_progressive_load(page):
    import time
    t0 = time.time(); open_clip(page)
    assert time.time() - t0 < 4
    loaded(page)
    assert fr(page).endswith('/ 72')

def test_range_wrap_and_slide(page):
    open_clip(page); loaded(page)
    step(page, 12); page.click('#inBtn'); step(page, 11); page.click('#outBtn')
    assert page.inner_text('#rangeTxt') == 'Loop 13–24'
    step(page, 1); assert fr(page).startswith('13')            # stepping past Out wraps to In
    page.mouse.move(200, 400); page.mouse.down(); page.mouse.move(400, 400, steps=10); page.mouse.up()
    n = int(fr(page).split(' ')[0]); assert 13 <= n <= 24      # sliding stays inside the loop

def test_loop_chip_and_hold_clear(page):
    open_clip(page); loaded(page)
    step(page, 12); page.click('#inBtn'); step(page, 11); page.click('#outBtn')
    assert page.inner_text('#inBtn') == 'In 13' and page.inner_text('#outBtn') == 'Out 24'
    bx = page.locator('#outBtn').bounding_box()
    page.mouse.move(bx['x'] + 20, bx['y'] + 20); page.mouse.down(); page.wait_for_timeout(700); page.mouse.up()
    assert page.inner_text('#outBtn') == 'Out' and page.inner_text('#inBtn') == 'In 13'
    page.click('#rangeChip')
    assert page.inner_text('#inBtn') == 'In' and not page.locator('#rangeChip').is_visible()

def make_sections(page):
    step(page, 12); page.click('#inBtn'); step(page, 11); page.click('#outBtn')
    page.click('#secBtn'); page.click('#secRates [data-r="0.5"]')
    assert '/ 84' in fr(page)
    page.click('#rangeChip'); page.click('#viewBtn')            # original view: plain frame numbers
    scrub_to(page, 40, 72); page.click('#inBtn'); scrub_to(page, 45, 72); page.click('#outBtn')
    page.click('#secBtn'); page.click('#secHold')
    page.click('#rangeChip'); page.click('#viewBtn')
    scrub_to(page, 50, 72); page.click('#inBtn'); scrub_to(page, 60, 72); page.click('#outBtn')
    page.click('#secBtn'); page.click('#secCut')

def test_retime_sections(page):
    open_clip(page); loaded(page)
    make_sections(page)
    assert fr(page).split('/ ')[1].split(' ')[0] == '73'
    assert page.inner_text('#viewBtn') == 'Retimed'

def test_exports(page, tmp_path):
    open_clip(page); loaded(page)
    page.click('#more')
    with page.expect_download(timeout=30000) as d: page.click('#export')
    p = tmp_path / 'notes.mp4'; d.value.save_as(p); assert probe(p)[1] == 72
    make_sections(page)
    page.click('#more')
    with page.expect_download(timeout=30000) as d: page.click('#export')
    p = tmp_path / 'ret.mp4'; d.value.save_as(p); assert probe(p) == (640, 73)
    page.click('#more')
    with page.expect_download(timeout=30000) as d: page.click('#exportBoth')
    p = tmp_path / 'both.mp4'; d.value.save_as(p); assert probe(p) == (1288, 73)

def centre_rgb(page):
    return page.evaluate('''() => { const c = document.getElementById('cv');
        return [...c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data].slice(0, 3); }''')

def test_gif_plays(page):
    open_clip(page, 'mixed.gif'); loaded(page)
    assert fr(page).endswith('/ 7')
    seen = []
    for _ in range(7):
        r, g, b = centre_rgb(page); seen.append('R' if r > 200 else 'G' if g > 200 else 'B' if b > 200 else '?')
        step(page, 1)
    assert ''.join(seen) == 'RGGGBBB'

def test_onchange_fires(page):
    open_clip(page); loaded(page)
    page.click('#annBtn'); page.click('#noteBtn'); page.fill('#noteIn', 'arc is flat'); page.click('#noteOk')
    changes = page.evaluate('window.changes')
    assert any('marks' in c and c['marks'][-1]['text'] == 'arc is flat' for c in changes)

def test_too_long_refused_before_save(page):
    page.goto(f'{BASE}?test=player&clip=clip.webm&maxBytes=1000')
    page.wait_for_function("document.getElementById('toast').textContent.includes('too long')", timeout=15000)
    assert page.evaluate('window.changes') == []
    assert not page.locator('#player').is_visible()
