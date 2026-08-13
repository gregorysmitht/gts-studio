/* Event detail modal (design handoff 3d).
 *
 * Opens over the hub: the hub blurs and dims underneath, a scrim sits
 * between, and a 640-frame-px modal scales in. The modal answers the
 * three questions a wall display gets asked about an event — when do we
 * leave, who's going, what do we bring — and offers one action,
 * navigation, when the event has somewhere to be.
 */

import { h, fill, $ } from '../core/dom.js';
import { clockTime, timeRange, relativeDay } from '../core/time.js';
import { percent } from '../core/format.js';
import { icon } from './icons.js';
import { live } from '../data/hub.js';
import { state, save } from '../core/store.js';

let open = false;

export function openEventModal(event) {
  const host = $('#sheet-host');
  if (!host) return;
  open = true;
  host.hidden = false;
  document.body.classList.add('modal-open');

  const rain = rainAtEvent(event);
  const checklist = checklistItems(event);

  const modal = h('article.ev-modal', { role: 'dialog', 'aria-modal': 'true' },
    h('div.ev-head',
      h('div.ev-bar', { style: { background: event.color || 'var(--hh-cat-blue)' } }),
      h('div.ev-head-main',
        h('h3.ev-title', event.title),
        h('div.ev-sub', [
          relativeDay(event.start),
          event.allDay ? 'All day' : timeRange(event.start, event.end),
          event.location,
        ].filter(Boolean).join(' · ')),
      ),
      h('button.ev-close.no-expand', { onclick: closeEventModal, 'aria-label': 'Close' },
        icon('close', { size: 18 })),
    ),

    rain
      ? h('div.wx-strip.alert',
          icon('umbrella', { size: 18 }),
          h('span.wx-strip-copy', `${percent(rain)} rain around ${clockTime(event.start)}`),
          h('span.wx-strip-meta', 'check before you leave'),
        )
      : null,

    h('div.ev-tiles',
      leaveTile(event),
      whoTile(event),
    ),

    checklist.length ? h('div.ev-checklist', ...checklist.map((item) => checkRow(event, item))) : null,

    event.location
      ? h('div.ev-actions',
          h('a.ev-btn.primary', {
            href: `https://maps.apple.com/?q=${encodeURIComponent(event.location)}`,
            target: '_blank',
            rel: 'noopener',
          }, 'Navigate'),
        )
      : null,
  );

  fill(host,
    h('div.ev-scrim', { onclick: closeEventModal }),
    modal,
  );

  let shown = false;
  const show = () => { if (!shown) { shown = true; host.classList.add('in'); } };
  requestAnimationFrame(show);
  setTimeout(show, 120);
  document.addEventListener('keydown', onKey, true);
}

export function closeEventModal() {
  if (!open) return;
  open = false;
  const host = $('#sheet-host');
  document.removeEventListener('keydown', onKey, true);
  document.body.classList.remove('modal-open');
  host.classList.remove('in');
  setTimeout(() => {
    if (open) return;
    host.hidden = true;
    fill(host);
  }, 240);
}

function onKey(e) {
  if (e.key === 'Escape') { e.stopPropagation(); closeEventModal(); }
}

/* Peak rain chance across the event's hours — the modal's warning strip
   exists exactly for "80% rain at practice time". */
function rainAtEvent(event) {
  const hours = live.weather?.hourly ?? [];
  const inWindow = hours.filter((hr) => +hr.time >= +event.start - 30 * 60e3 && +hr.time <= +event.end);
  const peak = Math.max(0, ...inWindow.map((hr) => hr.precipChance ?? 0));
  return peak >= 50 ? peak : null;
}

function leaveTile(event) {
  if (!event.location || event.allDay || +event.start < Date.now()) {
    return h('div.ev-tile',
      h('div.ev-tile-label', 'When'),
      h('div.ev-tile-big', event.allDay ? 'All day' : clockTime(event.start)),
      h('div.ev-tile-sub', relativeDay(event.start)),
    );
  }
  const lead = state.leaveLeadMin ?? 20;
  const leave = new Date(+event.start - lead * 60e3);
  return h('div.ev-tile',
    h('div.ev-tile-label', 'Leave by'),
    h('div.ev-tile-big', clockTime(leave)),
    h('div.ev-tile-sub', `${lead} min before · starts ${clockTime(event.start)}`),
  );
}

function whoTile(event) {
  const people = (event.attendees ?? []).filter(Boolean).slice(0, 4);
  if (!people.length) {
    return h('div.ev-tile',
      h('div.ev-tile-label', 'Calendar'),
      h('div.ev-tile-people',
        h('span.ev-avatar', { style: { background: event.color || 'var(--hh-cat-blue)' } },
          (event.calendarName ?? 'C').slice(0, 1).toUpperCase()),
        h('span.ev-tile-names', event.calendarName ?? 'Calendar'),
      ),
    );
  }
  const first = (s) => String(s).replace(/^mailto:/i, '').trim().slice(0, 1).toUpperCase();
  return h('div.ev-tile',
    h('div.ev-tile-label', "Who's going"),
    h('div.ev-tile-people',
      ...people.map((p) => h('span.ev-avatar', first(p))),
      h('span.ev-tile-names', people.map((p) => String(p).replace(/^mailto:/i, '').split('@')[0]).join(' + ')),
    ),
  );
}

/* The packing list rides in the event notes: any line that starts with
   "- " becomes a checkbox, ticked state kept per event on this hub. */
function checklistItems(event) {
  const notes = event.description ?? event.notes ?? '';
  return String(notes).split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter(Boolean)
    .slice(0, 6);
}

function checkRow(event, item) {
  const ticked = () => !!state.checklists?.[event.id]?.[item];
  const row = h('button.ev-check-row.no-expand', {
    onclick: () => {
      const forEvent = { ...(state.checklists?.[event.id] ?? {}) };
      forEvent[item] = !forEvent[item];
      state.checklists = { ...state.checklists, [event.id]: forEvent };
      save('checklists');
      row.classList.toggle('done', forEvent[item]);
    },
  },
    h('span.ev-check-box', icon('check', { size: 10, stroke: 3 })),
    h('span.ev-check-label', item),
  );
  if (ticked()) row.classList.add('done');
  return row;
}
