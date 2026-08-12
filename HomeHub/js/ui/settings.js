/* Settings.

   Everything that makes the hub *this family's* hub: where it is, whose
   calendars it shows, who lives here, and how it behaves on the wall. */

import { h, fill, toast } from '../core/dom.js';
import { icon } from './icons.js';
import { openPanel, setPanelTab, closePanel } from '../core/panel.js';
import {
  state, save, update, uid, resetAll, nextColor, PALETTE, photos,
} from '../core/store.js';
import { searchPlaces, currentPosition } from '../data/geocode.js';
import { normalizeFeedUrl } from '../data/calendar.js';
import { live, refresh } from '../data/hub.js';
import { emit } from '../core/store.js';
import { clockTime } from '../core/time.js';
import {
  isNative, nativeSummary, calendarAuthStatus, requestCalendarAccess, nativeCalendars,
} from '../core/native.js';
import { musicAvailable, musicAuthStatus } from '../data/music.js';
import {
  remindersAvailable, reminderState, reminderAuth, connectReminders,
  loadReminderLists, isListShown, toggleList,
} from '../data/reminders.js';
import { ensureMusicAccess } from './music-panel.js';
import { photoGrid, addPhotos } from './photo-grid.js';

export function openSettings(section = 'location') {
  openPanel({
    id: 'settings',
    title: 'Settings',
    tabs: [
      { id: 'location',  label: 'Location',  render: renderLocation },
      { id: 'calendars', label: 'Calendars', render: renderCalendars },
      { id: 'family',    label: 'Family',    render: renderFamily },
      { id: 'display',   label: 'Display',   render: renderDisplay },
      { id: 'ambient',   label: 'Photos',    render: renderAmbient },
      { id: 'sources',   label: 'Data',      render: renderSources },
      // Only meaningful inside the native shell; hidden in Safari.
      ...(isNative() ? [{ id: 'device', label: 'Device', render: renderDevice }] : []),
    ],
  }).then(() => { if (section !== 'location') setPanelTab(section); });
}

/* ── Device (native app only) ─────────────────────────────── */

