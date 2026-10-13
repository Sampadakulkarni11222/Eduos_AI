'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Button, EmptyState, Field, Modal, useToast } from '@/components/ui';
import { opsApi, downloadCsv } from '@/lib/ops-api';
import { usePermissions } from '@/lib/permissions';
import { usePortalHref } from '@/lib/school-path';
import { AccreditationTab } from './accreditation-view';
import type { LicenceDto, NoticeDto, ObligationDto, PolicyDto, ReturnDto, TrainingDto } from '@/lib/ops-types';
import { AttachUpload } from './attach';
import { Drawer } from './drawer';
import {
  Attachments, DataNote, ErrorNote, KeyValues, Loadable, PromptModal, SectionCard, StatusPill, Stepper, Tabs, Tile, Timeline,
  fmtDate, fmtDateTime, humanize, isoDay, money, useAction, useLoad, useQueryParam,
} from './kit';

/**
 * Compliance centre. The system tracks obligations, deadlines and evidence;
 * people decide what applies. Nothing in the catalogue is treated as binding
 * until reviewed, a return is "submitted" only with an acknowledgement, and a
 * licence's status comes from its dates.
 */

type Tab = 'calendar' | 'obligations' | 'returns' | 'licences' | 'policies' | 'trainings' | 'notices' | 'accreditation';

function CalendarTab() {
  const link = usePortalHref();
  const state = useLoad(() => Promise.all([opsApi.complianceOverview(), opsApi.complianceCalendar(120)]), []);
  return (
    <Loadable state={state}>{([o, items]) => (
      <div className="ops-stack">
        <div className="kpi-grid">
          <Tile label="Applicable obligations" value={o.applicableObligations} />
          <Tile label="Obligations to review" value={o.obligationsUnderReview} tone={o.obligationsUnderReview ? 'warn' : 'good'} />
          <Tile label="Returns overdue" value={o.returnsOverdue} tone={o.returnsOverdue ? 'bad' : 'good'} />
          <Tile label="Licences expired" value={o.licencesExpired} tone={o.licencesExpired ? 'bad' : 'good'} />
          <Tile label="Licences expiring" value={o.licencesExpiring} tone={o.licencesExpiring ? 'warn' : 'good'} />
          <Tile label="Notices to review" value={o.noticesToReview} tone={o.noticesToReview ? 'warn' : 'good'} />
        </div>
        {o.trainingCoverage.length > 0 && (
          <SectionCard title="Mandatory training coverage">
            {o.trainingCoverage.map((c) => (
              <div key={c.topic} className="ops-inline" style={{ marginBottom: 8 }}>
                <span style={{ width: 220 }}>{humanize(c.topic)}</span>
                <div className="ops-bar" style={{ flex: 1 }}><span style={{ width: `${c.pct ?? 0}%` }} /></div>
                <b>{c.pct ?? '—'}%</b><span className="ops-muted">{c.covered}/{c.staff} in {c.windowMonths} mo</span>
              </div>
            ))}
          </SectionCard>
        )}
        <SectionCard title="Compliance calendar (next 120 days)" sub="Overdue items first. Renewals appear on the date renewal should start.">
          {!items.length ? <p className="ops-muted">Nothing scheduled.</p> : (
            <ul className="ops-list">{items.map((i) => (
              <li key={`${i.kind}-${i.id}`} className="ops-row">
                <div className="ops-row-main"><Link href={link(i.link)} className="ops-row-title">{i.title}</Link><div className="ops-row-sub">{humanize(i.kind)} · {fmtDate(i.renewBy ?? i.date)}{i.renewBy ? ` (expires ${fmtDate(i.date)})` : ''}</div></div>
                {i.overdue ? <span className="ops-flag-overdue">OVERDUE</span> : <StatusPill status={i.status} />}
              </li>
            ))}</ul>
          )}
        </SectionCard>
      </div>
    )}</Loadable>
  );
}

function ObligationsTab({ canManage }: { canManage: boolean }) {
  const state = useLoad(() => opsApi.obligations(), []);
  const [reviewing, setReviewing] = useState<ObligationDto | null>(null);
  const [decision, setDecision] = useState('APPLICABLE');
  const [nextDue, setNextDue] = useState('');
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <Loadable state={state}>{(rows) => (
      <SectionCard title="Obligations" sub="A starting catalogue drawn from the source register. Each item stays under review until someone records whether it applies here, and why."
        actions={canManage ? <Button small variant="soft" disabled={busy} onClick={() => void run(async () => { const r = await opsApi.seedObligations(); toast(`${r.added} item(s) added for review`, 'info'); await state.reload(); })}>Load catalogue for review</Button> : undefined}>
        {!rows.length ? <EmptyState title="No obligations yet" sub="Load the catalogue, then review each item for your institution." /> : (
          <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Obligation</th><th>Authority</th><th>Frequency</th><th>Next due</th><th>Applies?</th><th>Source</th><th /></tr></thead><tbody>
            {rows.map((o) => (
              <tr key={o.id}>
                <td><b>{o.title}</b><div className="ops-muted">{o.code}{o.dueRule ? ` · ${o.dueRule}` : ''}</div>{o.applicabilityNote && <div className="ops-muted">“{o.applicabilityNote}”</div>}</td>
                <td>{o.authority}</td><td>{humanize(o.frequency)}</td><td>{fmtDate(o.nextDueOn)}</td>
                <td><StatusPill status={o.applicability} /></td><td>{o.sourceRef ?? '—'}</td>
                <td>{canManage && <Button small variant="soft" onClick={() => { setReviewing(o); setDecision(o.applicability === 'UNDER_REVIEW' ? 'APPLICABLE' : o.applicability); setNextDue(o.nextDueOn?.slice(0, 10) ?? ''); }}>Review</Button>}</td>
              </tr>
            ))}
          </tbody></table></div>
        )}
        <DataNote>Source IDs refer to docs/research/regulatory-source-register.md. Several items there are marked unverified and need qualified review before you rely on them.</DataNote>
        {reviewing && (
          <PromptModal title={`Applicability: ${reviewing.title}`} label="Why it does or does not apply to this institution" onClose={() => setReviewing(null)}
            extra={<div className="ops-form-grid">
              <Field label="Decision"><select className="input" value={decision} onChange={(e) => setDecision(e.target.value)}><option value="APPLICABLE">Applies</option><option value="NOT_APPLICABLE">Does not apply</option><option value="UNDER_REVIEW">Still under review</option></select></Field>
              <Field label="Next due"><input type="date" className="input" value={nextDue} onChange={(e) => setNextDue(e.target.value)} /></Field>
            </div>}
            onSubmit={async (note) => { await opsApi.reviewObligation(reviewing.id, { applicability: decision, note, nextDueOn: nextDue || null }); await state.reload(); }} />
        )}
        <ErrorNote error={error} />
      </SectionCard>
    )}</Loadable>
  );
}

