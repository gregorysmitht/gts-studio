/* Air quality tile: AQI, UV, and pollen when the source has it.

   Open-Meteo's pollen model only covers Europe, so outside it the
   pollen row is replaced by the dominant pollutant rather than shown
   empty. Tapping opens the weather panel's Air tab. */

import { h, fill } from '../core/dom.js';
import { clockTime } from '../core/time.js';
import { aqiBand, uvBand, pollenBand } from '../core/format.js';
import { icon } from './icons.js';
import { makeExpandable } from '../core/panel.js';
import { live } from '../data/hub.js';
import { topPollen } from '../data/airquality.js';
import { openWeatherPanel } from './weather-panel.js';

export function createAirWidget() {
  const card = h('article.card.air-card', { id: 'w-air' });
  makeExpandable(card, (source) => openWeatherPanel({ source, tab: 'air' }));
  renderAir(card);
  return card;
}

export function renderAir(card) {
  const air = live.air;
  if (!air) {
    return fill(card, h('div.label', 'Air'), h('div.skeleton', { style: { flex: 1, marginTop: 'var(--u)' } }));
  }

  const aqi = aqiBand(air.aqi);
  const uv = uvBand(air.uv);
  const pollen = topPollen(air);
  const pollenLevel = pollen ? pollenBand(pollen.value) : null;

  fill(card,
    h('div.label', 'Air & sun'),

    h('div.air-main',
      h('div.air-dial', { style: { '--ring': aqi?.color ?? 'var(--fg-4)' } },
        ring(air.aqi, 0, 200),
        h('div.air-dial-value.num', air.aqi ?? '—'),
      ),
      h('div.air-main-text',
        h('div.air-band', { style: { color: aqi?.color } }, aqi?.label ?? 'Unknown'),
        h('div.air-sub', 'US AQI'),
      ),
    ),

    h('div.air-rows',
      statRow('sunrise', 'UV Index', uv ? `${Math.round(air.uv)} · ${uv.label}` : '—', uv?.color,
        air.uvPeak && air.uvPeak.value > (air.uv ?? 0)
          ? `peaks ${clockTime(air.uvPeak.time)}`
          : uv?.note),

      /* Only two rows fit legibly on a tile this size; the rest of the
         pollutants live one tap away in the Air tab. */
      pollen
        ? statRow('flame', `${pollen.label} pollen`, pollenLevel?.label ?? '—', pollenLevel?.color,
            'highest today')
        : statRow('gauge', 'Fine particles',
            air.pm25 != null ? `${Math.round(air.pm25)}` : '—', null, 'PM2.5 µg/m³'),
    ),
  );
}

function statRow(glyph, label, value, color, note) {
  return h('div.air-row',
    h('span.air-row-icon', { style: color ? { color } : null }, icon(glyph, { size: 20 })),
    h('span.air-row-text',
      h('span.air-row-label', label),
      note ? h('span.air-row-note', note) : null,
    ),
    h('span.air-row-value', { style: color ? { color } : null }, value),
  );
}

/** Sweep ring for the AQI dial. */
function ring(value, min, max) {
  const pct = value == null ? 0 : Math.max(0, Math.min(1, (value - min) / (max - min)));
  const r = 42;
  const circumference = 2 * Math.PI * r;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', 'air-ring');
  svg.innerHTML = `
    <circle cx="50" cy="50" r="${r}" fill="none"
            stroke="rgba(255,255,255,0.12)" stroke-width="9" stroke-linecap="round"
            stroke-dasharray="${circumference}"
            stroke-dashoffset="${circumference * 0.25}"
            transform="rotate(135 50 50)"/>
    <circle cx="50" cy="50" r="${r}" fill="none"
            stroke="var(--ring)" stroke-width="9" stroke-linecap="round"
            stroke-dasharray="${circumference}"
            stroke-dashoffset="${circumference * (1 - pct * 0.75)}"
            transform="rotate(135 50 50)"/>`;
  return svg;
}
