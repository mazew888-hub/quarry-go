// What Sort and Library show: Quarry's last snapshot with the phone's own actions laid over it,
// so everything done on the phone shows straight away. Actions Quarry has already carried out
// (n <= applied.last) are in the snapshot itself, so they're skipped here; failed ones are listed.

const byLower = (a, b) => a.toLowerCase().localeCompare(b.toLowerCase());
const base = key => key.slice(key.lastIndexOf('/') + 1);

export function view(snapshot, actions, applied) {
  const s = snapshot || {};
  const last = (applied && applied.last) || 0;
  const failedN = new Map(((applied && applied.failed) || []).map(f => [f.n, f]));
  const items = ((s.library && s.library.items) || []).map(it => ({ ...it, tags: [...(it.tags || [])] }));
  const byKey = new Map(items.map(it => [it.key, it]));
  const posts = (s.xqueue && s.xqueue.posts) || [];
  const removed = new Set(), restored = [];
  const failed = [];
  let pending = 0;

  for (const a of [...actions].sort((x, y) => x.n - y.n)) {
    if (a.n <= last) {
      const f = failedN.get(a.n);
      if (f) failed.push({ n: a.n, op: a.op, reason: f.reason, action: a });
      continue;
    }
    pending++;
    if (a.op === 'keep' || a.op === 'skip') removed.add(a.id);
    else if (a.op === 'undo') {
      removed.delete(a.id);
      if (!posts.some(p => p.id === a.id) && a.post && !restored.some(p => p.id === a.id)) restored.unshift(a.post);
    } else if (a.op === 'tag') {
      const it = byKey.get(a.key); if (!it) continue;
      const drop = new Set((a.remove || []).map(t => t.toLowerCase()));
      const tags = it.tags.filter(t => !drop.has(t.toLowerCase()));
      for (const t of a.add || []) if (!tags.some(x => x.toLowerCase() === t.toLowerCase())) tags.push(t);
      it.tags = tags.sort(byLower);
    } else if (a.op === 'move') {
      const it = byKey.get(a.key); if (!it) continue;
      byKey.delete(it.key);
      it.folder = a.folder; it.key = (a.folder ? a.folder + '/' : '') + base(it.key);
      byKey.set(it.key, it);
    }
  }

  const queue = [...restored.filter(p => !removed.has(p.id)), ...posts.filter(p => !removed.has(p.id))];
  const counts = new Map();
  for (const it of items) for (const t of it.tags) counts.set(t, (counts.get(t) || 0) + 1);
  const tags = [...counts].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n || byLower(a.tag, b.tag));
  return { items, folders: (s.folders && s.folders.folders) || [], tags, queue, pending, failed, status: s.status || null };
}
