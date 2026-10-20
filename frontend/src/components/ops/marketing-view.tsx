'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Button, EmptyState, Field, Modal, useToast } from '@/components/ui';
import { api, fileHref } from '@/lib/api';
import { opsApi } from '@/lib/ops-api';
import { usePermissions } from '@/lib/permissions';
import { usePortalHref } from '@/lib/school-path';
import type { CreativeAssetDto } from '@/lib/ops-types';
import { AttachUpload } from './attach';
import { DataNote, ErrorNote, Loadable, PromptModal, SectionCard, StatusPill, Tabs, Tile, fmtDate, fmtDateTime, humanize, money, rupeesToPaise, useAction, useLoad, useQueryParam } from './kit';

/**
 * Marketing & Admissions: enquiry funnel and response time, campaigns with
 * spend and cost per enquiry/enrolment (last-touch attribution, stated),
 * creative assets with verified claims and an independent reviewer, intake
 * capacity and seat offers, and counselling appointments. Enquiries
 * themselves live in the Admission CRM. Marketing never sees student
 * performance, health or welfare data.
 */
type Tab = 'funnel' | 'campaigns' | 'assets' | 'seats' | 'appointments';
const TABS: Tab[] = ['funnel', 'campaigns', 'assets', 'seats', 'appointments'];
/** Older links and the insights KPI say "offers" for the seats tab. */
const TAB_ALIASES: Record<string, Tab> = { offers: 'seats', waitlist: 'seats', counselling: 'appointments' };

/** Enquiry sources and channels as people write them, not as stored. */
const LABELS: Record<string, string> = {
  WALK_IN: 'Walk-in', WHATSAPP: 'WhatsApp', WEB: 'Website', WEBSITE: 'Website', REFERRAL: 'Referral',
  SOCIAL: 'Social media', EMAIL: 'Email', UNKNOWN: 'Not recorded', RTE: 'RTE', EWS: 'EWS', SC: 'SC', ST: 'ST', OBC: 'OBC',
};
const label = (s: string | null | undefined) => (s ? LABELS[s.toUpperCase()] ?? humanize(s) : '—');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "6 h" up to two days, then "4 days". */
const responseTime = (h: number) => (h > 48 ? `${Math.round(h / 24)} days` : `${h} h`);

type LeadOption = { id: string; childName: string; guardianName: string; phone: string | null; stage: string };

/**
 * Picks an enquiry by child, guardian or phone, instead of asking for its
 * database id (which counsellors never see). Lost and enrolled enquiries are
 * left out unless `includeClosed`.
 */
function LeadPicker({ value, onChange, includeClosed = false }: { value: string; onChange: (id: string) => void; includeClosed?: boolean }) {
  const state = useLoad(() => api.pipeline(), []);
  const [q, setQ] = useState('');
  const leads = useMemo<LeadOption[]>(() => {
    const p = state.data;
    if (!p) return [];
    return p.stages
      .filter((st) => includeClosed || (st !== 'LOST' && st !== 'ENROLLED'))
      .flatMap((st) => (p.byStage[st] ?? []).map((l) => ({ id: String(l.id), childName: l.childName, guardianName: l.guardianName, phone: (l as typeof l & { phone?: string | null }).phone ?? null, stage: st })));
  }, [state.data, includeClosed]);
  const needle = q.trim().toLowerCase();
  const needleDigits = needle.replace(/[^0-9]/g, '');
  const shown = needle
    ? leads.filter((l) => `${l.childName} ${l.guardianName} ${l.phone ?? ''}`.toLowerCase().includes(needle)
      || (needleDigits.length >= 3 && (l.phone ?? '').replace(/[^0-9]/g, '').includes(needleDigits)))
    : leads;
  return (
    <span className="ops-inline" style={{ gap: 6 }}>
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search child, parent or phone" aria-label="Search enquiries" style={{ width: 190 }} />
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Enquiry" style={{ maxWidth: 260 }} disabled={state.loading && !state.data}>
        <option value="">{state.loading && !state.data ? 'Loading enquiries…' : `Choose an enquiry (${shown.length})`}</option>
        {shown.slice(0, 200).map((l) => <option key={l.id} value={l.id}>{l.childName} — {l.guardianName}{l.phone ? ` · ${l.phone}` : ''} · {humanize(l.stage)}</option>)}
      </select>
    </span>
  );
}

