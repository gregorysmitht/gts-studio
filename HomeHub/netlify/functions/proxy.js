/* ============================================================
   HomeHub read-only fetch proxy.

   Exists for three upstreams the browser can't reach directly:
     • api.weather.gov — requires a descriptive User-Agent
     • nhc.noaa.gov    — sends no CORS headers
     • calendar feeds  — ICS hosts send no CORS headers

   It is deliberately narrow. A URL parameter pointed at a fetching
   server is a classic SSRF sink, so requests must clear all of:
     1. https only, no credentials in the URL
     2. host is either an allowlisted API or a plausible calendar feed
     3. every resolved IP is public (checked again on each redirect)
     4. GET only, bounded redirects, bounded size, bounded time
   ============================================================ */

const dns = require('dns').promises;
const net = require('net');

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 15000;
const UA = 'HomeHub/1.0 (family wall display; https://github.com/gregorysmitht/HomeHub)';

/* Hosts the hub reads structured data from. */
const API_HOSTS = new Set([
  'api.weather.gov',
  'api.open-meteo.com',
  'air-quality-api.open-meteo.com',
  'geocoding-api.open-meteo.com',
  'api.rainviewer.com',
  'nhc.noaa.gov',
  'www.nhc.noaa.gov',
]);

/* Calendar providers, matched on exact host or dotted suffix. */
const CALENDAR_HOSTS = [
  'calendar.google.com',
  'www.google.com',
  'icloud.com',
  'outlook.office365.com',
  'outlook.office.com',
  'outlook.live.com',
  'calendar.yahoo.com',
  'webcal.fm',
];

const hostMatches = (host, list) =>
  list.some((h) => host === h || host.endsWith('.' + h));

/** Anything not globally routable. */
function isPrivateIp(ip) {
  const version = net.isIP(ip);
  if (!version) return true;

  if (version === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||          // CGNAT
      (a === 169 && b === 254) ||                    // link-local
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||                      // IETF protocol assignments
      (a === 198 && (b === 18 || b === 19)) ||       // benchmarking
      a >= 224                                        // multicast + reserved
    );
  }

  const v6 = ip.toLowerCase();
  if (v6 === '::' || v6 === '::1') return true;
  if (v6.startsWith('fe8') || v6.startsWith('fe9') ||
      v6.startsWith('fea') || v6.startsWith('feb')) return true;   // link-local
  if (/^f[cd]/.test(v6)) return true;                              // unique local
  // IPv4-mapped — re-check the embedded address.
  const mapped = v6.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIp(mapped[1]);
  return false;
}

async function assertPublicHost(hostname) {
  // A bare IP in the URL skips DNS entirely.
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('blocked: private address');
    return;
  }
  let records;
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error('blocked: host does not resolve');
  }
  if (!records.length) throw new Error('blocked: host does not resolve');
  for (const { address } of records) {
    if (isPrivateIp(address)) throw new Error('blocked: resolves to a private address');
  }
}

function validate(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('invalid url'); }

  if (url.protocol !== 'https:') throw new Error('blocked: https only');
  if (url.username || url.password) throw new Error('blocked: credentials in url');

  const host = url.hostname.toLowerCase();
  const isApi = API_HOSTS.has(host);
  const isCalendarHost = hostMatches(host, CALENDAR_HOSTS);
  const looksLikeIcs = /\.ics$/i.test(url.pathname) || /(^|[?&])ics(=|$)/i.test(url.search);

  if (!isApi && !isCalendarHost && !looksLikeIcs) {
    throw new Error('blocked: host not permitted');
  }
  return url;
}

/** Fetch, re-validating the target at every hop. */
async function fetchGuarded(startUrl) {
  let url = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url.hostname);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: ctrl.signal,
        headers: {
          'User-Agent': UA,
          Accept: 'application/geo+json, application/json, text/calendar, text/plain, */*',
          'Accept-Encoding': 'gzip, deflate',
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error('redirect without location');
      const next = new URL(location, url);
      if (next.protocol !== 'https:') throw new Error('blocked: redirect left https');
      url = next;
      continue;
    }

    const length = Number(res.headers.get('content-length') || 0);
    if (length > MAX_BYTES) throw new Error('blocked: response too large');

    const body = await res.text();
    if (body.length > MAX_BYTES) throw new Error('blocked: response too large');

    return {
      status: res.status,
      body,
      contentType: res.headers.get('content-type') || 'text/plain; charset=utf-8',
    };
  }
  throw new Error('too many redirects');
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS, body: 'Method not allowed' };
  }

  const raw = (event.queryStringParameters || {}).url;
  if (!raw) return { statusCode: 400, headers: CORS, body: 'Missing url parameter' };

  let url;
  try {
    url = validate(raw);
  } catch (err) {
    return { statusCode: 403, headers: CORS, body: err.message };
  }

  try {
    const { status, body, contentType } = await fetchGuarded(url);
    return {
      statusCode: status,
      headers: {
        ...CORS,
        'Content-Type': contentType,
        // Short shared cache keeps the hub light on upstream APIs
        // without ever showing genuinely old data.
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      },
      body,
    };
  } catch (err) {
    const blocked = String(err.message || '').startsWith('blocked');
    return {
      statusCode: blocked ? 403 : 502,
      headers: CORS,
      body: blocked ? err.message : `Upstream fetch failed: ${err.message}`,
    };
  }
};
