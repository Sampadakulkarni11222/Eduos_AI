import dns from 'node:dns/promises';
import net from 'node:net';
import https from 'node:https';
import { isBlockedAddress } from '../digest/safeFetch.js';

/**
 * The only way EduOS reaches a school's video gateway (MediaMTX, go2rtc or an
 * NVR/VMS web endpoint). SSRF-safe by construction:
 *
 *  - https only; no user name or password in the URL; no query or fragment in
 *    the configured base;
 *  - a request may go only to the configured gateway's origin (scheme, host
 *    and port) and below its base path; anything else is refused before any
 *    network activity;
 *  - when the platform sets CCTV_GATEWAY_HOSTS, the gateway host must be on
 *    that list (exact host, or ".suffix");
 *  - the host is resolved here and every address checked: private, loopback,
 *    link-local, CGNAT, multicast and documentation ranges are refused. An
 *    on-premise install may set CCTV_ALLOW_PRIVATE_GATEWAY=true to allow the
 *    configured gateway on the school LAN; link-local (cloud metadata at
 *    169.254.169.254), multicast and unspecified addresses stay refused even then;
 *  - the connection is pinned to the checked address (no second lookup);
 *  - redirects are never followed (a 3xx is refused);
 *  - the response body is capped in size and the whole exchange in time.
 */
export class GatewayRefused extends Error {
  constructor(message, code, status = 502) { super(message); this.code = code; this.statusCode = status; }
}

const INTERNAL_SUFFIXES = ['.local', '.localhost', '.internal', '.lan', '.home', '.corp', '.intranet'];
const ALWAYS_BLOCKED = new net.BlockList();
ALWAYS_BLOCKED.addSubnet('169.254.0.0', 16, 'ipv4');
ALWAYS_BLOCKED.addSubnet('0.0.0.0', 8, 'ipv4');
ALWAYS_BLOCKED.addSubnet('224.0.0.0', 4, 'ipv4');
ALWAYS_BLOCKED.addSubnet('240.0.0.0', 4, 'ipv4');
ALWAYS_BLOCKED.addSubnet('fe80::', 10, 'ipv6');
ALWAYS_BLOCKED.addSubnet('ff00::', 8, 'ipv6');
ALWAYS_BLOCKED.addAddress('::', 'ipv6');

const allowPrivate = () => String(process.env.CCTV_ALLOW_PRIVATE_GATEWAY ?? '').toLowerCase() === 'true';
const platformHosts = () => String(process.env.CCTV_GATEWAY_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);

function alwaysBlocked(ip) {
  const family = net.isIP(ip);
  if (!family) return true;
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
  if (v4) return ALWAYS_BLOCKED.check(v4, 'ipv4');
  return ALWAYS_BLOCKED.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

/** Whether an address may be connected to for the configured gateway. */
export function addressAllowed(ip) {
  if (alwaysBlocked(ip)) return false;
  if (!isBlockedAddress(ip)) return true;
  return allowPrivate();
}

/** Checks and normalises a gateway base URL (no network). Throws GatewayRefused. */
export function assertGatewayBase(raw) {
  let u;
  try { u = new URL(String(raw ?? '').trim()); } catch { throw new GatewayRefused('The gateway address is not a valid web address.', 'BAD_URL', 400); }
  if (u.protocol !== 'https:') throw new GatewayRefused('The gateway must be reached over https:// (put MediaMTX/go2rtc behind a TLS proxy or tunnel).', 'NOT_HTTPS', 400);
  if (u.username || u.password) throw new GatewayRefused('Do not put a user name or password in the address; enter them in the credential fields (they are stored encrypted).', 'CREDENTIALS_IN_URL', 400);
  if (u.search || u.hash) throw new GatewayRefused('The gateway address must not contain a query or fragment.', 'BAD_URL', 400);
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const hosts = platformHosts();
  if (hosts.length && !hosts.some((h) => (h.startsWith('.') ? host.endsWith(h) : host === h))) {
    throw new GatewayRefused('That gateway host is not on this platform\'s allowlist (CCTV_GATEWAY_HOSTS).', 'NOT_ALLOWLISTED', 400);
  }
  const internalName = host === 'localhost' || INTERNAL_SUFFIXES.some((s) => host.endsWith(s));
  if (internalName && !allowPrivate()) throw new GatewayRefused('That address is inside a private network. Expose the gateway on a public https name (reverse proxy or tunnel), or set CCTV_ALLOW_PRIVATE_GATEWAY on an on-premise install.', 'SSRF_BLOCKED', 400);
  if (net.isIP(host) && !addressAllowed(host)) throw new GatewayRefused('That address is inside a private or reserved network.', 'SSRF_BLOCKED', 400);
  if (!u.pathname.endsWith('/')) u.pathname += '/';
  return u;
}

/**
 * Resolves `path` against the gateway base and refuses anything that leaves
 * the gateway's origin or base path, or that is not a browser-playable path.
 */
export function gatewayUrl(base, path) {
  const b = base instanceof URL ? base : assertGatewayBase(base);
  const p = String(path ?? '').trim();
  if (!p) throw new GatewayRefused('The camera has no stream path on the gateway yet.', 'NO_STREAM_PATH', 400);
  if (/^rtsps?:/i.test(p)) throw new GatewayRefused('RTSP cannot play in a browser. Add the camera to your gateway (MediaMTX/go2rtc) and enter the gateway\'s WHEP or HLS path for it.', 'RTSP_NOT_PLAYABLE', 400);
  let u;
  try { u = new URL(p, b); } catch { throw new GatewayRefused('The stream path is not valid.', 'BAD_URL', 400); }
  if (u.origin !== b.origin || !u.pathname.startsWith(b.pathname)) throw new GatewayRefused('That address is outside the school\'s configured gateway.', 'NOT_ALLOWLISTED', 400);
  if (u.username || u.password) throw new GatewayRefused('Credentials must not be in the path.', 'CREDENTIALS_IN_URL', 400);
  return u;
}

async function defaultResolve(host) {
  return dns.lookup(host, { all: true, verbatim: true });
}

function defaultTransport(url, { method, headers, body, address, family, signal }) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method, headers, signal,
      lookup: (_h, opts, cb) => (opts?.all ? cb(null, [{ address, family }]) : cb(null, address, family)),
    }, (res) => resolve({ status: res.statusCode, headers: res.headers, body: res }));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

