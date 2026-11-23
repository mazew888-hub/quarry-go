# Handoff for the Quarry chat: the phone folder for Quarry Go

**From:** the Quarry Go chat (the phone companion app). **Date:** 2026-11-22.

**What's needed:**
- On every sync, Quarry should publish a small folder for the phone app.
- Quarry should also carry out the actions the phone writes back there.
- Nothing in Quarry's existing sync format changes. The phone only reads and writes `Quarry Sync/phone/`.

## Why

Quarry Go is an iPhone web app the user built alongside Quarry, with three tabs:
- **Review** is done and needs nothing from Quarry.
- **Sort** sorts X likes and reposts one at a time (Keep / Skip), like Library → To sort → X likes & reposts.
- **Library** browses the library, adds and removes tags, moves items to folders, and steps through untagged items.

The phone can't fetch X likes itself (that needs the X cookies on the PC) and can't read the library database. So Quarry hands it a snapshot, and carries out what the user did on the phone, using Quarry's own code.

## Where

`<the Quarry Sync folder>/phone/`. This is the same exchange folder `sync.py` uses (SYNC_DIR_NAME), and Google Drive for desktop carries it to Drive. Quarry writes everything in it except `actions/`.

```
phone/
  status.json            Quarry writes
  library.json           Quarry writes
  folders.json           Quarry writes
  tags.json              Quarry writes
  xqueue.json            Quarry writes
  thumbs/<sha1>.jpg      Quarry writes
  actions/<phone>-<seq>.json   the PHONE writes; Quarry only reads (and may delete old, fully applied ones)
  applied/<phone>.json   Quarry writes, one per phone
```

Write every JSON file atomically (temp file then rename, like `_write_json`), as UTF-8 with `ensure_ascii=False`.

## When

In each Sync run, automatic or Sync now:
1. **At the start:** carry out the new phone actions (see Actions below). Do it before computing `current()`, so their effects travel to the other PC in the same sync.
2. **At the end:** write the snapshot files. Only rewrite a file if its content changed; compare a hash of the JSON text. Don't touch `status.json` on a run where nothing else changed, except to update `written`.

If the phone folder can't be written (for example, the disk is full), log it and carry on: the normal sync must never fail because of the phone folder.

## Files Quarry writes

### status.json
```json
{ "version": 1, "written": "2026-11-22T17:50:03", "machine": "Desk PC", "snapshot": 412, "x_checked": "2026-11-22T17:31:10" }
```
- `snapshot` goes up by 1 every time any snapshot file changes.
- `x_checked` is when Quarry last looked for new X likes, or null.

### library.json
```json
{ "version": 1, "snapshot": 412, "items": [
  { "key": "Anatomy/Hands/IMG_0412.jpg", "kind": "image", "title": "", "author": "", "source": "X",
    "post_url": "https://x.com/...", "media_url": "https://pbs.twimg.com/...", "folder": "Anatomy/Hands",
    "tags": ["hands", "gesture"], "added": "2026-11-20 10:12:33", "parent": null,
    "thumb": "3f2a…e1.jpg", "w": 1080, "h": 1350 }
] }
```
- **`key`:** the same key sync uses for the item record: `rel_key(path, root)`, the path inside the library folder with forward slashes. Leave out items outside the library (where `rel_key` is None).
- **`kind`:** as in the items table.
- **`source`, `post_url`, `title`, `author`:** as in the items table.
- **`media_url`:** `grab_url` when it's an http(s) URL, else null.
- **`folder`:** the item's folder path ("" for the top), the same path form as sync's folder records.
- **`tags`:** sorted case-insensitively, like sync does.
- **`parent`:** the parent item's key, for clips, else null.
- **`thumb`:** the thumbnail's file name in `thumbs/`, or null if Quarry has no picture for it.
- **`w`, `h`:** the pixel size if known, else null.

