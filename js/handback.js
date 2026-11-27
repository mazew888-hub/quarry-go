// Handing a review back to the team in Quarry's own formats (see the annotator's review_export.dart,
// model.dart, maya_export.dart and engine/maya_drop.py): a .quarrynotes file, a Maya time warp .py and
// the Maya image-plane .py. Pure functions; the exporter renders the pictures.
import { holdOf, legacyHolds, isDrawn } from './draw.js';
import { fromSections, identity, isIdentity, mayaRows } from './warp.js';

export const NOTES_EXT = 'quarrynotes';
const RED = '#FF3B5C';
export const stemOf = name => { const s = String(name || ''); const dot = s.lastIndexOf('.'); return dot > 0 ? s.slice(0, dot) : s; };
// The folder a video's files go in, in the zip (Quarry's folderFor: no characters Windows refuses).
export const folderFor = r => String(r.name || 'Clip').replace(/[<>:"/\\|?*]/g, '-').trim() || 'Clip';
export const isRetimed = r => { const k = !!r.retimed && warpOf(r); return !!k && !isIdentity(k, r.frameCount || (k[k.length - 1].y + 1)); };
export const hasNotes = r => (r.marks || []).length > 0 || isRetimed(r);

const round = v => Math.round(v * 100) / 100;
const argb = hex => (0xFF000000 | parseInt(String(hex || RED).replace('#', '').slice(0, 6), 16)) >>> 0;

function annotation(m, id, hold, W) {
  const size = m.size || Math.max(3, W / 220);
  let kind, pts;
  if (m.type === 'draw') { kind = 'pen'; pts = m.pts.flat(); }
  else if (m.type === 'arrow') { kind = 'arrow'; pts = [m.x1, m.y1, m.x2, m.y2]; }
  else if (m.type === 'box') {
    kind = 'rect';
    const l = Math.min(m.x1, m.x2), r = Math.max(m.x1, m.x2), t = Math.min(m.y1, m.y2), b = Math.max(m.y1, m.y2);
    pts = [l, t, r, t, r, b, l, b];
  } else { // circle: centre where it was touched, radius the drag; Quarry keeps an ellipse as its box's corners
    kind = 'ellipse';
    const rr = Math.hypot(m.x2 - m.x1, m.y2 - m.y1), cx = m.x1, cy = m.y1;
    pts = [cx - rr, cy - rr, cx + rr, cy - rr, cx + rr, cy + rr, cx - rr, cy + rr];
  }
  const a = { id, kind, color: argb(m.color), size, opacity: 1, points: pts.map(round) };
  if (m.f) a.frame = m.f;
  if (hold > 1) a.hold = hold;
  if (kind === 'pen') { a.pressure_width = false; a.pressure_opacity = false; }
  return a;
}

export function quarryNotes(r, { now = new Date(), id = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)) } = {}) {
  const marks = r.marks || [], holds = r.holds || legacyHolds(marks), at = now.toISOString();
  let n = 0;
  return {
    app: 'quarry', kind: 'review-notes', version: 1, exported: at, by: 'quarry-go',
    video: {
      name: r.fileName || r.name, w: r.width, h: r.height, fps: r.fps, frames: r.frameCount,
      duration: r.fps ? Math.round(r.frameCount / r.fps * 1000) / 1000 : 0,
    },
    annotations: marks.filter(isDrawn).map(m => annotation(m, ++n, holdOf(holds, m.f), r.width || 1920)),
    comments: marks.filter(m => m.type === 'note')
      .map(m => ({ id: id(), author: 'quarry-go', name: 'Quarry Go', at, frame: m.f, text: m.text, replies: [] })),
  };
}

// ---------- time warp: the review's curve (or, for reviews from before time warp, its old sections)
export function warpOf(r) {
  if (r.warp && r.warp.keys && r.warp.keys.length) return r.warp.keys;
  if ((r.secs || []).length) return fromSections(r.frameCount, r.secs);
  return null;
}
export const warpKeys = (n, secs) => fromSections(n, secs).map(k => ({ x: k.x, y: k.y, step: k.t === 'step' }));

const num = v => { let s = v.toFixed(5); if (s.includes('.')) s = s.replace(/\.?0+$/, ''); return s === '-0' ? '0' : s; };

