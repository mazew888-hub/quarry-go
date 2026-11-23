// Google sign-in and a small Google Drive client, for Sort and Library only (Review never uses it).
// Sign-in goes to Google's own page and comes back here with a short-lived token (about an hour);
// when it runs out, the next Drive call renews it the same way without asking (prompt=none).

export const CLIENT_ID = 'NOT_SET';   // the Web client ID from the Vista Google project
const SCOPE = 'https://www.googleapis.com/auth/drive email';
const API = 'https://www.googleapis.com';
const FOLDER = 'application/vnd.google-apps.folder';

export class DriveError extends Error {
  constructor(message, { auth = false } = {}) { super(message); this.auth = auth; }
}

const ls = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: k => { try { localStorage.removeItem(k); } catch {} },
};
const clientId = () => ls.get('qg_client_id') || CLIENT_ID;
export const configured = () => clientId() !== 'NOT_SET';
const here = () => location.origin + location.pathname;

export function signIn({ silent = false } = {}) {
  if (!configured()) throw new DriveError("Google sign-in isn't set up yet.");
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  sessionStorage.setItem('qg_state', state);
  sessionStorage.setItem('qg_return', location.hash || '#/');
  const p = new URLSearchParams({
    client_id: clientId(), redirect_uri: here(), response_type: 'token', scope: SCOPE,
    include_granted_scopes: 'true', state,
  });
  if (silent) { p.set('prompt', 'none'); const e = ls.get('qg_email'); if (e) p.set('login_hint', e); }
  location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + p);
}

// Called once at start-up: picks up Google's answer from the address and puts the page back where it was.
export function handleRedirect() {
  const h = location.hash;
  if (!/(access_token|error)=/.test(h) || !/state=/.test(h)) return false;
  const q = new URLSearchParams(h.slice(1));
  const ok = q.get('state') === sessionStorage.getItem('qg_state');
  if (ok && q.get('access_token')) {
    ls.set('qg_token', q.get('access_token'));
    ls.set('qg_token_exp', String(Date.now() + (+q.get('expires_in') || 3600) * 1000));
    ls.del('qg_needs_connect');
  } else if (ok) ls.set('qg_needs_connect', '1');  // a quiet renew didn't work: ask again
  const back = sessionStorage.getItem('qg_return') || '#/';
  sessionStorage.removeItem('qg_state'); sessionStorage.removeItem('qg_return');
  history.replaceState(null, '', here() + back);
  return true;
}

export function signOut() { for (const k of ['qg_token', 'qg_token_exp', 'qg_email', 'qg_needs_connect']) ls.del(k); }
const token = () => (ls.get('qg_token') && +ls.get('qg_token_exp') > Date.now() + 60000) ? ls.get('qg_token') : null;
export const ready = () => !!token();
export const connected = () => !!ls.get('qg_email') && !ls.get('qg_needs_connect');

async function api(path, opts = {}, retry = false) {
  const t = token();
  if (!t) return renew();
  let r;
  try { r = await fetch(API + path, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + t } }); }
  catch { throw new DriveError("Can't reach Google Drive. Check the connection."); }
  if (r.status === 401 && !retry) { ls.del('qg_token'); return renew(); }
  if (!r.ok) throw new DriveError(`Google Drive said no (${r.status}).`, { auth: r.status === 401 || r.status === 403 });
  return r;
}
let renewing = false;
function renew() {
  // Without a known account there's nothing to renew quietly: the person has to connect.
  if (!ls.get('qg_email') || ls.get('qg_needs_connect') || !configured()) throw new DriveError('Connect Google Drive first.', { auth: true });
  // Several calls can fail at once: only the first one goes to Google, or the answers' states won't match.
  if (!renewing) { renewing = true; signIn({ silent: true }); }
  return new Promise(() => {}); // the page is leaving for Google
}

export async function account() {
  const e = ls.get('qg_email');
  if (e) return { email: e };
  if (!token()) return null;
  const j = await (await api('/drive/v3/about?fields=user')).json();
  ls.set('qg_email', j.user.emailAddress);
  return { email: j.user.emailAddress };
}

const esc = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
async function list(q, fields = 'files(id,name,mimeType,modifiedTime),nextPageToken') {
  const out = []; let page = '';
  do {
    const p = new URLSearchParams({ q, fields, pageSize: '1000', spaces: 'drive' });
    if (page) p.set('pageToken', page);
    const j = await (await api('/drive/v3/files?' + p)).json();
    out.push(...j.files); page = j.nextPageToken || '';
  } while (page);
  return out;
}
const child = async (parent, name, folder) =>
  (await list(`name = '${esc(name)}' and '${parent}' in parents and trashed = false${folder ? ` and mimeType = '${FOLDER}'` : ''}`))[0] || null;

export async function phoneFolder() {
  const roots = await list(`name = 'Quarry Sync' and mimeType = '${FOLDER}' and trashed = false`);
  for (const r of roots) {
    const phone = await child(r.id, 'phone', true);
    if (!phone) continue;
    const [actions, applied, thumbs] = await Promise.all(['actions', 'applied', 'thumbs'].map(n => child(phone.id, n, true)));
    return { id: phone.id, actionsId: actions ? actions.id : await ensureFolder(phone.id, 'actions'),
             appliedId: applied && applied.id, thumbsId: thumbs && thumbs.id };
  }
  return null;
}

export async function listNames(folderId) {
  const m = new Map();
  for (const f of await list(`'${folderId}' in parents and trashed = false`, 'files(id,name),nextPageToken')) m.set(f.name, f.id);
  return m;
}
export async function readJson(folderId, name) {
  const f = await child(folderId, name, false);
  if (!f) return null;
  return (await api(`/drive/v3/files/${f.id}?alt=media`)).json();
}
export async function readBlob(fileId) { return (await api(`/drive/v3/files/${fileId}?alt=media`)).blob(); }
export async function ensureFolder(parentId, name) {
  const f = await child(parentId, name, true);
  if (f) return f.id;
  const r = await api('/drive/v3/files', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }) });
  return (await r.json()).id;
}
export async function writeJson(folderId, name, obj) {
  const b = 'qg' + Math.random().toString(36).slice(2);
  const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folderId] })}\r\n` +
               `--${b}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(obj)}\r\n--${b}--`;
  await api('/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body });
}
