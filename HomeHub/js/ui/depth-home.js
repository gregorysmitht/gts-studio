/* The DEPTH home (handoff 28a).
 *
 * The day floats as a volumetric stack of glass panes under
 * perspective: whatever matters most claims the front, and everything
 * else recedes physically behind it — blurred, scaled and dimmed by
 * depth. The order is computed, never fixed:
 *
 *     weather warning › nearest event › rest of today › tomorrow › music
 *
 * Panes keep their identity across re-sorts; only their slot class
 * changes, so an alert clearing or an event finishing slides the whole
 * stack forward one layer on its own. A fixed HUD (clock + status line,
 * temp, three footer captions) never joins the stack.
 *
 * This home is a SWITCH, not a replacement: Settings → Display flips
 * `state.homeStyle` back to the classic grid, and the quiet gear beside
 * the footer's audio caption is the door to that switch from here. */

import { h, fill, $ } from '../core/dom.js';
import { state, on } from '../core/store.js';
import { live } from '../data/hub.js';
import { eventsOnDay } from '../data/calendar.js';
import { addDays, clockParts, clockTime, weekday, isToday } from '../core/time.js';
import { temp } from '../core/format.js';
import { worstAlert } from './weather-widget.js';
import { player, hasTrack, livePosition, formatTime } from '../data/music.js';
import { openWeatherPanel } from './weather-panel.js';
import { openCalendarPanel } from './calendar-panel.js';
import { openMusicPanel } from './music-panel.js';
import { openEventModal } from './event-modal.js';
import { openSettings } from './settings.js';
import { icon } from './icons.js';

const panes = new Map();   // kind → element
let stackEl = null;
let lastSignature = '';
let peekTimer = null;
let current = null;        // the last computed stack, for tap routing

export function mountDepthHome() {
  const root = h('div', { id: 'depth-root' },
    /* Amber ambience behind the stack — only lit during a warning. */
    h('div.dh-ambience'),

    h('button.dh-clock', {
      onclick: () => openCalendarPanel({}),
      'aria-label': 'Open the calendar',
    },
      h('div.dh-time.num'),
      h('div.dh-status'),
    ),
    h('button.dh-temp', {
      onclick: () => openWeatherPanel({}),
      'aria-label': 'Open the weather',
    },
      h('div.dh-temp-num.num'),
      h('div.dh-cond'),
    ),

    h('div.dh-stack'),

    h('div.dh-footer',
      h('span.dh-foot', 'Priority owns the front: warning › today › tomorrow › music'),
      h('span.dh-foot.dh-foot-next'),
      h('span.dh-foot.dh-foot-right',
        h('span.dh-foot-audio'),
        /* The way back to Classic lives on this screen, quietly. */
        h('button.dh-gear', {
          onclick: () => openSettings('display'),
          'aria-label': 'Settings',
        }, icon('settings', { size: 15 })),
      ),
    ),
  );
  $('#hub').appendChild(root);
  stackEl = root.querySelector('.dh-stack');

  paintAll();
  on('weather', paintAll);
  on('calendar', paintAll);
  on('music', paintAll);
  /* Clock, countdowns and event-end boundaries all move with the
     second hand; the DOM is only touched where a value changed. */
  setInterval(tick, 1000);
}

/* ── What goes where ──────────────────────────────────────── */