const RETURN_STEPS = [{ key: 'DRAFT', label: 'Draft' }, { key: 'IN_REVIEW', label: 'Reviewed' }, { key: 'APPROVED_FOR_SUBMISSION', label: 'Approved' }, { key: 'SUBMITTED', label: 'Submitted' }, { key: 'ACCEPTED', label: 'Accepted' }];

function ReturnDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const state = useLoad(() => Promise.all([opsApi.returnById(id), opsApi.orgStaff().catch(() => [])]), [id]);
  const { run, busy, error } = useAction();
  const toast = useToast();
  const [reviewer, setReviewer] = useState('');
  const [sub, setSub] = useState({ method: 'PORTAL_MANUAL', acknowledgementNo: '', receiptUrl: '' });
  const [prompt, setPrompt] = useState<null | 'return' | 'reject'>(null);
  const reload = async () => { await state.reload(); onChanged(); };
  const r = state.data?.[0];
  const act = (action: string, body: unknown = {}, msg = 'Updated') => run(async () => { await opsApi.returnAction(id, action, body); toast(msg, 'success'); await reload(); });
  return (
    <Drawer title={r?.title ?? 'Return'} sub={r ? `${r.refNo} · ${r.authority} · ${r.period}` : undefined} onClose={onClose}>
      <Loadable state={state}>{([d, staff]) => (
        <>
          <Stepper steps={RETURN_STEPS} current={['REJECTED', 'RESUBMISSION_REQUIRED'].includes(d.status) ? 'SUBMITTED' : d.status} failed={['REJECTED', 'RESUBMISSION_REQUIRED'].includes(d.status)} />
          <div className="ops-inline"><StatusPill status={d.status} />{d.isOverdue && <span className="ops-flag-overdue">OVERDUE</span>}<span className="ops-muted">Due {fmtDate(d.dueOn)} · figures generated {fmtDateTime(d.generatedAt)}</span></div>
          {d.validation.length > 0 && (
            <div className={`ops-callout ${d.errors ? 'is-danger' : 'is-warn'}`}>
              <b>{d.errors} error(s), {d.warnings} warning(s)</b>
              <ul>{d.validation.map((v, i) => <li key={i}>{v.level === 'ERROR' ? '✖' : '⚠'} {v.message}</li>)}</ul>
            </div>
          )}
          <SectionCard title="Figures" sub="Generated from ERP records. Download the CSV to key into, or upload to, the authority's portal." actions={<Button small variant="soft" onClick={() => void downloadCsv(`/compliance/returns/${d.id}/export.csv`, `${d.refNo.replace(/\//g, '-')}.csv`)}>Download CSV</Button>}>
            <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', maxHeight: 280, overflow: 'auto', background: 'var(--hairline)', padding: 10, borderRadius: 8 }}>{JSON.stringify(d.data, null, 2)}</pre>
          </SectionCard>
          {d.status === 'DRAFT' && (
            <SectionCard title="Prepare">
              <div className="ops-inline">
                <Button small variant="soft" disabled={busy} onClick={() => void act('regenerate', {}, 'Figures regenerated')}>Regenerate from records</Button>
                <select className="input" value={reviewer} onChange={(e) => setReviewer(e.target.value)} aria-label="Reviewer"><option value="">Choose reviewer…</option>{staff.map((s) => <option key={s.profileId} value={s.profileId}>{s.name}</option>)}</select>
                <Button small disabled={busy || !reviewer} onClick={() => void act('review', { reviewerProfileId: reviewer, acknowledgeErrors: d.errors > 0 ? window.confirm('This return has validation errors. Send for review anyway?') : undefined }, 'Sent for review')}>Send for review</Button>
              </div>
            </SectionCard>
          )}
          {d.status === 'IN_REVIEW' && (
            <div className="ops-inline">
              <Button small disabled={busy} onClick={() => void act('reviewed', { decision: 'REQUEST_APPROVAL' }, 'Sent to the principal')}>Reviewed — request approval to submit</Button>
              <Button small variant="soft" onClick={() => setPrompt('return')}>Return to preparer</Button>
            </div>
          )}
          {d.status === 'APPROVED_FOR_SUBMISSION' && (
            <SectionCard title="Record the submission" sub="After submitting on the authority's portal (or by email/post), record the acknowledgement. Generating the CSV is not a filing.">
              <div className="ops-form-grid">
                <Field label="Submitted via"><select className="input" value={sub.method} onChange={(e) => setSub({ ...sub, method: e.target.value })}><option value="PORTAL_MANUAL">Official portal (manual)</option><option value="EMAIL">Email</option><option value="POST">Post</option><option value="HAND">By hand</option></select></Field>
                <Field label="Acknowledgement / reference no."><input className="input" value={sub.acknowledgementNo} onChange={(e) => setSub({ ...sub, acknowledgementNo: e.target.value })} /></Field>
              </div>
              <AttachUpload label="Or upload the receipt" onUploaded={(a) => setSub((s) => ({ ...s, receiptUrl: a.url }))} />
              <Button disabled={busy || (!sub.acknowledgementNo && !sub.receiptUrl)} onClick={() => void act('submission', sub, 'Submission recorded')}>Record submission</Button>
            </SectionCard>
          )}
          {d.status === 'SUBMITTED' && (
            <div className="ops-inline">
              <Button small onClick={() => void act('outcome', { outcome: 'ACCEPTED' }, 'Marked accepted')}>Authority accepted</Button>
              <Button small variant="soft" onClick={() => setPrompt('reject')}>Authority rejected</Button>
            </div>
          )}
          {d.status === 'RESUBMISSION_REQUIRED' && <Button small onClick={() => void act('reopen', {}, 'Reopened for correction')}>Reopen for correction</Button>}
          {d.submission?.at && <KeyValues rows={[['Submitted', fmtDateTime(d.submission.at)], ['Via', humanize(d.submission.method)], ['Acknowledgement', d.submission.acknowledgementNo]]} />}
          {d.authorityResponse && <p><b>Authority response:</b> {d.authorityResponse}</p>}
          <ErrorNote error={error} />
          <div><h3 className="ops-section-title">History</h3><Timeline items={d.history} /></div>
        </>
      )}</Loadable>
      {prompt === 'return' && <PromptModal title="Return to preparer" label="What needs fixing" onClose={() => setPrompt(null)} onSubmit={(v) => opsApi.returnAction(id, 'reviewed', { decision: 'RETURN', note: v }).then(reload)} />}
      {prompt === 'reject' && <PromptModal title="Authority rejected the return" label="What the authority said" onClose={() => setPrompt(null)} onSubmit={(v) => opsApi.returnAction(id, 'outcome', { outcome: 'REJECTED', response: v }).then(reload)} />}
    </Drawer>
  );
}

