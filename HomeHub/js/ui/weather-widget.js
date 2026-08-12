/* Home-screen weather: the current conditions plus the next few hours,
   and a separate five-day card. Both expand into the full panel, where
   the outlook runs to ten days for anyone who wants that far ahead. */

import { h, fill } from '../core/dom.js';
import { hourLabel, weekday, isToday, clockTime } from '../core/time.js';
import { temp, percent } from '../core/format.js';
import { weatherIcon, icon } from './icons.js';
import { makeExpandable } from '../core/panel.js';
import { live } from '../data/hub.js';
import { nextHours, nextPrecipWindow, nextThunderWindow, nowcastSentence } from '../data/weather.js';
import { CONDITION_LABEL } from '../data/conditions.js';
import { openWeatherPanel } from './weather-panel.js';
import { tempColor } from '../core/palette.js';

/**
 * The active warning, if there is one, as a bar across the weather card.
 *
 * Only the most severe is shown — a wall display that lists four
 * advisories teaches people to stop reading them. The count goes on the
 * end so nothing is hidden, and the whole thing opens the Alerts tab.
 */
function alertLine(model) {
  const alerts = model.alerts ?? [];
  if (!alerts.length) return null;

  const rank = (a) => (/extreme/i.test(a.severity) ? 3 : /severe/i.test(a.severity) ? 2
    : /moderate/i.test(a.severity) ? 1 : 0);
  const worst = [...alerts].sort((a, b) => rank(b) - rank(a))[0];
  const loud = rank(worst) >= 2;

  return h(`button.wx-alert${loud ? '.severe' : ''}.no-expand`, {
    onclick: (e) => { e.stopPropagation(); openWeatherPanel({ tab: 'alerts' }); },
    'aria-label': `Weather alert: ${worst.event}. Open alerts.`,
  },
    icon(worst.isTropical ? 'hurricane' : worst.isThunder ? 'bolt' : 'alert', { size: 22 }),
    h('span.wx-alert-event', worst.event),
    alerts.length > 1 ? h('span.wx-alert-more', `+${alerts.length - 1}`) : null,
  );
}

/* ── Current conditions + next hours ──────────────────────── */

export function createWeatherWidget() {
  const card = h('article.card.wx-card', { id: 'w-weather' });
  makeExpandable(card, (source) => openWeatherPanel({ source }));
  renderWeather(card);
  return card;
}

export function renderWeather(card) {
  const model = live.weather;
  if (!model) return fill(card, skeleton());

  const now = model.current;
  const today = model.daily?.[0];
  const hours = nextHours(model, 6);

  /* A warning is an extra bar the card was not sized for, so the hero
     tightens to make room rather than clipping the hi/lo row. */
  card.classList.toggle('has-alert', !!(model.alerts ?? []).length);

  fill(card,
    h('div.wx-top',
      h('div.wx-now',
        h('div.label', h('span.dot'), 'Now'),
        h('div.wx-temp.num', temp(now.temp)),
        h('div.wx-hilo',
          today ? h('span.hi', icon('chevronUp', { size: 18, stroke: 2.6 }), temp(today.hi)) : null,
          today ? h('span.lo', icon('chevronDown', { size: 18, stroke: 2.6 }), temp(today.lo)) : null,
        ),
      ),
      h('div.wx-glyph',
        weatherIcon(now.condition, { size: 116, night: now.night }),
        h('div.wx-summary', now.summary || CONDITION_LABEL[now.condition]),
        now.feelsLike != null && Math.abs(now.feelsLike - now.temp) >= 3
          ? h('div.wx-feels', `Feels like ${temp(now.feelsLike)}`)
          : null,
      ),
    ),

    /* Warnings belong here, beside the conditions they describe, not in
       the top bar next to the clock. A tornado warning is weather; it
       should read as the loudest thing on the weather card rather than
       as a pill in the furniture. */
    alertLine(model),

    timingLine(model),

    h('div.divider'),

    h('div.wx-hours', ...hours.map((hour, i) => hourColumn(hour, i))),
  );
}

/**
 * The single most useful sentence on the home screen: when it is going
 * to rain, or storm, and until when. Falls back to a quiet all-clear so
 * the card's proportions don't jump around.
 */
