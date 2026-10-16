'use client';
import { useState } from 'react';
import { Button, EmptyState, Field, Modal } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { usePermissions } from '@/lib/permissions';
import {
  NOTIFY_TRIGGERS, VISIT_OUTCOMES, healthApi,
  type CareNoteDto, type DoseDueDto, type FamilyChildDto, type HealthVisitDto, type MedicationPlanDto, type StockDto,
} from '@/lib/health-api';
import { AttachUpload } from './attach';
import { DataNote, ErrorNote, KeyValues, Loadable, SectionCard, StatusPill, Tabs, Tile, fmtDate, humanize, isoDay, useAction, useLoad } from './kit';

/**
 * The school health room, one component for four readers:
 *   - the nurse (health.manage): today's visits and doses, the medication record,
 *     stock, care notes, immunisations, screenings and health cards
 *   - a parent (health.read OWN): their own child's visits, medication plans
 *     (consent and the prescription), the medication log and care notes
 *   - the class teacher (mode "carenotes"): only the care notes parents shared
 *   - the principal and administrator (mode "summary"): counts only
 * Every read is checked and audited by the API; this screen only shows what came back.
 */
type Mode = 'auto' | 'carenotes' | 'summary';
const inDays = (n: number) => isoDay(new Date(Date.now() + n * 86_400_000));
const timeOf = (d: string | null) => (d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—');
const outcomeTone = (o: string) => (o === 'SENT_HOME' || o === 'REFERRED' ? 'OVERDUE' : o === 'FIRST_AID' ? 'PENDING' : 'COMPLETED');
const doseTone = (s: string) => (s === 'GIVEN' ? 'COMPLETED' : s === 'OVERDUE' || s === 'MISSED' || s === 'REFUSED' ? 'OVERDUE' : 'PENDING');
const severityTone = (s: string) => (s === 'SEVERE' ? 'OVERDUE' : s === 'IMPORTANT' ? 'PENDING' : 'OPEN');

export function HealthView({ mode = 'auto' }: { mode?: Mode }) {
  const { permissions } = usePermissions();
  const { me } = useAuth();
  if (mode === 'summary') return <HealthSummary />;
  if (mode === 'carenotes') return <ClassCareNotes />;
  if (permissions['health.manage'] === 'ALL') return <NurseDesk />;
  if (me?.profile?.role === 'PARENT' && permissions['health.read']) return <FamilyHealth />;
  return <EmptyState icon="✚" title="Health records are restricted" sub="Only the school nurse and a child's own parents see health records. The principal sees counts only." />;
}

// ── counts only ─────────────────────────────────────────────────────────
function HealthSummary() {
  const [days, setDays] = useState(30);
  const state = useLoad(() => healthApi.summary(days), [days]);
  return (
    <div className="ops-stack">
      <DataNote>Counts only. Names, complaints and medicines stay with the school nurse and each child&apos;s parents.</DataNote>
      <div className="ops-inline">
        {[7, 30, 90].map((d) => <Button key={d} small variant={d === days ? 'accent' : 'soft'} onClick={() => setDays(d)}>Last {d} days</Button>)}
      </div>
      <Loadable state={state}>{(s) => (
        <>
          <div className="kpi-grid">
            <Tile label="Visits today" value={s.visits.today} />
            <Tile label={`Visits, last ${s.periodDays} days`} value={s.visits.inPeriod} />
            <Tile label="Injuries" value={s.visits.injuries} tone={s.visits.injuries ? 'warn' : 'neutral'} />
            <Tile label="Sent home" value={s.visits.byOutcome.SENT_HOME ?? 0} tone={s.visits.byOutcome.SENT_HOME ? 'warn' : 'neutral'} />
            <Tile label="Active medication plans" value={s.medication.activePlans} />
            <Tile label="Waiting for parent consent" value={s.medication.awaitingConsent} />
            <Tile label="Doses missed or refused" value={s.medication.missedOrRefusedInPeriod} tone={s.medication.missedOrRefusedInPeriod ? 'warn' : 'good'} />
            <Tile label="Controlled doses to countersign" value={s.medication.awaitingCountersign} tone={s.medication.awaitingCountersign ? 'bad' : 'good'} />
            <Tile label="Stock expired" value={s.stock.expired} tone={s.stock.expired ? 'bad' : 'good'} />
            <Tile label="Stock expiring in 30 days" value={s.stock.expiringSoon} tone={s.stock.expiringSoon ? 'warn' : 'good'} />
            <Tile label="Stock below reorder level" value={s.stock.low} tone={s.stock.low ? 'warn' : 'good'} />
            <Tile label="Care notes shared with teachers" value={s.careNotesShared} />
          </div>
          <SectionCard title="Visits by outcome" sub={`Last ${s.periodDays} days`}>
            <ul className="ops-list">{VISIT_OUTCOMES.map((o) => <li key={o.key} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{o.label}</div></div><strong>{s.visits.byOutcome[o.key] ?? 0}</strong></li>)}</ul>
          </SectionCard>
        </>
      )}</Loadable>
    </div>
  );
}

// ── the class teacher ───────────────────────────────────────────────────
function ClassCareNotes() {
  const state = useLoad(() => healthApi.classCareNotes(), []);
  return (
    <div className="ops-stack">
      <DataNote>Short notes for children in the class you are class teacher of, shared by their parents. If a parent withdraws consent the note disappears. Ask the school nurse about anything else.</DataNote>
      <Loadable state={state}>{(d) => !d.items.length ? <EmptyState icon="✚" title="No care notes" sub="No parent in your class has shared a care note." /> : (
        <SectionCard title="Care notes for your class">
          <ul className="ops-list health-notes">{d.items.map((n) => (
            <li key={n.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{n.studentName}{n.className ? ` · ${n.className}` : ''}</div><div className="ops-row-sub">{n.text}</div></div><StatusPill status={severityTone(n.severity)} label={humanize(n.severity)} /></li>
          ))}</ul>
        </SectionCard>
      )}</Loadable>
    </div>
  );
}

// ── parent ──────────────────────────────────────────────────────────────
function FamilyHealth() {
  const state = useLoad(() => healthApi.family(), []);
  const [consentFor, setConsentFor] = useState<MedicationPlanDto | null>(null);
  const [newPlan, setNewPlan] = useState<FamilyChildDto | null>(null);
  const [newNote, setNewNote] = useState<FamilyChildDto | null>(null);
  const { run, error } = useAction();
  return (
    <div className="ops-stack">
      <DataNote>Your own child&apos;s visits to the health room, medicines given at school and care notes. Only you and the school nurse see these; you choose whether a care note is shared with the class teacher.</DataNote>
      <ErrorNote error={error} />
      <Loadable state={state}>{(d) => !d.children.length ? <EmptyState icon="✚" title="No children linked" sub="Ask the school office to link your child to your account." /> : (
        <>{d.children.map((c) => (
          <SectionCard key={c.studentId} title={c.name ?? 'Your child'} sub={c.className ?? undefined} actions={<div className="ops-inline"><Button small variant="soft" onClick={() => setNewNote(c)}>Add a care note</Button><Button small onClick={() => setNewPlan(c)}>Ask the school to give a medicine</Button></div>}>
            <h3 className="sp-h">Visits to the health room</h3>
            {!c.visits.length ? <p className="ops-muted">No visits recorded.</p> : <ul className="ops-list">{c.visits.map((v) => <VisitRow key={v.id} v={v} showStudent={false} />)}</ul>}
            <h3 className="sp-h">Medicines at school</h3>
            {!c.plans.length ? <p className="ops-muted">No medication plans.</p> : <ul className="ops-list">{c.plans.map((p) => (
              <li key={p.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{p.medicine?.name} · {p.dose}</div><div className="ops-row-sub">At {p.times.join(', ')} · {fmtDate(p.startOn)} to {fmtDate(p.endOn)}{p.controlled ? ' · controlled (two staff check each dose)' : ''}{p.consent ? ` · consent by ${p.consent.byName}` : ''}</div></div>
                {p.status === 'AWAITING_CONSENT' ? <Button small onClick={() => setConsentFor(p)}>Give consent</Button> : <StatusPill status={p.status === 'ACTIVE' ? 'ACTIVE' : 'CLOSED'} label={humanize(p.status)} />}
                {['ACTIVE', 'AWAITING_CONSENT'].includes(p.status) && <Button small variant="soft" onClick={() => { const reason = window.prompt('Why should the school stop this medicine?'); if (reason) void run(async () => { await healthApi.stopPlan(p.id, reason); await state.reload(); }); }}>Stop</Button>}
              </li>
            ))}</ul>}
            <h3 className="sp-h">Medication log</h3>
            {!c.medicationLog.length ? <p className="ops-muted">No doses recorded yet.</p> : <ul className="ops-list">{c.medicationLog.slice(0, 20).map((x) => (
              <li key={x.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{x.medicine} · {fmtDate(x.date)} {x.slot}</div><div className="ops-row-sub">{x.by ? `By ${x.by}` : ''}{x.note ? ` · ${x.note}` : ''}</div></div><StatusPill status={doseTone(x.status)} label={humanize(x.status)} /></li>
            ))}</ul>}
            <h3 className="sp-h">Care notes</h3>
            {!c.careNotes.length ? <p className="ops-muted">No care notes.</p> : <ul className="ops-list">{c.careNotes.map((n) => (
              <li key={n.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{n.text}</div><div className="ops-row-sub">{n.shared ? 'Shared with the class teacher' : 'Not shared with the class teacher'}</div></div>
                <Button small variant="soft" onClick={() => void run(async () => { await healthApi.careNoteConsent(n.id, !n.shared); await state.reload(); })}>{n.shared ? 'Stop sharing' : 'Share with class teacher'}</Button>
              </li>
            ))}</ul>}
          </SectionCard>
        ))}</>
      )}</Loadable>
      {consentFor && <ConsentModal plan={consentFor} onClose={() => setConsentFor(null)} onDone={async () => { setConsentFor(null); await state.reload(); }} />}
      {newPlan && <PlanModal studentId={newPlan.studentId} studentName={newPlan.name} family onClose={() => setNewPlan(null)} onDone={async () => { setNewPlan(null); await state.reload(); }} />}
      {newNote && <CareNoteModal studentId={newNote.studentId} family onClose={() => setNewNote(null)} onDone={async () => { setNewNote(null); await state.reload(); }} />}
    </div>
  );
}

function ConsentModal({ plan, onClose, onDone }: { plan: MedicationPlanDto; onClose: () => void; onDone: () => Promise<void> }) {
  const [file, setFile] = useState<{ name: string; url: string } | null>(null);
  const [agree, setAgree] = useState(false);
  const { run, busy, error } = useAction();
  return (
    <Modal title="Consent to a medicine at school" onClose={onClose} footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy || !agree || (!plan.prescription && !file)} onClick={() => void run(async () => { await healthApi.consentPlan(plan.id, { consent: true, prescription: file }); await onDone(); })}>Give consent</Button></>}>
      <KeyValues rows={[['Medicine', plan.medicine?.name], ['Dose', plan.dose], ['Times', plan.times.join(', ')], ['From', fmtDate(plan.startOn)], ['To', fmtDate(plan.endOn)], ['Prescription', plan.prescription ? plan.prescription.name : 'Not uploaded yet']]} />
      {!plan.prescription && <AttachUpload label="Upload the prescription or doctor's note" accept=".pdf,.png,.jpg,.jpeg" onUploaded={(a) => setFile({ name: a.name, url: a.url })} />}
      <label className="ops-chip"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I consent to the school giving this medicine as prescribed.</label>
      <ErrorNote error={error} />
    </Modal>
  );
}

function PlanModal({ studentId, studentName, family, onClose, onDone }: { studentId: string; studentName: string | null; family?: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const [f, setF] = useState({ name: '', strength: '', dose: '', times: '13:00', startOn: inDays(0), endOn: inDays(7), instructions: '', controlled: false, agree: false });
  const [file, setFile] = useState<{ name: string; url: string } | null>(null);
  const { run, busy, error } = useAction();
  const ready = f.name && f.dose && f.times && (!family || (file && f.agree));
  return (
    <Modal wide title={`Medication plan${studentName ? ` for ${studentName}` : ''}`} onClose={onClose} footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy || !ready} onClick={() => void run(async () => {
      await healthApi.createPlan({ studentId, medicine: { name: f.name, strength: f.strength || null }, dose: f.dose, times: f.times.split(/[,\s]+/).filter(Boolean), startOn: f.startOn, endOn: f.endOn, instructions: f.instructions || null, controlled: f.controlled, prescription: file, consent: family ? f.agree : undefined });
      await onDone();
    })}>Save plan</Button></>}>
      {!family && <DataNote>The plan waits for a parent&apos;s consent and prescription before any dose can be given. The parents are told to open the Health page.</DataNote>}
      <div className="ops-form-grid">
        <Field label="Medicine" required><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Strength"><input className="input" value={f.strength} onChange={(e) => setF({ ...f, strength: e.target.value })} /></Field>
        <Field label="Dose" required><input className="input" value={f.dose} placeholder="e.g. 5 ml" onChange={(e) => setF({ ...f, dose: e.target.value })} /></Field>
        <Field label="Times (HH:MM, comma separated)" required><input className="input" value={f.times} onChange={(e) => setF({ ...f, times: e.target.value })} /></Field>
        <Field label="From" required><input className="input" type="date" value={f.startOn} onChange={(e) => setF({ ...f, startOn: e.target.value })} /></Field>
        <Field label="To" required><input className="input" type="date" value={f.endOn} onChange={(e) => setF({ ...f, endOn: e.target.value })} /></Field>
      </div>
      <Field label="Instructions"><input className="input" value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} style={{ width: '100%' }} /></Field>
      {!family && <label className="ops-chip"><input type="checkbox" checked={f.controlled} onChange={(e) => setF({ ...f, controlled: e.target.checked })} /> Controlled medicine (a second person countersigns every dose)</label>}
      <AttachUpload label={family ? 'Prescription or doctor\'s note (required)' : 'Prescription (optional; the parent can add it)'} accept=".pdf,.png,.jpg,.jpeg" onUploaded={(a) => setFile({ name: a.name, url: a.url })} />
      {family && <label className="ops-chip"><input type="checkbox" checked={f.agree} onChange={(e) => setF({ ...f, agree: e.target.checked })} /> I consent to the school giving this medicine as prescribed.</label>}
      <ErrorNote error={error} />
    </Modal>
  );
}

function CareNoteModal({ studentId, family, onClose, onDone }: { studentId: string; family?: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const [f, setF] = useState({ text: '', severity: 'IMPORTANT', share: true });
  const { run, busy, error } = useAction();
  return (
    <Modal title="Care note for the class teacher" onClose={onClose} footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.text.trim()} onClick={() => void run(async () => { await healthApi.createCareNote({ studentId, text: f.text, severity: f.severity, share: family ? f.share : undefined }); await onDone(); })}>Save</Button></>}>
      <DataNote>One short line a teacher needs to know, e.g. &quot;Severe nut allergy: EpiPen in the health room&quot;. {family ? 'You choose whether the class teacher sees it.' : 'The class teacher sees it only once a parent agrees to share it.'}</DataNote>
      <Field label="Note (at most 160 characters)" required><input className="input" maxLength={160} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} style={{ width: '100%' }} /></Field>
      <Field label="How important"><select className="input" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}><option value="SEVERE">Severe</option><option value="IMPORTANT">Important</option><option value="INFO">For information</option></select></Field>
      {family && <label className="ops-chip"><input type="checkbox" checked={f.share} onChange={(e) => setF({ ...f, share: e.target.checked })} /> Share with the class teacher</label>}
      <ErrorNote error={error} />
    </Modal>
  );
}

