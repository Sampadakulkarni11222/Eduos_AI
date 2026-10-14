'use client';
import { useState } from 'react';
import { Button, EmptyState, Field, Modal, useToast } from '@/components/ui';
import { usePermissions } from '@/lib/permissions';
import { usePortalHref } from '@/lib/school-path';
import { opsApi } from '@/lib/ops-api';
import { ptmApi, type Briefing, type PtmBooking, type PtmRound, type PtmSlot } from '@/lib/ptm-api';
import { Drawer } from './drawer';
import {
  DataNote, ErrorNote, KeyValues, Loadable, PromptModal, SectionCard, StatusPill, Tabs, Tile, Timeline, fmtDate, fmtDateTime, humanize, isoDay, money, useAction, useLoad, useQueryParam,
} from './kit';

/**
 * PTM: principal and administration set up rounds; teachers give availability,
 * see their meeting sheet with a child briefing and record outcomes; families
 * book each child with each teacher, join a waiting list, move or cancel.
 */

const BOOKING_PILL: Record<string, string> = { BOOKED: 'SCHEDULED', CHECKED_IN: 'LIVE', COMPLETED: 'COMPLETED', NO_SHOW: 'FAILED', CANCELLED: 'CANCELLED', RESCHEDULED: 'CLOSED' };

// ── shared: the child briefing ─────────────────────────────────────────

export function BriefingPanel({ b }: { b: Briefing }) {
  const link = usePortalHref();
  return (
    <div className="ops-stack ptm-briefing">
      <KeyValues rows={[
        ['Child', `${b.student.name}${b.student.className ? ` · ${b.student.className}` : ''}`],
        ['Attendance', b.attendance?.pctExact === null || !b.attendance ? 'No register marks yet' : `${b.attendance.pctExact}% of ${b.attendance.workingDays} days (${b.attendance.ABSENT} absent, ${b.attendance.LATE} late)`],
        ['Homework', b.homework?.completionPct === null || !b.homework ? 'None due in the last 60 days' : `${b.homework.submitted} of ${b.homework.due} submitted (${b.homework.completionPct}%), ${b.homework.late} late`],
        ...(b.feesShown ? [['Fees', b.fees && b.fees.outstandingPaise > 0 ? `${money(b.fees.outstandingPaise)} outstanding · ${b.fees.overdueInvoices} overdue` : 'Nothing outstanding'] as [string, string]] : []),
      ]} />
      <SectionCard title="Recent published marks">
        {b.recentMarks.length ? (
          <table className="ops-table"><thead><tr><th>Exam</th><th>Subject</th><th>Marks</th></tr></thead><tbody>
            {b.recentMarks.map((m, i) => <tr key={i}><td>{m.exam ?? '—'}</td><td>{m.subject ?? '—'}</td><td>{m.absence ?? (m.marks === null ? '—' : `${m.marks}/${m.maxMarks} (${m.percentage}%)`)}</td></tr>)}
          </tbody></table>
        ) : <p className="ops-muted">No published marks yet.</p>}
      </SectionCard>
      <SectionCard title="Syllabus progress">
        <ul className="ops-list">{b.syllabus.map((s) => <li key={s.subject} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{s.subject}</div><div className="ops-row-sub">{s.currentModule ?? 'No module under way'}{s.coveragePct !== null ? ` · ${s.coveragePct}% of topics done` : ''}</div></div><StatusPill status={s.health === 'ON_TRACK' || s.health === 'COMPLETED' ? 'ACTIVE' : s.health === 'NO_PLAN' ? 'DRAFT' : 'OVERDUE'} label={humanize(s.health)} /></li>)}</ul>
      </SectionCard>
      {b.coCurricular.length > 0 && <SectionCard title="Co-curricular"><ul className="ops-list">{b.coCurricular.map((c, i) => <li key={i} className="ops-row"><div className="ops-row-main">{c.name}<div className="ops-row-sub">{humanize(c.category)} · {humanize(c.level)}{c.achievement ? ` · ${c.achievement}` : ''}</div></div></li>)}</ul></SectionCard>}
      {b.previousMeetings && b.previousMeetings.length > 0 && <SectionCard title="Earlier meetings">{b.previousMeetings.map((p, i) => <p key={i}><b>{p.when}</b> with {p.teacherName}: {p.summary}{p.openActions ? ` (${p.openActions} action(s) open)` : ''}</p>)}</SectionCard>}
      <p className="ops-callout is-warn">{b.safeguardingNote ?? 'Safeguarding concerns are not written here.'} <a href={link('/safeguarding')}>Report a safeguarding concern</a></p>
      <DataNote>Figures are what the records say on {fmtDateTime(b.asOf)}.{b.feesShown ? '' : ' Fees are not shown to you.'}</DataNote>
    </div>
  );
}

