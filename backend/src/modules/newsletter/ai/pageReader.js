import { safeFetchText, FetchRefused } from '../../digest/safeFetch.js';
import { toPlainText } from '../../digest/feedParser.js';

/**
 * Reads an official page linked from an alert item, politely and safely.
 *
 *   - only when the page's host is on the school's official-sites list or the
 *     curated list of official bodies below (every redirect is held to the
 *     same rule, before it connects);
 *   - only where the site's robots.txt allows our user agent (robots.txt is
 *     cached for 12 hours; a missing robots.txt allows, an unreachable one
 *     refuses, as RFC 9309 says);
 *   - at most one request per site every 10 seconds (or the site's
 *     Crawl-delay, if longer), a small page budget per run, a size cap and a
 *     time limit; https only and never into a private network (safeFetch);
 *   - only the main text is kept (scripts, styles, navigation, headers,
 *     footers, forms are dropped), as plain text, as data. Nothing in it is
 *     followed or run.
 */
export const USER_AGENT = 'EduOS-Newsletter/1.0 (+official-sites reader; respects robots.txt)';
const UA_TOKEN = 'eduos-newsletter';

/** Government, exam boards, research bodies, universities and well-known competition organisers. */
export const OFFICIAL_BODIES = [
  'gov.in', 'nic.in', 'mygov.in', 'cbse.gov.in', 'ncert.nic.in', 'hbcse.tifr.res.in', 'res.in', 'ac.in', 'edu.in', 'edu',
  'aicte-india.org', 'isro.gov.in', 'dst.gov.in', 'ugc.gov.in', 'ugc.ac.in', 'education.gov.in', 'inspireawards-dst.gov.in',
  'iarcs.org.in', 'vvm.org.in', 'bebras.org', 'imo-official.org', 'ioinformatics.org', 'spaceappschallenge.org',
  'wro-association.org', 'firstinspires.org', 'societyforscience.org', 'irisnationalfair.org', 'breakthroughjuniorchallenge.org',
  'theearthprize.org', 'royalcwsociety.org', 'ecolymp.org',
];

export function hostOn(host, domains) {
  const h = String(host ?? '').toLowerCase().replace(/\.$/, '');
  return domains.some((d) => h === d || h.endsWith(`.${d}`));
}
export const pageAllowed = (host, schoolDomains = []) => hostOn(host, [...schoolDomains, ...OFFICIAL_BODIES]);

// ── robots.txt ─────────────────────────────────────────────────────────

const ROBOTS_TTL = 12 * 3_600_000;
const robotsCache = new Map(); // host → { rules, crawlDelay, at, status }
const lastHit = new Map(); // host → ms of our last page request
export const MIN_INTERVAL_MS = 10_000;

export function resetPageReaderForTests() { robotsCache.clear(); lastHit.clear(); }

/** Parses robots.txt into the rules for our agent (or `*`): `{ rules: [{ allow, path }], crawlDelay }`. */
export function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(); const value = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent || !current) { current = { agents: [], rules: [], crawlDelay: null }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'allow' || key === 'disallow') { if (value || key === 'allow') current.rules.push({ allow: key === 'allow', path: value }); }
    else if (key === 'crawl-delay') { const n = Number(value); if (Number.isFinite(n) && n >= 0) current.crawlDelay = Math.min(n, 120); }
  }
  const mine = groups.filter((g) => g.agents.some((a) => { const t = a.replace(/\/.*$/, ''); return t !== '*' && t.length >= 4 && UA_TOKEN.includes(t); }));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  return { rules: chosen.flatMap((g) => g.rules), crawlDelay: chosen.find((g) => g.crawlDelay !== null)?.crawlDelay ?? null };
}