function ReturnsTab({ canManage }: { canManage: boolean }) {
  const openId = useQueryParam('id');
  const state = useLoad(() => opsApi.returns(), []);
  const [selected, setSelected] = useState<string | null>(openId);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ template: 'UDISE_PLUS_PROFILE', period: '', dueOn: '' });
  const { run, busy, error } = useAction();
  return (
    <Loadable state={state}>{(rows) => (
      <SectionCard title="Regulatory returns" sub="Generated from ERP records → reviewed by someone other than the preparer → approved by the principal → submitted on the authority's portal → acknowledgement recorded." actions={canManage ? <Button small onClick={() => setCreating(true)}>+ New return</Button> : undefined}>
        {!rows.length ? <EmptyState title="No returns yet" sub="Create one to generate its figures from your records." /> : (
          <ul className="ops-list">{rows.map((r) => (
            <li key={r.id} className="ops-row">
              <div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => setSelected(r.id)}><div className="ops-row-title">{r.title}</div><div className="ops-row-sub">{r.refNo} · {r.authority} · due {fmtDate(r.dueOn)}{r.errors ? ` · ${r.errors} error(s)` : ''}</div></button></div>
              {r.isOverdue && <span className="ops-flag-overdue">OVERDUE</span>}<StatusPill status={r.status} />
            </li>
          ))}</ul>
        )}
        {creating && (
          <Modal title="New return" onClose={() => setCreating(false)} footer={<><Button variant="soft" onClick={() => setCreating(false)}>Cancel</Button><Button disabled={busy || !form.period} onClick={() => void run(async () => { const r = await opsApi.createReturn({ ...form, dueOn: form.dueOn || undefined }); setCreating(false); await state.reload(); setSelected(r.id); })}>Generate</Button></>}>
            <Field label="Template"><select className="input" value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })}>
              <option value="UDISE_PLUS_PROFILE">UDISE+ school figures</option><option value="AISHE_PROFILE">AISHE institution figures</option>
              <option value="MONTHLY_ATTENDANCE">Monthly attendance return</option><option value="STAFF_STRENGTH">Staff strength statement</option><option value="CUSTOM">Custom (manual figures)</option>
            </select></Field>
            <Field label="Period" hint={form.template === 'MONTHLY_ATTENDANCE' ? 'YYYY-MM, e.g. 2026-09' : 'e.g. 2026-27'} required><input className="input" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} /></Field>
            <Field label="Due on"><input type="date" className="input" value={form.dueOn} onChange={(e) => setForm({ ...form, dueOn: e.target.value })} /></Field>
            <DataNote>No authority portal is integrated. EduOS prepares and checks the figures; a person submits them and records the acknowledgement.</DataNote>
            <ErrorNote error={error} />
          </Modal>
        )}
        {selected && <ReturnDetail id={selected} onClose={() => setSelected(null)} onChanged={() => void state.reload()} />}
      </SectionCard>
    )}</Loadable>
  );
}

const LICENCE_KINDS = ['RECOGNITION', 'AFFILIATION', 'NOC', 'CERTIFICATE', 'REGISTRATION', 'INSURANCE', 'VEHICLE', 'SOFTWARE_SUBSCRIPTION', 'OTHER'];

