/* Chores board.

   Each chore belongs to a person and repeats on a schedule. Completion
   is recorded per date, which makes streaks free and means checking a
   box on Tuesday doesn't clear Wednesday's copy. */

import { h, fill, toast } from '../core/dom.js';
import { icon } from './icons.js';
import { makeExpandable, openPanel } from '../core/panel.js';
import { state, save, uid, on, personById, nextColor, PALETTE } from '../core/store.js';
import {
  remindersAvailable, listItems, listName, tickOff, addReminder, isOverdue,
} from '../data/reminders.js';
import { isToday } from '../core/time.js';

const dateKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const REPEATS = [
  { id: 'daily', label: 'Every day' },
  { id: 'weekdays', label: 'Weekdays' },
  { id: 'weekly', label: 'Certain days' },
  { id: 'once', label: 'Just once' },
];

/** Is this chore on the board for the given day? */
export function dueOn(chore, date = new Date()) {
  const day = date.getDay();
  switch (chore.repeat) {
    case 'daily': return true;
    case 'weekdays': return day >= 1 && day <= 5;
    case 'weekly': return (chore.days ?? []).includes(day);
    case 'once': return !Object.keys(chore.history ?? {}).length;
    default: return true;
  }
}

export const isDone = (chore, date = new Date()) => !!chore.history?.[dateKey(date)];

export function toggleChore(chore, date = new Date()) {
  chore.history ||= {};
  const key = dateKey(date);
  if (chore.history[key]) delete chore.history[key];
  else chore.history[key] = true;
  prune(chore);
  save('chores');
}

/** Keep only the last 120 days of history so state stays small. */
function prune(chore) {
  const cutoff = dateKey(new Date(Date.now() - 120 * 86400e3));
  for (const key of Object.keys(chore.history)) if (key < cutoff) delete chore.history[key];
}

