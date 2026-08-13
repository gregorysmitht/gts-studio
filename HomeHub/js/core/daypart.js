/* Time-of-day states (design handoff §Interactions).
 *
 * Four palettes, one layout. The daypart stamps `data-daypart` on the
 * root element and tokens.css swaps the ground and its glows; nothing
 * else moves, so the change is ambient rather than an event. Windows
 * from the handoff: morning 5:00–11:59, afternoon 12:00–17:59,
 * evening 18:00–21:59, night 22:00–4:59.
 */

import { state } from './store.js';

/** @returns {'morning'|'afternoon'|'evening'|'night'} */
export function daypart(date = new Date()) {
  /* Probes pin the state; nothing in the app writes this. */
  if (state.daypartOverride) return state.daypartOverride;
  const h = date.getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 18) return 'afternoon';
  if (h >= 18 && h < 22) return 'evening';
  return 'night';
}

export function startDaypart() {
  const apply = () => {
    const part = daypart();
    const root = document.documentElement;
    if (root.dataset.daypart !== part) root.dataset.daypart = part;
  };
  apply();
  /* A minute tick is plenty: the boundaries are on whole hours, and the
     ≥1s background cross-fade lives in CSS where the vars land. */
  setInterval(apply, 60e3);
}