function LicenceModal({ l, onClose, onSaved }: { l: LicenceDto | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ kind: l?.kind ?? 'CERTIFICATE', title: l?.title ?? '', issuer: l?.issuer ?? '', number: l?.number ?? '', issuedOn: l?.issuedOn?.slice(0, 10) ?? '', expiresOn: l?.expiresOn?.slice(0, 10) ?? '', renewalLeadDays: String(l?.renewalLeadDays ?? 60), renewalCost: l ? String(l.renewalCostPaise / 100) : '', renewalStatus: l?.renewalStatus ?? '', publicDisclosure: l?.publicDisclosure ?? false });
  const [evidence, setEvidence] = useState<Array<{ name: string; url: string }>>([]);
  const { run, busy, error } = useAction();
  return (
    <Modal title={l ? `Update: ${l.title}` : 'Add licence or certificate'} onClose={onClose} wide footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.title} onClick={() => void run(async () => {
      await opsApi.saveLicence({ ...f, issuedOn: f.issuedOn || null, expiresOn: f.expiresOn || null, renewalLeadDays: Number(f.renewalLeadDays), renewalCostPaise: f.renewalCost ? Math.round(Number(f.renewalCost) * 100) : 0, renewalStatus: f.renewalStatus || null, evidence }, l?.id);
      onSaved(); onClose();
    })}>Save</Button></>}>
      <div className="ops-form-grid">
        <Field label="Kind"><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{LICENCE_KINDS.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select></Field>
        <Field label="Title" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Fire safety certificate" /></Field>
        <Field label="Issued by"><input className="input" value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })} /></Field>
        <Field label="Number"><input className="input" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></Field>
        <Field label="Issued on"><input type="date" className="input" value={f.issuedOn} onChange={(e) => setF({ ...f, issuedOn: e.target.value })} /></Field>
        <Field label="Expires on"><input type="date" className="input" value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })} /></Field>
        <Field label="Start renewal days before"><input className="input" inputMode="numeric" value={f.renewalLeadDays} onChange={(e) => setF({ ...f, renewalLeadDays: e.target.value })} /></Field>
        <Field label="Renewal cost (₹)"><input className="input" inputMode="decimal" value={f.renewalCost} onChange={(e) => setF({ ...f, renewalCost: e.target.value })} /></Field>
        <Field label="Renewal status"><select className="input" value={f.renewalStatus} onChange={(e) => setF({ ...f, renewalStatus: e.target.value })}><option value="">—</option><option value="NOT_STARTED">Not started</option><option value="IN_PROGRESS">In progress</option><option value="APPLIED">Applied</option><option value="RENEWED">Renewed</option></select></Field>
      </div>
      <label className="ops-inline"><input type="checkbox" checked={f.publicDisclosure} onChange={(e) => setF({ ...f, publicDisclosure: e.target.checked })} /> Show on the public disclosure page</label>
      <AttachUpload label="Evidence (certificate copy)" onUploaded={(a) => setEvidence((x) => [...x, { name: a.name, url: a.url }])} />
      <ErrorNote error={error} />
    </Modal>
  );
}

function LicencesTab({ canManage }: { canManage: boolean }) {
  const state = useLoad(() => opsApi.licences(), []);
  const [edit, setEdit] = useState<LicenceDto | null | 'new'>(null);
  return (
    <Loadable state={state}>{(rows) => (
      <SectionCard title="Licences, certificates & registrations" sub="Status comes from the expiry date and the renewal lead time. Software subscriptions are tracked separately from regulatory licences." actions={canManage ? <Button small onClick={() => setEdit('new')}>+ Add</Button> : undefined}>
        {!rows.length ? <EmptyState title="Nothing recorded" sub="Add recognition, affiliation, fire, building, water and insurance certificates, vehicle papers and subscriptions." /> : (
          <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Title</th><th>Kind</th><th>Number</th><th>Expires</th><th>Status</th><th>Renewal</th><th>Evidence</th><th /></tr></thead><tbody>
            {rows.map((l) => (
              <tr key={l.id}>
                <td><b>{l.title}</b><div className="ops-muted">{l.issuer}</div></td><td>{humanize(l.kind)}</td><td>{l.number ?? '—'}</td>
                <td>{fmtDate(l.expiresOn)}{l.daysToExpiry !== null && <div className="ops-muted">{l.daysToExpiry < 0 ? `${-l.daysToExpiry} days ago` : `in ${l.daysToExpiry} days`}</div>}</td>
                <td><StatusPill status={l.status} /></td><td>{l.renewalStatus ? humanize(l.renewalStatus) : '—'}{l.renewalCostPaise ? <div className="ops-muted">{money(l.renewalCostPaise)}</div> : null}</td>
                <td><Attachments items={l.evidence} /></td>
                <td>{canManage && <Button small variant="soft" onClick={() => setEdit(l)}>Update</Button>}</td>
              </tr>
            ))}
          </tbody></table></div>
        )}
        {edit && <LicenceModal l={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => void state.reload()} />}
      </SectionCard>
    )}</Loadable>
  );
}

const POLICY_CATEGORIES = ['SAFEGUARDING', 'POSH', 'ANTI_RAGGING', 'ACADEMIC', 'EXAMINATION', 'HR', 'FINANCE', 'IT_DATA', 'TRANSPORT', 'SAFETY', 'ADMISSION', 'CONDUCT', 'OTHER'];
const AUDIENCE = ['TEACHER', 'ADMIN', 'PRINCIPAL', 'FINANCE', 'HR', 'MARKETING', 'COMPLIANCE', 'LIBRARIAN', 'WARDEN', 'PARENT', 'STUDENT'];