const CHANNELS = ['SOCIAL', 'SEARCH', 'PRINT', 'OUTDOOR', 'RADIO', 'EVENT', 'REFERRAL', 'WHATSAPP', 'EMAIL', 'WEBSITE', 'OTHER'];

function Funnel({ canReadLeads }: { canReadLeads: boolean }) {
  const state = useLoad(() => opsApi.marketingAnalytics(), []);
  // Enquiry details need admissions.read; without it only the aggregate figures load.
  const dups = useLoad(() => (canReadLeads ? opsApi.duplicateLeads() : Promise.resolve([])), [canReadLeads]);
  const link = usePortalHref();
  return (
    <Loadable state={state}>{(a) => (
      <div className="ops-stack">
        <div className="kpi-grid">
          <Tile label="Enquiries" value={a.enquiries} />
          <Tile label="Enquiry → enrolment" value={a.conversionPct === null ? 'No data' : `${a.conversionPct}%`} />
          <Tile label="Median first response" value={a.response.medianHours === null ? 'No data' : responseTime(a.response.medianHours)} />
          <Tile label="Without a response" value={a.response.unresponded} tone={a.response.unresponded ? 'warn' : 'good'} />
          <Tile label="Lost" value={a.lost} />
        </div>
        <div className="ops-grid-2">
          <SectionCard title="Funnel" sub="Enquiries that reached each stage (lost enquiries excluded).">
            {a.funnel.map((f) => { const max = Math.max(1, ...a.funnel.map((x) => x.count)); return <div key={f.stage} className="ops-inline" style={{ marginBottom: 8 }}><span style={{ width: 130 }}>{humanize(f.stage)}</span><div className="ops-bar" style={{ flex: 1 }}><span style={{ width: `${(f.count / max) * 100}%` }} /></div><b style={{ width: 40, textAlign: 'right' }}>{f.count}</b></div>; })}
          </SectionCard>
          <SectionCard title="By source">
            {!a.bySource.length ? <p className="ops-muted">No enquiries.</p> : <table className="ops-table"><thead><tr><th>Source</th><th className="num">Enquiries</th><th className="num">Enrolled</th></tr></thead><tbody>{a.bySource.map((s) => <tr key={s.source}><td>{label(s.source)}</td><td className="num">{s.enquiries}</td><td className="num">{s.enrolled}</td></tr>)}</tbody></table>}
          </SectionCard>
        </div>
        <DataNote>{a.response.definition}{a.dataNotes.length ? ` ${a.dataNotes.join(' ')}` : ''}</DataNote>
        <Loadable state={dups}>{(groups) => groups.length ? (
          <SectionCard title={`${plural(groups.length, 'possible duplicate enquiry', 'possible duplicate enquiries')}`} sub="Same phone number. Review and merge by hand in the Admission CRM.">
            <ul className="ops-list">{groups.map((g, i) => <li key={i} className="ops-row"><div className="ops-row-main">{g.map((l) => `${l.childName} (${l.guardianName}, ${humanize(l.stage)})`).join(' · ')}</div></li>)}</ul>
            <Link className="btn btn-soft btn-sm" href={link('/admin/admissions')}>Open Admission CRM</Link>
          </SectionCard>
        ) : null}</Loadable>
      </div>
    )}</Loadable>
  );
}

