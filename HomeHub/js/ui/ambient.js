/* Ambient mode.

   After a quiet stretch the hub fades into a slow photo slideshow. The
   photograph fills the wall; everything worth reading collects into one
   frosted panel over it — the time, the weather, what is left of today,
   and anything overdue. The point is that nobody should have to walk
   over and tap the screen to find out whether they need to leave.

   That panel is also the burn-in strategy. It drifts continuously,
   changes corner every few minutes, and the whole screen takes a short
   rest every so often. See the ── Screen care ── section at the foot of
   this file.

   With no photos loaded it shows the same panel over the live sky,
   which is a perfectly good thing for a wall to be doing at 2am. */

import { h, fill, $ } from '../core/dom.js';
import { clockParts, fullDate, clockTime, isToday } from '../core/time.js';
import { temp } from '../core/format.js';
import { state, photos, on, isNightNow } from '../core/store.js';
import { live, topAlert } from '../data/hub.js';
import { eventsOnDay, upcoming } from '../data/calendar.js';
import {
  remindersAvailable, openReminders, isOverdue,
} from '../data/reminders.js';
import {
  nextPrecipWindow, nextThunderWindow, nowcastSentence,
} from '../data/weather.js';
import { weatherIcon, icon } from './icons.js';

let active = false;
let photoTimer = null;
let clockTimer = null;
let unsubscribes = [];

/** Ordered list of `{ id }` (local) or `{ url }` (remote) — not blobs. */
let reel = [];
let index = 0;

export const isAmbient = () => active;

export async function enterAmbient() {
  if (active) return;
  active = true;

  const host = $('#ambient');
  host.hidden = false;
  host.classList.remove('out');
  /* The overlay is transparent so the live sky can show through when
     there are no photos — which means the hub underneath has to be told
     to get out of the way itself. It used to be hidden by ambient being
     solid black, and "the clock over the live sky" quietly meant "the
     clock over nothing". */
  document.body.classList.add('ambient-on');

  fill(host,
    h('div.ambient-stage'),
    h('div.ambient-vignette'),
    h('div.ambient-panel'),
    h('div.ambient-rest', h('div.ambient-rest-clock')),
  );

  reel = await loadReel();
  index = 0;

  paint();
  showPhoto();
  startScreenCare();

  /* Next frame gives the fade a start state to animate from; the
     timeout guarantees it appears even if no frames are being made. */
  let shown = false;
  const show = () => { if (!shown) { shown = true; host.classList.add('in'); } };
  requestAnimationFrame(show);
  setTimeout(show, 150);

  /* The old version re-read everything on a 20s timer and subscribed to
     nothing, so a warning issued at 2pm did not appear until 2pm-and-a-
     bit and a photo added mid-slideshow never appeared at all. Now the
     data arrives when it arrives and the timer only moves the clock. */
  startClock();
  unsubscribes = [
    on('weather', paint),
    on('calendar', paint),
    on('reminders', paint),
    on('photos', reloadReel),
  ];
}

/**
 * Repaint on the minute boundary, not every N seconds.
 *
 * A fixed interval drifts: the panel can sit a whole tick behind the
 * clock in the top bar, and two clocks on one wall disagreeing about
 * the time is the sort of thing that gets noticed from the sofa.
 */
function startClock() {
  clearTimeout(clockTimer);
  const now = new Date();
  const toNextMinute = 60000 - (now.getSeconds() * 1000 + now.getMilliseconds());
  clockTimer = setTimeout(() => { paint(); startClock(); }, toNextMinute + 40);
}

export function exitAmbient() {
  if (!active) return;
  active = false;
  clearTimeout(photoTimer);
  clearTimeout(clockTimer);
  stopScreenCare();
  for (const off of unsubscribes) off?.();
  unsubscribes = [];

  const host = $('#ambient');
  host.classList.remove('in');
  host.classList.add('out');
  document.body.classList.remove('ambient-on');
  /* Matches the 900ms CSS fade. It used to be 700, which cut the last
     fifth of the fade off with a hard snap to hidden. */
  setTimeout(() => {
    if (active) return;
    host.hidden = true;
    fill(host);
    releaseShown();
  }, 900);
}

/* ── Photos ───────────────────────────────────────────────────
   The reel holds identifiers, never blobs. Ambient used to mint an
   object URL for every stored photo the moment it started — a library
   of three hundred holidays meant three hundred decoded images pinned
   in memory for as long as the hub stayed on the wall. Now each one is
   read when its turn comes and released when it leaves the screen. */

async function loadReel() {
  const remote = (state.ambient.urls ?? []).map((url) => ({ url }));
  try {
    const stored = await photos.list();
    return [...remote, ...stored.map((row) => ({ id: row.id }))];
  } catch (err) {
    console.warn('[ambient] could not read stored photos', err);
    return remote;
  }
}

