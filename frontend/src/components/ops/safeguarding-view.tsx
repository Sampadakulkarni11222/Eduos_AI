'use client';
import { useState } from 'react';
import { Button, EmptyState, Field, useToast } from '@/components/ui';
import { opsApi } from '@/lib/ops-api';
import { usePermissions } from '@/lib/permissions';
import { Drawer } from './drawer';
import { ErrorNote, KeyValues, Loadable, SectionCard, StatusPill, Timeline, fmtDate, fmtDateTime, humanize, useAction, useLoad } from './kit';

/**
 * Safeguarding. Anyone can raise a concern; only designated officers see
 * cases. The reporter is told plainly that statutory reporting (e.g. POCSO
 * s.19 to the Special Juvenile Police Unit or police) does not wait for any
 * internal decision.
 */
const CATEGORIES = ['CHILD_PROTECTION', 'SEXUAL_HARASSMENT_WORKPLACE', 'RAGGING', 'BULLYING', 'ONLINE_SAFETY', 'SELF_HARM_RISK', 'NEGLECT', 'OTHER'];

export function ReportConcern() {
  const [f, setF] = useState({ category: 'CHILD_PROTECTION', urgency: 'STANDARD', occurredOn: '', description: '', anonymousToStaff: false });
  const [done, setDone] = useState<{ refNo: string; guidance: string | null; officersNotified: number } | null>(null);
  const mine = useLoad(() => opsApi.myReports(), []);
  const { run, busy, error } = useAction();
  return (
    <div className="ops-stack">
      <div className="ops-callout is-danger" role="note">
        <b>If someone is in immediate danger, call 112.</b> Childline: 1098. Tele-MANAS: 14416.<br />
        If a child may have been sexually abused, the law requires a report to the Special Juvenile Police Unit or the local police (POCSO Act, s.19). That duty does not wait for anyone in the school to approve it.
      </div>
      {done ? (
        <SectionCard title="Your concern has been received">
          <p>Reference <b>{done.refNo}</b>. {done.officersNotified ? 'The designated safeguarding officer has been alerted.' : 'No designated officer is set up yet — please also tell the principal directly.'}</p>
          {done.guidance && <p className="ops-callout">{done.guidance}</p>}
          <Button variant="soft" onClick={() => { setDone(null); setF({ ...f, description: '' }); }}>Report another concern</Button>
        </SectionCard>
      ) : (
        <SectionCard title="Report a concern" sub="Only the designated safeguarding officer can read this. You will see its reference and status, nothing else.">
          <div className="ops-form-grid">
            <Field label="What kind of concern"><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select></Field>
            <Field label="How urgent"><select className="input" value={f.urgency} onChange={(e) => setF({ ...f, urgency: e.target.value })}><option value="IMMEDIATE_DANGER">Someone is in danger now</option><option value="URGENT">Urgent</option><option value="STANDARD">Standard</option></select></Field>
            <Field label="When it happened"><input type="date" className="input" value={f.occurredOn} onChange={(e) => setF({ ...f, occurredOn: e.target.value })} /></Field>
          </div>
          <Field label="What happened" hint="Describe what you saw or were told, in the person's own words where you can. Do not investigate yourself." required>
            <textarea className="input" rows={7} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} style={{ width: '100%' }} />
          </Field>
          <label className="ops-inline"><input type="checkbox" checked={f.anonymousToStaff} onChange={(e) => setF({ ...f, anonymousToStaff: e.target.checked })} /> Hide my name from staff handling the case (the system still records who reported, for accountability)</label>
          <div><Button disabled={busy || f.description.trim().length < 10} onClick={() => void run(async () => { const r = await opsApi.reportConcern({ ...f, occurredOn: f.occurredOn || undefined }); setDone(r); await mine.reload(); })}>{busy ? 'Sending…' : 'Send report'}</Button></div>
          <ErrorNote error={error} />
        </SectionCard>
      )}
      <Loadable state={mine}>{(rows) => rows.length ? (
        <SectionCard title="Reports I made">
          <ul className="ops-list">{rows.map((r) => <li key={r.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{r.refNo}</div><div className="ops-row-sub">{humanize(r.category)} · {fmtDate(r.reportedAt)}</div></div><StatusPill status={r.status === 'REPORTED' ? 'RECEIVED' : r.status} /></li>)}</ul>
        </SectionCard>
      ) : null}</Loadable>
    </div>
  );
}

function CaseDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const state = useLoad(() => opsApi.caseById(id), [id]);
  const [note, setNote] = useState('');
  const [sr, setSr] = useState({ required: 'true', authority: 'Special Juvenile Police Unit', reportedAt: '', reference: '', note: '' });
  const [closeReason, setCloseReason] = useState('');
  const { run, busy, error } = useAction();
  const toast = useToast();
  const update = (body: unknown, msg: string) => run(async () => { await opsApi.updateCase(id, body); toast(msg, 'success'); await state.reload(); onChanged(); });
  return (
    <Drawer title={state.data ? `${state.data.refNo} · ${humanize(state.data.category)}` : 'Case'} sub="Restricted. Every opening of this case is recorded." onClose={onClose}>
      <Loadable state={state}>{(c) => (
        <>
          <div className="ops-inline"><StatusPill status={c.status === 'REPORTED' ? 'RECEIVED' : c.status} /><StatusPill status={c.urgency === 'STANDARD' ? 'DRAFT' : 'REJECTED'} label={humanize(c.urgency)} />{c.statutoryReportPending && <span className="ops-flag-overdue">STATUTORY REPORT NOT RECORDED</span>}</div>
          {c.guidance && <div className="ops-callout is-danger">{c.guidance}</div>}
          <KeyValues rows={[['Reported', fmtDateTime(c.reportedAt)], ['Occurred', fmtDate(c.occurredOn)], ['Reporter role', c.anonymousToStaff ? 'Withheld' : humanize(c.reporterRole)], ['Reporter', c.anonymousToStaff ? 'Withheld at reporter’s request' : 'Recorded']]} />
          <SectionCard title="Report"><p style={{ whiteSpace: 'pre-wrap' }}>{c.description}</p></SectionCard>
          <SectionCard title="Statutory report" sub="Record the report made to the authority (or why none is required). This never waits for an internal approval.">
            <div className="ops-form-grid">
              <Field label="Required?"><select className="input" value={sr.required} onChange={(e) => setSr({ ...sr, required: e.target.value })}><option value="true">Yes</option><option value="false">No (explain)</option></select></Field>
              <Field label="Authority"><input className="input" value={sr.authority} onChange={(e) => setSr({ ...sr, authority: e.target.value })} /></Field>
              <Field label="Reported at"><input type="datetime-local" className="input" value={sr.reportedAt} onChange={(e) => setSr({ ...sr, reportedAt: e.target.value })} /></Field>
              <Field label="Reference (FIR / GD / complaint no.)"><input className="input" value={sr.reference} onChange={(e) => setSr({ ...sr, reference: e.target.value })} /></Field>
            </div>
            <Field label="Note"><input className="input" value={sr.note} onChange={(e) => setSr({ ...sr, note: e.target.value })} style={{ width: '100%' }} /></Field>
            <Button small disabled={busy} onClick={() => void update({ statutoryReport: { required: sr.required === 'true', authority: sr.authority, reportedAt: sr.reportedAt ? new Date(sr.reportedAt).toISOString() : undefined, reference: sr.reference, note: sr.note } }, 'Statutory report recorded')}>Save</Button>
            {c.statutoryReport?.reportedAt && <p className="ops-muted">Recorded: {c.statutoryReport.authority} · {fmtDateTime(c.statutoryReport.reportedAt)} · {c.statutoryReport.reference}</p>}
          </SectionCard>
          <SectionCard title="Case notes">
            {c.notes?.length ? <ul className="ops-list">{c.notes.map((n, i) => <li key={i} className="ops-row"><div className="ops-row-main"><div className="ops-row-sub">{fmtDateTime(n.at)}</div><div style={{ whiteSpace: 'pre-wrap' }}>{n.text}</div></div></li>)}</ul> : <p className="ops-muted">No notes.</p>}
            <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} style={{ width: '100%' }} aria-label="New note" />
            <div className="ops-inline">
              <Button small variant="soft" disabled={busy || !note.trim()} onClick={() => void update({ note }, 'Note added').then(() => setNote(''))}>Add note</Button>
              {c.status === 'REPORTED' && <Button small variant="soft" onClick={() => void update({ status: 'UNDER_REVIEW' }, 'Under review')}>Start review</Button>}
              {['UNDER_REVIEW', 'REPORTED'].includes(c.status) && <Button small variant="soft" onClick={() => void update({ status: 'REFERRED_EXTERNAL' }, 'Marked referred')}>Referred externally</Button>}
              {['UNDER_REVIEW', 'REFERRED_EXTERNAL'].includes(c.status) && <Button small variant="soft" onClick={() => void update({ status: 'ACTION_TAKEN' }, 'Updated')}>Action taken</Button>}
            </div>
          </SectionCard>
          {c.status !== 'CLOSED' && (
            <SectionCard title="Close the case">
              <Field label="Closing reason"><textarea className="input" rows={2} value={closeReason} onChange={(e) => setCloseReason(e.target.value)} style={{ width: '100%' }} /></Field>
              <Button small disabled={busy || !closeReason.trim()} onClick={() => void update({ status: 'CLOSED', closeReason }, 'Closed')}>Close case</Button>
            </SectionCard>
          )}
          <ErrorNote error={error} />
          <div><h3 className="ops-section-title">History</h3><Timeline items={c.history} /></div>
        </>
      )}</Loadable>
    </Drawer>
  );
}

