/* The full weather experience.

   Six tabs behind one card: the day ahead, hour by hour, ten days,
   live radar, active alerts, and air quality. */

import { h, fill, toast } from '../core/dom.js';
import {
  clockTime, hourLabel, weekday, relativeDay, monthDay, isToday, relativeTime,
} from '../core/time.js';
import {
  temp, percent, speed, precip, windDir, distance, pressure, tidy,
  aqiBand, uvBand, pollenBand,
} from '../core/format.js';
import { moonPhase } from '../core/solar.js';
import { icon, weatherIcon, moonIcon } from './icons.js';
import { openPanel, onPanelClose, onTabClose, setPanelTab, activeTabId, redrawPanel } from '../core/panel.js';
import { live, refresh } from '../data/hub.js';
import { on } from '../core/store.js';
import { nextPrecipWindow, nextThunderWindow, nextHours } from '../data/weather.js';
import { CONDITION_LABEL } from '../data/conditions.js';
import { dayAheadChart, meter } from './charts.js';
import { mountRadar } from './radar.js';
import { state } from '../core/store.js';
import { CALM, MILD, NOTABLE, HIGH, EXTREME, CRITICAL, tempColor } from '../core/palette.js';


export function openWeatherPanel({ source, tab = 'today' } = {}) {
  openPanel({
    id: 'weather',
    title: state.place.name,
    source,
    tabs: [
      { id: 'today',  label: 'Today',  render: renderToday },
      { id: 'hourly', label: 'Hourly', render: renderHourly },
      { id: 'daily',  label: '10 Days', render: renderDaily },
      { id: 'radar',  label: 'Radar',  render: renderRadar, flush: true },
      { id: 'alerts', label: alertsLabel(), render: renderAlerts },
      { id: 'air',    label: 'Air',    render: renderAir },
    ],
    actions: [
      h('button.icon-btn', {
        onclick: async (e) => {
          const btn = e.currentTarget;
          btn.classList.add('spinning');
          await refresh.all();
          btn.classList.remove('spinning');
          toast('Weather refreshed');
        },
        'aria-label': 'Refresh weather',
      }, icon('refresh', { size: 22 })),
    ],
  }).then(() => {
    /* Keep the panel live. Without this, opening it before the first
       fetch lands would leave it on skeletons forever, and a background
       refresh would never reach the screen. The radar tab is excluded —
       it owns its own map and updates itself in place. */
    const redraw = () => { if (activeTabId() !== 'radar') redrawPanel(); };
    const stops = ['weather', 'air', 'storms'].map((topic) => on(topic, redraw));
    onPanelClose(() => stops.forEach((stop) => stop()));

    // Data can land while the panel is still animating open, after the
    // first render but before the subscription exists — so draw once more.
    if (tab !== 'today') setPanelTab(tab);
    else redraw();
  });
}

function alertsLabel() {
  const count = live.weather?.alerts?.length ?? 0;
  return count ? `Alerts · ${count}` : 'Alerts';
}

/* ── Today ────────────────────────────────────────────────── */

