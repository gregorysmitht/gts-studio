/* Event detail modal (design handoff 3d).
 *
 * Opens over the hub: the hub blurs and dims underneath, a scrim sits
 * between, and a 640-frame-px modal scales in. The modal answers the
 * three questions a wall display gets asked about an event — when do we
 * leave, who's going, what do we bring — and offers one action,
 * navigation, when the event has somewhere to be.
 */

import { h, fill, $, toast } from '../core/dom.js';
import { clockTime, timeRange, relativeDay } from '../core/time.js';
import { percent } from '../core/format.js';
import { icon } from './icons.js';
import { live, refresh } from '../data/hub.js';
import { state, save } from '../core/store.js';
import { createEvent, updateEvent, removeEvent } from '../core/native.js';

let open = false;

/* The sheet host is shared plumbing: the event modal and the reminder
   editor both ride it, one at a time. */
export function openSheet() {
  const host = $('#sheet-host');
  if (!host) return null;
  open = true;
  host.hidden = false;
  document.body.classList.add('modal-open');
  let shown = false;
  const show = () => { if (!shown) { shown = true; host.classList.add('in'); } };
  requestAnimationFrame(show);
  setTimeout(show, 120);
  document.addEventListener('keydown', onKey, true);
  return host;
}

export function openEventModal(event) {
  if (!openSheet()) return;
  renderView(event);
}

/** A blank event on the family calendar, starting at the next round
    hour of the given day (or today). */
export function openEventCreate({ date } = {}) {
  const base = date ? new Date(date) : new Date();
  const start = new Date(base);
  if (date && !isSameDay(base, new Date())) start.setHours(9, 0, 0, 0);
  else { start.setMinutes(0, 0, 0); start.setHours(start.getHours() + 1); }

  const cals = editableCalendars();
  if (!openSheet()) return;
  renderEditor({
    title: '', start, end: new Date(+start + 3600e3), allDay: false,
    location: '', description: '', calendarId: cals[0]?.id ?? null,
    color: cals[0]?.color, recurring: false, editable: true,
  }, { create: true });
}

const isSameDay = (a, b) => a.getFullYear() === b.getFullYear()
  && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const editableCalendars = () =>
  (live.calendar?.calendars ?? []).filter((c) => c.editable);

function renderView(event) {
  const host = $('#sheet-host');
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
      /* The pencil only exists for events whose calendar takes writes —
         device calendars, never ICS subscriptions or demo data. */
      event.editable
        ? h('button.ev-close.no-expand', {
            onclick: () => renderEditor(event),
            'aria-label': 'Edit',
          }, icon('pencil', { size: 16 }))
        : null,
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
}

/* ── Edit / create ──────────────────────────────────────────── */

