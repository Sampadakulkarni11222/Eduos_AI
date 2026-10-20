import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';

/**
 * The provider connections panel (Connectors and Social pages): explains a
 * missing app configuration, connects through the provider's page with a tab
 * nonce, shows scopes, last problem and the asset choice, and never shows a token.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/oakridge/marketing/connectors', useParams: () => ({ school: 'oakridge' }), useSearchParams: () => new URLSearchParams() }));
const api = vi.hoisted(() => ({ overview: vi.fn(), connect: vi.fn(), selectAssets: vi.fn(), refreshAssets: vi.fn(), disconnect: vi.fn(), complete: vi.fn(), engagement: vi.fn() }));
vi.mock('@/lib/integrations-api', async (orig) => ({ ...(await orig<typeof import('@/lib/integrations-api')>()), integrationsApi: api }));

const { IntegrationsPanel } = await import('@/components/ops/integrations-panel');
const inApp = (ui: ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);

const provider = (over: Record<string, unknown>) => ({
  provider: 'META', label: 'Meta (Facebook Pages, Instagram, Meta Ads)', appConfigured: true, missingEnv: [], message: null, pkce: false,
  products: { ads: ['META_ADS'], social: ['FACEBOOK', 'INSTAGRAM'] }, scopes: { ads: ['ads_read', 'leads_retrieval'], social: ['pages_manage_posts'] },
  canConnect: { ads: true, social: true }, mode: 'SIMULATED', connection: null, ...over,
});

beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); });

describe('IntegrationsPanel', () => {
  it('says the platform administrator must configure the app, and offers no connect button', async () => {
    api.overview.mockResolvedValue({ redirectUri: 'https://x/oauth/callback', providers: [provider({ appConfigured: false, message: 'The Meta app is not configured on this EduOS installation. The platform administrator must set META_APP_ID and META_APP_SECRET.' })] });
    inApp(<IntegrationsPanel purpose="ads" />);
    expect(await screen.findByText(/platform administrator must set META_APP_ID/)).toBeTruthy();
    expect(screen.getByText('App not configured · Simulated')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull();
  });

  it('connects through the provider page, keeping a nonce in the tab', async () => {
    api.overview.mockResolvedValue({ redirectUri: 'https://x/oauth/callback', providers: [provider({})] });
    api.connect.mockResolvedValue({ provider: 'META', authorizeUrl: 'https://www.facebook.com/v21.0/dialog/oauth?state=s', purposes: ['ads', 'social'], scopes: [] });
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, pathname: '/oakridge/marketing/connectors', assign }, writable: true });
    inApp(<IntegrationsPanel purpose="ads" />);
    expect(await screen.findByText(/ads_read leads_retrieval pages_manage_posts/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://www.facebook.com/v21.0/dialog/oauth?state=s'));
    const body = api.connect.mock.calls[0][1];
    expect(body.browserNonce).toMatch(/^[a-f0-9]{48}$/);
    expect(body.returnPath).toBe('/oakridge/marketing/connectors');
    expect(JSON.parse(sessionStorage.getItem('eduos.oauth') ?? '{}').browserNonce).toBe(body.browserNonce);
  });

  it('shows a connection: granted scopes, the last problem, and the ad account choice', async () => {
    api.overview.mockResolvedValue({ redirectUri: 'https://x/oauth/callback', providers: [provider({
      mode: 'LIVE',
      connection: {
        provider: 'META', status: 'CONNECTED', purposes: ['ads'], scopes: ['ads_read'], accountName: 'Asha Rao',
        assets: { metaAdAccounts: [{ id: '555', name: 'Oakridge ads', currency: 'INR' }] }, selected: { metaAdAccountId: '555' },
        accessExpiresAt: null, lastRefreshAt: null, lastError: { at: '2026-10-10T10:00:00Z', message: 'Meta: User request limit reached' }, connectedAt: '2026-10-01T10:00:00Z', connectedByName: 'Admin', revokeResult: null,
      },
    })] });
    inApp(<IntegrationsPanel purpose="ads" />);
    expect(await screen.findByText('Connected · Live')).toBeTruthy();
    expect(screen.getByText(/User request limit reached/)).toBeTruthy();
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('555');
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/token/i);
  });
});
