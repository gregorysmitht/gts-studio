/* Home-screen weather, to the design handoff: the "Right Now" card with
   watch/warning escalation and an 8-hour strip, and the "Next 5 Days"
   card as rows with horizontal range bars. Both expand into the full
   panel, where the outlook runs to ten days. */

import { h, fill } from '../core/dom.js';
import { hourLabel, weekday, isToday, clockTime } from '../core/time.js';
import { temp, percent } from '../core/format.js';
import { weatherIcon, icon } from './icons.js';
import { makeExpandable } from '../core/panel.js';
import { live } from '../data/hub.js';
import { nextHours, nextPrecipWindow, nextThunderWindow, nowcastSentence } from '../data/weather.js';
import { CONDITION_LABEL } from '../data/conditions.js';
import { openWeatherPanel } from './weather-panel.js';

/* ── Current conditions + next hours ──────────────────────── */

export function createWeatherWidget() {
  const card = h('article.card.wx-card', { id: 'w-weather' });
  makeExpandable(card, (source) => openWeatherPanel({ source }));
  renderWeather(card);
  return card;
}

function worstAlert(model) {
  const alerts = model.alerts ?? [];
  if (!alerts.length) return null;
  const rank = (a) => (/extreme/i.test(a.severity) ? 3 : /severe/i.test(a.severity) ? 2
    : /moderate/i.test(a.severity) ? 1 : 0);
  return [...alerts].sort((a, b) => rank(b) - rank(a))[0];
}

export function renderWeather(card) {
  const model = live.weather;
  if (!model) return fill(card, skeleton());

  const now = model.current;
  const today = model.daily?.[0];
  const hours = nextHours(model, 8);

  const alert = worstAlert(model);
  /* Alert escalation (handoff §Interactions): a watch is a strip inside
     the card; an active *warning* means the whole card adopts the alert
     styling and the hourly strip switches from glyphs to rain odds. */
  const warning = !!alert && /warning/i.test(alert.event ?? '');
  card.classList.toggle('warning', warning);

  fill(card,
    h('div.label', 'Right now'),
    warning ? warningHead(alert) : null,

    h('div.wx-top',
      h('div.wx-now',
        h('div.wx-temp.num', temp(now.temp)),
        h('div.wx-summary', now.summary || CONDITION_LABEL[now.condition]),
        h('div.wx-sub', warning ? heaviestLine(model, now) : hiloLine(today)),
      ),
      h('div.wx-glyph', weatherIcon(now.condition, { size: 78, night: now.night })),
    ),

    warning ? null : strip(model, alert),

    h('div.wx-hours', ...hours.map((hour, i) => hourColumn(hour, i, warning))),
  );
}

/* "SEVERE THUNDERSTORM WARNING · UNTIL 7 PM" with the pulsing dot. */
function warningHead(alert) {
  const until = alert.ends ? ` · until ${clockTime(alert.ends)}` : '';
  return h('div.wx-warning-head',
    h('span.wx-warning-dot'),
    h('span.wx-warning-text', `${alert.event}${until}`),
  );
}

function hiloLine(today) {
  if (!today) return null;
  return h('span', `H ${temp(today.hi)}  L ${temp(today.lo)}`);
}

/* The warning card trades the H/L line for when it peaks. */
function heaviestLine(model, now) {
  const window = nextThunderWindow(model) ?? nextPrecipWindow(model);
  const parts = [];
  if (window) parts.push(`Heaviest ${clockTime(window.from)} – ${clockTime(window.to)}`);
  if (now.windGust >= 30) parts.push(`wind gusts to ${Math.round(now.windGust)} mph`);
  return parts.length ? h('span', parts.join(' · ')) : hiloLine(model.daily?.[0]);
}

/**
 * The one strip under the hero (handoff): a watch/advisory in alert
 * tones with its window on the right; otherwise the next rain or storm
 * window in the same shape; otherwise a quiet green all-clear. One
 * strip always — the card's proportions never jump.
 */