function Campaigns({ canManage }: { canManage: boolean }) {
  const state = useLoad(() => opsApi.campaigns(), []);
  const [creating, setCreating] = useState(false);
  const [spend, setSpend] = useState<string | null>(null);
  const [f, setF] = useState({ name: '', code: '', objective: 'ENQUIRIES', channels: ['SOCIAL'] as string[], audience: '', startsOn: '', endsOn: '', budget: '' });
  const { run, busy, error } = useAction();
  return (
    <Loadable state={state}>{(rows) => (
      <SectionCard title="Campaigns" sub="Cost per enquiry and per enrolment use the campaign recorded on each enquiry (last touch)." actions={canManage ? <Button small onClick={() => setCreating(true)}>+ Campaign</Button> : undefined}>
        {!rows.length ? <EmptyState title="No campaigns" sub="Plan an admissions campaign with its budget and channels." /> : (
          <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Campaign</th><th>Dates</th><th className="num">Budget</th><th className="num">Spent</th><th className="num">Enquiries</th><th className="num">Enrolled</th><th className="num">Per enquiry</th><th className="num">Per enrolment</th><th /></tr></thead><tbody>
            {rows.map((c) => <tr key={c.id}><td><b>{c.name}</b><div className="ops-muted">{c.code} · {c.channels.map(label).join(', ')}</div></td><td>{fmtDate(c.startsOn)} – {fmtDate(c.endsOn)}</td><td className="num">{money(c.budgetPaise)}</td><td className="num">{money(c.spentPaise)}</td><td className="num">{c.enquiries}</td><td className="num">{c.enrolments}</td><td className="num">{c.costPerEnquiryPaise === null ? '—' : money(c.costPerEnquiryPaise)}</td><td className="num">{c.costPerEnrolmentPaise === null ? '—' : money(c.costPerEnrolmentPaise)}</td><td><StatusPill status={c.status} />{canManage && <Button small variant="ghost" onClick={() => setSpend(c.id)}>Spend</Button>}</td></tr>)}
          </tbody></table></div>
        )}
        {creating && (
          <Modal title="New campaign" onClose={() => setCreating(false)} wide footer={<><Button variant="soft" onClick={() => setCreating(false)}>Cancel</Button><Button disabled={busy || !f.name || !f.code || !f.startsOn || !f.endsOn} onClick={() => void run(async () => { await opsApi.createCampaign({ ...f, budgetPaise: f.budget ? rupeesToPaise(f.budget) : 0 }); setCreating(false); await state.reload(); })}>Create</Button></>}>
            <div className="ops-form-grid">
              <Field label="Name" required><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              <Field label="Code (utm_campaign)" required><input className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
              <Field label="Objective"><select className="input" value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })}>{['ENQUIRIES', 'EVENT_FOOTFALL', 'OPEN_HOUSE', 'BRAND', 'RE_ENGAGEMENT', 'OTHER'].map((o) => <option key={o} value={o}>{humanize(o)}</option>)}</select></Field>
              <Field label="Starts" required><input type="date" className="input" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} /></Field>
              <Field label="Ends" required><input type="date" className="input" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} /></Field>
              <Field label="Budget (₹)"><input className="input" inputMode="decimal" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} /></Field>
            </div>
            <fieldset style={{ border: 'none' }}><legend className="field-label">Channels</legend><div className="ops-inline">{CHANNELS.map((c) => <label key={c} className="ops-chip"><input type="checkbox" checked={f.channels.includes(c)} onChange={(e) => setF({ ...f, channels: e.target.checked ? [...f.channels, c] : f.channels.filter((x) => x !== c) })} />{label(c)}</label>)}</div></fieldset>
            <Field label="Audience (description)" hint="Describe who it is for. Do not target children or use sensitive personal data."><input className="input" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })} style={{ width: '100%' }} /></Field>
            <ErrorNote error={error} />
          </Modal>
        )}
        {spend && <PromptModal title="Record spend to date" label="Total spent so far (₹)" multiline={false} onClose={() => setSpend(null)} onSubmit={(v) => opsApi.updateCampaign(spend, { spentPaise: rupeesToPaise(v), note: 'Updated from marketing workspace' }).then(() => state.reload())} />}
      </SectionCard>
    )}</Loadable>
  );
}

