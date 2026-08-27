/**
 * Declared here rather than imported from `next/dist/compiled/...`, which is an
 * internal path that does not expose `httpOnly` and is not part of Next's
 * public API.
 */
type RefreshCookieOptions = {
  httpOnly: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  secure: boolean;
  path: string;
  maxAge: number;
};

/** Name of the httpOnly cookie holding the refresh token. Server-side only. */
export const REFRESH_COOKIE = 'eduos_rt';

/**
 * Marker in localStorage saying "a session probably exists". Deliberately NOT
 * the token — just a boolean hint, so `hasSession()` can stay synchronous for
 * its callers without the refresh token ever touching JS-readable storage.
 * A stale or forged marker costs one failed refresh attempt and nothing more.
 */
export const SESSION_MARKER = 'eduos.session';

/** Mirrors REFRESH_TOKEN_TTL_DAYS in the backend's config/env.js. */
const REFRESH_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS) || 30;

export function refreshCookieOptions(): RefreshCookieOptions {
  return {
    httpOnly: true,
    // `lax` rather than `strict`: the cookie must survive a top-level
    // navigation back into the app (the OAuth redirect), which `strict` blocks.
    sameSite: 'lax',
    // Only over HTTPS in production; leaving this on in development would stop
    // the cookie being set at all over plain-http localhost.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60,
  };
}
