import { Resolver } from 'node:dns/promises';
import tls from 'node:tls';
import { env } from '../../config/env.js';

/**
 * The only two facts about a domain this platform can establish for itself.
 *
 *   DNS   whether the records a school was asked to create actually exist,
 *         answered by a real resolver query — not by the fact that someone
 *         typed a hostname into a form.
 *   TLS   whether https on that hostname presents a certificate that is valid
 *         for it, answered by a real handshake with certificate verification on.
 *
 * This deployment runs on Render with no reverse proxy of its own, no DNS
 * provider API and no ACME client, so it cannot CREATE records or ISSUE
 * certificates. It can only observe them. Everything that needs to happen at
 * a registrar or in the host's dashboard is written into the DNS instructions
 * instead (see domain.service.js#dnsInstructions and docs/DOMAINS.md).
 *
 * Both probes are held behind a swappable object so the test suite can answer
 * for DNS and TLS without the network — the service never branches on whether
 * it is under test, it just calls whatever probe is installed.
 */

/** DNS error codes that mean "the record is not there" rather than "we could not ask". */
const NOT_FOUND_CODES = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN', 'ENONAME']);

function resolver() {
  return new Resolver({ timeout: env.DOMAIN_CHECK_TIMEOUT_MS, tries: 2 });
}

/**
 * Runs one lookup and classifies the outcome.
 *
 * Returns { found: [...] } when the resolver answered (possibly with nothing),
 * or { error } when the question could not be asked — a timeout or SERVFAIL
 * is not evidence the record is missing, and the verifier must not treat it
 * as a failure.
 */
async function lookup(fn) {
  try {
    return { found: await fn() };
  } catch (err) {
    if (NOT_FOUND_CODES.has(err?.code)) return { found: [] };
    return { error: err?.code ?? err?.message ?? 'DNS_ERROR' };
  }
}

const liveDns = {
  /** TXT records, each flattened to one string. */
  txt: (hostname) => lookup(async () => (await resolver().resolveTxt(hostname)).map((chunks) => chunks.join(''))),
  cname: (hostname) => lookup(() => resolver().resolveCname(hostname)),
  /** A and AAAA together: "does this name point anywhere at all". */
  address: async (hostname) => {
    const [v4, v6] = await Promise.all([
      lookup(() => resolver().resolve4(hostname)),
      lookup(() => resolver().resolve6(hostname)),
    ]);
    const found = [...(v4.found ?? []), ...(v6.found ?? [])];
    if (found.length) return { found };
    if (v4.error && v6.error) return { error: v4.error };
    return { found: [] };
  },
};

/**
 * A TLS handshake to hostname:443 with SNI and full certificate verification.
 *
 * Resolves to { ok: true, validTo, issuer } or { ok: false, error }. Never
 * rejects: a failed handshake is an answer about the domain, not a fault.
 */
function liveTls(hostname) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    const socket = tls.connect({
      host: hostname,
      port: 443,
      servername: hostname,
      rejectUnauthorized: true,
      timeout: env.DOMAIN_CHECK_TIMEOUT_MS,
    });
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate();
      done({
        ok: socket.authorized,
        error: socket.authorized ? null : String(socket.authorizationError ?? 'CERT_NOT_TRUSTED'),
        validTo: cert?.valid_to ? new Date(cert.valid_to) : null,
        issuer: cert?.issuer?.O ?? cert?.issuer?.CN ?? null,
      });
    });
    socket.once('timeout', () => done({ ok: false, error: 'TLS_TIMEOUT' }));
    socket.once('error', (err) => done({ ok: false, error: err?.code ?? err?.message ?? 'TLS_ERROR' }));
  });
}

const live = { dns: liveDns, tls: liveTls };
let active = live;

/** The probes currently in force. */
export const probes = () => active;

/** Replaces the probes — for tests. Pass nothing to restore the real network checks. */
export function setDomainProbes(replacement) {
  active = replacement ? { ...live, ...replacement } : live;
}