function PoliciesTab({ canManage }: { canManage: boolean }) {
  const state = useLoad(() => opsApi.policies(), []);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PolicyDto | null>(null);
  const [f, setF] = useState({ code: '', title: '', category: 'SAFEGUARDING', audienceRoles: ['TEACHER'] as string[], requiresAcknowledgement: true, summary: '', body: '', documentUrl: '' });
  const [text, setText] = useState('');
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <Loadable state={state}>{(rows) => (
      <SectionCard title="Policies" sub="Versioned. A version takes effect when the principal approves it; the previous one is superseded and the audience is asked to acknowledge." actions={canManage ? <Button small onClick={() => setCreating(true)}>+ New policy</Button> : undefined}>
        {!rows.length ? <EmptyState title="No policies yet" sub="Add your child-protection, POSH, IT and other policies." /> : (
          <ul className="ops-list">{rows.map((p) => (
            <li key={p.id} className="ops-row">
              <div className="ops-row-main"><div className="ops-row-title">{p.code} · {p.title}</div><div className="ops-row-sub">{humanize(p.category)} · v{p.currentVersion ?? '—'}{p.nextReviewOn ? ` · review by ${fmtDate(p.nextReviewOn)}` : ''}{p.requiresAcknowledgement && p.audienceSize ? ` · acknowledged ${p.acknowledgements}/${p.audienceSize}` : ''}</div></div>
              {p.reviewOverdue && <span className="ops-flag-overdue">REVIEW OVERDUE</span>}
              {p.pendingVersion && <StatusPill status={p.pendingVersion.status} label={`v${p.pendingVersion.version} ${humanize(p.pendingVersion.status)}`} />}
              {canManage && <Button small variant="soft" onClick={() => { setEditing(p); setText(p.pendingVersion?.body ?? p.current?.body ?? ''); }}>{p.pendingVersion?.status === 'DRAFT' ? 'Edit draft' : 'New version'}</Button>}
            </li>
          ))}</ul>
        )}
        {creating && (
          <Modal title="New policy" onClose={() => setCreating(false)} wide footer={<><Button variant="soft" onClick={() => setCreating(false)}>Cancel</Button><Button disabled={busy || !f.code || !f.title || (!f.body && !f.documentUrl)} onClick={() => void run(async () => { await opsApi.createPolicy(f); setCreating(false); await state.reload(); toast('Draft created — submit it for approval when ready', 'info'); })}>Create draft</Button></>}>
            <div className="ops-form-grid">
              <Field label="Code" required><input className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="CP-01" /></Field>
              <Field label="Title" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
              <Field label="Category"><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{POLICY_CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select></Field>
            </div>
            <fieldset style={{ border: 'none' }}><legend className="field-label">Audience</legend><div className="ops-inline">{AUDIENCE.map((r) => <label key={r} className="ops-chip"><input type="checkbox" checked={f.audienceRoles.includes(r)} onChange={(e) => setF({ ...f, audienceRoles: e.target.checked ? [...f.audienceRoles, r] : f.audienceRoles.filter((x) => x !== r) })} />{humanize(r)}</label>)}</div></fieldset>
            <label className="ops-inline" style={{ margin: '8px 0' }}><input type="checkbox" checked={f.requiresAcknowledgement} onChange={(e) => setF({ ...f, requiresAcknowledgement: e.target.checked })} /> Audience must acknowledge</label>
            <Field label="Summary"><input className="input" value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} style={{ width: '100%' }} /></Field>
            <Field label="Policy text"><textarea className="input" rows={8} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} style={{ width: '100%' }} /></Field>
            <AttachUpload label="Or upload the policy document" accept=".pdf,.doc,.docx" onUploaded={(a) => setF((x) => ({ ...x, documentUrl: a.url }))} />
            <ErrorNote error={error} />
          </Modal>
        )}
        {editing && (
          <Modal title={`${editing.code}: ${editing.pendingVersion?.status === 'DRAFT' ? 'edit draft' : 'new version'}`} onClose={() => setEditing(null)} wide footer={<>
            <Button variant="soft" onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="soft" disabled={busy} onClick={() => void run(async () => { await opsApi.draftPolicy(editing.id, { body: text }); await state.reload(); toast('Draft saved', 'success'); })}>Save draft</Button>
            <Button disabled={busy} onClick={() => void run(async () => { await opsApi.draftPolicy(editing.id, { body: text }); await opsApi.submitPolicy(editing.id); setEditing(null); await state.reload(); toast('Sent to the principal for approval', 'success'); })}>Submit for approval</Button>
          </>}>
            <textarea className="input" rows={14} value={text} onChange={(e) => setText(e.target.value)} style={{ width: '100%' }} aria-label="Policy text" />
            <ErrorNote error={error} />
          </Modal>
        )}
      </SectionCard>
    )}</Loadable>
  );
}

const TOPICS = ['POCSO_CHILD_PROTECTION', 'POSH', 'ANTI_RAGGING', 'FIRE_SAFETY', 'FIRST_AID', 'EMERGENCY_DRILL', 'TRANSPORT_SAFETY', 'CYBER_SAFETY', 'DATA_PROTECTION', 'INDUCTION', 'ACADEMIC', 'OTHER'];

