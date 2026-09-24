import { domainToASCII } from 'node:url';
import { AppError } from '../../utils/AppError.js';

/**
 * What counts as a hostname a school may be given.
 *
 * Every value that leaves this file ends up in a DNS query, a TLS handshake, a
 * CORS decision and a redirect, so it rejects rather than repairs wherever the
 * input is ambiguous. The one thing it does normalise is what is unambiguous:
 * letter case, a single trailing root dot, and an internationalised name
 * converted to its ASCII (punycode) form — "WWW.AbcSchool.com." and
 * "www.abcschool.com" are the same host, and storing two spellings of it would
 * let two schools claim one domain.
 */

/** Subdomain labels the platform keeps for itself, whatever a school is called. */
export const RESERVED_SUBDOMAINS = Object.freeze(new Set([
  'www', 'api', 'app', 'apps', 'admin', 'administrator', 'root', 'super-admin', 'superadmin',
  'platform', 'console', 'dashboard', 'portal', 'login', 'signin', 'signup', 'auth', 'oauth', 'sso',
  'account', 'accounts', 'billing', 'pay', 'payments', 'checkout',
  'mail', 'email', 'smtp', 'imap', 'pop', 'pop3', 'mx', 'ns', 'ns1', 'ns2', 'ns3', 'dns', 'ftp', 'sftp', 'ssh', 'vpn',
  'static', 'assets', 'cdn', 'media', 'img', 'images', 'files', 'uploads', 'download', 'downloads',
  'status', 'health', 'metrics', 'monitor', 'docs', 'help', 'support', 'blog', 'news', 'about',
  'dev', 'development', 'test', 'testing', 'stage', 'staging', 'qa', 'uat', 'demo', 'sandbox', 'preview', 'beta',
  'localhost', 'local', 'internal', 'intranet', 'webhook', 'webhooks', 'ws', 'wss', 'graphql',
  'eduos', 'eduos-ai', 'mcp', 'ai', 'whatsapp', 'security', 'abuse', 'postmaster', 'hostmaster', 'webmaster',
  '_domainkey', 'autodiscover', 'autoconfig',
]));

/** Suffixes that can never be publicly resolvable, so can never verify. */
const NON_PUBLIC_SUFFIXES = ['localhost', 'local', 'internal', 'intranet', 'lan', 'home', 'corp', 'test', 'example', 'invalid', 'onion'];

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MAX_HOSTNAME = 253;
const MAX_INPUT = 300;
export const SUBDOMAIN_MIN = 3;
export const SUBDOMAIN_MAX = 63;

const fail = (message, code) => {
  throw new AppError(message, 400, [], code);
};

