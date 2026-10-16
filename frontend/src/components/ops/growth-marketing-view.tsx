'use client';
import { useMemo, useState } from 'react';
import { Button, EmptyState, Field, Modal, Pill, useToast } from '@/components/ui';
import { opsApi, downloadCsv } from '@/lib/ops-api';
import { fileHref } from '@/lib/api';
import { billsApi } from '@/lib/bills-api';
import { useSchoolSegment } from '@/lib/school-path';
import { usePermissions } from '@/lib/permissions';
import { useAuth } from '@/lib/auth';
import { encodeQr, toSvgPath } from '@/lib/qr';
import {
  growthApi, shortLink, formLink, OFFLINE_CHANNELS, HEARD_FROM_CHANNELS,
  type OfflineCampaignDto, type ConnectorDto, type ImportResult, type ReportRow, type WebhookSecretDto,
} from '@/lib/growth-api';
import { AttachUpload } from './attach';
import { IntegrationsPanel } from './integrations-panel';
import { DataNote, ErrorNote, KeyValues, Loadable, PromptModal, SectionCard, StatusPill, Tabs, Timeline, fmtDate, fmtDateTime, money, rupeesToPaise, useAction, useLoad } from './kit';

/**
 * Marketing and admissions: campaigns (offline and online), ad-platform
 * connectors, and the attribution report.
 *
 * Offline campaigns — banners, pamphlets, posters, newspaper and radio, open
 * houses, society activations — carry a tracking code that is their short
 * link, QR code and utm_campaign, plus optional promo code and tracking phone
 * number. Results come from the CRM, never typed in. Connectors without
 * credentials work through the platform's CSV export; a "simulated sample"
 * is always labelled and never counted as spend.
 */

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`);

// ── shared bits ────────────────────────────────────────────────────────

function ResultsLine({ r }: { r: { enquiries: number; visits: number; applications: number; admissions: number } }) {
  return <span className="mg-results">{r.enquiries} enquiries · {r.visits} visits · {r.applications} applications · {r.admissions} admissions</span>;
}

/** A horizontal bar chart with its numbers written out (readable without the bars). */
export function BarList({ title, rows }: { title: string; rows: Array<{ label: string; value: number | null; text: string }> }) {
  const max = Math.max(1, ...rows.map((r) => r.value ?? 0));
  return (
    <figure className="mg-bars">
      <figcaption className="mg-bars-title">{title}</figcaption>
      {!rows.length ? <p className="ops-muted">No data yet.</p> : (
        <ul className="mg-bars-list">
          {rows.map((r) => (
            <li key={r.label} className="mg-bar-row">
              <span className="mg-bar-label">{r.label}</span>
              <span className="mg-bar-track" aria-hidden="true"><span className="mg-bar-fill" style={{ width: `${r.value === null ? 0 : Math.max(2, (r.value / max) * 100)}%` }} /></span>
              <span className="mg-bar-value">{r.text}</span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

function QrBlock({ text, label }: { text: string; label: string }) {
  const qr = useMemo(() => { try { return encodeQr(text); } catch { return null; } }, [text]);
  if (!qr) return <p className="ops-muted">The link is too long for a QR code.</p>;
  const n = qr.size + 8;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${toSvgPath(qr)}" fill="#000"/></svg>`;
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    a.download = `${label}-qr.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <div className="mg-qr">
      <svg viewBox={`0 0 ${n} ${n}`} role="img" aria-label={`QR code for ${text}`} shapeRendering="crispEdges" className="mg-qr-svg">
        <rect width={n} height={n} fill="#fff" />
        <path d={toSvgPath(qr)} fill="#000" />
      </svg>
      <Button small variant="soft" onClick={download}>Download QR (SVG)</Button>
    </div>
  );
}

function Copy({ value, label }: { value: string; label: string }) {
  const toast = useToast();
  return (
    <div className="mg-copy">
      <input className="input" readOnly value={value} aria-label={label} onFocus={(e) => e.target.select()} />
      <Button small variant="ghost" onClick={() => { void navigator.clipboard?.writeText(value).then(() => toast('Copied', 'success')).catch(() => undefined); }}>Copy</Button>
    </div>
  );
}

// ── Campaigns ──────────────────────────────────────────────────────────

function TrackingModal({ c, onClose }: { c: OfflineCampaignDto; onClose: () => void }) {
  const school = useSchoolSegment() ?? '';
  const sl = shortLink(school, c.code);
  const fl = typeof window !== 'undefined' ? formLink(window.location.origin, school, c.code, c.channelType) : '';
  const live = ['APPROVED', 'LIVE', 'COMPLETED'].includes(c.status);
  return (
    <Modal title={`Tracking for ${c.name}`} onClose={onClose} wide footer={<Button onClick={onClose}>Done</Button>}>
      {!live && <p className="ops-callout is-warn">The short link and QR count opens only once the campaign is approved. Before that they open the form without the campaign.</p>}
      <div className="mg-track">
        <div>
          <Field label="Short link (print this, or use the QR)"><Copy value={sl} label="Short link" /></Field>
          <Field label="Online form link with UTM (for WhatsApp, e-mail, websites)"><Copy value={fl} label="Form link" /></Field>
          <KeyValues rows={[
            ['Tracking code (utm_campaign)', c.code],
            ['Promo code families quote', c.promoCode ?? '—'],
            ['Tracking phone number', c.trackingPhone ?? '—'],
            ['Opens of the link / QR', String(c.scans)],
          ]} />
          <DataNote>Opens are counted, not people. An enquiry is credited when it arrives through the link, quotes the promo code or the tracking number, or names this campaign under “How did you hear about us?”.</DataNote>
        </div>
        <QrBlock text={sl} label={c.code} />
      </div>
    </Modal>
  );
}

type PlacementDraft = { location: string; detail: string; quantity: string };

function OfflineForm({ onClose, onDone, campaigns }: { onClose: () => void; onDone: () => void; campaigns: Array<{ id: string; name: string; code: string }> }) {
  const [f, setF] = useState({ name: '', code: '', channelType: 'POSTER', campaignId: '', startsOn: today(), endsOn: plusDays(30), quantity: '', vendorName: '', cost: '', promoCode: '', trackingPhone: '', billId: '' });
  const [placements, setPlacements] = useState<PlacementDraft[]>([{ location: '', detail: '', quantity: '' }]);
  const [assets, setAssets] = useState<Array<{ name: string; url: string }>>([]);
  const bills = useLoad(() => billsApi.bills({ pageSize: 100 }).then((r) => r.items).catch(() => []), []);
  const { run, busy, error } = useAction();
  const toast = useToast();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = () => void run(async () => {
    await growthApi.createOffline({
      ...f, campaignId: f.campaignId || undefined, billId: f.billId || undefined, quantity: f.quantity || undefined,
      costPaise: f.cost ? rupeesToPaise(f.cost) : 0, cost: undefined, assets,
      placements: placements.filter((p) => p.location.trim()).map((p) => ({ location: p.location, detail: p.detail || undefined, quantity: p.quantity || undefined })),
    });
    toast('Campaign saved as a draft', 'success'); onDone(); onClose();
  });
  return (
    <Modal title="New offline campaign" wide onClose={onClose} footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.name.trim() || !f.startsOn || !f.endsOn} onClick={save}>Save draft</Button></>}>
      <div className="ops-form-grid">
        <Field label="Name" required><input className="input" value={f.name} onChange={set('name')} placeholder="Sector 21 market posters" /></Field>
        <Field label="Channel" required><select className="input" value={f.channelType} onChange={set('channelType')}>{OFFLINE_CHANNELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Tracking code" hint="Letters, numbers and dashes. Becomes the short link, QR and utm_campaign. Leave empty to use the name."><input className="input" value={f.code} onChange={set('code')} placeholder="POSTER-S21" /></Field>
        <Field label="Part of campaign"><select className="input" value={f.campaignId} onChange={set('campaignId')}><option value="">None</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}</select></Field>
        <Field label="Starts" required><input className="input" type="date" value={f.startsOn} onChange={set('startsOn')} /></Field>
        <Field label="Ends" required><input className="input" type="date" value={f.endsOn} onChange={set('endsOn')} /></Field>
        <Field label="Quantity" hint="Printed, put up, aired…"><input className="input" inputMode="numeric" value={f.quantity} onChange={set('quantity')} /></Field>
        <Field label="Vendor"><input className="input" value={f.vendorName} onChange={set('vendorName')} /></Field>
        <Field label="Cost (₹)"><input className="input" inputMode="decimal" value={f.cost} onChange={set('cost')} /></Field>
        <Field label="Bill (from Bills & Services)"><select className="input" value={f.billId} onChange={set('billId')}><option value="">Not linked</option>{(bills.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.refNo} · {b.accountName ?? b.vendorName ?? b.category} · {money(b.amountPaise)}</option>)}</select></Field>
        <Field label="Promo code" hint="A code families quote at enquiry, e.g. S21"><input className="input" value={f.promoCode} onChange={set('promoCode')} /></Field>
        <Field label="Tracking phone number" hint="A number printed only on this campaign"><input className="input" inputMode="tel" value={f.trackingPhone} onChange={set('trackingPhone')} /></Field>
      </div>
      <fieldset className="mg-placements"><legend className="field-label">Placements (where it appears)</legend>
        {placements.map((p, i) => (
          <div key={i} className="mg-placement">
            <input className="input" aria-label={`Placement ${i + 1} location`} placeholder="Location" value={p.location} onChange={(e) => setPlacements(placements.map((x, j) => (j === i ? { ...x, location: e.target.value } : x)))} />
            <input className="input" aria-label={`Placement ${i + 1} detail`} placeholder="Size / slot / page" value={p.detail} onChange={(e) => setPlacements(placements.map((x, j) => (j === i ? { ...x, detail: e.target.value } : x)))} />
            <input className="input" aria-label={`Placement ${i + 1} quantity`} placeholder="Qty" inputMode="numeric" value={p.quantity} onChange={(e) => setPlacements(placements.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
            {placements.length > 1 && <Button small variant="ghost" onClick={() => setPlacements(placements.filter((_, j) => j !== i))} aria-label={`Remove placement ${i + 1}`}>✕</Button>}
          </div>
        ))}
        <Button small variant="soft" onClick={() => setPlacements([...placements, { location: '', detail: '', quantity: '' }])}>+ Placement</Button>
      </fieldset>
      <AttachUpload label="Add creative (artwork, script, proof)" accept=".jpg,.jpeg,.png,.pdf,.mp3,.mp4" onUploaded={(a) => setAssets((x) => [...x, { name: a.name, url: a.url }])} />
      {assets.length > 0 && <ul className="ops-list">{assets.map((a, i) => <li key={a.url} className="ops-row"><div className="ops-row-main">{a.name}</div><Button small variant="ghost" onClick={() => setAssets(assets.filter((_, j) => j !== i))}>Remove</Button></li>)}</ul>}
      <ErrorNote error={error} />
    </Modal>
  );
}

const MOVE_LABEL: Record<string, string> = { SUBMIT: 'Send for approval', APPROVE: 'Approve', REJECT: 'Send back', GO_LIVE: 'Mark live', COMPLETE: 'Complete', CANCEL: 'Cancel' };
const MOVES_FROM: Record<string, string[]> = { DRAFT: ['SUBMIT', 'CANCEL'], REJECTED: ['SUBMIT', 'CANCEL'], PENDING_APPROVAL: ['APPROVE', 'REJECT', 'CANCEL'], APPROVED: ['GO_LIVE', 'COMPLETE', 'CANCEL'], LIVE: ['COMPLETE', 'CANCEL'] };

function OfflineCard({ c, onChanged }: { c: OfflineCampaignDto; onChanged: () => void }) {
  const { permissions } = usePermissions();
  const canManage = Boolean(permissions['marketing.manage']);
  const { me } = useAuth();
  // Approval is by a second person: the creator is not offered Approve or Send back.
  const mine = Boolean(me?.profile?.id) && c.createdByProfileId === me?.profile?.id;
  const [tracking, setTracking] = useState(false);
  const [prompt, setPrompt] = useState<null | 'REJECT' | 'CANCEL' | 'COST'>(null);
  const [open, setOpen] = useState(false);
  const { run, busy, error } = useAction();
  const toast = useToast();
  const r = c.results;
  return (
    <article className="mg-card">
      <div className="mg-card-head">
        <div>
          <div className="ops-row-title">{c.name}</div>
          <div className="ops-row-sub">{c.channelLabel} · {fmtDate(c.startsOn)} – {fmtDate(c.endsOn)}{c.vendorName ? ` · ${c.vendorName}` : ''}{c.quantity ? ` · qty ${c.quantity}` : ''}</div>
        </div>
        <StatusPill status={c.status} />
      </div>
      <div className="mg-card-stats">
        <span><b>{money(c.costPaise)}</b> cost</span>
        <span><b>{r.enquiries}</b> enquiries</span>
        <span><b>{r.admissions}</b> admissions</span>
        <span><b>{r.enquiries ? money(Math.round(c.costPaise / r.enquiries)) : '—'}</b> per enquiry</span>
        <span><b>{c.scans}</b> link/QR opens</span>
      </div>
      {c.placements.length > 0 && <div className="ops-row-sub">📍 {c.placements.map((p) => `${p.location}${p.detail ? ` (${p.detail})` : ''}${p.quantity ? ` ×${p.quantity}` : ''}`).join(' · ')}</div>}
      {c.decision?.note && <p className="ops-callout">{c.status === 'REJECTED' ? 'Sent back' : 'Decision'} by {c.decision.byName ?? 'a reviewer'}: {c.decision.note}</p>}
      <div className="news-actions">
        <Button small variant="soft" onClick={() => setTracking(true)}>Tracking & QR</Button>
        {(MOVES_FROM[c.status] ?? []).filter((m) => (m === 'APPROVE' || m === 'REJECT' ? !mine && (canManage || me?.profile?.role === 'PRINCIPAL') : canManage)).map((m) => (
          <Button key={m} small variant={m === 'APPROVE' || m === 'SUBMIT' || m === 'GO_LIVE' ? undefined : 'ghost'} disabled={busy}
            onClick={() => (m === 'REJECT' || m === 'CANCEL' ? setPrompt(m) : void run(async () => { await growthApi.moveOffline(c.id, m); toast(MOVE_LABEL[m], 'success'); onChanged(); }))}>
            {MOVE_LABEL[m]}
          </Button>
        ))}
        {canManage && !['CANCELLED'].includes(c.status) && <Button small variant="ghost" onClick={() => setPrompt('COST')}>Update cost</Button>}
        <Button small variant="ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? 'Hide details' : 'Details'}</Button>
      </div>
      {open && (
        <div className="mg-details">
          <ResultsLine r={r} />
          {c.assets.length > 0 && <p>Creative: {c.assets.map((a) => a.name).join(', ')}</p>}
          <Timeline items={c.history} />
        </div>
      )}
      <ErrorNote error={error} />
      {tracking && <TrackingModal c={c} onClose={() => setTracking(false)} />}
      {prompt === 'REJECT' && <PromptModal title="Send back for changes" label="What needs to change" onClose={() => setPrompt(null)} onSubmit={(v) => growthApi.moveOffline(c.id, 'REJECT', v).then(onChanged)} />}
      {prompt === 'CANCEL' && <PromptModal title="Cancel this campaign" label="Reason" danger onClose={() => setPrompt(null)} onSubmit={(v) => growthApi.moveOffline(c.id, 'CANCEL', v).then(onChanged)} />}
      {prompt === 'COST' && <PromptModal title="Update the actual cost" label="New cost in ₹, then a space and the reason (e.g. 4500 vendor's final invoice)" multiline={false} onClose={() => setPrompt(null)}
        onSubmit={async (v) => { const [amt, ...rest] = v.split(' '); await growthApi.updateOffline(c.id, { costPaise: rupeesToPaise(amt), note: rest.join(' ') || undefined }); onChanged(); }} />}
    </article>
  );
}

function HeardFromPanel() {
  const state = useLoad(() => Promise.all([growthApi.heardFrom(), growthApi.offline()]), []);
  const { permissions } = usePermissions();
  const [f, setF] = useState({ label: '', channel: 'WORD_OF_MOUTH', offlineCampaignId: '' });
  const { run, busy, error } = useAction();
  return (
    <Loadable state={state}>{([rows, camps]) => (
      <SectionCard title="“How did you hear about us?”" sub="The answers offered on the online admission form and to counsellors. Each maps to a channel, and can name one campaign.">
        {!rows.length ? <EmptyState title="No answers yet" sub="Add the answers families choose from." /> : (
          <ul className="ops-list">{rows.map((o) => <li key={o.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{o.label}</div><div className="ops-row-sub">{o.channelLabel}{o.offlineCampaignId ? ` · ${camps.find((c) => c.id === o.offlineCampaignId)?.name ?? 'campaign'}` : ''}</div></div>{!o.active && <Pill tone="gray">Hidden</Pill>}{permissions['marketing.manage'] && <Button small variant="ghost" disabled={busy} onClick={() => void run(async () => { await growthApi.saveHeardFrom({ ...o, active: !o.active }); await state.reload(); })}>{o.active ? 'Hide' : 'Show'}</Button>}</li>)}</ul>
        )}
        {permissions['marketing.manage'] && (
          <div className="ops-form-grid">
            <Field label="Answer"><input className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Poster near my home" /></Field>
            <Field label="Channel"><select className="input" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>{HEARD_FROM_CHANNELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Campaign (optional)"><select className="input" value={f.offlineCampaignId} onChange={(e) => setF({ ...f, offlineCampaignId: e.target.value })}><option value="">None</option>{camps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <div className="mg-end"><Button disabled={busy || !f.label.trim()} onClick={() => void run(async () => { await growthApi.saveHeardFrom({ ...f, offlineCampaignId: f.offlineCampaignId || undefined }); setF({ ...f, label: '' }); await state.reload(); })}>Add answer</Button></div>
          </div>
        )}
        <ErrorNote error={error} />
      </SectionCard>
    )}</Loadable>
  );
}

function OnlinePanel() {
  const state = useLoad(() => Promise.all([opsApi.campaigns(), growthApi.metrics()]), []);
  return (
    <Loadable state={state}>{([camps, metrics]) => (
      <div className="ops-stack">
        <SectionCard title="Online campaigns" sub="Campaigns created on the Marketing & Admissions page. Spend comes from imported ad-platform rows that name the campaign's code; otherwise the spend recorded on the campaign.">
          {!camps.length ? <EmptyState title="No online campaigns" sub="Create one on the Marketing & Admissions page; its code is the utm_campaign of your ads." /> : (
            <div className="mg-table-wrap"><table className="mg-table"><thead><tr><th>Campaign</th><th>Code</th><th>Status</th><th>Imported spend</th><th>Enquiries</th><th>Enrolled</th></tr></thead><tbody>
              {camps.map((c) => {
                const rows = metrics.filter((m) => m.campaignId === c.id && !m.simulated);
                const spend = rows.reduce((n, m) => n + m.spendPaise, 0);
                return <tr key={c.id}><td>{c.name}</td><td><code>{c.code}</code></td><td><StatusPill status={c.status} /></td><td>{rows.length ? money(spend) : `${money(c.spentPaise)} (recorded)`}</td><td>{c.enquiries}</td><td>{c.enrolments}</td></tr>;
              })}
            </tbody></table></div>
          )}
        </SectionCard>
      </div>
    )}</Loadable>
  );
}

export function CampaignsHubView() {
  const [tab, setTab] = useState<'offline' | 'online' | 'heard'>('offline');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const { permissions } = usePermissions();
  const state = useLoad(() => (tab === 'offline' ? Promise.all([growthApi.offline(status ? { status } : {}), opsApi.campaigns().catch(() => [])]) : Promise.resolve(null)), [tab, status]);
  return (
    <div className="ops-stack">
      <div className="ops-inline">
        <Tabs tabs={[{ key: 'offline', label: 'Offline' }, { key: 'online', label: 'Online' }, { key: 'heard', label: 'How did you hear' }]} value={tab} onChange={setTab} />
        {tab === 'offline' && permissions['marketing.manage'] && <Button onClick={() => setCreating(true)}>+ Offline campaign</Button>}
      </div>
      {tab === 'offline' && (
        <>
          <div className="ops-inline">
            <label className="field-label" htmlFor="mg-status">Status</label>
            <select id="mg-status" className="input mg-narrow" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>{['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'LIVE', 'COMPLETED', 'REJECTED', 'CANCELLED'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ').toLowerCase()}</option>)}
            </select>
          </div>
          <Loadable state={state}>{(d) => d && (!d[0].length
            ? <EmptyState title="No offline campaigns yet" sub="Add a banner, pamphlet, poster, newspaper or radio spot, open house or society stall. Each gets a short link, QR code and promo code to trace enquiries." />
            : <div className="mg-cards">{d[0].map((c) => <OfflineCard key={c.id} c={c} onChanged={() => void state.reload()} />)}</div>)}</Loadable>
          {creating && <OfflineForm campaigns={(state.data?.[1] ?? []).map((c) => ({ id: c.id, name: c.name, code: c.code }))} onClose={() => setCreating(false)} onDone={() => void state.reload()} />}
        </>
      )}
      {tab === 'online' && <OnlinePanel />}
      {tab === 'heard' && <HeardFromPanel />}
      <DataNote>Results are counted from the admissions CRM: each enquiry is credited once, to the earliest way it was traced (link or QR, UTM, promo code, tracking number, or “how did you hear”).</DataNote>
    </div>
  );
}

// ── Connectors ─────────────────────────────────────────────────────────

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > 2 * 1024 * 1024) { reject(new Error('The file is larger than 2 MB. Export a shorter date range.')); return; }
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsText(file);
  });
}

function ImportSummary({ r }: { r: ImportResult }) {
  return (
    <div className="ops-callout" role="status">
      {r.created !== undefined ? <>Leads: <b>{r.created}</b> new enquiries, <b>{r.duplicates}</b> matched an existing enquiry (no duplicate created), <b>{r.rejected}</b> skipped.</>
        : <>Rows: <b>{r.accepted}</b> imported{r.matchedToCampaigns !== undefined ? ` (${r.matchedToCampaigns} matched to a campaign by its code)` : ''}, <b>{r.rejected}</b> skipped.</>}
      {r.problems.length > 0 && <ul className="mg-problems">{r.problems.slice(0, 10).map((p) => <li key={`${p.row}-${p.problem}`}>Line {p.row}: {p.problem}</li>)}</ul>}
    </div>
  );
}

function ConnectorCard({ c, onChanged }: { c: ConnectorDto; onChanged: () => void }) {
  const { permissions } = usePermissions();
  const manage = Boolean(permissions['marketing.manage']);
  const manageAll = permissions['marketing.manage'] === 'ALL';
  const [result, setResult] = useState<ImportResult | null>(null);
  const [cred, setCred] = useState(false);
  const [secret, setSecret] = useState<WebhookSecretDto | null>(null);
  const [token, setToken] = useState('');
  const [account, setAccount] = useState(c.accountLabel ?? '');
  const { run, busy, error } = useAction();
  const toast = useToast();
  const upload = (kind: 'metrics' | 'leads') => async (file: File | undefined) => {
    if (!file) return;
    await run(async () => {
      const text = await readFile(file);
      setResult(kind === 'metrics' ? await growthApi.importMetrics(c.platform, text, file.name) : await growthApi.importLeads(c.platform, text, file.name));
      onChanged();
    });
  };
  const example = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([c.csv.example], { type: 'text/csv' }));
    a.download = `${c.platform.toLowerCase()}-example.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <article className="mg-card">
      <div className="mg-card-head">
        <div><div className="ops-row-title">{c.label}</div><div className="ops-row-sub">{c.statusLabel}{c.accountLabel ? ` · ${c.accountLabel}` : ''}{c.credentialHint ? ` · key ${c.credentialHint}` : ''}</div></div>
        <Pill tone={c.status === 'CREDENTIALS_SAVED' ? 'blue' : 'gray'}>{c.status === 'CREDENTIALS_SAVED' ? 'Credentials saved' : 'Not connected'}</Pill>
      </div>
      <p className="ops-muted">{c.csv.how}</p>
      <p className="ops-muted">Columns: {c.csv.columns.join(', ')}</p>
      {c.live && c.live.mode !== 'CSV_ONLY' && (
        <p className={c.live.lastSync && c.live.lastSync.ok === false ? 'ops-callout is-warn' : 'ops-muted'} role="status">
          {c.live.connected ? 'Live sync connected' : c.live.appConfigured ? 'Live sync: not connected' : 'Live sync: app not configured (Simulated)'}
          {c.live.lastSync ? ` · last synced ${fmtDateTime(c.live.lastSync.at)}${c.live.lastSync.from ? ` (${c.live.lastSync.from} to ${c.live.lastSync.to})` : ''}: ${c.live.lastSync.message ?? ''}` : c.live.connected ? ' · not synced yet' : ''}
          {c.live.lastError && !c.live.lastSync ? ` · ${c.live.lastError}` : ''}
        </p>
      )}
      {c.live?.lastSync?.problems?.length ? <ul className="mg-problems">{c.live.lastSync.problems.slice(0, 5).map((pr) => <li key={`${pr.scope}-${pr.problem}`}>{pr.scope}: {pr.problem}</li>)}</ul> : null}
      {c.lastImport && <p className="ops-muted">Last import {fmtDateTime(c.lastImport.at)}: {c.lastImport.accepted} rows{c.lastImport.rejected ? `, ${c.lastImport.rejected} skipped` : ''}.</p>}
      {c.simulatedRows > 0 && <p className="ops-callout is-warn">Simulated sample loaded ({c.simulatedRows} rows). Fictional figures, labelled “simulated” everywhere and never counted as spend.</p>}
      {manage && (
        <div className="mg-uploads">
          <label className="btn btn-soft btn-sm mg-file">Import performance CSV<input type="file" accept=".csv,text/csv" onChange={(e) => { void upload('metrics')(e.target.files?.[0]); e.target.value = ''; }} disabled={busy} /></label>
          {c.leadWebhook && permissions['admissions.manage'] && <label className="btn btn-soft btn-sm mg-file">Import leads CSV<input type="file" accept=".csv,text/csv" onChange={(e) => { void upload('leads')(e.target.files?.[0]); e.target.value = ''; }} disabled={busy} /></label>}
          <Button small variant="ghost" onClick={example}>Example file</Button>
          <label className="ops-inline mg-sample"><input type="checkbox" checked={c.simulatedRows > 0} disabled={busy} onChange={(e) => void run(async () => { await growthApi.sample(c.platform, e.target.checked); onChanged(); })} /> Simulated sample</label>
        </div>
      )}
      {result && <ImportSummary r={result} />}
      {manage && c.platform !== 'CSV' && (
        <div className="news-actions">
          {manageAll && <Button small variant="ghost" onClick={() => setCred(true)}>{c.status === 'CREDENTIALS_SAVED' ? 'Replace credentials' : 'Add credentials'}</Button>}
          <Button small variant="ghost" disabled={busy} onClick={() => void run(async () => { const r = await growthApi.sync(c.platform); toast(r.message, r.ok === false ? 'error' : 'info'); onChanged(); })}>Sync now</Button>
          {c.leadWebhook && manageAll && <Button small variant="ghost" disabled={busy} onClick={() => void run(async () => { setSecret(await growthApi.rotateWebhook(c.platform)); onChanged(); })}>{c.webhookConfigured ? 'New webhook secret' : 'Set up lead webhook'}</Button>}
        </div>
      )}
      <ErrorNote error={error} />
      {cred && (
        <Modal title={`Credentials for ${c.label}`} onClose={() => setCred(false)} footer={<>
          <Button variant="soft" onClick={() => setCred(false)}>Cancel</Button>
          {c.status === 'CREDENTIALS_SAVED' && <Button variant="ghost" disabled={busy} onClick={() => void run(async () => { await growthApi.saveCredentials(c.platform, { clear: true }); setCred(false); onChanged(); })}>Remove</Button>}
          <Button disabled={busy || token.trim().length < 8} onClick={() => void run(async () => { await growthApi.saveCredentials(c.platform, { token, accountLabel: account }); setToken(''); setCred(false); toast('Saved, encrypted', 'success'); onChanged(); })}>Save</Button>
        </>}>
          <p className="ops-callout">The key is stored encrypted and never shown again. Live sync uses the connection above (sign in with the platform), not a pasted key; without it, imports come from the CSV export.</p>
          <Field label="Account (name or id)"><input className="input" value={account} onChange={(e) => setAccount(e.target.value)} /></Field>
          <Field label="Access token or API key" required><input className="input" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} /></Field>
          <ErrorNote error={error} />
        </Modal>
      )}
      {secret && (
        <Modal title="Lead webhook" onClose={() => setSecret(null)} footer={<Button onClick={() => setSecret(null)}>I have copied it</Button>}>
          <p className="ops-callout is-warn">{secret.note}</p>
          <Field label="Webhook URL"><Copy value={fileHref(secret.path)} label="Webhook URL" /></Field>
          <Field label="Secret (HMAC key)"><Copy value={secret.secret} label="Secret" /></Field>
          <Field label="Verify token (subscription handshake)"><Copy value={secret.verifyToken} label="Verify token" /></Field>
          <p className="ops-muted">{secret.signature} Leads are matched to existing enquiries by phone and e-mail; a lead sent twice is recognised by its id.</p>
        </Modal>
      )}
    </article>
  );
}