function strip(model, alert) {
  const storm = nextThunderWindow(model);
  const rain = nextPrecipWindow(model);
  const window = storm ?? rain;
  const meta = window
    ? `${clockTime(window.from)} – ${clockTime(window.to)}${window.peak ? ` · ${percent(window.peak)} peak` : ''}`
    : null;

  if (alert) {
    return h('button.wx-strip.alert.no-expand', {
      onclick: (e) => { e.stopPropagation(); openWeatherPanel({ tab: 'alerts' }); },
      'aria-label': `Weather alert: ${alert.event}. Open alerts.`,
    },
      icon(alert.isTropical ? 'hurricane' : alert.isThunder ? 'bolt' : 'alert', { size: 18 }),
      h('span.wx-strip-copy', alert.event),
      meta ? h('span.wx-strip-meta', meta) : null,
    );
  }

  const soon = nowcastSentence(live.nowcast);
  if (soon) {
    return h('div.wx-strip.alert',
      icon('umbrella', { size: 18 }),
      h('span.wx-strip-copy', soon),
      h('span.wx-strip-meta', 'next hour'),
    );
  }

  if (window) {
    return h('div.wx-strip.alert',
      icon(storm ? 'bolt' : 'umbrella', { size: 18 }),
      h('span.wx-strip-copy', storm ? 'Storms expected' : 'Rain expected'),
      h('span.wx-strip-meta', meta),
    );
  }

  return h('div.wx-strip.good',
    icon('check', { size: 18 }),
    h('span.wx-strip-copy', 'No rain expected today'),
  );
}

function hourColumn(hour, index, warning) {
  const pct = Math.max(hour.precipChance ?? 0, hour.thunderChance ?? 0);
  return h('div.wx-hour',
    h('div.wx-hour-label', index === 0 ? 'Now' : hourLabel(hour.time)),
    /* During an active warning the glyph slot answers the only question
       anyone has — how likely, hour by hour (handoff 3b). */
    warning
      ? h(`div.wx-hour-pct${pct >= 45 ? '.wet' : ''}`, percent(pct))
      : weatherIcon(hour.condition, { size: 24, night: hour.night }),
    h('div.wx-hour-temp.num', temp(hour.temp)),
  );
}

function skeleton() {
  return h('div.wx-skeleton',
    h('div.skeleton', { style: { width: '45%', height: 'calc(var(--px) * 68)' } }),
    h('div.skeleton', { style: { width: '100%', height: 'calc(var(--px) * 80)' } }),
  );
}

/* ── Five-day outlook — rows with range bars ──────────────── */

export function createForecastWidget() {
  const card = h('article.card.fc-card', { id: 'w-forecast' });
  makeExpandable(card, (source) => openWeatherPanel({ source, tab: 'daily' }));
  renderForecast(card);
  return card;
}

/**
 * A row per day (handoff): day · precip % · horizontal range bar · low ·
 * high. The bar's track spans the whole run's range, so the shape of the
 * week is readable without a single number.
 */
export function renderForecast(card) {
  const model = live.weather;
  if (!model?.daily?.length) {
    return fill(card, h('div.label', 'Next 5 days'), h('div.skeleton', { style: { flex: '1' } }));
  }

  const days = model.daily.slice(0, 5);
  const lows = days.map((d) => d.lo).filter((v) => v != null);
  const highs = days.map((d) => d.hi).filter((v) => v != null);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const span = Math.max(1, max - min);

  fill(card,
    h('div.label', 'Next 5 days'),
    /* Column captions, sharing the row's exact widths so each caption
       sits over its number: low left of the bar, high right of it,
       rain chance on the end. */
    h('div.fc-head',
      h('span.fc-day'),
      h('span.fc-lo', 'L'),
      h('div.fc-bar-space'),
      h('span.fc-hi', 'H'),
      h('span.fc-pop', 'Rain'),
    ),
    h('div.fc-rows', ...days.map((day) => dayRow(day, { min, span }))),
  );
}

function dayRow(day, { min, span }) {
  const today = isToday(day.date);
  const left = ((day.lo - min) / span) * 100;
  const right = 100 - ((day.hi - min) / span) * 100;
  const wet = (day.precipChance ?? 0) >= 70;

  /* Reads as the bar it decorates: low on the left end, high on the
     right end, the rain odds after everything. */
  return h(`div.fc-row${today ? '.today' : ''}`,
    h('span.fc-day', today ? 'Today' : weekday(day.date)),
    h('span.fc-lo.num', temp(day.lo)),
    h('div.fc-bar',
      h('div.fc-bar-fill', {
        style: { left: `${left.toFixed(0)}%`, right: `${right.toFixed(0)}%` },
      }),
    ),
    h('span.fc-hi.num', temp(day.hi)),
    h(`span.fc-pop${wet ? '.wet' : ''}`, day.precipChance >= 5 ? percent(day.precipChance) : ''),
  );
}
