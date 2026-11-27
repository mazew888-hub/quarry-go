"""Stress: every frame Quarry Go decodes is the right source frame, in order, none dropped or doubled.
Each stress clip shows its frame index as 10 black/white bands. Run tests/stress/make_clips.sh first.
(Formats the test browser can't play, MPEG-4 Part 2, ProRes, MJPEG, are checked on the iPhone.)"""
import pytest

BASE = 'http://localhost:8765/'
CLIPS = ['h264_23.976.mp4', 'h264_24.mp4', 'h264_25.mp4', 'h264_29.97.mp4', 'h264_30.mp4', 'h264_30.mov',
         'h264_50.mp4', 'h264_60.mp4', 'h264_30_long.mp4', 'vfr.mp4']
READ = '''async name => {
  const { loadFrames } = await import('/js/frames.js');
  const blob = await (await fetch('/tests/fixtures/stress/' + name)).blob();
  const m = await loadFrames(blob, { log: () => {} });
  if (m.done) await m.done;
  const c = document.createElement('canvas'); c.width = 320; c.height = 180; const x = c.getContext('2d');
  const idx = m.frames.map(f => { if (!f) return -1; x.drawImage(f, 0, 0, 320, 180);
    const row = x.getImageData(0, 90, 320, 1).data; let n = 0;
    for (let k = 0; k < 10; k++) if (row[(Math.floor((k + 0.5) * 32)) * 4] > 128) n += 1 << k; return n; });
  return { fps: m.fps, count: m.count, idx };
}'''

@pytest.mark.parametrize('name', CLIPS)
def test_every_frame_decoded_in_order(page, name):
    page.goto(BASE + '#/'); page.wait_for_selector('#reviews.show', timeout=8000)
    r = page.evaluate(READ, name)
    if name == 'vfr.mp4':
        # an uneven clip is held on a steady grid: frames may repeat at the gaps but never go backwards or skip far
        assert all(b >= a for a, b in zip(r['idx'], r['idx'][1:])) and max(b - a for a, b in zip(r['idx'], r['idx'][1:])) <= 2, r['idx']
    else:
        assert r['idx'] == list(range(r['count'])), (r['fps'], r['count'], r['idx'][:40])
