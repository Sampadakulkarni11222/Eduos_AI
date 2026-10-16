'use client';
import { useState } from 'react';
import { Button, Modal, Pill, useToast } from '@/components/ui';
import {
  integrationsApi, newBrowserNonce, OAUTH_STORAGE_KEY,
  type ConnectionDto, type ProviderDto, type ProviderKey, type Purpose, type AssetRef,
} from '@/lib/integrations-api';
import { ErrorNote, Loadable, SectionCard, fmtDateTime, useAction, useLoad } from './kit';

/**
 * Connect, choose and disconnect the school's provider accounts (Meta, Google,
 * LinkedIn, X) through each provider's own sign-in (OAuth). Shown on the ad
 * Connectors page (purpose "ads") and the Social page (purpose "social").
 *
 * When the platform administrator has not configured a provider's app, the
 * card says so and nothing can be connected: everything stays Simulated.
 * Tokens never reach this page.
 */

const SHOWN: Record<Purpose, ProviderKey[]> = { ads: ['META', 'GOOGLE', 'LINKEDIN'], social: ['META', 'LINKEDIN', 'X', 'GOOGLE'] };

interface Picker { key: string; label: string; options: (c: ConnectionDto) => AssetRef[]; value: (a: AssetRef) => string; text: (a: AssetRef) => string }
const byId = (a: AssetRef) => a.id ?? '';
const named = (a: AssetRef) => `${a.name}${a.id ? ` (${a.id})` : ''}`;
const PICKERS: Record<ProviderKey, Record<Purpose, Picker[]>> = {
  META: {
    ads: [{ key: 'metaAdAccountId', label: 'Ad account', options: (c) => c.assets.metaAdAccounts ?? [], value: byId, text: (a) => `${a.name} (act_${a.id})${a.currency && a.currency !== 'INR' ? ` · ${a.currency}` : ''}` }],
    social: [{ key: 'metaPageId', label: 'Facebook Page (and its Instagram)', options: (c) => c.assets.metaPages ?? [], value: byId, text: (a) => `${a.name}${a.igUsername ? ` · Instagram @${a.igUsername}` : ' · no Instagram linked'}` }],
  },
  GOOGLE: {
    ads: [
      { key: 'googleCustomerId', label: 'Google Ads customer', options: (c) => c.assets.googleCustomers ?? [], value: byId, text: (a) => a.name },
      { key: 'ga4PropertyId', label: 'Analytics 4 property', options: (c) => c.assets.ga4Properties ?? [], value: byId, text: named },
    ],
    social: [{ key: 'youtubeChannelId', label: 'YouTube channel', options: (c) => c.assets.youtubeChannels ?? [], value: byId, text: (a) => a.name }],
  },
  LINKEDIN: {
    ads: [{ key: 'linkedinAdAccountId', label: 'Campaign Manager ad account', options: (c) => c.assets.linkedinAdAccounts ?? [], value: byId, text: named }],
    social: [{ key: 'linkedinOrgUrn', label: 'Organisation page', options: (c) => c.assets.linkedinOrgs ?? [], value: (a) => a.urn ?? '', text: (a) => a.name }],
  },
  X: { ads: [], social: [] },
};

function statusOf(p: ProviderDto): { tone: 'green' | 'amber' | 'gray' | 'red'; text: string } {
  if (!p.appConfigured) return { tone: 'gray', text: 'App not configured · Simulated' };
  const c = p.connection;
  if (!c || c.status === 'DISCONNECTED') return { tone: 'gray', text: 'Not connected · Simulated' };
  if (c.status === 'NEEDS_RECONNECT') return { tone: 'red', text: 'Needs reconnecting' };
  return { tone: 'green', text: 'Connected · Live' };
}

