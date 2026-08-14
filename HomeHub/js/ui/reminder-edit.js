/* Editing a linked reminder from the wall.
 *
 * Tapping a chore or list row's text (not its check button) opens this
 * small sheet: rename it, give it a due date and time, set one of the
 * hub's six repeat choices, or delete it. Writes go straight through
 * EventKit, so every phone sees the change.
 */

import { h, fill, $, toast } from '../core/dom.js';
import { icon } from './icons.js';
import { openSheet, closeSheet } from './event-modal.js';
import { updateReminderItem, removeReminderItem } from '../data/reminders.js';

const REPEATS = [
  { id: 'none', label: 'Never' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekdays', label: 'Weekdays' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'biweekly', label: 'Every 2 weeks' },
  { id: 'monthly', label: 'Monthly' },
];

/* The snapshot only carries the human label; recover the choice when it
   is one of ours. Anything fancier set in the Reminders app shows as
   Custom and is left alone unless deliberately changed. */
function repeatIdFor(r) {
  if (!r.recurring) return 'none';
  const hit = {
    Daily: 'daily', Weekdays: 'weekdays', Weekly: 'weekly',
    'Every 2 weeks': 'biweekly', Monthly: 'monthly',
  }[r.repeatText];
  return hit ?? 'custom';
}

export function openReminderEditor(r) {
  const host = openSheet();
  if (!host) return;

  const startRepeat = repeatIdFor(r);
  let repeat = startRepeat;

  const two = (n) => String(n).padStart(2, '0');
  const titleIn = h('input.text-input.ev-input', {
    type: 'text', value: r.title, placeholder: 'Reminder…',
  });
  const dateIn = h('input.text-input', {
    type: 'date',
    value: r.due ? `${r.due.getFullYear()}-${two(r.due.getMonth() + 1)}-${two(r.due.getDate())}` : '',
  });
  const timeIn = h('input.text-input.time', {
    type: 'time',
    value: r.due && r.hasTime ? `${two(r.due.getHours())}:${two(r.due.getMinutes())}` : '',
  });

  const repeatChoices = startRepeat === 'custom'
    ? [{ id: 'custom', label: r.repeatText || 'Custom' }, ...REPEATS]
    : REPEATS;
  const chips = h('div.ev-form-chips');
  const paintChips = () => fill(chips, ...repeatChoices.map((o) =>
    h(`button.chip.small${o.id === repeat ? '.on' : ''}`, {
      onclick: () => { repeat = o.id; paintChips(); },
    }, o.label)));
  paintChips();

  const save = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const changes = { title: titleIn.value.trim() || r.title };
      if (dateIn.value) {
        const hasTime = !!timeIn.value;
        changes.due = +new Date(`${dateIn.value}T${timeIn.value || '09:00'}`);
        changes.hasTime = hasTime;
      } else {
        changes.due = null;
        changes.hasTime = false;
      }
      // Never overwrite a Reminders-app rule that wasn't touched.
      if (repeat !== 'custom' && repeat !== startRepeat) changes.repeat = repeat;
      await updateReminderItem(r.id, changes);
      toast('Saved to Reminders');
      closeSheet();
    } catch (err) {
      toast(err.message, 'warn');
      btn.disabled = false;
    }
  };

  const del = async () => {
    if (!confirm(`Delete “${r.title}” from Reminders everywhere?`)) return;
    try {
      await removeReminderItem(r.id);
      toast('Reminder deleted');
      closeSheet();
    } catch (err) {
      toast(err.message, 'warn');
    }
  };

  fill(host,
    h('div.ev-scrim', { onclick: closeSheet }),
    h('article.ev-modal.ev-modal-slim', { role: 'dialog', 'aria-modal': 'true' },
      h('div.ev-head',
        h('div.ev-bar', { style: { background: r.color || 'var(--accent)' } }),
        h('div.ev-head-main',
          h('h3.ev-title', 'Edit reminder'),
          h('div.ev-sub', r.listName ?? ''),
        ),
        h('button.ev-close.no-expand', { onclick: closeSheet, 'aria-label': 'Close' },
          icon('close', { size: 18 })),
      ),
      h('div.ev-form',
        h('label.ev-field', h('span.ev-field-label', 'Title'), titleIn),
        h('div.ev-form-row',
          h('label.ev-field', h('span.ev-field-label', 'Due date'), dateIn),
          h('label.ev-field', h('span.ev-field-label', 'Time'), timeIn),
        ),
        h('div.ev-field', h('span.ev-field-label', 'Repeat'), chips),
      ),
      h('div.ev-actions',
        h('button.ev-btn.danger', { onclick: del }, 'Delete'),
        h('button.ev-btn.primary', { onclick: save }, 'Save'),
      ),
    ),
  );
}