// ── the nurse ───────────────────────────────────────────────────────────
type NurseTab = 'today' | 'visits' | 'medication' | 'stock' | 'notes' | 'records' | 'settings';

function VisitRow({ v, showStudent = true, onLeft }: { v: HealthVisitDto; showStudent?: boolean; onLeft?: () => void }) {
  return (
    <li className="ops-row">
      <div className="ops-row-main">
        <div className="ops-row-title">{showStudent ? `${v.studentName ?? ''}${v.className ? ` · ${v.className}` : ''} · ` : ''}{v.complaint}</div>
        <div className="ops-row-sub">{fmtDate(v.arrivedAt)} {timeOf(v.arrivedAt)}–{v.leftAt ? timeOf(v.leftAt) : 'still here'}{v.action ? ` · ${v.action}` : ''}{v.vitals?.temperatureC ? ` · ${v.vitals.temperatureC} °C` : ''}{v.attendedBy ? ` · ${v.attendedBy}` : ''}{v.parentNotified ? ' · parents told' : ''}</div>
      </div>
      <StatusPill status={outcomeTone(v.outcome)} label={v.outcomeLabel} />
      {onLeft && !v.leftAt && <Button small variant="soft" onClick={onLeft}>Left now</Button>}
    </li>
  );
}

function StudentPicker({ value, onPick }: { value: { id: string; name: string } | null; onPick: (s: { id: string; name: string } | null) => void }) {
  const [q, setQ] = useState('');
  const found = useLoad(() => (q.trim().length >= 2 ? healthApi.students(q) : Promise.resolve({ items: [] })), [q]);
  if (value) return <div className="ops-inline"><strong>{value.name}</strong><Button small variant="soft" onClick={() => onPick(null)}>Change</Button></div>;
  return (
    <div>
      <input className="input" placeholder="Type a name or admission number" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%' }} aria-label="Find a student" />
      <ul className="ops-list">{(found.data?.items ?? []).map((s) => <li key={s.id} className="ops-row"><button type="button" className="ops-row-link" onClick={() => onPick({ id: s.id, name: s.name })}><div className="ops-row-title">{s.name}</div><div className="ops-row-sub">{s.className ?? s.admissionNo}</div></button></li>)}</ul>
    </div>
  );
}