export function ConnectorsView() {
  const state = useLoad(() => Promise.all([growthApi.connectors(), growthApi.imports(), growthApi.metrics()]), []);
  return (
    <Loadable state={state}>{([conns, imports, metrics]) => (
      <div className="ops-stack">
        <DataNote>Not connected is normal: export the report from the ad platform and import it here. Rows for the same campaign and day replace the earlier import, so importing twice never doubles the spend.</DataNote>
        <IntegrationsPanel purpose="ads" />
        <div className="mg-cards">{conns.map((c) => <ConnectorCard key={c.platform} c={c} onChanged={() => void state.reload()} />)}</div>
        <SectionCard title="Imported spend by platform campaign" sub="A platform campaign is matched to a school campaign when its name contains the campaign's code.">
          {!metrics.length ? <EmptyState title="Nothing imported yet" sub="Import a performance CSV above." /> : (
            <div className="mg-table-wrap"><table className="mg-table"><thead><tr><th>Platform</th><th>Platform campaign</th><th>Spend</th><th>Impr.</th><th>Clicks</th><th>Leads</th><th>Cost / lead</th><th>CTR</th></tr></thead><tbody>
              {metrics.map((m) => <tr key={`${m.platform}-${m.campaignName}-${m.simulated}`}><td>{m.platformLabel}</td><td>{m.campaignName}{m.simulated && <> <Pill tone="amber">Simulated</Pill></>}{!m.campaignId && <> <Pill tone="gray">No school campaign</Pill></>}</td><td>{money(m.spendPaise)}</td><td>{m.impressions.toLocaleString('en-IN')}</td><td>{m.clicks.toLocaleString('en-IN')}</td><td>{m.leads}</td><td>{money(m.costPerLeadPaise)}</td><td>{pct(m.ctrPct)}</td></tr>)}
            </tbody></table></div>
          )}
        </SectionCard>
        <SectionCard title="Import history">
          {!imports.length ? <p className="ops-muted">No imports yet.</p> : (
            <ul className="ops-list">{imports.map((i) => <li key={i.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{i.platform.replace(/_/g, ' ')} · {i.kind === 'LEADS' ? 'leads' : 'performance'}{i.simulated ? ' · simulated sample' : ''}</div><div className="ops-row-sub">{fmtDateTime(i.at)}{i.fileName ? ` · ${i.fileName}` : ''} · {i.kind === 'LEADS' ? `${i.created} new, ${i.duplicates} matched` : `${i.accepted} rows`}{i.rejected ? `, ${i.rejected} skipped` : ''}</div></div></li>)}</ul>
          )}
        </SectionCard>
      </div>
    )}</Loadable>
  );
}

// ── Attribution ────────────────────────────────────────────────────────

function ReportTable({ rows, kind }: { rows: ReportRow[]; kind: 'offline' | 'online' | 'channel' }) {
  if (!rows.length) return <p className="ops-muted">Nothing in this period.</p>;
  return (
    <div className="mg-table-wrap"><table className="mg-table"><thead><tr>
      <th>{kind === 'channel' ? 'Channel' : 'Campaign'}</th>{kind !== 'channel' && <th>Channel</th>}<th>Cost</th><th>Enquiries</th><th>Visits</th><th>Applications</th><th>Admissions</th><th>Per enquiry</th><th>Per admission</th><th>Conversion</th><th>ROI</th>
    </tr></thead><tbody>
      {rows.map((r) => (
        <tr key={`${r.id ?? r.channel}`}>
          <td>{kind === 'channel' ? r.channelLabel : <>{r.name}{r.code && <> <code>{r.code}</code></>}</>}</td>
          {kind !== 'channel' && <td>{r.channelLabel}{r.platforms?.length ? ` (${r.platforms.join(', ').replace(/_/g, ' ').toLowerCase()})` : ''}</td>}
          <td>{money(r.costPaise)}{r.simulatedCostPaise ? <> <Pill tone="amber">+{money(r.simulatedCostPaise)} simulated</Pill></> : null}</td>
          <td>{r.enquiries}</td><td>{r.visits}</td><td>{r.applications}</td><td>{r.admissions}</td>
          <td>{money(r.costPerEnquiryPaise)}</td><td>{money(r.costPerAdmissionPaise)}</td><td>{pct(r.conversionPct)}</td><td>{pct(r.roiPct)}</td>
        </tr>
      ))}
    </tbody></table></div>
  );
}

export function AttributionView() {
  const [from, setFrom] = useState(plusDays(-90));
  const [to, setTo] = useState(plusDays(1));
  const params = { from: from || undefined, to: to || undefined };
  const state = useLoad(() => growthApi.attribution(params), [from, to]);
  const { permissions } = usePermissions();
  const [valuePrompt, setValuePrompt] = useState(false);
  const { run, busy, error } = useAction();
  return (
    <div className="ops-stack">
      <div className="ops-inline mg-filters">
        <Field label="Enquiries from"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="to (not including)"><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Button variant="soft" disabled={busy} onClick={() => void run(() => downloadCsv(growthApi.attributionCsvPath(params), 'attribution.csv'))}>Download CSV</Button>
        {permissions['marketing.manage'] && <Button variant="ghost" onClick={() => setValuePrompt(true)}>Value of one admission</Button>}
      </div>
      <ErrorNote error={error} />
      <Loadable state={state}>{(r) => (
        <>
          <div className="mg-kpis">
            <div className="mg-kpi"><span>Spend</span><b>{money(r.totals.costPaise)}</b></div>
            <div className="mg-kpi"><span>Enquiries</span><b>{r.totals.enquiries}</b></div>
            <div className="mg-kpi"><span>Visits</span><b>{r.totals.visits}</b></div>
            <div className="mg-kpi"><span>Applications</span><b>{r.totals.applications}</b></div>
            <div className="mg-kpi"><span>Admissions</span><b>{r.totals.admissions}</b></div>
            <div className="mg-kpi"><span>Cost per enquiry</span><b>{money(r.totals.costPerEnquiryPaise)}</b></div>
            <div className="mg-kpi"><span>Cost per admission</span><b>{money(r.totals.costPerAdmissionPaise)}</b></div>
            <div className="mg-kpi"><span>ROI</span><b>{r.admissionValuePaise === null ? 'Set value' : pct(r.totals.roiPct)}</b></div>
          </div>
          {r.simulatedSpendPaise > 0 && <p className="ops-callout is-warn">Simulated sample spend of {money(r.simulatedSpendPaise)} is shown apart and not counted.</p>}
          <div className="ops-grid-2">
            <SectionCard title="Enquiries by channel"><BarList title="Enquiries credited to each channel" rows={r.channels.map((c) => ({ label: c.channelLabel, value: c.enquiries, text: String(c.enquiries) }))} /></SectionCard>
            <SectionCard title="Cost per admission by channel"><BarList title="Cost per admission (channels with admissions)" rows={r.channels.filter((c) => c.costPerAdmissionPaise !== null).map((c) => ({ label: c.channelLabel, value: c.costPerAdmissionPaise, text: money(c.costPerAdmissionPaise) }))} /></SectionCard>
          </div>
          <SectionCard title="By channel"><ReportTable rows={r.channels} kind="channel" /></SectionCard>
          <SectionCard title="Offline campaigns"><ReportTable rows={r.offline} kind="offline" /></SectionCard>
          <SectionCard title="Online campaigns"><ReportTable rows={r.online} kind="online" /></SectionCard>
          <SectionCard title="How these are counted"><KeyValues rows={Object.entries(r.definitions).map(([k, v]) => [k.charAt(0).toUpperCase() + k.slice(1), v])} /></SectionCard>
          {valuePrompt && <PromptModal title="Value of one admission" label="Amount in ₹ (e.g. first-year fees) used for ROI" hint={r.admissionValuePaise ? `Now ${money(r.admissionValuePaise)}` : 'Not set yet'} multiline={false} onClose={() => setValuePrompt(false)} onSubmit={async (v) => { await growthApi.saveSettings({ admissionValuePaise: rupeesToPaise(v) }); await state.reload(); }} />}
        </>
      )}</Loadable>
    </div>
  );
}

// ── Source of one enquiry (in the admissions CRM drawer) ───────────────

/**
 * Where an enquiry came from: the credited channel, every recorded touch, and
 * a form for the counsellor to record a promo code, tracking phone number,
 * tracking code or "how did you hear" answer the family gave.
 */
export function LeadSourceSection({ leadId, canManage }: { leadId: string; canManage: boolean }) {
  const state = useLoad(() => Promise.all([growthApi.leadAttribution(leadId), growthApi.heardFrom().catch(() => [])]), [leadId]);
  const [f, setF] = useState({ heardFromId: '', promoCode: '', trackingPhone: '', code: '' });
  const { run, busy, error } = useAction();
  const toast = useToast();
  const any = Object.values(f).some((v) => v.trim());
  return (
    <div className="drawer-section">
      <div className="drawer-section-title">Source</div>
      <Loadable state={state}>{([att, options]) => (
        <>
          <p className="ops-muted">{att.credited ? <>Credited to <b>{att.credited.channelLabel}</b> ({att.credited.via.replace(/_/g, ' ').toLowerCase()}).</> : 'No source recorded yet.'}</p>
          {att.touches.length > 1 && <ul className="mg-problems">{att.touches.map((t) => <li key={t.id}>{t.channelLabel}{t.detail ? ` — ${t.detail}` : ''} · {fmtDate(t.at)}</li>)}</ul>}
          {canManage && (
            <div className="ops-form-grid">
              {options.length > 0 && <Field label="How did they hear about us?"><select className="input" value={f.heardFromId} onChange={(e) => setF({ ...f, heardFromId: e.target.value })}><option value="">—</option>{options.filter((o) => o.active).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></Field>}
              <Field label="Promo code they quoted"><input className="input" value={f.promoCode} onChange={(e) => setF({ ...f, promoCode: e.target.value })} /></Field>
              <Field label="Number they called"><input className="input" inputMode="tel" value={f.trackingPhone} onChange={(e) => setF({ ...f, trackingPhone: e.target.value })} /></Field>
              <div className="mg-end"><Button small disabled={busy || !any} onClick={() => void run(async () => {
                await growthApi.attributeLead(leadId, Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim())));
                setF({ heardFromId: '', promoCode: '', trackingPhone: '', code: '' }); toast('Source recorded', 'success'); await state.reload();
              })}>Record source</Button></div>
            </div>
          )}
          <ErrorNote error={error} />
        </>
      )}</Loadable>
    </div>
  );
}
