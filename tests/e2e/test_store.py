URL = 'http://localhost:8765/tests/e2e/store_harness.html'

def open_harness(page):
    page.goto(URL); page.wait_for_function('window.ready === true')
    page.evaluate('S.deleteAll()')

def test_create_then_list(page):
    open_harness(page)
    out = page.evaluate('''async () => {
        const r = await S.createReview({ name: 'shot', fps: 24 }, new Blob([new Uint8Array(1234)], { type: 'video/mp4' }));
        const list = await S.listReviews(); const clip = await S.getClip(r.id);
        return { n: list.length, name: list[0].name, size: clip.size, id: r.id === list[0].id };
    }''')
    assert out == {'n': 1, 'name': 'shot', 'size': 1234, 'id': True}

def test_save_flush_reload(page):
    open_harness(page)
    rid = page.evaluate('''async () => { const r = await S.createReview({ name: 'a' }, new Blob(['x']));
        S.saveReview(r.id, { marks: [{ f: 3, type: 'note', text: 'hi' }] }); await S.flush(); return r.id; }''')
    page.reload(); page.wait_for_function('window.ready === true')
    marks = page.evaluate('async id => (await S.getReview(id)).marks', rid)
    assert marks == [{'f': 3, 'type': 'note', 'text': 'hi'}]

def test_quota_error_leaves_no_review(page):
    open_harness(page)
    out = page.evaluate('''async () => {
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (v, k) {
            if (this.name === 'clips') throw new DOMException('full', 'QuotaExceededError');
            return put.call(this, v, k);
        };
        let msg = null;
        try { await S.createReview({ name: 'big' }, new Blob(['x'])); } catch (e) { msg = e.message; }
        IDBObjectStore.prototype.put = put;
        return { msg, n: (await S.listReviews()).length };
    }''')
    assert out == {'msg': 'Not enough space on this phone for that clip', 'n': 0}

def test_delete_removes_clip(page):
    open_harness(page)
    out = page.evaluate('''async () => { const r = await S.createReview({ name: 'a' }, new Blob(['xyz']));
        await S.deleteReview(r.id); return { clip: await S.getClip(r.id), n: (await S.listReviews()).length, u: (await S.usage()).bytes }; }''')
    assert out == {'clip': None, 'n': 0, 'u': 0}

def test_list_newest_first_and_usage(page):
    open_harness(page)
    out = page.evaluate('''async () => {
        const a = await S.createReview({ name: 'a' }, new Blob(['12']));
        await new Promise(r => setTimeout(r, 5));
        const b = await S.createReview({ name: 'b' }, new Blob(['345']));
        return { names: (await S.listReviews()).map(r => r.name), u: (await S.usage()).bytes };
    }''')
    assert out == {'names': ['b', 'a'], 'u': 5}

def test_flush_survives_a_lost_connection(page):
    open_harness(page)
    out = page.evaluate('''async () => {
        const r = await S.createReview({ name: 'a' }, new Blob(['x']));
        const tx = IDBDatabase.prototype.transaction; let fails = 1;
        IDBDatabase.prototype.transaction = function (...a) {
            if (fails-- > 0) throw new DOMException('Connection to Indexed Database server lost', 'InvalidStateError');
            return tx.apply(this, a);
        };
        S.saveReview(r.id, { name: 'kept' });
        let err = null; try { await S.flush(); } catch (e) { err = e.message; }
        IDBDatabase.prototype.transaction = tx;
        return { err, name: (await S.getReview(r.id)).name };
    }''')
    assert out == {'err': None, 'name': 'kept'}
