# Quarry Go: phone app design (approved 2026-11-22)

Source of truth: https://claude.ai/artifact/3mkDTEeS6iLdPdSXWqKuMa. This is a markdown copy for the repo.

## What it is and why
Quarry Go is the phone companion to Quarry. Animations to review arrive on the phone through Slack, Files and Photos; the goal is to watch them properly, frame by frame, and send feedback without waiting to get to a PC. First piece: **Review** (proven by the test player). Later, as separate projects: **Sort** (X likes into Quarry) and **Library** (tagging Quarry items). Quarry Go replaces Vista as the phone app in time; Vista stays as is until then.

## Goals
- Installs on the iPhone home screen and opens truly full screen.
- A reviews list that stays between visits. Each review keeps a copy of its clip plus notes, shapes, loop, retime sections and play rate, and reopens where it was left.
- Everything the test player does, unchanged: play-rate presets plus Custom; zoom and pan; fading controls; tap sides to step, slide to scrub; In/Out loop with loop chip and hold-to-clear; notes, arrows, boxes, circles; retime sections (speed, hold, cut) with the Original/Retimed switch; exports (video with notes, retimed, original + retimed side by side); frames that load while you watch.
- GIFs scrub as cleanly as videos.
- Works with no connection once installed.

## Not in this project
Sort, Library, sending anything to Quarry or Google Drive, Maya time warp files, sound, freehand drawing, Quarry's time warp graph.

## Must never happen
- Project footage leaving the phone. No uploads, no analytics; no network requests at all after the first load.
- Any subscription or paid service.
- Working around company IT security.
- Losing a review's notes because the app was closed mid-change.

## Constraints
- iPhone home-screen web app (no Mac, so not native).
- Free GitHub Pages; the public repo holds only code, never media.
- Reviews and clips live in the app's own storage on the phone; the app asks iOS to keep it permanently.
- Frames held at up to 960px wide; very long clips refused with a clear message.
- Look: the milestone planner's A2 dark design, as in the test.

## Approaches considered
- **New app with room to grow (chosen):** built from the test's code, with a reviews list and a tab bar ready for Sort and Library.
- Inside Vista: would keep Google sign-in but needs the player rebuilt in Flutter; heavier and slower for frame-exact scrubbing.
- Review-only app: quickest, but Sort and Library would each become another app.

## The design
- **Reviews** (home): cards newest first with thumbnail, clip name, date, badges for notes, shapes and retimed; a big New review button (Files/Photos picker); press and hold a card to rename or delete.
- **Player:** the test player; ‹ returns to Reviews.
- **Tab bar:** only Review for now; Sort and Library appear when built.
- **Settings** (gear on Reviews): space used, Delete all reviews, app version.
- **Saving:** every change saves straight away. The clip is copied in when a review is made; deleting the review deletes the copy. Frames aren't stored; reopening decodes the stored clip again and the player is usable at once.
- **Opening clips:** Files/Photos picker; from Slack, save to Files first (iOS doesn't let home-screen web apps appear in the Share sheet). GIFs decoded frame by frame with their own timings.
- **Exporting:** the same three exports; outside Claude they open the iOS Share sheet.
- **Installing:** own icon and name ("Quarry Go"), full screen, offline after the first visit.
- **Privacy:** fonts and everything else ship with the app; no accounts needed for Review.

## Calls made for the user
App name Quarry Go, repo `quarry-go`; tab bar hidden until a second tab; GIFs via a small bundled reader; Rubik bundled; one icon sample for approval first.

## Left to the builder
File layout and storage code; offline caching setup; exact card layout within the planner style, one sample screen shown first.
