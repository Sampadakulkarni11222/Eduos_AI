'use client';
import { useState } from 'react';
import { Button, EmptyState, Field, Modal, useToast } from '@/components/ui';
import { usePermissions } from '@/lib/permissions';
import { staffApi, type CoverLesson, type StaffLeave } from '@/lib/staff-api';
import {
  DataNote, ErrorNote, Loadable, PromptModal, SectionCard, StatusPill, Tabs, Tile, fmtDate, humanize, isoDay, useAction, useLoad,
} from './kit';

/**
 * Staff leave (apply, balance; HR and the principal approve and set policies)
 * and substitute cover (today's absences, affected periods, proposals, confirm).
 */

function ApplyModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const policies = useLoad(() => staffApi.policies(), []);
  const [f, setF] = useState({ code: 'CL', fromDate: isoDay(new Date(Date.now() + 86_400_000)), toDate: '', halfDay: '', reason: '' });
  const { run, busy, error } = useAction();
  return (
    <Modal title="Apply for leave" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.reason.trim()} onClick={() => void run(async () => {
      await staffApi.apply({ code: f.code, fromDate: f.fromDate, toDate: f.halfDay ? f.fromDate : (f.toDate || f.fromDate), halfDay: f.halfDay || null, reason: f.reason });
      onDone();
    })}>Apply</Button></>}>
      <Loadable state={policies}>{(list) => {
        const p = list.find((x) => x.code === f.code);
        return (
          <>
            <Field label="Type"><select className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value, halfDay: '' })}>{list.filter((x) => x.active).map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></Field>
            {p?.note && <p className="ops-muted">{p.note}</p>}
            <div className="ops-grid-2">
              <Field label="From"><input className="input" type="date" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value })} /></Field>
              {!f.halfDay && <Field label="To"><input className="input" type="date" value={f.toDate || f.fromDate} min={f.fromDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} /></Field>}
              {p?.allowHalfDay && <Field label="Half day"><select className="input" value={f.halfDay} onChange={(e) => setF({ ...f, halfDay: e.target.value })}><option value="">Full day(s)</option><option value="FIRST_HALF">First half</option><option value="SECOND_HALF">Second half</option></select></Field>}
            </div>
          </>
        );
      }}</Loadable>
      <Field label="Reason" required><textarea className="input" rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      <DataNote>Sundays and school holidays are not counted. Your balance changes only when the leave is approved.</DataNote>
      <ErrorNote error={error} />
    </Modal>
  );
}

function LeaveRow({ l, manager, onChanged }: { l: StaffLeave; manager: boolean; onChanged: () => void }) {
  const [prompt, setPrompt] = useState<null | 'reject' | 'cancel'>(null);
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <li className="ops-row">
      <div className="ops-row-main"><div className="ops-row-title">{manager ? `${l.name} · ` : ''}{l.code} · {l.days} day(s)</div><div className="ops-row-sub">{fmtDate(l.fromDate)}{l.toDate !== l.fromDate ? ` – ${fmtDate(l.toDate)}` : ''}{l.halfDay ? ` (${humanize(l.halfDay)})` : ''} · {l.reason}{l.decisionNote ? ` · ${l.decisionNote}` : ''}</div></div>
      <StatusPill status={l.status} />
      {manager && l.status === 'PENDING' && <><Button small disabled={busy} onClick={() => void run(async () => { await staffApi.decide(l.id, 'APPROVE'); toast('Approved; the balance is deducted', 'success'); onChanged(); })}>Approve</Button><Button small variant="ghost" onClick={() => setPrompt('reject')}>Reject</Button></>}
      {['PENDING', 'APPROVED'].includes(l.status) && <Button small variant="ghost" onClick={() => setPrompt('cancel')}>{l.status === 'PENDING' ? 'Withdraw' : 'Cancel'}</Button>}
      <ErrorNote error={error} />
      {prompt === 'reject' && <PromptModal title="Reject leave" label="Reason" danger confirmLabel="Reject" onClose={() => setPrompt(null)} onSubmit={async (v) => { await staffApi.decide(l.id, 'REJECT', v); onChanged(); }} />}
      {prompt === 'cancel' && <PromptModal title="Cancel leave" label="Reason (an approved leave's days are restored)" confirmLabel="Cancel leave" onClose={() => setPrompt(null)} onSubmit={async (v) => { await staffApi.cancel(l.id, v); onChanged(); }} />}
    </li>
  );
}