function ProviderCard({ p, purpose, onChanged }: { p: ProviderDto; purpose: Purpose; onChanged: () => void }) {
  const { run, busy, error } = useAction();
  const toast = useToast();
  const [confirmOff, setConfirmOff] = useState(false);
  const c = p.connection;
  const live = c && c.status !== 'DISCONNECTED';
  const st = statusOf(p);
  const canConnect = p.canConnect[purpose];
  const pickers = live ? PICKERS[p.provider][purpose] : [];

  const connect = () => void run(async () => {
    const browserNonce = newBrowserNonce();
    const returnPath = window.location.pathname;
    const purposes: Purpose[] = (['ads', 'social'] as Purpose[]).filter((x) => p.canConnect[x]);
    const out = await integrationsApi.connect(p.provider, { purposes, browserNonce, returnPath });
    try { sessionStorage.setItem(OAUTH_STORAGE_KEY, JSON.stringify({ browserNonce, returnPath, provider: p.provider })); } catch { /* the callback will say the tab lost it */ }
    window.location.assign(out.authorizeUrl);
  });

  return (
    <article className="mg-card integ-card">
      <div className="mg-card-head">
        <div>
          <div className="ops-row-title">{p.label}</div>
          <div className="ops-row-sub">
            {p.products[purpose].length ? `For: ${p.products[purpose].map((x) => x.replace(/_/g, ' ').toLowerCase()).join(', ')}` : 'Not used for this'}
            {c?.accountName ? ` · ${c.accountName}` : ''}
          </div>
        </div>
        <Pill tone={st.tone}>{st.text}</Pill>
      </div>
      {!p.appConfigured && <p className="ops-callout">{p.message} Until then, imports and posts stay clearly labelled “Simulated”.</p>}
      {p.appConfigured && !live && (
        <p className="ops-muted">Connect with the school&apos;s own {p.label.split(' (')[0]} account. You sign in on {p.label.split(' (')[0]}&apos;s page and approve these permissions: <code className="integ-scopes">{[...new Set((['ads', 'social'] as Purpose[]).filter((x) => p.canConnect[x]).flatMap((x) => p.scopes[x]))].join(' ') || '—'}</code></p>
      )}
      {live && c && (
        <dl className="integ-facts">
          <div><dt>Used for</dt><dd>{c.purposes.join(', ') || '—'}</dd></div>
          <div><dt>Permissions granted</dt><dd className="integ-scopes">{c.scopes.length ? c.scopes.join(', ') : 'as requested'}</dd></div>
          <div><dt>Connected</dt><dd>{c.connectedAt ? `${fmtDateTime(c.connectedAt)}${c.connectedByName ? ` by ${c.connectedByName}` : ''}` : '—'}</dd></div>
          <div><dt>Access renews</dt><dd>{c.accessExpiresAt ? `before ${fmtDateTime(c.accessExpiresAt)}` : 'does not expire'}</dd></div>
          {p.provider === 'X' && c.assets.xUser && <div><dt>Posts as</dt><dd>@{c.assets.xUser.username}</dd></div>}
          {p.provider === 'GOOGLE' && purpose === 'social' && <div><dt>YouTube</dt><dd>YouTube has no API for community posts: posts to YouTube are marked “Not supported”, never faked.</dd></div>}
        </dl>
      )}
      {c?.lastError?.message && <p className="ops-callout is-warn" role="status">Last problem ({fmtDateTime(c.lastError.at)}): {c.lastError.message}</p>}
      {c?.status === 'DISCONNECTED' && c.revokeResult && <p className="ops-muted">Disconnected: {c.revokeResult}</p>}
      {pickers.map((pk) => {
        const opts = c ? pk.options(c) : [];
        return (
          <label key={pk.key} className="integ-pick">
            <span>{pk.label}</span>
            <select className="input" disabled={busy || !canConnect || !opts.length} value={c?.selected?.[pk.key] ?? ''}
              onChange={(e) => void run(async () => { await integrationsApi.selectAssets(p.provider, { [pk.key]: e.target.value || null }); toast('Saved', 'success'); onChanged(); })}>
              <option value="">{opts.length ? 'Choose…' : 'None found for this account'}</option>
              {opts.map((a) => <option key={pk.value(a)} value={pk.value(a)}>{pk.text(a)}</option>)}
            </select>
          </label>
        );
      })}
      {canConnect && p.appConfigured && (
        <div className="news-actions">
          {(!live || c?.status === 'NEEDS_RECONNECT') && <Button small disabled={busy} onClick={connect}>{c?.status === 'NEEDS_RECONNECT' ? 'Reconnect' : 'Connect'}</Button>}
          {live && c?.status === 'CONNECTED' && <Button small variant="ghost" disabled={busy} onClick={() => void run(async () => { await integrationsApi.refreshAssets(p.provider); onChanged(); })}>Refresh list</Button>}
          {live && <Button small variant="ghost" disabled={busy} onClick={() => setConfirmOff(true)}>Disconnect</Button>}
        </div>
      )}
      <ErrorNote error={error} />
      {confirmOff && (
        <Modal title={`Disconnect ${p.label.split(' (')[0]}?`} onClose={() => setConfirmOff(false)} footer={<>
          <Button variant="soft" onClick={() => setConfirmOff(false)}>Cancel</Button>
          <Button disabled={busy} onClick={() => void run(async () => { const r = await integrationsApi.disconnect(p.provider); setConfirmOff(false); toast(r.revokeResult ?? 'Disconnected', 'info'); onChanged(); })}>Disconnect</Button>
        </>}>
          <p>The access is revoked at {p.label.split(' (')[0]} where it allows that, and the stored tokens are deleted. Ad sync and posting for it go back to Simulated. Data already synced stays.</p>
        </Modal>
      )}
    </article>
  );
}

export function IntegrationsPanel({ purpose }: { purpose: Purpose }) {
  const state = useLoad(() => integrationsApi.overview(), []);
  return (
    <SectionCard title={purpose === 'ads' ? 'Live connections (official APIs)' : 'Connected accounts (official APIs)'}
      sub={purpose === 'ads' ? 'Connect an ad account to sync daily spend, clicks and leads automatically. Without a connection, import the CSV export below.' : 'Connect the school\'s pages so posts go out for real. Without a connection every send is recorded as “Simulated — not posted”.'}>
      <Loadable state={state}>{(o) => (
        <div className="mg-cards">
          {SHOWN[purpose].map((k) => o.providers.find((p) => p.provider === k)).filter((p): p is ProviderDto => Boolean(p))
            .map((p) => <ProviderCard key={p.provider} p={p} purpose={purpose} onChanged={() => void state.reload()} />)}
        </div>
      )}</Loadable>
    </SectionCard>
  );
}
