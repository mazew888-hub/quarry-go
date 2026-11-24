# Dated reviews, multi-add and Export notes (Quarry Go 0.4.0)

## Why
The user reviews many animations at once on the phone and wants Review organised the way Quarry's
review panel is: a review is a day holding several videos, history grouped by week and month, and one
"Export notes" that hands everything back to the team as a zip Quarry can read.

## Goals
- A review is a **day** (YYYY-MM-DD) holding any number of videos.
- **New review** picks several videos at once (Photos or Files) into today's review. **Add videos** adds more to the review you're in.
- **History** like Quarry: newest first. This week's reviews are raised cards (first three thumbnails, day, Today badge,
  "N videos", "● N with notes"). Older ones are rows per day in a sunken list under their month: weekday, date,
  "Week W · N videos", "● N".
- **One review** screen: title is the date, Add videos and Export notes keys, then the videos in a sunken list
  (thumbnail, name, frame count, note/drawing/Retimed badges). Tap opens the player; Back returns here.
- **Export notes** sheet like Quarry's: a row per video (only videos with notes by default, a switch to show all),
  toggles per video for **Video** (`<name> - notes.mp4`), **Quarry notes** (`<name>.quarrynotes`) and **Maya**
  (`<name> - image plane.py`), plus **Time warp** (`<name> - time warp.py`) on retimed videos. Chips at the top flip a
  kind for every row. One zip, `Review YYYY-MM-DD.zip`, one folder per video. Defaults follow Quarry: everything on.
- Visual style: only the app's existing parts (approved mockup `review_mock2.png`).

## Non-goals / anti-goals
- Nothing touches the network. Footage never leaves the phone except through the share sheet the user taps.
- No change to the player's tools.
- No editing of Quarry. Quarry's `maya_drop.py` is copied in as a template, unchanged.

## Decisions
- Storage: each video stays one record in the `reviews` store (no DB migration); it gains `day` and `fileName`.
  Old records take `day` from `created`. Routes: `#/` history, `#/d/<day>` a review, `#/r/<id>` the player.
- Formats match Quarry's code (annotator `lib/review/review_export.dart`, `lib/model.dart`, `lib/maya_export.dart`,
  `engine/maya_drop.py`, `refcore.write_maya_drop`):
  - `.quarrynotes`: `{app:'quarry', kind:'review-notes', version:1, exported, by, video:{name,w,h,fps,frames,duration},
    annotations:[Annotation.toJson], comments:[{id,author,name,at,frame,text}]}`. draw→pen, arrow→arrow, box→rect
    (4 corners), circle→ellipse (4 bounding corners); colour as ARGB int; `hold` from the drawing's hold; notes→comments.
  - Image plane: `maya_drop.py` with SHOT/STAMP/FPS/DIGITS/EXT lines filled and `_FRAMES` = base64 JPGs of each
    shown frame with notes burned in, following the retime when it's applied.
  - Time warp: Quarry's `mayaTimeWarpFile` text with keys built from the retime sections (linear, stepped at holds and cuts).
- Zip: stored (no compression; video doesn't shrink), written in the app, no library.
- Rendering moves out of the player into `render.js` so videos that aren't open can be exported.
- Notes videos record in real time as today; the sheet shows progress and can be stopped.

## Left to the builder
Exact progress wording, row truncation, long-press on a day (delete the whole review, with a confirm).