function Policies() {
  const list = useLoad(() => staffApi.policies(), []);
  const { run, error } = useAction();
  const toast = useToast();
  return (
    <SectionCard title="Leave policies" sub="Yearly entitlement and carry-forward per leave type (April–March leave year).">
      <Loadable state={list}>{(rows) => (
        <table className="ops-table"><thead><tr><th>Type</th><th>Days a year</th><th>Carry forward (max)</th><th>Half days</th><th>Paid</th></tr></thead><tbody>
          {rows.map((p) => <tr key={p.code}><td>{p.name}</td>
            <td>{p.tracksBalance ? <input className="input staff-num" type="number" min={0} defaultValue={p.yearlyDays} aria-label={`${p.name} days`} onBlur={(e) => Number(e.target.value) !== p.yearlyDays && void run(async () => { await staffApi.setPolicy(p.code, { yearlyDays: Number(e.target.value) }); toast('Saved', 'success'); })} /> : 'No balance'}</td>
            <td>{p.tracksBalance ? <input className="input staff-num" type="number" min={0} defaultValue={p.carryForwardMax} aria-label={`${p.name} carry forward`} onBlur={(e) => Number(e.target.value) !== p.carryForwardMax && void run(async () => { await staffApi.setPolicy(p.code, { carryForwardMax: Number(e.target.value) }); toast('Saved', 'success'); })} /> : '—'}</td>
            <td>{p.allowHalfDay ? 'Yes' : 'No'}</td><td>{p.paid ? 'Yes' : 'No (LOP)'}</td></tr>)}
        </tbody></table>
      )}</Loadable>
      <div className="ops-inline"><Button variant="soft" onClick={() => void run(async () => { const r = await staffApi.initBalances(); toast(`${r.leaveYear}: ${r.created} balance(s) set up for ${r.people} people`, 'success'); })}>Set up this year&apos;s balances</Button></div>
      <ErrorNote error={error} />
    </SectionCard>
  );
}

function LopExport() {
  const now = new Date();
  const [range, setRange] = useState({ from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)) });
  const data = useLoad(() => staffApi.lop(range.from, range.to), [range.from, range.to]);
  return (
    <SectionCard title="Loss of pay for payroll" sub="Approved leave without pay and absences marked as loss of pay. Payroll uses these as LOP days.">
      <div className="ops-inline"><input className="input" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label="From" /><input className="input" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label="To" /></div>
      <Loadable state={data}>{(d) => !d.inputs.length ? <p className="ops-muted">No loss-of-pay days in this period.</p> : (
        <ul className="ops-list">{d.inputs.map((r) => <li key={r.profileId} className="ops-row"><div className="ops-row-main">{r.name}<div className="ops-row-sub">{r.sources.join(', ')}</div></div><b>{r.lopDays} day(s)</b></li>)}</ul>
      )}</Loadable>
      <DataNote>In Payroll, open the run and enter these LOP days (the API accepts them as PUT /payroll/runs/:id/inputs).</DataNote>
    </SectionCard>
  );
}

function MyCovers() {
  const covers = useLoad(() => staffApi.myCovers().catch(() => []), []);
  if (!covers.data?.length) return null;
  return (
    <SectionCard title="Lessons I am covering" sub="You can mark the register for these periods.">
      <ul className="ops-list">{covers.data.map((c) => <li key={c.id} className="ops-row"><div className="ops-row-main">{fmtDate(c.date)} · P{c.periodNo} {c.startTime}–{c.endTime} · {c.className}<div className="ops-row-sub">In place of {c.absentName}{c.room ? ` · ${c.room}` : ''}</div></div></li>)}</ul>
    </SectionCard>
  );
}

