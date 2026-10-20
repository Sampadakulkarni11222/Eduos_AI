import { assertFeedUrl, FetchRefused } from '../../digest/safeFetch.js';

/**
 * Google Alerts, through its RSS delivery.
 *
 * Google Alerts has no API, and its web pages must not be scraped. What it
 * does offer is delivery to an RSS feed: in Google Alerts an editor creates an
 * alert, opens "Show options", sets "Deliver to" to "RSS feed", and copies the
 * feed's address (https://www.google.com/alerts/feeds/<number>/<number>).
 * EduOS reads that feed like any approved feed, through the SSRF-safe fetcher.
 * Only that exact path is accepted for a Google Alert source.
 *
 * The feed's links are Google redirect links
 * (https://www.google.com/url?rct=j&sa=t&url=<article>&ct=ga...). They are
 * unwrapped to the real article address, which is what is stored, shown and
 * de-duplicated on; EduOS never follows the redirect itself.
 */
export const GOOGLE_ALERT_HOSTS = ['www.google.com', 'google.com'];
export const GOOGLE_ALERT_PATH_PREFIX = '/alerts/feeds/';
const FEED_PATH_RE = /^\/alerts\/feeds\/\d{5,30}\/\d{5,30}\/?$/;

/** A Google Alerts RSS feed address, normalised to https://www.google.com/alerts/feeds/... Throws FetchRefused. */
export function assertGoogleAlertFeedUrl(raw) {
  const u = assertFeedUrl(raw);
  const host = u.hostname.toLowerCase();
  if (!GOOGLE_ALERT_HOSTS.includes(host) || !u.pathname.startsWith(GOOGLE_ALERT_PATH_PREFIX)) {
    throw new FetchRefused('A Google Alert source must be the alert\'s RSS address, starting https://www.google.com/alerts/feeds/', 'NOT_GOOGLE_ALERT_FEED');
  }
  if (!FEED_PATH_RE.test(u.pathname)) throw new FetchRefused('That does not look like a Google Alerts feed address (https://www.google.com/alerts/feeds/<number>/<number>)', 'NOT_GOOGLE_ALERT_FEED');
  const out = new URL(`https://www.google.com${u.pathname.replace(/\/$/, '')}`);
  return out;
}

export const isGoogleAlertFeedUrl = (raw) => { try { assertGoogleAlertFeedUrl(raw); return true; } catch { return false; } };

const GOOGLE_REDIRECT_HOST = /^(?:www\.)?google\.(?:com|co\.in|co\.uk|[a-z]{2,3})$/i;

/**
 * The real article address behind a Google redirect link, or the link itself
 * when it is not one. Only http(s) targets are accepted (anything else gives
 * null), credentials and fragments are dropped. Purely a parse: nothing is fetched.
 */
export function unwrapGoogleLink(raw) {
  if (!raw) return null;
  let u;
  try { u = new URL(String(raw).trim()); } catch { return null; }
  for (let i = 0; i < 2 && GOOGLE_REDIRECT_HOST.test(u.hostname) && u.pathname === '/url'; i += 1) {
    const target = u.searchParams.get('url') ?? u.searchParams.get('q');
    if (!target) return null;
    try { u = new URL(target); } catch { return null; }
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  u.hash = '';
  return u.toString();
}

/** A link reduced for comparing ("same article"): https, no www., no tracking parameters, no trailing slash. */
export function canonicalLink(raw) {
  const unwrapped = unwrapGoogleLink(raw);
  if (!unwrapped) return null;
  const u = new URL(unwrapped);
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|ref$|ved$|usg$|ct$|cd$|sa$|rct$)/i.test(k)) u.searchParams.delete(k);
  const path = u.pathname.replace(/\/+$/, '') || '/';
  return `${u.hostname.replace(/^www\./, '').toLowerCase()}${path}${u.searchParams.toString() ? `?${u.searchParams.toString()}` : ''}`;
}

/** The steps the "Add a Google Alert" panel shows. */
export const GUIDE_STEPS = [
  'Open Google Alerts (google.com/alerts) while signed in to the school\'s Google account.',
  'Type the words to watch, for example "national science olympiad registration". Use the suggestions below for ideas.',
  'Press "Show options". Set "How often" to "As-it-happens" or "At most once a day", "Sources" to "Automatic", "Language" to English (or Hindi), "Region" to India (or Any region for international programmes).',
  'Set "Deliver to" to "RSS feed", then press "Create alert".',
  'On the Alerts page, find the RSS icon next to the new alert, right-click it and copy the link. It starts https://www.google.com/alerts/feeds/.',
  'Paste that link here, give it a name, and tag the domain, level and region. EduOS checks the feed every hour; what it finds waits in the review queue.',
];

export const GUIDE_NOTES = [
  'This uses Google Alerts\' own RSS delivery. Google Alerts has no API, and EduOS never reads Google\'s web pages.',
  'Each item\'s link is unwrapped from Google\'s redirect to the real article. EduOS reads the linked page only when its site is on the official-sites list, and only where the site\'s robots.txt allows it.',
  'Nothing is published automatically: every candidate waits for an editor, with each extracted detail shown next to the text it came from.',
];

/** Suggested alert queries by domain (and a few by level), for the panel. `{state}` is filled with the school's state when known. */
export const SUGGESTED_QUERIES = {
  SCIENCE: ['national science olympiad registration', '"science exhibition" students registration India', 'INSPIRE MANAK nominations school', 'state level science exhibition {state}'],
  MATHS: ['maths olympiad registration India students', '"mathematics olympiad" school students last date', 'pre-RMO registration'],
  CODING_AI: ['hackathon for school students India', '"coding competition" school students registration', 'AI challenge for school students India'],
  ROBOTICS: ['robotics competition school students India registration', '"robotics olympiad" India'],
  ENVIRONMENT: ['environment competition school students India', '"climate challenge" for students registration'],
  ARTS: ['painting competition school students national level', 'essay competition for school students India last date', 'poetry competition students India'],
  SPORTS: ['state level sports trials students {state}', 'Khelo India school games selection', 'school games federation trials'],
  COMMERCE: ['commerce olympiad registration', 'business plan competition school students India'],
  HUMANITIES: ['national level quiz competition school students', 'model united nations school students India registration', 'debate competition school students India', 'state level quiz competition {state}'],
  ENTREPRENEURSHIP: ['young entrepreneurs challenge school students India', 'innovation challenge for students India registration'],
};
export const SUGGESTED_BY_LEVEL = {
  NATIONAL: ['CBSE circular competition', 'NCERT competition students registration', 'Ministry of Education competition school students'],
  STATE: ['state level competition school students {state}', '{state} education department competition students'],
  INTERNATIONAL: ['international olympiad Indian students selection', 'international competition school students registration open'],
  EXAMS: ['entrance exam registration last date', 'NTSE OR scholarship exam registration school'],
};

export function suggestedQueries({ state = null } = {}) {
  const fill = (q) => (state ? q.replaceAll('{state}', state) : q.replaceAll(' {state}', '').replaceAll('{state} ', ''));
  return {
    byDomain: Object.fromEntries(Object.entries(SUGGESTED_QUERIES).map(([d, qs]) => [d, qs.map(fill)])),
    byLevel: Object.fromEntries(Object.entries(SUGGESTED_BY_LEVEL).map(([l, qs]) => [l, qs.map(fill)])),
  };
}