### folders.json
```json
{ "version": 1, "folders": ["Anatomy", "Anatomy/Hands", "Poses"] }
```
Every folder path, in the order Quarry shows them (the user's sort).

### tags.json
```json
{ "version": 1, "tags": [ { "tag": "hands", "n": 52 }, { "tag": "gesture", "n": 17 } ] }
```
Every tag in use, with how many items carry it, most used first.

### xqueue.json
```json
{ "version": 1, "posts": [
  { "id": "1859…", "url": "https://x.com/someone/status/1859…", "author": "someone", "author_name": "Some One",
    "text": "…", "date": "2026-11-21T09:00:00", "kinds": ["like"],
    "media": [ { "type": "video", "url": "https://video.twimg.com/…mp4", "poster": "https://pbs.twimg.com/…jpg" },
               { "type": "photo", "url": "https://pbs.twimg.com/…jpg", "poster": null } ] }
] }
```
- Include only posts with `x_inbox.status = 'new'`, in the same order Quarry's To sort shows them.
- **`media`:** taken from `x_inbox.media`. Normalise each entry to `type` (photo, video or gif), `url` (the best playable file: the mp4 for video and gif, the image for photo) and `poster` (a still frame or null).
- Cap the list at the newest 500. The phone shows the count.

### thumbs/
- One JPEG per item, named `sha1(key as UTF-8).hexdigest() + ".jpg"`.
- **Size:** fit in 400×400 at quality 80. Use Quarry's existing thumbnail if it has one; for videos and GIFs, use its existing poster frame.
- **When to write:** only when missing, or when the item's file changed.
- **Removing:** delete thumbs whose item is gone.

### Matching numbers (the phone relies on these)
- `library.json`'s `snapshot` must equal `status.json`'s `snapshot` for the same sync. The phone ignores a snapshot whose numbers don't match yet, and reads it again next time.
- `applied/<phone>.json`'s `time` must be written at the start of the sync, and `status.json`'s `written` at the end. The phone keeps showing its actions until `written` is at least `time`.

### applied/<phone>.json
```json
{ "version": 1, "phone": "p-7c1e…", "last": 38, "time": "2026-11-22T17:50:01",
  "failed": [ { "n": 37, "op": "tag", "reason": "That item isn't in the library any more" } ] }
```
- **`last`:** the highest action number carried out or failed for that phone.
- **`failed`:** only the failures from the most recent 200 actions. Write the reasons in plain words; the phone shows them to the user.

## Files the phone writes: actions/<phone>-<seq>.json

```json
{ "version": 1, "phone": "p-7c1e…", "seq": 12, "time": "2026-11-22T17:41:00", "actions": [
  { "n": 34, "op": "keep", "id": "1859…", "folder": "Anatomy/Hands", "tags": ["hands"] },
  { "n": 35, "op": "skip", "id": "1860…" },
  { "n": 36, "op": "undo", "id": "1860…" },
  { "n": 37, "op": "tag",  "key": "Poses/standing.jpg", "add": ["contrapposto"], "remove": ["misc"] },
  { "n": 38, "op": "move", "key": "Poses/standing.jpg", "folder": "Anatomy/Body" }
] }
```

The file name is `<phone>-<seq as 8 digits>.json`. `n` is the phone's own action number, which only goes up, across files.

**Carrying them out.** Read every actions file for each phone and gather the actions with `n` greater than that phone's `applied.last`. Do them in `n` order, then write `applied/<phone>.json`. Each action is done once: never repeat an `n` at or below `last`. **The same `n` can appear in more than one file** (the phone resends when a reply is lost on mobile data): carry each `n` out once, and ignore the copies.

| op | What Quarry does | Fails when (reason shown to the user) |
|---|---|---|
| `keep` | `m_x_decide([id], "keep", folder_id=<id of folder path or None>, tags=",".join(tags))`, exactly as if kept in Quarry, which downloads the post into that folder. `folder` null means where Quarry would normally put it. | "That post isn't waiting any more" (not in x_inbox); "There's no folder called …" (unknown folder path) |
| `skip` | `m_x_decide([id], "skip")` | "That post isn't waiting any more" |
| `undo` | `m_x_decide([id], "undo")`. Doesn't delete anything already downloaded, the same as Undo in Quarry. | "That post isn't in X sorting" |
| `tag` | Add the `add` tags and remove the `remove` tags on the item with that key, through the library's normal tag functions (so sync picks it up). | "That item isn't in the library any more" |
| `move` | Move the item into that folder with Quarry's normal move. Its key changes, and the next snapshot shows the new key. | "That item isn't in the library any more"; "There's no folder called …" |

- **Folders:** don't create folders from the phone. An unknown folder path is a failure.
- **Clean-up:** delete an actions file once all its actions are at or below `last` and it's older than 7 days.
- **Other PCs:** if two PCs sync, both may see the same actions file. `applied/<phone>.json` is shared, so read it fresh right before carrying out actions, and write it straight after. A rare double run is harmless for `skip`, `undo`, `tag` and `move`; for `keep`, `m_x_decide` on a post already kept is fine (it's not 'new' any more).

## Done when
1. After a Sync, `phone/` holds the five JSON files and `thumbs/`, matching the library and To sort.
2. Dropping a hand-written actions file (like the example) into `phone/actions/` and pressing Sync now:
   - keeps, skips, tags and moves as described
   - writes `applied/<phone>.json`
   - updates the snapshot
3. A failing action (unknown key) appears in `failed` with its reason. The others still run.
4. Sync of everything else is unchanged; add tests next to the existing sync tests.
5. WHATS NEW gets a plain line: "Quarry Go on your phone can sort X likes and tag your library: Quarry now keeps a small phone folder inside Quarry Sync and carries out what you did on the phone at each sync."
