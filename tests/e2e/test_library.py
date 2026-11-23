"""The Library tab, against FakeDrive."""
from fakedrive import FakeDrive

BASE = 'http://localhost:8765/'
SIGNED_IN = """
  localStorage.setItem('qg_client_id', 'test-client.apps.googleusercontent.com');
  localStorage.setItem('qg_token', 'fake1');
  localStorage.setItem('qg_token_exp', String(Date.now() + 3600e3));
  localStorage.setItem('qg_email', 'you@example.com');
"""

def go(page, **kw):
    fake = FakeDrive(page, **kw)
    page.add_init_script(SIGNED_IN)
    page.goto(BASE + '#/'); page.wait_for_selector('#reviews.show', timeout=8000)
    page.evaluate("async () => { const S = await import('/js/store.js'); await S.phoneReset(); }")
    page.evaluate("location.hash = '#/library'")
    page.wait_for_selector('#libGrid .lib-tile', timeout=8000)
    return fake

def tiles(page): return page.locator('#libGrid .lib-tile')
def names(page): return page.evaluate("[...document.querySelectorAll('#libGrid .lib-tile')].map(t => t.dataset.key)")
def sent(fake): return [a for _, parent, body in fake.written if parent == 'actions' for a in body['actions']]
def search(page, text):
    page.fill('#libSearch', text); page.wait_for_timeout(50)
def open_item(page, key):
    page.click(f'#libGrid .lib-tile[data-key="{key}"]'); page.wait_for_selector('#itemVeil', state='visible')

def test_grid_shows_items_with_thumbs(page):
    go(page)
    assert tiles(page).count() == 6
    page.wait_for_function("[...document.querySelectorAll('#libGrid .lib-tile img')].every(i => i.src && i.complete && i.naturalWidth > 0)", timeout=8000)

def test_search_title_tag_author(page):
    go(page)
    search(page, 'gesture'); assert names(page) == ['Anatomy/Hands/hand_01.jpg']
    search(page, 'dan'); assert names(page) == ['Poses/standing.jpg']
    search(page, 'TORSO'); assert names(page) == ['Anatomy/Body/torso.jpg']
    search(page, ''); assert tiles(page).count() == 6

def test_folder_chip_filters(page):
    go(page)
    page.click('#libFolder'); page.wait_for_selector('#folderVeil', state='visible')
    page.click('#folderList [data-f="Anatomy"]'); page.click('#folderOk')
    page.wait_for_function("document.getElementById('libFolder').textContent === 'Anatomy'")
    assert sorted(names(page)) == ['Anatomy/Body/torso.jpg', 'Anatomy/Hands/hand_01.jpg', 'Anatomy/Hands/hand_02.jpg']
    assert 'Anatomy' in page.inner_text('#libFolder')
    page.click('#libAll'); assert tiles(page).count() == 6

def test_tag_chip_filters(page):
    go(page)
    page.click('#libTag'); page.wait_for_selector('#folderVeil', state='visible')
    page.click('#folderList [data-f="hands"]'); page.click('#folderOk')
    page.wait_for_function("document.getElementById('libTag').textContent === '#hands'")
    assert sorted(names(page)) == ['Anatomy/Hands/hand_01.jpg', 'Anatomy/Hands/hand_02.jpg']

def test_tag_add_remove_sends_actions(page):
    fake = go(page)
    open_item(page, 'Poses/standing.jpg')
    page.click('#itemTags [data-rm="misc"]')
    page.wait_for_function("!document.querySelector('#itemTags [data-rm=\"misc\"]')")
    page.fill('#itemTagIn', 'pose'); page.keyboard.press('Enter')
    page.wait_for_function("!!document.querySelector('#itemTags [data-rm=\"pose\"]')")
    assert page.inner_text('#itemTags').replace('✕', '').split() == ['contrapposto', 'pose']
    page.wait_for_timeout(400)
    acts = [(a['op'], a['key'], a['add'], a['remove']) for a in sent(fake)]
    assert acts == [('tag', 'Poses/standing.jpg', [], ['misc']), ('tag', 'Poses/standing.jpg', ['pose'], [])]

def test_tag_suggestions(page):
    go(page)
    open_item(page, 'Anatomy/Body/torso.jpg')
    page.fill('#itemTagIn', 'ha')
    assert 'hands' in page.inner_text('#itemSugg')
    page.click('#itemSugg [data-add="hands"]')
    page.wait_for_function("!!document.querySelector('#itemTags [data-rm=\"hands\"]')")