const dedupe = (events) => {
  const seen = new Set();
  return events.filter((ev) => {
    const key = `${ev.title}|${+ev.start}|${+ev.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

function computeStack() {
  const now = Date.now();
  const events = live.calendar?.events ?? [];
  const today = dedupe(eventsOnDay(events, new Date()))
    .filter((ev) => !ev.allDay && +ev.end > now);
  const tomorrow = dedupe(eventsOnDay(events, addDays(new Date(), 1)))
    .filter((ev) => !ev.allDay);

  const alert = worstAlert(live.weather ?? {});
  const warning = !!alert && /warning/i.test(alert.event ?? '');

  /* The front is always the alert or the "nearest" pane — the nearest
     timed event still ahead (today first, then tomorrow), or a quiet
     card when the calendar is clear. Behind it: the rest of today,
     tomorrow, and the music at the very back. */
  const order = [];
  let lead = null;
  if (warning) {
    order.push('alert');
  } else {
    lead = today[0] ?? tomorrow[0] ?? null;
    order.push('lead');
  }
  const todayRest = warning ? today : today.slice(lead && isToday(lead.start) ? 1 : 0);
  if (todayRest.length) order.push('today');
  const tomorrowShow = (!warning && lead && !isToday(lead.start))
    ? tomorrow.slice(1)
    : tomorrow;
  if (tomorrowShow.length) order.push('tomorrow');
  if (hasTrack()) order.push('music');

  return {
    order: order.slice(0, 4),
    alert, warning, lead,
    today, todayRest: todayRest.slice(0, 2),
    tomorrowFirst: tomorrowShow[0] ?? null,
    todayCount: today.length,
    tomorrowCount: tomorrow.length,
  };
}

/* ── Painting ─────────────────────────────────────────────── */

function paintAll() {
  if (!stackEl) return;
  current = computeStack();

  /* Repaint contents only when what a pane SAYS could have changed —
     ticking values (clock, T−, −m:ss) are patched by tick() alone. */
  const signature = [
    current.order.join('>'),
    current.warning && current.alert ? current.alert.id ?? current.alert.event : '',
    current.lead ? `${current.lead.title}|${+current.lead.start}` : '',
    current.todayRest.map((ev) => `${ev.title}|${+ev.start}`).join(','),
    current.tomorrowFirst ? `${current.tomorrowFirst.title}|${+current.tomorrowFirst.start}` : '',
    player.track?.id ?? '',
    player.state,
  ].join('§');
  const changed = signature !== lastSignature;
  lastSignature = signature;

  if (changed) {
    for (const kind of current.order) paintPane(kind);
    assignSlots(current.order);
    stackEl.classList.toggle('alerted', current.warning);
    $('#depth-root')?.classList.toggle('alerted', current.warning);
  }
  paintHud();
}

/** Slot classes carry the whole depth recipe; reassigning them is the
    animation — CSS transitions carry each pane to its new depth. */
function assignSlots(order) {
  for (const [kind, el] of panes) {
    const at = order.indexOf(kind);
    el.classList.remove('slot-0', 'slot-1', 'slot-2', 'slot-3', 'dh-gone');
    el.classList.add(at < 0 ? 'dh-gone' : `slot-${at}`);
  }
}

function paneEl(kind) {
  let el = panes.get(kind);
  if (!el) {
    el = h(`div.dh-pane.dh-${kind}`, { onclick: (e) => onPaneTap(kind, e) });
    panes.set(kind, el);
    stackEl.appendChild(el);
  }
  return el;
}

function paintPane(kind) {
  const el = paneEl(kind);
  if (kind === 'alert') return paintAlertPane(el);
  if (kind === 'lead') return paintLeadPane(el);
  if (kind === 'today') return paintTodayPane(el);
  if (kind === 'tomorrow') return paintTomorrowPane(el);
  if (kind === 'music') return paintMusicPane(el);
}

function paintAlertPane(el) {
  const a = current.alert;
  const until = a.ends ? `UNTIL ${clockTime(a.ends).toUpperCase()}` : 'ACTIVE';
  /* NWS headlines run long; the first sentence is the useful one. */
  const headline = (a.headline ?? a.event ?? '').split(/[.;]/)[0] || a.event;
  fill(el, h('div.dh-hit',
    h('div.dh-pane-head',
      h('span.dh-alert-name',
        h('span.dh-alert-dot'),
        (a.event ?? 'Weather alert')),
      h('span.dh-mono', until),
    ),
    h('div.dh-alert-headline', headline),
    h('div.dh-alert-body',
      'Everything else waits in the stack behind this card — tap a layer to peek at it.'),
    h('div.dh-actions',
      h('button.dh-btn.amber', {
        onclick: (e) => { e.stopPropagation(); openWeatherPanel({ tab: 'radar' }); },
      }, 'Radar'),
      peekButton(),
    ),
  ));
}

function paintLeadPane(el) {
  const lead = current.lead;
  if (!lead) {
    fill(el, h('div.dh-hit',
      h('div.dh-pane-head', h('span.dh-lead-label', 'Surface layer')),
      h('div.dh-lead-title', 'A quiet stretch'),
      h('div.dh-lead-sub', 'Nothing scheduled ahead'),
      h('div.dh-actions',
        h('button.dh-btn', {
          onclick: (e) => { e.stopPropagation(); openCalendarPanel({}); },
        }, 'Calendar'),
        current.order.length > 1 ? peekButton() : null,
      ),
    ));
    return;
  }
  const running = +lead.start <= Date.now() && Date.now() <= +lead.end;
  fill(el, h('div.dh-hit',
    h('div.dh-pane-head',
      h('span.dh-lead-label', `Nearest · ${isToday(lead.start) ? 'Today' : 'Tomorrow'}`),
      h('span.dh-mono.dh-countdown', running ? 'NOW' : tMinus(lead.start)),
    ),
    h('div.dh-lead-title', lead.title),
    h('div.dh-lead-sub',
      [clockTime(lead.start), lead.location].filter(Boolean).join(' · ')),
    h('div.dh-actions',
      h('button.dh-btn', {
        onclick: (e) => { e.stopPropagation(); openEventModal(lead); },
      }, 'Details'),
      current.order.length > 1 ? peekButton() : null,
    ),
  ));
}

function paintTodayPane(el) {
  fill(el, h('div.dh-hit',
    h('div.dh-band-label', `Today${current.warning ? ' · behind the storm' : ''}`),
    h('div.dh-today-row',
      ...current.todayRest.map((ev, i) => h('div.dh-today-item',
        h(`div.dh-today-title${i ? '.second' : ''}`, ev.title),
        h('div.dh-today-sub',
          [clockTime(ev.start), ev.location].filter(Boolean).join(' · ')),
      )),
    ),
  ));
}

function paintTomorrowPane(el) {
  const ev = current.tomorrowFirst;
  fill(el, h('div.dh-hit',
    h('div.dh-tomorrow-row',
      h('span.dh-band-label', 'Tomorrow'),
      h('span.dh-tomorrow-title', `${ev.title} ${clockTime(ev.start)}`),
    ),
  ));
}

function paintMusicPane(el) {
  const t = player.track;
  const art = t.artworkUrl
    ? h('img.dh-art', { src: t.artworkUrl, alt: '' })
    : h('div.dh-art', icon('music', { size: 16 }));
  fill(el, h('div.dh-hit',
    h('div.dh-music-row',
      art,
      h('span.dh-music-title', t.title ?? ''),
      h('span.dh-music-sub',
        h('span.dh-music-time.num'),
      ),
      h('div.dh-eq', h('span'), h('span'), h('span')),
    ),
  ));
  el.classList.toggle('playing', player.state === 'playing');
  paintMusicTime();
}

const peekButton = () => h('button.dh-btn.ghost', {
  onclick: (e) => { e.stopPropagation(); peekAt(current.order[1]); },
}, 'Peek behind');

/* ── HUD ──────────────────────────────────────────────────── */

function paintHud() {
  const now = new Date();
  const { hour, minute, period } = clockParts(now);
  fill($('.dh-time'), `${hour}:${minute}`, period ? h('span.dh-ampm', period) : null);

  const date = `${weekday(now)} ${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
  const bits = [date];
  if (current.warning) bits.push('warning');
  if (current.todayCount) bits.push(`${current.todayCount} today`);
  if (current.tomorrowCount) bits.push(`${current.tomorrowCount} tomorrow`);
  if (!current.warning && !current.todayCount && !current.tomorrowCount) bits.push('surface layer');
  fill($('.dh-status'), bits.join(' · '));

  const wx = live.weather?.current;
  fill($('.dh-temp-num'), wx ? temp(wx.temp) : '—');
  fill($('.dh-cond'), condLine(wx));

  const next = $('.dh-foot-next');
  if (current.warning) {
    const a = current.alert;
    fill(next, a.ends
      ? `When it clears at ${clockTime(a.ends)}, the stack slides forward one layer`
      : 'When it clears, the stack slides forward one layer');
  } else if (current.lead) {
    fill(next, `After ${current.lead.title}, the stack slides forward one layer`);
  } else {
    fill(next, 'The stack is quiet — nothing pressing');
  }

  paintAudioFoot();
}

/* "heavy rain · falling" — the condition plus where the next hour is
   headed, when the hourly feed offers one. */
function condLine(wx) {
  if (!wx) return '';
  const cond = (wx.condition ?? '').toLowerCase();
  const hours = live.weather?.hourly ?? [];
  const delta = hours.length > 1 ? (hours[1].temp ?? 0) - (hours[0].temp ?? 0) : 0;
  const trend = delta > 0.5 ? 'rising' : delta < -0.5 ? 'falling' : '';
  return [cond, trend].filter(Boolean).join(' · ');
}

function paintAudioFoot() {
  const foot = $('.dh-foot-audio');
  if (!foot) return;
  if (!hasTrack()) return fill(foot, '♫ quiet');
  if (player.state !== 'playing') return fill(foot, `♫ paused · ${player.track.title}`);
  const remaining = Math.max(0, (player.track.duration ?? 0) - livePosition());
  fill(foot, `♫ ${player.track.title} · −${formatTime(remaining)}`);
}

function paintMusicTime() {
  const el = $('.dh-music-time');
  if (!el || !player.track) return;
  const remaining = Math.max(0, (player.track.duration ?? 0) - livePosition());
  el.textContent = `−${formatTime(remaining)}`;
}

const tMinus = (start) => {
  const mins = Math.max(0, Math.round((+start - Date.now()) / 60e3));
  return `T−${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
};

/* ── Ticking ──────────────────────────────────────────────── */

let lastMinute = -1;
function tick() {
  /* Ends crossing, alerts expiring, dates turning: recompute once a
     minute; paintAll's signature keeps the DOM untouched unless the
     stack actually changed. */
  const minute = new Date().getMinutes();
  if (minute !== lastMinute) {
    lastMinute = minute;
    paintAll();
  }
  const cd = $('.dh-countdown');
  if (cd && current?.lead) {
    const running = +current.lead.start <= Date.now();
    cd.textContent = running ? 'NOW' : tMinus(current.lead.start);
  }
  paintMusicTime();
  if (player.state === 'playing') paintAudioFoot();
}

/* ── Peek ─────────────────────────────────────────────────── */

/** Lift a behind-pane to the front for a beat; the real front steps
    aside. A second tap while lifted opens the pane's own panel. */
function peekAt(kind) {
  if (!kind || !panes.has(kind)) return;
  stackEl.dataset.peek = kind;
  panes.get(kind)?.classList.add('peek');
  clearTimeout(peekTimer);
  peekTimer = setTimeout(unpeek, 4000);
}

function unpeek() {
  delete stackEl.dataset.peek;
  for (const el of panes.values()) el.classList.remove('peek');
}

function openFor(kind) {
  if (kind === 'alert') openWeatherPanel({ tab: 'alerts' });
  else if (kind === 'music') openMusicPanel({});
  else if (kind === 'lead' && current?.lead) openEventModal(current.lead);
  else openCalendarPanel({});
}

function onPaneTap(kind, event) {
  /* Buttons inside panes handle themselves (and stopPropagation). */
  if (event.target.closest('button')) return;
  const front = current?.order[0] === kind;
  const peeked = stackEl.dataset.peek === kind;
  if (front || peeked) {
    unpeek();
    openFor(kind);
  } else {
    peekAt(kind);
  }
}