function VisitModal({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const [student, setStudent] = useState<{ id: string; name: string } | null>(null);
  const [f, setF] = useState({ complaint: '', action: '', outcome: 'REST', injury: false, medicineGiven: false, notifyParent: false, temperatureC: '', pulse: '', spo2: '' });
  const { run, busy, error } = useAction();
  return (
    <Modal wide title="Record a visit" onClose={onClose} footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy || !student || !f.complaint.trim()} onClick={() => void run(async () => {
      await healthApi.recordVisit({ studentId: student!.id, complaint: f.complaint, action: f.action, outcome: f.outcome, injury: f.injury, medicineGiven: f.medicineGiven, notifyParent: f.notifyParent, vitals: { temperatureC: f.temperatureC || null, pulse: f.pulse || null, spo2: f.spo2 || null } });
      await onDone();
    })}>Record visit</Button></>}>
      <Field label="Student" required><StudentPicker value={student} onPick={setStudent} /></Field>
      <Field label="Complaint" required><input className="input" value={f.complaint} onChange={(e) => setF({ ...f, complaint: e.target.value })} style={{ width: '100%' }} /></Field>
      <div className="ops-form-grid">
        <Field label="Temperature (°C)"><input className="input" inputMode="decimal" value={f.temperatureC} onChange={(e) => setF({ ...f, temperatureC: e.target.value })} /></Field>
        <Field label="Pulse"><input className="input" inputMode="numeric" value={f.pulse} onChange={(e) => setF({ ...f, pulse: e.target.value })} /></Field>
        <Field label="SpO2 (%)"><input className="input" inputMode="numeric" value={f.spo2} onChange={(e) => setF({ ...f, spo2: e.target.value })} /></Field>
        <Field label="Outcome" required><select className="input" value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })}>{VISIT_OUTCOMES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></Field>
      </div>
      <Field label="What was done"><textarea className="input" rows={2} value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} style={{ width: '100%' }} /></Field>
      <div className="ops-inline">
        <label className="ops-chip"><input type="checkbox" checked={f.injury} onChange={(e) => setF({ ...f, injury: e.target.checked })} /> Injury</label>
        <label className="ops-chip"><input type="checkbox" checked={f.medicineGiven} onChange={(e) => setF({ ...f, medicineGiven: e.target.checked })} /> Medicine given</label>
        <label className="ops-chip"><input type="checkbox" checked={f.notifyParent} onChange={(e) => setF({ ...f, notifyParent: e.target.checked })} /> Tell the parents anyway</label>
      </div>
      <ErrorNote error={error} />
    </Modal>
  );
}

