"""Tag: untagged library items one at a time; tags and folder go to Quarry as tag/move actions."""
import json
from devlab_stub import FACE, UNLOCK

BASE = 'http://localhost:8765/'
B = {'kind': 'quarry-phone', 'status': {'snapshot': 's', 'written': '2026-11-26T20:00:00'},
     'library': {'items': [{'key': 'Unsorted/a.mp4', 'folder': 'Unsorted', 'title': 'a.mp4', 'tags': []},
                           {'key': 'Unsorted/b.png', 'folder': 'Unsorted', 'tags': []},
                           {'key': 'Pose/x.png', 'folder': 'Pose', 'tags': ['impact', 'hands']}]},
     'folders': {'folders': ['Pose', 'Unsorted']}, 'tags': {}, 'xqueue': {'posts': []}}

def go(page):
    page.add_init_script(FACE)
    page.goto(BASE + '#/'); page.wait_for_selector('#reviews.show', timeout=8000)
    page.evaluate("async () => { const S = await import('/js/store.js'); await S.phoneReset(); }")
    page.evaluate(UNLOCK); page.evaluate("location.hash = '#/tag'"); page.wait_for_selector('#tag.show')
    page.set_input_files('#tgPick', files=[{'name': 'for phone.json', 'mimeType': 'application/json', 'buffer': json.dumps(B).encode()}])
    page.wait_for_selector('#tgCard')

def sent(page):
    with page.expect_download() as d: page.click('#tgSend')
    return json.loads(open(d.value.path()).read())['actions']

def test_only_untagged_and_done_needs_a_tag(page):
    go(page)
    assert page.inner_text('#tgCount').startswith('2')
    assert page.is_disabled('#tgDone') and page.inner_text('#tgDone') == 'Pick a tag'
    page.click('[data-add="impact"]')
    assert page.inner_text('#tgOn') .startswith('impact') and not page.is_disabled('#tgDone')
    page.click('#tgDone'); page.wait_for_function("document.getElementById('tgCount').textContent.startsWith('1')")
    a = sent(page)
    assert (a[0]['op'], a[0]['key'], a[0]['add']) == ('tag', 'Unsorted/a.mp4', ['impact'])

def test_new_tag_and_new_folder(page):
    go(page)
    page.click('#tgNew'); page.fill('.tg-input', 'smear frames'); page.keyboard.press('Enter')
    page.wait_for_selector('[data-rm="smear frames"]')
    page.click('#tgFolder'); page.wait_for_selector('#folderVeil', state='visible')
    page.fill('#folderSearch', 'Pose/Smears'); page.click('#folderList [data-new]'); page.click('#folderOk')
    page.wait_for_function("document.getElementById('tgFolder').textContent.includes('Smears')")
    page.click('#tgDone'); page.wait_for_function("document.getElementById('tgCount').textContent.startsWith('1')")
    a = sent(page)
    assert [x['op'] for x in a] == ['tag', 'move'] and a[0]['add'] == ['smear frames'] and a[1]['folder'] == 'Pose/Smears'
    page.wait_for_selector('[data-rm]', state='detached')
    assert page.locator('[data-add="smear frames"]').count() == 1   # recent tags come first next time

def test_later_goes_to_the_back(page):
    go(page)
    assert 'a.mp4' in page.inner_text('#tgCard')
    page.click('#tgLater'); page.wait_for_timeout(400)
    assert 'b.png' in page.inner_text('#tgCard') and page.inner_text('#tgCount').startswith('2')