// Quarry's mayaTimeWarpCode: the curve's keys with their tangents (smooth keys go in as fixed slopes).
function timeWarpCode(keys, fps) {
  const rows = mayaRows(keys).map(k => `(${num(k.x)},${num(k.y)},${num(k.in)},${num(k.out)},"${k.it}","${k.ot}",${k.unified})`);
  return [
    'import maya.cmds as c, math',
    `K=[${rows.join(',')}]`,
    `F=${num(fps > 0 ? fps : 24)}`,
    'R={"game":15,"film":24,"pal":25,"ntsc":30,"show":48,"palf":50,"ntscf":60}',
    'u=c.currentUnit(q=1,t=1)',
    'r=R.get(u) or float("".join(ch for ch in u if ch in "0123456789.") or 0)',
    'cv=c.keyframe(q=1,sl=1,n=1) or c.ls(sl=1,type="animCurve")',
    'if not cv: c.error("Quarry: select the time warp curve (or one of its keys) in the Graph Editor first")',
    '# The warp is in the video\'s frames. On a scene at another rate, those are scaled to the scene\'s frames so',
    '# the timing (in seconds) matches what the reviewer saw: a 24 fps video on a 30 fps scene is x1.25.',
    'q=r/F if r and abs(r-F)>0.01 else 1.0',
    'if q!=1.0: print("Quarry: this warp was made on a %g fps video; the scene is %g fps, so its keys are scaled x%g to match" % (F,r,q))',
    'K=[(x*q,y*q,m,n,it,ot,lk) for x,y,m,n,it,ot,lk in K]',
    'c.undoInfo(ock=1)',
    'try:',
    ' for k in cv:',
    '  old=c.keyframe(k,q=1,tc=1) or [0]',
    '  ox=old[0]; oy=(c.keyframe(k,q=1,vc=1) or [0])[0]',
    '  new=[ox+x for x,y,m,n,it,ot,lk in K]',
    '  # New keys first, old ones after: a curve left with no keys is deleted by Maya.',
    '  for x,y,m,n,it,ot,lk in K: c.setKeyframe(k,t=ox+x,v=oy+y)',
    '  for t in old:',
    '   if all(abs(t-s)>1e-3 for s in new): c.cutKey(k,t=(t,t),cl=1)',
    '  # Maya measures tangent angles in its own units: find the scale from a linear segment.',
    '  s=1.0',
    '  for i in range(len(K)-1):',
    '   d=(K[i+1][1]-K[i][1])/((K[i+1][0]-K[i][0]) or 1)',
    '   if abs(d)>1e-6:',
    '    T=(ox+K[i][0],)*2',
    '    c.keyTangent(k,t=T,e=1,lock=0); c.keyTangent(k,t=T,e=1,ott="linear")',
    '    a=c.keyTangent(k,q=1,t=T,oa=1)[0]',
    '    if abs(math.tan(math.radians(a)))>1e-9: s=math.tan(math.radians(a))/d',
    '    break',
    '  g=lambda v:math.degrees(math.atan(v*s))',
    '  for x,y,m,n,it,ot,lk in K:',
    '   T=(ox+x,)*2',
    '   c.keyTangent(k,t=T,e=1,lock=0)',
    '   c.keyTangent(k,t=T,e=1,itt=it,ott=ot)',
    '   if it=="fixed": c.keyTangent(k,t=T,e=1,ia=g(m))',
    '   if ot=="fixed": c.keyTangent(k,t=T,e=1,oa=g(n))',
    '   if lk: c.keyTangent(k,t=T,e=1,lock=1)',
    'finally:',
    ' c.undoInfo(cck=1)',
    'print("Quarry: time warp pasted onto %d curve(s), %d keys (Ctrl+Z undoes it)" % (len(cv),len(K)))',
  ].join('\n');
}

export function timeWarpPy(r) {
  const name = String(r.fileName || r.name).replace(/\n/g, ' ');
  return [
    '# -*- coding: utf-8 -*-',
    `# QUARRY TIME WARP: ${name}`,
    '#',
    '# In Maya: select the time warp curve (or one of its keys) in the Graph',
    '# Editor, then drop this file into the viewport (or run it in the Script',
    '# Editor). Its keys go onto that curve; Ctrl+Z takes them off again.',
    '#',
    '# Made by Quarry Go. Nothing is sent anywhere.',
    '',
    `_CODE = ${JSON.stringify(timeWarpCode(warpOf(r) || identity(r.frameCount), r.fps))}`,
    '', '',
    'def _run():',
    '    exec(_CODE, {"__name__": "quarry_time_warp"})',
    '', '',
    'def onMayaDroppedPythonFile(*args):',
    '    """Maya calls this when the file is dropped into the viewport."""',
    '    _run()',
    '', '',
    'if __name__ == "__main__":',
    '    _run()',
    '',
  ].join('\n');
}

// ---------- Maya image plane: Quarry's maya_drop.py loader with this shot's values and frames
export function pyRepr(s) {
  s = String(s);
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '\\' || ch === q) out += '\\' + ch;
    else if (ch === '\n') out += '\\n'; else if (ch === '\r') out += '\\r'; else if (ch === '\t') out += '\\t';
    else if (c < 32 || c === 127) out += '\\x' + c.toString(16).padStart(2, '0');
    else out += ch;
  }
  return q + out + q;
}
const pyFloat = v => { const n = +v || 24; return Number.isInteger(n) ? n.toFixed(1) : String(n); };

// Everything up to and including "_FRAMES = [\n"; the frames follow as "<base64>",\n lines, then "]\n".
export function mayaDropHead(tpl, { shot, stamp, fps, count = 0 }) {
  const vals = {
    SHOT: pyRepr(shot), STAMP: pyRepr(stamp), FPS: pyFloat(fps), DIGITS: String(Math.max(4, String(count).length)),
    EXT: "'jpg'", STILL: 'False', ALPHA: 'False',
  };
  for (const [k, v] of Object.entries(vals)) {
    const re = new RegExp(`^${k} = .*# QUARRY:${k}$`, 'm');
    if (!re.test(tpl)) throw new Error(`maya_drop.py is missing its ${k} line`);
    tpl = tpl.replace(re, () => `${k} = ${v}  # QUARRY:${k}`);
  }
  const at = tpl.lastIndexOf('_FRAMES = []');
  if (at < 0) throw new Error('maya_drop.py is missing its _FRAMES line');
  return tpl.slice(0, at) + '_FRAMES = [\n';
}
export function fillMayaDrop(tpl, o) {
  return mayaDropHead(tpl, { ...o, count: o.frames.length }) + o.frames.map(f => `"${f}",\n`).join('') + ']\n';
}
export function stamp(d = new Date()) {
  const t = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${t(d.getMonth() + 1)}${t(d.getDate())}_${t(d.getHours())}${t(d.getMinutes())}${t(d.getSeconds())}`;
}
