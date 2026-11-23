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

def test_export_shares_from_a_fresh_tap(page):
    page.add_init_script('''
        const mm = window.matchMedia.bind(window);
        window.matchMedia = q => q === '(pointer: coarse)' ? { matches: true, addEventListener() {}, removeEventListener() {} } : mm(q);
        navigator.canShare = () => true;
        navigator.share = async d => { window.shared = d.files[0].name; };
    ''')
    open_clip(page); loaded(page)
    page.click('#more'); page.click('#export')
    page.wait_for_selector('#shareVeil', state='visible', timeout=20000)
    assert page.evaluate('window.shared') is None      # nothing shared until the tap
    page.click('#shareBtn')
    page.wait_for_function('window.shared === "clip - notes.mp4"')

def test_freehand_draw(page):
    open_clip(page); loaded(page)
    page.click('#annBtn'); page.click('#drawBtn')
    assert page.inner_text('#annBtn') == 'Draw'
    page.mouse.move(120, 380); page.mouse.down()
    for i in range(1, 21): page.mouse.move(120 + i * 8, 380 + (i % 5) * 3)
    page.mouse.up()
    m = page.evaluate('window.changes')[-1]['marks'][-1]
    assert m['type'] == 'draw' and len(m['pts']) > 5
    hit = page.evaluate('''() => { const c = document.getElementById('cv'), x = c.getContext('2d'), d = devicePixelRatio;
        for (let px = 125; px < 275; px += 2) for (let py = 370; py < 400; py++) {
            const [r, g, b] = x.getImageData(px * d, py * d, 1, 1).data; if (r > 230 && g > 40 && g < 80 && b > 75 && b < 110) return true; }
        return false; }''')
    assert hit
    page.click('#undo')
    assert page.evaluate('window.changes')[-1]['marks'] == []


# ---------- draw-over: pen bar, holds on the timeline, eraser, clear and undo
PEN = "(r, g, b) => r > 230 && g > 40 && g < 80 && b > 75 && b < 110"
BLUE = "(r, g, b) => r < 110 && g > 140 && g < 190 && b > 230"

def ink(page, test=PEN, box=(100, 330, 300, 430)):
    return page.evaluate(f'''() => {{ const c = document.getElementById('cv'), x = c.getContext('2d'), d = devicePixelRatio, ok = {test};
        for (let px = {box[0]}; px < {box[2]}; px += 2) for (let py = {box[1]}; py < {box[3]}; py += 2) {{
            const [r, g, b] = x.getImageData(px * d, py * d, 1, 1).data; if (ok(r, g, b)) return true; }}
        return false; }}''')

def stroke(page, x0=120, x1=280, y=380):
    page.mouse.move(x0, y); page.mouse.down()
    for i in range(1, 21): page.mouse.move(x0 + (x1 - x0) * i / 20, y)
    page.mouse.up()

def pen(page):
    page.click('#annBtn'); page.click('#drawBtn')

def last(page, key):
    return [c[key] for c in page.evaluate('window.changes') if key in c][-1]

def lane_x(page, f, n=72, end=False):
    bx = page.locator('#drawLane').bounding_box()
    return bx['x'] + bx['width'] * ((f + 1) if end else f) / n, bx['y'] + bx['height'] / 2

def test_new_drawing_holds_one_frame(page):
    open_clip(page); loaded(page); pen(page)
    stroke(page)
    assert ink(page)
    page.click('#annBtn')                      # close the tray; taps step frames again
    step(page, 1)
    assert not ink(page)

def test_pen_colour_and_size(page):
    open_clip(page); loaded(page); pen(page)
    stroke(page, y=360)
    small = last(page, 'marks')[-1]['size']
    page.click('#penRow [data-color="#4FA3FF"]'); page.click('#penRow [data-size="3"]')
    stroke(page, y=400)
    m = last(page, 'marks')[-1]
    assert m['color'] == '#4FA3FF' and m['size'] > small
    assert ink(page, BLUE)

def test_stretch_hold_on_lane(page):
    open_clip(page); loaded(page); pen(page)
    stroke(page)
    page.click('#annBtn')
    x, y = lane_x(page, 0, end=True); x2, _ = lane_x(page, 4, end=True)
    page.mouse.move(x - 1, y); page.mouse.down(); page.mouse.move(x2 - 1, y, steps=6); page.mouse.up()
    assert last(page, 'holds') == {'0': 5}
    step(page, 4); assert ink(page)
    step(page, 1); assert not ink(page)

def test_draw_on_held_frame_adds_to_drawing(page):
    open_clip(page); loaded(page); pen(page)
    stroke(page, y=360)
    page.click('#annBtn')
    x, y = lane_x(page, 0, end=True); x2, _ = lane_x(page, 4, end=True)
    page.mouse.move(x - 1, y); page.mouse.down(); page.mouse.move(x2 - 1, y, steps=6); page.mouse.up()
    step(page, 2); pen(page); stroke(page, y=400)
    assert [m['f'] for m in last(page, 'marks')] == [0, 0]

def test_tap_lane_bar_jumps(page):
    open_clip(page); loaded(page)
    step(page, 10); pen(page); stroke(page); page.click('#annBtn')
    step(page, 20)
    x, y = lane_x(page, 10); page.mouse.click(x + 1, y)
    assert fr(page).startswith('11')

def test_eraser_splits_stroke(page):
    open_clip(page); loaded(page); pen(page)
    stroke(page, 100, 300, 380)
    page.click('#eraseBtn')
    page.mouse.move(200, 340); page.mouse.down(); page.mouse.move(200, 420, steps=8); page.mouse.up()
    drawn = [m for m in last(page, 'marks') if m['type'] == 'draw']
    assert len(drawn) == 2

def test_clear_and_undo(page):
    open_clip(page); loaded(page); pen(page)
    stroke(page, y=360); stroke(page, y=400)
    page.click('#clearBtn')
    assert [m for m in last(page, 'marks') if m['type'] == 'draw'] == []
    assert not ink(page)
    page.click('#undo')
    assert len(last(page, 'marks')) == 2 and ink(page)

def test_eraser_undo_restores(page):
    open_clip(page); loaded(page); pen(page)
    stroke(page, 100, 300, 380)
    page.click('#eraseBtn')
    page.mouse.move(200, 340); page.mouse.down(); page.mouse.move(200, 420, steps=8); page.mouse.up()
    page.click('#undo')
    assert len(last(page, 'marks')) == 1
