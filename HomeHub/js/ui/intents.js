/* Siri App Intents land here.
 *
 * The shell pushes { action } over the bridge and the hub walks to that
 * screen the way a hand would have: wake from the screensaver, put down
 * whatever panel was up, then go. Reminders and calendar Siri commands
 * never pass through this file — those hit the shared Apple databases
 * and arrive as data.
 */

import { onNativeEvent } from '../core/native.js';
import { closePanel } from '../core/panel.js';
import { enterAmbient, exitAmbient, isAmbient } from './ambient.js';
import { openWeatherPanel } from './weather-panel.js';
import { openCalendarPanel } from './calendar-panel.js';
import { openChoresPanel } from './chores.js';
import { openListsPanel } from './lists.js';
import { openMusicPanel } from './music-panel.js';
import { hasTrack } from '../data/music.js';

const ROUTES = {
  radar: () => openWeatherPanel({ tab: 'radar' }),
  weather: () => openWeatherPanel({}),
  calendar: () => openCalendarPanel({}),
  chores: () => openChoresPanel({}),
  lists: () => openListsPanel({}),
  music: () => openMusicPanel({ tab: hasTrack() ? 'playing' : 'browse' }),
  screensaver: () => enterAmbient(),
  home: () => {},   // the shared wake + close IS the destination
};

export function startIntentRouter() {
  onNativeEvent('intent', ({ action } = {}) => {
    const route = ROUTES[action];
    if (!route) return;
    if (action !== 'screensaver' && isAmbient()) exitAmbient();
    closePanel({ instant: true });
    route();
  });
}
