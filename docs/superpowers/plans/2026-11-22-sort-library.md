# Quarry Go: Sort and Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Sort (X likes, one at a time) and Library (browse, search, tag, move, untagged queue) tabs to Quarry Go. They talk to Quarry through `Quarry Sync/phone/` on Google Drive.

**Architecture:**
- Google sign-in is a redirect, implicit-token flow with a Web OAuth client in the Vista Google project, using the `drive` scope.
- `drive.js` is a tiny Drive REST client.
- `phone.js` keeps a cached snapshot and an action queue in IndexedDB, and works out what the user sees by laying the unsent and unapplied actions over the snapshot (a pure function).
- The UI modules render from that view.
- Tests fake Google with Playwright `page.route` and serve fixture files from `tests/fixtures/phone/`.

**Tech Stack:** As before: plain ES modules, IndexedDB, Playwright, `node --test`.

**Spec:** https://claude.ai/artifact/5fusLPGhtW8UbH77U2KdEV (Sort and Library design). Contract: `docs/quarry-handoff-phone-folder.md`, which is binding for file names and JSON fields.

## Global Constraints

- **Field names:** JSON shapes exactly as in `docs/quarry-handoff-phone-folder.md`. The phone writes only `phone/actions/<phone>-<seq 8 digits>.json`.
- **Review is untouched:** it makes no network requests. Sort and Library talk only to `accounts.google.com`, `www.googleapis.com` and X's media hosts (`pbs.twimg.com`, `video.twimg.com`).
- **Act at once:** every action shows as done immediately. It's queued in IndexedDB, sent when online, and its result is shown from `applied/<phone>.json`.
- **Failures:** a failed action shows its reason, with Retry and Drop.
- **No polling:** refresh happens on opening Sort or Library and on pull-to-refresh.
- **Look:** the planner A2 dark tokens, glass keys and Rubik. One sample screen each of Sort and Library is approved by the user before that tab is finished.
- **Version:** `VERSION` goes up in both `js/app.js` and `sw.js` on every publish.

## Review Focus

1. **Expired sign-in:** the token runs out mid-session (it lasts 1 hour). Expected: a quiet renew by redirect the next time the phone needs the network, and queued actions stay queued. Test: Task 1 `test_expired_token_renews`.
2. **No phone folder yet:** Quarry hasn't written `phone/` (the Quarry side isn't built yet, or no sync has run). Expected: Sort and Library say "Quarry hasn't made the phone folder yet. Open Quarry on your PC and sync." and nothing breaks. Test: Task 2 `test_no_phone_folder_message`.
3. **Offline:** an action is made with no connection. Expected: it's shown as done and sent later. Test: Task 2 `test_offline_action_queues_and_sends`.
4. **The snapshot catches up:** the snapshot reflects an action, so the item is gone or moved. Expected: no double effects in the view, and actions at or below `applied.last` are dropped from the overlay. Test: Task 2 `overlay drops applied actions`.
5. **A large library:** 5,000 items. Expected: the grid stays smooth (it renders as you scroll) and search answers within 100ms. Test: Task 4 `test_big_library_search_fast`.

---

### Task 1: Google sign-in and the Drive client

**Files:**
- Create: `js/drive.js`, `tests/e2e/fakedrive.py`, `tests/e2e/test_drive.py`
- Modify: `js/app.js` (catch the redirect back from Google at boot)

