'use client';
import { useState } from 'react';
import { Button, EmptyState, Field, Modal, useToast } from '@/components/ui';
import { opsApi } from '@/lib/ops-api';
import { usePermissions } from '@/lib/permissions';
import type { VerificationCheckDto, VerificationDto } from '@/lib/ops-types';
import { AttachUpload } from './attach';
import { Drawer } from './drawer';
import { Attachments, DataNote, ErrorNote, KeyValues, Loadable, PromptModal, SectionCard, StatusPill, Stepper, Tabs, Tile, Timeline, fmtDate, humanize, useAction, useLoad, useQueryParam } from './kit';

/**
 * Background verification of staff, teachers, drivers, attendants and
 * vendors: consent → checks with evidence (by authorised verifiers) → HR
 * recommendation → principal's final decision → re-check when a time-limited
 * check lapses. People without verification.manage see status only.
 */
const STEPS = [{ key: 'INITIATED', label: 'Consent' }, { key: 'IN_PROGRESS', label: 'Checks' }, { key: 'AWAITING_DECISION', label: 'Principal' }, { key: 'CLEARED', label: 'Decided' }];
const TYPES = ['TEACHER', 'STAFF', 'DRIVER', 'ATTENDANT', 'SECURITY', 'VENDOR', 'VOLUNTEER', 'CONTRACTOR'];

function CheckRow({ c, caseId, canManage, onDone }: { c: VerificationCheckDto; caseId: string; canManage: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ status: c.status === 'NOT_STARTED' ? 'IN_PROGRESS' : c.status, provider: c.provider ?? '', reference: c.reference ?? '', expiresOn: c.expiresOn?.slice(0, 10) ?? '', note: c.note ?? '' });
  const [evidence, setEvidence] = useState<Array<{ name: string; url: string }>>([]);
  const { run, busy, error } = useAction();
  return (
    <li className="ops-row">
      <div className="ops-row-main"><div className="ops-row-title">{humanize(c.type)}{!c.required && <span className="ops-muted"> (waived)</span>}</div><div className="ops-row-sub">{c.provider ?? '—'}{c.reference ? ` · ref ${c.reference}` : ''}{c.expiresOn ? ` · valid till ${fmtDate(c.expiresOn)}` : ''}{c.note ? ` · ${c.note}` : ''}</div><Attachments items={c.evidence} /></div>
      <StatusPill status={c.status === 'CLEAR' ? 'CLEARED' : c.status === 'NOT_STARTED' ? 'DRAFT' : c.status} label={humanize(c.status)} />
      {canManage && <Button small variant="soft" onClick={() => setOpen(true)}>Record</Button>}
      {open && (
        <Modal title={`${humanize(c.type)} check`} onClose={() => setOpen(false)} footer={<><Button variant="soft" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={busy} onClick={() => void run(async () => { await opsApi.recordCheck(caseId, c._id, { ...f, expiresOn: f.expiresOn || null, evidence }); setOpen(false); onDone(); })}>Save</Button></>}>
          <div className="ops-form-grid">
            <Field label="Result"><select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="IN_PROGRESS">In progress</option><option value="CLEAR">Clear</option><option value="ADVERSE">Adverse finding</option><option value="UNABLE_TO_VERIFY">Unable to verify</option></select></Field>
            <Field label="Verified by (agency / police station / referee)"><input className="input" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} /></Field>
            <Field label="Reference no."><input className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
            <Field label="Valid until" hint="For police verification, licences, fitness"><input type="date" className="input" value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })} /></Field>
          </div>
          <Field label="Note"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} style={{ width: '100%' }} /></Field>
          <AttachUpload label="Evidence" hint="A completed check needs evidence or a reference number." onUploaded={(a) => setEvidence((x) => [...x, { name: a.name, url: a.url }])} />
          <ErrorNote error={error} />
        </Modal>
      )}
    </li>
  );
}

function CaseDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { permissions } = usePermissions();
  const canManage = Boolean(permissions['verification.manage']);
  const canDecide = Boolean(permissions['verification.decide']);
  const state = useLoad(() => opsApi.verification(id), [id]);
  const [prompt, setPrompt] = useState<null | 'consent' | 'hr' | 'decide' | 'dispute'>(null);
  const [rec, setRec] = useState('CLEAR');
  const [decision, setDecision] = useState('CLEARED');
  const [conditions, setConditions] = useState('');
  const [consentUrl, setConsentUrl] = useState('');
  const toast = useToast();
  const reload = async () => { await state.reload(); onChanged(); };
  const v = state.data;
  return (
    <Drawer title={v ? v.subjectName : 'Verification'} sub={v ? `${v.refNo} · ${humanize(v.subjectType)}${v.positionTitle ? ` · ${v.positionTitle}` : ''}` : undefined} onClose={onClose}
      footer={v && (
        <>
          {canManage && v.consent && !v.consent.obtained && <Button onClick={() => setPrompt('consent')}>Record consent</Button>}
          {canManage && ['IN_PROGRESS', 'HR_REVIEW'].includes(v.status) && <Button onClick={() => setPrompt('hr')}>HR recommendation</Button>}
          {canDecide && v.status === 'AWAITING_DECISION' && <Button onClick={() => setPrompt('decide')}>Give final decision</Button>}
          {canManage && ['NOT_CLEARED', 'CLEARED_WITH_CONDITIONS'].includes(v.status) && <Button variant="ghost" onClick={() => setPrompt('dispute')}>Record a dispute</Button>}
        </>
      )}>
      <Loadable state={state}>{(d) => (
        <>
          <Stepper steps={STEPS} current={['CLEARED', 'CLEARED_WITH_CONDITIONS', 'NOT_CLEARED', 'EXPIRED'].includes(d.status) ? 'CLEARED' : d.status === 'HR_REVIEW' ? 'IN_PROGRESS' : d.status} failed={['NOT_CLEARED', 'EXPIRED'].includes(d.status)} />
          <div className="ops-inline"><StatusPill status={d.status} />{d.recheckDueOn && <span className="ops-muted">Re-check due {fmtDate(d.recheckDueOn)}</span>}</div>
          {d.conditions && <div className="ops-callout is-warn">Conditions: {d.conditions}</div>}
          {!d.checks ? <DataNote>You can see this person’s clearance status. Evidence is visible only to the verification team.</DataNote> : (
            <>
              <KeyValues rows={[['Consent', d.consent?.obtained ? `Yes · ${fmtDate(d.consent.at)}` : 'Not yet recorded'], ...(d.subjectType === 'DRIVER' ? [['Licence', d.driver?.licenceNo ? `${d.driver.licenceNo} · valid till ${fmtDate(d.driver.licenceValidTo)}` : '—'] as [string, string], ['Heavy-vehicle experience', d.driver?.heavyVehicleExperienceYears !== null && d.driver?.heavyVehicleExperienceYears !== undefined ? `${d.driver.heavyVehicleExperienceYears} years` : '—'] as [string, string]] : []), ['Checks done', `${d.checksDone}/${d.checksRequired}`], ['Adverse', String(d.adverse ?? 0)]]} />
              <SectionCard title="Checks"><ul className="ops-list">{d.checks.map((c) => <CheckRow key={c._id} c={c} caseId={d.id} canManage={canManage && !['CLEARED', 'CLEARED_WITH_CONDITIONS', 'NOT_CLEARED'].includes(d.status)} onDone={() => void reload()} />)}</ul></SectionCard>
              {d.hrReview?.recommendation && <p><b>HR recommends {humanize(d.hrReview.recommendation)}</b> ({fmtDate(d.hrReview.at)}): {d.hrReview.note}</p>}
              {d.decision?.status && <p><b>Decision: {humanize(d.decision.status)}</b> by {d.decision.byName} on {fmtDate(d.decision.at)}{d.decision.note ? ` — ${d.decision.note}` : ''}</p>}
              {d.dispute?.raisedAt && <div className="ops-callout">Dispute: {d.dispute.note}{d.dispute.resolution ? ` · Resolution: ${d.dispute.resolution}` : ' · open'}</div>}
              <div><h3 className="ops-section-title">History</h3><Timeline items={d.history} /></div>
            </>
          )}
        </>
      )}</Loadable>
      {prompt === 'consent' && <Modal title="Record consent" onClose={() => setPrompt(null)} footer={<><Button variant="soft" onClick={() => setPrompt(null)}>Cancel</Button><Button disabled={!consentUrl} onClick={() => void opsApi.verificationAction(id, 'consent', { evidenceUrl: consentUrl }).then(() => { setPrompt(null); toast('Consent recorded', 'success'); return reload(); })}>Save</Button></>}><AttachUpload label="Signed consent form" onUploaded={(a) => setConsentUrl(a.url)} /></Modal>}
      {prompt === 'hr' && <PromptModal title="HR recommendation" label="Reasoning" onClose={() => setPrompt(null)} extra={<Field label="Recommendation"><select className="input" value={rec} onChange={(e) => setRec(e.target.value)}><option value="CLEAR">Clear</option><option value="CLEAR_WITH_CONDITIONS">Clear with conditions</option><option value="DO_NOT_CLEAR">Do not clear</option></select></Field>} onSubmit={(note) => opsApi.verificationAction(id, 'hr-review', { recommendation: rec, note }).then(reload)} />}
      {prompt === 'decide' && <PromptModal title="Final clearance decision" label="Reasoning (required to clear when a check is adverse)" required={false} onClose={() => setPrompt(null)} extra={<>
        <Field label="Decision"><select className="input" value={decision} onChange={(e) => setDecision(e.target.value)}><option value="CLEARED">Cleared</option><option value="CLEARED_WITH_CONDITIONS">Cleared with conditions</option><option value="NOT_CLEARED">Not cleared</option></select></Field>
        {decision === 'CLEARED_WITH_CONDITIONS' && <Field label="Conditions"><input className="input" value={conditions} onChange={(e) => setConditions(e.target.value)} style={{ width: '100%' }} /></Field>}
      </>} onSubmit={(note) => opsApi.verificationAction(id, 'decide', { decision, conditions, note: note || undefined }).then(reload)} />}
      {prompt === 'dispute' && <PromptModal title="Record the subject’s dispute" label="What they dispute" onClose={() => setPrompt(null)} onSubmit={(note) => opsApi.verificationAction(id, 'dispute', { note }).then(reload)} />}
    </Drawer>
  );
}