let transport = defaultTransport;
let resolver = defaultResolve;
/** Test seam: replace the network (resolve + request). Pass nothing to restore. */
export function setGatewayNetwork({ request, resolve } = {}) {
  transport = request ?? defaultTransport;
  resolver = resolve ?? defaultResolve;
}

async function readCapped(body, maxBytes) {
  if (body === null || body === undefined) return Buffer.alloc(0);
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    const buf = Buffer.from(body);
    if (buf.length > maxBytes) throw new GatewayRefused('The gateway answer was larger than allowed.', 'TOO_LARGE');
    return buf;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) { body.destroy?.(); throw new GatewayRefused('The gateway answer was larger than allowed.', 'TOO_LARGE'); }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/** Authorization header for the gateway from decrypted credentials. */
export function authHeader(mode, creds) {
  if (!creds) return {};
  if (mode === 'BEARER' && creds.token) return { Authorization: `Bearer ${creds.token}` };
  if (mode === 'BASIC' && creds.username) return { Authorization: `Basic ${Buffer.from(`${creds.username}:${creds.password ?? ''}`).toString('base64')}` };
  return {};
}

/**
 * One request to the gateway. `base` is the configured gateway (URL or
 * string), `url` a URL already built with gatewayUrl(). Returns
 * `{ status, headers, body: Buffer }` for a 2xx; throws GatewayRefused otherwise.
 */
export async function gatewayRequest(base, url, { method = 'GET', headers = {}, body = null, maxBytes = 1_000_000, timeoutMs = 8000 } = {}) {
  const b = base instanceof URL ? base : assertGatewayBase(base);
  const target = gatewayUrl(b, url instanceof URL ? url.toString() : url);
  const host = target.hostname.replace(/^\[|\]$/g, '');
  let addresses;
  if (net.isIP(host)) addresses = [{ address: host, family: net.isIP(host) }];
  else {
    try { addresses = await resolver(host); } catch { throw new GatewayRefused(`Could not find the gateway ${host}.`, 'DNS_FAILED'); }
  }
  if (!addresses?.length) throw new GatewayRefused(`Could not find the gateway ${host}.`, 'DNS_FAILED');
  if (addresses.some((a) => !addressAllowed(a.address))) throw new GatewayRefused('The gateway resolves inside a private or reserved network.', 'SSRF_BLOCKED');
  const { address, family } = addresses[0];
  const signal = AbortSignal.timeout(timeoutMs);
  let res;
  try {
    res = await transport(target, { method, headers: { 'User-Agent': 'EduOS-CCTV/1.0', ...headers }, body, address, family, signal });
  } catch (err) {
    if (err instanceof GatewayRefused) throw err;
    throw new GatewayRefused(signal.aborted ? 'The gateway took too long to answer.' : `Could not reach the gateway (${err?.code ?? 'error'}).`, signal.aborted ? 'TIMEOUT' : 'UNREACHABLE');
  }
  if (res.status >= 300 && res.status < 400) {
    res.body?.destroy?.();
    throw new GatewayRefused('The gateway tried to redirect; redirects are not followed.', 'REDIRECT_REFUSED');
  }
  if (res.status < 200 || res.status >= 300) {
    res.body?.destroy?.();
    throw new GatewayRefused(`The gateway answered HTTP ${res.status}.`, res.status === 401 || res.status === 403 ? 'GATEWAY_AUTH' : res.status === 404 ? 'STREAM_NOT_FOUND' : 'HTTP_STATUS');
  }
  const declared = Number(res.headers?.['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) { res.body?.destroy?.(); throw new GatewayRefused('The gateway answer was larger than allowed.', 'TOO_LARGE'); }
  try {
    return { status: res.status, headers: res.headers ?? {}, body: await readCapped(res.body, maxBytes), url: target };
  } catch (err) {
    if (err instanceof GatewayRefused) throw err;
    throw new GatewayRefused(signal.aborted ? 'The gateway took too long to answer.' : 'The gateway stopped part-way.', signal.aborted ? 'TIMEOUT' : 'UNREACHABLE');
  }
}