async function reloadReel() {
  const next = await loadReel();
  const changed = next.length !== reel.length
    || next.some((entry, i) => (entry.id ?? entry.url) !== (reel[i]?.id ?? reel[i]?.url));
  if (!changed) return;
  reel = next;
  if (index >= reel.length) index = 0;
  /* A newly emptied library has to give the sky back straight away —
     otherwise the last photo hangs there with nothing to replace it. */
  if (!reel.length) {
    const stage = $('.ambient-stage');
    if (stage) { fill(stage); stage.classList.add('no-photos'); releaseShown(); }
  }
}

/** Object URLs currently on screen, so they can be revoked on the way out. */
const shownUrls = new Map();

function releaseShown() {
  for (const url of shownUrls.values()) URL.revokeObjectURL(url);
  shownUrls.clear();
}

async function sourceFor(entry) {
  if (entry.url) return entry.url;
  const blob = await photos.blob(entry.id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  shownUrls.set(entry.id, url);
  return url;
}

async function showPhoto() {
  const stage = $('.ambient-stage');
  if (!stage) return;

  if (!reel.length) {
    stage.classList.add('no-photos');
    return;   // the panel over the live sky
  }
  stage.classList.remove('no-photos');

  const entry = reel[index % reel.length];
  index++;

  const url = await sourceFor(entry);
  if (!active || !url) { queueNext(); return; }

  /* Decode before fading. The cross-fade runs for over two seconds, and
     starting it against an image that has not loaded yet shows a blank
     rectangle for the first second of it. */
  try {
    const preload = new Image();
    preload.src = url;
    await preload.decode();
  } catch { /* a broken file should skip, not stop the slideshow */ }
  if (!active) return;

  const layer = h('div.ambient-photo', { style: { backgroundImage: `url("${url}")` } });
  if (state.ambient.kenBurns) {
    // Alternate the drift so consecutive photos don't all pan one way.
    layer.classList.add(index % 2 ? 'drift-a' : 'drift-b');
    layer.style.animationDuration = `${(state.ambient.seconds + 4) * 1000}ms`;
  }

  stage.appendChild(layer);
  requestAnimationFrame(() => layer.classList.add('in'));

  // Two layers alive at once: the one leaving and the one arriving.
  while (stage.children.length > 2) {
    const gone = stage.firstChild;
    gone.remove();
    releaseLayer(gone);
  }

  queueNext();
}

function queueNext() {
  clearTimeout(photoTimer);
  photoTimer = setTimeout(showPhoto, Math.max(5, state.ambient.seconds) * 1000);
}

/** Give back the object URL a dropped layer was holding. */
function releaseLayer(layer) {
  const match = /url\("([^"]+)"\)/.exec(layer?.style?.backgroundImage ?? '');
  const url = match?.[1];
  if (!url?.startsWith('blob:')) return;
  URL.revokeObjectURL(url);
  for (const [id, held] of shownUrls) if (held === url) shownUrls.delete(id);
}

/* ── What the panel says ──────────────────────────────────────
   Order is deliberate: time first because it is what the room glances
   for, then the weather, then anything shouting, then the day. Empty
   sections are absent rather than empty — a heading with nothing under
   it is worse than no heading. */

function paint() {
  const panel = $('.ambient-panel');
  if (!panel) return;

  const night = isNightNow();
  panel.classList.toggle('night', night);

  const { hour, minute, period } = clockParts(new Date());

  fill(panel,
    h('div.ambient-head',
      h('div.ambient-clock',
        h('span.num', `${hour}:${minute}`),
        period ? h('span.ambient-period', period) : null,
      ),
      h('div.ambient-date', fullDate(new Date())),
    ),

    weatherBlock(),
    alertBlock(),
    timingBlock(),

    /* At 3am a hallway wants the time, not a list of errands. Hiding
       these overnight also means far less of the panel is lit for the
       eight hours nobody is reading it. */
    night ? null : agendaBlock(),
    night ? null : remindersBlock(),
  );

  paintRestClock();
}

function weatherBlock() {
  const now = live.weather?.current;
  if (!now) return null;
  const today = live.weather?.daily?.[0];

  return h('div.ambient-wx',
    weatherIcon(now.condition, { size: 64, night: now.night }),
    h('div.ambient-wx-read',
      h('div.ambient-temp.num', temp(now.temp)),
      today
        ? h('div.ambient-hilo',
            h('span.hi', icon('chevronUp', { size: 16, stroke: 2.6 }), temp(today.hi)),
            h('span.lo', icon('chevronDown', { size: 16, stroke: 2.6 }), temp(today.lo)),
          )
        : null,
    ),
    h('div.ambient-wx-summary', now.summary || ''),
  );
}

