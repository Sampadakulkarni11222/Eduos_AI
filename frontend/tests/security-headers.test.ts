import { describe, it, expect } from 'vitest';
import { contentSecurityPolicy, originOf, securityHeaders } from '../security-headers.mjs';

/**
 * The frontend's response headers. What matters most here is what is NOT
 * enforced: the content security policy must stay report-only until it has
 * been watched against the live site, because a wrong one breaks payments and
 * sign-in.
 */

const header = (name: string, backendUrl?: string) =>
  securityHeaders({ backendUrl }).find((h) => h.key === name)?.value;

describe('securityHeaders', () => {
  it('enforces the headers that cannot break a page', () => {
    expect(header('X-Content-Type-Options')).toBe('nosniff');
    expect(header('X-Frame-Options')).toBe('DENY');
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('sends the content security policy as report-only, never enforced', () => {
    const keys = securityHeaders().map((h) => h.key);
    expect(keys).toContain('Content-Security-Policy-Report-Only');
    expect(keys).not.toContain('Content-Security-Policy');
  });

  it('does not switch off the microphone, which voice input uses', () => {
    expect(header('Permissions-Policy')).not.toMatch(/microphone/);
  });

  it('leaves HSTS to the proxy that terminates TLS', () => {
    expect(securityHeaders().map((h) => h.key)).not.toContain('Strict-Transport-Security');
  });
});

describe('contentSecurityPolicy', () => {
  const directive = (csp: string, name: string) =>
    csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';

  it('allows the API origin for calls and media, and nothing more of its URL', () => {
    const csp = contentSecurityPolicy({ backendUrl: 'https://api.example.com/api/v1?x=1' });
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self' https://*.razorpay.com https://api.example.com");
    expect(directive(csp, 'media-src')).toContain('https://api.example.com');
    expect(csp).not.toContain('/api/v1');
  });

  it('allows what Razorpay Checkout and the web fonts need', () => {
    const csp = contentSecurityPolicy();
    expect(directive(csp, 'script-src')).toContain('https://checkout.razorpay.com');
    expect(directive(csp, 'frame-src')).toContain('https://api.razorpay.com');
    expect(directive(csp, 'style-src')).toContain('https://fonts.googleapis.com');
    expect(directive(csp, 'font-src')).toContain('https://fonts.gstatic.com');
  });

  it('allows blob: images, which protected files and previews are', () => {
    expect(directive(contentSecurityPolicy(), 'img-src')).toContain('blob:');
  });

  it('refuses plugins, framing and a hijacked base URL', () => {
    const csp = contentSecurityPolicy();
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it('is still a valid policy when the API address is missing or malformed', () => {
    for (const backendUrl of [undefined, '', 'not a url', 'javascript:alert(1)']) {
      const csp = contentSecurityPolicy({ backendUrl });
      expect(directive(csp, 'connect-src')).toBe("connect-src 'self' https://*.razorpay.com");
      expect(csp).not.toMatch(/undefined|javascript:/);
    }
  });
});

describe('originOf', () => {
  it('keeps scheme, host and port only', () => {
    expect(originOf('http://localhost:5000/api/v1')).toBe('http://localhost:5000');
    expect(originOf('https://API.example.com')).toBe('https://api.example.com');
  });

  it('returns nothing for a value that is not an http(s) URL', () => {
    expect(originOf('ftp://example.com')).toBe('');
    expect(originOf(null)).toBe('');
  });
});