function renderToday(body) {
  const model = live.weather;
  if (!model) return fill(body, loading());

  const now = model.current;
  const today = model.daily?.[0];
  const rain = nextPrecipWindow(model);
  const storm = nextThunderWindow(model);
  const moon = moonPhase();

  fill(body,
    h('div.today-hero',
      h('div.today-hero-main',
        weatherIcon(now.condition, { size: 150, night: now.night }),
        h('div',
          h('div.today-temp.num', temp(now.temp)),
          h('div.today-summary', now.summary || CONDITION_LABEL[now.condition]),
          today
            ? h('div.today-range',
                h('span', { style: { color: 'var(--warm)' } }, `H ${temp(today.hi)}`),
                h('span', { style: { color: 'var(--cool)' } }, `L ${temp(today.lo)}`),
                now.feelsLike != null ? h('span.muted', `Feels ${temp(now.feelsLike)}`) : null,
              )
            : null,
        ),
      ),
      /* The right of this band was empty while the most urgent thing on
         the whole panel — an active warning — sat behind a tab. When
         nothing is in force, the sun and moon fill it instead, because a
         blank half is worse than a quiet one. */
      heroAside(model, today, moon),
    ),

    /* The two questions a family actually asks the hub. */
    (storm || rain)
      ? h('div.timing-cards',
          storm ? timingCard({
            kind: 'storm',
            glyph: 'bolt',
            title: 'Storm risk',
            window: storm,
            detail: `${percent(storm.peak)} chance at peak`,
          }) : null,
          rain ? timingCard({
            kind: 'rain',
            glyph: 'umbrella',
            title: 'Rain likely',
            window: rain,
            detail: `${percent(rain.peak)} chance at peak`,
          }) : null,
        )
      : h('div.timing-cards',
          h('div.timing-card.clear',
            h('span.timing-icon', icon('check', { size: 26, stroke: 2.6 })),
            h('div',
              h('div.timing-title', 'No rain expected'),
              h('div.timing-detail', 'Nothing above 40% in the next 24 hours'),
            ),
          ),
        ),

    h('div.section',
      h('div.section-head',
        h('div.label', 'Next 24 hours'),
        /* Naming the three series was not the same as saying which was
           which. These swatches match the chart's own fills exactly. */
        h('div.chart-key',
          h('span.key-item', h('span.key-swatch.key-rain'), 'Rain chance'),
          h('span.key-item', h('span.key-swatch.key-storm'), 'Storm risk'),
          h('span.key-item', h('span.key-swatch.key-temp'), 'Temperature'),
        ),
      ),
      h('div.chart-wrap', dayAheadChart(nextHours(model, 24))),
    ),

    h('div.section',
      h('div.section-head', h('div.label', 'Conditions')),
      h('div.detail-grid',
        detail('thermometer', 'Feels like', temp(now.feelsLike)),
        detail('droplet', 'Humidity', percent(now.humidity)),
        detail('droplet', 'Dew point', temp(now.dewPoint)),
        detail('wind', 'Wind', now.windSpeed != null ? `${windDir(now.windDir)} ${speed(now.windSpeed)}` : '—'),
        now.windGust ? detail('wind', 'Gusts', speed(now.windGust)) : null,
        detail('layers', 'Cloud cover', percent(now.cloudCover)),
        now.pressure ? detail('gauge', 'Pressure', pressure(now.pressure)) : null,
        now.visibility ? detail('eye', 'Visibility', distance(now.visibility)) : null,
        today?.sunrise ? detail('sunrise', 'Sunrise', clockTime(today.sunrise)) : null,
        today?.sunset ? detail('sunset', 'Sunset', clockTime(today.sunset)) : null,
        detail('moon', 'Moon', moon.name, moonIcon(moon.fraction, { size: 30 })),
        today?.precipAmount ? detail('umbrella', 'Rain today', precip(today.precipAmount)) : null,
      ),
    ),

    today?.detail
      ? h('div.section',
          h('div.section-head', h('div.label', 'Forecast discussion')),
          h('p.narrative', today.detail),
          today.nightDetail ? h('p.narrative.muted', `Tonight — ${today.nightDetail}`) : null,
        )
      : null,

    sourceNote(model),
  );
}

/**
 * The right half of the hero band.
 *
 * Active warnings come first and tapping one goes straight to its full
 * text — a hub that knows about a tornado warning should not make you
 * find the Alerts tab to learn that. With nothing in force it shows the
 * day's shape instead: sunrise, sunset, and tonight's moon.
 */
