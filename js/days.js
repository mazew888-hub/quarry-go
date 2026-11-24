// Reviews are days: every video belongs to one (YYYY-MM-DD, the phone's own date). History groups them
// the way Quarry's review panel does: this week's days first, then older days under their month.
import { hasNotes } from './handback.js';

const two = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const parse = day => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d); };
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// A timestamp's date, or a video's day (videos from before days take the day they were made).
export function dayOf(x) {
  if (typeof x === 'number') return ymd(new Date(x));
  return x.day || ymd(new Date(x.created || 0));
}
export const today = (now = Date.now()) => dayOf(now);
export const weekOfMonth = day => Math.ceil(parse(day).getDate() / 7);
export const dayTitle = day => { const d = parse(day); return `${WD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; };

function describe(day, videos, now) {
  const d = parse(day);
  const vids = [...videos].sort((a, b) => (a.created || 0) - (b.created || 0));
  return {
    day, videos: vids, count: vids.length, withNotes: vids.filter(hasNotes).length, today: day === today(now),
    weekday: WD[d.getDay()], date: `${d.getDate()} ${MON[d.getMonth()]}`, week: weekOfMonth(day), title: dayTitle(day),
  };
}

// {week: [day…] (Monday to now, newest first), months: [{label, days: [day…]}] (newest first)}
export function groupHistory(videos, now = Date.now()) {
  const by = new Map();
  for (const v of videos) { const k = dayOf(v); if (!by.has(k)) by.set(k, []); by.get(k).push(v); }
  const n = new Date(now), monday = ymd(new Date(n.getFullYear(), n.getMonth(), n.getDate() - (n.getDay() + 6) % 7));
  const days = [...by.keys()].sort().reverse().map(k => describe(k, by.get(k), now));
  const week = days.filter(d => d.day >= monday), months = [];
  for (const d of days.filter(x => x.day < monday)) {
    const p = parse(d.day), label = `${MONTH[p.getMonth()]} ${p.getFullYear()}`;
    if (!months.length || months[months.length - 1].label !== label) months.push({ label, days: [] });
    months[months.length - 1].days.push(d);
  }
  return { week, months };
}

export function dayInfo(videos, day, now = Date.now()) { return describe(day, videos.filter(v => dayOf(v) === day), now); }
