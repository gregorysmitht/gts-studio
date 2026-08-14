/* A stand-in for the Swift bridge.
 *
 * Load this before js/main.js in a browser and the app takes every
 * native code path — device calendars, WeatherKit, brightness, native
 * fetch — against fabricated data. It exists so those paths can be
 * exercised without a Mac, an iPad, or a developer account, and so a
 * change to the bridge contract fails here rather than on the wall.
 *
 * Keep the shapes in this file identical to what native/ returns.
 *
 *   <script src="tools/mock-native.js"></script>
 *   <script type="module" src="js/main.js"></script>
 */
(function () {
  const log = [];
  let auth = 'granted';
  let brightness = 1;
  let awake = false;
  let musicAuth = 'granted';
  let reminderAuth = 'granted';
  let canPlayCatalog = true;   // an Apple Music subscription on this Apple ID

  const CALENDARS = [
    { id: 'cal-family', name: 'Family',  color: '#7B96B8', source: 'iCloud', editable: true },
    { id: 'cal-school', name: 'School',  color: '#8FA98A', source: 'iCloud', editable: true },
    /* A subscribed/Exchange calendar that refuses writes, so the edit
       pencil's gate gets exercised. */
    { id: 'cal-work',   name: 'Work',    color: '#9B8AAE', source: 'Exchange', editable: false },
  ];

  /* Mutations from the wall, layered over the static fixture tuples the
     same way EventKit would persist them. */
  const C_EXTRA = [];
  const C_GONE = new Set();
  const C_PATCH = {};

  /* Events relative to now, in the shape CalendarBridge.swift emits. */
  function events(from, to, ids) {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const at = (d, h, m = 0) => +midnight + d * 86400e3 + h * 3600e3 + m * 60e3;
    const raw = [
      ['cal-school', 'Morning drop-off',    0, 8, 0,  0, 8, 45, 'Riverside Elementary'],
      ['cal-work',   'Design review',       0, 13, 0, 0, 14, 0, 'Studio'],
      ['cal-family', 'Soccer practice',     0, 16, 0, 0, 17, 30, 'Freedom Park — Field 3'],
      ['cal-family', 'Dinner with the Ruiz family', 0, 18, 30, 0, 20, 0, 'Home'],
      ['cal-school', 'Parent–teacher night', 1, 18, 0, 1, 19, 30, 'Riverside Elementary'],
      ['cal-work',   'Client call',          1, 10, 0, 1, 10, 45, 'Zoom'],
      ['cal-family', 'Farmers market',       3, 9, 0, 3, 11, 0, 'Atherton Mill'],
    ];
    const list = raw
      .filter(([calId]) => !ids?.length || ids.includes(calId))
      .map(([calId, title, d1, h1, m1, d2, h2, m2, location], i) => {
        const cal = CALENDARS.find((c) => c.id === calId);
        return {
          id: `mock-${i}`, uid: `mock-${i}`,
          title,
          start: at(d1, h1, m1),
          end: at(d2, h2, m2),
          allDay: false,
          location,
          description: '',
          calendarId: cal.id,
          calendarName: cal.name,
          color: cal.color,
          recurring: false,
          editable: cal.editable,
        };
      });

    /* Two real-device shapes the tidy tuples above hid: an all-day
       event (must render, "All day", first) and the same event carried
       by two subscribed calendars (must render once). */
    const family = CALENDARS.find((c) => c.id === 'cal-family');
    const school = CALENDARS.find((c) => c.id === 'cal-school');
    list.push({
      id: 'mock-allday', uid: 'mock-allday',
      title: "Nana's birthday",
      start: at(0, 0), end: at(1, 0),
      allDay: true, location: '', description: '',
      calendarId: family.id, calendarName: family.name, color: family.color,
      recurring: false, editable: true,
    });
    list.push({
      id: 'mock-dupe', uid: 'mock-dupe',
      title: 'Soccer practice',
      start: at(0, 16, 0), end: at(0, 17, 30),
      allDay: false, location: 'Freedom Park — Field 3', description: '',
      calendarId: school.id, calendarName: school.name, color: school.color,
      recurring: false, editable: true,
    });

    /* Wall-made mutations, applied the way EventKit persists them. */
    list.push(...C_EXTRA.filter((ev) => !ids?.length || ids.includes(ev.calendarId)));
    return list
      .filter((e) => !C_GONE.has(e.uid))
      .map((e) => (C_PATCH[e.uid] ? { ...e, ...C_PATCH[e.uid] } : e))
      .filter((e) => e.end > +from && e.start < +to);
  }

  /* ── Reminders ──────────────────────────────────────────────
     Same shapes RemindersBridge.swift emits. Deliberately a messy
     spread: overdue, due today, dated later, and undated — the four
     states the views have to lay out differently. */

  const R_LISTS = [
    { id: 'rl-home',      name: 'Home',      color: '#8FA98A', source: 'iCloud' },
    { id: 'rl-errands',   name: 'Errands',   color: '#DDB27C', source: 'iCloud' },
    { id: 'rl-school',    name: 'School',    color: '#7B96B8', source: 'iCloud' },
    /* The lists a family links to the hub's Lists/Chores features. */
    { id: 'rl-groceries', name: 'Groceries', color: '#8FC79A', source: 'iCloud' },
    { id: 'rl-chores',    name: 'Chores',    color: '#C39ED6', source: 'iCloud' },
    /* Per-person chore lists, the way a family actually sets them up. */
    { id: 'rl-audrey',    name: "Audrey's Chores",  color: '#D98A9E', source: 'iCloud' },
    { id: 'rl-everest',   name: "Everest's Chores", color: '#7B96B8', source: 'iCloud' },
  ];

  const rMidnight = new Date(); rMidnight.setHours(0, 0, 0, 0);
  const rAt = (d, h) => (h == null ? null : +rMidnight + d * 86400e3 + h * 3600e3);
  /* Mutable so reminders.add / reminders.complete behave like EventKit. */
  const R_ITEMS = [
    ['rl-home',      'Change the AC filter',            -2, 9,  1],
    ['rl-school',    'Sign the field trip form',        -1, 17, 1],
    ['rl-errands',   'Pick up dry cleaning',             0, 16, 5],
    ['rl-home',      'Water the front planters',         0, 18, 0],
    ['rl-school',    'Volleyball registration deadline', 2, 12, 1],
    ['rl-errands',   'Order more coffee',                4, null, 0],
    ['rl-home',      'Book the chimney sweep',        null, null, 0],
    ['rl-groceries', 'Milk',                          null, null, 0],
    ['rl-groceries', 'Sourdough loaf',                null, null, 0],
    ['rl-groceries', 'Peanut butter',                 null, null, 0],
    ['rl-chores',    'Empty the dishwasher',             0, 8,  0],
    ['rl-chores',    'Take out the bins',                0, 19, 0],
    ['rl-chores',    'Mow the back yard',                2, 10, 0],
    /* The per-person spread every chores view has to handle: overdue,
       due today with a time, undated ("anytime"), and repeating. */
    ['rl-audrey',    'Practice piano',                  -1, 16, 0, 'Every Wed'],
    ['rl-audrey',    'Make your bed',                    0, 8,  0, 'Daily'],
    ['rl-audrey',    'Feed the dog',                     0, 7,  0, 'Daily'],
    ['rl-audrey',    'Tidy your room',                null, null, 0],
    ['rl-audrey',    'Bring library books',              3, 15, 0, 'Weekly'],
    ['rl-everest',   'Take out the recycling',          -1, 18, 0, 'Every Tue'],
    ['rl-everest',   'Water the garden',                 0, 9,  0, 'Daily'],
    ['rl-everest',   'Homework check',                   0, 16, 0, 'Weekdays'],
    ['rl-everest',   'Sort the Legos',                null, null, 0],
    ['rl-everest',   'Clean the hamster cage',           2, 10, 0, 'Every Sat'],
  ].map(([listId, title, day, hour, priority, repeatText], i) => {
    const list = R_LISTS.find((l) => l.id === listId);
    return {
      id: `rem-${i}`,
      title,
      due: day == null ? null : rAt(day, hour ?? 0),
      hasTime: hour != null,
      notes: '',
      priority,
      flagged: priority > 0 && priority <= 4,
      listId: list.id,
      listName: list.name,
      color: list.color,
      completed: false,
      recurring: !!repeatText,
      repeatText: repeatText ?? '',
    };
  });

  function reminders(to, ids) {
    return R_ITEMS
      .filter((r) => !r.completed)
      .filter((r) => !ids?.length || ids.includes(r.listId))
      .filter((r) => r.due == null || r.due <= +to);
  }

  /* A WeatherKit-shaped payload: already in the hub's vocabulary. */
  function forecast() {
    const start = new Date();
    start.setMinutes(0, 0, 0);
    const hourly = Array.from({ length: 48 }, (_, i) => {
      const time = +start + i * 3600e3;
      const hour = new Date(time).getHours();
      const temp = Math.round(72 - 9 * Math.cos(((hour - 15) * Math.PI) / 12));
      const wet = hour >= 14 && hour <= 18;
      return {
        time, temp, feelsLike: temp + 2,
        condition: wet ? 'rain' : hour < 7 || hour > 20 ? 'clear' : 'partly',
        summary: wet ? 'Rain' : 'Partly Cloudy',
        precipChance: wet ? 70 : 8,
        precipAmount: wet ? 0.12 : 0,
        thunderChance: wet ? 30 : 0,
        lightning: 0,
        cloudCover: wet ? 88 : 40,
        humidity: 62, dewPoint: temp - 12,
        windSpeed: 7, windGust: null, windDir: 210,
        night: hour < 7 || hour > 20,
      };
    });
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const daily = Array.from({ length: 10 }, (_, d) => ({
      date: +midnight + d * 86400e3,
      hi: 84 - d, lo: 66 - Math.round(d / 2),
      condition: d % 3 === 0 ? 'rain' : 'partly',
      summary: d % 3 === 0 ? 'Rain' : 'Partly Cloudy',
      detail: 'Generated by the mock bridge.',
      precipChance: d % 3 === 0 ? 70 : 15,
      precipAmount: d % 3 === 0 ? 0.3 : 0,
      thunderChance: 0, windSpeed: 8,
      sunrise: +midnight + d * 86400e3 + 6.7 * 3600e3,
      sunset: +midnight + d * 86400e3 + 20.2 * 3600e3,
      uvMax: 7,
    }));
    return {
      source: 'weatherkit',
      updated: Date.now(),
      current: { ...hourly[0], pressure: 1014, visibility: 10 },
      hourly, daily,
      /* WeatherKit returns these and the hub renders them on the weather
         card, so the mock has to carry at least one — an empty array
         meant that path was never exercised. */
      alerts: [{
        id: 'mock-alert-1',
        event: 'Severe Thunderstorm Watch',
        severity: 'Severe',
        headline: 'Severe Thunderstorm Watch in effect until 9 PM',
        description: 'Conditions are favourable for severe thunderstorms.',
        instruction: 'Stay tuned and be ready to move indoors.',
        areaDesc: 'Central Florida',
        sender: 'Mock Weather Service',
        onset: Date.now() - 3600e3,
        ends: Date.now() + 6 * 3600e3,
        geometry: null,
        isThunder: true,
        isTropical: false,
      }],
      attribution: {
        name: 'Apple Weather',
        legalUrl: 'https://weatherkit.apple.com/legal-attribution.html',
      },
    };
  }

  /* ── Music ──────────────────────────────────────────────────
     MusicKit hands back real artwork URLs. There is no network here,
     so covers are generated as SVG data URIs — enough to prove the
     layout, the blurred backdrop and the colour bleed all work. */

  function cover(a, b, mark) {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>` +
      `</linearGradient></defs>` +
      `<rect width="600" height="600" fill="url(#g)"/>` +
      mark +
      `</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  const MARKS = {
    arc: '<circle cx="300" cy="330" r="150" fill="none" stroke="rgba(255,255,255,.34)" stroke-width="2"/>' +
         '<circle cx="300" cy="330" r="96" fill="rgba(255,255,255,.10)"/>',
    horizon: '<rect y="360" width="600" height="2" fill="rgba(255,255,255,.38)"/>' +
             '<circle cx="300" cy="288" r="78" fill="rgba(255,255,255,.16)"/>',
    bars: '<g fill="rgba(255,255,255,.20)"><rect x="120" y="200" width="46" height="260"/>' +
          '<rect x="196" y="150" width="46" height="310"/><rect x="272" y="240" width="46" height="220"/>' +
          '<rect x="348" y="120" width="46" height="340"/><rect x="424" y="220" width="46" height="240"/></g>',
    grid: '<g stroke="rgba(255,255,255,.22)" stroke-width="1.5" fill="none">' +
          '<rect x="150" y="150" width="300" height="300"/><rect x="210" y="210" width="180" height="180"/>' +
          '<rect x="264" y="264" width="72" height="72"/></g>',
    wave: '<path d="M0 380 Q 150 300 300 380 T 600 380" fill="none" stroke="rgba(255,255,255,.34)" stroke-width="3"/>' +
          '<path d="M0 430 Q 150 350 300 430 T 600 430" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="3"/>',
    dot: '<circle cx="300" cy="300" r="120" fill="rgba(255,255,255,.13)"/>' +
         '<circle cx="300" cy="300" r="20" fill="rgba(255,255,255,.5)"/>',
  };

  const TRACKS = [
    { id: 'song-1', title: 'Slow Tide',        artist: 'Marisol Vane',   album: 'Long Light',     duration: 247, art: cover('#2F5D74', '#8FA98A', MARKS.wave) },
    { id: 'song-2', title: 'Terrace at Seven', artist: 'The Almond Set', album: 'Long Light',     duration: 198, art: cover('#2F5D74', '#8FA98A', MARKS.wave) },
    { id: 'song-3', title: 'Brass Hour',       artist: 'Nile Adeyemi',   album: 'Brass Hour',     duration: 312, art: cover('#5C4230', '#DDB27C', MARKS.arc) },
    { id: 'song-4', title: 'Cardamom',         artist: 'Nile Adeyemi',   album: 'Brass Hour',     duration: 264, art: cover('#5C4230', '#DDB27C', MARKS.arc) },
    { id: 'song-5', title: 'Paper Lanterns',   artist: 'Hollow Coast',   album: 'Nightswim',      duration: 221, art: cover('#1E3A5F', '#6E5B8B', MARKS.dot) },
    { id: 'song-6', title: 'Low Country',      artist: 'June Sparrow',   album: 'Field Notes',    duration: 289, art: cover('#3C4A32', '#A8A06E', MARKS.horizon) },
  ];

  const ALBUMS = [
    { id: 'alb-1', type: 'album', title: 'Long Light',  subtitle: 'Marisol Vane', artworkUrl: TRACKS[0].art },
    { id: 'alb-2', type: 'album', title: 'Brass Hour',  subtitle: 'Nile Adeyemi', artworkUrl: TRACKS[2].art },
    { id: 'alb-3', type: 'album', title: 'Nightswim',   subtitle: 'Hollow Coast', artworkUrl: TRACKS[4].art },
    { id: 'alb-4', type: 'album', title: 'Field Notes', subtitle: 'June Sparrow', artworkUrl: TRACKS[5].art },
  ];

  const PLAYLISTS = [
    { id: 'pl-1', type: 'playlist', title: 'Sunday Morning',  subtitle: '42 songs', artworkUrl: cover('#7B6A4E', '#C9B08A', MARKS.grid) },
    { id: 'pl-2', type: 'playlist', title: 'Kitchen Radio',   subtitle: '88 songs', artworkUrl: cover('#3E5C57', '#93B3A4', MARKS.bars) },
    { id: 'pl-3', type: 'playlist', title: 'Dinner Party',    subtitle: '61 songs', artworkUrl: cover('#5A3B44', '#C08497', MARKS.arc) },
    { id: 'pl-4', type: 'playlist', title: 'Homework Hour',   subtitle: '35 songs', artworkUrl: cover('#334A63', '#8FA8C4', MARKS.dot) },
    { id: 'pl-5', type: 'playlist', title: 'Saturday Chores', subtitle: '54 songs', artworkUrl: cover('#63432F', '#D89B62', MARKS.wave) },
    /* One with no cover at all, deliberately. Real playlists turn up
       without artwork more often than anything else does — smart
       playlists off an old iTunes library especially — and the shelf has
       to draw a note rather than a broken-image glyph. Without this in
       the fixtures that path was never once exercised. */
    { id: 'pl-6', type: 'playlist', title: 'Old Smart Playlist', subtitle: '17 songs', artworkUrl: null },
  ];

  const asItem = (t) => ({
    id: t.id, type: 'song', title: t.title, subtitle: t.artist,
    artist: t.artist, artworkUrl: t.art,
  });

  const music = {
    state: 'playing',
    index: 0,
    position: 42,
    since: Date.now(),
    shuffle: false,
    repeat: 'off',
    /* System-player truth: the queue can be genuinely empty (nothing
       playing anywhere on the device), which snapshots as track:null.
       The fixture starts full; __clearQueue empties it. */
    cleared: false,
  };

  /** Advance the playhead the way native playback would have. */
  function settle() {
    if (music.state === 'playing') {
      music.position += (Date.now() - music.since) / 1000;
      const dur = TRACKS[music.index].duration;
      while (music.position > dur) { music.position -= dur; skip(1, false); }
    }
    music.since = Date.now();
  }

  function skip(by, doSettle = true) {
    if (doSettle) settle();
    music.index = (music.index + by + TRACKS.length) % TRACKS.length;
    music.position = 0;
    music.since = Date.now();
  }

  /** The snapshot shape MusicBridge.swift emits, on every call and push. */
  function snapshot() {
    if (music.cleared) {
      return {
        state: 'stopped', track: null, position: 0,
        shuffle: music.shuffle, repeat: music.repeat,
        queue: [], auth: musicAuth,
      };
    }
    settle();
    const t = TRACKS[music.index];
    return {
      state: music.state,
      track: {
        id: t.id, title: t.title, artist: t.artist, album: t.album,
        artworkUrl: t.art, duration: t.duration,
      },
      position: music.position,
      shuffle: music.shuffle,
      repeat: music.repeat,
      queue: TRACKS.slice(music.index + 1, music.index + 4).map(asItem),
      auth: musicAuth,
    };
  }

  /* Without a subscription MusicKit authorises fine and then refuses
     every catalog request with a bare error — reproduce that exactly. */
  function requireSubscription() {
    if (!canPlayCatalog) {
      throw new Error("The operation couldn't be completed. (MusicKit.MusicDataRequest.Error error 1.)");
    }
  }

  const pushTopic = (topic, payload = {}) =>
    window.HomeHubNative?.onEvent?.(topic, payload);
  const push = () => pushTopic('music', snapshot());

  /* MusicKit's state observer fires whether the change came from the hub
     or from somewhere else, so every mutation pushes as well as replying.
     The hub gets the same value twice; applying it twice is a no-op. */
  const MUTATORS = /^music\.(play|pause|next|previous|seek|shuffle|repeat|playItem)$/;

  /* EventKit posts EKEventStoreChanged for the hub's own writes too, so
     every reminders mutation is followed by the same nudge the real
     bridge would send after its debounce. */
  const R_MUTATORS = /^reminders\.(complete|add|update|remove)$/;
  const C_MUTATORS = /^calendar\.(add|update|remove)$/;

  /** Per-method round-trip time, in ms. See __setLatency below. */
  const LATENCY = {};

  const METHODS = {
    'calendar.status': () => ({ status: auth }),
    'calendar.request': () => { auth = 'granted'; return { status: auth }; },
    'calendar.list': () => ({ calendars: CALENDARS }),
    'calendar.events': ({ from, to, calendarIds }) => ({ events: events(from, to, calendarIds) }),
    'calendar.add': ({ title, start, end, allDay, calendarId, location, notes }) => {
      const cal = CALENDARS.find((c) => c.id === calendarId)
        ?? CALENDARS.find((c) => c.editable);
      if (!cal.editable) throw new Error('That calendar cannot be written to');
      const uid = `mock-new-${C_EXTRA.length}`;
      C_EXTRA.push({
        id: `${uid}-${Math.floor(start / 1000)}`, uid,
        title, start, end: Math.max(start, end), allDay: !!allDay,
        location: location || '', description: notes || '',
        calendarId: cal.id, calendarName: cal.name, color: cal.color,
        recurring: false, editable: true,
      });
      return { ok: true, uid };
    },
    'calendar.update': ({ uid, changes }) => {
      const cur = events(0, Infinity).find((e) => e.uid === uid);
      if (!cur) throw new Error('That event no longer exists');
      if (!cur.editable) throw new Error('That calendar cannot be written to');
      const patch = { ...changes };
      if (patch.calendarId) {
        const cal = CALENDARS.find((c) => c.id === patch.calendarId);
        if (!cal?.editable) throw new Error('That calendar cannot be written to');
        patch.calendarName = cal.name;
        patch.color = cal.color;
      }
      delete patch.repeat;
      C_PATCH[uid] = { ...(C_PATCH[uid] ?? {}), ...patch };
      return { ok: true };
    },
    'calendar.remove': ({ uid }) => {
      C_GONE.add(uid);
      return { ok: true };
    },
    'reminders.status': () => ({ status: reminderAuth }),
    'reminders.request': () => { reminderAuth = 'granted'; return { status: reminderAuth }; },
    'reminders.lists': () => ({ lists: R_LISTS }),
    'reminders.items': ({ to, listIds }) => ({ reminders: reminders(to, listIds) }),
    'reminders.complete': ({ id, done }) => {
      const item = R_ITEMS.find((r) => r.id === id);
      if (item) item.completed = done !== false;
      return { ok: true, completed: done !== false };
    },
    'reminders.add': ({ listId, title }) => {
      const list = R_LISTS.find((l) => l.id === listId);
      if (!list) throw new Error('That Reminders list no longer exists');
      const item = {
        id: `rem-new-${R_ITEMS.length}`, title, due: null, hasTime: false,
        notes: '', priority: 0, flagged: false,
        listId: list.id, listName: list.name, color: list.color, completed: false,
        recurring: false, repeatText: '',
      };
      R_ITEMS.push(item);
      return { ok: true, id: item.id };
    },
    'reminders.update': ({ id, changes }) => {
      const item = R_ITEMS.find((r) => r.id === id);
      if (!item) throw new Error('That reminder no longer exists');
      if (changes.title) item.title = changes.title;
      if ('due' in changes) {
        item.due = changes.due ?? null;
        item.hasTime = !!changes.hasTime;
      }
      if ('notes' in changes) item.notes = changes.notes ?? '';
      if ('repeat' in changes) {
        const text = {
          none: '', daily: 'Daily', weekdays: 'Weekdays', weekly: 'Weekly',
          biweekly: 'Every 2 weeks', monthly: 'Monthly',
        }[changes.repeat] ?? '';
        item.recurring = !!text;
        item.repeatText = text;
      }
      return { ok: true };
    },
    'reminders.remove': ({ id }) => {
      const i = R_ITEMS.findIndex((r) => r.id === id);
      if (i < 0) throw new Error('That reminder no longer exists');
      R_ITEMS.splice(i, 1);
      return { ok: true };
    },

    'weather.forecast': () => forecast(),
    'display.brightness': () => ({ level: brightness }),
    'display.setBrightness': ({ level }) => { brightness = level; return { ok: true }; },
    'display.keepAwake': ({ on }) => { awake = on; return { ok: true }; },
    'fetch.text': ({ url }) => ({ status: 599, body: `mock bridge did not fetch ${url}` }),

    'music.status': () => ({
      status: musicAuth,
      subscription: musicAuth === 'granted'
        ? { known: true, canPlayCatalog, canSubscribe: !canPlayCatalog }
        : undefined,
    }),
    'music.request': () => { musicAuth = 'granted'; return { status: musicAuth }; },
    'music.now': () => snapshot(),
    'music.play': () => {
      // The real system player throws when nothing is queued anywhere.
      if (music.cleared) throw new Error('The operation couldn’t be completed. (No item to play.)');
      settle(); music.state = 'playing'; return snapshot();
    },
    'music.pause': () => { settle(); music.state = 'paused'; return snapshot(); },
    'music.next': () => { skip(1); return snapshot(); },
    'music.previous': () => {
      settle();
      // Same as the Music app: restart the track unless you're near the top.
      if (music.position > 4) { music.position = 0; music.since = Date.now(); }
      else skip(-1, false);
      return snapshot();
    },
    'music.seek': ({ seconds }) => {
      music.position = Math.max(0, Math.min(TRACKS[music.index].duration, seconds));
      music.since = Date.now();
      return snapshot();
    },
    'music.shuffle': ({ on }) => { settle(); music.shuffle = !!on; return snapshot(); },
    'music.repeat': ({ mode }) => { settle(); music.repeat = mode; return snapshot(); },
    'music.playlists': () => {
      requireSubscription();
      return { playlists: PLAYLISTS };
    },
    'music.recent': () => {
      requireSubscription();
      return { items: [...ALBUMS, ...PLAYLISTS.slice(0, 2)] };
    },
    'music.search': ({ term }) => {
      const hit = (s) => s.toLowerCase().includes(String(term).toLowerCase());
      return {
        songs: TRACKS.filter((t) => hit(t.title) || hit(t.artist) || hit(t.album)).map(asItem),
        albums: ALBUMS.filter((a) => hit(a.title) || hit(a.subtitle)),
        playlists: PLAYLISTS.filter((p) => hit(p.title)),
      };
    },
    'music.playItem': ({ type, id }) => {
      // Songs jump to that track; a collection just starts from the top.
      music.cleared = false;
      const i = TRACKS.findIndex((t) => t.id === id);
      music.index = type === 'song' && i >= 0 ? i : 0;
      music.position = 0;
      music.since = Date.now();
      music.state = 'playing';
      return snapshot();
    },
  };

  window.HomeHubNative = {
    version: 1,
    capabilities: ['calendar', 'reminders', 'weather', 'display', 'fetch', 'music'],
    call(method, params) {
      log.push({ method, params });
      const fn = METHODS[method];
      if (!fn) return Promise.reject(new Error(`Unknown bridge method: ${method}`));
      /* Async, like the real WKScriptMessageHandlerWithReply round trip.

         20ms is honest for most calls and badly misleading for a few.
         Starting a playlist on device is a catalog lookup, a track list
         and a handoff to the system player — one to three seconds — and
         anything meant to cover that gap is invisible at 20ms. Whole
         loading states can look correct here and be untested. */
      const delay = LATENCY[method] ?? 20;
      return new Promise((resolve, reject) => setTimeout(() => {
        // try/catch matters: a synchronous throw inside a setTimeout
        // callback escapes the promise entirely, so it never settles and
        // the caller waits forever. The real bridge rejects properly.
        try {
          const result = fn(params || {});
          if (MUTATORS.test(method)) setTimeout(push, 10);
          if (R_MUTATORS.test(method)) setTimeout(() => pushTopic('reminders'), 30);
          if (C_MUTATORS.test(method)) setTimeout(() => pushTopic('calendar'), 30);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      }, delay));
    },
    /* Test hooks — the Swift bridge has no equivalent. */
    __log: log,
    /** Make a method take as long as it really does, so waiting states show. */
    __setLatency: (method, ms) => { LATENCY[method] = ms; },
    __state: () => ({ auth, brightness, awake, music: snapshot() }),
    __setAuth: (v) => { auth = v; },
    __setReminderAuth: (v) => { reminderAuth = v; },
    __setMusicAuth: (v) => { musicAuth = v; push(); },
    /** Take the subscription away, the way an expired one would. */
    __setSubscribed: (v) => { canPlayCatalog = !!v; },
    /** Pretend the queue moved on its own — proves the push path works. */
    __advance: () => { skip(1); push(); },
    __stopMusic: () => { settle(); music.state = 'stopped'; push(); },
    /** Nothing queued anywhere on the device — the system player's
        truly-empty state (track:null), which __stopMusic cannot reach. */
    __clearQueue: () => { music.cleared = true; push(); },
    /** Music started outside the hub — Siri, the Music app. The system
        player picks it up and the observer pushes, same as a skip. */
    __externalPlay: (index = 0) => {
      music.cleared = false;
      music.index = index % TRACKS.length;
      music.position = 0;
      music.since = Date.now();
      music.state = 'playing';
      push();
    },
    /** What EKEventStoreChanged→push looks like from the page's side:
        a phone or Siri touched the database, refetch both stores. */
    __mockStoreChanged: () => { pushTopic('reminders'); pushTopic('calendar'); },
    /** A Siri App Intent asking the hub to show something. */
    __mockIntent: (action) => pushTopic('intent', { action }),
  };
})();
