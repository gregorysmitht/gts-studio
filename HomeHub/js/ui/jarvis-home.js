/* The JARVIS home — a Stark-style heads-up display.
 *
 * Nothing here listens; everything here presents. The wall becomes the
 * lab's glass: an arc-reactor core carrying the clock, HUD modules for
 * the schedule, the environment and the audio system, a 24-hour ruler
 * along the bottom, and Jarvis himself — a line of address typed out
 * character by character and computed from real state (the next
 * event, an active warning, the sky, the music), never a canned
 * script. One cyan, hairlines and ticks; gold reserved for "now"; and
 * the alert family that re-tints the surface when the sky turns.
 *
 * A SWITCH, like DEPTH: Settings → Display flips `state.homeStyle`,
 * and the gear in the bottom-right corner is the door from here. */

import { h, fill, $ } from '../core/dom.js';
import { state, on } from '../core/store.js';
import { live } from '../data/hub.js';
import { eventsOnDay } from '../data/calendar.js';
import { addDays, clockParts, clockTime, weekday } from '../core/time.js';
import { temp, speed, windDir } from '../core/format.js';
import { CONDITION_LABEL } from '../data/conditions.js';
import { worstAlert } from './weather-widget.js';
import { player, hasTrack, livePosition, formatTime } from '../data/music.js';
import { openWeatherPanel } from './weather-panel.js';
import { openCalendarPanel } from './calendar-panel.js';
import { openMusicPanel } from './music-panel.js';
import { openEventModal } from './event-modal.js';
import { openSettings } from './settings.js';
import { icon } from './icons.js';

let root = null;
let model = null;          // the last computed snapshot, for ticks and taps
let lastSignature = '';
let lastMinute = -1;

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function mountJarvisHome() {
  root = h('div', { id: 'jarvis-root', class: 'jv-boot' },
    h('div.jv-ambience'),
    h('div.jv-scan'),
    ...['tl', 'tr', 'bl', 'br'].map((c) => h(`span.jv-brace.${c}`)),
    h('div.jv-edge.top'),
    h('div.jv-edge.bottom'),

    h('button.jv-ident.jv-in', {
      style: { '--d': '650ms' },
      onclick: () => openCalendarPanel({}),
      'aria-label': 'Open the calendar',
    },
      h('div.jv-wordmark', h('span.jv-reactor-dot'), 'J.A.R.V.I.S.'),
      h('div.jv-status'),
    ),
    h('div.jv-uplink.jv-in', { style: { '--d': '750ms' } }),

    h('button.jv-core', {
      onclick: () => speakNext(),
      'aria-label': 'Ask Jarvis for the next update',
    },
      h('div.jv-rings', tickRing(), dashRing(), bracketRing()),
      h('div.jv-core-glow'),
      h('div.jv-clock.jv-in', { style: { '--d': '500ms' } },
        h('div.jv-time.num'),
        h('div.jv-sec'),
      ),
    ),
    h('div.jv-voice.jv-in', { style: { '--d': '900ms' } },
      h('span.jv-prompt', '❯'),
      h('span.jv-said'),
      h('span.jv-caret'),
    ),

    h('div.jv-module.jv-schedule.jv-in', {
      style: { '--d': '800ms' },
      role: 'button',
      tabindex: 0,
      onclick: (e) => { if (!e.target.closest('button')) openCalendarPanel({}); },
    }),
    h('div.jv-module.jv-env.jv-in', {
      style: { '--d': '950ms' },
      role: 'button',
      tabindex: 0,
      onclick: (e) => openWeatherPanel({ tab: e.target.closest('.jv-alert-band') ? 'alerts' : 'today' }),
    }),

    h('button.jv-audio.jv-in', {
      style: { '--d': '1100ms' },
      onclick: () => openMusicPanel({}),
      'aria-label': 'Open the music player',
    }),
    h('button.jv-ruler.jv-in', {
      style: { '--d': '1050ms' },
      onclick: () => openCalendarPanel({}),
      'aria-label': 'Open the calendar',
    }),
    /* The way back to another home lives on this screen, quietly. */
    h('button.jv-gear.jv-in', {
      style: { '--d': '1200ms' },
      onclick: () => openSettings('display'),
      'aria-label': 'Settings',
    }, icon('settings', { size: 16 })),
  );
  $('#hub').appendChild(root);

  paintAll();
  on('weather', paintAll);
  on('calendar', paintAll);
  on('music', paintAll);
  setInterval(tick, 1000);

  /* The HUD assembles over ~2s; Jarvis speaks once the core has settled. */
  const instant = reduced();
  setTimeout(() => root.classList.remove('jv-boot'), instant ? 0 : 2800);
  setTimeout(() => { booted = true; speak(greeting()); }, instant ? 0 : GREET_MS);
}

