"""The player, opened straight on a fixture through the localhost-only ?test=player route."""
import subprocess

BASE = 'http://localhost:8765/'
VY = 170  # the middle of the video, under the header (the video spans y 60-279 at 390x844)

def open_clip(page, clip='clip.webm', extra=''):
    page.goto(f'{BASE}?test=player&clip={clip}{extra}')
    page.wait_for_selector('#player', state='visible', timeout=8000)

def loaded(page):
    page.wait_for_function("document.getElementById('log2').textContent.includes('loaded in')", timeout=30000)

def step(page, k, x=300):  # right third of the canvas, clear of the mode pill
    for _ in range(k): page.mouse.click(x, VY)

def fr(page): return page.inner_text('#fr')

def set_io(page, which):
    """In and Out live on the ruler: hold it at the playhead, then Set In / Set Out."""
    t = fr(page); p = int(t.split(' ')[0]) - 1; n = int(t.split('/ ')[1].split(' ')[0])
    bx = page.locator('#scrub').bounding_box(); x = bx['x'] + bx['width'] * (p + 0.5) / n; y = bx['y'] + bx['height'] / 2
    page.mouse.move(x, y); page.mouse.down(); page.wait_for_timeout(600); page.mouse.up()
    page.wait_for_selector('#ioMenu', state='visible'); page.click('#inBtn' if which == 'in' else '#outBtn')
def set_in(page): set_io(page, 'in')
def set_out(page): set_io(page, 'out')

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
    step(page, 12); set_in(page); step(page, 11); set_out(page)
    assert page.inner_text('#rangeTxt') == 'Loop 13–24'
    step(page, 1); assert fr(page).startswith('13')            # stepping past Out wraps to In
    page.mouse.move(200, VY); page.mouse.down(); page.mouse.move(400, VY, steps=10); page.mouse.up()
    n = int(fr(page).split(' ')[0]); assert 13 <= n <= 24      # sliding stays inside the loop

def test_loop_on_the_ruler(page):
    open_clip(page); loaded(page)
    step(page, 12); set_in(page); step(page, 11); set_out(page)
    assert page.inner_text('#rangeTxt') == 'Loop 13–24'
    # drag the loop's Out end along the ruler
    bx = page.locator('#scrub').bounding_box(); y = bx['y'] + bx['height'] / 2; X = lambda f: bx['x'] + bx['width'] * f / 72
    page.mouse.move(X(24), y); page.mouse.down(); page.mouse.move(X(29.5), y, steps=6); page.mouse.up()
    assert page.inner_text('#rangeTxt') == 'Loop 13–30'
    # hold the ruler: Clear takes the loop away
    set_io_menu = page.mouse.move(X(20), y); page.mouse.down(); page.wait_for_timeout(600); page.mouse.up()
    page.click('#ioClear'); assert not page.locator('#rangeChip').is_visible()
    step(page, 2); set_in(page); step(page, 3); set_out(page)
    page.click('#rangeChip'); assert not page.locator('#rangeChip').is_visible()

def make_sections(page):
    # Retime opens the time warp; Shape puts Hold, Cut or a speed over In-Out (played frames)
    page.click('#secBtn')
    step(page, 12); set_in(page); step(page, 11); set_out(page)
    page.click('#wShape'); page.click('#secRates [data-r="0.5"]')
    assert '/ 84' in fr(page)
    page.click('#rangeChip')
    scrub_to(page, 40, 84); set_in(page); scrub_to(page, 45, 84); set_out(page)
    page.click('#wShape'); page.click('#secHold')
    assert '/ 84' in fr(page)
    page.click('#rangeChip')
    scrub_to(page, 50, 84); set_in(page); scrub_to(page, 60, 84); set_out(page)
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
    page.click('#noteMode'); page.click('#noteBtn'); page.fill('#noteIn', 'arc is flat'); page.click('#noteOk')
    changes = page.evaluate('window.changes')
    assert any('marks' in c and c['marks'][-1]['text'] == 'arc is flat' for c in changes)

