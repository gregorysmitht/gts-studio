/* The full calendar: month grid, week timeline, and agenda, with a
   detail sheet for any event. */

import { h, fill, $ } from '../core/dom.js';
import {
  clockTime, weekday, monthLong, monthDay, fullDate, relativeDay,
  startOfWeek, addDays, isToday, sameDay, timeRange, durationText,
} from '../core/time.js';
import { icon } from './icons.js';
import { openPanel, onPanelClose, redrawPanel } from '../core/panel.js';
import { openSheet } from '../core/sheet.js';
import { openEventModal } from './event-modal.js';
import { live } from '../data/hub.js';
import { eventsOnDay, groupByDay, upcoming, isNow, layoutColumns } from '../data/calendar.js';
import { state, on } from '../core/store.js';
import { openSettings } from './settings.js';

/* Week view spans these hours by default; it scrolls beyond them. */
const DAY_START = 6;
const DAY_END = 23;

export function openCalendarPanel({ source, date } = {}) {
  let cursor = date ? new Date(date) : new Date();

  openPanel({
    id: 'calendar',
    title: 'Calendar',
    source,
    tabs: [
      { id: 'month',  label: 'Month',  render: (body) => renderMonth(body, cursor, (d) => (cursor = d)) },
      { id: 'week',   label: 'Week',   render: (body) => renderWeek(body, cursor, (d) => (cursor = d)) },
      { id: 'agenda', label: 'Agenda', render: (body) => renderAgenda(body) },
    ],
    actions: [
      h('button.icon-btn', {
        onclick: () => openSettings('calendars'),
        'aria-label': 'Manage calendars',
      }, icon('settings', { size: 22 })),
    ],
  }).then(() => {
    // Repaint when a feed finishes syncing, so the panel fills in rather
    // than sitting empty if it was opened mid-fetch — plus once now, in
    // case events arrived while the panel was animating open.
    const stop = on('calendar', () => redrawPanel());
    onPanelClose(stop);
    redrawPanel();
  });
}

/* ── Month ────────────────────────────────────────────────── */

function renderMonth(body, cursor, setCursor) {
  const events = live.calendar?.events ?? [];

  const draw = () => {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = startOfWeek(monthStart, state.weekStartsOn);
    const weeks = 6;

    const cells = [];
    for (let i = 0; i < weeks * 7; i++) {
      const day = addDays(gridStart, i);
      const dayEvents = eventsOnDay(events, day);
      const outside = day.getMonth() !== monthStart.getMonth();

      cells.push(
        h(`button.month-cell${outside ? '.outside' : ''}${isToday(day) ? '.today' : ''}`, {
          onclick: () => openDaySheet(day),
        },
          h('div.month-cell-head',
            h('span.month-cell-num', day.getDate()),
            dayEvents.length > 3 ? h('span.month-cell-more', `+${dayEvents.length - 3}`) : null,
          ),
          h('div.month-cell-events',
            ...dayEvents.slice(0, 3).map((event) =>
              h(`div.month-chip${event.allDay ? '.allday' : ''}`,
                { style: { '--chip': event.color || 'var(--accent)' } },
                event.allDay ? null : h('span.month-chip-time', shortTime(event.start)),
                h('span.month-chip-title', event.title),
              )),
          ),
        )
      );
    }

    fill(body,
      navBar({
        label: monthLong(monthStart),
        onPrev: () => { setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1)); cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1); draw(); },
        onNext: () => { setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)); cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1); draw(); },
        onToday: () => { cursor = new Date(); setCursor(cursor); draw(); },
      }),
      h('div.month-weekdays',
        ...Array.from({ length: 7 }, (_, i) =>
          h('div', weekday(addDays(startOfWeek(new Date(), state.weekStartsOn), i)))),
      ),
      h('div.month-grid', ...cells),
      legend(),
    );
  };

  draw();
}

const shortTime = (date) => clockTime(date).replace(/:00/, '').replace(/\s?([AP])M/i, '$1');

/* ── Week ─────────────────────────────────────────────────── */

