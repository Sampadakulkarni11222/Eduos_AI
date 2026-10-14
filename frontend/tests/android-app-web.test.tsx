import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildAssetLinks } from '@/lib/asset-links';
import { isDevOnlyPath, routeForSchoolHost } from '@/lib/domain-routing';
import { withSchool } from '@/lib/school-path';
import manifest from '@/app/manifest';
import GoogleMockAuthPage from '@/app/(auth)/login/google-mock-auth/page';

// What Next's notFound() does: it never returns.
const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('next/navigation', () => ({ notFound }));

/**
 * The web side of the Android app: the manifest it is generated from, the
 * Digital Asset Links file that lets it run without a browser bar, and the
 * development-only page that must not exist in a production build.
 */

const FP_A = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0').toUpperCase()).join(':');
const FP_B = Array.from({ length: 32 }, (_, i) => (255 - i).toString(16).padStart(2, '0').toUpperCase()).join(':');

describe('buildAssetLinks', () => {
  it('publishes nothing until both values are configured', () => {
    expect(buildAssetLinks(undefined, undefined)).toBeNull();
    expect(buildAssetLinks('ai.example.app', undefined)).toBeNull();
    expect(buildAssetLinks('', FP_A)).toBeNull();
    expect(buildAssetLinks('ai.example.app', '  ,  ')).toBeNull();
  });

  it('builds the statement Android verifies', () => {
    expect(buildAssetLinks('ai.example.app', FP_A)).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: 'ai.example.app', sha256_cert_fingerprints: [FP_A] },
      },
    ]);
  });

  it('accepts several fingerprints, normalised and de-duplicated', () => {
    const links = buildAssetLinks(' ai.example.app ', `${FP_A.toLowerCase()}, ${FP_B} ,${FP_A}`);
    expect(links?.[0].target.sha256_cert_fingerprints).toEqual([FP_A, FP_B]);
  });

  it.each([['app'], ['1ai.example'], ['ai..example'], ['ai.example.'], ['ai.example/app'], ['ai example.app']])(
    'refuses the package name %j',
    (pkg) => {
      expect(buildAssetLinks(pkg, FP_A)).toBeNull();
    },
  );

  it('refuses the whole list when one fingerprint is malformed', () => {
    expect(buildAssetLinks('ai.example.app', `${FP_A},${FP_A.slice(3)}`)).toBeNull();
    expect(buildAssetLinks('ai.example.app', FP_A.replaceAll(':', ''))).toBeNull();
    expect(buildAssetLinks('ai.example.app', FP_A.replace('00', 'ZZ'))).toBeNull();
  });
});

describe('the web app manifest', () => {
  const m = manifest();

  it('opens at the school finder, as a standalone app, within this site', () => {
    expect(m.start_url).toBe('/find-school');
    expect(m.scope).toBe('/');
    expect(m.display).toBe('standalone');
  });

  it('names no host, so it is correct wherever it is served', () => {
    expect(JSON.stringify(m)).not.toMatch(/https?:\/\//);
  });

  it('has the icons an installable app needs', () => {
    const has = (sizes: string, purpose: string) =>
      m.icons?.some((i) => i.sizes === sizes && i.purpose === purpose && i.type === 'image/png');
    expect(has('192x192', 'any')).toBe(true);
    expect(has('512x512', 'any')).toBe(true);
    expect(has('512x512', 'maskable')).toBe(true);
  });
});

describe('routing around the new pages', () => {
  it('knows the development-only page, however the path is written', () => {
    expect(isDevOnlyPath('/login/google-mock-auth')).toBe(true);
    expect(isDevOnlyPath('/login/google-mock-auth/')).toBe(true);
    expect(isDevOnlyPath('/Login/Google-Mock-Auth')).toBe(true);
    expect(isDevOnlyPath('/login')).toBe(false);
    expect(isDevOnlyPath('/login/google-mock-authority')).toBe(false);
  });

  it('keeps the finder off a school’s own domain, where only that school exists', () => {
    expect(routeForSchoolHost('/find-school', 'oakridge')).toEqual({ action: 'redirect', to: '/oakridge' });
    // On the platform's host (no resolved school) it is served as it is.
    expect(routeForSchoolHost('/find-school', null)).toEqual({ action: 'next' });
  });

  it('never prefixes the finder with a school', () => {
    expect(withSchool('oakridge', '/find-school')).toBe('/find-school');
  });
});

describe('the mock Google account chooser', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    notFound.mockClear();
  });

  it('is not found in a production build', async () => {
    // The page decides when it is loaded, as the bundler does at build time,
    // so it has to be loaded afresh with production already in place.
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const { default: ProductionPage } = await import('@/app/(auth)/login/google-mock-auth/page');
    expect(() => ProductionPage()).toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it('is still there outside production', () => {
    expect(process.env.NODE_ENV).not.toBe('production');
    expect(GoogleMockAuthPage()).toBeTruthy();
    expect(notFound).not.toHaveBeenCalled();
  });
});