function renderDevice(body) {
  const status = h('div.source-row-value', 'Checking…');
  const musicStatus = h('div.source-row-value', 'Checking…');
  const remStatus = h('div.source-row-value', 'Checking…');
  const calList = h('div.calendar-list');
  const remList = h('div.calendar-list');

  const paint = async () => {
    // Not awaited: the two permissions are independent, and a slow
    // MusicKit round trip shouldn't hold up the calendar list.
    musicAuthStatus().then((auth) => fill(musicStatus, {
      granted: 'Connected to Apple Music',
      denied: 'Access denied — enable it in iPadOS Settings › Privacy › Media & Apple Music',
      notDetermined: 'Not connected yet',
      unavailable: 'Unavailable in this build',
    }[auth] ?? auth));

    if (remindersAvailable()) {
      reminderAuth().then(async (auth) => {
        fill(remStatus, {
          granted: 'Connected to Reminders',
          denied: 'Access denied — enable it in iPadOS Settings › Privacy › Reminders',
          notDetermined: 'Not connected yet',
          unavailable: 'Unavailable in this build',
        }[auth] ?? auth);

        if (auth !== 'granted') return fill(remList);
        const lists = await loadReminderLists();
        fill(remList, ...lists.map((list) => h('div.calendar-row.well',
          h('span.color-dot.big', { style: { background: list.color || 'var(--accent)' } }),
          h('div.calendar-row-main',
            h('div.calendar-row-name', list.name),
            h('div.calendar-row-meta', h('span.dim', list.source || 'Reminders')),
          ),
          h('button.switch', {
            role: 'switch',
            'aria-checked': isListShown(list.id) ? 'true' : 'false',
            'aria-label': `Show ${list.name}`,
            onclick: () => { toggleList(list.id); paint(); },
          }, h('span.switch-knob')),
        )));
      });
    }

    const auth = await calendarAuthStatus();
    fill(status, {
      granted: 'Connected to the iPad’s Calendar app',
      denied: 'Access denied — enable it in iPadOS Settings › Privacy › Calendars',
      notDetermined: 'Not connected yet',
      unavailable: 'Unavailable in this build',
    }[auth] ?? auth);

    if (auth !== 'granted') return fill(calList);

    try {
      const calendars = await nativeCalendars();
      const chosen = state.deviceCalendars ?? [];
      fill(calList, ...calendars.map((cal) => {
        const on = !chosen.length || chosen.includes(cal.id);
        return h('div.calendar-row.well',
          h('span.color-dot.big', { style: { background: cal.color || 'var(--accent)' } }),
          h('div.calendar-row-main',
            h('div.calendar-row-name', cal.name),
            h('div.calendar-row-meta', h('span.dim', cal.source || 'Calendar')),
          ),
          h('button.switch', {
            role: 'switch',
            'aria-checked': on ? 'true' : 'false',
            'aria-label': `Show ${cal.name}`,
            onclick: () => {
              // Empty means "all"; materialise the full list before excluding.
              let next = chosen.length ? [...chosen] : calendars.map((c) => c.id);
              next = next.includes(cal.id) ? next.filter((id) => id !== cal.id) : [...next, cal.id];
              state.deviceCalendars = next.length === calendars.length ? [] : next;
              save('settings');
              emit('calendars-changed');
              paint();
            },
          }, h('span.switch-knob')),
        );
      }));
    } catch (err) {
      fill(calList, h('div.calendar-error', icon('alert', { size: 15 }), err.message));
    }
  };

  fill(body,
    group('This iPad', nativeSummary(),
      h('div.source-row.well',
        h('div.source-row-main',
          h('div.source-row-label', 'Calendar access'),
          status,
        ),
        h('button.btn', {
          /* Hold the button in a local: `currentTarget` is only valid
             while the event is dispatching, so reading it after an await
             throws and the repaint below never runs — the permission is
             granted but the row still reads "Not connected yet". */
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
              await requestCalendarAccess();
              emit('calendars-changed');
            } catch (err) {
              toast(err.message, 'warn');
            }
            btn.disabled = false;
            paint();
          },
        }, 'Connect'),
      ),

      /* Apple Music asks for its own permission, and nothing else in the
         hub can prompt for it — the mini player only exists once music is
         already playing, which it never will be until this is granted. */
      musicAvailable()
        ? h('div.source-row.well',
            h('div.source-row-main',
              h('div.source-row-label', 'Apple Music'),
              musicStatus,
            ),
            h('button.btn', {
              onclick: async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                try {
                  await ensureMusicAccess();
                } catch (err) {
                  toast(err.message, 'warn');
                }
                btn.disabled = false;
                paint();
              },
            }, 'Connect'),
          )
        : null,
    ),

    remindersAvailable()
      ? group('Reminders',
          'Reminders appear beside events in Up next and on the calendar. ' +
          'Tap one on the wall and it ticks off on everyone\u2019s phone.',
          h('div.source-row.well',
            h('div.source-row-main',
              h('div.source-row-label', 'Reminders access'),
              remStatus,
            ),
            h('button.btn', {
              onclick: async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                try { await connectReminders(); }
                catch (err) { toast(err.message, 'warn'); }
                btn.disabled = false;
                paint();
              },
            }, 'Connect'),
          ),
          remList,
        )
      : null,

    group('Calendars on this device',
      'Reading these directly means nothing to paste and nothing to publish — ' +
      'anything the family adds on their own phones appears here.',
      switchRow('Use the iPad’s calendars', state.useDeviceCalendar !== false, (on) => {
        update({ useDeviceCalendar: on });
        emit('calendars-changed');
      }),
      calList,
    ),

    group('Screen', null,
      switchRow('Dim the panel itself at night', state.nativeBrightness !== false, (on) => {
        update({ nativeBrightness: on });
        emit('night-changed');
      }),
      h('p.howto-text',
        'With this on, night mode lowers the iPad’s actual brightness instead of ' +
        'laying a dark layer over the screen — the difference between a dark hallway ' +
        'and a grey glow.'),
    ),
  );

  paint();
}

/* ── Location ─────────────────────────────────────────────── */

