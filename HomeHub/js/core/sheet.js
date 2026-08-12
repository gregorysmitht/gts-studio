/* Modal sheets.

   Lives in its own fixed layer above both the hub and any open panel, so
   the same sheet can be raised from a home-screen widget or from deep
   inside the calendar. It used to be parented to the panel host, which
   meant tapping an event on the home screen opened nothing at all —
   the host was still hidden. */

import { h, fill, $ } from './dom.js';
import { icon } from '../ui/icons.js';

let onClose = null;

/**
 * @param {Element} content
 * @param {object} [opts]
 * @param {Function} [opts.onClose]
 */
export function openSheet(content, opts = {}) {
  closeSheet({ instant: true });

  const host = $('#sheet-host');
  host.hidden = false;
  onClose = opts.onClose ?? null;

  const sheet = h('div.sheet', { role: 'dialog', 'aria-modal': 'true' },
    h('button.sheet-close.icon-btn', { onclick: () => closeSheet(), 'aria-label': 'Close' },
      icon('close', { size: 24 })),
    content,
  );

  fill(host,
    h('div.sheet-backdrop', { onclick: () => closeSheet() }),
    sheet,
  );

  // Next frame for the transition's start state, with a timeout in case
  // no frames are being produced (backgrounded tab, headless render).
  let shown = false;
  const show = () => { if (!shown) { shown = true; host.classList.add('in'); } };
  requestAnimationFrame(show);
  setTimeout(show, 120);

  document.addEventListener('keydown', onKey, true);
  return sheet;
}

export function closeSheet({ instant = false } = {}) {
  const host = $('#sheet-host');
  if (!host || host.hidden) return;

  document.removeEventListener('keydown', onKey, true);
  host.classList.remove('in');

  const done = () => {
    host.hidden = true;
    fill(host);
    const fn = onClose;
    onClose = null;
    fn?.();
  };
  if (instant) done();
  else setTimeout(done, 320);
}

export const sheetIsOpen = () => !$('#sheet-host')?.hidden;

/* Captured so Escape closes the sheet before it reaches the panel. */
function onKey(event) {
  if (event.key !== 'Escape') return;
  event.stopPropagation();
  closeSheet();
}
