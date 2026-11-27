"""Quarry Go is a review app by default: Sort and Library are switched off until turned on in Settings."""
BASE = 'http://localhost:8765/'

def fresh(browser, server):
    ctx = browser.new_context(viewport={'width': 390, 'height': 844})
    return ctx, ctx.new_page()

def test_review_only_by_default(browser, server):
    ctx, page = fresh(browser, server)
    page.goto(BASE + '#/'); page.wait_for_selector('#reviews.show', timeout=8000)
    assert not page.locator('#tabbar').is_visible()
    page.evaluate("location.hash = '#/library'"); page.wait_for_timeout(300)
    assert page.evaluate('location.hash') in ('#/', '')
    assert page.locator('#reviews.show').count() == 1
    page.click('#gear'); page.wait_for_selector('#settingsVeil', state='visible')
    assert not page.locator('#gAccount').is_visible()
    assert 'X likes' not in page.inner_text('#settingsVeil')
    ctx.close()