/** Consecutive due-days completed, counting back from today. */
export function streak(chore) {
  let count = 0;
  const cursor = new Date();
  for (let i = 0; i < 90; i++) {
    if (dueOn(chore, cursor)) {
      if (isDone(chore, cursor)) count++;
      else if (i > 0 || isDone(chore, cursor) === false) break;
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

const todaysChores = () => state.chores.filter((c) => dueOn(c));

/* ── Home tile ────────────────────────────────────────────── */

export function createChoresWidget() {
  const card = h('article.card.chore-card', { id: 'w-chores' });
  makeExpandable(card, (source) => openChoresPanel({ source }));
  renderChores(card);
  on('chores', () => renderChores(card));
  on('people', () => renderChores(card));
  return card;
}

export function renderChores(card) {
  const due = todaysChores();
  const done = due.filter((c) => isDone(c));

  if (!state.chores.length) {
    return fill(card,
      h('div.label', 'Chores'),
      h('div.empty',
        icon('clipboard', { size: 40, stroke: 1.6 }),
        h('div', 'No chores yet'),
        h('span.empty-hint', 'Tap to set up the board'),
      ),
    );
  }

  const pending = due.filter((c) => !isDone(c)).slice(0, 3);

  fill(card,
    h('div.section-head',
      h('div.label', 'Chores today'),
      h('div.note', `${done.length}/${due.length}`),
    ),

    h('div.chore-progress',
      h('div.chore-progress-fill', {
        style: { width: `${due.length ? (done.length / due.length) * 100 : 0}%` },
      }),
    ),

    pending.length
      ? h('div.chore-mini', ...pending.map((chore) => {
          const person = personById(chore.personId);
          return h('div.chore-mini-row',
            h('button.check.small.no-expand', {
              onclick: (e) => { e.stopPropagation(); toggleChore(chore); },
              'aria-label': `Mark ${chore.title} done`,
            }),
            h('span.chore-mini-title', chore.title),
            person ? h('span.chore-mini-who', { style: { color: person.color } }, person.name) : null,
          );
        }))
      : h('div.chore-clear',
          icon('check', { size: 30, stroke: 2.4 }),
          h('span', 'All done today'),
        ),
  );
}

/* ── Panel ────────────────────────────────────────────────── */

export function openChoresPanel({ source } = {}) {
  /* Linked to a Reminders list: the whole feature becomes a window onto
     that list. iOS owns the schedule — a repeating reminder rolls to its
     next occurrence when completed — so the local repeat/streak
     machinery stands down while a link is set. */
  const linked = remindersAvailable() ? state.choresLink : null;
  if (linked) {
    openPanel({
      id: 'chores',
      title: 'Chores',
      source,
      tabs: [
        { id: 'today', label: 'Today', render: (body) => renderLinkedToday(body, linked) },
        { id: 'upcoming', label: 'Upcoming', render: (body) => renderLinkedUpcoming(body, linked) },
      ],
    });
    return;
  }

  openPanel({
    id: 'chores',
    title: 'Chores',
    source,
    tabs: [
      { id: 'today', label: 'Today', render: (body) => renderToday(body) },
      { id: 'all', label: 'All chores', render: (body) => renderAll(body) },
      { id: 'people', label: 'Family', render: (body) => renderPeople(body) },
    ],
    actions: [
      h('button.icon-btn', { onclick: () => addChore(), 'aria-label': 'Add chore' },
        icon('plus', { size: 24 })),
    ],
  });
}

/* ── Linked mode (state.choresLink) ───────────────────────── */

function linkedRows(body, linked, items, renderer) {
  return items.map((r) => h('div.list-item',
    h('button.check', {
      onclick: () => {
        tickOff(r.id, true)
          .then(() => renderer(body, linked))
          .catch((err) => toast(err.message, 'warn'));
      },
      'aria-label': `Mark ${r.title} done`,
    }),
    h('div.chore-linked-main',
      h('span.list-item-text', r.title),
      isOverdue(r) ? h('span.chore-linked-tag', 'Overdue') : null,
    ),
  ));
}

/* Due today or already late — the board for right now. Completing a
   repeating reminder makes EventKit schedule the next occurrence, so
   recurring chores maintain themselves. */
function renderLinkedToday(body, linked) {
  const due = listItems(linked).filter((r) => isOverdue(r) || (r.due && isToday(r.due)));

  const input = h('input.list-input', {
    type: 'text',
    placeholder: 'Add a chore…',
    autocapitalize: 'sentences',
    enterkeyhint: 'done',
    onkeydown: (e) => {
      if (e.key !== 'Enter') return;
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      addReminder(linked, text)
        .then(() => renderLinkedToday(body, linked))
        .catch((err) => toast(err.message, 'warn'));
    },
  });

  fill(body,
    h('div.list-add', icon('plus', { size: 24 }), input),
    due.length
      ? h('div.list-items', ...linkedRows(body, linked, due, renderLinkedToday))
      : h('div.empty', icon('check', { size: 44, stroke: 1.6 }), 'All done today'),
    h('div.list-sync-note',
      icon('refresh', { size: 16 }),
      `Synced with Reminders · ${listName(linked) ?? 'Chores'}`,
      h('span.list-sync-hint', 'Repeats are set in the Reminders app'),
    ),
  );
}

/* Everything else on the list — later this week, and undated someday
   chores. */
function renderLinkedUpcoming(body, linked) {
  const later = listItems(linked).filter((r) => !isOverdue(r) && !(r.due && isToday(r.due)));
  fill(body,
    later.length
      ? h('div.list-items', ...linkedRows(body, linked, later, renderLinkedUpcoming))
      : h('div.empty', icon('clipboard', { size: 44, stroke: 1.6 }), 'Nothing scheduled ahead'),
    h('div.list-sync-note',
      icon('refresh', { size: 16 }),
      `Synced with Reminders · ${listName(linked) ?? 'Chores'}`,
    ),
  );
}

function renderToday(body) {
  const due = todaysChores();
  if (!due.length) {
    return fill(body, h('div.empty', icon('clipboard', { size: 48, stroke: 1.6 }),
      h('div', 'Nothing due today'),
      h('button.btn', { onclick: () => addChore() }, 'Add a chore')));
  }

  // Group by person so each family member sees their own column.
  const groups = new Map();
  for (const chore of due) {
    const key = chore.personId ?? '_';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(chore);
  }

  fill(body,
    h('div.chore-columns',
      ...[...groups.entries()].map(([personId, chores]) => {
        const person = personById(personId);
        const done = chores.filter((c) => isDone(c)).length;
        return h('div.chore-column.well',
          h('div.chore-column-head',
            h('span.person-chip', { style: { background: person?.color ?? 'var(--fg-faint)' } },
              (person?.name ?? '?').slice(0, 1).toUpperCase()),
            h('span.chore-column-name', person?.name ?? 'Anyone'),
            h('span.chore-column-count', `${done}/${chores.length}`),
          ),
          ...chores.map((chore) => choreRow(chore, body)),
        );
      }),
    ),
  );
}

function choreRow(chore, body) {
  const done = isDone(chore);
  const run = streak(chore);
  return h(`div.chore-row${done ? '.done' : ''}`,
    h('button.check', {
      onclick: () => { toggleChore(chore); renderToday(body); },
      'aria-label': `${done ? 'Undo' : 'Complete'} ${chore.title}`,
    }, done ? icon('check', { size: 22, stroke: 3 }) : null),
    h('div.chore-row-main',
      h('div.chore-row-title', chore.title),
      run >= 2 ? h('div.chore-streak', icon('flame', { size: 15 }), `${run} day streak`) : null,
    ),
  );
}

function renderAll(body) {
  if (!state.chores.length) {
    return fill(body, h('div.empty', icon('clipboard', { size: 48, stroke: 1.6 }), 'No chores yet'));
  }
  fill(body,
    h('div.chore-all',
      ...state.chores.map((chore) => {
        const person = personById(chore.personId);
        const repeat = REPEATS.find((r) => r.id === chore.repeat)?.label ?? '';
        return h('div.chore-manage-row.well',
          h('div.chore-manage-main',
            h('div.chore-row-title', chore.title),
            h('div.chore-manage-meta',
              person ? h('span', { style: { color: person.color } }, person.name) : h('span.dim', 'Anyone'),
              h('span.dim', '·'),
              h('span.dim', repeat),
              chore.repeat === 'weekly' && chore.days?.length
                ? h('span.dim', chore.days.map((d) => 'SMTWTFS'[d]).join(' '))
                : null,
            ),
          ),
          h('button.icon-btn.ghost', {
            onclick: () => {
              state.chores = state.chores.filter((c) => c.id !== chore.id);
              save('chores');
              renderAll(body);
            },
            'aria-label': `Delete ${chore.title}`,
          }, icon('trash', { size: 20 })),
        );
      }),
      h('button.btn.primary.chore-add', { onclick: () => addChore(body) },
        icon('plus', { size: 22 }), 'Add chore'),
    ),
  );
}

function renderPeople(body) {
  const nameInput = h('input.text-input', { type: 'text', placeholder: 'Add a family member…' });

  fill(body,
    h('div.people-grid',
      ...state.people.map((person) =>
        h('div.person-card.well',
          h('span.person-chip.big', { style: { background: person.color } },
            person.name.slice(0, 1).toUpperCase()),
          h('div.person-name', person.name),
          h('div.person-colors',
            ...PALETTE.slice(0, 6).map((color) =>
              h(`button.color-dot${person.color === color ? '.on' : ''}`, {
                style: { background: color },
                onclick: () => { person.color = color; save('people'); renderPeople(body); },
                'aria-label': `Set colour for ${person.name}`,
              })),
          ),
          h('button.btn.ghost.small', {
            onclick: () => {
              state.people = state.people.filter((p) => p.id !== person.id);
              for (const chore of state.chores) if (chore.personId === person.id) chore.personId = null;
              save('people');
              renderPeople(body);
            },
          }, 'Remove'),
        )),
    ),

    h('div.list-add',
      icon('person', { size: 24 }),
      nameInput,
      h('button.btn.primary', {
        onclick: () => {
          const name = nameInput.value.trim();
          if (!name) return;
          state.people.push({ id: uid(), name, color: nextColor(state.people.map((p) => p.color)) });
          nameInput.value = '';
          save('people');
          renderPeople(body);
        },
      }, 'Add'),
    ),
  );
}

function addChore(body) {
  const title = prompt('What is the chore?');
  if (!title?.trim()) return;

  state.chores.push({
    id: uid(),
    title: title.trim(),
    personId: state.people[0]?.id ?? null,
    repeat: 'daily',
    days: [],
    history: {},
  });
  save('chores');
  toast('Chore added — set who and how often in “All chores”');
  if (body) renderAll(body);
}
