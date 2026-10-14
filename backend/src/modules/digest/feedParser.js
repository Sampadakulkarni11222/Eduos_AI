/**
 * A small RSS 2.0 / Atom 1.0 reader for the digest.
 *
 * Feed text is data. Every title and summary comes out as plain text: markup
 * is removed (script and style blocks with their contents), entities are
 * decoded, and any angle brackets left after decoding are removed too, so an
 * encoded "&lt;script&gt;" cannot become markup anywhere it is shown. Links are
 * kept only when they are http(s). DOCTYPE and ENTITY declarations are refused
 * outright rather than expanded.
 */
export class FeedError extends Error {
  constructor(message, code = 'BAD_FEED') { super(message); this.code = code; }
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

const unCdata = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, inner) => inner.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));

function stripMarkup(s) {
  return s
    .replace(/<(script|style|iframe|object|embed|noscript)[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ');
}

/** Element text → safe plain text. Repeated until stable, so markup hidden in CDATA or (multiply) encoded entities is removed as well. */
export function toPlainText(raw, max = 300) {
  if (!raw) return '';
  let s = unCdata(String(raw));
  // Whatever decoding produces is still data: markup it spells out is stripped again (feeds
  // sometimes escape twice or three times), then any stray brackets are dropped.
  for (let i = 0; i < 4; i += 1) {
    const next = decodeEntities(stripMarkup(s));
    if (next === s) break;
    s = next;
  }
  s = stripMarkup(s).replace(/[<>]/g, '');
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export function safeLink(raw, base) {
  if (!raw) return null;
  const text = decodeEntities(unCdata(String(raw)).trim()).replace(/&amp;/g, '&');
  try {
    const u = new URL(text, base);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    u.hash = '';
    return u.toString();
  } catch { return null; }
}

const tag = (xml, name) => {
  const m = new RegExp(`<(?:[a-z0-9]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[a-z0-9]+:)?${name}\\s*>`, 'i').exec(xml);
  return m ? m[1] : null;
};
const attr = (el, name) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(el);
  return m ? (m[2] ?? m[3]) : null;
};

function atomLink(entry) {
  const links = entry.match(/<link\b[^>]*\/?>/gi) ?? [];
  const alt = links.find((l) => !attr(l, 'rel') || attr(l, 'rel') === 'alternate') ?? links[0];
  return alt ? attr(alt, 'href') : null;
}

function date(raw) {
  if (!raw) return null;
  const d = new Date(toPlainText(raw, 60));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Parses feed text into `{ kind, title, items: [{ title, link, summary, publishedAt }] }`. */
export function parseFeed(xml, { baseUrl, maxItems = 50, summaryMax = 280 } = {}) {
  if (typeof xml !== 'string' || !xml.trim()) throw new FeedError('The feed is empty');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new FeedError('Feeds with DOCTYPE or ENTITY declarations are not accepted', 'FEED_DTD');
  const atom = /<feed\b[^>]*>/i.test(xml) && !/<rss\b/i.test(xml);
  const blocks = xml.match(atom ? /<entry\b[\s\S]*?<\/entry\s*>/gi : /<item\b[\s\S]*?<\/item\s*>/gi) ?? [];
  if (!blocks.length && !/<(rss|feed|rdf:RDF)\b/i.test(xml)) throw new FeedError('This is not an RSS or Atom feed');
  const head = xml.replace(/<(entry|item)\b[\s\S]*?<\/\1\s*>/gi, '');
  const items = [];
  for (const b of blocks.slice(0, maxItems)) {
    const title = toPlainText(tag(b, 'title'), 200);
    const link = safeLink(atom ? atomLink(b) : (tag(b, 'link') ?? tag(b, 'guid')), baseUrl);
    if (!title || !link) continue;
    const summary = toPlainText(atom ? (tag(b, 'summary') ?? tag(b, 'content')) : (tag(b, 'description') ?? tag(b, 'encoded')), summaryMax);
    const publishedAt = date(atom ? (tag(b, 'published') ?? tag(b, 'updated')) : (tag(b, 'pubDate') ?? tag(b, 'date')));
    items.push({ title, link, summary, publishedAt });
  }
  return { kind: atom ? 'ATOM' : 'RSS', title: toPlainText(tag(head, 'title'), 150) || null, items };
}
