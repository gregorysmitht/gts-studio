/* Date/time formatting and day-bucket helpers.
   All formatting goes through Intl so it follows the iPad's locale. */

const cache = new Map();
function fmt(opts) {
  const key = JSON.stringify(opts);
  let f = cache.get(key);
  if (!f) { f = new Intl.DateTimeFormat(undefined, opts); cache.set(key, f); }
  return f;
}

export const HOUR = 3600e3;
export const DAY = 86400e3;

export const d = (v) => (v instanceof Date ? v : new Date(v));

/* Every helper below returns a NEW Date. Passing a Date straight to
   setHours/setDate would mutate the caller's object, which is a
   particularly nasty bug when the caller is holding "now". */
const copy = (v) => new Date(d(v).getTime());

/** 12-hour clock honouring the device's locale preference. */
export const clockTime = (v) => fmt({ hour: 'numeric', minute: '2-digit' }).format(d(v));
export const hourLabel = (v) => fmt({ hour: 'numeric' }).format(d(v));
export const weekday    = (v) => fmt({ weekday: 'short' }).format(d(v));
export const weekdayLong= (v) => fmt({ weekday: 'long' }).format(d(v));
export const monthDay   = (v) => fmt({ month: 'short', day: 'numeric' }).format(d(v));
export const monthLong  = (v) => fmt({ month: 'long', year: 'numeric' }).format(d(v));
export const fullDate   = (v) => fmt({ weekday: 'long', month: 'long', day: 'numeric' }).format(d(v));
export const dayNum     = (v) => d(v).getDate();

/** Split the clock so the hub can style hours and minutes differently. */
export function clockParts(v) {
  const parts = fmt({ hour: 'numeric', minute: '2-digit' }).formatToParts(d(v));
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return { hour: get('hour'), minute: get('minute'), period: get('dayPeriod') };
}

export const startOfDay = (v) => { const x = copy(v); x.setHours(0, 0, 0, 0); return x; };
export const endOfDay   = (v) => { const x = copy(v); x.setHours(23, 59, 59, 999); return x; };
export const addDays    = (v, n) => { const x = copy(v); x.setDate(x.getDate() + n); return x; };

export const startOfWeek = (v, weekStartsOn = 0) => {
  const x = startOfDay(v);
  x.setDate(x.getDate() - ((x.getDay() - weekStartsOn + 7) % 7));
  return x;
};

export const sameDay = (a, b) =>
  d(a).toDateString() === d(b).toDateString();

export function isToday(v)     { return sameDay(v, new Date()); }
export function isTomorrow(v)  { return sameDay(v, addDays(new Date(), 1)); }

/** "Today" / "Tomorrow" / "Friday" / "Mar 4" — how a person would say it. */
export function relativeDay(v, now = new Date()) {
  if (sameDay(v, now)) return 'Today';
  if (sameDay(v, addDays(now, 1))) return 'Tomorrow';
  if (sameDay(v, addDays(now, -1))) return 'Yesterday';
  const diff = Math.round((startOfDay(v) - startOfDay(now)) / DAY);
  if (diff > 1 && diff < 7) return weekdayLong(v);
  return monthDay(v);
}

/** "in 25m" / "in 3h" / "now" / "2h ago" — for the next-event countdown. */
export function relativeTime(v, now = Date.now()) {
  const delta = d(v).getTime() - now;
  const mins = Math.round(delta / 60000);
  if (Math.abs(mins) < 1) return 'now';
  const ahead = mins > 0;
  const m = Math.abs(mins);
  let text;
  if (m < 60) text = `${m}m`;
  else if (m < 60 * 24) {
    const hrs = Math.floor(m / 60);
    const rem = m % 60;
    text = rem && hrs < 4 ? `${hrs}h ${rem}m` : `${hrs}h`;
  } else text = `${Math.round(m / 1440)}d`;
  return ahead ? `in ${text}` : `${text} ago`;
}

/** Compact duration for event detail: "1 hr 30 min", "All day". */
export function durationText(start, end, allDay) {
  if (allDay) return 'All day';
  const mins = Math.round((d(end) - d(start)) / 60000);
  if (mins <= 0) return '';
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h && m) return `${h} hr ${m} min`;
  if (h) return `${h} hr${h > 1 ? 's' : ''}`;
  return `${m} min`;
}

/** Range label used on event rows and the detail sheet. */
export function timeRange(start, end, allDay) {
  if (allDay) return 'All day';
  const a = clockTime(start);
  if (!end) return a;
  return `${a} – ${clockTime(end)}`;
}
