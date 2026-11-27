"""Sort without a Drive sign-in: likes come in as a file picked from Files, choices go out as a file."""
import json

from devlab_stub import FACE, UNLOCK
BASE = 'http://localhost:8765/'
BUNDLE = {'kind': 'quarry-phone',
          'status': {'snapshot': 's1', 'written': '2026-11-26T15:00:00', 'x_checked': '2026-11-26T14:00:00'},
          'library': {'snapshot': 's1', 'items': []}, 'folders': {'folders': ['Anim refs']}, 'tags': {'tags': []},
          'xqueue': {'posts': [{'id': '101', 'author': 'a', 'text': 'one', 'media': []},
                               {'id': '102', 'author': 'b', 'text': 'two', 'media': []}]}}

def go(page):
    page.add_init_script("localStorage.setItem('qg_extra_tabs', '1');"); page.add_init_script(FACE)
    page.goto(BASE + '#/'); page.wait_for_selector('#reviews.show', timeout=8000); page.evaluate(UNLOCK)
    page.evaluate("async () => { const S = await import('/js/store.js'); await S.phoneReset(); }")
    page.evaluate("location.hash = '#/sort'"); page.wait_for_selector('#sort.show')

def bring(page, body, name='for phone.json'):
    page.set_input_files('#soPick', files=[{'name': name, 'mimeType': 'application/json', 'buffer': json.dumps(body).encode()}])

def test_asks_for_the_file_first(page):
    go(page)
    page.wait_for_selector('.so-msg h2:has-text("Bring in your likes")')
    assert page.locator('#soRefresh').is_hidden() and page.locator('#soMsgBtn').is_visible()

def test_bring_in_then_send(page):
    go(page); bring(page, BUNDLE)
    page.wait_for_function("/2 left/.test(document.getElementById('soCount').textContent)", timeout=8000)
    page.click('#soSkip')
    page.wait_for_selector('#soSend[aria-label="Send 1"]')
    with page.expect_download() as d: page.click('#soSend')
    dl = d.value
    assert dl.suggested_filename.startswith('p-') and dl.suggested_filename.endswith('-00000001.json')
    body = json.loads(open(dl.path()).read())
    assert [a['op'] for a in body['actions']] == ['skip'] and body['actions'][0]['id'] == '101'
    page.wait_for_selector('#soSend', state='hidden')

def test_wrong_file_is_refused(page):
    go(page); bring(page, {'hello': 1}, 'notes.json')
    page.wait_for_selector('.so-msg h2:has-text("Bring in your likes")')