export function StaffLeaveView() {
  const { permissions } = usePermissions();
  const manager = permissions['staffleave.manage'] === 'ALL';
  const [tab, setTab] = useState<'mine' | 'approve' | 'policies'>('mine');
  const [applying, setApplying] = useState(false);
  const balance = useLoad(() => staffApi.balance({}), []);
  const leaves = useLoad(() => staffApi.leaves(tab === 'approve' ? { view: 'all' } : { view: 'mine' }), [tab]);
  const reload = () => { void balance.reload(); void leaves.reload(); };
  return (
    <div className="ops-stack">
      <Loadable state={balance}>{(b) => (
        <div className="kpi-grid">{b.balances.filter((x) => x.tracksBalance).map((x) => <Tile key={x.code} label={`${x.name} (${b.leaveYear})`} value={x.set ? `${x.available} left` : 'Not set up'} tone={x.set && (x.available ?? 0) <= 1 ? 'warn' : 'neutral'} />)}</div>
      )}</Loadable>
      <div className="ops-inline">
        <Tabs tabs={[{ key: 'mine', label: 'My leave' }, ...(manager ? [{ key: 'approve' as const, label: 'All staff' }, { key: 'policies' as const, label: 'Policies & LOP' }] : [])]} value={tab} onChange={setTab} />
        <Button onClick={() => setApplying(true)}>Apply for leave</Button>
      </div>
      {tab === 'policies' ? <><Policies /><LopExport /></> : (
        <Loadable state={leaves}>{(rows) => !rows.length ? <EmptyState title="No leave applications" sub={tab === 'mine' ? 'Apply for casual, sick, earned or other leave.' : 'Applications from staff appear here.'} /> : (
          <ul className="ops-list card card-pad">{rows.map((l) => <LeaveRow key={l.id} l={l} manager={tab === 'approve'} onChanged={reload} />)}</ul>
        )}</Loadable>
      )}
      {tab === 'mine' && <MyCovers />}
      {applying && <ApplyModal onClose={() => setApplying(false)} onDone={() => { setApplying(false); reload(); }} />}
    </div>
  );
}

// ── cover ──────────────────────────────────────────────────────────────

function ProposeModal({ date, lesson, onClose, onDone }: { date: string; lesson: CoverLesson; onClose: () => void; onDone: () => void }) {
  const data = useLoad(() => staffApi.candidates(date, lesson.sectionId, lesson.periodNo), [date, lesson.sectionId, lesson.periodNo]);
  const [override, setOverride] = useState('');
  const { run, busy, error } = useAction();
  return (
    <Modal title={`Cover ${lesson.className} · period ${lesson.periodNo}`} wide onClose={onClose} footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <p className="ops-muted">{lesson.subject} · {lesson.startTime}–{lesson.endTime}{lesson.room ? ` · ${lesson.room}` : ''}</p>
      <Loadable state={data}>{(d) => (
        <>
          <ul className="ops-list">{d.candidates.map((c) => (
            <li key={c.profileId} className="ops-row">
              <div className="ops-row-main"><div className="ops-row-title">{c.name}{c.sameSubject ? ' · same subject' : ''}{c.sameClass ? ' · teaches this class' : ''}</div>
                <div className="ops-row-sub">{c.lessonsToday} lesson(s) today · {c.coversToday} cover(s) today · {c.coversThisWeek} this week{c.blocked.length ? ` · ${c.blocked.join('; ')}` : ''}{c.overLimit ? ' · at the cover limit' : ''}</div></div>
              <StatusPill status={c.eligible ? 'ACTIVE' : c.blocked.length ? 'BLOCKED' : 'PENDING'} label={c.eligible ? 'Free' : c.blocked.length ? 'Not available' : 'Over limit'} />
              {!c.blocked.length && <Button small disabled={busy || (c.overLimit && !override.trim())} onClick={() => void run(async () => { await staffApi.assign({ date, sectionId: lesson.sectionId, periodNo: lesson.periodNo, substituteProfileId: c.profileId, overrideReason: c.overLimit ? override : undefined }); onDone(); })}>Confirm</Button>}
            </li>
          ))}</ul>
          {d.candidates.some((c) => c.overLimit && !c.blocked.length) && <Field label="Reason to go over the cover limit" hint={`Limits: ${d.rules.maxPerDay} a day, ${d.rules.maxPerWeek} a week.`}><input className="input" value={override} onChange={(e) => setOverride(e.target.value)} /></Field>}
        </>
      )}</Loadable>
      <ErrorNote error={error} />
    </Modal>
  );
}