function heroAside(model, today, moon) {
  const alerts = model.alerts ?? [];

  if (alerts.length) {
    return h('div.hero-aside',
      ...alerts.slice(0, 2).map((alert) => {
        const severe = /extreme|severe/i.test(alert.severity || '');
        return h(`button.hero-alert${severe ? '.severe' : ''}`, {
          onclick: () => setPanelTab('alerts'),
          'aria-label': `${alert.event}. Open alert details.`,
        },
          h('span.hero-alert-icon',
            icon(alert.isTropical ? 'hurricane' : alert.isThunder ? 'bolt' : 'alert', { size: 26 })),
          h('div.hero-alert-text',
            h('div.hero-alert-event', alert.event),
            h('div.hero-alert-when', alert.ends ? `Until ${clockTime(alert.ends)}` : alert.severity),
          ),
        );
      }),
      alerts.length > 2
        ? h('button.hero-alert-more', { onclick: () => setPanelTab('alerts') },
            `${alerts.length - 2} more`)
        : null,
    );
  }

  if (!today?.sunrise && !today?.sunset) return null;

  return h('div.hero-aside',
    h('div.hero-sun',
      today.sunrise ? h('div.hero-sun-item',
        icon('sunrise', { size: 24 }),
        h('div',
          h('div.hero-sun-label', 'Sunrise'),
          h('div.hero-sun-value.num', clockTime(today.sunrise)),
        ),
      ) : null,
      today.sunset ? h('div.hero-sun-item',
        icon('sunset', { size: 24 }),
        h('div',
          h('div.hero-sun-label', 'Sunset'),
          h('div.hero-sun-value.num', clockTime(today.sunset)),
        ),
      ) : null,
      moon ? h('div.hero-sun-item',
        moonIcon(moon.fraction, { size: 26 }),
        h('div',
          h('div.hero-sun-label', 'Moon'),
          h('div.hero-sun-value', moon.name),
        ),
      ) : null,
    ),
  );
}

function timingCard({ kind, glyph, title, window: w, detail: detailText }) {
  const until = new Date(+w.to + 3600e3);
  const started = +w.from <= Date.now();
  // "starts 8m ago" is nonsense once a window is open; say what's true.
  const when = started
    ? (+until > Date.now() ? `under way, eases ${relativeTime(until)}` : 'ending now')
    : `starts ${relativeTime(w.from)}`;

  return h(`div.timing-card.${kind}`,
    h('span.timing-icon', icon(glyph, { size: 26, stroke: 2.4 })),
    h('div',
      h('div.timing-title', title),
      h('div.timing-window', `${clockTime(w.from)} – ${clockTime(until)}`),
      h('div.timing-detail', `${detailText} · ${when}`),
    ),
  );
}

function detail(glyph, label, value, custom) {
  return h('div.detail-cell.well',
    h('div.detail-head',
      custom ?? icon(glyph, { size: 20 }),
      h('span', label),
    ),
    h('div.detail-value', value),
  );
}

/* ── Hourly ───────────────────────────────────────────────── */

function renderHourly(body) {
  const model = live.weather;
  if (!model) return fill(body, loading());

  const hours = nextHours(model, 48);
  let lastDay = null;

  fill(body,
    h('div.chart-wrap.tall', dayAheadChart(hours, { count: 24 })),
    h('div.hourly-list',
      ...hours.flatMap((hour) => {
        const dayKey = hour.time.toDateString();
        const header = dayKey !== lastDay
          ? h('div.hourly-day', relativeDay(hour.time))
          : null;
        lastDay = dayKey;

        const stormy = hour.thunderChance >= 25;
        return [header, h(`div.hourly-row${stormy ? '.stormy' : ''}`,
          h('div.hourly-time', isToday(hour.time) && hour === hours[0] ? 'Now' : hourLabel(hour.time)),
          h('div.hourly-icon', weatherIcon(hour.condition, { size: 36, night: hour.night })),
          h('div.hourly-cond', hour.summary || CONDITION_LABEL[hour.condition]),
          h('div.hourly-temp.num', { style: { color: tempColor(hour.temp) } }, temp(hour.temp)),
          h('div.hourly-pop',
            hour.precipChance >= 5
              ? [icon('droplet', { size: 16 }), percent(hour.precipChance)]
              : h('span.dim', '—')),
          h('div.hourly-storm',
            stormy ? [icon('bolt', { size: 16 }), percent(hour.thunderChance)] : null),
          h('div.hourly-wind',
            icon('wind', { size: 16 }),
            `${speed(hour.windSpeed, { unit: false })}${hour.windGust ? ` (${speed(hour.windGust, { unit: false })})` : ''}`),
        )];
      }),
    ),
  );
}