// ── principal / administration: rounds ────────────────────────────────

function RoundForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const sections = useLoad(() => opsApi.lectureOptions().then((o) => o.sections), []);
  const next = new Date(Date.now() + 7 * 86_400_000);
  const [f, setF] = useState({ title: '', startsOn: isoDay(next), endsOn: isoDay(next), mode: 'IN_PERSON', slotMinutes: '10', bufferMinutes: '2', changeCutoffHours: '12', defaultVenue: '', sectionIds: [] as string[] });
  const { run, busy, error } = useAction();
  return (
    <Modal title="New PTM round" wide onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.title.trim()} onClick={() => void run(async () => {
      await ptmApi.createRound({ ...f, slotMinutes: Number(f.slotMinutes), bufferMinutes: Number(f.bufferMinutes), changeCutoffHours: Number(f.changeCutoffHours), defaultVenue: f.defaultVenue || null });
      onDone();
    })}>Create and open booking</Button></>}>
      <Field label="Title" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Term 1 parent–teacher meeting" /></Field>
      <div className="ops-grid-2">
        <Field label="First day"><input className="input" type="date" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} /></Field>
        <Field label="Last day"><input className="input" type="date" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} /></Field>
        <Field label="Mode"><select className="input" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="IN_PERSON">In person</option><option value="ONLINE">Online</option><option value="BOTH">Both (family chooses)</option></select></Field>
        <Field label="Default venue"><input className="input" value={f.defaultVenue} onChange={(e) => setF({ ...f, defaultVenue: e.target.value })} placeholder="Each class's room" /></Field>
        <Field label="Slot length (minutes)"><input className="input" type="number" min={5} max={120} value={f.slotMinutes} onChange={(e) => setF({ ...f, slotMinutes: e.target.value })} /></Field>
        <Field label="Buffer between slots (minutes)"><input className="input" type="number" min={0} max={60} value={f.bufferMinutes} onChange={(e) => setF({ ...f, bufferMinutes: e.target.value })} /></Field>
        <Field label="Families can change until (hours before)"><input className="input" type="number" min={0} max={168} value={f.changeCutoffHours} onChange={(e) => setF({ ...f, changeCutoffHours: e.target.value })} /></Field>
      </div>
      <Field label="Classes" hint="Leave empty for every class.">
        <Loadable state={sections}>{(list) => <div className="ops-chips">{list.map((s) => <label key={s.id} className="ops-chip"><input type="checkbox" checked={f.sectionIds.includes(s.id)} onChange={() => setF({ ...f, sectionIds: f.sectionIds.includes(s.id) ? f.sectionIds.filter((x) => x !== s.id) : [...f.sectionIds, s.id] })} />{s.label}</label>)}</div>}</Loadable>
      </Field>
      <DataNote>The PTM is added to the school calendar. Booking closes the evening before the first day; the office can still book for a family after that.</DataNote>
      <ErrorNote error={error} />
    </Modal>
  );
}