def test_long_clip_is_held_smaller_and_still_shows(page):
    # on iPad/iPhone a long clip used to run out of graphics memory and draw all black
    page.goto(f'{BASE}?test=player&clip=clip.webm&maxBytes=30000000')
    loaded(page)
    assert 'long clip: held at' in page.inner_text('#log2')
    assert centre_rgb(page) != (0, 0, 0)

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
    page.click('#annBtn')
    assert 'on' in page.get_attribute('#annBtn', 'class')  # Draw mode stays on until its key is tapped again
    o = dy(page); page.mouse.move(120, 150 + o); page.mouse.down()
    for i in range(1, 21): page.mouse.move(120 + i * 8, 150 + o + (i % 5) * 3)
    page.mouse.up()
    m = page.evaluate('window.changes')[-1]['marks'][-1]
    assert m['type'] == 'draw' and len(m['pts']) > 5
    hit = ink(page, '(r, g, b) => r > 230 && g > 40 && g < 80 && b > 75 && b < 110', box=(125, 80, 275, 110))
    assert hit
    page.click('#undo')
    assert page.evaluate('window.changes')[-1]['marks'] == []


# ---------- draw-over: pen bar, holds on the timeline, eraser, clear and undo
PEN = "(r, g, b) => r > 210 && g > 50 && g < 95 && b > 60 && b < 100"   # Quarry red #E5484D
BLUE = "(r, g, b) => r < 110 && g > 140 && g < 190 && b > 230"

def pic_top(page):  # where the video's top edge sits on screen now (it used to be fixed at y 60, under the header)
    return int(page.get_attribute('#cv', 'data-pic').split(',')[1])

def dy(page): return pic_top(page) - 60   # old page y (video at 60) to where that spot of the video is now

def ink(page, test=PEN, box=(100, 40, 300, 150)):  # box in video coordinates as before (y from the video's top)
    t = pic_top(page)
    return page.evaluate(f'''() => {{ const c = document.getElementById('cv'), x = c.getContext('2d'), d = devicePixelRatio, ok = {test};
        for (let px = {box[0]}; px < {box[2]}; px += 2) for (let py = {box[1] + t}; py < {box[3] + t}; py += 2) {{
            const [r, g, b] = x.getImageData(px * d, py * d, 1, 1).data; if (ok(r, g, b)) return true; }}
        return false; }}''')

def stroke(page, x0=120, x1=280, y=150):
    y += dy(page)
    page.mouse.move(x0, y); page.mouse.down()
    for i in range(1, 21): page.mouse.move(x0 + (x1 - x0) * i / 20, y)
    page.mouse.up()

def pen(page):
    page.click('#annBtn')

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
    page.click('#colorBtn'); page.click('#penRow [data-color="#5A8FF0"]')
    sl = page.locator('#sizeSl').bounding_box(); page.mouse.move(sl['x'] + 14, sl['y'] + 60); page.mouse.down(); page.mouse.move(sl['x'] + 14, sl['y'] + 8, steps=4); page.mouse.up()
    stroke(page, y=170)
    m = last(page, 'marks')[-1]
    assert m['color'] == '#5A8FF0' and m['size'] > small
    assert ink(page, BLUE)

def test_palette_recent_and_any_colour(page):
    open_clip(page); loaded(page)
    page.evaluate("localStorage.removeItem('qg_recent')"); pen(page)
    page.click('#colorBtn'); assert page.locator('#pal .sw').count() == 27        # Quarry's palette
    page.click('#penRow [data-color="#4FBF7A"]'); stroke(page, y=130)
    page.click('#colorBtn'); assert page.locator('#palRecent .sw').first.get_attribute('data-color') == '#4FBF7A'
    page.evaluate("() => { const i = document.getElementById('palPick'); i.value = '#123456'; i.dispatchEvent(new Event('change')); }")
    page.click('#colorBtn'); stroke(page, y=170)
    assert last(page, 'marks')[-1]['color'] == '#123456'