**Interfaces:**
- Produces from `js/drive.js`:
  - `CLIENT_ID` constant: the Web client ID (a placeholder until the user creates it; Settings shows "Not set up yet" while it's the placeholder).
  - `signIn()`: redirects to Google.
  - `handleRedirect() -> bool`: reads `#access_token` etc. after the redirect and returns true when it handled one.
  - `signOut()`
  - `account() -> {email}|null`
  - `ready() -> bool`
  - `phoneFolder() -> {id, actionsId, appliedId, thumbsId}|null`: null when `Quarry Sync/phone` doesn't exist.
  - `readJson(folderId, name) -> object|null`
  - `listNames(folderId) -> Map<name,id>`, which pages through everything.
  - `readBlob(fileId) -> Blob`
  - `writeJson(folderId, name, obj)`
  - `ensureFolder(parentId, name) -> id`
  - `DriveError(message, {auth})`
- The token lives in `localStorage` (`qg_token`, `qg_token_exp`, `qg_email`). `drive.js` is fully separate from `store.js`.
- Auth URL: `https://accounts.google.com/o/oauth2/v2/auth` with:
  - `response_type=token`
  - `scope=https://www.googleapis.com/auth/drive email`
  - `redirect_uri=<location.origin + location.pathname>`
  - `state` = a random value kept in `sessionStorage`
  - `include_granted_scopes=true`
  - for a silent renew: `prompt=none` plus `login_hint=<email>`
- Before redirecting, save `{hash: location.hash}` in `sessionStorage` (`qg_return`) and restore it afterwards.

- [ ] **Step 1: Write `fakedrive.py`.** It's a helper that installs `page.route('https://www.googleapis.com/**')` and `page.route('https://accounts.google.com/**')` handlers. The fake:
  - holds a Drive tree in memory, built from `tests/fixtures/phone/` (folders `Quarry Sync/phone/{actions,applied,thumbs}` plus the JSON files)
  - answers `files.list` (q by name, by parent, and by mimeType folder), `files/<id>?alt=media` and multipart uploads
  - answers the auth URL with a redirect back carrying `#access_token=fake&expires_in=3600&state=<state>`
  - exposes `written` (uploads) and `expire()` (makes the next API call return 401)
- [ ] **Step 2: Write the failing tests in `test_drive.py`:**
  - `test_sign_in_round_trip`: go to `#/library`, call `signIn()`, and land back on `#/library` with `ready()` true.
  - `test_phone_folder_found`: `phoneFolder()` has non-null ids.
  - `test_read_and_write`: `readJson(phone,'status.json').snapshot == 3`. `writeJson(actions,'p-x-00000001.json',{a:1})` appears in `written`.
  - `test_expired_token_renews`: `expire()`, then `readJson` still returns data, after a silent renew redirect.
- [ ] **Step 3: Run** `timeout 110 python3 -m pytest tests/e2e/test_drive.py -q` and expect FAIL.
- [ ] **Step 4: Implement `js/drive.js`** and the redirect handling in `app.js`. On a 401, if the call wasn't already a retry, renew silently (a redirect with `prompt=none`); `DriveError.auth` tells the UI to show Connect again when the renew fails.
- [ ] **Step 5: Run** and expect PASS, then commit with `feat: google drive sign-in and client`.

### Task 2: Snapshot, action queue and overlay

**Files:**
- Create: `js/phone.js`, `js/overlay.js`, `tests/overlay.test.mjs`, `tests/e2e/test_phone.py`, `tests/fixtures/phone/` (status, library with 6 items over 3 folders including 2 untagged, folders, tags, xqueue with 4 posts, 6 thumbs, `applied/` empty)
- Modify: `js/store.js` (DB VERSION 2, with new stores `kv` keyed by name and `actions` keyed by `n`)

**Interfaces:**
- Produces from `js/overlay.js` (pure): `view(snapshot, actions, applied) -> {items, folders, tags, queue, pending:int, failed:[{n,op,reason,action}]}`.
  - `snapshot = {library, folders, tags, xqueue, status}`; `actions` is the local queue; `applied = {last, failed}`.
  - Actions with `n <= applied.last` are dropped, except failures, which are listed under `failed`.
  - `keep`/`skip` remove the post from the queue; `undo` puts it back where it was.
  - `tag` adds and removes tags; `move` sets the item's `folder` and rewrites its key prefix.
  - Tag counts are recomputed from the items.
- Produces from `js/phone.js`:
  - `phoneId()`: makes `p-<uuid>` once and keeps it in `kv`.
  - `refresh() -> {state:'ok'|'nofolder'|'offline'|'signedout', status}`: reads status and, when `snapshot` changed, the other files; reads `applied/<phone>.json`; sends pending actions.
  - `act(action) -> n`: gives the next `n`, stores it with `sent:false` and calls `send()` without waiting.
  - `send()`: puts every unsent action into one file, `<phone>-<seq>.json`, and marks them sent. Offline it keeps them for next time.
  - `current() -> view(...)`
  - `retry(n)`: re-queues it with a new `n`.
  - `drop(n)`
  - `thumbUrl(name) -> Promise<string|null>`: Cache Storage `qg-thumbs`, fetched through `drive.readBlob`.
  - `onChange(fn)`

- [ ] **Step 1: Write the failing unit tests in `tests/overlay.test.mjs`:**
  - `keep removes from queue`
  - `undo restores order`
  - `tag add/remove`
  - `move rewrites key and folder`
  - `overlay drops applied actions`: `last` = 5 and actions 4 to 6 means only 6 applies.
  - `failed listed with reason`
  - `tag counts follow overlay`
- [ ] **Step 2: Write the failing e2e tests** in `test_phone.py`, using `fakedrive`:
  - `test_refresh_loads_snapshot`: 6 items and 4 posts.
  - `test_act_sends_file`: one action, then a file `p-…-00000001.json` with `actions[0].op=='skip'` and `n==1`.
  - `test_offline_action_queues_and_sends`: `context.set_offline(True)`, act, check pending == 1; back online, `refresh()`, and the file is sent.
  - `test_no_phone_folder_message`: an empty fake Drive gives `refresh().state == 'nofolder'`.
  - `test_applied_failure_shows`: the fake `applied` has `{last:1, failed:[{n:1, reason:'x'}]}`, so `current().failed[0].reason == 'x'`.
- [ ] **Step 3: Run both** and expect FAIL.
- [ ] **Step 4: Implement.** The store upgrade from v1 to v2 keeps `reviews` and `clips`.
- [ ] **Step 5: Run both** and expect PASS, then commit with `feat: phone snapshot, action queue and overlay`.

### Task 3: Tab bar, Settings and the Sort tab

**Files:**
- Create: `js/tabs.js`, `js/sort.js`, `tests/e2e/test_sort.py`
- Modify: `index.html` (tab bar, `#sort` section, folder sheet), `css/app.css`, `js/app.js` (routes `#/sort`, `#/library`; the Settings Google section)

**Interfaces:**
- Produces: `openFolderSheet({title, withTags}) -> Promise<{folder, tags}|null>`, shared with Library.
  - Recent folders first: the last 6 used are kept in `kv` as `recentFolders`.
  - Then a search box and the full list, plus a tags input with suggestions when `withTags`.
- Tabs: Review (`#/`), Sort (`#/sort`), Library (`#/library`), as a bottom bar on those three screens and hidden in the player.

- [ ] **Step 1: Do the design sample.** Render the Sort screen with fixture post 1 (a picture) plus the folder sheet open, screenshot it at 390×844 and send it to the user. **Wait for approval.**
- [ ] **Step 2: Write the failing tests:**
  - `test_tabs_route`
  - `test_settings_connect_shows_account`
  - `test_swipe_left_skips`: a drag of more than 120px to the left skips; the counter goes from 4 to 3 and an action is sent.
  - `test_keep_asks_folder`: swipe right, pick `Anatomy/Hands`, add the tag `hands`; the action is `{op:'keep', folder:'Anatomy/Hands', tags:['hands']}`.
  - `test_undo_steps_back`
  - `test_video_post_plays_muted_loop`: a video element with `muted` and `loop` and the fixture mp4 URL routed to the local clip.
  - `test_all_sorted`
  - `test_signed_out_prompt`
- [ ] **Step 3: Run** and expect FAIL. **Step 4: Implement.** **Step 5: Run** and expect PASS, then commit with `feat: sort tab`.

### Task 4: The Library tab

**Files:**
- Create: `js/library.js`, `tests/e2e/test_library.py`
- Modify: `index.html` (`#library` section, item sheet), `css/app.css`

**Interfaces:**
- Consumes: `phone.current()`, `phone.act()`, `phone.thumbUrl()`, `openFolderSheet()`.

- [ ] **Step 1: Do the design sample.** Render the Library grid with the fixture data and the item sheet open, screenshot it, send it, and **wait for approval.**
- [ ] **Step 2: Write the failing tests:**
  - `test_grid_shows_items_with_thumbs`
  - `test_search_title_tag_author`
  - `test_folder_chip_filters`
  - `test_tag_add_remove_sends_actions`
  - `test_move_sends_action_and_regroups`
  - `test_untagged_queue_next`: tagging one moves to the next untagged item; the count goes from 2 to 1.
  - `test_failed_action_retry_drop`
  - `test_big_library_search_fast`: the fake serves 5,000 generated items. Typing "hand" filters within 100ms (measured in-page) and only about one screen of tiles is in the page.
- [ ] **Step 3: Run** and expect FAIL. **Step 4: Implement** the grid, rendering tiles as they scroll into view (a plain sentinel plus 120-item pages). **Step 5: Run** and expect PASS, then commit with `feat: library tab`.

### Task 5: Network rules, offline, version and publish

**Files:** `sw.js` (adds the new files to FILES and bumps VERSION), `js/app.js` (VERSION), `tests/e2e/test_offline.py`

- [ ] **Step 1: Write the failing tests:**
  - `test_review_still_no_network`: the existing test, unchanged.
  - `test_sort_library_hosts`: during Sort and Library, every request's host is localhost, accounts.google.com, www.googleapis.com, pbs.twimg.com or video.twimg.com.
  - `test_library_offline_from_cache`: refresh once, go offline, reload, and Library shows the 6 items with their thumbs.
- [ ] **Step 2: Run, implement, and run again.** The service worker never caches googleapis responses; the snapshot lives in IndexedDB and thumbnails in `qg-thumbs`.
- [ ] **Step 3: Run the full suite,** then merge into main and push. Check the Pages run succeeded.
- [ ] **Step 4: Tell the user how to make the Web OAuth client** (Google Cloud project "Vista" → Credentials → Create OAuth client ID → Web application):
  - JavaScript origin `https://mazew888-hub.github.io`
  - redirect URI `https://mazew888-hub.github.io/quarry-go/`
  - add the `drive` scope on the consent screen
  - check they're listed as a test user

  They paste the client ID into chat. Set `CLIENT_ID`, publish, and send the phone checklist.