function DoseRow({ d, onRecord, onCountersign }: { d: DoseDueDto; onRecord: (status: string) => void; onCountersign: () => void }) {
  return (
    <li className="ops-row">
      <div className="ops-row-main">
        <div className="ops-row-title">{d.slot} · {d.studentName}{d.className ? ` (${d.className})` : ''}</div>
        <div className="ops-row-sub">{d.medicine} · {d.dose}{d.controlled ? ' · controlled' : ''}{d.by ? ` · by ${d.by}` : ''}</div>
      </div>
      <StatusPill status={doseTone(d.status)} label={d.awaitingCountersign ? 'Given, awaiting countersign' : humanize(d.status)} />
      {!d.doseId && <div className="ops-inline"><Button small onClick={() => onRecord('GIVEN')}>Given</Button><Button small variant="soft" onClick={() => onRecord('MISSED')}>Missed</Button><Button small variant="soft" onClick={() => onRecord('REFUSED')}>Refused</Button></div>}
      {d.awaitingCountersign && <Button small variant="soft" onClick={onCountersign}>Countersign</Button>}
    </li>
  );
}

function NurseDesk() {
  const [tab, setTab] = useState<NurseTab>('today');
  const today = useLoad(() => healthApi.today(), []);
  const [visitOpen, setVisitOpen] = useState(false);
  const { run, error } = useAction();
  const recordDose = (d: DoseDueDto, status: string) => void run(async () => { await healthApi.recordDose({ planId: d.planId, slot: d.slot, date: d.date, status }); await today.reload(); });
  const countersign = (d: DoseDueDto) => void run(async () => { if (d.doseId) await healthApi.countersign(d.doseId); await today.reload(); });
  return (
    <div className="ops-stack">
      <Tabs<NurseTab> value={tab} onChange={setTab} tabs={[
        { key: 'today', label: 'Today', count: today.data?.visits.length ?? null }, { key: 'visits', label: 'Visits' }, { key: 'medication', label: 'Medication' },
        { key: 'stock', label: 'Stock', count: today.data ? today.data.stock.expired + today.data.stock.expiringSoon : null }, { key: 'notes', label: 'Care notes' }, { key: 'records', label: 'Health cards' }, { key: 'settings', label: 'Settings' },
      ]} />
      <ErrorNote error={error} />
      {tab === 'today' && (
        <Loadable state={today}>{(t) => (
          <>
            <div className="kpi-grid">
              <Tile label="Visits today" value={t.visits.length} />
              <Tile label="Doses still to give" value={t.doses.filter((d) => d.status === 'DUE' || d.status === 'OVERDUE').length} tone={t.doses.some((d) => d.status === 'OVERDUE') ? 'bad' : 'neutral'} />
              <Tile label="To countersign" value={t.doses.filter((d) => d.awaitingCountersign).length} tone={t.doses.some((d) => d.awaitingCountersign) ? 'warn' : 'good'} />
              <Tile label="Stock expired or expiring" value={t.stock.expired + t.stock.expiringSoon} tone={t.stock.expired ? 'bad' : t.stock.expiringSoon ? 'warn' : 'good'} />
            </div>
            <SectionCard title="Visits today" actions={<Button small onClick={() => setVisitOpen(true)}>+ Record a visit</Button>}>
              {!t.visits.length ? <p className="ops-muted">No visits yet today.</p> : <ul className="ops-list">{t.visits.map((v) => <VisitRow key={v.id} v={v} onLeft={() => void run(async () => { await healthApi.updateVisit(v.id, { leftAt: new Date().toISOString() }); await today.reload(); })} />)}</ul>}
            </SectionCard>
            <SectionCard title="Doses due today" sub="From plans the parents consented to">
              {!t.doses.length ? <p className="ops-muted">No doses due today.</p> : <ul className="ops-list">{t.doses.map((d) => <DoseRow key={`${d.planId}-${d.slot}`} d={d} onRecord={(s) => recordDose(d, s)} onCountersign={() => countersign(d)} />)}</ul>}
            </SectionCard>
          </>
        )}</Loadable>
      )}
      {tab === 'visits' && <VisitsTab onNew={() => setVisitOpen(true)} />}
      {tab === 'medication' && <MedicationTab />}
      {tab === 'stock' && <StockTab />}
      {tab === 'notes' && <NotesTab />}
      {tab === 'records' && <RecordsTab />}
      {tab === 'settings' && <SettingsTab />}
      {visitOpen && <VisitModal onClose={() => setVisitOpen(false)} onDone={async () => { setVisitOpen(false); await today.reload(); }} />}
    </div>
  );
}

