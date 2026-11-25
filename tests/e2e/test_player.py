"""The player, opened straight on a fixture through the localhost-only ?test=player route."""
import subprocess

BASE = 'http://localhost:8765/'
VY = 170  # the middle of the video, under the header (the video spans y 60-279 at 390x844)

def open_clip(page, clip='clip.webm', extra=''):
    page.goto(f'{BASE}?test=player&clip={clip}{extra}')
    page.wait_for_selector('#player', state='visible', timeout=8000)

def loaded(page):
    page.wait_for_function("document.getElementById('log2').textContent.includes('loaded in')", timeout=30000)

def step(page, k, x=370):
    for _ in range(k): page.mouse.click(x, VY)

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
    page.mouse.move(200, VY); page.mouse.down(); page.mouse.move(400, VY, steps=10); page.mouse.up()
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
    # Retime opens the time warp; Shape puts Hold, Cut or a speed over In-Out (played frames)
    page.click('#secBtn')
    step(page, 12); page.click('#inBtn'); step(page, 11); page.click('#outBtn')
    page.click('#wShape'); page.click('#secRates [data-r="0.5"]')
    assert '/ 84' in fr(page)
    page.click('#rangeChip')
    scrub_to(page, 40, 84); page.click('#inBtn'); scrub_to(page, 45, 84); page.click('#outBtn')
    page.click('#wShape'); page.click('#secHold')
    assert '/ 84' in fr(page)
    page.click('#rangeChip')
    scrub_to(page, 50, 84); page.click('#inBtn'); scrub_to(page, 60, 84); page.click('#outBtn')
    page.click('#wShape'); page.click('#secCut')

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
    assert page.inner_text('#annBtn') == 'Done'  # the rail shows the drawing tools until Done
    page.mouse.move(120, 150); page.mouse.down()
    for i in range(1, 21): page.mouse.move(120 + i * 8, 150 + (i % 5) * 3)
    page.mouse.up()
    m = page.evaluate('window.changes')[-1]['marks'][-1]
    assert m['type'] == 'draw' and len(m['pts']) > 5
    hit = page.evaluate('''() => { const c = document.getElementById('cv'), x = c.getContext('2d'), d = devicePixelRatio;
        for (let px = 125; px < 275; px += 2) for (let py = 80; py < 110; py++) {
            const [r, g, b] = x.getImageData(px * d, py * d, 1, 1).data; if (r > 230 && g > 40 && g < 80 && b > 75 && b < 110) return true; }
        return false; }''')
    assert hit
    page.click('#undo')
    assert page.evaluate('window.changes')[-1]['marks'] == []


# ---------- draw-over: pen bar, holds on the timeline, eraser, clear and undo
PEN = "(r, g, b) => r > 230 && g > 40 && g < 80 && b > 75 && b < 110"
BLUE = "(r, g, b) => r < 110 && g > 140 && g < 190 && b > 230"

def ink(page, test=PEN, box=(100, 40, 300, 150)):  # in the video canvas (page y minus the 60px header)
    return page.evaluate(f'''() => {{ const c = document.getElementById('cv'), x = c.getContext('2d'), d = devicePixelRatio, ok = {test};
        for (let px = {box[0]}; px < {box[2]}; px += 2) for (let py = {box[1]}; py < {box[3]}; py += 2) {{
            const [r, g, b] = x.getImageData(px * d, py * d, 1, 1).data; if (ok(r, g, b)) return true; }}
        return false; }}''')

def stroke(page, x0=120, x1=280, y=150):
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
    stroke(page, y=130)
    small = last(page, 'marks')[-1]['size']
    page.click('#penRow [data-color="#4FA3FF"]'); page.click('#penRow [data-size="3"]')
    stroke(page, y=170)
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
    stroke(page, y=130)
    page.click('#annBtn')
    x, y = lane_x(page, 0, end=True); x2, _ = lane_x(page, 4, end=True)
    page.mouse.move(x - 1, y); page.mouse.down(); page.mouse.move(x2 - 1, y, steps=6); page.mouse.up()
    step(page, 2); pen(page); stroke(page, y=170)
    assert [m['f'] for m in last(page, 'marks')] == [0, 0]

