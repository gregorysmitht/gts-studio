/* Shared lists — groceries, to-dos, whatever the family adds.

   Stored locally on the hub. Big rows, big checkboxes: this is used
   standing in a hallway, often by someone holding something else. */

import { h, fill, $, toast } from '../core/dom.js';
import { icon } from './icons.js';
import {
  makeExpandable, openPanel, closePanel, onPanelClose, redrawPanel,
} from '../core/panel.js';
import { state, save, uid, on } from '../core/store.js';
import {
  remindersAvailable, listItems, listName, tickOff, addReminder,
} from '../data/reminders.js';

const listById = (id) => state.lists.find((l) => l.id === id);
const pending = (list) => list.items.filter((i) => !i.done).length;

/* ── Home tile ────────────────────────────────────────────── */

export function createListsWidget() {
  const card = h('article.card.list-card', { id: 'w-lists' });
  makeExpandable(card, (source) => openListsPanel({ source }));
  renderLists(card);
  on('lists', () => renderLists(card));
  return card;
}

export function renderLists(card) {
  const total = state.lists.reduce((n, l) => n + pending(l), 0);

  fill(card,
    h('div.section-head',
      h('div.label', 'Lists'),
      total ? h('div.note', `${total} open`) : null,
    ),
    h('div.list-summary',
      ...state.lists.slice(0, 3).map((list) => {
        const count = pending(list);
        return h('div.list-summary-row',
          h('span.list-summary-icon', icon(list.icon === 'cart' ? 'cart' : 'check', { size: 22 })),
          h('span.list-summary-name', list.name),
          h(`span.list-summary-count${count ? '' : '.zero'}`, count || '✓'),
        );
      }),
    ),
  );
}

/* ── Panel ────────────────────────────────────────────────── */

export function openListsPanel({ source, listId } = {}) {
  const startId = listId ?? state.lists[0]?.id;

  openPanel({
    id: 'lists',
    title: 'Lists',
    source,
    tabs: state.lists.map((list) => ({
      id: list.id,
      label: list.name,
      render: (body) => renderListPanel(body, list.id),
    })),
    actions: [
      h('button.icon-btn', {
        onclick: () => addList(),
        'aria-label': 'New list',
      }, icon('plus', { size: 24 })),
    ],
  }).then(() => {
    if (startId && startId !== state.lists[0]?.id) {
      // Panel opens on the first tab; jump to the requested one.
      $(`.seg-btn[data-tab="${startId}"]`)?.click();
    }
  });

  /* A phone or Siri edits a linked list while it's open on the wall:
     the reminders refetch lands as an emit, and the panel follows.
     Unless someone is mid-word in the add box — a rebuild would eat
     their typing; the next emit catches the panel up. */
  const stop = on('reminders', () => {
    if (document.activeElement instanceof HTMLInputElement) return;
    redrawPanel();
  });
  onPanelClose(stop);
}

function renderListPanel(body, listId) {
  const list = listById(listId);
  if (!list) return;

  /* A linked list is a window onto an iOS Reminders list: rows are real
     reminders, ticking completes them everywhere, and the keyboard
     creates reminders every phone will see. The local items stay stored
     untouched underneath in case the link is ever removed. */
  const linkedTo = remindersAvailable() ? state.listLinks?.[listId] : null;
  if (linkedTo) return renderLinkedPanel(body, list, linkedTo);

  const open = list.items.filter((i) => !i.done);
  const done = list.items.filter((i) => i.done);

  const input = h('input.list-input', {
    type: 'text',
    placeholder: `Add to ${list.name}…`,
    autocapitalize: 'sentences',
    enterkeyhint: 'done',
    onkeydown: (e) => {
      if (e.key !== 'Enter') return;
      const text = input.value.trim();
      if (!text) return;
      list.items.unshift({ id: uid(), text, done: false, at: Date.now() });
      input.value = '';
      save('lists');
      renderListPanel(body, listId);
      // Keep the keyboard up for a run of items.
      requestAnimationFrame(() => $('.list-input')?.focus());
    },
  });

  fill(body,
    h('div.list-add',
      icon('plus', { size: 24 }),
      input,
    ),

    open.length
      ? h('div.list-items', ...open.map((item) => itemRow(item, list, body)))
      : h('div.empty', icon('check', { size: 44, stroke: 1.6 }), 'All clear'),

    done.length
      ? h('div.list-done-section',
          h('div.section-head',
            h('div.label', `${done.length} done`),
            h('button.btn.ghost.small', {
              onclick: () => {
                list.items = list.items.filter((i) => !i.done);
                save('lists');
                renderListPanel(body, listId);
              },
            }, 'Clear'),
          ),
          h('div.list-items.done', ...done.map((item) => itemRow(item, list, body))),
        )
      : null,
  );
}

function renderLinkedPanel(body, list, reminderListId) {
  const items = listItems(reminderListId);
  const sourceName = listName(reminderListId);

  const input = h('input.list-input', {
    type: 'text',
    placeholder: `Add to ${list.name}…`,
    autocapitalize: 'sentences',
    enterkeyhint: 'done',
    onkeydown: (e) => {
      if (e.key !== 'Enter') return;
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      addReminder(reminderListId, text)
        .then(() => renderLinkedPanel(body, list, reminderListId))
        .catch((err) => toast(err.message, 'warn'));
      requestAnimationFrame(() => $('.list-input')?.focus());
    },
  });

  fill(body,
    h('div.list-add', icon('plus', { size: 24 }), input),

    items.length
      ? h('div.list-items', ...items.map((r) => linkedRow(r, body, list, reminderListId)))
      : h('div.empty', icon('check', { size: 44, stroke: 1.6 }), 'All clear'),

    h('div.list-sync-note',
      icon('refresh', { size: 16 }),
      sourceName
        ? `Synced with Reminders · ${sourceName}`
        : 'Synced with the Reminders app',
    ),
  );
}

function linkedRow(reminder, body, list, reminderListId) {
  return h('div.list-item',
    h('button.check', {
      onclick: () => {
        tickOff(reminder.id, true)
          .then(() => renderLinkedPanel(body, list, reminderListId))
          .catch((err) => toast(err.message, 'warn'));
      },
      'aria-label': `Mark ${reminder.title} done`,
    }),
    h('span.list-item-text', reminder.title),
    /* No trash button: deleting someone's reminder from the wall is a
       bigger decision than completing it. That stays on the phone. */
  );
}

function itemRow(item, list, body) {
  const row = h(`div.list-item${item.done ? '.done' : ''}`,
    h('button.check', {
      onclick: () => {
        item.done = !item.done;
        item.doneAt = item.done ? Date.now() : null;
        save('lists');
        renderListPanel(body, list.id);
      },
      'aria-label': item.done ? `Mark ${item.text} not done` : `Mark ${item.text} done`,
    }, item.done ? icon('check', { size: 22, stroke: 3 }) : null),

    h('span.list-item-text', item.text),

    h('button.icon-btn.ghost.list-remove', {
      onclick: () => {
        list.items = list.items.filter((i) => i.id !== item.id);
        save('lists');
        renderListPanel(body, list.id);
      },
      'aria-label': `Remove ${item.text}`,
    }, icon('trash', { size: 20 })),
  );
  return row;
}

function addList() {
  const name = prompt('Name the new list');
  if (!name?.trim()) return;
  state.lists.push({ id: uid(), name: name.trim(), icon: 'check', items: [] });
  save('lists');
  closePanel().then(() => openListsPanel({}));
  toast(`Added “${name.trim()}”`);
}
