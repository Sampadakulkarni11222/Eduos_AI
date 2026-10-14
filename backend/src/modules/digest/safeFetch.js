import dns from 'node:dns/promises';
import net from 'node:net';
import https from 'node:https';

/**
 * Fetches an admin-approved feed URL without letting it reach the school's
 * own network (SSRF).
 *
 *  - https only, no user name or password in the URL, port 443 only;
 *  - the host name is resolved here and every address it resolves to is
 *    checked: loopback, private, link-local, carrier-grade NAT, multicast,
 *    documentation, unspecified and IPv6 unique-local ranges are refused;
 *  - the connection is pinned to the address that was checked (no second DNS
 *    lookup an attacker could answer differently);
 *  - redirects are followed by hand, at most three, each re-checked the same way;
 *  - the body is capped in size and the whole fetch in time.
 *
 * What comes back is text to be parsed as data; nothing in it is executed or followed.
 */
export class FetchRefused extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

const blocked = new net.BlockList();
for (const [net4, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(net4, bits, 'ipv4');
for (const [net6, bits] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8], ['2001:db8::', 32], ['100::', 64],
]) blocked.addSubnet(net6, bits, 'ipv6');

/** IPv4 embedded in an IPv6 address (mapped ::ffff:a.b.c.d, NAT64 64:ff9b::/96, 6to4 2002::/16), if any. */
function embeddedV4(ip) {
  const s = ip.toLowerCase();
  const dotted = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) return dotted[1];
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(s);
  const sixToFour = /^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/.exec(s);
  const m = hex ?? sixToFour;
  if (!m) return null;
  const a = parseInt(m[1], 16); const b = parseInt(m[2], 16);
  return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
}

export function isBlockedAddress(ip) {
  const family = net.isIP(ip);
  if (family === 4) return blocked.check(ip, 'ipv4');
  if (family === 6) {
    const v4 = embeddedV4(ip);
    if (v4) return blocked.check(v4, 'ipv4');
    return blocked.check(ip, 'ipv6');
  }
  return true;
}

const INTERNAL_SUFFIXES = ['.local', '.localhost', '.internal', '.lan', '.home', '.corp', '.intranet'];

/** Checks the shape of a feed URL (no network). Throws FetchRefused. */
export function assertFeedUrl(raw) {
  let u;
  try { u = raw instanceof URL ? raw : new URL(String(raw).trim()); } catch { throw new FetchRefused('Not a valid web address', 'BAD_URL'); }
  if (u.protocol !== 'https:') throw new FetchRefused('Only https:// feeds are allowed', 'NOT_HTTPS');
  if (u.username || u.password) throw new FetchRefused('Feed addresses must not contain a user name or password', 'BAD_URL');
  if (u.port && u.port !== '443') throw new FetchRefused('Feed addresses must not name a port', 'BAD_PORT');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || INTERNAL_SUFFIXES.some((s) => host.endsWith(s))) throw new FetchRefused('That address is inside a private network', 'SSRF_BLOCKED');
  if (net.isIP(host) && isBlockedAddress(host)) throw new FetchRefused('That address is inside a private network', 'SSRF_BLOCKED');
  if (!net.isIP(host) && !host.includes('.')) throw new FetchRefused('Feed addresses need a full public host name', 'BAD_URL');
  return u;
}

async function defaultResolve(host) {
  return dns.lookup(host, { all: true, verbatim: true });
}

/** One GET pinned to an already-checked address. Resolves to `{ status, headers, body }` where body is async-iterable. */
function defaultRequest(url, { address, family, signal }) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'EduOS-Digest/1.0 (+approved feed reader)', Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8' },
      lookup: (_host, opts, cb) => (opts?.all ? cb(null, [{ address, family }]) : cb(null, address, family)),
      signal,
    }, (res) => resolve({ status: res.statusCode, headers: res.headers, body: res }));
    req.on('error', reject);
  });
}

async function readCapped(body, maxBytes) {
  const chunks = [];
  let size = 0;
  if (typeof body === 'string') body = [Buffer.from(body)];
  for await (const chunk of body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) {
      body.destroy?.();
      throw new FetchRefused(`The feed is larger than ${Math.round(maxBytes / 1024)} KB`, 'TOO_LARGE');
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * `resolve(host)` → `[{ address, family }]` and `request(url, { address, family, signal })`
 * are injectable for tests; the defaults use the system resolver and https.
 */
export async function safeFetchText(rawUrl, { resolve = defaultResolve, request = defaultRequest, maxBytes = 1_000_000, timeoutMs = 8000, maxRedirects = 3 } = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  let url = assertFeedUrl(rawUrl);
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    let addresses;
    if (net.isIP(host)) addresses = [{ address: host, family: net.isIP(host) }];
    else {
      try { addresses = await resolve(host); } catch { throw new FetchRefused(`Could not find ${host}`, 'DNS_FAILED'); }
    }
    if (!addresses?.length) throw new FetchRefused(`Could not find ${host}`, 'DNS_FAILED');
    if (addresses.some((a) => isBlockedAddress(a.address))) throw new FetchRefused(`${host} points inside a private network`, 'SSRF_BLOCKED');
    const { address, family } = addresses[0];
    let res;
    try { res = await request(url, { address, family, signal }); } catch (err) {
      if (err instanceof FetchRefused) throw err;
      throw new FetchRefused(signal.aborted ? 'The feed took too long to answer' : `Could not fetch the feed (${err?.code ?? err?.message ?? 'error'})`, signal.aborted ? 'TIMEOUT' : 'FETCH_FAILED');
    }
    if (res.status >= 300 && res.status < 400) {
      res.body?.destroy?.();
      const location = res.headers?.location;
      if (!location) throw new FetchRefused('The feed redirected without a destination', 'BAD_REDIRECT');
      if (hop === maxRedirects) throw new FetchRefused('The feed redirected too many times', 'TOO_MANY_REDIRECTS');
      url = assertFeedUrl(new URL(location, url));
      continue;
    }
    if (res.status !== 200) { res.body?.destroy?.(); throw new FetchRefused(`The feed answered HTTP ${res.status}`, 'HTTP_STATUS'); }
    const declared = Number(res.headers?.['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) { res.body?.destroy?.(); throw new FetchRefused(`The feed is larger than ${Math.round(maxBytes / 1024)} KB`, 'TOO_LARGE'); }
    try {
      return { url: url.toString(), text: await readCapped(res.body, maxBytes) };
    } catch (err) {
      if (err instanceof FetchRefused) throw err;
      throw new FetchRefused(signal.aborted ? 'The feed took too long to answer' : 'The feed stopped part-way', signal.aborted ? 'TIMEOUT' : 'FETCH_FAILED');
    }
  }
  throw new FetchRefused('The feed redirected too many times', 'TOO_MANY_REDIRECTS');
}