function RoundsAdmin({ onPick }: { onPick: (r: PtmRound) => void }) {
  const rounds = useLoad(() => ptmApi.rounds({}), []);
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<PtmRound | null>(null);
  const toast = useToast();
  return (
    <SectionCard title="PTM rounds" actions={<Button onClick={() => setCreating(true)}>New round</Button>}>
      <Loadable state={rounds}>{(list) => !list.length ? <EmptyState title="No PTM rounds yet" sub="Create a round; teachers then give their availability and families book." /> : (
        <ul className="ops-list">{list.map((r) => (
          <li key={r.id} className="ops-row">
            <div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => onPick(r)}><div className="ops-row-title">{r.title}</div><div className="ops-row-sub">{fmtDate(r.startsOn)}{r.endsOn !== r.startsOn ? ` – ${fmtDate(r.endsOn)}` : ''} · {humanize(r.mode)} · {r.slots ?? 0} slots, {r.bookings ?? 0} booked</div></button></div>
            <StatusPill status={r.status === 'OPEN' ? (r.bookingOpen ? 'ACTIVE' : 'PENDING') : r.status} label={r.status === 'OPEN' ? (r.bookingOpen ? 'Booking open' : 'Open') : humanize(r.status)} />
            {r.status === 'OPEN' && <Button small variant="ghost" onClick={() => setCancelling(r)}>Cancel</Button>}
          </li>
        ))}</ul>
      )}</Loadable>
      {creating && <RoundForm onClose={() => setCreating(false)} onDone={() => { setCreating(false); toast('Round created', 'success'); void rounds.reload(); }} />}
      {cancelling && <PromptModal title={`Cancel ${cancelling.title}`} label="Reason (every family with a booking is told)" danger confirmLabel="Cancel round" onClose={() => setCancelling(null)} onSubmit={async (v) => { await ptmApi.cancelRound(cancelling.id, v); toast('Round cancelled', 'info'); await rounds.reload(); }} />}
    </SectionCard>
  );
}

function MetricsTiles({ roundId }: { roundId?: string }) {
  const m = useLoad(() => ptmApi.metrics(roundId ? { roundId } : {}), [roundId]);
  return <Loadable state={m}>{(x) => (
    <div className="kpi-grid">
      <Tile label="Meetings booked" value={x.booked} />
      <Tile label="Met" value={x.completed} tone="good" />
      <Tile label="No-shows" value={x.noShow} tone={x.noShow ? 'warn' : 'neutral'} />
      <Tile label="Attendance" value={x.attendancePct === null ? 'No data' : `${x.attendancePct}%`} />
      <Tile label="Actions open" value={x.actionsOpen} tone={x.actionsOverdue ? 'bad' : 'neutral'} href="/tasks" />
      <Tile label="Waiting list" value={x.waiting} />
    </div>
  )}</Loadable>;
}

function Unbooked({ round }: { round: PtmRound }) {
  const list = useLoad(() => ptmApi.unbooked(round.id), [round.id]);
  return (
    <SectionCard title="Families who have not booked" sub="Call or message them, or book for them from the meeting sheet.">
      <Loadable state={list}>{(rows) => !rows.length ? <p className="ops-muted">Every family in these classes has at least one meeting.</p> : (
        <ul className="ops-list">{rows.slice(0, 60).map((r) => <li key={r.studentId} className="ops-row"><div className="ops-row-main">{r.studentName}<div className="ops-row-sub">{r.className} · {r.guardians.map((g) => g.name).join(', ') || 'No guardian on record'}</div></div></li>)}</ul>
      )}</Loadable>
    </SectionCard>
  );
}

// ── teacher: availability and meeting sheet ────────────────────────────

function AvailabilityForm({ round, onDone }: { round: PtmRound; onDone: () => void }) {
  const [w, setW] = useState({ date: round.startsOn, from: '09:00', to: '12:00', mode: round.mode === 'BOTH' ? 'BOTH' : round.mode, venue: '' });
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <SectionCard title="Add availability" sub={`Slots of ${round.slotMinutes} minutes with ${round.bufferMinutes} minutes between them are made inside each window.`}>
      <div className="ops-grid-2">
        <Field label="Date"><input className="input" type="date" min={round.startsOn} max={round.endsOn} value={w.date} onChange={(e) => setW({ ...w, date: e.target.value })} /></Field>
        <Field label="Venue"><input className="input" value={w.venue} onChange={(e) => setW({ ...w, venue: e.target.value })} placeholder={round.defaultVenue ?? 'Room'} /></Field>
        <Field label="From"><input className="input" type="time" value={w.from} onChange={(e) => setW({ ...w, from: e.target.value })} /></Field>
        <Field label="To"><input className="input" type="time" value={w.to} onChange={(e) => setW({ ...w, to: e.target.value })} /></Field>
        {round.mode === 'BOTH' && <Field label="Mode"><select className="input" value={w.mode} onChange={(e) => setW({ ...w, mode: e.target.value as typeof w.mode })}><option value="BOTH">Family chooses</option><option value="IN_PERSON">In person</option><option value="ONLINE">Online</option></select></Field>}
      </div>
      <Button disabled={busy} onClick={() => void run(async () => {
        const out = await ptmApi.addAvailability(round.id, { windows: [{ ...w, venue: w.venue || undefined }] });
        toast(`${out.created} slot(s) added${out.skipped.length ? `, ${out.skipped.length} skipped (overlap)` : ''}`, 'success');
        onDone();
      })}>Add slots</Button>
      <ErrorNote error={error} />
    </SectionCard>
  );
}