function VisitsTab({ onNew }: { onNew: () => void }) {
  const [from, setFrom] = useState(inDays(-7));
  const state = useLoad(() => healthApi.visits({ from }), [from]);
  return (
    <SectionCard title="Visits" actions={<div className="ops-inline"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" /><Button small onClick={onNew}>+ Record a visit</Button></div>}>
      <Loadable state={state}>{(d) => !d.items.length ? <p className="ops-muted">No visits since {fmtDate(from)}.</p> : <ul className="ops-list">{d.items.map((v) => <VisitRow key={v.id} v={v} />)}</ul>}</Loadable>
    </SectionCard>
  );
}

function MedicationTab() {
  const plans = useLoad(() => healthApi.plans({}), []);
  const [student, setStudent] = useState<{ id: string; name: string } | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <div className="ops-stack">
      <SectionCard title="Medication plans" actions={<Button small onClick={() => setOpen(true)}>+ New plan</Button>}>
        <Loadable state={plans}>{(d) => !d.items.length ? <p className="ops-muted">No plans.</p> : <ul className="ops-list">{d.items.map((p) => (
          <li key={p.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{p.studentName} · {p.medicine?.name} {p.medicine?.strength ?? ''} · {p.dose}</div><div className="ops-row-sub">{p.refNo} · at {p.times.join(', ')} · {fmtDate(p.startOn)} to {fmtDate(p.endOn)}{p.controlled ? ' · controlled' : ''}{p.consent ? ` · consent ${p.consent.byName}` : ''}{p.prescription ? ' · prescription on file' : ''}</div></div><StatusPill status={p.status === 'ACTIVE' ? 'ACTIVE' : p.status === 'AWAITING_CONSENT' ? 'PENDING' : 'CLOSED'} label={humanize(p.status)} /></li>
        ))}</ul>}</Loadable>
      </SectionCard>
      {open && (student ? <PlanModal studentId={student.id} studentName={student.name} onClose={() => { setOpen(false); setStudent(null); }} onDone={async () => { setOpen(false); setStudent(null); await plans.reload(); }} />
        : <Modal title="Plan for which student?" onClose={() => setOpen(false)}><StudentPicker value={null} onPick={setStudent} /></Modal>)}
    </div>
  );
}

function StockTab() {
  const state = useLoad(() => healthApi.stock(), []);
  const [f, setF] = useState({ name: '', kind: 'FIRST_AID', quantity: '', unit: 'units', expiresOn: '', reorderLevel: '' });
  const { run, busy, error } = useAction();
  const tone = (s: StockDto) => (s.expired ? 'OVERDUE' : s.expiringSoon || s.low ? 'PENDING' : 'COMPLETED');
  return (
    <div className="ops-stack">
      <SectionCard title="First-aid and medicine stock" sub="An expiry date becomes a reminder in Tasks.">
        <Loadable state={state}>{(d) => !d.items.length ? <p className="ops-muted">No stock recorded.</p> : <ul className="ops-list">{d.items.map((s) => (
          <li key={s.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{s.name}{s.batchNo ? ` (batch ${s.batchNo})` : ''}</div><div className="ops-row-sub">{s.quantity} {s.unit} · {humanize(s.kind)}{s.expiresOn ? ` · expires ${fmtDate(s.expiresOn)}` : ''}</div></div>
            <StatusPill status={tone(s)} label={s.expired ? 'Expired' : s.expiringSoon ? `Expires in ${s.daysToExpiry} days` : s.low ? 'Low' : 'OK'} />
            <Button small variant="soft" onClick={() => { const q = window.prompt('New quantity', String(s.quantity)); if (q !== null) void run(async () => { await healthApi.updateStock(s.id, { quantity: Number(q) }); await state.reload(); }); }}>Update</Button>
            <Button small variant="soft" onClick={() => void run(async () => { await healthApi.updateStock(s.id, { active: false, note: 'Removed' }); await state.reload(); })}>Remove</Button>
          </li>
        ))}</ul>}</Loadable>
      </SectionCard>
      <SectionCard title="Add stock">
        <div className="ops-form-grid">
          <Field label="Item" required><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Kind"><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="FIRST_AID">First aid</option><option value="MEDICINE">Medicine</option><option value="EQUIPMENT">Equipment</option></select></Field>
          <Field label="Quantity"><input className="input" inputMode="numeric" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
          <Field label="Unit"><input className="input" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
          <Field label="Reorder at"><input className="input" inputMode="numeric" value={f.reorderLevel} onChange={(e) => setF({ ...f, reorderLevel: e.target.value })} /></Field>
          <Field label="Expires on"><input className="input" type="date" value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })} /></Field>
        </div>
        <Button disabled={busy || !f.name.trim()} onClick={() => void run(async () => { await healthApi.addStock({ ...f, quantity: Number(f.quantity || 0), reorderLevel: Number(f.reorderLevel || 0), expiresOn: f.expiresOn || null }); setF({ name: '', kind: 'FIRST_AID', quantity: '', unit: 'units', expiresOn: '', reorderLevel: '' }); await state.reload(); })}>Add</Button>
        <ErrorNote error={error} />
      </SectionCard>
    </div>
  );
}