function AssetCard({ a, canManage, canReview, onChanged }: { a: CreativeAssetDto; canManage: boolean; canReview: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [claims, setClaims] = useState(a.claims.map((c) => ({ ...c, evidence: c.evidence ?? '' })));
  const [altText, setAltText] = useState(a.altText ?? '');
  const { run, busy, error } = useAction();
  const toast = useToast();
  const latest = a.versions.at(-1);
  const update = (body: unknown, msg: string) => run(async () => { await opsApi.updateCreative(a.id, body); toast(msg, 'success'); onChanged(); });
  return (
    <div className="news-post">
      {latest && /\.(png|jpe?g|webp|gif)$/i.test(latest.url) && <div className="news-media">
        {/* eslint-disable-next-line @next/next/no-img-element -- uploaded artwork on the API origin */}
        <img src={fileHref(latest.url)} alt={a.altText ?? ''} />
      </div>}
      <div className="news-post-body">
        <div className="news-post-head"><span>{humanize(a.kind)} · {humanize(a.size)}{a.dimensions.w ? ` (${a.dimensions.w}×${a.dimensions.h} ${a.dimensions.unit})` : ''}</span><StatusPill status={a.status} /></div>
        <div className="news-post-title">{a.title}</div>
        {a.headline && <div className="news-post-text"><b>{a.headline}</b></div>}
        {a.copy && <div className="news-post-text">{a.copy}</div>}
        {a.claims.length > 0 && <ul className="ops-muted">{a.claims.map((c, i) => <li key={i}>{c.verified ? '✓' : '⚠'} {c.text}{c.evidence ? ` — ${c.evidence}` : ' (unverified)'}</li>)}</ul>}
        {a.aiAssisted && <p className="ops-muted">AI-assisted draft — check every statement.</p>}
        {editing && (
          <div className="ops-stack" style={{ marginTop: 8 }}>
            {claims.map((c, i) => <div key={i} className="ops-inline"><span style={{ flex: 1 }}>{c.text}</span><input className="input" value={c.evidence} onChange={(e) => setClaims(claims.map((y, j) => (j === i ? { ...y, evidence: e.target.value } : y)))} placeholder="Evidence (result sheet, certificate…)" aria-label={`Evidence for ${c.text}`} /><label className="ops-chip"><input type="checkbox" checked={c.verified} onChange={(e) => setClaims(claims.map((y, j) => (j === i ? { ...y, verified: e.target.checked } : y)))} />verified</label></div>)}
            <Field label="Alt text"><input className="input" value={altText} onChange={(e) => setAltText(e.target.value)} style={{ width: '100%' }} /></Field>
            <AttachUpload label="Upload a new version" accept=".png,.jpg,.jpeg,.webp,.pdf" onUploaded={(u) => void update({ url: u.url }, 'New version uploaded')} />
            <Button small disabled={busy} onClick={() => void update({ claims, altText }, 'Saved').then(() => setEditing(false))}>Save</Button>
          </div>
        )}
        <ErrorNote error={error} />
      </div>
      <div className="news-actions">
        {canManage && a.status !== 'PUBLISHED' && <Button small variant="soft" onClick={() => setEditing((v) => !v)}>{editing ? 'Close' : 'Edit'}</Button>}
        {canManage && a.status === 'DRAFT' && <Button small variant="soft" onClick={() => void update({ status: 'IN_REVIEW' }, 'Sent for review')}>Send for review</Button>}
        {canReview && a.status === 'IN_REVIEW' && <Button small onClick={() => void update({ status: 'APPROVED' }, 'Approved')}>Approve</Button>}
        {canManage && a.status === 'APPROVED' && <Button small onClick={() => { const ch = window.prompt('Published on which channel? (e.g. Instagram, print, website)'); if (ch) void update({ status: 'PUBLISHED', channel: ch }, 'Marked published'); }}>Mark published</Button>}
        {latest && <a className="btn btn-ghost btn-sm" href={fileHref(latest.url)} target="_blank" rel="noreferrer">Open file</a>}
      </div>
    </div>
  );
}

function Assets({ canManage, canReview }: { canManage: boolean; canReview: boolean }) {
  const state = useLoad(() => Promise.all([opsApi.creativeAssets(), opsApi.assetSizes(), opsApi.campaigns()]), []);
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ kind: 'POSTER', title: '', size: 'A3_POSTER', campaignId: '', headline: '', copy: '', callToAction: '', altText: '', claims: '', url: '' });
  const { run, busy, error } = useAction();
  return (
    <Loadable state={state}>{([assets, sizes, campaigns]) => (
      <SectionCard title="Posters, banners & social posts" sub="Every factual claim (results, rankings, affiliations, testimonials) needs evidence before approval, and someone other than the last editor approves." actions={canManage ? <Button small onClick={() => setCreating(true)}>+ Asset</Button> : undefined}>
        {!assets.length ? <EmptyState title="No creative assets" sub="Add a poster, banner or social post." /> : <div className="news-feed" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))' }}>{assets.map((a) => <AssetCard key={a.id} a={a} canManage={canManage} canReview={canReview} onChanged={() => void state.reload()} />)}</div>}
        {creating && (
          <Modal title="New creative asset" onClose={() => setCreating(false)} wide footer={<><Button variant="soft" onClick={() => setCreating(false)}>Cancel</Button><Button disabled={busy || !f.title} onClick={() => void run(async () => { await opsApi.createCreative({ ...f, campaignId: f.campaignId || undefined, url: f.url || undefined, claims: f.claims.split('\n').map((c) => c.trim()).filter(Boolean).map((text) => ({ text })) }); setCreating(false); await state.reload(); })}>Create</Button></>}>
            <div className="ops-form-grid">
              <Field label="Kind"><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{['POSTER', 'BANNER', 'SOCIAL_POST', 'BROCHURE', 'VIDEO', 'LANDING_PAGE', 'OTHER'].map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select></Field>
              <Field label="Size"><select className="input" value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })}>{Object.entries(sizes).map(([k, v]) => <option key={k} value={k}>{humanize(k)}{v.w ? ` — ${v.w}×${v.h} ${v.unit}` : ''}</option>)}</select></Field>
              <Field label="Title" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
              <Field label="Campaign"><select className="input" value={f.campaignId} onChange={(e) => setF({ ...f, campaignId: e.target.value })}><option value="">—</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
              <Field label="Headline"><input className="input" value={f.headline} onChange={(e) => setF({ ...f, headline: e.target.value })} /></Field>
              <Field label="Call to action"><input className="input" value={f.callToAction} onChange={(e) => setF({ ...f, callToAction: e.target.value })} placeholder="Book a campus tour" /></Field>
            </div>
            <Field label="Copy"><textarea className="input" rows={3} value={f.copy} onChange={(e) => setF({ ...f, copy: e.target.value })} style={{ width: '100%' }} /></Field>
            <Field label="Factual claims (one per line)" hint="Each must be verified with evidence before approval."><textarea className="input" rows={3} value={f.claims} onChange={(e) => setF({ ...f, claims: e.target.value })} style={{ width: '100%' }} /></Field>
            <Field label="Alt text"><input className="input" value={f.altText} onChange={(e) => setF({ ...f, altText: e.target.value })} style={{ width: '100%' }} /></Field>
            <AttachUpload label="Artwork" accept=".png,.jpg,.jpeg,.webp,.pdf" onUploaded={(a) => setF((x) => ({ ...x, url: a.url }))} />
            <ErrorNote error={error} />
          </Modal>
        )}
      </SectionCard>
    )}</Loadable>
  );
}