function TrainingDetail({ t, onClose, onSaved }: { t: TrainingDto; onClose: () => void; onSaved: () => void }) {
  const [att, setAtt] = useState<Record<string, string>>(Object.fromEntries(t.participants.map((p) => [p.profileId, p.status])));
  const [evidence, setEvidence] = useState<Array<{ name: string; url: string }>>([]);
  const [notes, setNotes] = useState('');
  const [group, setGroup] = useState(t.groupAttendance ? String(t.groupAttendance) : '');
  const { run, busy, error } = useAction();
  const save = (complete: boolean) => run(async () => { await opsApi.trainingAttendance(t.id, { attendance: Object.entries(att).map(([profileId, status]) => ({ profileId, status })), evidence, notes: notes || undefined, groupAttendance: group || undefined, complete }); onSaved(); onClose(); });
  return (
    <Drawer title={t.title} sub={`${t.refNo} · ${humanize(t.topic)} · ${fmtDateTime(t.scheduledAt)}`} onClose={onClose} footer={t.status === 'SCHEDULED' ? <><Button variant="soft" disabled={busy} onClick={() => void save(false)}>Save attendance</Button><Button disabled={busy} onClick={() => void save(true)}>Complete with evidence</Button></> : undefined}>
      <KeyValues rows={[['Audience', humanize(t.audience)], ['Mandatory', t.mandatory ? 'Yes' : 'No'], ['Basis', t.basis], ['Facilitator', t.facilitator], ['Location', t.location], ['Status', <StatusPill key="s" status={t.status} />]]} />
      {t.participants.length > 0 ? (
        <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Participant</th><th>Attendance</th><th>Acknowledged</th></tr></thead><tbody>
          {t.participants.map((p) => (
            <tr key={p.profileId}><td>{p.name}</td><td><select className="input" value={att[p.profileId]} disabled={t.status !== 'SCHEDULED'} onChange={(e) => setAtt({ ...att, [p.profileId]: e.target.value })} aria-label={`Attendance for ${p.name}`}><option value="INVITED">Invited</option><option value="ATTENDED">Attended</option><option value="ABSENT">Absent</option><option value="EXEMPT">Exempt</option></select></td><td>{p.acknowledgedAt ? fmtDate(p.acknowledgedAt) : '—'}</td></tr>
          ))}
        </tbody></table></div>
      ) : <Field label="Number who attended"><input className="input" inputMode="numeric" value={group} onChange={(e) => setGroup(e.target.value)} /></Field>}
      {t.status === 'SCHEDULED' && <>
        <AttachUpload label="Evidence (attendance sheet, photos)" onUploaded={(a) => setEvidence((x) => [...x, { name: a.name, url: a.url }])} />
        <Field label="Notes"><textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: '100%' }} /></Field>
      </>}
      <div><h3 className="ops-section-title">Evidence</h3><Attachments items={[...t.evidence, ...evidence]} /></div>
      <ErrorNote error={error} />
    </Drawer>
  );
}

function TrainingsTab({ canManage }: { canManage: boolean }) {
  const state = useLoad(() => opsApi.trainings(), []);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<TrainingDto | null>(null);
  const [f, setF] = useState({ topic: 'POCSO_CHILD_PROTECTION', title: 'Child protection & POCSO awareness', audience: 'ALL_STAFF', mandatory: true, basis: 'POCSO Rules 2020, rule 3 (see REG-003)', scheduledAt: '', durationMinutes: '90', facilitator: '', location: '', recurrenceMonths: '12' });
  const { run, busy, error } = useAction();
  return (
    <Loadable state={state}>{(rows) => (
      <SectionCard title="Trainings & sessions" sub="POCSO/child protection, POSH, anti-ragging, fire and emergency drills, transport and cyber safety. Completion needs evidence." actions={canManage ? <Button small onClick={() => setCreating(true)}>+ Schedule</Button> : undefined}>
        {!rows.length ? <EmptyState title="No sessions" sub="Schedule your first awareness session." /> : (
          <ul className="ops-list">{rows.map((t) => (
            <li key={t.id} className="ops-row">
              <div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => setOpen(t)}><div className="ops-row-title">{t.title}</div><div className="ops-row-sub">{humanize(t.topic)} · {fmtDateTime(t.scheduledAt)} · {t.attended}/{t.invited || t.groupAttendance || 0} attended</div></button></div>
              {t.mandatory && <StatusPill status="PENDING" label="Mandatory" />}<StatusPill status={t.status} />
            </li>
          ))}</ul>
        )}
        {creating && (
          <Modal title="Schedule training" onClose={() => setCreating(false)} wide footer={<><Button variant="soft" onClick={() => setCreating(false)}>Cancel</Button><Button disabled={busy || !f.scheduledAt || !f.title} onClick={() => void run(async () => { await opsApi.scheduleTraining({ ...f, scheduledAt: new Date(f.scheduledAt).toISOString(), durationMinutes: Number(f.durationMinutes), recurrenceMonths: f.recurrenceMonths ? Number(f.recurrenceMonths) : null }); setCreating(false); await state.reload(); })}>Schedule & invite</Button></>}>
            <div className="ops-form-grid">
              <Field label="Topic"><select className="input" value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })}>{TOPICS.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select></Field>
              <Field label="Title" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
              <Field label="Audience"><select className="input" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}>{['ALL_STAFF', 'TEACHING_STAFF', 'NON_TEACHING_STAFF', 'DRIVERS_ATTENDANTS', 'STUDENTS', 'PARENTS', 'CUSTOM'].map((a) => <option key={a} value={a}>{humanize(a)}</option>)}</select></Field>
              <Field label="When" required><input type="datetime-local" className="input" value={f.scheduledAt} onChange={(e) => setF({ ...f, scheduledAt: e.target.value })} /></Field>
              <Field label="Minutes"><input className="input" inputMode="numeric" value={f.durationMinutes} onChange={(e) => setF({ ...f, durationMinutes: e.target.value })} /></Field>
              <Field label="Repeat every (months)"><input className="input" inputMode="numeric" value={f.recurrenceMonths} onChange={(e) => setF({ ...f, recurrenceMonths: e.target.value })} /></Field>
              <Field label="Facilitator"><input className="input" value={f.facilitator} onChange={(e) => setF({ ...f, facilitator: e.target.value })} /></Field>
              <Field label="Location"><input className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
            </div>
            <label className="ops-inline"><input type="checkbox" checked={f.mandatory} onChange={(e) => setF({ ...f, mandatory: e.target.checked })} /> Mandatory</label>
            <Field label="Why (basis)"><input className="input" value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value })} style={{ width: '100%' }} /></Field>
            <ErrorNote error={error} />
          </Modal>
        )}
        {open && <TrainingDetail t={open} onClose={() => setOpen(null)} onSaved={() => void state.reload()} />}
      </SectionCard>
    )}</Loadable>
  );
}