export function VerificationView() {
  const { permissions } = usePermissions();
  const canManage = Boolean(permissions['verification.manage']);
  const openId = useQueryParam('id');
  const initialStatus = useQueryParam('status') ?? '';
  const [status, setStatus] = useState(initialStatus);
  const [selected, setSelected] = useState<string | null>(openId);
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ subjectType: 'TEACHER', subjectName: '', positionTitle: '', subjectProfileId: '', licenceNo: '', licenceValidTo: '', experience: '' });
  const stats = useLoad(() => opsApi.verificationStats(), []);
  const list = useLoad(() => opsApi.verifications({ status: status || undefined }), [status]);
  const staff = useLoad(() => (canManage ? opsApi.orgStaff() : Promise.resolve([])), [canManage]);
  const { run, busy, error } = useAction();
  const refresh = () => { void stats.reload(); void list.reload(); };
  return (
    <div className="ops-stack">
      <Loadable state={stats}>{(s) => (
        <div className="kpi-grid">
          <Tile label="Awaiting principal" value={s.awaitingDecision} tone={s.awaitingDecision ? 'warn' : 'good'} />
          <Tile label="In progress" value={s.inProgress} />
          <Tile label="Not cleared" value={s.notCleared} />
          <Tile label="Expired" value={s.expired} tone={s.expired ? 'bad' : 'good'} />
          <Tile label="Re-check within 30 days" value={s.recheckWithin30Days} tone={s.recheckWithin30Days ? 'warn' : 'neutral'} />
        </div>
      )}</Loadable>
      <div className="ops-inline">
        <Tabs tabs={[{ key: '', label: 'All' }, { key: 'AWAITING_DECISION', label: 'Awaiting decision' }, { key: 'IN_PROGRESS', label: 'In progress' }, { key: 'EXPIRED', label: 'Expired' }, { key: 'NOT_CLEARED', label: 'Not cleared' }]} value={status} onChange={setStatus} />
        {canManage && <Button onClick={() => setCreating(true)}>+ Start verification</Button>}
      </div>
      <Loadable state={list}>{(rows) => !rows.length ? <EmptyState title="No verifications" sub="Start one for each new teacher, staff member, driver, attendant or vendor." /> : (
        <SectionCard title={`${rows.length} case(s)`}>
          <ul className="ops-list">{rows.map((v: VerificationDto) => (
            <li key={v.id} className="ops-row"><div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => setSelected(v.id)}><div className="ops-row-title">{v.subjectName}</div><div className="ops-row-sub">{v.refNo} · {humanize(v.subjectType)}{v.positionTitle ? ` · ${v.positionTitle}` : ''}{v.recheckDueOn ? ` · re-check ${fmtDate(v.recheckDueOn)}` : ''}{v.checksRequired !== undefined ? ` · ${v.checksDone}/${v.checksRequired} checks` : ''}</div></button></div><StatusPill status={v.status} /></li>
          ))}</ul>
        </SectionCard>
      )}</Loadable>
      <DataNote>EduOS records what authorised verifiers found. It has no access to criminal records and never treats an automated search as a clearance. Pending is never cleared; a driver with a lapsed check or licence shows as not cleared.</DataNote>
      {creating && (
        <Modal title="Start background verification" onClose={() => setCreating(false)} footer={<><Button variant="soft" onClick={() => setCreating(false)}>Cancel</Button><Button disabled={busy || !f.subjectName} onClick={() => void run(async () => {
          const v = await opsApi.initiateVerification({ subjectType: f.subjectType, subjectName: f.subjectName, positionTitle: f.positionTitle, subjectProfileId: f.subjectProfileId || undefined, driver: f.subjectType === 'DRIVER' ? { licenceNo: f.licenceNo, licenceValidTo: f.licenceValidTo || null, heavyVehicleExperienceYears: f.experience ? Number(f.experience) : undefined } : undefined });
          setCreating(false); refresh(); setSelected(v.id);
        })}>Start</Button></>}>
          <div className="ops-form-grid">
            <Field label="Person is a"><select className="input" value={f.subjectType} onChange={(e) => setF({ ...f, subjectType: e.target.value })}>{TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select></Field>
            <Field label="Name" required><input className="input" value={f.subjectName} onChange={(e) => setF({ ...f, subjectName: e.target.value })} /></Field>
            <Field label="Position"><input className="input" value={f.positionTitle} onChange={(e) => setF({ ...f, positionTitle: e.target.value })} /></Field>
            <Field label="Existing staff account (optional)"><select className="input" value={f.subjectProfileId} onChange={(e) => setF({ ...f, subjectProfileId: e.target.value })}><option value="">None / not yet created</option>{(staff.data ?? []).map((s) => <option key={s.profileId} value={s.profileId}>{s.name}</option>)}</select></Field>
            {f.subjectType === 'DRIVER' && <>
              <Field label="Driving licence no."><input className="input" value={f.licenceNo} onChange={(e) => setF({ ...f, licenceNo: e.target.value })} /></Field>
              <Field label="Licence valid until"><input type="date" className="input" value={f.licenceValidTo} onChange={(e) => setF({ ...f, licenceValidTo: e.target.value })} /></Field>
              <Field label="Heavy-vehicle experience (years)"><input className="input" inputMode="numeric" value={f.experience} onChange={(e) => setF({ ...f, experience: e.target.value })} /></Field>
            </>}
          </div>
          <ErrorNote error={error} />
        </Modal>
      )}
      {selected && <CaseDetail id={selected} onClose={() => setSelected(null)} onChanged={refresh} />}
    </div>
  );
}