def test_ipad_colours_stay_put_when_one_is_picked(page):
    page.set_viewport_size({'width': 1194, 'height': 834})
    open_clip(page); loaded(page); page.click('#annBtn')
    page.click('#penRow [data-color="#F5D153"]')
    assert page.locator('#penRow').is_visible() and page.locator('#penRow [data-color="#F5D153"].on').count() == 1

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
    o = dy(page); page.mouse.move(200, 110 + o); page.mouse.down(); page.mouse.move(200, 190 + o, steps=8); page.mouse.up()
    drawn = [m for m in last(page, 'marks') if m['type'] == 'draw']
    assert len(drawn) == 2

def test_clear_and_undo(page):
    open_clip(page); loaded(page); pen(page)
    stroke(page, y=130); stroke(page, y=170)
    page.click('#colorBtn'); page.click('#clearBtn')
    assert [m for m in last(page, 'marks') if m['type'] == 'draw'] == []
    assert not ink(page)
    page.click('#undo')
    assert len(last(page, 'marks')) == 2 and ink(page)

def test_eraser_undo_restores(page):
    open_clip(page); loaded(page); pen(page)
    stroke(page, 100, 300, 150)
    page.click('#eraseBtn')
    o = dy(page); page.mouse.move(200, 110 + o); page.mouse.down(); page.mouse.move(200, 190 + o, steps=8); page.mouse.up()
    page.click('#undo')
    assert len(last(page, 'marks')) == 1


# ---------- phone layout: notes under the video, tools on the rail, sideways fills the height
def test_notes_list_jumps_to_frame(page):
    open_clip(page); loaded(page)
    page.click('#noteMode'); assert 'No notes yet' in page.inner_text('#pNotes'); page.click('#noteMode')
    step(page, 20); page.click('#noteMode'); page.click('#noteBtn'); page.fill('#noteIn', 'arc is flat'); page.click('#noteOk')
    step(page, 5); page.click('#annBtn'); stroke(page); page.click('#noteMode')
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

def test_modes_bring_their_own_tools(page):
    open_clip(page); loaded(page)
    assert not page.locator('#drawBtn').is_visible() and not page.locator('#pNotes').is_visible()
    page.click('#annBtn')                                   # Draw: tool card, undo/redo, edge sliders
    for el in ['#drawBtn', '#eraseBtn', '#undo', '#redo', '#colorBtn', '#sizeSl', '#opSl']: assert page.locator(el).is_visible(), el
    page.click('#noteMode')                                 # Note: the list and Add note; Draw's tools go
    assert page.locator('#pNotes').is_visible() and page.locator('#noteBtn').is_visible() and not page.locator('#drawBtn').is_visible()
    assert 'Add note at 1' in page.inner_text('#noteBtn')
    page.click('#secBtn')                                   # Retime: the curve and its tools, undo/redo with them
    assert page.locator('#wPanel').is_visible() and page.locator('#wKey').is_visible() and page.locator('#undo').is_visible()
    assert not page.locator('#pNotes').is_visible()
    page.click('#secBtn')                                   # tap the lit mode again: just watching
    assert not page.locator('#wPanel').is_visible() and not page.locator('#undo').is_visible()

def test_video_sits_between_the_cards_and_moves_freely(page):
    open_clip(page); loaded(page)
    top = page.locator('#top').bounding_box(); dock = page.locator('#dock').bounding_box(); modes = page.locator('#modes').bounding_box()
    assert top['y'] < 80 and dock['y'] + dock['height'] > 800 and modes['y'] + modes['height'] < dock['y'] + 1
    # pinch out below 1x is allowed now: the readout says so
    page.evaluate("""() => { const cv = document.getElementById('cv'), ev = (t, id, x, y) => cv.dispatchEvent(new PointerEvent(t, { pointerId: id, clientX: x, clientY: y, bubbles: true }));
        ev('pointerdown', 1, 150, 400); ev('pointerdown', 2, 250, 400); ev('pointermove', 1, 180, 400); ev('pointermove', 2, 220, 400); ev('pointerup', 1, 180, 400); ev('pointerup', 2, 220, 400); }""")
    assert '0.' in page.inner_text('#tc') and 'zoom' in page.inner_text('#tc')

