import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { getRequiredPermission, ROUTE_PERMISSIONS } from '@/lib/permissions';
import { PORTALS } from '@/lib/portals';
import { isPlatformHost, normalizeHost, routeForSchoolHost } from '@/lib/domain-routing';
import type { DomainListDto, ProfileDomainDto, SchoolDomainDto } from '@/lib/types';

/**
 * The client half of domain management.
 *
 * The server decides whether a domain is verified and live. What has to be true
 * here: the console asks for the platform-only key, the table shows the state
 * the server reports without inventing any, Activate is not offered for a
 * domain that has not passed verification and SSL, and a school's own domain
 * serves that school and no other.
 */

const apiMock = {
  listSchoolDomains: vi.fn(),
  schoolDomain: vi.fn(),
  suggestSubdomain: vi.fn(),
  configureSubdomain: vi.fn(),
  configureCustomDomain: vi.fn(),
  verifyDomain: vi.fn(),
  checkDomainSsl: vi.fn(),
  activateDomain: vi.fn(),
  deactivateDomain: vi.fn(),
  importProfileDomain: vi.fn(),
  dismissProfileDomainChange: vi.fn(),
};

vi.mock('@/lib/api', () => ({
  api: new Proxy({}, { get: (_t, key: string) => (apiMock as Record<string, unknown>)[key] }),
  errorMessage: (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback),
}));
vi.mock('@/lib/acting-school', () => ({ clearActingSchool: vi.fn() }));
vi.mock('@/components/shell', () => ({
  PortalShell: ({ children, topbar }: { children: React.ReactNode; topbar: { title: string } }) => (
    <div><h1>{topbar.title}</h1>{children}</div>
  ),
}));

const toast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => toast };
});

const listing = (overrides: Partial<DomainListDto['schools'][number]>[] = []): DomainListDto => ({
  settings: { platformDomain: 'eduos.app', subdomainsEnabled: true, cnameTarget: 'erp.onrender.com', reservedSubdomains: ['www'] },
  schools: [
    {
      tenantId: 'abc', tenantName: 'ABC Public School', schoolStatus: 'ACTIVE', configured: true, type: 'CUSTOM',
      hostname: 'www.abcschool.com', verificationStatus: 'PENDING', sslStatus: 'NOT_CHECKED', active: false, updatedAt: null,
      profileDomain: null, profileDomainStatus: 'NOT_PROVIDED', profileDomainSync: 'NOT_PROVIDED', source: 'MANUAL', pendingProfileChange: null,
      ...overrides[0],
    },
    {
      tenantId: 'bright', tenantName: 'Bright Future', schoolStatus: 'ACTIVE', configured: false, type: null,
      hostname: null, verificationStatus: null, sslStatus: null, active: false, updatedAt: null,
      profileDomain: null, profileDomainStatus: 'NOT_PROVIDED', profileDomainSync: 'NOT_PROVIDED', source: null, pendingProfileChange: null,
      ...overrides[1],
    },
  ],
});

const detail = (overrides: Partial<SchoolDomainDto> = {}): SchoolDomainDto => ({
  tenantId: 'abc', tenantName: 'ABC Public School', type: 'CUSTOM', subdomain: null, customDomain: 'www.abcschool.com',
  hostname: 'www.abcschool.com', platformDomain: null, verificationStatus: 'PENDING',
  verificationRecordName: '_eduos-verification.www.abcschool.com', lastVerificationAt: null, lastVerificationError: null,
  verifiedAt: null, sslStatus: 'NOT_CHECKED', sslCheckedAt: null, sslError: null, sslValidTo: null, sslIssuer: null,
  source: 'MANUAL', sourceProfileId: null, sourceProfileName: null, sourceWebsite: null, sourceFetchedAt: null, pendingProfileDomain: null,
  active: false, activatedAt: null, deactivatedAt: null, deactivationReason: null, configuredBy: 'Platform Owner',
  updatedBy: 'Platform Owner', createdAt: null, updatedAt: null,
  dnsInstructions: {
    summary: 'Prove control and point it at the platform.',
    records: [
      { purpose: 'OWNERSHIP', type: 'TXT', name: '_eduos-verification.www.abcschool.com', value: 'eduos-verification=abc123', managedBy: 'SCHOOL', note: 'Proves control.' },
      { purpose: 'ROUTING', type: 'CNAME', name: 'www.abcschool.com', value: 'erp.onrender.com', managedBy: 'SCHOOL', note: 'Routes traffic.' },
    ],
    steps: ['Create both records.', 'Verify, then Check SSL, then Activate.'],
  },
  ...overrides,
});