def test_tap_lane_bar_jumps(page):
    open_clip(page); loaded(page)
    step(page, 10); pen(page); stroke(page); page.click('#annBtn')
    step(page, 20)
    x, y = lane_x(page, 10); page.mouse.click(x + 1, y)
    assert fr(page).startswith('11')

def test_eraser_splits_stroke(page):
    open_clip(page); loaded(page); pen(page)
    stroke(page, 100, 300, 150)
    page.click('#eraseBtn')
    page.mouse.move(200, 110); page.mouse.down(); page.mouse.move(200, 190, steps=8); page.mouse.up()
    drawn = [m for m in last(page, 'marks') if m['type'] == 'draw']
    assert len(drawn) == 2

def test_clear_and_undo(page):
    open_clip(page); loaded(page); pen(page)
    stroke(page, y=130); stroke(page, y=170)
    page.click('#clearBtn')
    assert [m for m in last(page, 'marks') if m['type'] == 'draw'] == []
    assert not ink(page)
    page.click('#undo')
    assert len(last(page, 'marks')) == 2 and ink(page)

def test_eraser_undo_restores(page):
    open_clip(page); loaded(page); pen(page)
    stroke(page, 100, 300, 150)
    page.click('#eraseBtn')
    page.mouse.move(200, 110); page.mouse.down(); page.mouse.move(200, 190, steps=8); page.mouse.up()
    page.click('#undo')
    assert len(last(page, 'marks')) == 1


# ---------- phone layout: notes under the video, tools on the rail, sideways fills the height
def test_notes_list_jumps_to_frame(page):
    open_clip(page); loaded(page)
    assert 'No notes yet' in page.inner_text('#pNotes')
    step(page, 20); page.click('#annBtn'); page.click('#noteBtn'); page.fill('#noteIn', 'arc is flat'); page.click('#noteOk')
    step(page, 5); page.click('#drawBtn'); stroke(page); page.click('#annBtn')  # the tray is still open from the note
    rows = page.locator('#pList .pli')
    assert rows.count() == 2
    assert rows.nth(0).inner_text().split('\n')[0] == '21' and 'arc is flat' in rows.nth(0).inner_text()
    assert 'Drawing' in rows.nth(1).inner_text()
    assert '1 note' in page.inner_text('#pSub') and '1 drawing' in page.inner_text('#pSub')
    step(page, 10)
    rows.nth(0).click()
    assert fr(page).startswith('21')
    assert 'on' in rows.nth(0).get_attribute('class')

def test_step_keys(page):
    open_clip(page); loaded(page)
    page.click('#stepFwd'); page.click('#stepFwd'); assert fr(page).startswith('3')
    page.click('#stepBack'); assert fr(page).startswith('2')
    page.click('#stepBack'); page.click('#stepBack'); assert fr(page).startswith('72')  # wraps

def test_rail_swaps_to_tools_and_back(page):
    open_clip(page); loaded(page)
    assert page.locator('#inBtn').is_visible() and not page.locator('#drawBtn').is_visible()
    page.click('#annBtn')
    assert page.locator('#drawBtn').is_visible() and page.locator('#penRow').is_visible() and page.locator('#undo').is_visible()
    assert not page.locator('#inBtn').is_visible()
    page.click('#annBtn')
    assert page.inner_text('#annBtn') == 'Draw' and page.locator('#inBtn').is_visible() and not page.locator('#undo').is_visible()

def test_upright_video_sits_under_the_header(page):
    open_clip(page); loaded(page)
    st = page.locator('#stage').bounding_box(), 
    st = st[0]
    assert abs(st['height'] - 390 * 360 / 640) < 2 and st['y'] < 80
    assert page.locator('#pNotes').is_visible() and page.locator('#rail').is_visible()