function OutcomeModal({ booking, onClose, onDone }: { booking: PtmBooking; onClose: () => void; onDone: () => void }) {
  const link = usePortalHref();
  const [summary, setSummary] = useState(booking.outcome?.summary ?? '');
  const [actions, setActions] = useState<Array<{ title: string; ownerType: string; dueOn: string }>>(booking.outcome?.actions.map((a) => ({ title: a.title, ownerType: a.ownerType, dueOn: a.dueOn ? a.dueOn.slice(0, 10) : '' })) ?? []);
  const [next, setNext] = useState(booking.outcome?.nextFollowUpOn?.slice(0, 10) ?? '');
  const { run, busy, error } = useAction();
  return (
    <Modal title={`Outcome: ${booking.studentName}`} wide onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !summary.trim()} onClick={() => void run(async () => {
      await ptmApi.outcome(booking.id, { summary, actions: actions.filter((a) => a.title.trim()).map((a) => ({ ...a, dueOn: a.dueOn || undefined })), nextFollowUpOn: next || null });
      onDone();
    })}>Save outcome</Button></>}>
      <p className="ops-callout is-warn">Do not write safeguarding concerns here. <a href={link('/safeguarding')}>Report a safeguarding concern</a> instead; it goes straight to the safeguarding lead. Meetings are never recorded.</p>
      <Field label="Summary" required><textarea className="input" rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What was discussed and agreed." /></Field>
      <Field label="Agreed actions" hint="Staff actions become tasks for you, with reminders; parent actions are noted on the record.">
        <div className="ops-stack">
          {actions.map((a, i) => (
            <div key={i} className="ptm-action-row">
              <input className="input" value={a.title} placeholder="Action" onChange={(e) => setActions(actions.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
              <select className="input" value={a.ownerType} onChange={(e) => setActions(actions.map((x, j) => (j === i ? { ...x, ownerType: e.target.value } : x)))}><option value="STAFF">Me (staff)</option><option value="PARENT">Parent</option></select>
              <input className="input" type="date" value={a.dueOn} onChange={(e) => setActions(actions.map((x, j) => (j === i ? { ...x, dueOn: e.target.value } : x)))} aria-label="Due on" />
              <Button small variant="ghost" onClick={() => setActions(actions.filter((_, j) => j !== i))} aria-label="Remove action">✕</Button>
            </div>
          ))}
          <Button small variant="soft" onClick={() => setActions([...actions, { title: '', ownerType: 'STAFF', dueOn: isoDay(new Date(Date.now() + 7 * 86_400_000)) }])}>Add an action</Button>
        </div>
      </Field>
      <Field label="Next follow-up"><input className="input" type="date" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      <ErrorNote error={error} />
    </Modal>
  );
}