function timingLine(model) {
  /* Something about to happen in the next few minutes beats a window
     that opens this afternoon — that's the whole point of standing in
     the hallway looking at this. */
  const imminent = nowcastSentence(live.nowcast);
  if (imminent) {
    return h('div.wx-timing.now',
      icon('umbrella', { size: 20, stroke: 2.2 }),
      h('span.wx-timing-window', imminent),
      h('span.wx-timing-peak', 'next hour'),
    );
  }

  const storm = nextThunderWindow(model);
  const rain = nextPrecipWindow(model);
  const window = storm ?? rain;

  if (!window) {
    return h('div.wx-timing.clear',
      icon('check', { size: 20, stroke: 2.6 }),
      h('span', 'No rain expected today'),
    );
  }

  const until = new Date(+window.to + 3600e3);
  return h(`div.wx-timing.${storm ? 'storm' : 'rain'}`,
    icon(storm ? 'bolt' : 'umbrella', { size: 20, stroke: 2.2 }),
    h('span.wx-timing-label', storm ? 'Storms' : 'Rain'),
    h('span.wx-timing-window', `${clockTime(window.from)} – ${clockTime(until)}`),
    h('span.wx-timing-peak', `${percent(window.peak)} peak`),
  );
}

function hourColumn(hour, index) {
  const wet = hour.precipChance >= 15;
  const stormy = hour.thunderChance >= 25;
  return h('div.wx-hour',
    h('div.wx-hour-label', index === 0 ? 'Now' : hourLabel(hour.time)),
    weatherIcon(hour.condition, { size: 40, night: hour.night }),
    h('div.wx-hour-temp.num', temp(hour.temp)),
    h(`div.wx-hour-precip${stormy ? '.storm' : wet ? '.wet' : '.dry'}`,
      stormy ? icon('bolt', { size: 14, stroke: 2.4 }) : null,
      wet || stormy ? percent(Math.max(hour.precipChance, hour.thunderChance)) : '—',
    ),
  );
}

function skeleton() {
  return h('div.wx-skeleton',
    h('div.skeleton', { style: { width: '45%', height: 'calc(var(--u) * 16)' } }),
    h('div.skeleton', { style: { width: '100%', height: 'calc(var(--u) * 10)' } }),
  );
}

/* ── Five-day outlook ─────────────────────────────────────── */

export function createForecastWidget() {
  const card = h('article.card.fc-card', { id: 'w-forecast' });
  makeExpandable(card, (source) => openWeatherPanel({ source, tab: 'daily' }));
  renderForecast(card);
  return card;
}

/**
 * Columns rather than rows: the card is wide and short, and a column per
 * day leaves room for type big enough to read across a room. Each
 * column carries a vertical bar showing that day's range within the
 * run's range, so the shape of the week is visible at a glance without
 * reading a single number.
 *
 * Five days, not seven. Seven fitted, but only just — in portrait this
 * card gets three of six grid columns, and at that width the day names
 * and temperatures were being squeezed for the sake of two days nobody
 * plans around from a hallway. The panel behind this card still shows
 * ten.
 */
export function renderForecast(card) {
  const model = live.weather;
  if (!model?.daily?.length) {
    return fill(card, h('div.label', 'Forecast'), h('div.skeleton', { style: { flex: '1' } }));
  }

  const days = model.daily.slice(0, 5);
  const lows = days.map((d) => d.lo).filter((v) => v != null);
  const highs = days.map((d) => d.hi).filter((v) => v != null);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const span = Math.max(1, max - min);

  fill(card,
    h('div.section-head',
      h('div.label', 'Next 5 days'),
      h('div.note', `${temp(min)} – ${temp(max)}`),
    ),
    h('div.fc-cols', ...days.map((day) => dayColumn(day, { max, span, now: model.current.temp }))),
  );
}

function dayColumn(day, { max, span, now }) {
  const today = isToday(day.date);
  // The track spans the whole run: its top is the run's high, its
  // bottom its low. Each day's bar sits where its range falls.
  const top = ((max - day.hi) / span) * 100;
  const height = Math.max(8, ((day.hi - day.lo) / span) * 100);

  return h(`div.fc-col${today ? '.today' : ''}`,
    h('div.fc-col-day', today ? 'Today' : weekday(day.date)),
    weatherIcon(day.condition, { size: 34 }),
    h('div.fc-col-pop', day.precipChance >= 15 ? percent(day.precipChance) : ' '),
    h('div.fc-col-hi.num', temp(day.hi)),
    /* No "now" marker here: at this size the track is only ~20px tall and
       a dot on it reads as a smudge rather than a position. The panel's
       ten-day view has the room to show it properly. */
    h('div.fc-track',
      h('div.fc-track-fill', {
        style: {
          top: `${top}%`,
          height: `${height}%`,
          background: `linear-gradient(to top, ${tempColor(day.lo)}, ${tempColor(day.hi)})`,
        },
      }),
    ),
    h('div.fc-col-lo.num', temp(day.lo)),
  );
}