export function SafeguardingView() {
  const { permissions } = usePermissions();
  const officer = Boolean(permissions['safeguarding.manage']);
  const cases = useLoad(() => (officer ? opsApi.cases() : Promise.resolve([])), [officer]);
  const [open, setOpen] = useState<string | null>(null);
  if (!officer) return <ReportConcern />;
  return (
    <div className="ops-stack">
      <Loadable state={cases}>{(rows) => (
        <SectionCard title="Safeguarding cases" sub="Visible only to designated officers. Case details never appear in notifications, dashboards, search, the newsroom or the campus map.">
          {!rows.length ? <EmptyState icon="✓" title="No cases" sub="Reports raised by staff, students and parents appear here." /> : (
            <ul className="ops-list">{rows.map((c) => (
              <li key={c.id} className="ops-row">
                <div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => setOpen(c.id)}><div className="ops-row-title">{c.refNo} · {humanize(c.category)}</div><div className="ops-row-sub">{fmtDateTime(c.reportedAt)} · {c.anonymousToStaff || !c.reporterRole ? 'anonymous report' : `reported by ${humanize(c.reporterRole)}`}</div></button></div>
                {c.statutoryReportPending && <span className="ops-flag-overdue">STATUTORY REPORT?</span>}
                {c.urgency !== 'STANDARD' && <StatusPill status="REJECTED" label={humanize(c.urgency)} />}
                <StatusPill status={c.status === 'REPORTED' ? 'RECEIVED' : c.status} />
              </li>
            ))}</ul>
          )}
        </SectionCard>
      )}</Loadable>
      <details><summary className="field-label" style={{ cursor: 'pointer' }}>Raise a concern yourself</summary><ReportConcern /></details>
      {open && <CaseDetail id={open} onClose={() => setOpen(null)} onChanged={() => void cases.reload()} />}
    </div>
  );
}