function BookingDrawer({ booking, onClose, onChanged }: { booking: PtmBooking; onClose: () => void; onChanged: () => void }) {
  const brief = useLoad(() => ptmApi.briefing(booking.id), [booking.id]);
  const [outcome, setOutcome] = useState(false);
  const [cancel, setCancel] = useState(false);
  const { run, busy, error } = useAction();
  const toast = useToast();
  const act = (fn: () => Promise<unknown>, msg: string) => void run(async () => { await fn(); toast(msg, 'success'); onChanged(); });
  return (
    <Drawer title={booking.studentName ?? 'Meeting'} sub={`${booking.when} · ${booking.parentName ?? 'Parent'}${booking.className ? ` · ${booking.className}` : ''}`} onClose={onClose} footer={<>
      {booking.status === 'BOOKED' && <Button variant="ghost" onClick={() => setCancel(true)}>Cancel</Button>}
      {booking.status === 'BOOKED' && <Button variant="soft" disabled={busy} onClick={() => act(() => ptmApi.noShow(booking.id), 'Marked as no-show')}>No-show</Button>}
      {booking.status === 'BOOKED' && <Button variant="soft" disabled={busy} onClick={() => act(() => ptmApi.checkIn(booking.id), 'Checked in')}>Check in</Button>}
      {['BOOKED', 'CHECKED_IN', 'COMPLETED'].includes(booking.status) && <Button onClick={() => setOutcome(true)}>{booking.outcome ? 'Edit outcome' : 'Record outcome'}</Button>}
    </>}>
      <div className="ops-stack">
        <div className="ops-inline"><StatusPill status={BOOKING_PILL[booking.status]} label={humanize(booking.status)} /><span className="ops-muted">{booking.mode === 'ONLINE' ? 'Online (join from Digital Lectures)' : booking.venue ?? 'Venue to be confirmed'}</span></div>
        {(booking.preferences.language || booking.preferences.interpreter || booking.preferences.accessibility) && (
          <p className="ops-callout">Family asked for: {[booking.preferences.language && `${booking.preferences.language} language`, booking.preferences.interpreter && 'an interpreter', booking.preferences.accessibility].filter(Boolean).join('; ')}</p>
        )}
        {booking.parentNote && <p><b>Parent&apos;s note:</b> {booking.parentNote}</p>}
        {booking.outcome && <SectionCard title="Outcome"><p>{booking.outcome.summary}</p><ul className="ops-list">{booking.outcome.actions.map((a) => <li key={a.id} className="ops-row"><div className="ops-row-main">{a.title}<div className="ops-row-sub">{a.ownerName} · due {fmtDate(a.dueOn)}</div></div><StatusPill status={a.status} /></li>)}</ul></SectionCard>}
        <Loadable state={brief}>{(b) => <BriefingPanel b={b} />}</Loadable>
        {booking.history && <SectionCard title="History"><Timeline items={booking.history} /></SectionCard>}
        <ErrorNote error={error} />
      </div>
      {outcome && <OutcomeModal booking={booking} onClose={() => setOutcome(false)} onDone={() => { setOutcome(false); toast('Outcome saved', 'success'); onChanged(); }} />}
      {cancel && <PromptModal title="Cancel this meeting" label="Reason (the family is told)" danger confirmLabel="Cancel meeting" onClose={() => setCancel(false)} onSubmit={async (v) => { await ptmApi.cancel(booking.id, v); onChanged(); }} />}
    </Drawer>
  );
}

function AssistModal({ round, slot, onClose, onDone }: { round: PtmRound; slot: PtmSlot; onClose: () => void; onDone: () => void }) {
  const unbooked = useLoad(() => ptmApi.unbooked(round.id), [round.id]);
  const [pick, setPick] = useState('');
  const { run, busy, error } = useAction();
  return (
    <Modal title={`Book ${slot.time} for a family`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !pick} onClick={() => void run(async () => {
      const [studentId, parentProfileId] = pick.split('|');
      await ptmApi.book({ slotId: slot.id, studentId, parentProfileId });
      onDone();
    })}>Book</Button></>}>
      <Loadable state={unbooked}>{(rows) => (
        <Field label="Family" hint="Families in your classes without a meeting in this round.">
          <select className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Choose…</option>
            {rows.flatMap((r) => r.guardians.map((g) => <option key={`${r.studentId}|${g.profileId}`} value={`${r.studentId}|${g.profileId}`}>{r.studentName} ({r.className}) · {g.name}</option>))}
          </select>
        </Field>
      )}</Loadable>
      <ErrorNote error={error} />
    </Modal>
  );
}