function alertBlock() {
  const worst = topAlert();
  if (!worst) return null;
  /* `topAlert` is already the most severe — hub.js keeps the list sorted
     — so this is the one line that matters rather than a pile of them. */
  const loud = /extreme|severe/i.test(worst.severity ?? '');
  return h(`div.ambient-alert${loud ? '.severe' : ''}`,
    icon(worst.isTropical ? 'hurricane' : worst.isThunder ? 'bolt' : 'alert', { size: 22 }),
    h('span', worst.event),
  );
}

function timingBlock() {
  const imminent = nowcastSentence(live.nowcast);
  if (imminent) {
    return h('div.ambient-timing.now', icon('umbrella', { size: 20, stroke: 2.2 }), imminent);
  }
  const model = live.weather;
  if (!model) return null;
  const storm = nextThunderWindow(model);
  const rain = nextPrecipWindow(model);
  const window = storm ?? rain;
  if (!window) return null;

  const until = new Date(+window.to + 3600e3);
  return h(`div.ambient-timing.${storm ? 'storm' : 'rain'}`,
    icon(storm ? 'bolt' : 'umbrella', { size: 20, stroke: 2.2 }),
    h('span', `${storm ? 'Storms' : 'Rain'} ${clockTime(window.from)} – ${clockTime(until)}`),
  );
}

function agendaBlock() {
  if (state.ambient.showAgenda === false) return null;
  const events = live.calendar?.events ?? [];
  const now = Date.now();

  /* `upcoming(events, { days: 1 })` looks like the right call and is
     not: its cutoff is twenty-four hours out, so at six in the evening
     it starts listing tomorrow morning under a heading that says
     today. */
  const rest = eventsOnDay(events, new Date())
    .filter((ev) => +ev.end > now)
    .slice(0, 4);

  if (rest.length) {
    return h('div.ambient-section',
      h('div.ambient-section-head', 'Today'),
      ...rest.map(eventRow),
    );
  }

  /* Once today is done, "nothing else today" is a weak thing to leave
     on a wall all evening. By nine the useful question is the school
     run, not the leftovers. */
  const tomorrow = upcoming(events, { limit: 2, days: 2 }).filter((ev) => !isToday(ev.start));
  if (!tomorrow.length) return null;
  return h('div.ambient-section',
    h('div.ambient-section-head', 'Tomorrow'),
    ...tomorrow.map(eventRow),
  );
}

function eventRow(ev) {
  return h('div.ambient-row',
    h('span.ambient-dot', { style: { background: ev.color || 'var(--accent)' } }),
    h('span.ambient-row-title', ev.title),
    h('span.ambient-row-when', ev.allDay ? 'All day' : clockTime(ev.start)),
  );
}

function remindersBlock() {
  if (state.ambient.showReminders === false) return null;
  if (!remindersAvailable()) return null;

  /* Already sorted overdue-first by openReminders. Undated ones are
     left out on purpose: "someday" belongs in the app, not on a wall. */
  const due = openReminders()
    .filter((r) => isOverdue(r) || (r.due && isToday(r.due)))
    .slice(0, 4);
  if (!due.length) return null;

  return h('div.ambient-section',
    h('div.ambient-section-head', 'Reminders'),
    ...due.map((r) => h(`div.ambient-row${isOverdue(r) ? '.overdue' : ''}`,
      /* A dot in the list's own colour, matching the event rows above.
         A tick here would be worse than plain: everything on this list
         is by definition *not* done, and a checkmark says it is.
         Overdue overrides the list colour — which list it came from
         stops being the interesting thing once it is late. */
      h('span.ambient-dot', {
        style: { background: isOverdue(r) ? 'var(--sev-severe)' : (r.color || 'var(--accent)') },
      }),
      h('span.ambient-row-title', r.title),
      h('span.ambient-row-when',
        isOverdue(r) ? 'Overdue' : r.hasTime ? clockTime(r.due) : 'Today'),
    )),
  );
}

/* ── Screen care ──────────────────────────────────────────────
   Three layers, on very different clocks.

   The global nudge in idle.js only ever moved `.shift-root`, which is
   the hub — so the one screen that stays up for eight hours at a time
   never moved at all. Ambient owns its own motion rather than getting
   that class, because two systems translating the same element just
   fight over the transform. */

const ANCHORS = ['bl', 'tr', 'tl', 'br'];
/** Smallest period we will schedule on, in minutes — see scheduleMove. */
const MIN_PERIOD = 0.05;
let anchorStep = 0;
let driftTimer = null;
let moveTimer = null;
let restTimer = null;
let restingUntil = 0;