function renderLocation(body) {
  const results = h('div.search-results');
  const input = h('input.text-input', {
    type: 'search',
    placeholder: 'Search for a town or ZIP code…',
    value: '',
    oninput: () => scheduleSearch(input.value, results),
  });

  fill(body,
    group('Where the hub lives',
      'Used for the forecast, radar centre, sunrise and sunset times.',
      h('div.current-place.well',
        icon('pin', { size: 26 }),
        h('div',
          h('div.current-place-name', state.place.name),
          h('div.current-place-coords', `${state.place.lat.toFixed(3)}, ${state.place.lon.toFixed(3)}`),
        ),
      ),

      h('div.field-row',
        h('div.list-add.grow', icon('crosshair', { size: 22 }), input),
        h('button.btn', {
          onclick: async (e) => {
            const button = e.currentTarget;
            button.disabled = true;
            try {
              const place = await currentPosition();
              applyPlace(place);
            } catch (err) {
              toast(err.message, 'warn');
            } finally {
              button.disabled = false;
            }
          },
        }, icon('location', { size: 20 }), 'Use this device'),
      ),

      results,
    ),

    group('Units', null,
      choiceRow('Temperature', [
        { id: 'F', label: '°F' },
        { id: 'C', label: '°C' },
      ], state.units, (value) => { update({ units: value }); }),

      choiceRow('Wind speed', [
        { id: 'mph', label: 'mph' },
        { id: 'kph', label: 'km/h' },
      ], state.windUnit, (value) => { update({ windUnit: value }); }),

      choiceRow('Week starts on', [
        { id: 0, label: 'Sunday' },
        { id: 1, label: 'Monday' },
      ], state.weekStartsOn, (value) => { update({ weekStartsOn: value }); }),
    ),
  );
}

let searchTimer = null;
function scheduleSearch(query, host) {
  clearTimeout(searchTimer);
  if (query.trim().length < 2) return fill(host);
  searchTimer = setTimeout(async () => {
    try {
      const places = await searchPlaces(query);
      fill(host, ...(places.length
        ? places.map((place) =>
            h('button.search-result', { onclick: () => applyPlace(place) },
              icon('pin', { size: 20 }),
              h('div',
                h('div.search-result-name', place.name),
                h('div.search-result-detail', place.detail),
              ),
            ))
        : [h('div.search-empty', 'No matches')]));
    } catch {
      fill(host, h('div.search-empty', 'Search is unavailable right now'));
    }
  }, 320);
}

function applyPlace(place) {
  state.place = { name: place.name, lat: place.lat, lon: place.lon };
  save('settings');
  emit('place-changed');
  toast(`Location set to ${place.name}`);
  closePanel();
}

/* ── Calendars ────────────────────────────────────────────── */