/* ── Ten days ─────────────────────────────────────────────── */

function renderDaily(body) {
  const model = live.weather;
  if (!model?.daily?.length) return fill(body, loading());

  const days = model.daily;
  const lows = days.map((d) => d.lo).filter((v) => v != null);
  const highs = days.map((d) => d.hi).filter((v) => v != null);
  const min = Math.min(...lows), max = Math.max(...highs);
  const span = Math.max(1, max - min);

  let expanded = null;

  const list = h('div.daily-list');
  const draw = () => {
    fill(list, ...days.map((day, i) => {
      const open = expanded === i;
      return h(`div.daily-item${open ? '.open' : ''}`,
        h('button.daily-row', {
          onclick: () => { expanded = open ? null : i; draw(); },
        },
          h('div.daily-day',
            h('div.daily-day-name', isToday(day.date) ? 'Today' : weekday(day.date)),
            h('div.daily-day-date', monthDay(day.date)),
          ),
          h('div.daily-icon', weatherIcon(day.condition, { size: 42 })),
          h('div.daily-pop', day.precipChance >= 10
            ? [icon('droplet', { size: 16 }), percent(day.precipChance)] : null),
          h('div.daily-lo.num', temp(day.lo)),
          h('div.daily-bar',
            h('div.daily-bar-fill', {
              style: {
                left: `${((day.lo - min) / span) * 100}%`,
                width: `${Math.max(6, ((day.hi - day.lo) / span) * 100)}%`,
                background: `linear-gradient(to right, ${tempColor(day.lo)}, ${tempColor(day.hi)})`,
              },
            }),
          ),
          h('div.daily-hi.num', temp(day.hi)),
          h('div.daily-chevron', icon(open ? 'chevronUp' : 'chevronDown', { size: 20 })),
        ),

        open
          ? h('div.daily-detail',
              day.detail ? h('p.narrative', day.detail) : null,
              day.nightDetail ? h('p.narrative.muted', `Tonight — ${day.nightDetail}`) : null,
              h('div.detail-grid.compact',
                detail('umbrella', 'Rain chance', percent(day.precipChance)),
                day.precipAmount ? detail('droplet', 'Amount', precip(day.precipAmount)) : null,
                day.thunderChance ? detail('bolt', 'Storm risk', percent(day.thunderChance)) : null,
                day.windSpeed ? detail('wind', 'Wind', speed(day.windSpeed)) : null,
                day.sunrise ? detail('sunrise', 'Sunrise', clockTime(day.sunrise)) : null,
                day.sunset ? detail('sunset', 'Sunset', clockTime(day.sunset)) : null,
                day.uvMax != null ? detail('sunrise', 'UV max', Math.round(day.uvMax)) : null,
              ),
            )
          : null,
      );
    }));
  };
  draw();

  fill(body, list, sourceNote(model));
}

/* ── Radar ────────────────────────────────────────────────── */

