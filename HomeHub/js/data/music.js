/* Apple Music.

   Playback runs natively through MusicKit in the iPad app — the web
   layer never touches audio. It asks the bridge what's playing, renders
   it, and sends transport commands back.

   Position is the one value that must not wait on a round trip: the
   bridge reports it on every state change, and `livePosition()` advances
   it locally in between so the scrubber moves smoothly at 60fps without
   polling the native side sixty times a second. */

import { nativeHas, nativeCall, onNativeEvent } from '../core/native.js';
import { emit } from '../core/store.js';

export const musicAvailable = () => nativeHas('music');

/** Mirrors what MusicBridge.swift sends. */
export const player = {
  state: 'stopped',      // 'playing' | 'paused' | 'stopped'
  track: null,           // { id, title, artist, album, artworkUrl, duration }
  position: 0,           // seconds, as of `stamp`
  stamp: 0,              // performance.now() when position was measured
  shuffle: false,
  repeat: 'off',         // 'off' | 'one' | 'all'
  queue: [],
  auth: 'notDetermined',
};

/**
 * Where the playhead is *now*, extrapolated from the last report.
 * Called every animation frame by the scrubber.
 */
export function livePosition() {
  if (player.state !== 'playing' || !player.track) return player.position;
  const elapsed = (performance.now() - player.stamp) / 1000;
  return Math.min(player.track.duration ?? Infinity, player.position + elapsed);
}

function apply(snapshot) {
  if (!snapshot) return;
  Object.assign(player, snapshot);
  player.stamp = performance.now();
  emit('music', player);
}

/* ── Commands ─────────────────────────────────────────────── */

const send = async (method, params) => {
  if (!musicAvailable()) throw new Error('Music needs the HomeHub app');
  apply(await nativeCall(method, params));
};

export const play        = () => send('music.play');
export const pause       = () => send('music.pause');
export const next        = () => send('music.next');
export const previous    = () => send('music.previous');
export const seek        = (seconds) => send('music.seek', { seconds });
export const setShuffle  = (on) => send('music.shuffle', { on });
export const setRepeat   = (mode) => send('music.repeat', { mode });

/** Play a catalog or library item. @param {'song'|'album'|'playlist'} type */
export const playItem = (type, id) => send('music.playItem', { type, id });

export async function togglePlay() {
  if (player.state === 'playing') return pause();
  return play();
}

/* ── Authorisation ────────────────────────────────────────── */

/**
 * Whether this Apple ID can actually play catalog music.
 * `null` until asked, because "we don't know yet" and "no" lead to very
 * different things being said on screen.
 */
export let subscription = null;

export async function musicAuthStatus() {
  if (!musicAvailable()) return 'unavailable';
  try {
    const res = await nativeCall('music.status');
    player.auth = res.status;
    if (res.subscription) subscription = res.subscription;
    return res.status;
  } catch { return 'unavailable'; }
}

/**
 * A sentence explaining why music isn't working, or null if it should be.
 * Permission and subscription are separate gates and fail identically
 * from the web layer's point of view — MusicKit just refuses the request.
 */
export function musicBlockedReason() {
  if (!musicAvailable()) return 'Music needs the HomeHub app';
  if (player.auth === 'denied') {
    return 'Apple Music access is off — turn it on in Settings › Privacy & Security › Media & Apple Music';
  }
  if (player.auth === 'notDetermined') return 'Connect Apple Music in Settings → Device';
  if (subscription?.known && !subscription.canPlayCatalog) {
    return 'This Apple ID has no active Apple Music subscription, so there is nothing to play';
  }
  return null;
}

export async function requestMusicAccess() {
  const { status } = await nativeCall('music.request');
  player.auth = status;
  emit('music', player);
  return status;
}

/* ── Browsing ─────────────────────────────────────────────── */

/** @returns {{songs:Array, albums:Array, playlists:Array}} */
export async function search(term) {
  if (!term?.trim()) return { songs: [], albums: [], playlists: [] };
  return nativeCall('music.search', { term: term.trim(), limit: 12 });
}

export async function playlists() {
  const { playlists: list } = await nativeCall('music.playlists');
  return list ?? [];
}

export async function recentlyPlayed() {
  const { items } = await nativeCall('music.recent');
  return items ?? [];
}

/* ── Wiring ───────────────────────────────────────────────── */

let stopPoll = null;

/**
 * The bridge pushes on every state change, which covers everything —
 * what the hub starts, and what someone starts from a phone, because
 * the Swift side observes the system player rather than only its own
 * commands. Nothing here needs to ask.
 */
export function startMusic() {
  if (!musicAvailable()) return;

  onNativeEvent('music', apply);

  const tick = async () => {
    try { apply(await nativeCall('music.now')); }
    catch { /* transient; the next resync will catch up */ }
  };

  tick();

  /* No polling loop. This used to ask the bridge for the player's state
     every five seconds, for as long as the hub was switched on — some
     eleven thousand round trips a day for something the bridge already
     pushes the moment it changes.

     That is expensive in a way a five-second timer does not look. Every
     `music.now` reads ApplicationMusicPlayer's queue and state, and
     MusicBridge is @MainActor, so each one runs on the app's main
     thread. When the music daemon's connection is wedged — which the
     device log announces as "applicationQueuePlayer
     _establishConnectionIfNeeded timeout [ping did not pong]" — those
     reads block, the main thread stalls, and WebKit stalls with it. The
     whole hub goes treacly because of a poll for information nothing
     was waiting on.

     What is left: one read at boot, and a resync whenever the hub comes
     back to the foreground, which is when a push could actually have
     been missed. */
  const resync = () => { if (document.visibilityState === 'visible') tick(); };
  document.addEventListener('visibilitychange', resync);
  stopPoll = () => document.removeEventListener('visibilitychange', resync);

  musicAuthStatus();
}

export function stopMusic() {
  stopPoll?.();
  stopPoll = null;
}

/* ── Display helpers ──────────────────────────────────────── */

export function formatTime(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '--:--';
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export const hasTrack = () => !!player.track && player.state !== 'stopped';
