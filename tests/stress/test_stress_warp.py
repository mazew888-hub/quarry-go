"""Stress: a time warp round trip. The retimed video Quarry Go exports shows exactly the source frames
its warp says (frame by frame, read from the stress clips' bands), and the Maya time warp file, run on
scenes at several frame rates, lands each scene frame on the same moment of the video."""
import json, subprocess, pathlib, tempfile
import numpy as np
import pytest

BASE = 'http://localhost:8765/'
ROOT = pathlib.Path(__file__).resolve().parents[2]
FAKE_MAYA = ROOT / 'tests/fixtures/fake_maya.py'
UNITS = {'film': 24, 'pal': 25, 'ntsc': 30, 'show': 48, 'palf': 50, 'ntscf': 60}

def warp_for(n):
    # slow-mo, a hold, a speed-up and back to normal: the shapes reviews use most
    a, b = n // 5, n // 2
    return [{'x': 0, 'y': 0, 't': 'linear'}, {'x': a * 2, 'y': a, 't': 'linear'}, {'x': a * 2 + 6, 'y': a, 't': 'linear'},
            {'x': a * 2 + 6 + (b - a) // 2, 'y': b, 't': 'linear'}, {'x': a * 2 + 6 + (b - a) // 2 + (n - 1 - b), 'y': n - 1, 't': 'linear'}]

def frames_of(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-vf', 'scale=320:-1,format=gray', '-f', 'rawvideo', '-'], capture_output=True).stdout
    h = len(raw) // 320
    out = subprocess.run(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=nb_read_frames,height,width', '-of', 'csv=p=0', str(path)], capture_output=True, text=True).stdout
    w, hh, n = map(int, out.strip().split(',')); H = round(hh * 320 / w)
    a = np.frombuffer(raw, np.uint8).reshape(n, H, 320)
    row = a[:, 90, [int((k + 0.5) * 32) for k in range(10)]] > 128
    return [int(sum(1 << k for k in range(10) if r[k])) for r in row]

@pytest.mark.parametrize('name', ['h264_24.mp4', 'h264_25.mp4', 'h264_29.97.mp4', 'h264_30.mp4', 'h264_60.mp4'])
def test_retimed_video_and_maya_file_agree(page, name, tmp_path):
    n = int(subprocess.run(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0',
                            str(ROOT / 'tests/fixtures/stress' / name)], capture_output=True, text=True).stdout)
    keys = warp_for(n)
    page.goto(f"{BASE}?test=player&clip=stress/{name}&warp={json.dumps(keys)}")
    page.wait_for_function("document.getElementById('log2').textContent.includes('loaded in')", timeout=30000)
    # the clip's real count and rate, as the player read them
    count, fps = page.evaluate("() => [window.__media.count, window.__media.fps]")
    fmap = page.evaluate("async ([keys, n]) => { const { frameMap } = await import('/js/warp.js'); return [...frameMap(keys, n)]; }", [keys, count])
    # 1) the exported retimed video shows exactly fmap
    page.click('#more')
    with page.expect_download(timeout=60000) as d: page.click('#export')
    p = tmp_path / 'ret.mp4'; d.value.save_as(p)
    got = frames_of(p)
    assert got == fmap, f'{name}: video {got[:30]} vs warp {fmap[:30]}'
    # 2) the Maya file on scenes at other rates: scene frame i lands on the same moment as the video
    py = page.evaluate("async ([keys, fps, n]) => { const { timeWarpPy } = await import('/js/handback.js'); return timeWarpPy({ name: 'stress', fps, frameCount: n, retimed: true, warp: { keys } }); }", [keys, fps, count])
    f = tmp_path / 'tw.py'; f.write_text(py)
    for unit, r in UNITS.items():
        res = json.loads(subprocess.run(['python3', str(FAKE_MAYA), str(f), unit], capture_output=True, text=True).stdout.strip().split('\n')[-1])
        kx = [k['x'] for k in keys]; ky = [k['y'] for k in keys]
        K = sorted(res['keys']); X = [k[0] - 1 for k in K]; Y = [k[1] - 1 for k in K]   # the curve started at (1, 1)
        for i in range(0, int(X[-1]) + 1):
            src = np.interp(i, X, Y) * fps / r                        # the video frame Maya shows at scene frame i
            want = np.interp(i * fps / r, kx, ky)                       # the warp at that same moment
            assert abs(src - want) < 0.01, f'{name} on a {r} fps scene: frame {i} shows {src:.3f}, the warp says {want:.3f}'