function MarkAbsentModal({ date, onClose, onDone }: { date: string; onClose: () => void; onDone: () => void }) {
  const staff = useLoad(() => staffApi.allBalances({}).then((b) => b.people), []);
  const [f, setF] = useState({ profileId: '', halfDay: '', reason: '', lop: false });
  const { run, busy, error } = useAction();
  return (
    <Modal title={`Mark absent on ${fmtDate(date)}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.profileId} onClick={() => void run(async () => { await staffApi.markAbsent({ profileId: f.profileId, date, halfDay: f.halfDay || null, reason: f.reason || undefined, lop: f.lop }); onDone(); })}>Mark absent</Button></>}>
      <Loadable state={staff}>{(people) => <Field label="Member of staff" required hint={people.length ? undefined : 'Set up leave balances first so staff are listed.'}><select className="input" value={f.profileId} onChange={(e) => setF({ ...f, profileId: e.target.value })}><option value="">Choose…</option>{people.map((p) => <option key={p.profileId} value={p.profileId}>{p.name}</option>)}</select></Field>}</Loadable>
      <Field label="Part of the day"><select className="input" value={f.halfDay} onChange={(e) => setF({ ...f, halfDay: e.target.value })}><option value="">Whole day</option><option value="FIRST_HALF">First half</option><option value="SECOND_HALF">Second half</option></select></Field>
      <Field label="Reason"><input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      <label className="ops-chip"><input type="checkbox" checked={f.lop} onChange={(e) => setF({ ...f, lop: e.target.checked })} />Count as loss of pay</label>
      <ErrorNote error={error} />
    </Modal>
  );
}

export function CoverView() {
  const [date, setDate] = useState(isoDay());
  const needs = useLoad(() => staffApi.needs(date), [date]);
  const [propose, setPropose] = useState<CoverLesson | null>(null);
  const [absentModal, setAbsentModal] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const toast = useToast();
  return (
    <div className="ops-stack">
      <div className="ops-inline">
        <Field label="Day"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Button variant="soft" onClick={() => setAbsentModal(true)}>Mark someone absent</Button>
      </div>
      <Loadable state={needs}>{(n) => (
        <>
          <div className="kpi-grid">
            <Tile label="Teachers away" value={n.totals.absentTeachers} />
            <Tile label="Lessons affected" value={n.totals.periods} />
            <Tile label="Still uncovered" value={n.totals.uncovered} tone={n.totals.uncovered ? 'bad' : 'good'} />
          </div>
          {!n.absent.length ? <EmptyState title="No cover needed" sub="Approved leave and absences marked for this day appear here with the lessons they affect." /> : n.absent.map((a) => (
            <SectionCard key={a.profileId} title={a.name ?? 'Teacher'} sub={`${a.source === 'LEAVE' ? `On leave (${a.code}${a.ref ? `, ${a.ref}` : ''})` : `Absent${a.reason ? `: ${a.reason}` : ''}`}${a.half ? ` · ${humanize(a.half)}` : ''}`}>
              <ul className="ops-list">{a.periods.map((p) => (
                <li key={`${p.sectionId}:${p.periodNo}`} className="ops-row">
                  <div className="ptm-time">P{p.periodNo}<div className="ops-row-sub">{p.startTime}–{p.endTime}</div></div>
                  <div className="ops-row-main"><div className="ops-row-title">{p.className} · {p.subject}</div><div className="ops-row-sub">{p.room ?? 'Room not set'}{p.cover ? ` · substitute: ${p.cover.substituteName}` : ''}</div></div>
                  {p.cover ? <><StatusPill status="CONFIRMED" label={`Covered by ${p.cover.substituteName}`} /><Button small variant="ghost" onClick={() => setCancelling(p.cover!.id)}>Cancel</Button></> : <Button small onClick={() => setPropose(p)}>Find a substitute</Button>}
                </li>
              ))}</ul>
            </SectionCard>
          ))}
          <DataNote>Proposals list teachers who are in school and free in that period (no lesson of their own, no other cover), within the cover limits of {n.rules.maxPerDay} a day and {n.rules.maxPerWeek} a week; same subject first. Confirming tells the absent teacher, the substitute and the class once, and lets the substitute mark that period&apos;s register.</DataNote>
        </>
      )}</Loadable>
      {propose && <ProposeModal date={date} lesson={propose} onClose={() => setPropose(null)} onDone={() => { setPropose(null); toast('Cover confirmed; everyone told', 'success'); void needs.reload(); }} />}
      {absentModal && <MarkAbsentModal date={date} onClose={() => setAbsentModal(false)} onDone={() => { setAbsentModal(false); void needs.reload(); }} />}
      {cancelling && <PromptModal title="Cancel this cover" label="Reason" danger confirmLabel="Cancel cover" onClose={() => setCancelling(null)} onSubmit={async (v) => { await staffApi.cancelCover(cancelling, v); await needs.reload(); }} />}
    </div>
  );
}