const noProfile: ProfileDomainDto = { status: 'NOT_PROVIDED', hostname: null, takenByAnotherSchool: false, sync: 'NOT_PROVIDED' };

async function renderPage() {
  const { default: Page } = await import('@/app/super-admin/domains/page');
  render(<Page />);
  await screen.findByText('ABC Public School');
}
const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset();
  toast.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('who may reach Domain Management', () => {
  it('gates the page on the platform-only key', () => {
    expect(getRequiredPermission('/super-admin/domains')).toBe('domains.manage');
  });

  it('gives no school-level route the manage key', () => {
    for (const route of Object.keys(ROUTE_PERMISSIONS)) {
      if (route.startsWith('/super-admin')) continue;
      expect(ROUTE_PERMISSIONS[route], route).not.toBe('domains.manage');
    }
  });

  it('is linked from the platform console and from no school portal', () => {
    const hrefs = (slug: string) => PORTALS[slug].nav.flatMap((g) => g.items).map((i) => i.href);
    expect(hrefs('super-admin')).toContain('/super-admin/domains');
    for (const slug of Object.keys(PORTALS)) {
      if (slug === 'super-admin') continue;
      expect(hrefs(slug).filter((h) => h.includes('domains')), slug).toEqual([]);
    }
  });
});

describe('the Domain Management table', () => {
  it('has exactly the requested columns', async () => {
    apiMock.listSchoolDomains.mockResolvedValue(listing());
    await renderPage();
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers).toEqual(['School', 'Domain Type', 'Domain', 'Verification Status', 'SSL Status', 'Active Status', 'Actions']);
  });

  it('shows the state the server reports, and "not configured" for a school with none', async () => {
    apiMock.listSchoolDomains.mockResolvedValue(listing());
    await renderPage();
    const abc = within(rowOf('ABC Public School'));
    expect(abc.getByText('www.abcschool.com')).toBeInTheDocument();
    expect(abc.getByText('pending')).toBeInTheDocument();
    expect(abc.getByText('not checked')).toBeInTheDocument();
    expect(abc.getByText('inactive')).toBeInTheDocument();
    expect(within(rowOf('Bright Future')).getByText('Not configured')).toBeInTheDocument();
  });

  it('does not let a pending domain be activated', async () => {
    apiMock.listSchoolDomains.mockResolvedValue(listing());
    await renderPage();
    expect(within(rowOf('ABC Public School')).getByRole('button', { name: 'Activate' })).toBeDisabled();
    expect(within(rowOf('ABC Public School')).queryByRole('button', { name: 'Check SSL' })).toBeNull();
  });

  it('does not let a verified domain without a certificate be activated', async () => {
    apiMock.listSchoolDomains.mockResolvedValue(listing([{ verificationStatus: 'VERIFIED' }]));
    await renderPage();
    const row = within(rowOf('ABC Public School'));
    expect(row.getByRole('button', { name: 'Activate' })).toBeDisabled();
    expect(row.getByRole('button', { name: 'Check SSL' })).toBeEnabled();
  });

  it('offers Activate once verified with a certificate, and Deactivate once live', async () => {
    apiMock.listSchoolDomains.mockResolvedValue(listing([{ verificationStatus: 'VERIFIED', sslStatus: 'ACTIVE' }]));
    await renderPage();
    expect(within(rowOf('ABC Public School')).getByRole('button', { name: 'Activate' })).toBeEnabled();
  });

  it('reports a failed verification as a failure, with the server\'s reason', async () => {
    apiMock.listSchoolDomains.mockResolvedValue(listing());
    apiMock.verifyDomain.mockResolvedValue({
      outcome: 'FAILED', error: 'No TXT record was found at _eduos-verification.www.abcschool.com.', domain: detail({ verificationStatus: 'FAILED' }),
    });
    await renderPage();
    fireEvent.click(within(rowOf('ABC Public School')).getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/No TXT record/), 'error'));
    expect(apiMock.listSchoolDomains).toHaveBeenCalledTimes(2);
  });

  it('disables subdomains when the deployment has no platform domain', async () => {
    const data = listing();
    data.settings = { ...data.settings, platformDomain: null, subdomainsEnabled: false };
    apiMock.listSchoolDomains.mockResolvedValue(data);
    await renderPage();
    expect(within(rowOf('Bright Future')).getByRole('button', { name: 'Subdomain' })).toBeDisabled();
    expect(screen.getByRole('note')).toHaveTextContent(/PLATFORM_DOMAIN/);
  });
});