/** True when a string holds an ASCII control character (including tab and newline). */
export function hasControlChars(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/**
 * A DNS-safe subdomain label derived from a school's name.
 *
 * "St. Mary's Convent (Pune)" → "st-marys-convent-pune". Accents are folded
 * ("École" → "ecole"), apostrophes vanish rather than splitting a word, and
 * everything else that is not a letter or digit becomes one hyphen. Returns
 * '' when nothing usable is left — a name written entirely in a script with
 * no Latin transliteration — and the caller refuses it rather than inventing
 * a label.
 */
export function slugifySubdomain(name) {
  const base = String(name ?? '')
    .normalize('NFKD')
    // Combining marks left behind by NFKD — the accent in "é".
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    // Apostrophes, straight or curly, vanish rather than splitting a word.
    .replace(/['`\p{Pf}\p{Pi}]/gu, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return trimLabel(base, SUBDOMAIN_MAX);
}

/** Cuts a label to `max` characters without leaving a trailing hyphen. */
export function trimLabel(label, max) {
  return label.slice(0, max).replace(/-+$/g, '');
}

/**
 * A subdomain label as a Super Admin typed it, validated.
 *
 * Deliberately stricter than DNS allows: lowercase letters, digits and single
 * hyphens only, 3-63 characters, no leading or trailing hyphen, no "xn--"
 * (an explicit punycode label is a way to register a lookalike of another
 * school's name).
 */
export function parseSubdomain(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) fail('Enter a subdomain.', 'INVALID_SUBDOMAIN');
  if (raw.length < SUBDOMAIN_MIN || raw.length > SUBDOMAIN_MAX) {
    fail(`A subdomain must be ${SUBDOMAIN_MIN}-${SUBDOMAIN_MAX} characters.`, 'INVALID_SUBDOMAIN');
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw)) {
    fail('A subdomain may contain only lowercase letters, digits and single hyphens, and may not start or end with a hyphen.', 'INVALID_SUBDOMAIN');
  }
  if (raw.startsWith('xn--')) fail('A subdomain may not be a punycode label.', 'INVALID_SUBDOMAIN');
  if (RESERVED_SUBDOMAINS.has(raw)) fail(`"${raw}" is reserved by the platform.`, 'RESERVED_SUBDOMAIN');
  return raw;
}

/**
 * A custom domain as entered, reduced to the one hostname it names — or refused.
 *
 * Refused outright rather than stripped: a protocol, a path, a query, a port,
 * credentials, a wildcard, whitespace, an IP address, a single-label name, and
 * any suffix that can never resolve publicly. "https://www.abc.com/" is not
 * silently turned into "www.abc.com", because whoever typed it may have meant
 * a different host than the one we would guess.
 */
export function normalizeCustomDomain(value, { platformDomain = '' } = {}) {
  if (typeof value !== 'string') fail('Enter a domain name such as www.abcschool.com.', 'INVALID_DOMAIN');
  const raw = value.trim();
  if (!raw) fail('Enter a domain name such as www.abcschool.com.', 'INVALID_DOMAIN');
  if (raw.length > MAX_INPUT) fail('That domain name is too long.', 'INVALID_DOMAIN');
  // Whitespace and control characters first: "abc.com\nHost: evil.com" is a
  // header-injection attempt, not a domain with a port.
  if (/\s/.test(raw) || hasControlChars(raw)) fail('A domain name may not contain spaces or control characters.', 'INVALID_DOMAIN');
  if (raw.startsWith('[')) fail('Enter a domain name, not an IP address.', 'INVALID_DOMAIN');

  // "https://…", but also "javascript:…" or "mailto:…". A bare "host:443" is a
  // port rather than a scheme, and gets its own message below.
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  const looksLikePort = /^[^:]+:\d+$/.test(raw);
  if (hasScheme || (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !looksLikePort)) {
    fail('Enter the domain name only, without http:// or https://.', 'DOMAIN_HAS_PROTOCOL');
  }
  if (/[/?#\\]/.test(raw)) fail('Enter the domain name only, without a path, query or fragment.', 'DOMAIN_HAS_PATH');
  if (raw.includes('@')) fail('A domain name may not contain credentials.', 'INVALID_DOMAIN');
  if (raw.includes(':')) fail('A domain name may not include a port.', 'DOMAIN_HAS_PORT');
  if (raw.includes('*')) fail('Wildcard domains cannot be assigned to a school.', 'INVALID_DOMAIN');

  let host = raw.toLowerCase();
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (!host || host.startsWith('.') || host.includes('..')) fail('That is not a valid domain name.', 'INVALID_DOMAIN');

  // Internationalised names are stored in ASCII form. domainToASCII returns ''
  // for anything the WHATWG URL parser would refuse as a host.
  const ascii = domainToASCII(host);
  if (!ascii) fail('That is not a valid domain name.', 'INVALID_DOMAIN');
  host = ascii;

  if (host.length > MAX_HOSTNAME) fail('That domain name is too long.', 'INVALID_DOMAIN');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) {
    fail('Enter a domain name, not an IP address.', 'INVALID_DOMAIN');
  }

  const labels = host.split('.');
  if (labels.length < 2) fail('Enter a full domain name such as www.abcschool.com.', 'INVALID_DOMAIN');
  for (const label of labels) {
    if (!LABEL.test(label)) fail(`"${label}" is not a valid part of a domain name.`, 'INVALID_DOMAIN');
  }
  const tld = labels[labels.length - 1];
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(tld)) {
    fail(`".${tld}" is not a valid top-level domain.`, 'INVALID_DOMAIN');
  }
  if (NON_PUBLIC_SUFFIXES.includes(tld)) {
    fail(`".${tld}" domains are not publicly resolvable and cannot be verified.`, 'INVALID_DOMAIN');
  }

  // The platform's own domain is issued as subdomains, never claimed as a
  // "custom" one — that would let a school take another school's subdomain,
  // or the platform's own host, by typing it.
  if (platformDomain && (host === platformDomain || host.endsWith(`.${platformDomain}`))) {
    fail('Addresses under the platform domain are configured as subdomains, not custom domains.', 'DOMAIN_IS_PLATFORM');
  }
  return host;
}

/**
 * The domain a school's website address names — or null when none was given.
 *
 * What a person types into a "website" box is a URL, not a hostname, so this
 * accepts a little more than normalizeCustomDomain does and then hands the host
 * to it for every hostname rule:
 *
 *   accepted   an http or https scheme, one trailing slash, a leading "www."
 *              "https://www.example.com/" → "example.com"
 *   refused    any other scheme, a page path, a query or fragment, a port,
 *              credentials, and every hostname normalizeCustomDomain refuses
 *
 * A path is refused rather than dropped: "https://example.com/abc-school" may
 * well be a page on somebody else's site, and the school does not control a
 * domain just because it has a page on one.
 *
 * Empty, null and whitespace are "not provided" (null) — never a guess.
 */
export function normalizeWebsite(value, { platformDomain = '' } = {}) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') fail('A website must be text such as https://www.abcschool.com.', 'INVALID_WEBSITE');
  const raw = value.trim();
  if (!raw) return null;
  if (raw.length > MAX_INPUT) fail('That website address is too long.', 'INVALID_WEBSITE');
  if (/\s/.test(raw) || hasControlChars(raw)) fail('A website address may not contain spaces or control characters.', 'INVALID_WEBSITE');

  let hostPart = raw;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(raw);
  if (scheme) {
    if (!['http', 'https'].includes(scheme[1].toLowerCase())) {
      fail('A website must be an http or https address.', 'INVALID_WEBSITE');
    }
    hostPart = raw.slice(scheme[0].length);
  }
  // Before anything else reads "user:pass@" as a scheme or a port.
  if (hostPart.includes('@')) fail('A website address may not contain a username or password.', 'INVALID_WEBSITE');
  if (hostPart.endsWith('/')) hostPart = hostPart.slice(0, -1);
  if (/[/?#\\]/.test(hostPart)) {
    fail('Enter the school\'s site address only, without a page path, query or fragment.', 'WEBSITE_HAS_PATH');
  }

  let host = normalizeCustomDomain(hostPart, { platformDomain });
  // "www.example.com" and "example.com" are the same school's site; the bare
  // domain is what it owns. Only a leading www., and only when a registrable
  // name is left behind it.
  if (host.startsWith('www.') && host.split('.').length > 2) host = host.slice(4);
  return host;
}

/** A hostname from a request (Host header or Origin), normalised for lookup, or null. */
export function hostnameForLookup(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw || raw.length > MAX_INPUT) return null;
  let host = raw;
  if (/^[a-z]+:\/\//.test(host)) {
    try {
      host = new URL(host).hostname;
    } catch {
      return null;
    }
  } else {
    host = host.replace(/:\d+$/, '');
  }
  host = host.replace(/\.$/, '');
  return /^[a-z0-9.-]+$/.test(host) ? host : null;
}
