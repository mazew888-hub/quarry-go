"""Dev lab: no way in from Settings; hold the Quarry logo key 3 s and X likes ripples open."""

BASE = 'http://localhost:8765/'

def go(page):
    page.add_init_script("localStorage.setItem('qg_devlab_test', '0')")
    page.goto(BASE + '#/'); page.wait_for_selector('#reviews.show', timeout=8000)
    page.wait_for_selector('#intro', state='detached', timeout=8000)

def hold(page, ms=3300):
    b = page.locator('#gear').bounding_box(); x, y = b['x'] + b['width'] / 2, b['y'] + b['height'] / 2
    page.mouse.move(x, y); page.mouse.down(); page.wait_for_timeout(ms); page.mouse.up()

def test_not_in_settings(page):
    go(page); page.click('#gear'); page.wait_for_selector('#settingsVeil', state='visible')
    assert 'X likes' not in page.inner_text('#settingsVeil') and page.locator('#tabbar.show').count() == 0

def test_hold_opens_straight_into_sort_with_a_ripple(page):
    go(page); page.evaluate("localStorage.setItem('qg_extra_tabs', '0')")
    hold(page)
    page.wait_for_selector('#sort.show')
    assert page.locator('#settingsVeil').is_hidden()
    assert page.evaluate("document.getElementById('sort').getAnimations().length") >= 1   # rippling in
    page.wait_for_timeout(1400)
    assert page.evaluate("document.getElementById('sort').getAnimations().length") == 0
    assert not page.evaluate("document.getElementById('reviews').classList.contains('stay')")

def test_a_shorter_hold_is_just_settings(page):
    go(page); hold(page, 1800)
    page.wait_for_selector('#settingsVeil', state='visible'); assert page.locator('#sort.show').count() == 0

def test_sort_shut_after_reload(page):
    go(page); hold(page); page.wait_for_selector('#sort.show')
    page.reload(); page.wait_for_selector('#reviews.show')
    page.evaluate("location.hash = '#/sort'"); page.wait_for_timeout(300)
    assert page.locator('#sort.show').count() == 0 and page.locator('#tabbar.show').count() == 0
