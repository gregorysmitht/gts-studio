/* iCalendar (RFC 5545) parsing.

   Enough of the spec to handle what Google, iCloud and Outlook actually
   emit for a family calendar: folded lines, escaped text, all-day
   events, TZID-qualified times, recurrence rules, exception dates, and
   per-instance overrides via RECURRENCE-ID.

   Timezones use the browser's own IANA database through Intl rather
   than parsing VTIMEZONE blocks — same answer, a fraction of the code.
*/

/* ── Lexing ───────────────────────────────────────────────── */

/** Undo RFC 5545 line folding: a leading space or tab continues the previous line. */
function unfold(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '');
}

/** Split "DTSTART;TZID=America/New_York:20260811T140000" into its parts. */
function parseLine(line) {
  const colon = findUnquoted(line, ':');
  if (colon === -1) return null;

  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);

  const parts = splitUnquoted(head, ';');
  const name = parts[0].toUpperCase();
  const params = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    if (eq === -1) continue;
    params[parts[i].slice(0, eq).toUpperCase()] = stripQuotes(parts[i].slice(eq + 1));
  }
  return { name, params, value };
}

function findUnquoted(text, char) {
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') quoted = !quoted;
    else if (text[i] === char && !quoted) return i;
  }
  return -1;
}

function splitUnquoted(text, char) {
  const out = [];
  let start = 0, quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') quoted = !quoted;
    else if (text[i] === char && !quoted) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out;
}

const stripQuotes = (s) => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s);

/** Unescape a TEXT value. */
const unescapeText = (v) =>
  String(v)
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');

/* ── Time ─────────────────────────────────────────────────── */

const tzCache = new Map();
function tzFormatter(tz) {
  let f = tzCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    tzCache.set(tz, f);
  }
  return f;
}

/** Milliseconds a zone is ahead of UTC at a given instant. */
function zoneOffset(tz, date) {
  try {
    const parts = tzFormatter(tz).formatToParts(date);
    const p = {};
    for (const part of parts) p[part.type] = part.value;
    const asUtc = Date.UTC(
      Number(p.year), Number(p.month) - 1, Number(p.day),
      Number(p.hour) % 24, Number(p.minute), Number(p.second)
    );
    return asUtc - date.getTime();
  } catch {
    return 0;   // unknown TZID → treat as floating local time
  }
}

/** Wall-clock fields in a named zone → a real instant. */
function fromZone(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let result = guess - zoneOffset(tz, new Date(guess));
  // One correction pass resolves times that land near a DST transition.
  const refined = guess - zoneOffset(tz, new Date(result));
  if (refined !== result) result = refined;
  return new Date(result);
}

/**
 * Parse a DATE or DATE-TIME value.
 * @returns {{date:Date, allDay:boolean}}
 */
export function parseDateValue(value, params = {}) {
  const raw = String(value).trim();

  // All-day: 20260811
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(raw)) {
    const y = +raw.slice(0, 4), mo = +raw.slice(4, 6), d = +raw.slice(6, 8);
    return { date: new Date(y, mo - 1, d), allDay: true };
  }

  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(raw);
  if (!m) {
    const fallback = new Date(raw);
    return { date: Number.isNaN(+fallback) ? null : fallback, allDay: false };
  }

  const [, y, mo, d, h, mi, s, utc] = m.map((v, i) => (i === 7 ? v : Number(v)));

  if (utc) return { date: new Date(Date.UTC(y, mo - 1, d, h, mi, s)), allDay: false };
  if (params.TZID) return { date: fromZone(y, mo, d, h, mi, s, params.TZID), allDay: false };
  return { date: new Date(y, mo - 1, d, h, mi, s), allDay: false };   // floating
}

/** DURATION values like "PT1H30M" or "P2D". */
function parseDuration(value) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(value).trim());
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  const [, , w, d, h, mi, s] = m;
  const ms = ((Number(w || 0) * 7 + Number(d || 0)) * 86400 +
              Number(h || 0) * 3600 + Number(mi || 0) * 60 + Number(s || 0)) * 1000;
  return sign * ms;
}