function renderEditor(event, { create = false } = {}) {
  const host = $('#sheet-host');
  const cals = editableCalendars();
  let calendarId = event.calendarId && cals.some((c) => c.id === event.calendarId)
    ? event.calendarId
    : (cals[0]?.id ?? null);
  let allDay = !!event.allDay;
  let span = 'this';

  const two = (n) => String(n).padStart(2, '0');
  const dateValue = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  const timeValue = (d) => `${two(d.getHours())}:${two(d.getMinutes())}`;

  const titleIn = h('input.text-input.ev-input', {
    type: 'text', value: event.title, placeholder: 'Event title…',
  });
  const dateIn = h('input.text-input', { type: 'date', value: dateValue(event.start) });
  const startIn = h('input.text-input.time', { type: 'time', value: timeValue(event.start) });
  const endIn = h('input.text-input.time', { type: 'time', value: timeValue(event.end) });
  const locIn = h('input.text-input', {
    type: 'text', value: event.location ?? '', placeholder: 'Location (optional)',
  });
  const times = h('div.ev-form-row');
  const paintTimes = () => fill(times,
    labeled('Starts', startIn), labeled('Ends', endIn));
  if (!allDay) paintTimes();

  const allDaySwitch = h('button.switch', {
    role: 'switch', 'aria-checked': allDay ? 'true' : 'false',
    onclick: () => {
      allDay = !allDay;
      allDaySwitch.setAttribute('aria-checked', allDay ? 'true' : 'false');
      allDay ? fill(times) : paintTimes();
    },
  }, h('span.switch-knob'));

  const chipRow = (options, current, pick) => {
    const row = h('div.ev-form-chips');
    const paint = (active) => fill(row, ...options.map((o) =>
      h(`button.chip.small${o.id === active ? '.on' : ''}`, {
        onclick: () => { pick(o.id); paint(o.id); },
      }, o.label)));
    paint(current);
    return row;
  };

  const save = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const at = (t) => new Date(`${dateIn.value}T${t || '00:00'}`);
      const start = allDay ? at('00:00') : at(startIn.value);
      let end = allDay ? new Date(+start + 86400e3) : at(endIn.value);
      if (+end <= +start) end = new Date(+start + 3600e3);
      const payload = {
        title: titleIn.value.trim() || 'New event',
        start, end, allDay,
        location: locIn.value.trim(),
        calendarId,
      };
      if (create) await createEvent(payload);
      else await updateEvent(event.uid, event.start, span, payload);
      toast(create ? 'Event added' : 'Event updated');
      refresh.calendar();
      closeEventModal();
    } catch (err) {
      toast(err.message, 'warn');
      btn.disabled = false;
    }
  };

  const del = async () => {
    const what = event.recurring && span === 'future' ? 'this and future' : 'this event';
    if (!confirm(`Delete ${what}: “${event.title}”?`)) return;
    try {
      await removeEvent(event.uid, event.start, span);
      toast('Event deleted');
      refresh.calendar();
      closeEventModal();
    } catch (err) {
      toast(err.message, 'warn');
    }
  };

  const modal = h('article.ev-modal', { role: 'dialog', 'aria-modal': 'true' },
    h('div.ev-head',
      h('div.ev-bar', { style: { background: event.color || 'var(--hh-cat-blue)' } }),
      h('div.ev-head-main', h('h3.ev-title', create ? 'New event' : 'Edit event')),
      h('button.ev-close.no-expand', { onclick: closeEventModal, 'aria-label': 'Close' },
        icon('close', { size: 18 })),
    ),

    h('div.ev-form',
      labeled('Title', titleIn),
      h('div.ev-form-row',
        labeled('Date', dateIn),
        h('label.ev-field', h('span.ev-field-label', 'All day'), allDaySwitch),
      ),
      times,
      labeled('Location', locIn),
      cals.length > 1
        ? h('div.ev-field', h('span.ev-field-label', 'Calendar'),
            chipRow(cals.map((c) => ({ id: c.id, label: c.name })), calendarId,
              (id) => { calendarId = id; }))
        : null,
      /* A repeating event needs to know how far the change reaches. */
      event.recurring && !create
        ? h('div.ev-field', h('span.ev-field-label', 'Applies to'),
            chipRow([
              { id: 'this', label: 'This event' },
              { id: 'future', label: 'All future' },
            ], span, (id) => { span = id; }))
        : null,
    ),

    h('div.ev-actions',
      create ? null : h('button.ev-btn.danger', { onclick: del }, 'Delete'),
      h('button.ev-btn', {
        onclick: () => create ? closeEventModal() : renderView(event),
      }, create ? 'Cancel' : 'Back'),
      h('button.ev-btn.primary', { onclick: save }, create ? 'Add event' : 'Save'),
    ),
  );

  fill(host,
    h('div.ev-scrim', { onclick: closeEventModal }),
    modal,
  );
}

function labeled(label, control) {
  return h('label.ev-field', h('span.ev-field-label', label), control);
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

/** The reminder editor closes through the same door. */
export { closeEventModal as closeSheet };

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