/* ── The core's rings (SVG, spun by CSS) ─────────────────── */

const pt = (r, deg) => {
  const a = (deg * Math.PI) / 180;
  return `${(200 + r * Math.cos(a)).toFixed(1)} ${(200 + r * Math.sin(a)).toFixed(1)}`;
};

/** 72 ticks, every sixth one longer and brighter — the outer dial. */
function tickRing() {
  const ticks = [];
  for (let i = 0; i < 72; i++) {
    const major = i % 6 === 0;
    const [x0, y0] = pt(199, i * 5).split(' ');
    const [x1, y1] = pt(major ? 186 : 193, i * 5).split(' ');
    ticks.push(`<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke-width="${major ? 1.6 : 1}"${major ? ' class="major"' : ''}/>`);
  }
  return h('div.jv-ring.r1', { html: `<svg viewBox="0 0 400 400">${ticks.join('')}</svg>` });
}

/** Three long dashes and a fine dotted track, spun the other way. */
function dashRing() {
  return h('div.jv-ring.r2', {
    html: `<svg viewBox="0 0 400 400">
      <circle cx="200" cy="200" r="172" stroke-dasharray="260 100.3" stroke-width="1.5"/>
      <circle cx="200" cy="200" r="164" stroke-dasharray="1.5 9" stroke-width="1" opacity=".55"/>
    </svg>`,
  });
}

/** A thin inner circle with four heavy brackets — the reactor's mount. */
function bracketRing() {
  const arc = (deg) =>
    `<path class="bracket" d="M${pt(146, deg - 14)} A146 146 0 0 1 ${pt(146, deg + 14)}" stroke-width="3"/>`;
  return h('div.jv-ring.r3', {
    html: `<svg viewBox="0 0 400 400">
      <circle cx="200" cy="200" r="146" stroke-width="1" opacity=".35"/>
      <circle cx="200" cy="200" r="124" stroke-width=".75" opacity=".25"/>
      ${[0, 90, 180, 270].map(arc).join('')}
    </svg>`,
  });
}

/* ── What the HUD knows ───────────────────────────────────── */