function TeacherRound({ round, manager }: { round: PtmRound; manager: boolean }) {
  const sheet = useLoad(() => ptmApi.sheet(round.id), [round.id]);
  const [open, setOpen] = useState<PtmBooking | null>(null);
  const [assist, setAssist] = useState<PtmSlot | null>(null);
  const { run, error } = useAction();
  const toast = useToast();
  const reload = async () => { const s = await sheet.reload(); return s; };
  return (
    <div className="ops-stack">
      {round.status === 'OPEN' && <AvailabilityForm round={round} onDone={() => void reload()} />}
      <SectionCard title="My meeting sheet" sub="Every slot in time order. Open a meeting for the child briefing, check-in and the outcome.">
        <Loadable state={sheet}>{(s) => !s.rows.length ? <EmptyState title="No slots yet" sub="Add availability above." /> : (
          <>
            <div className="kpi-grid"><Tile label="Slots" value={s.totals.slots} /><Tile label="Booked" value={s.totals.booked} /><Tile label="Met" value={s.totals.completed} tone="good" /><Tile label="No-shows" value={s.totals.noShow} tone={s.totals.noShow ? 'warn' : 'neutral'} /><Tile label="Free" value={s.totals.free} /></div>
            <ul className="ops-list ptm-sheet">{s.rows.map(({ slot, booking }) => (
              <li key={slot.id} className="ops-row">
                <div className="ptm-time">{slot.time}<div className="ops-row-sub">{fmtDate(slot.date)}</div></div>
                <div className="ops-row-main">
                  {booking ? <button type="button" className="ops-row-link" onClick={() => setOpen(booking)}><div className="ops-row-title">{booking.studentName}{booking.className ? ` · ${booking.className}` : ''}</div><div className="ops-row-sub">{booking.parentName}{booking.mode === 'ONLINE' ? ' · online' : ''}{booking.preferences.interpreter ? ' · interpreter' : ''}{booking.assisted ? ' · booked by staff' : ''}</div></button>
                    : <span className="ops-muted">{slot.status === 'BLOCKED' ? 'Blocked' : slot.status === 'HELD' ? 'Held for a family on the waiting list' : 'Free'}</span>}
                </div>
                {booking ? <StatusPill status={BOOKING_PILL[booking.status]} label={humanize(booking.status)} /> : (
                  <span className="ops-inline">
                    {slot.status === 'OPEN' && <Button small variant="soft" onClick={() => setAssist(slot)}>Book for a family</Button>}
                    {slot.status === 'OPEN' && <Button small variant="ghost" onClick={() => void run(async () => { await ptmApi.blockSlot(slot.id); await reload(); })}>Block</Button>}
                    {slot.status === 'BLOCKED' && <Button small variant="ghost" onClick={() => void run(async () => { await ptmApi.unblockSlot(slot.id); await reload(); })}>Unblock</Button>}
                  </span>
                )}
              </li>
            ))}</ul>
          </>
        )}</Loadable>
        <ErrorNote error={error} />
      </SectionCard>
      {manager && <Unbooked round={round} />}
      {open && <BookingDrawer booking={open} onClose={() => setOpen(null)} onChanged={() => { void reload().then(() => setOpen(null)); }} />}
      {assist && <AssistModal round={round} slot={assist} onClose={() => setAssist(null)} onDone={() => { setAssist(null); toast('Booked, and the family told', 'success'); void reload(); }} />}
    </div>
  );
}

// ── family: book for each child ────────────────────────────────────────

