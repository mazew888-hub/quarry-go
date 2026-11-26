"""Handoff: send a day's videos as one zip, receive it on another device (here: after wiping this one)."""
from test_app import home, new_review, in_player, back, cards

def note(page, text):
    if not page.locator('#noteBtn').is_visible(): page.click('#noteMode')
    page.click('#noteBtn'); page.fill('#noteIn', text); page.click('#noteOk')

def send(page, tmp_path, name='h.zip'):
    with page.expect_download(timeout=60000) as dl: page.click('#sendDay')
    out = tmp_path / name; dl.value.save_as(out)
    assert dl.value.suggested_filename.startswith('Quarry Go handoff ')
    return out

def wipe(page):
    page.evaluate("async () => { const S = await import('/js/store.js'); await S.deleteAll(); }")
    page.goto('http://localhost:8765/#/'); page.reload(); page.wait_for_selector('#receive', timeout=8000)

def test_send_and_receive_a_day(page, tmp_path):
    home(page); new_review(page); in_player(page); note(page, 'more overlap'); back(page)
    z = send(page, tmp_path)
    wipe(page)
    assert cards(page).count() == 0
    page.set_input_files('#handoffFile', str(z))
    page.wait_for_function("location.hash.startsWith('#/d/') && document.querySelectorAll('.rv-clip').length === 1", timeout=30000)
    assert 'Added 1 video' in page.inner_text('#toast')
    assert cards(page).first.locator('.pip').get_attribute('title') == '1 note'
    assert cards(page).first.locator('img').count() == 1
    cards(page).first.click(); in_player(page)          # the video came too: it opens
    assert 'more overlap' in page.text_content('#pList')

def test_receiving_again_keeps_newer_edits(page, tmp_path):
    home(page); new_review(page); in_player(page); note(page, 'first'); back(page)
    z = send(page, tmp_path)
    cards(page).first.click(); in_player(page); note(page, 'second, newer'); back(page)
    page.set_input_files('#handoffFile', str(z))     # the older copy comes back
    page.wait_for_function("document.getElementById('toast').textContent.includes('up to date')", timeout=30000)
    cards(page).first.click(); in_player(page)
    assert 'second, newer' in page.text_content('#pList')

def test_a_file_that_isnt_a_handoff(page, tmp_path):
    home(page)
    bad = tmp_path / 'x.zip'; bad.write_bytes(b'not a zip at all, just some bytes here')
    page.set_input_files('#handoffFile', str(bad))
    page.wait_for_function("document.getElementById('toast').textContent.includes(\"isn't a Quarry Go handoff\")", timeout=8000)

def test_receiving_again_repairs_a_broken_video(page, tmp_path):
    home(page); new_review(page); in_player(page); back(page)
    z = send(page, tmp_path)
    page.evaluate("""async () => { const S = await import('/js/store.js'); const [r] = await S.listReviews();
        await S.putClip(r.id, new Blob([new Uint8Array([80, 75, 3, 4, 0, 0])], { type: 'video/webm' })); }""")
    page.set_input_files('#handoffFile', str(z))
    page.wait_for_function("document.getElementById('toast').textContent.includes('Fixed 1 video')", timeout=30000)
    cards(page).first.click(); in_player(page)

def test_receive_several_files_at_once(page, tmp_path):
    home(page); new_review(page); in_player(page); back(page)
    z1 = send(page, tmp_path, 'a.zip')
    new_review(page); in_player(page); back(page)
    z2 = send(page, tmp_path, 'b.zip')
    wipe(page)
    page.set_input_files('#handoffFile', [str(z1), str(z2)])
    page.wait_for_function("document.querySelectorAll('.rv-clip').length === 2", timeout=30000)
    assert 'Added 2 videos' in page.inner_text('#toast')

def test_export_feedback_from_inside_the_player(page):
    home(page); new_review(page); in_player(page)
    page.click('#secBtn'); page.click('#wKey')                # a key: the video counts as retimed once moved
    page.click('#wUp'); page.click('#wUp')
    page.click('#more'); page.click('#exportAll')
    page.wait_for_selector('#exportVeil .ex-sheet')
    rows = page.locator('#exportVeil .ex-list .li')
    assert rows.count() == 1                                   # just this video
    assert rows.first.locator('[data-k="warp"]').count() == 1  # with its Maya time warp