def test_move_sends_action_and_regroups(page):
    fake = go(page)
    open_item(page, 'Anatomy/Body/torso.jpg')
    page.click('#itemMove'); page.click('#folderList [data-f="Poses"]'); page.click('#folderOk')
    page.wait_for_function("document.getElementById('itemFolder').textContent === 'Poses'")
    page.wait_for_timeout(300)
    assert sent(fake)[-1] == {'op': 'move', 'key': 'Anatomy/Body/torso.jpg', 'folder': 'Poses', 'n': 1}
    assert 'Poses' in page.inner_text('#itemFolder')
    page.click('#itemClose')
    page.click('#libFolder'); page.click('#folderList [data-f="Poses"]'); page.click('#folderOk')
    page.wait_for_function("document.getElementById('libFolder').textContent === 'Poses'")
    assert 'Poses/torso.jpg' in names(page) and tiles(page).count() == 4

def test_untagged_queue_next(page):
    go(page)
    assert page.inner_text('#libUntagged') == 'Untagged 2'
    page.click('#libUntagged'); page.wait_for_selector('#itemVeil', state='visible')
    first = page.inner_text('#itemTitle')
    page.fill('#itemTagIn', 'torso'); page.keyboard.press('Enter')
    page.wait_for_function("document.getElementById('libUntagged').textContent === 'Untagged 1'")
    page.click('#itemNext')
    assert page.inner_text('#itemTitle') != first
    page.fill('#itemTagIn', 'run'); page.keyboard.press('Enter')
    page.wait_for_function("document.getElementById('libUntagged').textContent === 'Untagged 0'")
    page.click('#itemNext')
    page.wait_for_selector('#itemVeil', state='hidden')
    assert page.inner_text('#libUntagged') == 'Untagged 0'

def test_failed_action_retry_drop(page):
    fake = go(page)
    open_item(page, 'Poses/jump.gif')
    page.fill('#itemTagIn', 'air'); page.keyboard.press('Enter'); page.click('#itemClose')
    page.wait_for_timeout(400)
    phone = page.evaluate("async () => (await import('/js/phone.js')).phoneId()")
    fake.set_json(fake.applied, f'{phone}.json', {'version': 1, 'phone': phone, 'last': 1, 'failed': [{'n': 1, 'op': 'tag', 'reason': "That item isn't in the library any more"}]})
    page.evaluate("async () => (await import('/js/phone.js')).refresh()")
    page.wait_for_selector('#libStatus .st-failed')
    page.click('#libStatus .st-failed'); page.wait_for_selector('#failedVeil', state='visible')
    assert "isn't in the library any more" in page.inner_text('#failedList')
    page.click('#failedList [data-retry="1"]')
    page.wait_for_timeout(400)
    assert sent(fake)[-1]['n'] == 2 and sent(fake)[-1]['add'] == ['air']

def test_big_library_search_fast(page):
    go(page, extra_items=5000)
    assert tiles(page).count() <= 150
    ms = page.evaluate('''() => { const i = document.getElementById('libSearch'); const t = performance.now();
        i.value = 'hand'; i.dispatchEvent(new Event('input')); return performance.now() - t; }''')
    assert ms < 100
    want = sum(1 for i in range(5000) if i % 7 == 0 or i % 6 in (0, 1)) + 2   # bulk titles/tags + 2 fixture items
    assert page.inner_text('#libCount') == f'{want:,} items'
    page.evaluate("document.getElementById('library').scrollTo(0, 1e6)")
    page.wait_for_function("document.querySelectorAll('#libGrid .lib-tile').length > 120", timeout=4000)

def test_refresh_button_reloads(page):
    fake = go(page)
    before = len([1 for _ in fake.auth_requests])
    page.evaluate("window.__n = 0; const f = window.fetch; window.fetch = (...a) => { if (String(a[0]).includes('status.json') || String(a[0]).includes('googleapis')) window.__n++; return f(...a); }")
    page.click('#libRefresh')
    page.wait_for_function("window.__n > 0", timeout=4000)
    page.wait_for_function("!document.getElementById('libRefresh').classList.contains('spin')", timeout=4000)

def test_pull_down_refreshes(page):
    go(page)
    page.evaluate("window.__n = 0; const f = window.fetch; window.fetch = (...a) => { if (String(a[0]).includes('googleapis')) window.__n++; return f(...a); }")
    page.evaluate('''() => { const el = document.getElementById('library');
        const t = y => new Touch({ identifier: 1, target: el, clientX: 200, clientY: y });
        el.dispatchEvent(new TouchEvent('touchstart', { touches: [t(150)], bubbles: true }));
        el.dispatchEvent(new TouchEvent('touchmove', { touches: [t(300)], bubbles: true }));
        el.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true })); }''')
    page.wait_for_function("window.__n > 0", timeout=4000)