def test_two_finger_tap_undoes_three_redoes(page):
    open_clip(page); loaded(page); pen(page)
    stroke(page, y=150); assert len(last(page, 'marks')) == 1
    tap = """n => { const cv = document.getElementById('cv'), ev = (t, id) => cv.dispatchEvent(new PointerEvent(t, { pointerId: id, clientX: 100 + id * 40, clientY: 330, bubbles: true }));
        for (let i = 1; i <= n; i++) ev('pointerdown', i); for (let i = 1; i <= n; i++) ev('pointerup', i); }"""
    page.evaluate(tap, 2); assert len(last(page, 'marks')) == 0
    page.evaluate(tap, 3); assert len(last(page, 'marks')) == 1

def test_sideways_video_fills_the_screen(page):
    page.set_viewport_size({'width': 844, 'height': 390})
    open_clip(page); loaded(page)
    assert page.locator('#cv').bounding_box()['height'] > 385
    page.click('#stepFwd'); assert fr(page).startswith('2')
    bx = page.locator('#cv').bounding_box()
    page.mouse.click(bx['x'] + bx['width'] * 0.75, 120); assert fr(page).startswith('3')
    page.mouse.click(bx['x'] + bx['width'] * 0.1, 120); assert fr(page).startswith('2')


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
    assert page.inner_text('#viewBtn') == 'Retimed'

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
    o = dy(page); page.mouse.move(44, 110 + o); page.mouse.down()   # clear of the size/opacity sliders on the edge
    for i in range(1, 16): page.mouse.move(44, 110 + o + i * 6)
    page.mouse.up()

def test_onion_skin_shows_nearby_drawings_faded(page):
    open_clip(page); loaded(page)
    step(page, 10); pen(page); black_bar_stroke(page); page.click('#annBtn')
    step(page, 2)                                   # two frames on: the drawing (held 1 frame) is gone
    assert not ink(page, RED_GHOST, box=(38, 50, 48, 140))
    page.click('#more'); page.click('#onionBtn'); page.click('#moreVeil', position={'x': 10, 'y': 10})
    assert ink(page, RED_GHOST, box=(38, 50, 48, 140))
    page.click('#more'); page.click('#onionAfter [data-d="1"]'); assert page.inner_text('#onionAfter .n') == '3'
    page.click('#onionBtn'); page.click('#moreVeil', position={'x': 10, 'y': 10})
    assert not ink(page, RED_GHOST, box=(38, 50, 48, 140))

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

def lum(page):
    return page.evaluate('''() => { const c = document.getElementById('cv'), x = c.getContext('2d');
        const [px, py, pw, ph] = c.dataset.pic.split(',').map(Number), r = devicePixelRatio;
        const d = x.getImageData((px + pw * 0.75) * r, (py + ph * 0.75) * r, 1, 1).data; return d[0]; }''')

def test_mp4_frames_come_from_the_decoder_in_display_order(page):
    for clip in ('ramp.mp4', 'ramp.mov'):
        open_clip(page, clip); loaded(page)
        log = page.inner_text('#log2')
        assert 'avc1' in log and '30 frames' in log, log
        assert fr(page).endswith('/ 30')
        seen = []
        for i in range(30):
            scrub_to(page, i, 30); page.wait_for_timeout(30); seen.append(lum(page))
        # the picture brightens frame by frame (8 levels a frame): every frame in its place, B-frames included
        assert all(b > a for a, b in zip(seen[2:], seen[3:])), seen

