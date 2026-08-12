/* Expanding panels.

   Tapping a widget grows a full-screen panel out of that widget's
   position while the hub behind it scales back and dims. The panel is
   only ever transformed — never resized — so its contents never squash
   mid-flight, and the whole thing stays on the compositor.

   One panel at a time; opening another replaces it. */

import { h, $, fill, nextFrame, transitionEnd } from './dom.js';
import { icon } from '../ui/icons.js';

let current = null;   // { id, el, source, onClose, cleanup }

export const activePanel = () => current?.id ?? null;

/**
 * @param {object} spec
 * @param {string} spec.id            stable identifier, so re-tapping is a no-op
 * @param {string} spec.title
 * @param {Element} [spec.source]     the widget the panel grows from
 * @param {Function} spec.render      (body, panel) => void — fills the scroll area
 * @param {Array} [spec.tabs]         [{ id, label, render }] segmented control
 * @param {Element[]} [spec.actions]  extra header controls, right-aligned
 * @param {Function} [spec.onClose]
 * @param {boolean} [spec.flush]      body gets no padding (used by the radar map)
 */
export function openPanel(spec) {
  if (current?.id === spec.id) return Promise.resolve(current.el);
  if (current) closePanel({ instant: true });

  const host = $('#panel-host');
  const hub = $('#hub');
  host.hidden = false;

  const body = h(`div.panel-body${spec.flush ? '.flush' : '.scroll'}`);
  const tabsBar = spec.tabs?.length ? h('div.seg', { role: 'tablist' }) : null;

  const panel = h('section.panel', { role: 'dialog', 'aria-modal': 'true', 'aria-label': spec.title },
    h('header.panel-head',
      h('button.icon-btn.panel-back', {
        onclick: () => closePanel(),
        'aria-label': 'Back to home',
      }, icon('chevronLeft', { size: 26 })),
      h('h2.panel-title', spec.title),
      tabsBar,
      h('div.panel-actions', spec.actions ?? []),
    ),
    body,
  );

  const backdrop = h('div.panel-backdrop', { onclick: () => closePanel() });
  fill(host, backdrop, panel);

  /* `current` is established before any content renders, because tab
     renderers call onPanelClose() during their first draw (the radar
     registers its map teardown that way). */
  current = {
    id: spec.id,
    el: panel,
    source: spec.source ?? null,
    onClose: spec.onClose,
    cleanup: [],      // torn down when the panel closes
    tabCleanup: [],   // torn down when the tab changes too
    activeTab: spec.tabs?.[0]?.id ?? null,
    setTab: (id) => drawTab(id),
  };

  /* Tabs own their own rendering so switching never rebuilds the shell. */
  const drawTab = (id) => {
    // Let the outgoing tab release anything it was holding.
    for (const fn of current.tabCleanup) {
      try { fn(); } catch (err) { console.warn('[panel] tab teardown failed', err); }
    }
    current.tabCleanup = [];
    current.activeTab = id;

    if (tabsBar) {
      [...tabsBar.children].forEach((btn) => {
        const on = btn.dataset.tab === id;
        btn.classList.toggle('on', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }
    const tab = spec.tabs.find((t) => t.id === id);
    /* A tab can opt out of the scrolling, padded body — the radar needs a
       flex container it can fill edge to edge. */
    body.className = `panel-body ${tab?.flush ?? spec.flush ? 'flush' : 'scroll'}`;
    body.scrollTop = 0;
    fill(body);
    tab?.render(body, panel);
  };

  if (tabsBar) {
    for (const tab of spec.tabs) {
      tabsBar.appendChild(
        h('button.seg-btn', {
          dataset: { tab: tab.id },
          role: 'tab',
          onclick: () => drawTab(tab.id),
        }, tab.label)
      );
    }
    drawTab(current.activeTab);
  } else {
    spec.render?.(body, panel);
  }

  /* Grow from the widget: transform-origin sits on the widget's centre,
     so the panel appears to unfold out of exactly that card. */
  if (spec.source) {
    const rect = spec.source.getBoundingClientRect();
    const cx = ((rect.left + rect.width / 2) / innerWidth) * 100;
    const cy = ((rect.top + rect.height / 2) / innerHeight) * 100;
    panel.style.transformOrigin = `${cx.toFixed(1)}% ${cy.toFixed(1)}%`;
  }

  hub.classList.add('receded');
  panel.classList.add('entering');
  backdrop.classList.add('entering');

  /* Release the entering state on the next frame so the transition has a
     start state to animate from. The timeout is a genuine safety net: a
     page that isn't producing frames (backgrounded tab, headless render)
     never fires rAF, and the panel must not stay invisible because of it. */
  let revealed = false;
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    panel.classList.remove('entering');
    backdrop.classList.remove('entering');
  };
  nextFrame().then(reveal);
  setTimeout(reveal, 150);

  document.addEventListener('keydown', onKey);

  /* Resolves immediately rather than after the animation: callers use
     this to switch tabs and subscribe to live data, and none of that
     should depend on a frame ever being painted. */
  return Promise.resolve(panel);
}

/** Switch tabs on the open panel from outside (used by "See full radar"). */
export const setPanelTab = (id) => current?.setTab?.(id);

/** Which tab the open panel is showing, if any. */
export const activeTabId = () => current?.activeTab ?? null;

/** Re-render the current tab in place — used when fresh data lands. */
export function redrawPanel() {
  if (current?.activeTab) current.setTab(current.activeTab);
}

export async function closePanel({ instant = false } = {}) {
  if (!current) return;
  const { el, onClose, cleanup, tabCleanup } = current;
  const host = $('#panel-host');
  const hub = $('#hub');

  document.removeEventListener('keydown', onKey);
  for (const fn of [...tabCleanup, ...cleanup]) {
    try { fn(); } catch (err) { console.warn('[panel] teardown failed', err); }
  }
  current = null;

  hub.classList.remove('receded');

  const backdrop = host.querySelector('.panel-backdrop');

  if (!instant) {
    el.classList.add('leaving');
    backdrop?.classList.add('leaving');
    await transitionEnd(el, 600);
  }

  /* A panel may have been opened while this one was animating out — tap
     a widget within the exit transition and you'd otherwise watch the new
     panel get wiped by the old one's teardown. Remove only our own nodes,
     and hide the host only if nothing took our place. */
  el.remove();
  backdrop?.remove();
  if (!current) {
    host.hidden = true;
    fill(host);
  }
  onClose?.();
}

/** Register teardown for the open panel (timers, listeners, subscriptions). */
export function onPanelClose(fn) {
  current?.cleanup.push(fn);
}

/**
 * Register teardown that also runs when the tab changes — for anything a
 * single tab owns, like the radar's map and animation loop.
 */
export function onTabClose(fn) {
  current?.tabCleanup.push(fn);
}

function onKey(event) {
  if (event.key === 'Escape') closePanel();
}

/**
 * Wire a widget so tapping it opens a panel, with pointer feedback and
 * keyboard access. `onOpen` receives the widget element to grow from.
 * Returns the element for chaining.
 */
export function makeExpandable(el, onOpen) {
  el.classList.add('tappable');
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');

  const open = () => onOpen(el);

  el.addEventListener('click', (event) => {
    // Let controls inside a widget do their own thing.
    if (event.target.closest('button, a, input, .no-expand')) return;
    open();
  });
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
  });
  return el;
}