function BookModal({ roundId, slot, studentId, mode, onClose, onDone, rescheduleId }: { roundId: string; slot: PtmSlot; studentId: string; mode: string; onClose: () => void; onDone: () => void; rescheduleId?: string }) {
  const [f, setF] = useState({ mode: mode === 'BOTH' ? 'IN_PERSON' : mode, language: '', interpreter: false, accessibility: '', parentNote: '', reason: '' });
  const { run, busy, error } = useAction();
  void roundId;
  return (
    <Modal title={`${rescheduleId ? 'Move to' : 'Book'} ${slot.when}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || (Boolean(rescheduleId) && !f.reason.trim())} onClick={() => void run(async () => {
      if (rescheduleId) await ptmApi.reschedule(rescheduleId, slot.id, f.reason);
      else await ptmApi.book({ slotId: slot.id, studentId, mode: f.mode, preferences: { language: f.language || null, interpreter: f.interpreter, accessibility: f.accessibility || null }, parentNote: f.parentNote || undefined });
      onDone();
    })}>{rescheduleId ? 'Move meeting' : 'Confirm booking'}</Button></>}>
      <p>With <b>{slot.teacherName}</b>, {slot.time}{slot.venue ? ` in ${slot.venue}` : ''}.</p>
      {rescheduleId ? <Field label="Why are you moving it?" required><input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field> : (
        <>
          {mode === 'BOTH' && <Field label="How would you like to meet?"><select className="input" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="IN_PERSON">In person</option><option value="ONLINE">Online video call</option></select></Field>}
          <Field label="Preferred language" hint="Optional. The school tries to arrange it."><input className="input" value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })} placeholder="e.g. Hindi, Marathi" /></Field>
          <label className="ops-chip"><input type="checkbox" checked={f.interpreter} onChange={(e) => setF({ ...f, interpreter: e.target.checked })} />I would like an interpreter</label>
          <Field label="Access needs" hint="Optional: step-free access, sign language, anything that helps."><input className="input" value={f.accessibility} onChange={(e) => setF({ ...f, accessibility: e.target.value })} /></Field>
          <Field label="Anything the teacher should know beforehand"><textarea className="input" rows={2} value={f.parentNote} onChange={(e) => setF({ ...f, parentNote: e.target.value })} /></Field>
        </>
      )}
      <DataNote>You are reminded the day before and an hour before. Meetings are not recorded.</DataNote>
      <ErrorNote error={error} />
    </Modal>
  );
}

function FamilyRound({ round }: { round: PtmRound }) {
  const opts = useLoad(() => ptmApi.options(round.id), [round.id]);
  const [booking, setBooking] = useState<{ slot: PtmSlot; studentId: string; rescheduleId?: string } | null>(null);
  const [cancelling, setCancelling] = useState<PtmBooking | null>(null);
  const { run, error } = useAction();
  const toast = useToast();
  return (
    <div className="ops-stack">
      {!round.bookingOpen && <p className="ops-callout is-warn">Booking is {new Date(round.bookingOpensAt) > new Date() ? `opening ${fmtDateTime(round.bookingOpensAt)}` : 'closed'}. The school office can still help.</p>}
      <Loadable state={opts}>{(o) => !o.children.length ? <EmptyState title="None of your children's classes are in this PTM" sub="Check the other rounds, or contact the school." /> : (
        <>{o.children.map((c) => (
          <SectionCard key={c.studentId} title={c.name} sub={c.className ?? undefined}>
            <ul className="ops-list">{c.teachers.filter((t) => t.hasSlots || t.booking).map((t) => (
              <li key={t.profileId} className="ptm-teacher">
                <div className="ptm-teacher-head"><b>{t.name}</b> <span className="ops-muted">{[t.roles.includes('CLASS_TEACHER') && 'Class teacher', t.subjects.join(', '), t.roles.includes('PRINCIPAL') && 'Principal'].filter(Boolean).join(' · ')}</span></div>
                {t.booking ? (
                  <div className="ops-stack">
                    <div className="ops-inline"><StatusPill status={BOOKING_PILL[t.booking.status]} label={`${humanize(t.booking.status)}: ${t.booking.when}`} />
                      {t.booking.status === 'BOOKED' && <Button small variant="ghost" onClick={() => setCancelling(t.booking)}>Cancel</Button>}
                    </div>
                    {t.booking.status === 'BOOKED' && t.slots.length > 0 && (
                      <details className="ptm-move"><summary>Move to another time</summary>
                        <div className="ptm-slots">{t.slots.map((sl) => <button key={sl.id} type="button" className="ptm-slot" onClick={() => setBooking({ slot: sl, studentId: c.studentId, rescheduleId: t.booking!.id })}>{sl.time}<span>{fmtDate(sl.date)}</span></button>)}</div>
                      </details>
                    )}
                  </div>
                ) : t.waitlist ? (
                  <div className="ops-inline">{t.waitlist.status === 'OFFERED' ? <><StatusPill status="OFFERED" label={`A slot is held for you until ${fmtDateTime(t.waitlist.offerExpiresAt)}`} /><Button small onClick={() => void run(async () => { await ptmApi.acceptOffer(t.waitlist!.id); toast('Booked', 'success'); await opts.reload(); })}>Accept</Button></> : <StatusPill status="WAITLISTED" label="On the waiting list" />}
                    <Button small variant="ghost" onClick={() => void run(async () => { await ptmApi.leaveWaitlist(t.waitlist!.id); await opts.reload(); })}>Leave list</Button></div>
                ) : t.slots.length ? (
                  <div className="ptm-slots">{t.slots.map((sl) => <button key={sl.id} type="button" className="ptm-slot" disabled={!round.bookingOpen} onClick={() => setBooking({ slot: sl, studentId: c.studentId })}>{sl.time}<span>{fmtDate(sl.date)}{sl.mode === 'ONLINE' ? ' · online' : sl.mode === 'BOTH' ? ' · in person or online' : ''}</span></button>)}</div>
                ) : (
                  <div className="ops-inline"><span className="ops-muted">All slots are taken.</span><Button small variant="soft" disabled={!round.bookingOpen} onClick={() => void run(async () => { const w = await ptmApi.joinWaitlist({ roundId: round.id, teacherProfileId: t.profileId, studentId: c.studentId }); toast(`On the waiting list (position ${w.position})`, 'info'); await opts.reload(); })}>Join the waiting list</Button></div>
                )}
              </li>
            ))}</ul>
            {!c.teachers.some((t) => t.hasSlots || t.booking) && <p className="ops-muted">This child&apos;s teachers have not published their times yet.</p>}
          </SectionCard>
        ))}
        <DataNote>You cannot be in two meetings at once: times that overlap one you have booked are refused. Book back-to-back slots for different children if that suits you.</DataNote></>
      )}</Loadable>
      <ErrorNote error={error} />
      {booking && <BookModal roundId={round.id} slot={booking.slot} studentId={booking.studentId} mode={booking.slot.mode} rescheduleId={booking.rescheduleId} onClose={() => setBooking(null)} onDone={() => { setBooking(null); toast('Done. A confirmation is on its way.', 'success'); void opts.reload(); }} />}
      {cancelling && <PromptModal title="Cancel this meeting" label="Reason" danger confirmLabel="Cancel meeting" onClose={() => setCancelling(null)} onSubmit={async (v) => { await ptmApi.cancel(cancelling.id, v); toast('Cancelled', 'info'); await opts.reload(); }} />}
    </div>
  );
}

function MyBookings() {
  const list = useLoad(() => ptmApi.bookings({}), []);
  return (
    <SectionCard title="My upcoming meetings">
      <Loadable state={list}>{(rows) => !rows.length ? <p className="ops-muted">No meetings booked.</p> : (
        <ul className="ops-list">{rows.map((b) => <li key={b.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{b.when} · {b.teacherName}</div><div className="ops-row-sub">{b.studentName} · {b.mode === 'ONLINE' ? 'Online: join from Digital Lectures 15 minutes before' : b.venue ?? 'Venue to follow'}</div></div><StatusPill status={BOOKING_PILL[b.status]} label={humanize(b.status)} /></li>)}</ul>
      )}</Loadable>
    </SectionCard>
  );
}

export function PtmView() {
  const { permissions } = usePermissions();
  const manager = permissions['ptm.manage'] === 'ALL';
  const teacher = Boolean(permissions['ptm.manage']);
  const family = Boolean(permissions['ptm.book']) && !teacher;
  const rounds = useLoad(() => ptmApi.rounds({}), []);
  const [picked, setPicked] = useState<string | null>(useQueryParam('round'));
  const [tab, setTab] = useState<'rounds' | 'sheet'>(manager ? 'rounds' : 'sheet');
  return (
    <div className="ops-stack">
      {teacher && <MetricsTiles roundId={picked ?? undefined} />}
      {manager && <Tabs tabs={[{ key: 'rounds', label: 'Rounds' }, { key: 'sheet', label: 'Meetings' }]} value={tab} onChange={setTab} />}
      {manager && tab === 'rounds' && <RoundsAdmin onPick={(r) => { setPicked(r.id); setTab('sheet'); }} />}
      {(!manager || tab === 'sheet') && (
        <Loadable state={rounds}>{(list) => {
          const visible = list.filter((r) => r.status !== 'CANCELLED');
          if (!visible.length) return <EmptyState title="No PTM is open" sub={family ? 'When the school opens a parent–teacher meeting you can book here.' : 'Rounds set up by the principal appear here.'} />;
          const current = visible.find((r) => r.id === picked) ?? visible.find((r) => r.status === 'OPEN') ?? visible[0];
          return (
            <>
              {visible.length > 1 && <Field label="PTM round"><select className="input" value={current.id} onChange={(e) => setPicked(e.target.value)}>{visible.map((r) => <option key={r.id} value={r.id}>{r.title} · {fmtDate(r.startsOn)}</option>)}</select></Field>}
              <SectionCard title={current.title} sub={`${fmtDate(current.startsOn)}${current.endsOn !== current.startsOn ? ` – ${fmtDate(current.endsOn)}` : ''} · ${humanize(current.mode)} · ${current.slotMinutes}-minute meetings`}>{current.description && <p>{current.description}</p>}</SectionCard>
              {family ? <><MyBookings /><FamilyRound round={current} /></> : <TeacherRound round={current} manager={manager} />}
            </>
          );
        }}</Loadable>
      )}
    </div>
  );
}
