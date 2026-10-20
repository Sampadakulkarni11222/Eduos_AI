import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { encrypt, decrypt } from '../../utils/crypto.js';

/**
 * Playback tokens and opaque media references.
 *
 * A token is `base64url(payload).base64url(HMAC-SHA256)` over
 * { sid: view session, tid: school, exp }. It is short-lived (5 minutes) and
 * only half of the check: the proxy also loads the view session and requires
 * the same viewer, camera, address and browser it was started with, that the
 * viewing has not ended or gone idle, and that the camera is still enabled.
 *
 * Every URI inside a gateway playlist is replaced by an opaque reference
 * (AES-GCM over the camera id and the gateway path), so the browser never
 * learns the gateway address or a camera path.
 */
export const TOKEN_TTL_MS = 5 * 60_000;
const KEY = crypto.createHash('sha256').update(`eduos-cctv-playback:${env.JWT_SECRET}`).digest();

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export const hashOf = (value) => crypto.createHash('sha256').update(`cctv:${value ?? ''}`).digest('hex');

export function signToken({ sid, tid }, now = Date.now()) {
  const payload = b64url(JSON.stringify({ sid: String(sid), tid: String(tid), exp: now + TOKEN_TTL_MS }));
  const mac = b64url(crypto.createHmac('sha256', KEY).update(payload).digest());
  return { token: `${payload}.${mac}`, expiresAt: new Date(now + TOKEN_TTL_MS) };
}

/** Returns the payload or a reason: 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED'. */
export function verifyToken(token, now = Date.now()) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1] || parts[0].length > 400) return { error: 'MALFORMED' };
  const expected = crypto.createHmac('sha256', KEY).update(parts[0]).digest();
  const given = fromB64url(parts[1]);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { error: 'BAD_SIGNATURE' };
  let payload;
  try { payload = JSON.parse(fromB64url(parts[0]).toString('utf8')); } catch { return { error: 'MALFORMED' }; }
  if (!payload?.sid || !payload?.tid || !Number.isFinite(payload.exp)) return { error: 'MALFORMED' };
  if (payload.exp < now) return { error: 'EXPIRED' };
  return { payload };
}

/** An opaque reference to a gateway URL for one camera. */
export function encodeRef(streamId, url) {
  return b64url(Buffer.from(encrypt({ s: String(streamId), u: String(url) }), 'base64'));
}

export function decodeRef(ref) {
  try {
    const v = decrypt(fromB64url(ref).toString('base64'));
    return v?.s && v?.u ? v : null;
  } catch { return null; }
}

const URI_ATTR = /URI="([^"]*)"/;
const URI_TAGS = /^#EXT-X-(KEY|SESSION-KEY|MAP|MEDIA|I-FRAME-STREAM-INF|PRELOAD-HINT|PART|RENDITION-REPORT|SESSION-DATA)\b/;

/**
 * Rewrites an HLS playlist so every URI points back through the proxy.
 * `mapUri(absoluteUrl)` returns the proxy path for a gateway URL, or null for
 * one outside the gateway (that line or tag is dropped, never passed on).
 */
export function rewritePlaylist(text, playlistUrl, mapUri) {
  const out = [];
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { out.push(line); continue; }
    if (trimmed.startsWith('#')) {
      if (URI_TAGS.test(trimmed) && URI_ATTR.test(trimmed)) {
        const raw = URI_ATTR.exec(trimmed)[1];
        let abs = null;
        try { abs = new URL(raw, playlistUrl); } catch { abs = null; }
        const mapped = abs ? mapUri(abs) : null;
        if (mapped === null) continue;
        out.push(trimmed.replace(URI_ATTR, `URI="${mapped}"`));
      } else out.push(line);
      continue;
    }
    let abs = null;
    try { abs = new URL(trimmed, playlistUrl); } catch { abs = null; }
    const mapped = abs ? mapUri(abs) : null;
    if (mapped === null) {
      // Drop the segment and the #EXTINF / #EXT-X-STREAM-INF that described it.
      const prev = out[out.length - 1];
      if (prev && /^#EXT(INF|-X-STREAM-INF)/.test(prev.trim())) out.pop();
      continue;
    }
    out.push(mapped);
  }
  return out.join('\n');
}