function renderCalendars(body) {
  const urlInput = h('input.text-input', {
    type: 'url',
    placeholder: 'Paste a secret iCal (.ics) link…',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: false,
  });
  const nameInput = h('input.text-input.narrow', { type: 'text', placeholder: 'Label (e.g. Mom)' });

  const add = () => {
    const url = normalizeFeedUrl(urlInput.value);
    if (!url) return;
    if (!/^https:\/\//i.test(url)) return toast('That does not look like a calendar link', 'warn');

    state.calendars.push({
      id: uid(),
      name: nameInput.value.trim() || 'Calendar',
      url,
      color: nextColor(state.calendars.map((c) => c.color)),
      enabled: true,
    });
    save('settings');
    emit('calendars-changed');
    urlInput.value = '';
    nameInput.value = '';
    renderCalendars(body);
    toast('Calendar added — loading events…');
  };

  fill(body,
    group('Connected calendars',
      'Each person pastes their own private link, so everyone keeps their own calendar app.',

      state.calendars.length
        ? h('div.calendar-list', ...state.calendars.map((cal) => calendarRow(cal, body)))
        : h('div.empty', icon('calendar', { size: 44, stroke: 1.6 }), 'No calendars yet'),

      h('div.field-row.wrap',
        h('div.list-add.grow', icon('link', { size: 22 }), urlInput),
        nameInput,
        h('button.btn.primary', { onclick: add }, 'Add'),
      ),
    ),

    group('Where to find the link', null, h('div.howto', ...HOWTO.map(howtoBlock))),
  );
}

function calendarRow(cal, body) {
  return h('div.calendar-row.well',
    h('button.color-dot.big', {
      style: { background: cal.color },
      onclick: () => {
        const index = PALETTE.indexOf(cal.color);
        cal.color = PALETTE[(index + 1) % PALETTE.length];
        save('settings');
        emit('calendars-changed');
        renderCalendars(body);
      },
      'aria-label': `Change colour for ${cal.name}`,
    }),

    h('div.calendar-row-main',
      h('div.calendar-row-name', cal.name),
      h('div.calendar-row-meta',
        cal.error
          ? h('span.calendar-error', icon('alert', { size: 15 }), cal.error)
          : cal.lastSync
            ? h('span.dim', `${cal.count ?? 0} events · synced ${clockTime(cal.lastSync)}`)
            : h('span.dim', 'Not synced yet'),
      ),
    ),

    h('button.switch', {
      onclick: () => {
        cal.enabled = cal.enabled === false;
        save('settings');
        emit('calendars-changed');
        renderCalendars(body);
      },
      role: 'switch',
      'aria-checked': cal.enabled !== false ? 'true' : 'false',
      'aria-label': `Show ${cal.name}`,
    }, h('span.switch-knob')),

    h('button.icon-btn.ghost', {
      onclick: () => {
        state.calendars = state.calendars.filter((c) => c.id !== cal.id);
        save('settings');
        emit('calendars-changed');
        renderCalendars(body);
      },
      'aria-label': `Remove ${cal.name}`,
    }, icon('trash', { size: 20 })),
  );
}

const HOWTO = [
  ['Google Calendar',
   'On a computer: Settings → click the calendar under “Settings for my calendars” → ' +
   'Integrate calendar → copy the “Secret address in iCal format”.'],
  ['Apple / iCloud',
   'In Calendar on a Mac: right-click the calendar → Share Calendar → tick Public Calendar → ' +
   'copy the webcal:// link. Paste it here as-is.'],
  ['Outlook / Microsoft 365',
   'Outlook on the web: Settings → Calendar → Shared calendars → Publish a calendar → ' +
   'choose “Can view all details” → copy the ICS link.'],
];

const howtoBlock = ([title, text]) =>
  h('div.howto-block.well', h('div.howto-title', title), h('p.howto-text', text));

/* ── Family ───────────────────────────────────────────────── */

function renderFamily(body) {
  const input = h('input.text-input', { type: 'text', placeholder: 'Name…' });

  const add = () => {
    const name = input.value.trim();
    if (!name) return;
    state.people.push({ id: uid(), name, color: nextColor(state.people.map((p) => p.color)) });
    input.value = '';
    save('people');
    renderFamily(body);
  };

  fill(body,
    group('Who lives here',
      'Used to assign chores and colour-code the board.',
      state.people.length
        ? h('div.people-grid',
            ...state.people.map((person) =>
              h('div.person-card.well',
                h('span.person-chip.big', { style: { background: person.color } },
                  person.name.slice(0, 1).toUpperCase()),
                h('div.person-name', person.name),
                h('div.person-colors',
                  ...PALETTE.slice(0, 6).map((color) =>
                    h(`button.color-dot${person.color === color ? '.on' : ''}`, {
                      style: { background: color },
                      onclick: () => { person.color = color; save('people'); renderFamily(body); },
                      'aria-label': `Colour for ${person.name}`,
                    }))),
                h('button.btn.ghost.small', {
                  onclick: () => {
                    state.people = state.people.filter((p) => p.id !== person.id);
                    save('people');
                    renderFamily(body);
                  },
                }, 'Remove'),
              )))
        : h('div.empty', icon('users', { size: 44, stroke: 1.6 }), 'No one added yet'),

      h('div.field-row',
        h('div.list-add.grow', icon('person', { size: 22 }), input),
        h('button.btn.primary', { onclick: add }, 'Add'),
      ),
    ),
  );
}

/* ── Display ──────────────────────────────────────────────── */

function renderDisplay(body) {
  fill(body,
    group('Size', 'Scale everything up if the iPad is mounted further away.',
      h('div.slider-row',
        h('span.slider-label', 'Smaller'),
        h('input.slider', {
          type: 'range', min: '0.8', max: '1.35', step: '0.05', value: state.scale,
          oninput: (e) => {
            const value = Number(e.target.value);
            document.documentElement.style.setProperty('--scale', value);
            state.scale = value;
            save('settings');
          },
        }),
        h('span.slider-label', 'Larger'),
      ),
    ),

    group('Night', 'Dim the panel automatically so it does not light up the hallway.',
      switchRow('Dim at night', state.night.enabled, (on) => {
        state.night.enabled = on;
        save('night');
        emit('night-changed');
      }),
      h('div.field-row',
        timeField('From', state.night.start, (value) => {
          state.night.start = value; save('night'); emit('night-changed');
        }),
        timeField('Until', state.night.end, (value) => {
          state.night.end = value; save('night'); emit('night-changed');
        }),
      ),
      h('div.slider-row',
        h('span.slider-label', 'Subtle'),
        h('input.slider', {
          type: 'range', min: '0.15', max: '0.9', step: '0.05', value: state.night.dim,
          oninput: (e) => {
            state.night.dim = Number(e.target.value);
            save('night');
            emit('night-changed');
          },
        }),
        h('span.slider-label', 'Dark'),
      ),
    ),

    group('Screen care', null,
      switchRow('Keep the screen awake', state.keepAwake, (on) => {
        update({ keepAwake: on });
        emit('wake-changed');
      }),
      switchRow('Shift pixels to prevent burn-in', state.burnIn, (on) => {
        update({ burnIn: on });
      }),
    ),

    group('Install on the iPad', null,
      h('div.howto-block.well',
        h('div.howto-title', 'Add to Home Screen'),
        h('p.howto-text',
          'Open this page in Safari, tap the Share button, then “Add to Home Screen”. ' +
          'Launching it from that icon runs it full screen with no browser chrome — ' +
          'which is what you want on a wall. Then turn on Guided Access ' +
          '(Settings → Accessibility → Guided Access) to lock the iPad to this app.'),
      ),
    ),
  );
}

function timeField(label, value, onChange) {
  return h('label.time-field',
    h('span', label),
    h('input.text-input.time', {
      type: 'time', value,
      onchange: (e) => onChange(e.target.value),
    }),
  );
}

/* ── Ambient photos ───────────────────────────────────────── */

function renderAmbient(body) {
  const addButton = h('button.btn.primary', {
    onclick: () => filePicker.click(),
  }, icon('photo', { size: 20 }), 'Add photos');

  const filePicker = h('input', {
    type: 'file', accept: 'image/*', multiple: true,
    style: { display: 'none' },
    onchange: async (e) => {
      const files = [...e.target.files];
      // Clear it now: picking the same file twice in a row fires no
      // change event otherwise, and "nothing happened" reads as broken.
      e.target.value = '';
      if (!files.length) return;

      /* Resizing a dozen phone photos takes a few seconds, and a button
         that sits there doing nothing for a few seconds gets pressed
         again. Count up on the button itself. */
      addButton.disabled = true;
      const progress = (n) => fill(addButton,
        icon('photo', { size: 20 }), `Adding ${n} of ${files.length}…`);
      progress(1);
      const added = await addPhotos(files, (done) => progress(Math.min(done + 1, files.length)));
      addButton.disabled = false;
      if (added) toast(`Added ${added} photo${added > 1 ? 's' : ''}`);
      renderAmbient(body);
    },
  });

  fill(body,
    group('Ambient mode',
      'After a few quiet minutes the hub fades into a photo slideshow with the time, the ' +
      'weather and what is left of the day laid over it. Touch anywhere to come straight back.',

      switchRow('Turn on ambient mode', state.ambient.enabled, (on) => {
        state.ambient.enabled = on;
        save('ambient');
        emit('ambient-changed');
      }),

      h('div.field-row',
        numberField('Idle minutes', state.ambient.idleMinutes, 1, 120, (v) => {
          state.ambient.idleMinutes = v; save('ambient'); emit('ambient-changed');
        }),
        numberField('Seconds per photo', state.ambient.seconds, 5, 120, (v) => {
          state.ambient.seconds = v; save('ambient');
        }),
      ),

      switchRow('Slow zoom (Ken Burns)', state.ambient.kenBurns, (on) => {
        state.ambient.kenBurns = on; save('ambient');
      }),
    ),

    group('What it shows',
      'The time, the date and the weather are always there. These two are the rest of it.',

      switchRow("Today's schedule", state.ambient.showAgenda !== false, (on) => {
        state.ambient.showAgenda = on; save('ambient');
      }),
      switchRow('Reminders', state.ambient.showReminders !== false, (on) => {
        state.ambient.showReminders = on; save('ambient');
      }),
    ),

    group('Screen care',
      'A panel showing the same thing in the same pixels for years can keep a ghost of it. ' +
      'None of this is meant to be noticeable: the information drifts, changes corner now and ' +
      'then, and the screen takes a short rest every so often.',

      numberField('Change corner every (minutes)', state.ambient.moveMinutes, 1, 60, (v) => {
        state.ambient.moveMinutes = v; save('ambient');
      }),

      switchRow('Rest the screen', state.ambient.rest !== false, (on) => {
        state.ambient.rest = on; save('ambient');
      }),
      h('div.field-row',
        numberField('Rest every (minutes)', state.ambient.restMinutes, 10, 240, (v) => {
          state.ambient.restMinutes = v; save('ambient');
        }),
        numberField('Rest for (seconds)', state.ambient.restSeconds, 5, 300, (v) => {
          state.ambient.restSeconds = v; save('ambient');
        }),
      ),
    ),

    group('Photos',
      'Stored on this iPad and resized to fit its screen. Nothing is uploaded anywhere.',
      h('div.field-row',
        filePicker,
        addButton,
        h('button.btn.ghost.danger', {
          onclick: async () => {
            if (!confirm('Remove every photo from this iPad?')) return;
            await photos.clear();
            toast('Photos cleared');
            renderAmbient(body);
          },
        }, 'Remove all'),
      ),
      photoGrid(),
      h('p.howto-text.dim',
        'With no photos added, ambient mode shows the time and the day over the live sky instead.'),
    ),
  );
}

function numberField(label, value, min, max, onChange) {
  return h('label.time-field',
    h('span', label),
    h('input.text-input.narrow', {
      type: 'number', value, min, max,
      onchange: (e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min))),
    }),
  );
}

