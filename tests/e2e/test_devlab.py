"""Dev lab: no way in from Settings; hold the Quarry logo key 3 s, then Face ID."""
from devlab_stub import FACE

BASE = 'http://localhost:8765/'

def go(page):
    page.add_init_script(FACE); page.add_init_script("localStorage.setItem('qg_devlab_test', '0')")
    page.goto(BASE + '#/'); page.wait_for_selector('#reviews.show', timeout=8000)

def hold(page, ms=3300):
    b = page.locator('#gear').bounding_box(); x, y = b['x'] + b['width'] / 2, b['y'] + b['height'] / 2
    page.mouse.move(x, y); page.mouse.down(); page.wait_for_timeout(ms); page.mouse.up()

def test_not_in_settings(page):
    go(page); page.click('#gear'); page.wait_for_selector('#settingsVeil', state='visible')
    assert 'X likes' not in page.inner_text('#settingsVeil') and page.locator('#tabbar.show').count() == 0

def test_hold_opens_straight_into_sort(page):
    go(page); page.evaluate("localStorage.setItem('qg_extra_tabs', '0')"); hold(page)
    page.wait_for_selector('#sort.show')
    assert page.locator('#settingsVeil').is_hidden() and page.evaluate('window.__faceCalls') == ['create']
    page.click('#tab-review'); page.wait_for_selector('#reviews.show')
    hold(page); page.wait_for_selector('#sort.show')
    assert page.evaluate('window.__faceCalls') == ['create', 'get']

def test_short_hold_is_just_settings(page):
    go(page); hold(page, 800)
    page.wait_for_selector('#settingsVeil', state='visible'); assert page.evaluate('window.__faceCalls') == []

def test_face_refused_stays_shut(page):
    go(page); page.evaluate('window.__faceNo = true'); hold(page)
    page.wait_for_timeout(300); assert page.locator('#sort.show').count() == 0

def test_sort_shut_after_reload(page):
    go(page); hold(page); page.wait_for_selector('#sort.show')
    page.reload(); page.wait_for_selector('#reviews.show')
    page.evaluate("location.hash = '#/sort'"); page.wait_for_timeout(300)
    assert page.locator('#sort.show').count() == 0 and page.locator('#tabbar.show').count() == 0
