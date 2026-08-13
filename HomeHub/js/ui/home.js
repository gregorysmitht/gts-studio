/* The home screen: one glanceable grid, everything one tap deep. */

import { $, fill } from '../core/dom.js';
import { on } from '../core/store.js';
import { createWeatherWidget, createForecastWidget, renderWeather, renderForecast } from './weather-widget.js';
import { createCalendarWidget, renderCalendarWidget } from './calendar-widget.js';

let widgets = {};

/* Three cards, not six. Air quality, lists and chores came off the wall:
   they were the three smallest tiles, read the least, and cost the two
   cards a family actually walks up for — weather and the schedule —
   a third of the screen between them. Their panels and data still
   exist; they just need a new front door when one is wanted. */
export function mountHome() {
  const grid = $('#grid');

  widgets = {
    weather: createWeatherWidget(),
    calendar: createCalendarWidget(),
    forecast: createForecastWidget(),
  };

  fill(grid,
    widgets.weather,
    widgets.calendar,
    widgets.forecast,
  );

  /* Each feed repaints only the cards that show it. */
  on('weather', () => {
    renderWeather(widgets.weather);
    renderForecast(widgets.forecast);
  });
  on('calendar', () => renderCalendarWidget(widgets.calendar));
  on('reminders', () => renderCalendarWidget(widgets.calendar));
  on('settings', () => {
    renderWeather(widgets.weather);
    renderForecast(widgets.forecast);
  });
}