const patternToRe = (p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')}`);

/** Longest matching rule wins; Allow wins a tie; no rule means allowed. */
export function robotsAllows(parsed, pathWithQuery) {
  let best = null;
  for (const r of parsed?.rules ?? []) {
    if (!r.path) continue;
    if (!patternToRe(r.path).test(pathWithQuery)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

async function robotsFor(origin, host, opts) {
  const hit = robotsCache.get(host);
  if (hit && Date.now() - hit.at < ROBOTS_TTL) return hit;
  let entry;
  const captured = {};
  const baseRequest = opts.request;
  const request = baseRequest ? async (url, o) => { const r = await baseRequest(url, o); captured.status = r.status; return r; } : undefined;
  try {
    const { text } = await safeFetchText(`${origin}/robots.txt`, {
      ...opts, ...(request && { request }), maxBytes: 200_000, timeoutMs: 5000, accept: 'text/plain', userAgent: USER_AGENT,
      checkUrl: (u) => { if (u.hostname.toLowerCase() !== host) throw new FetchRefused('robots.txt redirected to another site', 'ROBOTS_REDIRECT'); },
    });
    entry = { ...parseRobots(text), status: 'OK' };
  } catch (err) {
    const status = captured.status ?? Number(/HTTP (\d{3})/.exec(String(err?.message))?.[1]);
    // RFC 9309: "unavailable" (4xx) means no rules; "unreachable" (5xx, network) means do not crawl.
    entry = status >= 400 && status < 500 ? { rules: [], crawlDelay: null, status: 'NONE' } : { rules: [{ allow: false, path: '/' }], crawlDelay: null, status: 'UNREACHABLE' };
  }
  entry.at = Date.now();
  if (robotsCache.size > 500) robotsCache.delete(robotsCache.keys().next().value);
  robotsCache.set(host, entry);
  return entry;
}

// ── main text ──────────────────────────────────────────────────────────

/** The readable main text of an HTML page, as plain text (title and description first). */
export function mainText(html, max = 6000) {
  const s = String(html ?? '');
  const title = toPlainText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(s)?.[1] ?? '', 200);
  const desc = /<meta[^>]+name=["']description["'][^>]*>/i.exec(s)?.[0];
  const description = desc ? toPlainText(/content=["']([^"']*)["']/i.exec(desc)?.[1] ?? '', 300) : '';
  let body = s
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|object|embed|canvas)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(nav|header|footer|aside|form|menu)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  const blocks = [...body.matchAll(/<(main|article)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)].map((m) => m[2]);
  if (blocks.length) body = blocks.sort((a, b) => b.length - a.length)[0];
  else body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(body)?.[1] ?? body;
  body = body.replace(/<\/(p|div|li|h[1-6]|tr|section|br)\s*>|<br\s*\/?>/gi, '. ');
  const text = toPlainText(body, max).replace(/(\.\s*){2,}/g, '. ').replace(/^\.\s*/, '');
  return { title, description, text };
}

// ── reading a page ─────────────────────────────────────────────────────

/**
 * Reads `url` if every rule allows it. Never throws: `{ fetched, text?, note }`.
 * `schoolDomains` is the school's official-sites list. `opts` may carry
 * `{ resolve, request }` (tests) and `now`.
 */
export async function readOfficialPage(url, { schoolDomains = [], opts = {}, now = Date.now() } = {}) {
  let u;
  try { u = new URL(url); } catch { return { fetched: false, note: 'Not a valid address' }; }
  if (u.protocol !== 'https:') return { fetched: false, note: 'Only https pages are read' };
  const host = u.hostname.toLowerCase();
  if (!pageAllowed(host, schoolDomains)) return { fetched: false, note: `${host} is not on the official-sites list, so the page was not read` };
  const robots = await robotsFor(u.origin, host, opts);
  if (!robotsAllows(robots, `${u.pathname}${u.search}`)) return { fetched: false, note: robots.status === 'UNREACHABLE' ? `${host}'s robots.txt could not be read, so the page was not read` : `${host}'s robots.txt asks robots not to read this page` };
  const gap = Math.max(MIN_INTERVAL_MS, (robots.crawlDelay ?? 0) * 1000);
  const last = lastHit.get(host);
  if (last && now - last < gap) return { fetched: false, note: `Waiting before reading ${host} again (rate limit)`, rateLimited: true };
  lastHit.set(host, now);
  try {
    const out = await safeFetchText(u.toString(), {
      ...opts, maxBytes: 800_000, timeoutMs: 8000, accept: 'text/html, application/xhtml+xml;q=0.9, text/plain;q=0.5', userAgent: USER_AGENT,
      checkUrl: (next) => { if (!pageAllowed(next.hostname, schoolDomains)) throw new FetchRefused(`The page redirected to ${next.hostname}, which is not on the official-sites list`, 'NOT_ALLOWLISTED'); },
    });
    if (out.contentType && !/text\/html|application\/xhtml|text\/plain/i.test(out.contentType)) return { fetched: false, note: 'The link is not a web page (for example a PDF), so only the feed text was used' };
    const page = /<html|<body|<p\b|<div\b/i.test(out.text) ? mainText(out.text) : { title: '', description: '', text: toPlainText(out.text, 6000) };
    if (!page.text) return { fetched: false, note: 'The page had no readable text' };
    return { fetched: true, url: out.url, ...page, note: 'Read from the official page' };
  } catch (err) {
    return { fetched: false, note: `The page could not be read (${err?.code ?? 'error'}): ${String(err?.message ?? '').slice(0, 120)}` };
  }
}