def test_reset_span_and_reset_curve_keep_the_keys(page):
    open_clip(page); loaded(page)
    page.click('#secBtn')
    step(page, 12); set_in(page); step(page, 11); set_out(page)
    page.click('#wShape'); page.click('#secRates [data-r="0.5"]')
    assert '/ 84' in fr(page)
    page.click('#rangeChip')
    scrub_to(page, 20, 84)                                  # inside the slowed span
    page.click('#wShape'); page.click('#secSpan')
    assert '/ 72' in fr(page)                               # that span plays at real time again
    n = len(warp_keys(page)); assert n >= 3                 # its keys are still there
    scrub_to(page, 40, 72); set_in(page); scrub_to(page, 45, 72); set_out(page)
    page.click('#wShape'); page.click('#secHold'); page.click('#rangeChip')
    assert any(k['t'] == 'step' for k in warp_keys(page))
    page.click('#wShape'); page.click('#secReset')
    keys = warp_keys(page)                                  # every key kept on its frame, all at real time
    assert len(keys) >= 3 and all(k['t'] == 'linear' for k in keys)
    assert len({round(k['y'] - k['x']) for k in keys}) == 1

# ---------- iPad: side panel, Apple Pencil
def pencil_stroke(page, y, kind='pen', pressures=(0.2, 0.5, 0.9, 0.6)):
    page.evaluate("""([y, kind, ps]) => { const cv = document.getElementById('cv');
        const ev = (t, x, p) => cv.dispatchEvent(new PointerEvent(t, { pointerId: 7, pointerType: kind, pressure: p, clientX: x, clientY: y, bubbles: true }));
        ev('pointerdown', 200, ps[0]); ps.forEach((p, i) => ev('pointermove', 240 + i * 50, p)); ev('pointerup', 500, 0); }""", [y, kind, list(pressures)])

def test_ipad_side_panel_holds_the_modes_and_tucks_away(page):
    page.set_viewport_size({'width': 1194, 'height': 834})
    open_clip(page); loaded(page)
    side = page.locator('#side').bounding_box(); assert side['x'] > 800
    page.click('#annBtn'); assert page.locator('#penRow').is_visible() and page.locator('#smSl').is_visible()
    assert page.locator('#prsIn').count() == 0                                # Pencil pressure is always full: no setting
    assert page.locator('#drawBtn').bounding_box()['x'] > side['x']            # the tools sit in the panel
    page.click('#secBtn'); assert page.locator('#wKey').is_visible() and page.locator('#wUp').bounding_box()['x'] > side['x']
    pic = lambda: int(page.get_attribute('#cv', 'data-pic').split(',')[2])
    w = pic(); page.click('#sideTab')
    assert not page.locator('#side').is_visible() and pic() >= w               # tucked: the video gets the room
    page.click('#sideTab'); assert page.locator('#side').is_visible()

def test_ipad_size_opacity_and_panel_key_stay_off_the_video(page):
    page.set_viewport_size({'width': 1194, 'height': 834})
    open_clip(page); loaded(page); page.click('#annBtn')
    side = page.locator('#side').bounding_box()
    x, y, w, h = map(int, page.get_attribute('#cv', 'data-pic').split(','))
    for sl in ('#sizeSl', '#opSl'):
        b = page.locator(sl).bounding_box(); assert b['x'] > side['x'] and b['width'] > b['height']   # across, in the panel
    t = page.locator('#sideTab').bounding_box()
    assert t['y'] + t['height'] <= y or t['x'] >= x + w                        # the panel key doesn't sit on the picture
    b = page.locator('#sizeSl').bounding_box()
    page.mouse.move(b['x'] + 10, b['y'] + 15); page.mouse.down(); page.mouse.move(b['x'] + b['width'] - 10, b['y'] + 15, steps=4); page.mouse.up()
    big = page.evaluate("JSON.parse(localStorage.getItem('qg_pen')).px")
    page.mouse.move(b['x'] + b['width'] - 10, b['y'] + 15); page.mouse.down(); page.mouse.move(b['x'] + 10, b['y'] + 15, steps=4); page.mouse.up()
    small = page.evaluate("JSON.parse(localStorage.getItem('qg_pen')).px")
    assert big > 12 and small < 3                                               # right is bigger, left smaller
    page.click('#sideTab'); t2 = page.locator('#sideTab').bounding_box()
    assert t2['y'] + t2['height'] <= y + 1 or t2['y'] < 80                      # tucked: still up in the header band