function renderRadar(body) {
  const host = h('div.radar-host');
  fill(body, host);
  const radar = mountRadar(host, {
    onAlertTap: (alert) => {
      setPanelTab('alerts');
      requestAnimationFrame(() => {
        document.getElementById(`alert-${cssId(alert.id)}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    },
  });
  // Tab-scoped: switching to another tab must stop the animation loop
  // and release the tile cache, not just closing the panel.
  onTabClose(() => radar.destroy());
}

/* ── Alerts ───────────────────────────────────────────────── */

function renderAlerts(body) {
  const alerts = live.weather?.alerts ?? [];
  const storms = live.storms ?? [];

  if (!alerts.length && !storms.length) {
    return fill(body, h('div.empty',
      icon('check', { size: 52, stroke: 1.6 }),
      h('div', 'No active weather alerts'),
      h('div.dim', `Nothing in effect for ${state.place.name}`),
    ));
  }

  /* Today's warnings first, always — a heat advisory in effect matters
     more than a depression 3,000 miles out. Distant systems compress to
     one line each; only something close enough to plan around keeps the
     full stat card. */
  const NEARBY_MILES = 750;
  const near = storms.filter((s) => s.distanceMiles == null || s.distanceMiles <= NEARBY_MILES);
  const far = storms.filter((s) => s.distanceMiles != null && s.distanceMiles > NEARBY_MILES);

  fill(body,
    alerts.length
      ? h('div.section',
          h('div.section-head', h('div.label', `${alerts.length} active alert${alerts.length > 1 ? 's' : ''}`)),
          h('div.alert-cards', ...alerts.map(alertCard)),
        )
      : null,

    near.length
      ? h('div.section',
          h('div.section-head', h('div.label', 'Tropical systems')),
          h('div.storm-cards', ...near.map(stormCard)),
        )
      : null,

    far.length
      ? h('div.section',
          h('div.section-head',
            h('div.label', 'Distant systems'),
            h('div.note', 'being watched, no local threat'),
          ),
          h('div.storm-lines', ...far.map(stormLine)),
        )
      : null,
  );
}

/** A distant system in one line: name, class, how far. */
function stormLine(storm) {
  return h('div.storm-line', { style: { '--storm': storm.color } },
    h('span.storm-line-icon', icon('hurricane', { size: 20 })),
    h('span.storm-line-name', storm.name),
    h('span.storm-line-label', storm.label),
    h('span.storm-line-dist',
      `${Math.round(storm.distanceMiles).toLocaleString()} mi away`,
      storm.movementDir != null && storm.movementSpeed
        ? ` · ${windDir(storm.movementDir)} at ${storm.movementSpeed} mph`
        : null,
    ),
  );
}

const cssId = (value) => String(value).replace(/[^a-z0-9]/gi, '-').slice(-40);

function alertCard(alert) {
  const severity = (alert.severity || 'Unknown').toLowerCase();
  return h(`article.alert-card.sev-${severity}`, { id: `alert-${cssId(alert.id)}` },
    h('div.alert-card-head',
      h('span.alert-card-icon',
        icon(alert.isTropical ? 'hurricane' : alert.isThunder ? 'bolt' : 'alert', { size: 26 })),
      h('div.alert-card-titles',
        h('h3.alert-card-title', alert.event),
        h('div.alert-card-when',
          alert.onset ? `From ${clockTime(alert.onset)}` : null,
          alert.ends ? ` until ${relativeDay(alert.ends)} ${clockTime(alert.ends)}` : null,
        ),
      ),
      h('span.alert-card-sev', alert.severity),
    ),

    alert.headline ? h('p.alert-headline', alert.headline) : null,
    alert.description ? h('p.alert-body', tidy(alert.description, 900)) : null,

    alert.instruction
      ? h('div.alert-instruction',
          h('div.label', 'What to do'),
          h('p', tidy(alert.instruction, 500)),
        )
      : null,

    h('div.alert-meta',
      alert.areaDesc ? h('span', icon('pin', { size: 16 }), alert.areaDesc) : null,
      alert.sender ? h('span.dim', alert.sender) : null,
    ),
  );
}

function stormCard(storm) {
  return h('article.storm-card', { style: { '--storm': storm.color } },
    h('div.storm-card-head',
      h('span.storm-card-icon', icon('hurricane', { size: 30 })),
      h('div',
        h('h3.storm-card-name', storm.name),
        h('div.storm-card-label', storm.label),
      ),
      storm.distanceMiles != null
        ? h('div.storm-card-distance',
            h('div.num', distance(storm.distanceMiles)),
            h('div.dim', 'away'),
          )
        : null,
    ),
    h('div.detail-grid.compact',
      storm.windMph ? detail('wind', 'Max winds', `${storm.windMph} mph`) : null,
      storm.pressure ? detail('gauge', 'Pressure', `${storm.pressure} mb`) : null,
      storm.movementSpeed
        ? detail('crosshair', 'Moving', `${windDir(storm.movementDir)} at ${storm.movementSpeed} mph`)
        : null,
      storm.lastUpdate ? detail('clock', 'Updated', clockTime(storm.lastUpdate)) : null,
    ),
  );
}

/* ── Air ──────────────────────────────────────────────────── */

function renderAir(body) {
  const air = live.air;
  if (!air) return fill(body, loading());

  const aqi = aqiBand(air.aqi);
  const uv = uvBand(air.uv);

  fill(body,
    h('div.air-hero',
      h('div.air-hero-block',
        h('div.label', 'US Air Quality Index'),
        h('div.air-hero-value.num', { style: { color: aqi?.color } }, air.aqi ?? '—'),
        h('div.air-hero-band', aqi?.label ?? 'Unknown'),
        h('div.air-hero-note', aqi?.note ?? ''),
        h('div.chart-wrap.short', meter(air.aqi, {
          max: 300,
          stops: [
            { at: 0, color: CALM }, { at: 50, color: MILD },
            { at: 100, color: NOTABLE }, { at: 150, color: HIGH },
            { at: 200, color: EXTREME }, { at: 300, color: CRITICAL },
          ],
        })),
      ),

      h('div.air-hero-block',
        h('div.label', 'UV Index'),
        h('div.air-hero-value.num', { style: { color: uv?.color } },
          air.uv != null ? Math.round(air.uv) : '—'),
        h('div.air-hero-band', uv?.label ?? 'Unknown'),
        h('div.air-hero-note',
          air.uvPeak
            ? `Peaks around ${clockTime(air.uvPeak.time)} at ${Math.round(air.uvPeak.value)}`
            : (uv?.note ?? '')),
        h('div.chart-wrap.short', meter(air.uv, {
          max: 12,
          stops: [
            { at: 0, color: CALM }, { at: 3, color: MILD },
            { at: 6, color: NOTABLE }, { at: 8, color: HIGH },
            { at: 11, color: EXTREME },
          ],
        })),
      ),
    ),

    h('div.section',
      h('div.section-head', h('div.label', 'Pollutants')),
      h('div.detail-grid',
        detail('gauge', 'PM2.5', air.pm25 != null ? `${Math.round(air.pm25)} µg/m³` : '—'),
        detail('gauge', 'PM10', air.pm10 != null ? `${Math.round(air.pm10)} µg/m³` : '—'),
        detail('gauge', 'Ozone', air.ozone != null ? `${Math.round(air.ozone)} µg/m³` : '—'),
        detail('gauge', 'NO₂', air.no2 != null ? `${Math.round(air.no2)} µg/m³` : '—'),
        detail('gauge', 'SO₂', air.so2 != null ? `${Math.round(air.so2)} µg/m³` : '—'),
        detail('gauge', 'CO', air.co != null ? `${Math.round(air.co)} µg/m³` : '—'),
      ),
    ),

    h('div.section',
      h('div.section-head', h('div.label', 'Pollen')),
      air.pollenUnavailable
        ? h('p.narrative.muted',
            'Open-Meteo’s free pollen model only covers Europe, so there is no pollen data for this location. ' +
            'Everything else on this tab is live.')
        : h('div.pollen-rows', ...air.pollen.map((p) => {
            const band = pollenBand(p.value);
            return h('div.pollen-row',
              h('span.pollen-name', p.label),
              h('div.pollen-bar',
                h('div.pollen-bar-fill', {
                  style: {
                    width: `${Math.min(100, (p.value / 200) * 100)}%`,
                    background: band?.color,
                  },
                })),
              h('span.pollen-value', { style: { color: band?.color } }, band?.label ?? '—'),
            );
          })),
    ),
  );
}

/* ── Shared bits ──────────────────────────────────────────── */

function loading() {
  return h('div.loading-block',
    ...[1, 2, 3, 4].map(() => h('div.skeleton', { style: { height: 'calc(var(--u) * 12)' } })),
  );
}

function sourceNote(model) {
  const label = model.demo
    ? 'Showing generated demo data'
    : model.source === 'nws'
      ? 'Source: National Weather Service'
      : 'Source: Open-Meteo';
  return h('div.source-note',
    icon('info', { size: 16 }),
    `${label} · updated ${clockTime(model.updated)}`,
  );
}