/* ── Data & sources ───────────────────────────────────────── */

function renderSources(body) {
  const rows = [
    ['Weather & alerts', live.demo.weather ? 'Demo data' : (live.weather?.source === 'nws' ? 'National Weather Service' : 'Open-Meteo'), live.errors.weather],
    ['Radar', 'RainViewer', null],
    ['Air quality & UV', live.demo.air ? 'Demo data' : 'Open-Meteo', live.errors.air],
    ['Tropical systems', live.demo.storms ? 'Demo data' : 'National Hurricane Center', live.errors.storms],
    ['Calendars', live.demo.calendar ? 'Demo data' : `${state.calendars.length} feed(s)`, live.errors.calendar],
  ];

  fill(body,
    group('Live sources', null,
      h('div.source-list', ...rows.map(([label, value, error]) =>
        h('div.source-row.well',
          h('div.source-row-main',
            h('div.source-row-label', label),
            h('div.source-row-value', value),
          ),
          error
            ? h('span.calendar-error', icon('alert', { size: 15 }), error)
            : h('span.source-ok', icon('check', { size: 18, stroke: 3 })),
        ))),
      h('button.btn', {
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          await refresh.all();
          renderSources(body);
          toast('All sources refreshed');
        },
      }, icon('refresh', { size: 20 }), 'Refresh everything'),
    ),

    group('Demo data',
      'The hub ships with generated sample weather and a sample family calendar so it looks ' +
      'right before anything is configured. Once real sources are connected, demo data is only ' +
      'used if a source cannot be reached.',
      choiceRow('Use demo data', [
        { id: 'auto', label: 'When needed' },
        { id: 'on', label: 'Always' },
        { id: 'off', label: 'Never' },
      ], state.demo, (value) => { update({ demo: value }); emit('demo-changed'); }),
    ),

    group('About', null,
      h('p.howto-text',
        'HomeHub is a self-contained web app. Everything you add — calendars, lists, chores, ' +
        'photos — stays on this device. Weather comes from the National Weather Service, ' +
        'radar from RainViewer, air quality from Open-Meteo, and tropical systems from the ' +
        'National Hurricane Center.'),
      h('button.btn.ghost.danger', {
        onclick: () => {
          if (confirm('Reset every setting, list and chore on this device?')) resetAll();
        },
      }, icon('trash', { size: 20 }), 'Reset everything'),
    ),
  );
}

/* ── Shared controls ──────────────────────────────────────── */

function group(title, description, ...children) {
  return h('section.settings-group',
    h('h3.settings-title', title),
    description ? h('p.settings-desc', description) : null,
    ...children,
  );
}

function switchRow(label, on, onChange) {
  const button = h('button.switch', {
    role: 'switch',
    'aria-checked': on ? 'true' : 'false',
    onclick: () => {
      const next = button.getAttribute('aria-checked') !== 'true';
      button.setAttribute('aria-checked', next ? 'true' : 'false');
      onChange(next);
    },
  }, h('span.switch-knob'));

  return h('div.setting-row', h('span.setting-label', label), button);
}

function choiceRow(label, options, selected, onChange) {
  const seg = h('div.seg.inline');
  for (const option of options) {
    seg.appendChild(
      h(`button.seg-btn${option.id === selected ? '.on' : ''}`, {
        onclick: () => {
          [...seg.children].forEach((b) => b.classList.remove('on'));
          seg.children[options.indexOf(option)].classList.add('on');
          onChange(option.id);
        },
      }, option.label)
    );
  }
  return h('div.setting-row', h('span.setting-label', label), seg);
}