/* ── Recurrence ───────────────────────────────────────────── */

const WEEKDAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseRRule(value) {
  const rule = {};
  for (const chunk of String(value).split(';')) {
    const [k, v] = chunk.split('=');
    if (!k || v == null) continue;
    const key = k.toUpperCase();
    switch (key) {
      case 'FREQ': rule.freq = v.toUpperCase(); break;
      case 'INTERVAL': rule.interval = Math.max(1, parseInt(v, 10) || 1); break;
      case 'COUNT': rule.count = parseInt(v, 10); break;
      case 'UNTIL': rule.until = parseDateValue(v).date; break;
      case 'WKST': rule.wkst = WEEKDAYS[v.toUpperCase()] ?? 0; break;
      case 'BYDAY':
        rule.byday = v.split(',').map((token) => {
          const m = /^([+-]?\d+)?([A-Z]{2})$/.exec(token.trim().toUpperCase());
          return m ? { nth: m[1] ? parseInt(m[1], 10) : 0, day: WEEKDAYS[m[2]] } : null;
        }).filter((x) => x && x.day != null);
        break;
      case 'BYMONTHDAY': rule.bymonthday = v.split(',').map(Number); break;
      case 'BYMONTH': rule.bymonth = v.split(',').map(Number); break;
      case 'BYSETPOS': rule.bysetpos = v.split(',').map(Number); break;
      default: break;
    }
  }
  rule.interval ||= 1;
  return rule;
}

/** All dates in `year`/`month` (0-based) matching an nth-weekday spec. */
function nthWeekdaysOfMonth(year, month, day, nth) {
  const out = [];
  const last = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= last; d++) {
    const date = new Date(year, month, d);
    if (date.getDay() === day) out.push(date);
  }
  if (!nth) return out;
  return nth > 0 ? [out[nth - 1]].filter(Boolean) : [out[out.length + nth]].filter(Boolean);
}

/**
 * Expand a recurrence rule into concrete start dates inside a window.
 * Bounded by COUNT/UNTIL, the window, and a hard iteration cap so a
 * malformed feed can never lock the display.
 */