function NotesTab() {
  const state = useLoad(() => healthApi.careNotes({}), []);
  const [student, setStudent] = useState<{ id: string; name: string } | null>(null);
  const [open, setOpen] = useState(false);
  const { run, error } = useAction();
  return (
    <SectionCard title="Care notes" sub="A class teacher sees a note only while the parent's consent to share it stands." actions={<Button small onClick={() => setOpen(true)}>+ Draft a note</Button>}>
      <ErrorNote error={error} />
      <Loadable state={state}>{(d) => !d.items.length ? <p className="ops-muted">No care notes.</p> : <ul className="ops-list">{d.items.map((n: CareNoteDto) => (
        <li key={n.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{n.studentName} · {n.text}</div><div className="ops-row-sub">{n.shared ? `Shared (consent by ${n.consent?.byName ?? 'parent'})` : 'Waiting for the parent to agree to share'}</div></div>
          <StatusPill status={severityTone(n.severity)} label={humanize(n.severity)} />
          <Button small variant="soft" onClick={() => void run(async () => { await healthApi.retireCareNote(n.id); await state.reload(); })}>Remove</Button>
        </li>
      ))}</ul>}</Loadable>
      {open && (student ? <CareNoteModal studentId={student.id} onClose={() => { setOpen(false); setStudent(null); }} onDone={async () => { setOpen(false); setStudent(null); await state.reload(); }} />
        : <Modal title="Care note for which student?" onClose={() => setOpen(false)}><StudentPicker value={null} onPick={setStudent} /></Modal>)}
    </SectionCard>
  );
}

function RecordsTab() {
  const [student, setStudent] = useState<{ id: string; name: string } | null>(null);
  const card = useLoad(() => (student ? healthApi.card(student.id) : Promise.resolve(null)), [student?.id]);
  const [kind, setKind] = useState<'SCREENING' | 'IMMUNISATION'>('SCREENING');
  const [f, setF] = useState<Record<string, string>>({ on: inDays(0) });
  const { run, busy, error } = useAction();
  return (
    <div className="ops-stack">
      <SectionCard title="Health card" sub="Screenings (height, weight, vision, dental) and immunisations, year by year.">
        <StudentPicker value={student} onPick={setStudent} />
        {student && <Loadable state={card}>{(c) => c && (
          <div className="health-card">
            <KeyValues rows={[['Student', `${c.student.name} (${c.student.admissionNo})`], ['Class', c.student.className], ['Year', c.academicYear], ['Blood group', c.bloodGroup], ['Allergies', c.allergies.length ? c.allergies.join(', ') : 'None recorded'], ['Visits this year', c.visitsThisYear]]} />
            <h3 className="sp-h">Latest screening</h3>
            {c.latestScreening ? <KeyValues rows={[['Date', fmtDate(String(c.latestScreening.on))], ['Height', c.latestScreening.heightCm ? `${c.latestScreening.heightCm} cm` : '—'], ['Weight', c.latestScreening.weightKg ? `${c.latestScreening.weightKg} kg` : '—'], ['BMI', c.latestScreening.bmi ?? '—'], ['Vision (L / R)', `${c.latestScreening.visionLeft ?? '—'} / ${c.latestScreening.visionRight ?? '—'}`], ['Dental', c.latestScreening.dental ?? '—'], ['Hearing', c.latestScreening.hearing ?? '—']]} /> : <p className="ops-muted">No screening this year.</p>}
            <h3 className="sp-h">Immunisations</h3>
            {!c.immunisations.length ? <p className="ops-muted">None recorded.</p> : <ul className="ops-list">{c.immunisations.map((i, n) => <li key={n} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{i.vaccine}{i.doseNo ? ` · dose ${i.doseNo}` : ''}</div><div className="ops-row-sub">{fmtDate(String(i.on))}{i.givenAt ? ` · ${i.givenAt}` : ''}</div></div></li>)}</ul>}
            <Button small variant="soft" onClick={() => window.print()}>Print card</Button>
          </div>
        )}</Loadable>}
      </SectionCard>
      {student && (
        <SectionCard title={`Add a record for ${student.name}`}>
          <div className="ops-inline"><Button small variant={kind === 'SCREENING' ? 'accent' : 'soft'} onClick={() => setKind('SCREENING')}>Screening</Button><Button small variant={kind === 'IMMUNISATION' ? 'accent' : 'soft'} onClick={() => setKind('IMMUNISATION')}>Immunisation</Button></div>
          <div className="ops-form-grid">
            <Field label="Date"><input className="input" type="date" value={f.on ?? ''} onChange={(e) => setF({ ...f, on: e.target.value })} /></Field>
            {(kind === 'SCREENING' ? [['heightCm', 'Height (cm)'], ['weightKg', 'Weight (kg)'], ['visionLeft', 'Vision left'], ['visionRight', 'Vision right'], ['dental', 'Dental'], ['hearing', 'Hearing']] : [['vaccine', 'Vaccine'], ['doseNo', 'Dose number'], ['givenAt', 'Given at'], ['nextDueOn', 'Next due (YYYY-MM-DD)']]).map(([k, label]) => (
              <Field key={k} label={label}><input className="input" value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
            ))}
          </div>
          <Button disabled={busy} onClick={() => void run(async () => { await healthApi.addEntry({ ...f, kind, studentId: student.id }); setF({ on: inDays(0) }); await card.reload(); })}>Save</Button>
          <ErrorNote error={error} />
        </SectionCard>
      )}
    </div>
  );
}

function SettingsTab() {
  const state = useLoad(() => healthApi.settings(), []);
  const { run, busy, error } = useAction();
  return (
    <SectionCard title="Who is told, and when" sub="Parents get a message that there is an update (never the details) for the outcomes ticked here. You can always choose to tell them on a visit.">
      <Loadable state={state}>{(s) => (
        <>
          <div className="ops-inline">{NOTIFY_TRIGGERS.map((t) => (
            <label key={t.key} className="ops-chip"><input type="checkbox" checked={s.notifyOn.includes(t.key)} disabled={busy} onChange={(e) => void run(async () => { const next = e.target.checked ? [...s.notifyOn, t.key] : s.notifyOn.filter((x) => x !== t.key); state.setData(await healthApi.saveSettings({ notifyOn: next })); })} /> {t.label}</label>
          ))}</div>
          <p className="ops-muted">Stock reminders start {s.expiryLeadDays} days before expiry.</p>
        </>
      )}</Loadable>
      <ErrorNote error={error} />
    </SectionCard>
  );
}
