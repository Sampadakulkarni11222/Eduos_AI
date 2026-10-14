/**
 * Response headers for every page the frontend serves.
 *
 * Plain .mjs so next.config.mjs can import it and the tests can call it.
 *
 * Two groups, deliberately treated differently:
 *
 *   Enforced   headers that cannot break a working page: no MIME sniffing, no
 *              framing by other sites, a referrer that keeps paths private,
 *              and no geolocation (nothing in the portal asks for it).
 *
 *   Reported   the content security policy, sent as
 *              Content-Security-Policy-Report-Only. The browser logs what it
 *              would have blocked and blocks nothing. A wrong CSP breaks
 *              Razorpay Checkout or Google sign-in outright, and neither can be
 *              exercised without the live domain — so this is the policy to
 *              watch in the console there, and to enforce once it stays quiet.
 *
 * Strict-Transport-Security is not set here: TLS ends at the reverse proxy in
 * front of this server, which is the layer that knows whether every subdomain
 * is on HTTPS, and that is where it belongs.
 */

/** `https://api.example.com/x` → `https://api.example.com`; '' when unusable. */
export function originOf(url) {
  try {
    const { protocol, host } = new URL(String(url ?? ''));
    return protocol === 'http:' || protocol === 'https:' ? `${protocol}//${host}` : '';
  } catch {
    return '';
  }
}

/**
 * The policy, as a list of directives.
 *
 * `backendUrl` is the API's public address (NEXT_PUBLIC_BACKEND_URL): the
 * browser calls it directly and loads uploaded images from it.
 */
export function contentSecurityPolicy({ backendUrl } = {}) {
  const backend = originOf(backendUrl);
  const withBackend = (...sources) => [...sources, ...(backend ? [backend] : [])].join(' ');

  return [
    "default-src 'self'",
    // Next.js emits inline bootstrap scripts; a nonce would remove the need for
    // 'unsafe-inline' but turns every page dynamic. Razorpay requires its
    // hosted checkout.js.
    "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com",
    // Inline styles are used throughout the portal; the fonts come from Google.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    // School logos may be any https URL a school configured; protected files
    // and previews are blob: URLs.
    "img-src 'self' data: blob: https:",
    `connect-src ${withBackend("'self'", 'https://*.razorpay.com')}`,
    'frame-src https://api.razorpay.com https://checkout.razorpay.com',
    "worker-src 'self' blob:",
    `media-src ${withBackend("'self'", 'blob:')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** The headers, in the shape Next's `headers()` wants. */
export function securityHeaders({ backendUrl } = {}) {
  return [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'geolocation=()' },
    { key: 'Content-Security-Policy-Report-Only', value: contentSecurityPolicy({ backendUrl }) },
  ];
}