const SOURCES = ['CBSE', 'CISCE', 'STATE_BOARD', 'STATE_EDUCATION_DEPT', 'DISTRICT_COLLECTOR', 'DISTRICT_EDUCATION_OFFICE', 'MINISTRY', 'UGC', 'AICTE', 'UNIVERSITY', 'NCPCR_SCPCR', 'COURT', 'OTHER'];

function NoticeDetail({ n, onClose, onSaved }: { n: NoticeDto; onClose: () => void; onSaved: () => void }) {
  const [rationale, setRationale] = useState('');
  const [authNote, setAuthNote] = useState('');
  const [actions, setActions] = useState(n.actions.length ? n.actions.map((a) => ({ title: a.title, dueOn: a.dueOn?.slice(0, 10) ?? '', done: a.done })) : [{ title: '', dueOn: '', done: false }]);
  const { run, busy, error } = useAction();
  const decide = (body: unknown) => run(async () => { await opsApi.decideNotice(n.id, body); onSaved(); onClose(); });
  return (
    <Drawer title={n.title} sub={`${n.refNo} · ${humanize(n.source)}${n.jurisdiction ? ` · ${n.jurisdiction}` : ''}`} onClose={onClose}>
      <div className="ops-inline"><StatusPill status={n.status} /><StatusPill status={n.authenticity === 'VERIFIED' ? 'CLEARED' : n.authenticity === 'SUSPECT' ? 'REJECTED' : 'PENDING'} label={humanize(n.authenticity)} /></div>
      <KeyValues rows={[['Their ref.', n.theirReference], ['Published', fmtDate(n.publishedOn)], ['Effective', fmtDate(n.effectiveOn)], ['Received via', humanize(n.receivedVia)]]} />
      {n.url && <p><a href={n.url} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)', textDecoration: 'underline' }}>Open the official page ↗</a></p>}
      {n.summary && <div className="ops-callout" style={{ whiteSpace: 'pre-wrap' }}>{n.summary}</div>}
      <SectionCard title="1. Is it genuine?">
        <Field label="How you checked"><input className="input" value={authNote} onChange={(e) => setAuthNote(e.target.value)} placeholder="Found on the collector's official website / confirmed with DEO office" style={{ width: '100%' }} /></Field>
        <div className="ops-inline"><Button small disabled={busy} onClick={() => void decide({ authenticity: 'VERIFIED', authenticityNote: authNote })}>Verified</Button><Button small variant="ghost" disabled={busy} onClick={() => void decide({ authenticity: 'SUSPECT', authenticityNote: authNote })}>Suspect</Button></div>
      </SectionCard>
      <SectionCard title="2. Does it apply to us?" sub="Nothing changes until you decide, with a reason.">
        <Field label="Rationale"><textarea className="input" rows={3} value={rationale} onChange={(e) => setRationale(e.target.value)} style={{ width: '100%' }} /></Field>
        <div className="ops-inline"><Button small disabled={busy || !rationale || n.authenticity !== 'VERIFIED'} onClick={() => void decide({ applicability: 'APPLICABLE', rationale })}>Applies</Button><Button small variant="soft" disabled={busy || !rationale} onClick={() => void decide({ applicability: 'NOT_APPLICABLE', rationale })}>Does not apply</Button></div>
        {n.decision?.rationale && <p className="ops-muted">Decided by {n.decision.byName} on {fmtDate(n.decision.at)}: “{n.decision.rationale}”</p>}
      </SectionCard>
      {['APPLICABLE', 'ACTIONED'].includes(n.status) && (
        <SectionCard title="3. Actions">
          {actions.map((a, i) => (
            <div key={i} className="ops-inline" style={{ marginBottom: 6 }}>
              <input className="input" value={a.title} onChange={(e) => setActions((x) => x.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)))} placeholder="Action" aria-label={`Action ${i + 1}`} style={{ flex: 1 }} />
              <input type="date" className="input" value={a.dueOn} onChange={(e) => setActions((x) => x.map((y, j) => (j === i ? { ...y, dueOn: e.target.value } : y)))} aria-label="Due" />
              <label className="ops-chip"><input type="checkbox" checked={a.done} onChange={(e) => setActions((x) => x.map((y, j) => (j === i ? { ...y, done: e.target.checked } : y)))} />done</label>
            </div>
          ))}
          <div className="ops-inline"><Button small variant="ghost" onClick={() => setActions((x) => [...x, { title: '', dueOn: '', done: false }])}>+ Action</Button><Button small disabled={busy} onClick={() => void decide({ actions: actions.filter((a) => a.title.trim()).map((a) => ({ ...a, dueOn: a.dueOn || null })) })}>Save actions</Button></div>
        </SectionCard>
      )}
      <ErrorNote error={error} />
    </Drawer>
  );
}