function startScreenCare() {
  const panel = $('.ambient-panel');
  if (!panel) return;
  anchorStep = 0;
  applyAnchor();

  drift();
  driftTimer = setInterval(drift, 30000);

  scheduleMove();
  scheduleRest();
}

function stopScreenCare() {
  clearInterval(driftTimer);
  clearTimeout(moveTimer);
  clearTimeout(restTimer);
  driftTimer = moveTimer = restTimer = null;
  restingUntil = 0;
}

/**
 * Continuous, imperceptible movement.
 *
 * Two sine waves with coprime periods — eleven minutes across, seventeen
 * up — so the path does not retrace itself for a little over three
 * hours. A thirty-second tick paired with a thirty-second linear
 * transition is smooth without an animation frame loop running all
 * evening for something nobody can see happening.
 */
function drift() {
  const panel = $('.ambient-panel');
  if (!panel) return;
  const t = Date.now() / 1000;
  const dx = Math.sin((t / 660) * Math.PI * 2) * 2.5;
  const dy = Math.cos((t / 1020) * Math.PI * 2) * 2.5;
  panel.style.setProperty('--drift-x', `${dx.toFixed(2)}vw`);
  panel.style.setProperty('--drift-y', `${dy.toFixed(2)}vh`);
}

function scheduleMove() {
  /* The floor is a guard against a zero or a NaN turning this into a
     runaway timer, not a policy — Settings already refuses anything
     under a minute, and duplicating that here just gives the two places
     a chance to disagree. */
  const minutes = Math.max(MIN_PERIOD, state.ambient.moveMinutes ?? 6);
  moveTimer = setTimeout(() => {
    hopAnchor();
    scheduleMove();
  }, minutes * 60e3);
}

/**
 * Corner to corner, as far as each hop can manage.
 *
 * Every hop cannot be a diagonal: the only diagonal pairs are bl↔tr and
 * tl↔br, which are two disjoint edges, so no cycle through all four
 * corners can use diagonals alone. bl → tr → tl → br alternates a
 * diagonal with a long side, which is the most travel available from a
 * four-corner cycle — and it beats a rotation, which would be four
 * short hops around the rim.
 */
function hopAnchor() {
  const panel = $('.ambient-panel');
  if (!panel) return;
  panel.classList.add('moving');
  setTimeout(() => {
    anchorStep = (anchorStep + 1) % ANCHORS.length;
    applyAnchor();
    panel.classList.remove('moving');
  }, 420);
}

function applyAnchor() {
  const panel = $('.ambient-panel');
  if (!panel) return;
  for (const a of ANCHORS) panel.classList.toggle(`at-${a}`, a === ANCHORS[anchorStep]);
}

function scheduleRest() {
  if (state.ambient.rest === false) return;
  /* More rest overnight, when there is nobody to interrupt and the
     panel has the longest unbroken run ahead of it. */
  const minutes = isNightNow()
    ? Math.max(MIN_PERIOD, (state.ambient.restMinutes ?? 60) / 2)
    : Math.max(MIN_PERIOD, state.ambient.restMinutes ?? 60);
  restTimer = setTimeout(rest, minutes * 60e3);
}

function rest() {
  const host = $('#ambient');
  if (!host || !active) return;
  const seconds = isNightNow()
    ? Math.min(300, (state.ambient.restSeconds ?? 25) * 2)
    : (state.ambient.restSeconds ?? 25);

  restingUntil = Date.now() + seconds * 1000;
  paintRestClock();
  host.classList.add('resting');

  restTimer = setTimeout(() => {
    host.classList.remove('resting');
    restingUntil = 0;
    scheduleRest();
  }, seconds * 1000);
}

/**
 * The rest is not quite black.
 *
 * A wall display that goes fully dark for half a minute reads as broken,
 * and somebody will come and prod it. A single dim line of time says
 * "resting" instead — and it lands somewhere different each time, so the
 * one thing still lit is never the same pixels twice.
 */
function paintRestClock() {
  const el = $('.ambient-rest-clock');
  if (!el) return;
  const { hour, minute, period } = clockParts(new Date());
  fill(el, `${hour}:${minute}${period ? ` ${period.toLowerCase()}` : ''}`);
  if (!restingUntil) return;
  el.style.setProperty('--rest-x', `${12 + Math.random() * 76}%`);
  el.style.setProperty('--rest-y', `${14 + Math.random() * 72}%`);
}

/* Nothing needs to ask whether a rest is running: any touch exits
   ambient mode outright, veil and all, which is the behaviour a room
   walking past a dark screen expects anyway. */