function Seats({ canManage, canReadLeads }: { canManage: boolean; canReadLeads: boolean }) {
  const state = useLoad(() => Promise.all([opsApi.capacity(), canReadLeads ? opsApi.offers() : Promise.resolve([])]), [canReadLeads]);
  const [cap, setCap] = useState({ academicYear: '2027-28', gradeOrProgramme: '', capacity: '' });
  const [offer, setOffer] = useState({ leadId: '', academicYear: '2027-28', gradeOrProgramme: '', category: '' });
  const [feeFor, setFeeFor] = useState<string | null>(null);
  const [enrolFor, setEnrolFor] = useState<string | null>(null);
  const { run, busy, error } = useAction();
  const toast = useToast();
  const move = (id: string, to: string, extra: Record<string, unknown> = {}) => run(async () => { await opsApi.moveOffer(id, { to, ...extra }); toast(humanize(to), 'success'); await state.reload(); });
  return (
    <Loadable state={state}>{([caps, offers]) => (
      <div className="ops-stack">
        <SectionCard title="Intake capacity" sub="Seats per class / programme. Offers are allocated in a transaction, so the last seat cannot be given twice; beyond capacity applicants are waitlisted.">
          {caps.length > 0 && <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Year</th><th>Class / programme</th><th className="num">Capacity</th><th className="num">Offered</th><th className="num">Accepted</th><th className="num">Available</th><th>Use</th></tr></thead><tbody>{caps.map((c) => <tr key={c.id}><td>{c.academicYear}</td><td>{c.gradeOrProgramme}</td><td className="num">{c.capacity}</td><td className="num">{c.offered}</td><td className="num">{c.accepted}</td><td className="num">{c.available}</td><td style={{ minWidth: 100 }}><div className="ops-bar"><span style={{ width: `${c.utilisationPct ?? 0}%` }} /></div></td></tr>)}</tbody></table></div>}
          {canManage && <div className="ops-inline"><input className="input" value={cap.academicYear} onChange={(e) => setCap({ ...cap, academicYear: e.target.value })} aria-label="Academic year" style={{ width: 100 }} /><input className="input" value={cap.gradeOrProgramme} onChange={(e) => setCap({ ...cap, gradeOrProgramme: e.target.value })} placeholder="Class 1 / B.Com" aria-label="Class or programme" /><input className="input" inputMode="numeric" value={cap.capacity} onChange={(e) => setCap({ ...cap, capacity: e.target.value })} placeholder="Seats" style={{ width: 90 }} aria-label="Seats" /><Button small disabled={busy || !cap.gradeOrProgramme || !cap.capacity} onClick={() => void run(async () => { await opsApi.setCapacity({ ...cap, capacity: Number(cap.capacity) }); await state.reload(); })}>Save capacity</Button></div>}
        </SectionCard>
        {canReadLeads && (
        <SectionCard title="Offers & waitlist" sub="Application, offer, accepted, fee paid (checked against the fees module) and enrolled are separate steps.">
          {canManage && <div className="ops-inline"><LeadPicker value={offer.leadId} onChange={(leadId) => setOffer({ ...offer, leadId })} /><select className="input" value={offer.category} onChange={(e) => setOffer({ ...offer, category: e.target.value })} aria-label="Category" style={{ width: 130 }}><option value="">General</option>{[...new Set(caps.flatMap((c) => (c.reserved ?? []).map((r) => r.category)))].map((cat) => <option key={cat} value={cat}>{label(cat)}</option>)}</select><input className="input" value={offer.gradeOrProgramme} onChange={(e) => setOffer({ ...offer, gradeOrProgramme: e.target.value })} placeholder="Class / programme" aria-label="Class or programme" /><input className="input" value={offer.academicYear} onChange={(e) => setOffer({ ...offer, academicYear: e.target.value })} aria-label="Academic year" style={{ width: 100 }} /><Button small disabled={busy || !offer.leadId || !offer.gradeOrProgramme} onClick={() => void run(async () => { const o = await opsApi.offerSeat({ ...offer, category: offer.category || undefined }); toast(o.status === 'OFFERED' ? 'Seat offered' : `No seat free — waitlisted #${o.waitlistPosition}`, 'info'); await state.reload(); })}>Offer a seat</Button></div>}
          {!offers.length ? <p className="ops-muted">No offers yet.</p> : <ul className="ops-list">{offers.map((o) => (
            <li key={o.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{o.childName}</div><div className="ops-row-sub">{o.guardianName} · {o.gradeOrProgramme} · {o.academicYear}{o.waitlistPosition ? ` · waitlist #${o.waitlistPosition}` : ''}{o.offerExpiresOn ? ` · offer valid till ${fmtDate(o.offerExpiresOn)}` : ''}</div></div><StatusPill status={o.status} />
              {canManage && o.status === 'WAITLISTED' && <Button small variant="soft" onClick={() => void move(o.id, 'OFFERED')}>Offer</Button>}
              {canManage && o.status === 'OFFERED' && <><Button small variant="soft" onClick={() => void move(o.id, 'ACCEPTED')}>Accepted</Button><Button small variant="ghost" onClick={() => void move(o.id, 'DECLINED', { note: 'Declined by family' })}>Declined</Button></>}
              {canManage && o.status === 'ACCEPTED' && <Button small variant="soft" onClick={() => setFeeFor(o.id)}>Fee paid</Button>}
              {canManage && o.status === 'FEE_PAID' && <Button small onClick={() => setEnrolFor(o.id)}>Enrolled</Button>}
            </li>
          ))}</ul>}
        </SectionCard>
        )}
        {feeFor && <PromptModal title="Admission fee paid" label="Invoice number" hint="As printed on the fee receipt, e.g. INV-1042. It must be paid in the Fees module." multiline={false} onClose={() => setFeeFor(null)} onSubmit={async (v) => { await opsApi.moveOffer(feeFor, { to: 'FEE_PAID', invoiceNo: v }); toast('Fee paid', 'success'); await state.reload(); }} />}
        {enrolFor && <PromptModal title="Mark enrolled" label="Admission number" required={false} hint="Leave blank to use the student record created when this enquiry was enrolled in the Admission CRM." multiline={false} onClose={() => setEnrolFor(null)} onSubmit={async (v) => { await opsApi.moveOffer(enrolFor, { to: 'ENROLLED', ...(v ? { admissionNo: v } : {}) }); toast('Enrolled', 'success'); await state.reload(); }} />}
        <DataNote>Reservation categories (e.g. RTE 12(1)(c) where it applies to your school, or management quota) are configured by the school after checking they apply; EduOS does not assume any.</DataNote>
        <ErrorNote error={error} />
      </div>
    )}</Loadable>
  );
}

function Appointments({ canManage }: { canManage: boolean }) {
  const state = useLoad(() => opsApi.appointments({ upcoming: 'true' }), []);
  const [f, setF] = useState({ leadId: '', kind: 'CAMPUS_TOUR', at: '', durationMinutes: '45' });
  const { run, busy, error } = useAction();
  return (
    <Loadable state={state}>{(rows) => (
      <SectionCard title="Counselling, tours & interviews" sub="Admissions counsellors (not wellbeing counsellors). Booking a tour moves the enquiry to Tour scheduled and records the first response.">
        {canManage && <div className="ops-inline"><LeadPicker value={f.leadId} onChange={(leadId) => setF({ ...f, leadId })} /><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="Kind">{['CALL', 'CAMPUS_TOUR', 'COUNSELLING', 'INTERVIEW', 'ENTRANCE_TEST', 'DOCUMENT_CHECK'].map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select><input type="datetime-local" className="input" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} aria-label="When" /><Button small disabled={busy || !f.leadId || !f.at} onClick={() => void run(async () => { await opsApi.bookAppointment({ ...f, at: new Date(f.at).toISOString(), durationMinutes: Number(f.durationMinutes) }); await state.reload(); })}>Book</Button></div>}
        {!rows.length ? <p className="ops-muted">Nothing upcoming.</p> : <ul className="ops-list">{rows.map((a) => <li key={a.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{humanize(a.kind)} · {a.childName}</div><div className="ops-row-sub">{fmtDateTime(a.at)} · {a.guardianName}</div></div><StatusPill status={a.status} />{canManage && a.status === 'SCHEDULED' && <><Button small variant="soft" onClick={() => void run(async () => { await opsApi.updateAppointment(a.id, { status: 'DONE' }); await state.reload(); })}>Done</Button><Button small variant="ghost" onClick={() => void run(async () => { await opsApi.updateAppointment(a.id, { status: 'NO_SHOW' }); await state.reload(); })}>No show</Button></>}</li>)}</ul>}
        <ErrorNote error={error} />
      </SectionCard>
    )}</Loadable>
  );
}

export function MarketingView() {
  const { permissions } = usePermissions();
  const canManage = Boolean(permissions['marketing.manage']);
  const canAdmit = Boolean(permissions['admissions.manage']);
  const canReadLeads = Boolean(permissions['admissions.read']);
  const canReview = Boolean(permissions['marketing.manage'] || permissions['community.moderate']);
  const link = usePortalHref();
  const queryTab = useQueryParam('tab');
  const fromQuery = queryTab ? (TAB_ALIASES[queryTab] ?? (TABS.includes(queryTab as Tab) ? (queryTab as Tab) : null)) : null;
  const [tab, setTab] = useState<Tab>(fromQuery && (fromQuery !== 'appointments' || canReadLeads) ? fromQuery : 'funnel');
  return (
    <div className="ops-stack">
      <div className="ops-inline"><Tabs tabs={[{ key: 'funnel', label: 'Enrolment funnel' }, { key: 'campaigns', label: 'Campaigns' }, { key: 'assets', label: 'Creative' }, { key: 'seats', label: canReadLeads ? 'Seats & offers' : 'Seats' }, ...(canReadLeads ? [{ key: 'appointments' as const, label: 'Counselling' }] : [])]} value={tab} onChange={setTab} />{canReadLeads && <Link className="btn btn-soft btn-sm" href={link('/admin/admissions')}>Admission CRM</Link>}</div>
      {tab === 'funnel' && <Funnel canReadLeads={canReadLeads} />}
      {tab === 'campaigns' && <Campaigns canManage={canManage} />}
      {tab === 'assets' && <Assets canManage={canManage} canReview={canReview} />}
      {tab === 'seats' && <Seats canManage={canAdmit} canReadLeads={canReadLeads} />}
      {tab === 'appointments' && canReadLeads && <Appointments canManage={canAdmit} />}
    </div>
  );
}