def test_sideways_video_fills_the_height(page):
    page.set_viewport_size({'width': 844, 'height': 390})
    open_clip(page); loaded(page)
    st = page.locator('#stage').bounding_box(), page.locator('#rail').bounding_box()
    assert st[0]['height'] > 385 and st[1]['x'] > st[0]['x'] + st[0]['width'] - 1  # rail to the right of the video
    assert not page.locator('#pNotes').is_visible()
    page.click('#stepFwd'); assert fr(page).startswith('2')
    # taps on the video still step frames, measured from the video's own edges
    bx = page.locator('#cv').bounding_box()
    page.mouse.click(bx['x'] + bx['width'] * 0.9, bx['y'] + bx['height'] / 2); assert fr(page).startswith('3')
    page.mouse.click(bx['x'] + bx['width'] * 0.1, bx['y'] + bx['height'] / 2); assert fr(page).startswith('2')


# ---------- time warp: keys on a curve, nudges, tangents, frame keys
def warp_keys(page):
    return [c['warp']['keys'] for c in page.evaluate('window.changes') if c.get('warp')][-1]

def test_time_warp_keys_and_nudges(page):
    open_clip(page); loaded(page)
    page.click('#secBtn')
    assert page.locator('#wPanel').is_visible() and not page.locator('#pNotes').is_visible()
    step(page, 10); page.click('#wKey')
    assert [k['x'] for k in warp_keys(page)] == [0, 10, 71]
    assert 'Key 2' in page.inner_text('#wInfo')
    # everything after the playhead a frame later: one more played frame
    page.click('#wRight'); assert fr(page).endswith('/ 73') or '/ 73' in fr(page)
    page.click('#wLeft'); page.click('#wLeft'); assert '/ 71' in fr(page)
    page.click('#wRight')
    # the selected key a frame later in the video: frame 11 now shows video frame 12
    page.click('#wUp')
    assert warp_keys(page)[1]['y'] == 11 and '· fr 12' in fr(page)
    page.click('#wDown'); page.click('#wDown')
    assert warp_keys(page)[1]['y'] == 9
    # tangent cycles; delete takes the key away; undo brings it back
    page.click('#wTan'); assert page.inner_text('#wTan') == 'Smooth' and warp_keys(page)[1]['t'] == 'smooth'
    page.click('#wTan'); page.click('#wTan'); assert page.inner_text('#wTan') == 'Stepped'
    page.click('#wDel'); assert len(warp_keys(page)) == 2
    page.click('#undo'); assert len(warp_keys(page)) == 3
    page.click('#secBtn')
    assert page.locator('#pNotes').is_visible() and page.inner_text('#viewBtn') == 'Retimed'

def test_frame_keys_and_drag(page):
    open_clip(page); loaded(page); page.click('#secBtn')
    for f in [10, 20, 30, 40, 50, 60]:
        scrub_to(page, f, 72); page.click('#wKey')
    scrub_to(page, 35, 72)
    page.click('#wFrame'); assert page.inner_text('#wFrame') == 'All'
    page.click('#wFrame'); assert page.inner_text('#wFrame') == 'Frame'
    # drag the key at frame 30 up: it shows a later video frame
    bx = page.locator('#wCurve').bounding_box()
    kx = bx['x'] + bx['width'] * (30 + 71 * 0.03) / (71 * 1.06); ky = bx['y'] + bx['height'] - bx['height'] * (30 + 72 * 0.04) / (71 * 1.04 + 72 * 0.04)
    page.mouse.move(kx, ky); page.mouse.down(); page.mouse.move(kx, ky - 40, steps=6); page.mouse.up()
    k = [k for k in warp_keys(page) if k['x'] == 30][0]
    assert k['y'] > 32, k

def test_old_sections_open_as_a_curve(page):
    page.goto(f'{BASE}?test=player&clip=clip.webm&secs=' + '[{"a":5,"b":9,"type":"hold"}]')
    page.wait_for_selector('#player', state='visible'); loaded(page)
    assert page.inner_text('#viewBtn') == 'Retimed'
    page.click('#secBtn')
    step(page, 7); assert '· fr 6' in fr(page)     # played frame 8 shows the held video frame 6


# ---------- drawing aids: onion skin and tracing paper
RED_GHOST = "(r, g, b) => r > 50 && r < 200 && g < 45 && b < 60"   # the red pen faded over the black bar
def black_bar_stroke(page):
    page.mouse.move(18, 110); page.mouse.down()
    for i in range(1, 16): page.mouse.move(18, 110 + i * 6)
    page.mouse.up()