function expandRule(start, rule, windowStart, windowEnd, { cap = 2000 } = {}) {
  const out = [];
  const freq = rule.freq;
  if (!freq) return [start];

  const h = start.getHours(), mi = start.getMinutes(), s = start.getSeconds();
  const withTime = (date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, mi, s);

  const limit = rule.until ? Math.min(+rule.until, +windowEnd) : +windowEnd;
  let emitted = 0;
  let iterations = 0;
  let cursor = new Date(start);

  const push = (date) => {
    if (!date || +date < +start) return false;
    if (+date > limit) return false;
    if (rule.count != null && emitted >= rule.count) return false;
    emitted++;
    if (+date >= +windowStart) out.push(new Date(date));
    return true;
  };

  while (iterations++ < cap) {
    if (+cursor > limit && !(rule.count != null && emitted < rule.count)) break;
    if (rule.count != null && emitted >= rule.count) break;

    if (freq === 'DAILY') {
      if (!push(withTime(cursor))) { if (+cursor > limit) break; }
      cursor.setDate(cursor.getDate() + rule.interval);

    } else if (freq === 'WEEKLY') {
      const days = rule.byday?.length ? rule.byday.map((b) => b.day) : [start.getDay()];
      const weekStart = new Date(cursor);
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() - (rule.wkst ?? 0) + 7) % 7));
      for (const day of [...days].sort((a, b) => a - b)) {
        const date = new Date(weekStart);
        date.setDate(date.getDate() + ((day - (rule.wkst ?? 0) + 7) % 7));
        push(withTime(date));
      }
      cursor = new Date(weekStart);
      cursor.setDate(cursor.getDate() + 7 * rule.interval);

    } else if (freq === 'MONTHLY') {
      const y = cursor.getFullYear(), m = cursor.getMonth();
      let candidates = [];
      if (rule.byday?.length) {
        for (const { day, nth } of rule.byday) candidates.push(...nthWeekdaysOfMonth(y, m, day, nth));
      } else if (rule.bymonthday?.length) {
        const lastDay = new Date(y, m + 1, 0).getDate();
        for (const md of rule.bymonthday) {
          const d = md > 0 ? md : lastDay + md + 1;
          if (d >= 1 && d <= lastDay) candidates.push(new Date(y, m, d));
        }
      } else {
        candidates.push(new Date(y, m, start.getDate()));
      }
      candidates = applySetPos(candidates, rule).sort((a, b) => a - b);
      for (const date of candidates) push(withTime(date));
      cursor = new Date(y, m + rule.interval, 1);

    } else if (freq === 'YEARLY') {
      const y = cursor.getFullYear();
      const months = rule.bymonth?.length ? rule.bymonth.map((m) => m - 1) : [start.getMonth()];
      let candidates = [];
      for (const m of months) {
        if (rule.byday?.length) {
          for (const { day, nth } of rule.byday) candidates.push(...nthWeekdaysOfMonth(y, m, day, nth));
        } else if (rule.bymonthday?.length) {
          for (const md of rule.bymonthday) candidates.push(new Date(y, m, md));
        } else {
          candidates.push(new Date(y, m, start.getDate()));
        }
      }
      candidates = applySetPos(candidates, rule).sort((a, b) => a - b);
      for (const date of candidates) push(withTime(date));
      cursor = new Date(y + rule.interval, 0, 1);

    } else {
      return [start];   // HOURLY/MINUTELY/SECONDLY aren't worth supporting here
    }

    if (out.length > 800) break;
  }

  return out;
}

function applySetPos(candidates, rule) {
  if (!rule.bysetpos?.length || !candidates.length) return candidates;
  const sorted = [...candidates].sort((a, b) => a - b);
  return rule.bysetpos
    .map((pos) => (pos > 0 ? sorted[pos - 1] : sorted[sorted.length + pos]))
    .filter(Boolean);
}

/* ── Public API ───────────────────────────────────────────── */

/**
 * Parse an ICS document into events inside [windowStart, windowEnd].
 *
 * @param {string} text raw .ics contents
 * @param {object} opts { windowStart, windowEnd, calendar }
 * @returns {{events:Array, name:string|null}}
 */
export function parseIcs(text, { windowStart, windowEnd, calendar = {} } = {}) {
  const from = windowStart ?? new Date(Date.now() - 30 * 86400e3);
  const to = windowEnd ?? new Date(Date.now() + 400 * 86400e3);

  const lines = unfold(String(text)).split('\n');
  const events = [];
  const overrides = new Map();   // `${uid}|${recurrenceId}` → event
  let calendarName = null;
  let current = null;
  let depth = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('BEGIN:')) {
      const kind = line.slice(6).toUpperCase();
      if (kind === 'VEVENT') { current = { raw: {} }; depth = 0; }
      else if (current) depth++;   // nested VALARM etc.
      continue;
    }

    if (line.startsWith('END:')) {
      const kind = line.slice(4).toUpperCase();
      if (kind === 'VEVENT' && current) {
        finishEvent(current, events, overrides, { from, to, calendar });
        current = null;
      } else if (current && depth > 0) depth--;
      continue;
    }

    const parsed = parseLine(line);
    if (!parsed) continue;

    if (!current) {
      if (parsed.name === 'X-WR-CALNAME') calendarName = unescapeText(parsed.value);
      continue;
    }
    if (depth > 0) continue;   // ignore alarm sub-components

    // EXDATE and RDATE can repeat; everything else is last-wins.
    if (parsed.name === 'EXDATE' || parsed.name === 'RDATE') {
      (current.raw[parsed.name] ||= []).push(parsed);
    } else {
      current.raw[parsed.name] = parsed;
    }
  }

  // Apply RECURRENCE-ID overrides onto expanded instances.
  const result = [];
  for (const event of events) {
    const key = `${event.uid}|${+event.start}`;
    const override = overrides.get(key);
    if (override) {
      if (override.cancelled) continue;
      result.push({ ...event, ...override.patch });
    } else {
      result.push(event);
    }
  }

  return { events: result, name: calendarName };
}