const dedupe = (events) => {
  const seen = new Set();
  return events.filter((ev) => {
    const key = `${ev.title}|${+ev.start}|${+ev.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

function computeModel() {
  const now = Date.now();
  const events = live.calendar?.events ?? [];
  const today = dedupe(eventsOnDay(events, new Date())).filter((ev) => !ev.allDay);
  const remaining = today.filter((ev) => +ev.end > now);
  const tomorrow = dedupe(eventsOnDay(events, addDays(new Date(), 1))).filter((ev) => !ev.allDay);
  const wx = live.weather;
  const alert = worstAlert(wx ?? {});
  const level = !alert ? null : /warning/i.test(alert.event ?? '') ? 'warning' : 'watch';
  return {
    today, remaining, tomorrow,
    next: remaining.find((ev) => +ev.start > now) ?? null,
    running: remaining.find((ev) => +ev.start <= now) ?? null,
    wx, alert, level,
  };
}

const key = (ev) => (ev ? `${ev.title}|${+ev.start}` : '');

/* ── Painting ─────────────────────────────────────────────── */

function paintAll() {
  if (!root) return;
  model = computeModel();

  /* Module contents repaint only when what they SAY could have changed;
     ticking values (clock, T−, −m:ss, the ruler caret) are patched by
     tick() alone. */
  const wx = model.wx;
  const signature = [
    model.remaining.map(key).join(','),
    model.tomorrow.slice(0, 3).map(key).join(','),
    key(model.next), key(model.running),
    model.alert ? `${model.alert.id ?? model.alert.event}|${model.level}` : '',
    wx?.updated ?? '', wx?.current?.temp ?? '', wx?.current?.condition ?? '',
    player.track?.id ?? '', player.state,
  ].join('§');

  if (signature !== lastSignature) {
    lastSignature = signature;
    paintSchedule();
    paintEnvironment();
    paintAudio();
    paintRuler();
    if (model.level) root.dataset.level = model.level;
    else delete root.dataset.level;
    root.classList.toggle('alerted', !!model.level);
    refreshLines();
  }
  paintHud();
}

const joinDots = (parts) => parts.flatMap((p, i) => (i ? [' · ', p] : [p]));

function paintHud() {
  const now = new Date();
  paintClock(now);

  const date = `${weekday(now)} · ${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
  const bits = [date];
  if (model.level === 'warning') bits.push(h('span.alert', '⚠ Warning active'));
  else if (model.level) bits.push(h('span.alert', `${alertKind(model.alert)} posted`));
  else bits.push('Systems nominal');
  bits.push(model.remaining.length ? `${model.remaining.length} ahead today` : 'Schedule clear');
  fill($('.jv-status', root), ...joinDots(bits));

  /* Telemetry a lab would show: where we are, the sun, and which feed
     the sky is coming from — named honestly, including the simulation. */
  const p = state.place ?? {};
  const loc = p.lat != null
    ? `${Math.abs(p.lat).toFixed(4)}°${p.lat >= 0 ? 'N' : 'S'} ${Math.abs(p.lon).toFixed(4)}°${p.lon >= 0 ? 'E' : 'W'}`
    : '—';
  const day0 = model.wx?.daily?.[0];
  const sun = day0?.sunrise ? `${clockTime(day0.sunrise)} ▸ ${clockTime(day0.sunset)}` : '—';
  const source = live.demo?.weather ? 'simulation' : (model.wx?.source ?? 'standby');
  const age = model.wx?.updated ? Math.max(0, Math.round((Date.now() - model.wx.updated) / 60e3)) : null;
  fill($('.jv-uplink', root),
    h('div', 'Loc', h('b', loc)),
    h('div', 'Sun', h('b', sun)),
    h('div', 'Uplink', h('b', age == null ? source : `${source} · T+${age}m`)),
  );
}

function paintClock(now) {
  const { hour, minute, period } = clockParts(now);
  const timeEl = $('.jv-time', root);
  const text = `${hour}:${minute}`;
  if (timeEl.textContent !== text) timeEl.textContent = text;
  const ss = String(now.getSeconds()).padStart(2, '0');
  $('.jv-sec', root).textContent = `${period ? `${period.toUpperCase()} · ` : ''}:${ss}`;
}

const alertKind = (a) => (/watch/i.test(a?.event ?? '') ? 'Watch'
  : /advisory/i.test(a?.event ?? '') ? 'Advisory' : 'Alert');

function paintSchedule() {
  const el = $('.jv-schedule', root);
  const rows = model.remaining.slice(0, 4);
  const count = model.remaining.length;
  const t0 = model.tomorrow[0];
  fill(el,
    h('div.jv-mod-head',
      h('span.jv-mod-title', 'Schedule · Today'),
      h('span.jv-mod-meta', count ? `${count} ahead` : 'Clear'),
    ),
    rows.length
      ? h('div.jv-rows', ...rows.map((ev) => {
        const running = +ev.start <= Date.now();
        const isNext = ev === model.next;
        const cd = running ? 'NOW' : isNext ? tMinus(ev.start) : '';
        return h(`button.jv-row${running ? '.now' : isNext ? '.next' : ''}`, {
          onclick: (e) => { e.stopPropagation(); openEventModal(ev); },
        },
          h('span.jv-row-time', clockTime(ev.start).toUpperCase()),
          h('span.jv-row-title', ev.title),
          /* Location and the countdown share the second line so the
             title keeps the full width of the first. */
          ev.location || cd
            ? h('span.jv-row-sub',
              h('span.jv-row-loc', ev.location ?? ''),
              h('span.jv-row-cd', cd))
            : null,
        );
      }))
      : h('div.jv-empty',
        'No further entries',
        h('br'),
        h('span.dim', model.today.length ? 'Today’s schedule is complete' : 'Nothing scheduled today'),
      ),
    h('div.jv-mod-foot',
      h('span', t0
        ? `Tomorrow · ${model.tomorrow.length} ${model.tomorrow.length === 1 ? 'entry' : 'entries'}`
        : 'Tomorrow · clear'),
      t0 ? h('span', `from ${clockTime(t0.start)}`) : null,
    ),
  );
}

function paintEnvironment() {
  const el = $('.jv-env', root);
  const wx = model.wx;
  const cur = wx?.current;
  const day0 = wx?.daily?.[0];
  const cond = cur
    ? (cur.summary || CONDITION_LABEL[cur.condition] || cur.condition || '')
    : 'Acquiring';
  const cell = (label, value) => h('div', label, h('b', value));
  fill(el,
    h('div.jv-mod-head',
      h('span.jv-mod-title', 'Environment · Local'),
      h('span.jv-mod-meta', !wx ? 'Sync' : cur?.night ? 'Night' : 'Day'),
    ),
    model.alert
      ? h('div.jv-alert-band', h('span.jv-alert-dot'), h('span', alertBand(model.alert)))
      : null,
    h('div.jv-temp-row',
      h('span.jv-temp-num.num', cur ? temp(cur.temp) : '—'),
      h('span.jv-cond', cond),
    ),
    h('div.jv-tele',
      cell('Feels', cur?.feelsLike != null ? temp(cur.feelsLike) : '—'),
      cell('Humidity', cur?.humidity != null ? `${Math.round(cur.humidity)}%` : '—'),
      cell('Wind', cur?.windSpeed != null ? `${speed(cur.windSpeed)} ${windDir(cur.windDir)}`.trim() : '—'),
      cell('Hi · Lo', day0?.hi != null ? `${temp(day0.hi)} · ${temp(day0.lo)}` : '—'),
    ),
    h('div.jv-spark', { html: sparkline(wx?.hourly ?? []) }),
  );
}

const alertBand = (a) =>
  `${a.event ?? 'Weather alert'}${a.ends ? ` · until ${clockTime(a.ends)}` : ''}`;

/** The next twelve hours of temperature as a HUD trace. */
function sparkline(hours) {
  const temps = hours.slice(0, 13).map((x) => x.temp).filter((t) => t != null);
  if (temps.length < 2) return '';
  const W = 264, H = 64, top = 8, base = 50;
  const min = Math.min(...temps);
  const span = Math.max(Math.max(...temps) - min, 4);
  const xy = temps.map((t, i) => [
    (i * (W / (temps.length - 1))).toFixed(1),
    (base - ((t - min) / span) * (base - top)).toFixed(1),
  ]);
  const line = xy.map(([x, y]) => `${x},${y}`).join(' ');
  const area = `M${xy[0][0]},${base} ${xy.map(([x, y]) => `L${x},${y}`).join(' ')} L${xy.at(-1)[0]},${base} Z`;
  const ticks = [0.25, 0.5, 0.75]
    .map((f) => `<line class="tick" x1="${W * f}" y1="${top}" x2="${W * f}" y2="${base}"/>`)
    .join('');
  return `<svg viewBox="0 0 ${W} ${H}">
    <line class="base" x1="0" y1="${base}" x2="${W}" y2="${base}"/>${ticks}
    <path class="area" d="${area}"/>
    <polyline class="line" points="${line}"/>
    <circle class="dot now" cx="${xy[0][0]}" cy="${xy[0][1]}" r="2.5"/>
    <circle class="dot" cx="${xy.at(-1)[0]}" cy="${xy.at(-1)[1]}" r="2.5"/>
    <text class="lab" x="0" y="${H - 1}">NOW</text>
    <text class="lab" x="${W}" y="${H - 1}" text-anchor="end">+12H</text>
  </svg>`;
}

function paintAudio() {
  const el = $('.jv-audio', root);
  const t = player.track;
  el.classList.toggle('playing', hasTrack() && player.state === 'playing');
  fill(el,
    h('span.jv-audio-label', 'Audio'),
    h('span.jv-eq', ...Array.from({ length: 5 }, () => h('span'))),
    hasTrack()
      ? h('span.jv-audio-text',
        h('span.jv-audio-title', t.title ?? ''),
        h('span.jv-audio-sub', t.artist ? [t.artist, ' · '] : null, h('span.jv-audio-time.num')),
      )
      : h('span.jv-audio-text',
        h('span.jv-audio-title.dim', 'Standby'),
        h('span.jv-audio-sub', 'No active playback'),
      ),
  );
  paintAudioTime();
}

function paintAudioTime() {
  const el = $('.jv-audio-time', root);
  if (!el || !player.track) return;
  const remaining = Math.max(0, (player.track.duration ?? 0) - livePosition());
  el.textContent = player.state === 'playing' ? `−${formatTime(remaining)}` : 'paused';
}

/* The 24-hour ruler: hour ticks, the daylight band, every event of the
   day as a mark (the next one gold), and the caret that is right now. */
const dayFraction = (t) => {
  const d = new Date(t);
  return (d.getHours() * 60 + d.getMinutes()) / 1440;
};
const pct = (f) => `${(Math.min(1, Math.max(0, f)) * 100).toFixed(2)}%`;

function paintRuler() {
  const el = $('.jv-ruler', root);
  const day0 = model.wx?.daily?.[0];
  const now = Date.now();
  fill(el,
    ...[0, 6, 12, 18, 24].map((hr) =>
      h('span.jv-ruler-lab', { style: { left: pct(hr / 24) } }, String(hr).padStart(2, '0'))),
    h('div.jv-ticks.minor'),
    h('div.jv-ticks.major'),
    h('div.jv-ruler-base'),
    day0?.sunrise && day0?.sunset
      ? h('div.jv-ruler-sun', {
        style: {
          left: pct(dayFraction(day0.sunrise)),
          width: pct(dayFraction(day0.sunset) - dayFraction(day0.sunrise)),
        },
      })
      : null,
    ...model.today.map((ev) =>
      h(`span.jv-ruler-ev${ev === model.next ? '.next' : +ev.end < now ? '.past' : ''}`, {
        style: { left: pct(dayFraction(ev.start)) },
      })),
    h('div.jv-now', { style: { left: pct(dayFraction(now)) } }),
  );
}

const tMinus = (start) => {
  const mins = Math.max(0, Math.round((+start - Date.now()) / 60e3));
  return `T−${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
};

/* ── Ticking ──────────────────────────────────────────────── */

function tick() {
  const now = new Date();
  paintClock(now);
  /* Ends crossing, alerts expiring, the date turning: recompute once a
     minute; the signature keeps the modules untouched unless something
     they say actually changed. */
  const minute = now.getMinutes();
  if (minute !== lastMinute) {
    lastMinute = minute;
    paintAll();
    const caret = $('.jv-now', root);
    if (caret) caret.style.left = pct(dayFraction(now));
  }
  const cd = $('.jv-row.next .jv-row-cd', root);
  if (cd && model?.next) cd.textContent = tMinus(model.next.start);
  if (player.state === 'playing') paintAudioTime();
}

/* ── Jarvis speaks ────────────────────────────────────────── */
/* A pool of things worth saying, most relevant first, rebuilt whenever
   the modules repaint. The greeting opens; the pool rotates on a slow
   cadence after that; a tap on the core asks for the next line; and a
   warning that has just appeared interrupts. Every sentence is built
   from live state — Jarvis never claims anything the hub doesn't know. */

const ROTATE_MS = globalThis.__JV_ROTATE ?? 45000;
const GREET_MS = globalThis.__JV_GREET_MS ?? 1000;
let lines = [];
let lineIx = 0;
let typing = null;
let pending = null;        // a line waiting for the one being typed to finish
let rotateTimer = null;
let spoken = 0;
let booted = false;
let lastWarning = '';

function refreshLines() {
  lines = candidateLines();
  lineIx = 0;
  /* A warning that appears after boot is announced at once (after the
     sentence in progress, if any). One known before the greeting is
     folded into the greeting instead, and leads the rotation. */
  const warning = model.level === 'warning' ? String(model.alert.id ?? model.alert.event) : '';
  if (warning !== lastWarning) {
    lastWarning = warning;
    if (warning && booted) {
      lineIx = 1;
      interrupt(lines[0]);
    }
  }
}

function candidateLines() {
  const out = [];
  const a = model.alert;
  if (model.level === 'warning') out.push(warningLine(a));
  if (model.running) {
    out.push(`${model.running.title} is under way${model.running.end ? ` until ${clockTime(model.running.end)}` : ''}.`);
  }
  if (model.next) out.push(nextLine(model.next));
  if (!model.next && !model.running) {
    out.push(model.today.length
      ? 'Today’s schedule is complete, sir. Nothing further on the calendar.'
      : 'The calendar is clear today, sir.');
  }
  if (model.level === 'watch') {
    out.push(`Advisory: a ${a.event} is posted${a.ends ? ` until ${clockTime(a.ends)}` : ''}. I’m keeping an eye on the radar.`);
  }
  out.push(...weatherLines());
  const t0 = model.tomorrow[0];
  if (t0) out.push(`Tomorrow opens with ${t0.title} at ${clockTime(t0.start)}.`);
  if (hasTrack() && player.state === 'playing') {
    out.push(`Now playing ${player.track.title}${player.track.artist ? ` by ${player.track.artist}` : ''}.`);
  }
  return out.filter(Boolean);
}

function warningLine(a) {
  const until = a.ends ? ` until ${clockTime(a.ends)}` : '';
  const detail = (a.description ?? '').split(/[.;]/)[0].trim();
  return `Sir, a ${a.event} is in effect${until}.${detail && detail.length < 110 ? ` ${detail}.` : ''}`;
}

function nextLine(ev) {
  const mins = Math.round((+ev.start - Date.now()) / 60e3);
  let when;
  if (mins < 1) when = 'starting now';
  else if (mins < 60) when = `${mins} minute${mins === 1 ? '' : 's'} from now`;
  else {
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    when = `${hrs} hour${hrs === 1 ? '' : 's'}${rem && hrs < 3 ? ` ${rem} minutes` : ''} from now`;
  }
  return `Next on the schedule: ${ev.title}${ev.location ? ` at ${ev.location}` : ''}, ${clockTime(ev.start)} — ${when}.`;
}

function weatherLines() {
  const wx = model.wx;
  const cur = wx?.current;
  if (!cur) return [];
  const out = [];
  const cond = (cur.summary || CONDITION_LABEL[cur.condition] || '').toLowerCase();
  const day0 = wx.daily?.[0];
  out.push(`Currently ${temp(cur.temp)}${cond ? ` and ${cond}` : ''}.${day0?.hi != null ? ` High of ${temp(day0.hi)} today.` : ''}`);
  const wet = (wx.hourly ?? []).slice(1, 13).find((x) => (x.precipChance ?? 0) >= 50);
  if (wet) out.push(`Rain likely around ${clockTime(wet.time)}, sir — a ${Math.round(wet.precipChance)}% chance.`);
  if (day0?.sunset && +day0.sunset > Date.now()) out.push(`Sunset at ${clockTime(day0.sunset)} this evening.`);
  return out;
}

function greeting() {
  const hr = new Date().getHours();
  const part = hr < 5 || hr >= 17 ? 'evening' : hr < 12 ? 'morning' : 'afternoon';
  const n = model?.remaining.length ?? 0;
  const tail = model?.level === 'warning'
    ? ' There is an active weather warning.'
    : n ? ` ${n} ${n === 1 ? 'entry remains' : 'entries remain'} on today’s schedule.`
      : ' The schedule is clear for the rest of the day.';
  return `Good ${part}, sir. All systems online.${tail}`;
}

function speak(text) {
  const said = $('.jv-said', root);
  const voice = $('.jv-voice', root);
  if (!said || !text) return;
  clearInterval(typing);
  clearTimeout(rotateTimer);
  spoken += 1;
  if (reduced()) {
    said.textContent = text;
    voice.classList.remove('speaking');
    scheduleRotate();
    return;
  }
  voice.classList.add('speaking');
  said.textContent = '';
  let i = 0;
  const step = text.length > 90 ? 16 : 24;
  typing = setInterval(() => {
    i += 1;
    said.textContent = text.slice(0, i);
    if (i >= text.length) {
      clearInterval(typing);
      typing = null;
      voice.classList.remove('speaking');
      if (pending) {
        const next = pending;
        pending = null;
        setTimeout(() => speak(next), 900);
      } else {
        scheduleRotate();
      }
    }
  }, step);
}

/** Say this next — now if Jarvis is quiet, otherwise once he finishes. */
function interrupt(text) {
  if (typing) pending = text;
  else speak(text);
}

/* The first follow-up comes sooner — the greeting is a hello, the next
   line is the news — and the pool rotates slowly after that. */
function scheduleRotate() {
  clearTimeout(rotateTimer);
  rotateTimer = setTimeout(speakNext, spoken <= 1 ? Math.min(ROTATE_MS, 12000) : ROTATE_MS);
}

function speakNext() {
  if (!lines.length) lines = candidateLines();
  if (!lines.length) return speak('All systems nominal, sir.');
  const text = lines[lineIx % lines.length];
  lineIx += 1;
  speak(text);
}