def zigzag(page, y):
    page.evaluate("""(y) => { const cv = document.getElementById('cv');
        const ev = (t, x, yy) => cv.dispatchEvent(new PointerEvent(t, { pointerId: 8, pointerType: 'pen', pressure: .5, clientX: x, clientY: yy, bubbles: true }));
        ev('pointerdown', 150, y); for (let i = 1; i <= 80; i++) ev('pointermove', 150 + i * 4, y + (i % 2 ? 8 : -8)); ev('pointerup', 470, y); }""", y)
    pts = last(page, 'marks')[-1]['pts']
    return sum(abs(pts[i][1] - pts[i - 1][1]) for i in range(1, len(pts)))   # how much it zigzags

def test_ipad_draw_pills_show_their_reading_and_smoothing_steadies_the_line(page):
    page.set_viewport_size({'width': 1194, 'height': 834})
    open_clip(page); loaded(page); page.click('#annBtn')
    assert page.inner_text('#smSl') .replace('\n', ' ').split() == ['Smoothing', '60%']           # Quarry's default
    assert page.inner_text('#opSl').split()[0] == 'Opacity' and page.inner_text('#sizeSl').split()[0] == 'Size'
    steadied = zigzag(page, 300)
    b = page.locator('#smSl').bounding_box()
    page.mouse.move(b['x'] + 40, b['y'] + 20); page.mouse.down(); page.mouse.move(b['x'] + 2, b['y'] + 20, steps=3); page.mouse.up()
    assert page.inner_text('#smSl').split()[-1] == '0%'
    raw = zigzag(page, 360)
    assert steadied < raw * 0.6, (steadied, raw)

def test_pencil_draws_any_time_with_pressure_and_fingers_then_navigate(page):
    page.set_viewport_size({'width': 1194, 'height': 834})
    open_clip(page); loaded(page)
    pencil_stroke(page, 300)                                                    # no mode on: the Pencil still draws
    m = last(page, 'marks')[-1]
    assert m['type'] == 'draw' and len(m['pts'][0]) == 3
    ws = [p[2] for p in m['pts']]; assert max(ws) > min(ws)                     # harder presses, wider line
    page.click('#annBtn')
    pencil_stroke(page, 340, kind='touch', pressures=(0.5, 0.5, 0.5, 0.5))      # after the Pencil, a finger doesn't draw
    assert len(last(page, 'marks')) == 1

def test_retime_buttons_stay_still_while_playing(page):
    # Playing through keys used to light up and grey out the key buttons (and swap Tangent/Linear) on every key.
    open_clip(page); loaded(page); page.click('#secBtn')
    for f in [10, 20, 30, 40, 50, 60]:
        scrub_to(page, f, 72); page.click('#wKey')
    scrub_to(page, 5, 72); page.click('#secBtn'); page.click('#secBtn')   # back into Retime off a key: nothing selected
    page.click('#play'); page.wait_for_timeout(100)
    page.evaluate("""() => { window.__seen = new Set(); const t = () => { const b = document.getElementById('wTan');
        window.__seen.add(b.disabled + '|' + b.innerText); if (window.__watch) requestAnimationFrame(t); }; window.__watch = 1; t(); }""")
    page.wait_for_timeout(2500); page.evaluate("() => { window.__watch = 0; }"); page.click('#play')
    seen = page.evaluate("[...window.__seen]")
    assert len(seen) == 1, seen