function NoticesTab({ canManage }: { canManage: boolean }) {
  const state = useLoad(() => Promise.all([opsApi.notices(), opsApi.noticeSources()]), []);
  const [open, setOpen] = useState<NoticeDto | null>(null);
  const [adding, setAdding] = useState<null | 'notice' | 'source'>(null);
  const [f, setF] = useState({ source: 'DISTRICT_COLLECTOR', jurisdiction: '', title: '', url: '', summary: '', publishedOn: '', name: '' });
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <Loadable state={state}>{([notices, sources]) => (
      <div className="ops-stack">
        <SectionCard title="Notices from authorities" sub="Board circulars, state and district (collector / DEO) orders, university notifications. Record them here, then verify and decide." actions={canManage ? <Button small onClick={() => setAdding('notice')}>+ Record notice</Button> : undefined}>
          {!notices.length ? <EmptyState title="No notices" sub="Record a circular or order to review it." /> : (
            <ul className="ops-list">{notices.map((n) => (
              <li key={n.id} className="ops-row"><div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => setOpen(n)}><div className="ops-row-title">{n.title}</div><div className="ops-row-sub">{n.refNo} · {humanize(n.source)}{n.jurisdiction ? ` · ${n.jurisdiction}` : ''} · {humanize(n.receivedVia)}</div></button></div><StatusPill status={n.status} /></li>
            ))}</ul>
          )}
        </SectionCard>
        <SectionCard title="Watched official pages" sub="EduOS can check a page you choose for changes. A change creates an unverified notice for review; it is change detection, not a feed, and no district authority offers an API." actions={canManage ? <Button small variant="soft" onClick={() => setAdding('source')}>+ Watch a page</Button> : undefined}>
          {!sources.length ? <p className="ops-muted">No pages watched.</p> : (
            <ul className="ops-list">{sources.map((s) => (
              <li key={s.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{s.name}</div><div className="ops-row-sub">{s.url} · last checked {fmtDateTime(s.lastCheckedAt)}{s.lastError ? ` · ${s.lastError}` : ''}</div></div><StatusPill status={s.lastStatus === 'FAILED' ? 'FAILED' : s.lastStatus === 'CHANGED' ? 'PENDING' : 'DRAFT'} label={humanize(s.lastStatus)} />
                {canManage && <Button small variant="soft" disabled={busy} onClick={() => void run(async () => { const r = await opsApi.checkNoticeSource(s.id); toast(r.notice ? 'Page changed — a notice was created for review' : r.source.lastStatus === 'FAILED' ? `Check failed: ${r.source.lastError}` : 'No change', r.source.lastStatus === 'FAILED' ? 'error' : 'info'); await state.reload(); })}>Check now</Button>}</li>
            ))}</ul>
          )}
        </SectionCard>
        {adding && (
          <Modal title={adding === 'notice' ? 'Record a notice' : 'Watch an official page'} onClose={() => setAdding(null)} footer={<><Button variant="soft" onClick={() => setAdding(null)}>Cancel</Button><Button disabled={busy} onClick={() => void run(async () => {
            if (adding === 'notice') await opsApi.createNotice({ source: f.source, jurisdiction: f.jurisdiction, title: f.title, url: f.url || undefined, summary: f.summary, publishedOn: f.publishedOn || undefined });
            else await opsApi.addNoticeSource({ name: f.name, url: f.url, source: f.source, jurisdiction: f.jurisdiction });
            setAdding(null); await state.reload();
          })}>Save</Button></>}>
            <div className="ops-form-grid">
              <Field label="Authority"><select className="input" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>{SOURCES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select></Field>
              <Field label="Jurisdiction"><input className="input" value={f.jurisdiction} onChange={(e) => setF({ ...f, jurisdiction: e.target.value })} placeholder="National / state / district" /></Field>
              {adding === 'notice' ? <Field label="Title" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field> : <Field label="Name" required><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>}
              <Field label="URL" hint={adding === 'source' ? 'https only' : undefined}><input className="input" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></Field>
              {adding === 'notice' && <Field label="Published on"><input type="date" className="input" value={f.publishedOn} onChange={(e) => setF({ ...f, publishedOn: e.target.value })} /></Field>}
            </div>
            {adding === 'notice' && <Field label="Summary"><textarea className="input" rows={4} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} style={{ width: '100%' }} /></Field>}
            <ErrorNote error={error} />
          </Modal>
        )}
        {open && <NoticeDetail n={open} onClose={() => setOpen(null)} onSaved={() => void state.reload()} />}
      </div>
    )}</Loadable>
  );
}

export function ComplianceView() {
  const { permissions } = usePermissions();
  const canManage = Boolean(permissions['compliance.manage']);
  const initial = (useQueryParam('tab') as Tab | null) ?? 'calendar';
  const [tab, setTab] = useState<Tab>(initial);
  return (
    <div className="ops-stack">
      <Tabs tabs={[{ key: 'calendar', label: 'Overview & calendar' }, { key: 'obligations', label: 'Obligations' }, { key: 'returns', label: 'Returns' }, { key: 'licences', label: 'Licences' }, { key: 'accreditation', label: 'Accreditation' }, { key: 'policies', label: 'Policies' }, { key: 'trainings', label: 'Trainings' }, { key: 'notices', label: 'Notices' }]} value={tab} onChange={setTab} />
      {tab === 'calendar' && <CalendarTab />}
      {tab === 'obligations' && <ObligationsTab canManage={canManage} />}
      {tab === 'returns' && <ReturnsTab canManage={canManage} />}
      {tab === 'licences' && <LicencesTab canManage={canManage} />}
      {tab === 'accreditation' && <AccreditationTab canManage={canManage} />}
      {tab === 'policies' && <PoliciesTab canManage={canManage} />}
      {tab === 'trainings' && <TrainingsTab canManage={canManage} />}
      {tab === 'notices' && <NoticesTab canManage={canManage} />}
      <DataNote>EduOS records obligations and evidence; it does not decide legal applicability. Unverified sources are marked in the source register and need qualified review.</DataNote>
    </div>
  );
}
