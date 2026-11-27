"""The tab bar, Settings' Google section and the Sort tab, against FakeDrive."""
from fakedrive import FakeDrive

from devlab_stub import FACE, UNLOCK
BASE = 'http://localhost:8765/'
SIGNED_IN = """
  localStorage.setItem('qg_client_id', 'test-client.apps.googleusercontent.com');
  localStorage.setItem('qg_token', 'fake1');
  localStorage.setItem('qg_token_exp', String(Date.now() + 3600e3));
  localStorage.setItem('qg_email', 'you@example.com');
"""

def go(page, hash='#/sort', signed_in=True, **kw):
    fake = FakeDrive(page, **kw)
    page.add_init_script("localStorage.setItem('qg_client_id', 'test-client.apps.googleusercontent.com');")
    if signed_in: page.add_init_script(SIGNED_IN)
    page.add_init_script("localStorage.setItem('qg_extra_tabs', '1');"); page.add_init_script(FACE)
    page.goto(BASE + '#/'); page.wait_for_selector('#reviews.show', timeout=8000); page.evaluate(UNLOCK)
    page.evaluate("async () => { const S = await import('/js/store.js'); await S.phoneReset(); }")
    page.evaluate(f"location.hash = '{hash}'")
    return fake

def count(page):
    page.wait_for_function("document.getElementById('soCount') && /to sort/.test(document.getElementById('soCount').textContent)", timeout=8000)
    return int(page.inner_text('#soCount').split()[0])

def swipe(page, dx):
    bx = page.locator('#soCard').bounding_box(); x, y = bx['x'] + bx['width'] / 2, bx['y'] + bx['height'] / 2
    page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x + dx, y, steps=8); page.mouse.up()

def sent(fake):
    return [a for _, parent, body in fake.written if parent == 'actions' for a in body['actions']]

def test_tabs_route(page):
    go(page, '#/sort'); page.wait_for_selector('#sort.show')
    assert page.locator('#tabbar.show').count() == 1 and 'on' in page.get_attribute('#tab-sort', 'class')
    assert page.locator('#tab-library').is_hidden()   # Library stays parked
    page.click('#tab-review'); page.wait_for_selector('#reviews.show')
    assert 'on' in page.get_attribute('#tab-review', 'class')

def test_settings_connect_shows_account(page):
    go(page, '#/')
    page.click('#gear'); page.wait_for_selector('#settingsVeil', state='visible')
    assert page.inner_text('#gAccount') == 'you@example.com' and page.inner_text('#gBtn') == 'Disconnect'

def test_swipe_left_skips(page):
    fake = go(page)
    assert count(page) == 4
    swipe(page, -200)
    page.wait_for_function("document.getElementById('soCount').textContent.startsWith('3')")
    page.wait_for_function("true")
    page.wait_for_timeout(300)
    assert sent(fake)[0]['op'] == 'skip' and sent(fake)[0]['id'] == '1800'

def test_small_swipe_snaps_back(page):
    fake = go(page); count(page)
    swipe(page, 60)
    page.wait_for_timeout(300)
    assert count(page) == 4 and sent(fake) == []

def test_undo_steps_back(page):
    fake = go(page); count(page)
    page.click('#soSkip'); page.wait_for_function("document.getElementById('soCount').textContent.startsWith('3')")
    page.click('#soUndo'); page.wait_for_function("document.getElementById('soCount').textContent.startsWith('4')")
    page.wait_for_timeout(300)
    assert [a['op'] for a in sent(fake)] == ['skip', 'undo']
    assert 'artist0' in page.inner_text('#soInfo')

def test_video_post_plays_muted_loop(page):
    go(page); count(page)
    page.click('#soSkip'); page.wait_for_function("document.getElementById('soCount').textContent.startsWith('3')")
    v = page.locator('#soCard video')
    assert v.count() == 1
    assert page.evaluate("() => { const v = document.querySelector('#soCard video'); return [v.muted, v.loop, v.src]; }") == [True, True, 'https://video.twimg.com/fake/1.mp4']

def test_all_sorted(page):
    go(page); count(page)
    for i in range(4):
        page.click('#soSkip'); page.wait_for_timeout(260)
    page.wait_for_function("document.querySelector('.so-msg h2') && document.querySelector('.so-msg h2').textContent !== 'Loading…'")
    assert page.inner_text('.so-msg h2') == 'All sorted'

def test_no_phone_folder(page):
    go(page, with_phone=False)
    page.wait_for_function("document.querySelector('.so-msg h2') && document.querySelector('.so-msg h2').textContent !== 'Loading…'")
    assert page.inner_text('.so-msg h2') == 'Nothing from Quarry yet'

def test_sort_refresh_button(page):
    go(page); count(page)
    page.evaluate("window.__n = 0; const f = window.fetch; window.fetch = (...a) => { if (String(a[0]).includes('googleapis')) window.__n++; return f(...a); }")
    page.click('#soRefresh')
    page.wait_for_function("window.__n > 0", timeout=4000)


def test_keep_is_one_swipe(page):
    fake = go(page); count(page)
    swipe(page, 220)
    page.wait_for_function("document.getElementById('soCount').textContent.startsWith('3')"); page.wait_for_timeout(300)
    assert page.locator('#folderVeil').is_hidden()
    a = sent(fake)[0]
    assert (a['op'], a['id'], a['folder'], a['tags']) == ('keep', '1800', None, [])

def test_on_x_link_opens_the_post(page):
    go(page); count(page)
    a = page.locator('#soOnX')
    assert a.get_attribute('href').startswith('https://x.com/') and a.get_attribute('href').endswith('/status/1800')
    assert a.get_attribute('target') == '_blank'