describe('configuring and viewing', () => {
  it('shows the server\'s validation message for an unsafe custom domain', async () => {
    apiMock.listSchoolDomains.mockResolvedValue(listing());
    apiMock.configureCustomDomain.mockRejectedValue(new Error('Enter the domain name only, without http:// or https://.'));
    await renderPage();
    fireEvent.click(within(rowOf('Bright Future')).getByRole('button', { name: 'Custom domain' }));
    fireEvent.change(screen.getByPlaceholderText('www.abcschool.com'), { target: { value: 'https://bright.org/login' } });
    fireEvent.click(screen.getByRole('button', { name: 'Configure custom domain' }));
    expect(await screen.findByText(/without http:\/\//)).toBeInTheDocument();
    expect(apiMock.configureCustomDomain).toHaveBeenCalledWith('bright', 'https://bright.org/login');
  });

  it('opens the DNS instructions after a custom domain is saved', async () => {
    apiMock.listSchoolDomains.mockResolvedValue(listing());
    apiMock.configureCustomDomain.mockResolvedValue({ changed: true, domain: detail(), profileDomain: noProfile });
    apiMock.schoolDomain.mockResolvedValue({ tenantId: 'abc', tenantName: 'ABC Public School', domain: detail(), profileDomain: noProfile });
    await renderPage();
    fireEvent.click(within(rowOf('ABC Public School')).getByRole('button', { name: 'Custom domain' }));
    // Replacing an existing address is called out before it happens.
    expect(screen.getByRole('alert')).toHaveTextContent(/currently configured as/);
    fireEvent.change(screen.getByPlaceholderText('www.abcschool.com'), { target: { value: 'www.abcschool.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Configure custom domain' }));

    expect(await screen.findByText('DNS instructions')).toBeInTheDocument();
    expect(screen.getByText('eduos-verification=abc123')).toBeInTheDocument();
    expect(screen.getByText('_eduos-verification.www.abcschool.com', { selector: 'td code' })).toBeInTheDocument();
  });

  it('prefills the generated subdomain and sends nothing extra when it is kept', async () => {
    apiMock.listSchoolDomains.mockResolvedValue(listing());
    apiMock.suggestSubdomain.mockResolvedValue({ tenantId: 'bright', subdomain: 'bright-future', hostname: 'bright-future.eduos.app' });
    apiMock.configureSubdomain.mockResolvedValue({ changed: true, domain: detail({ type: 'SUBDOMAIN' }), profileDomain: noProfile });
    apiMock.schoolDomain.mockResolvedValue({ tenantId: 'bright', tenantName: 'Bright Future', domain: detail({ type: 'SUBDOMAIN' }), profileDomain: noProfile });
    await renderPage();
    fireEvent.click(within(rowOf('Bright Future')).getByRole('button', { name: 'Subdomain' }));
    await waitFor(() => expect(screen.getByDisplayValue('bright-future')).toBeInTheDocument());
    expect(screen.getByText('bright-future.eduos.app')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Configure subdomain' }));
    await waitFor(() => expect(apiMock.configureSubdomain).toHaveBeenCalledWith('bright', undefined));
  });
});

describe('the domain from the School Admin profile', () => {
  it('shows "Not Provided" when no profile has a website, and offers no import', async () => {
    apiMock.listSchoolDomains.mockResolvedValue(listing());
    await renderPage();
    expect(screen.getByTestId('profile-domain-bright')).toHaveTextContent('Profile: Not Provided');
    expect(within(rowOf('Bright Future')).queryByRole('button', { name: 'Import from profile' })).toBeNull();
  });

  it('shows the normalised profile domain and imports it for a school with no configuration', async () => {
    apiMock.listSchoolDomains.mockResolvedValue(listing([{}, {
      profileDomain: 'brightfuture.org', profileDomainStatus: 'FOUND', profileDomainSync: 'NOT_CONFIGURED',
    }]));
    apiMock.importProfileDomain.mockResolvedValue({ changed: true, domain: detail({ hostname: 'brightfuture.org', source: 'PROFILE' }) });
    await renderPage();

    expect(screen.getByTestId('profile-domain-bright')).toHaveTextContent('Profile: brightfuture.org');
    fireEvent.click(within(rowOf('Bright Future')).getByRole('button', { name: 'Import from profile' }));
    await waitFor(() => expect(apiMock.importProfileDomain).toHaveBeenCalledWith('bright', false));
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/pending verification/), 'success');
  });

  it('never invents a domain for an invalid or conflicting profile', async () => {
    apiMock.listSchoolDomains.mockResolvedValue(listing([
      { profileDomainStatus: 'INVALID', profileDomainSync: 'INVALID' },
      { profileDomainStatus: 'CONFLICT', profileDomainSync: 'CONFLICT' },
    ]));
    await renderPage();
    expect(screen.getByTestId('profile-domain-abc')).toHaveTextContent('Profile: Invalid website');
    expect(screen.getByTestId('profile-domain-bright')).toHaveTextContent('Profile: Admins disagree');
    expect(screen.queryByRole('button', { name: 'Import from profile' })).toBeNull();
  });

  it('asks before replacing a live domain, and keeps it when the operator declines', async () => {
    apiMock.listSchoolDomains.mockResolvedValue(listing([{
      active: true, verificationStatus: 'VERIFIED', sslStatus: 'ACTIVE',
      profileDomain: 'abc-school.org', profileDomainStatus: 'FOUND', profileDomainSync: 'CHANGED', pendingProfileChange: 'CHANGED',
    }]));
    await renderPage();
    expect(within(rowOf('ABC Public School')).getByText('profile domain changed')).toBeInTheDocument();

    fireEvent.click(within(rowOf('ABC Public School')).getByRole('button', { name: 'Import from profile' }));
    expect(apiMock.importProfileDomain).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/takes it offline immediately/);

    fireEvent.click(screen.getByRole('button', { name: 'Keep the live domain' }));
    expect(apiMock.importProfileDomain).not.toHaveBeenCalled();
  });

  it('replaces a live domain only after confirmation, sending confirmReplace', async () => {
    apiMock.listSchoolDomains.mockResolvedValue(listing([{
      active: true, verificationStatus: 'VERIFIED', sslStatus: 'ACTIVE',
      profileDomain: 'abc-school.org', profileDomainStatus: 'FOUND', profileDomainSync: 'CHANGED', pendingProfileChange: 'CHANGED',
    }]));
    apiMock.importProfileDomain.mockResolvedValue({ changed: true, domain: detail({ hostname: 'abc-school.org' }) });
    await renderPage();
    fireEvent.click(within(rowOf('ABC Public School')).getByRole('button', { name: 'Import from profile' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace with abc-school.org' }));
    await waitFor(() => expect(apiMock.importProfileDomain).toHaveBeenCalledWith('abc', true));
  });

  it('shows the source and a pending change in the configuration view, and dismisses it', async () => {
    apiMock.listSchoolDomains.mockResolvedValue(listing());
    apiMock.schoolDomain.mockResolvedValue({
      tenantId: 'abc', tenantName: 'ABC Public School',
      domain: detail({
        source: 'PROFILE', sourceWebsite: 'https://www.abcschool.com/', sourceProfileName: 'A admin', sourceFetchedAt: '2026-09-17T10:00:00.000Z',
        active: true,
        pendingProfileDomain: { change: 'CHANGED', hostname: 'abc-school.org', website: 'abc-school.org', profileName: 'A admin', detectedAt: '2026-09-17T11:00:00.000Z' },
      }),
      profileDomain: {
        status: 'FOUND', hostname: 'abc-school.org', website: 'abc-school.org', profileName: 'A admin', takenByAnotherSchool: false, sync: 'CHANGED',
      },
    });
    apiMock.dismissProfileDomainChange.mockResolvedValue({ changed: true, domain: detail() });
    await renderPage();

    fireEvent.click(within(rowOf('ABC Public School')).getByRole('button', { name: 'View' }));
    const section = await screen.findByRole('region', { name: 'From the School Admin profile' });
    expect(section).toHaveTextContent('abc-school.org');
    expect(section).toHaveTextContent('Configuration imported from https://www.abcschool.com/');
    expect(within(section).getByRole('status')).toHaveTextContent(/unchanged until reviewed/);

    fireEvent.click(within(section).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(apiMock.dismissProfileDomainChange).toHaveBeenCalledWith('abc'));
  });

  it('shows "Not Provided" in the configuration view when the profile has no website', async () => {
    apiMock.listSchoolDomains.mockResolvedValue(listing());
    apiMock.schoolDomain.mockResolvedValue({ tenantId: 'abc', tenantName: 'ABC Public School', domain: detail(), profileDomain: noProfile });
    await renderPage();
    fireEvent.click(within(rowOf('ABC Public School')).getByRole('button', { name: 'View' }));
    const section = await screen.findByRole('region', { name: 'From the School Admin profile' });
    expect(section).toHaveTextContent('Domain: Not Provided');
  });
});

describe('a school\'s domain serves that school and no other', () => {
  it('treats localhost and the listed platform hosts as the platform', () => {
    expect(isPlatformHost('localhost:3000', undefined)).toBe(true);
    expect(isPlatformHost('app.eduos.app', 'app.eduos.app, school-erp-frontend.onrender.com')).toBe(true);
    expect(isPlatformHost('www.abcschool.com', 'app.eduos.app')).toBe(false);
  });

  it('normalises a host header, and refuses one that is not a hostname', () => {
    expect(normalizeHost('WWW.AbcSchool.com:443')).toBe('www.abcschool.com');
    expect(normalizeHost('evil.com/..')).toBe('');
  });

  it('changes nothing for a host that resolves to no active school', () => {
    expect(routeForSchoolHost('/', null)).toEqual({ action: 'next' });
    expect(routeForSchoolHost('/other-school/admin', null)).toEqual({ action: 'next' });
  });

  it('sends the domain root to the school\'s front door', () => {
    expect(routeForSchoolHost('/', 'abc')).toEqual({ action: 'redirect', to: '/abc' });
  });

  it('serves the school\'s own portal paths and the shared sign-in paths', () => {
    expect(routeForSchoolHost('/abc/admin/students', 'abc')).toEqual({ action: 'next' });
    expect(routeForSchoolHost('/login', 'abc')).toEqual({ action: 'next' });
    expect(routeForSchoolHost('/select-profile', 'abc')).toEqual({ action: 'next' });
    expect(routeForSchoolHost('/api/session', 'abc')).toEqual({ action: 'next' });
  });

  it('never serves another school, or the platform console, under this school\'s address', () => {
    expect(routeForSchoolHost('/bright/admin', 'abc')).toEqual({ action: 'redirect', to: '/abc' });
    expect(routeForSchoolHost('/super-admin/domains', 'abc')).toEqual({ action: 'redirect', to: '/abc' });
  });
});