def test_onion_skin_shows_nearby_drawings_faded(page):
    open_clip(page); loaded(page)
    step(page, 10); pen(page); black_bar_stroke(page); page.click('#annBtn')
    step(page, 2)                                   # two frames on: the drawing (held 1 frame) is gone
    assert not ink(page, RED_GHOST, box=(10, 50, 26, 140))
    page.click('#more'); page.click('#onionBtn'); page.click('#moreVeil', position={'x': 10, 'y': 10})
    assert ink(page, RED_GHOST, box=(10, 50, 26, 140))
    page.click('#more'); page.click('#onionAfter [data-d="1"]'); assert page.inner_text('#onionAfter .n') == '3'
    page.click('#onionBtn'); page.click('#moreVeil', position={'x': 10, 'y': 10})
    assert not ink(page, RED_GHOST, box=(10, 50, 26, 140))

def test_tracing_paper_lightens_the_video_and_is_saved(page):
    open_clip(page); loaded(page)
    dark = "(r, g, b) => r < 30 && g < 30 && b < 30"
    assert ink(page, dark, box=(8, 120, 20, 130))
    page.click('#more'); page.click('#paperBtn'); page.click('#moreVeil', position={'x': 10, 'y': 10})
    assert not ink(page, dark, box=(8, 120, 20, 130))
    assert ink(page, "(r, g, b) => r > 90 && g > 90 && b > 90", box=(8, 120, 20, 130))
    assert [c['trace'] for c in page.evaluate('window.changes') if 'trace' in c][-1] == 0.5
    page.click('#more'); page.click('#paperAmt [data-t="0.75"]')
    assert [c['trace'] for c in page.evaluate('window.changes') if 'trace' in c][-1] == 0.75

def test_tap_either_side_of_the_graph_playhead_steps(page):
    open_clip(page); loaded(page); page.click('#secBtn')
    scrub_to(page, 30, 72); assert fr(page).startswith('31')
    bx = page.locator('#wCurve').bounding_box(), 
    bx = bx[0]; y = bx['y'] + 12                       # along the top, away from the keys
    page.mouse.click(bx['x'] + bx['width'] * 0.85, y); assert fr(page).startswith('32')
    page.mouse.click(bx['x'] + bx['width'] * 0.85, y); assert fr(page).startswith('33')
    page.mouse.click(bx['x'] + bx['width'] * 0.10, y); assert fr(page).startswith('32')
    # a drag still scrubs to where the finger is
    page.mouse.move(bx['x'] + bx['width'] * 0.2, y); page.mouse.down(); page.mouse.move(bx['x'] + bx['width'] * 0.8, y, steps=8); page.mouse.up()
    assert int(fr(page).split(' ')[0]) > 50

def test_rotating_keeps_the_video_in_shape(page):
    # the video canvas's pixels always match its box after turning the phone, both ways
    open_clip(page); loaded(page)
    def fits():
        return page.evaluate('''() => { const c = document.getElementById('cv'), r = c.getBoundingClientRect(), d = devicePixelRatio;
            return Math.abs(c.width - r.width * d) < 2 && Math.abs(c.height - r.height * d) < 2; }''')
    for vp in [(844, 390), (390, 844), (844, 390)]:
        page.set_viewport_size({'width': vp[0], 'height': vp[1]})
        page.wait_for_function('''() => { const c = document.getElementById('cv'), r = c.getBoundingClientRect(), d = devicePixelRatio;
            return Math.abs(c.width - r.width * d) < 2 && Math.abs(c.height - r.height * d) < 2; }''', timeout=3000)
        assert fits()

def test_leaving_the_player_stops_an_export(page):
    from test_app import home, new_review, in_player, back
    page.add_init_script("window.__slowExport = 40")   # ms per frame, so the export is still going when we leave
    home(page); new_review(page); in_player(page)
    page.click('#more'); page.click('#export')
    page.wait_for_function("document.getElementById('stxt').textContent.startsWith('Exporting')", timeout=10000)
    back(page)
    page.wait_for_timeout(4500)                      # longer than the whole export would take
    assert not page.locator('#status').is_visible()
    assert 'exported' not in page.inner_text('#log2')