function renderWeek(body, cursor, setCursor) {
  const events = live.calendar?.events ?? [];

  const draw = () => {
    const weekStart = startOfWeek(cursor, state.weekStartsOn);
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const hours = Array.from({ length: DAY_END - DAY_START + 1 }, (_, i) => DAY_START + i);

    const allDayRow = h('div.week-allday');
    const columns = h('div.week-columns');

    for (const day of days) {
      const dayEvents = eventsOnDay(events, day);
      const timed = dayEvents.filter((e) => !e.allDay);
      const allDay = dayEvents.filter((e) => e.allDay);
      const positions = layoutColumns(timed);

      allDayRow.appendChild(
        h('div.week-allday-cell',
          ...allDay.map((event) =>
            h('div.week-allday-chip', {
              style: { '--chip': event.color || 'var(--accent)' },
              onclick: () => openEventSheet(event),
            }, event.title)),
        )
      );

      const column = h(`div.week-column${isToday(day) ? '.today' : ''}`);
      for (const hour of hours) column.appendChild(h('div.week-slot'));

      for (const event of timed) {
        const startMin = event.start.getHours() * 60 + event.start.getMinutes();
        const endMin = Math.min(
          DAY_END * 60 + 60,
          startMin + Math.max(30, (event.end - event.start) / 60000)
        );
        const top = ((startMin - DAY_START * 60) / 60) * 100;
        const height = ((endMin - startMin) / 60) * 100;
        const pos = positions.get(event.id) ?? { index: 0, total: 1 };

        column.appendChild(
          h(`div.week-event${isNow(event) ? '.now' : ''}`, {
            style: {
              top: `${top}%`,
              height: `${Math.max(3.2, height)}%`,
              left: `${(pos.index / pos.total) * 100}%`,
              width: `${(1 / pos.total) * 100}%`,
              '--chip': event.color || 'var(--accent)',
            },
            onclick: () => openEventSheet(event),
          },
            h('div.week-event-title', event.title),
            h('div.week-event-time', clockTime(event.start)),
          )
        );
      }

      // Live "now" line, only on today's column.
      if (isToday(day)) {
        const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
        if (nowMin >= DAY_START * 60 && nowMin <= DAY_END * 60 + 60) {
          column.appendChild(h('div.week-nowline', {
            style: { top: `${((nowMin - DAY_START * 60) / 60) * 100}%` },
          }));
        }
      }
      columns.appendChild(column);
    }

    fill(body,
      navBar({
        label: `${monthDay(weekStart)} – ${monthDay(addDays(weekStart, 6))}`,
        onPrev: () => { cursor = addDays(cursor, -7); setCursor(cursor); draw(); },
        onNext: () => { cursor = addDays(cursor, 7); setCursor(cursor); draw(); },
        onToday: () => { cursor = new Date(); setCursor(cursor); draw(); },
      }),

      h('div.week-head',
        h('div.week-gutter-head'),
        ...days.map((day) =>
          h(`div.week-day-head${isToday(day) ? '.today' : ''}`,
            h('div.week-day-name', weekday(day)),
            h('div.week-day-num', day.getDate()),
          )),
      ),

      h('div.week-allday-wrap',
        h('div.week-gutter-head', 'all-day'),
        allDayRow,
      ),

      h('div.week-body.scroll',
        h('div.week-gutter',
          ...hours.map((hour) =>
            h('div.week-hour-label', clockTime(new Date(2020, 0, 1, hour)).replace(':00', ''))),
        ),
        columns,
      ),
    );

    // Open the week scrolled to roughly the current hour.
    requestAnimationFrame(() => {
      const scroller = $('.week-body', body);
      if (!scroller) return;
      const nowHour = new Date().getHours();
      const rowHeight = scroller.scrollHeight / hours.length;
      scroller.scrollTop = Math.max(0, (nowHour - DAY_START - 1.5) * rowHeight);
    });
  };

  draw();
}

/* ── Agenda ───────────────────────────────────────────────── */

function renderAgenda(body) {
  const events = live.calendar?.events ?? [];
  const list = upcoming(events, { limit: 200, days: 120 });

  if (!list.length) {
    return fill(body, h('div.empty',
      icon('calendar', { size: 52, stroke: 1.6 }),
      h('div', 'Nothing coming up'),
      h('button.btn', { onclick: () => openSettings('calendars') }, 'Manage calendars'),
    ));
  }

  fill(body,
    h('div.agenda',
      ...groupByDay(list).map(({ day, events: dayEvents }) =>
        h('section.agenda-day',
          h('div.agenda-day-head',
            h('div.agenda-day-rel', relativeDay(day)),
            h('div.agenda-day-date', fullDate(day)),
          ),
          h('div.agenda-events',
            ...dayEvents.map((event) => agendaRow(event)),
          ),
        )),
    ),
    legend(),
  );
}

function agendaRow(event) {
  return h(`div.agenda-row${isNow(event) ? '.now' : ''}`, {
    style: { '--chip': event.color || 'var(--accent)' },
    onclick: () => openEventSheet(event),
  },
    h('div.agenda-time',
      event.allDay
        ? h('div.agenda-time-all', 'All day')
        : [
            h('div.agenda-time-start', clockTime(event.start)),
            h('div.agenda-time-end', clockTime(event.end)),
          ],
    ),
    h('div.agenda-rail'),
    h('div.agenda-main',
      h('div.agenda-title', event.title),
      event.location ? h('div.agenda-where', icon('pin', { size: 16 }), event.location) : null,
      h('div.agenda-cal', event.calendarName ?? ''),
    ),
    isNow(event) ? h('span.agenda-live', 'Now') : null,
  );
}

/* ── Day sheet ────────────────────────────────────────────── */

function openDaySheet(day) {
  const events = eventsOnDay(live.calendar?.events ?? [], day);
  openSheet(
    h('div.sheet-day',
      h('div.sheet-head',
        h('div',
          h('div.sheet-eyebrow', relativeDay(day)),
          h('h3.sheet-title', fullDate(day)),
        ),
      ),
      events.length
        ? h('div.agenda-events', ...events.map((event) => agendaRow(event)))
        : h('div.empty', icon('calendar', { size: 40, stroke: 1.6 }), 'Nothing scheduled'),
    )
  );
}

/* ── Event detail ─────────────────────────────────────────── */

/* The 3d modal replaced the old row-list sheet; this alias keeps every
   existing call site (month grid, week view, agenda) on one door. */
export function openEventSheet(event) {
  openEventModal(event);
}


/* ── Shared ───────────────────────────────────────────────── */

function navBar({ label, onPrev, onNext, onToday }) {
  return h('div.cal-nav',
    h('button.icon-btn', { onclick: onPrev, 'aria-label': 'Previous' }, icon('chevronLeft', { size: 24 })),
    h('div.cal-nav-label', label),
    h('button.icon-btn', { onclick: onNext, 'aria-label': 'Next' }, icon('chevronRight', { size: 24 })),
    h('button.btn.ghost.small', { onclick: onToday }, 'Today'),
  );
}

function legend() {
  const calendars = live.calendar?.calendars ?? [];
  if (!calendars.length) return null;
  return h('div.cal-legend',
    ...calendars.map((cal) =>
      h('span.cal-legend-item',
        h('span.cal-dot', { style: { background: cal.color } }),
        cal.name,
      )),
  );
}

