/* The home screen: one glanceable grid, everything one tap deep. */

import { $, fill } from '../core/dom.js';
import { on } from '../core/store.js';
import { createWeatherWidget, createForecastWidget, renderWeather, renderForecast } from './weather-widget.js';
import { createCalendarWidget, renderCalendarWidget } from './calendar-widget.js';
import { createAirWidget, renderAir } from './air-widget.js';
import { createListsWidget } from './lists.js';
import { createChoresWidget } from './chores.js';

let widgets = {};

export function mountHome() {
  const grid = $('#grid');

  widgets = {
    weather: createWeatherWidget(),
    calendar: createCalendarWidget(),
    air: createAirWidget(),
    forecast: createForecastWidget(),
    lists: createListsWidget(),
    chores: createChoresWidget(),
  };

  fill(grid,
    widgets.weather,
    widgets.calendar,
    widgets.air,
    widgets.forecast,
    widgets.lists,
    widgets.chores,
  );

  /* Each feed repaints only the cards that show it. */
  on('weather', () => {
    renderWeather(widgets.weather);
    renderForecast(widgets.forecast);
  });
  on('air', () => renderAir(widgets.air));
  on('calendar', () => renderCalendarWidget(widgets.calendar));
  on('reminders', () => renderCalendarWidget(widgets.calendar));
  on('settings', () => {
    renderWeather(widgets.weather);
    renderForecast(widgets.forecast);
    renderAir(widgets.air);
  });
}