function finishEvent(node, events, overrides, { from, to, calendar }) {
  const raw = node.raw;
  const get = (name) => raw[name]?.value;
  const text = (name) => (raw[name] ? unescapeText(raw[name].value) : '');

  const uid = get('UID') || `nouid-${Math.random().toString(36).slice(2)}`;
  const status = (get('STATUS') || '').toUpperCase();
  const transparent = (get('TRANSP') || '').toUpperCase() === 'TRANSPARENT';

  if (!raw.DTSTART) return;
  const { date: start, allDay } = parseDateValue(raw.DTSTART.value, raw.DTSTART.params);
  if (!start) return;

  let end;
  if (raw.DTEND) {
    end = parseDateValue(raw.DTEND.value, raw.DTEND.params).date;
  } else if (raw.DURATION) {
    end = new Date(+start + parseDuration(raw.DURATION.value));
  } else {
    end = new Date(+start + (allDay ? 86400e3 : 3600e3));
  }

  const base = {
    uid,
    title: text('SUMMARY') || '(No title)',
    location: text('LOCATION'),
    description: text('DESCRIPTION'),
    url: get('URL') || '',
    organizer: (get('ORGANIZER') || '').replace(/^mailto:/i, ''),
    attendees: (Array.isArray(raw.ATTENDEE) ? raw.ATTENDEE : raw.ATTENDEE ? [raw.ATTENDEE] : [])
      .map((a) => (a.params?.CN || a.value || '').replace(/^mailto:/i, ''))
      .filter(Boolean),
    allDay,
    transparent,
    calendarId: calendar.id ?? null,
    calendarName: calendar.name ?? null,
    color: calendar.color ?? null,
  };

  // A RECURRENCE-ID entry modifies (or cancels) one instance of a series.
  if (raw['RECURRENCE-ID']) {
    const target = parseDateValue(raw['RECURRENCE-ID'].value, raw['RECURRENCE-ID'].params).date;
    if (target) {
      overrides.set(`${uid}|${+target}`, {
        cancelled: status === 'CANCELLED',
        patch: { ...base, start, end, id: `${uid}-${+start}` },
      });
    }
    return;
  }

  if (status === 'CANCELLED') return;

  const duration = Math.max(0, +end - +start);

  if (!raw.RRULE) {
    if (+end < +from || +start > +to) return;
    events.push({ ...base, id: `${uid}-${+start}`, start, end });
    return;
  }

  const rule = parseRRule(raw.RRULE.value);
  const excluded = new Set();
  for (const ex of raw.EXDATE ?? []) {
    for (const value of String(ex.value).split(',')) {
      const parsedEx = parseDateValue(value, ex.params).date;
      if (parsedEx) excluded.add(+parsedEx);
    }
  }

  const starts = expandRule(start, rule, from, to);

  // RDATE adds one-off extra occurrences.
  for (const rd of raw.RDATE ?? []) {
    for (const value of String(rd.value).split(',')) {
      const extra = parseDateValue(value, rd.params).date;
      if (extra && +extra >= +from && +extra <= +to) starts.push(extra);
    }
  }

  for (const occurrence of starts) {
    if (excluded.has(+occurrence)) continue;
    events.push({
      ...base,
      id: `${uid}-${+occurrence}`,
      start: occurrence,
      end: new Date(+occurrence + duration),
      recurring: true,
    });
  }
}
