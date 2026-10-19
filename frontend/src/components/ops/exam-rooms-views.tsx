'use client';
import { useState } from 'react';
import { Button, EmptyState, Field, Modal, useToast } from '@/components/ui';
import {
  examRoomsApi, type ClassRow, type InvigilatorOption, type RoomRow, type RoomShift, type ShiftCheck, type Sitting, type SittingBody,
} from '@/lib/exam-rooms-api';
import {
  DataNote, ErrorNote, Loadable, PromptModal, SectionCard, StatusPill, Tabs, Tile, fmtDateTime, humanize, isoDay, useAction, useLoad,
} from './kit';

/**
 * Exam timetable and halls (staff), Rooms & Classes with room shifts (staff),
 * and My exams (students and parents). Every rule is the server's: these
 * screens show what it allows and say why it refused.
 */

const STATUS_TONE: Record<string, string> = { SCHEDULED: 'PENDING', IN_PROGRESS: 'IN_PROGRESS', FINISHED: 'CLOSED', POSTPONED: 'ON_HOLD', CANCELLED: 'CANCELLED' };
const plusDays = (n: number) => isoDay(new Date(Date.now() + n * 86_400_000));

// ── Exam timetable and halls ─────────────────────────────────────────────

function ScheduleModal({ onClose, onDone, classTestOnly }: { onClose: () => void; onDone: () => void; classTestOnly: boolean }) {
  const rooms = useLoad(() => examRoomsApi.rooms(), []);
  const [f, setF] = useState({ kind: classTestOnly ? 'CLASS_TEST' : 'TERM', className: '', subject: '', title: '', date: plusDays(1), startTime: '10:00', endTime: '11:00', roomIds: [] as string[], capacity: '' as string, invigilators: [] as string[], seatingMode: 'ROLL' as 'ROLL' | 'ALTERNATE' });
  const [options, setOptions] = useState<InvigilatorOption[] | null>(null);
  const { run, busy, error } = useAction();
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const body = (): SittingBody => ({
    kind: f.kind, className: f.className, subject: f.subject, title: f.title || undefined, date: f.date, startTime: f.startTime, endTime: f.endTime, seatingMode: f.seatingMode,
    venues: f.roomIds.map((id, i) => ({ facilityId: id, capacity: i === 0 && f.capacity ? Number(f.capacity) : undefined, invigilatorProfileIds: classTestOnly ? undefined : i === 0 ? f.invigilators : [] })),
  });
  return (
    <Modal wide title={classTestOnly ? 'Schedule a class test' : 'Schedule a paper'} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.className || !f.subject} onClick={() => void run(async () => { await examRoomsApi.create(body()); onDone(); })}>{busy ? 'Checking…' : 'Schedule'}</Button></>}>
      <div className="ops-grid-2">
        {!classTestOnly && <Field label="Kind"><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{['TERM', 'BOARD', 'CLASS_TEST', 'OTHER'].map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select></Field>}
        <Field label="Class" required hint='e.g. "7B"'><input className="input" value={f.className} onChange={(e) => setF({ ...f, className: e.target.value })} /></Field>
        <Field label="Subject" required><input className="input" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
        <Field label="Title" hint="Optional"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Date"><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Starts"><input className="input" type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} /></Field>
        <Field label="Ends"><input className="input" type="time" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} /></Field>
        <Field label="Seating"><select className="input" value={f.seatingMode} onChange={(e) => setF({ ...f, seatingMode: e.target.value as 'ROLL' | 'ALTERNATE' })}><option value="ROLL">By roll number</option><option value="ALTERNATE">Alternate classes</option></select></Field>
      </div>
      <Loadable state={rooms}>{(r) => (
        <Field label="Rooms (in seating order)" hint={classTestOnly ? 'Leave empty for the class\'s home room.' : 'Choose one or more.'}>
          <div className="exr-chips">{r.rooms.map((x) => <button type="button" key={x.id} className={`exr-chip${f.roomIds.includes(x.id) ? ' on' : ''}`} onClick={() => setF({ ...f, roomIds: toggle(f.roomIds, x.id) })}>{x.name}{x.capacity ? ` · ${x.capacity}` : ''}</button>)}</div>
        </Field>
      )}</Loadable>
      {f.roomIds.length > 0 && <Field label="Seats in the first room" hint="Defaults to the room's capacity"><input className="input" inputMode="numeric" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value.replace(/\D/g, '') })} /></Field>}
      {!classTestOnly && (
        <Field label="Invigilators (first room)">
          <Button small variant="soft" onClick={() => void run(async () => setOptions(await examRoomsApi.invigilators({ date: f.date, startTime: f.startTime, endTime: f.endTime })))}>Show who is free</Button>
          {options && <ul className="ops-list">{options.slice(0, 40).map((o) => (
            <li key={o.id} className="ops-row"><label className="ops-row-main"><input type="checkbox" disabled={!o.free} checked={f.invigilators.includes(o.id)} onChange={() => setF({ ...f, invigilators: toggle(f.invigilators, o.id) })} /> {o.name}<div className="ops-row-sub">{o.free ? 'Free' : o.clashes.join('; ')}</div></label></li>
          ))}</ul>}
        </Field>
      )}
      <DataNote>Each room is checked against other papers, timetabled classes (with room shifts), bookings and maintenance; each invigilator against their lessons, cover, other papers, leave and absence. The class is seated by roll number within each room&apos;s seats.</DataNote>
      <ErrorNote error={error} />
    </Modal>
  );
}

function SeatingModal({ sitting, onClose, onChanged }: { sitting: Sitting; onClose: () => void; onChanged: () => void }) {
  const full = useLoad(() => examRoomsApi.sitting(sitting.id), [sitting.id]);
  const door = useLoad(() => examRoomsApi.doorList(sitting.id), [sitting.id]);
  const [moving, setMoving] = useState<{ enrollmentId: string; name: string } | null>(null);
  const [target, setTarget] = useState({ facilityId: '', seatNo: '' });
  const { run, busy, error } = useAction();
  return (
    <Modal wide title={`Seating: ${sitting.title}`} onClose={onClose} footer={<>
      <Button variant="soft" onClick={() => void examRoomsApi.seatingCsv(sitting.id, `seating-${sitting.date}.csv`)}>Download CSV</Button>
      <Button variant="soft" onClick={() => window.print()}>Print</Button>
      {sitting.canEdit && <Button variant="soft" disabled={busy} onClick={() => void run(async () => { await examRoomsApi.reseat(sitting.id, 'ALTERNATE'); await full.reload(); await door.reload(); onChanged(); })}>Alternate classes</Button>}
      {sitting.canEdit && <Button variant="soft" disabled={busy} onClick={() => void run(async () => { await examRoomsApi.reseat(sitting.id, 'ROLL'); await full.reload(); await door.reload(); onChanged(); })}>By roll number</Button>}
      <Button onClick={onClose}>Close</Button>
    </>}>
      <div className="exr-print">
        <Loadable state={door}>{(d) => (
          <SectionCard title="Door list" sub={`${d.dateLabel} · ${d.time}`}>
            <ul className="ops-list">{d.rooms.map((r) => (
              <li key={r.room} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{r.room} · {r.seated}{r.capacity ? `/${r.capacity}` : ''} seats</div>
                <div className="ops-row-sub">{r.groups.map((g) => `${g.className}: rolls ${g.fromRoll ?? '?'}–${g.toRoll ?? '?'} (${g.count}), seats ${g.fromSeat}–${g.toSeat}`).join(' · ')}</div>
                <div className="ops-row-sub">Invigilators: {r.invigilators.join(', ') || 'none assigned'}</div></div></li>
            ))}</ul>
          </SectionCard>
        )}</Loadable>
        <Loadable state={full}>{(s) => (
          <>{s.venues.map((v) => (
            <SectionCard key={v.id} title={`${v.room}: seating chart`} sub={`${v.seated} seated`}>
              <div className="exr-seats">{(v.seats ?? []).map((x) => (
                <button type="button" key={x.enrollmentId} className="exr-seat" disabled={!s.canEdit} onClick={() => { setMoving({ enrollmentId: x.enrollmentId, name: x.name }); setTarget({ facilityId: v.facilityId, seatNo: '' }); }}>
                  <strong>{x.seatNo}</strong><span>{x.className} · {x.rollNo ?? '–'}</span><span>{x.name}</span>
                </button>
              ))}</div>
            </SectionCard>
          ))}
          {moving && (
            <SectionCard title={`Move ${moving.name}`}>
              <div className="ops-inline">
                <Field label="Room"><select className="input" value={target.facilityId} onChange={(e) => setTarget({ ...target, facilityId: e.target.value })}>{s.venues.map((v) => <option key={v.facilityId} value={v.facilityId}>{v.room}</option>)}</select></Field>
                <Field label="Seat" hint="Optional; a taken seat is swapped"><input className="input" value={target.seatNo} onChange={(e) => setTarget({ ...target, seatNo: e.target.value })} /></Field>
                <Button disabled={busy} onClick={() => void run(async () => { await examRoomsApi.moveSeat(s.id, { enrollmentId: moving.enrollmentId, toFacilityId: target.facilityId, seatNo: target.seatNo || undefined }); setMoving(null); await full.reload(); await door.reload(); })}>Move</Button>
              </div>
            </SectionCard>
          )}</>
        )}</Loadable>
      </div>
      <ErrorNote error={error} />
    </Modal>
  );
}

function ChangeRoomModal({ sitting, onClose, onDone }: { sitting: Sitting; onClose: () => void; onDone: (s: Sitting) => void }) {
  const rooms = useLoad(() => examRoomsApi.rooms(), []);
  const [to, setTo] = useState('');
  const [from, setFrom] = useState(sitting.venues.length > 1 ? sitting.venues[0].facilityId : '');
  const [reason, setReason] = useState('');
  const { run, busy, error } = useAction();
  return (
    <Modal title={`Change room: ${sitting.title}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !to} onClick={() => void run(async () => onDone(await examRoomsApi.changeVenue(sitting.id, { toFacilityId: to, fromFacilityId: from || undefined, reason: reason || undefined })))}>Move and tell everyone</Button></>}>
      {sitting.venues.length > 1 && <Field label="Replace"><select className="input" value={from} onChange={(e) => setFrom(e.target.value)}><option value="">All rooms (move the whole paper)</option>{sitting.venues.map((v) => <option key={v.facilityId} value={v.facilityId}>{v.room}</option>)}</select></Field>}
      <Loadable state={rooms}>{(r) => <Field label="New room" required><select className="input" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose…</option>{r.rooms.map((x) => <option key={x.id} value={x.id}>{x.name}{x.capacity ? ` (${x.capacity} seats)` : ''}</option>)}</select></Field>}</Loadable>
      <Field label="Reason" hint="Sent to students, parents and invigilators"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <DataNote>The new room is checked for clashes and the candidates are re-seated. Students, their parents and the invigilators are told once, and a banner shows on the day.</DataNote>
      <ErrorNote error={error} />
    </Modal>
  );
}

function SittingCard({ s, onChanged }: { s: Sitting; onChanged: () => void }) {
  const [modal, setModal] = useState<null | 'seating' | 'room' | 'delay' | 'postpone' | 'cancel'>(null);
  const toast = useToast();
  const told = (x: Sitting) => { setModal(null); toast(x.notified ? `Saved; told ${x.notified.students} students, ${x.notified.guardians} parents, ${x.notified.invigilators} invigilators` : 'Saved', 'success'); onChanged(); };
  return (
    <li className="ops-row exr-paper">
      <div className="ptm-time">{s.dateLabel}<div className="ops-row-sub">{s.startsAt}–{s.endsAt}{s.delayMinutes ? ` (+${s.delayMinutes} min)` : ''}</div></div>
      <div className="ops-row-main">
        <div className="ops-row-title">{s.title} · {s.classes.map((c) => c.className).join(', ')}</div>
        <div className="ops-row-sub">{s.venues.map((v) => `${v.room} (${v.seated}${v.capacity ? `/${v.capacity}` : ''}) · ${v.invigilators.map((i) => i.name).join(', ') || 'no invigilator'}`).join(' | ') || 'No room yet'}</div>
        {s.unseated > 0 && <div className="ops-row-sub exr-warn">{s.unseated} candidates without a seat</div>}
        {s.banner && <div className="exr-banner" role="status">{s.banner}</div>}
      </div>
      <StatusPill status={STATUS_TONE[s.status] ?? s.status} label={humanize(s.status)} />
      <div className="ops-inline">
        <Button small variant="soft" onClick={() => setModal('seating')}>Seating</Button>
        {s.canEdit && !['FINISHED', 'CANCELLED'].includes(s.status) && <>
          <Button small variant="soft" onClick={() => setModal('room')}>Change room</Button>
          <Button small variant="soft" onClick={() => setModal('delay')}>Delay</Button>
          <Button small variant="ghost" onClick={() => setModal('postpone')}>Postpone</Button>
          <Button small variant="ghost" onClick={() => setModal('cancel')}>Cancel</Button>
        </>}
      </div>
      {modal === 'seating' && <SeatingModal sitting={s} onClose={() => setModal(null)} onChanged={onChanged} />}
      {modal === 'room' && <ChangeRoomModal sitting={s} onClose={() => setModal(null)} onDone={told} />}
      {modal === 'delay' && <PromptModal title="Delay this paper" label="Minutes late, then a reason (e.g. 30 Paper packets late)" multiline={false} onClose={() => setModal(null)} onSubmit={async (v) => { const m = /^(\d{1,3})\s*(.*)$/.exec(v); if (!m) throw new Error('Start with the number of minutes'); told(await examRoomsApi.delay(s.id, Number(m[1]), m[2] || undefined)); }} />}
      {modal === 'postpone' && <PromptModal title="Postpone this paper" label="Reason (sent to families)" onClose={() => setModal(null)} onSubmit={async (v) => told(await examRoomsApi.status(s.id, { status: 'POSTPONED', reason: v }))} />}
      {modal === 'cancel' && <PromptModal title="Cancel this paper" label="Reason (sent to families)" danger onClose={() => setModal(null)} onSubmit={async (v) => told(await examRoomsApi.status(s.id, { status: 'CANCELLED', reason: v }))} />}
    </li>
  );
}

export function ExamScheduleView() {
  const [tab, setTab] = useState<'timetable' | 'duties' | 'roster'>('timetable');
  const [from, setFrom] = useState(isoDay());
  const list = useLoad(() => examRoomsApi.sittings({ from }), [from]);
  const duties = useLoad(() => (tab === 'duties' ? examRoomsApi.duties({}) : Promise.resolve(null)), [tab]);
  const roster = useLoad(() => (tab === 'roster' ? examRoomsApi.duties({ all: true }) : Promise.resolve(null)), [tab]);
  const [scheduling, setScheduling] = useState(false);
  const canSchedule = list.data?.canSchedule ?? null;
  return (
    <div className="ops-stack">
      <Tabs tabs={[{ key: 'timetable', label: 'Exam timetable' }, { key: 'duties', label: 'My invigilation duties' }, ...(canSchedule === 'ALL' ? [{ key: 'roster' as const, label: 'Duty roster' }] : [])]} value={tab} onChange={setTab} />
      {tab === 'timetable' && <>
        <div className="ops-inline">
          <Field label="From"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          {canSchedule && <Button onClick={() => setScheduling(true)}>{canSchedule === 'ALL' ? 'Schedule a paper' : 'Schedule a class test'}</Button>}
        </div>
        <Loadable state={list}>{(l) => {
          const upcoming = l.items;
          return (<>
            <div className="kpi-grid">
              <Tile label="Papers" value={upcoming.length} />
              <Tile label="In progress" value={upcoming.filter((x) => x.status === 'IN_PROGRESS').length} tone="warn" />
              <Tile label="Without a seat" value={upcoming.reduce((n, x) => n + x.unseated, 0)} tone={upcoming.some((x) => x.unseated) ? 'bad' : 'good'} />
              <Tile label="Postponed" value={upcoming.filter((x) => x.status === 'POSTPONED').length} />
            </div>
            {!upcoming.length ? <EmptyState title="No papers scheduled" sub="Papers you schedule appear here with their rooms, seating and invigilators." /> : <ul className="ops-list">{upcoming.map((s) => <SittingCard key={s.id} s={s} onChanged={() => void list.reload()} />)}</ul>}
          </>);
        }}</Loadable>
      </>}
      {tab === 'duties' && <Loadable state={duties}>{(d) => (!d?.items.length ? <EmptyState title="No invigilation duties" sub="Papers you are asked to invigilate appear here." /> : (
        <ul className="ops-list">{d.items.map((x) => <li key={`${x.sittingId}:${x.room}`} className="ops-row"><div className="ptm-time">{x.dateLabel}<div className="ops-row-sub">{x.startTime}–{x.endTime}</div></div><div className="ops-row-main"><div className="ops-row-title">{x.room} · {x.title}</div><div className="ops-row-sub">{x.classes.join(', ')} · {x.seated} seated{x.with.length ? ` · with ${x.with.join(', ')}` : ''}</div>{x.banner && <div className="exr-banner">{x.banner}</div>}</div><StatusPill status={STATUS_TONE[x.status] ?? x.status} label={humanize(x.status)} /></li>)}</ul>
      ))}</Loadable>}
      {tab === 'roster' && <Loadable state={roster}>{(d) => (!d?.roster?.length ? <EmptyState title="No duties yet" sub="Assign invigilators to papers to build the roster." /> : (
        <ul className="ops-list">{d.roster.map((r) => <li key={r.profileId} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{r.name} · {r.duties} duties · {Math.round(r.minutes / 6) / 10} h</div><div className="ops-row-sub">{r.items.map((x) => `${x.dateLabel} ${x.startTime} ${x.room}`).join(' · ')}</div></div></li>)}</ul>
      ))}</Loadable>}
      {scheduling && <ScheduleModal classTestOnly={canSchedule !== 'ALL'} onClose={() => setScheduling(false)} onDone={() => { setScheduling(false); void list.reload(); }} />}
      <DataNote>The exam office (principal, administrator, exam coordinator) schedules every paper; a teacher schedules class tests for the subjects they teach, in a free room. Changes on the day reach students, parents and invigilators. Ask AI: &quot;where is the class 10 maths exam?&quot;, &quot;my invigilation duties&quot;.</DataNote>
    </div>
  );
}

// ── My exams (students and parents) ──────────────────────────────────────

export function MyExamsView() {
  const mine = useLoad(() => examRoomsApi.myExams(), []);
  return (
    <div className="ops-stack">
      <Loadable state={mine}>{(m) => (!m.children.length ? <EmptyState title="No child linked" sub="Ask the school office to link your child to your profile." /> : <>
        {m.children.map((c) => (
          <SectionCard key={c.studentId} title={c.name ?? 'Student'} sub={c.className ?? undefined}>
            {!c.exams.length ? <p className="ops-muted">No papers on the exam timetable yet.</p> : <ul className="ops-list">{c.exams.map((e) => (
              <li key={e.id} className="ops-row">
                <div className="ptm-time">{e.dateLabel}<div className="ops-row-sub">{e.startTime}–{e.endTime}</div></div>
                <div className="ops-row-main"><div className="ops-row-title">{e.title}</div><div className="ops-row-sub">{e.room ? `${e.room} · seat ${e.seatNo}` : `Room: ${(e.rooms ?? []).join(', ') || 'to be announced'}`}</div>{e.banner && <div className="exr-banner" role="status">{e.banner}</div>}</div>
                <StatusPill status={STATUS_TONE[e.status] ?? e.status} label={humanize(e.status)} />
              </li>
            ))}</ul>}
          </SectionCard>
        ))}
        <DataNote>{m.note}</DataNote>
      </>)}</Loadable>
    </div>
  );
}

// ── Rooms & Classes, room shifts ─────────────────────────────────────────

function AssignModal({ row, rooms, onClose, onDone }: { row: ClassRow; rooms: RoomRow[]; onClose: () => void; onDone: () => void }) {
  const [to, setTo] = useState(row.homeRoom?.id ?? '');
  const [reason, setReason] = useState('');
  const taken = rooms.find((r) => r.id === to)?.occupant;
  const clash = taken && taken.sectionId !== row.sectionId ? taken : null;
  const { run, busy, error } = useAction();
  return (
    <Modal title={`Home room of ${row.className}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !to} onClick={() => void run(async () => { await examRoomsApi.assignHome({ sectionId: row.sectionId, facilityId: to, reason: reason || undefined, displace: Boolean(clash) }); onDone(); })}>{clash ? `Assign and move ${clash.className} out` : 'Assign'}</Button></>}>
      <Field label="Room"><select className="input" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose…</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}{r.capacity ? ` · ${r.capacity} seats` : ''}{r.occupant ? ` · ${r.occupant.className}` : ' · free'}</option>)}</select></Field>
      {clash && <p className="exr-warn">{rooms.find((r) => r.id === to)?.name} is {clash.className}&apos;s home room; {clash.className} will have no home room.</p>}
      <Field label="Reason"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <DataNote>{row.className} has {row.strength} pupils. The change is kept in the room history, and timetable periods that named the old room follow.</DataNote>
      <ErrorNote error={error} />
    </Modal>
  );
}

function HistoryModal({ row, onClose }: { row: ClassRow; onClose: () => void }) {
  const h = useLoad(() => examRoomsApi.history(row.sectionId), [row.sectionId]);
  return (
    <Modal title={`Room history: ${row.className}`} onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <Loadable state={h}>{(x) => (!x.items.length ? <p className="ops-muted">No changes recorded.</p> : <ul className="ops-list">{x.items.map((i) => <li key={i.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{i.from ?? 'no room'} → {i.to ?? 'no room'}</div><div className="ops-row-sub">{fmtDateTime(i.at)}{i.by ? ` · ${i.by}` : ''}{i.reason ? ` · ${i.reason}` : ''} · {humanize(i.via)}</div></div></li>)}</ul>)}</Loadable>
    </Modal>
  );
}

function ShiftModal({ classes, rooms, onClose, onDone }: { classes: ClassRow[]; rooms: RoomRow[]; onClose: () => void; onDone: (s: RoomShift) => void }) {
  const [f, setF] = useState({ sectionId: classes[0]?.sectionId ?? '', toFacilityId: '', kind: 'TEMPORARY' as 'TEMPORARY' | 'PERMANENT', startDate: isoDay(), endDate: isoDay(), periods: '', reason: '' });
  const [check, setCheck] = useState<ShiftCheck | null>(null);
  const { run, busy, error } = useAction();
  const body = () => ({ sectionId: f.sectionId, toFacilityId: f.toFacilityId, kind: f.kind, startDate: f.startDate, endDate: f.kind === 'PERMANENT' ? undefined : f.endDate, periods: f.periods ? f.periods.split(/[ ,]+/).map(Number).filter((n) => n > 0) : [], reason: f.reason });
  const set = (patch: Partial<typeof f>) => { setF({ ...f, ...patch }); setCheck(null); };
  return (
    <Modal wide title="Move a class to another room" onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="soft" disabled={busy || !f.toFacilityId || !f.reason} onClick={() => void run(async () => setCheck(await examRoomsApi.checkShift(body())))}>Check</Button>
      <Button disabled={busy || !check || check.conflicts.length > 0} onClick={() => void run(async () => onDone(await examRoomsApi.createShift(body())))}>{check?.canApply === false ? 'Send request' : 'Apply and tell everyone'}</Button>
    </>}>
      <div className="ops-grid-2">
        <Field label="Class"><select className="input" value={f.sectionId} onChange={(e) => set({ sectionId: e.target.value })}>{classes.map((c) => <option key={c.sectionId} value={c.sectionId}>{c.className} ({c.strength})</option>)}</select></Field>
        <Field label="To room"><select className="input" value={f.toFacilityId} onChange={(e) => set({ toFacilityId: e.target.value })}><option value="">Choose…</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}{r.capacity ? ` · ${r.capacity}` : ''}</option>)}</select></Field>
        <Field label="For"><select className="input" value={f.kind} onChange={(e) => set({ kind: e.target.value as 'TEMPORARY' | 'PERMANENT' })}><option value="TEMPORARY">Some periods or days</option><option value="PERMANENT">Permanently (new home room)</option></select></Field>
        <Field label={f.kind === 'PERMANENT' ? 'From' : 'From date'}><input className="input" type="date" value={f.startDate} onChange={(e) => set({ startDate: e.target.value, endDate: e.target.value > f.endDate ? e.target.value : f.endDate })} /></Field>
        {f.kind === 'TEMPORARY' && <Field label="To date"><input className="input" type="date" min={f.startDate} value={f.endDate} onChange={(e) => set({ endDate: e.target.value })} /></Field>}
        {f.kind === 'TEMPORARY' && <Field label="Periods" hint="e.g. 3 or 3,4; empty for the whole day"><input className="input" value={f.periods} onChange={(e) => set({ periods: e.target.value })} /></Field>}
      </div>
      <Field label="Reason" required hint='e.g. "painting"'><input className="input" value={f.reason} onChange={(e) => set({ reason: e.target.value })} /></Field>
      {check && (
        <SectionCard title={check.conflicts.length ? 'Not free' : 'Free'} sub={`${check.className} to ${check.to.name} ${check.when} · ${check.lessons} lessons checked`}>
          {check.conflicts.length > 0 && <ul className="ops-list">{check.conflicts.map((c, i) => <li key={i} className="ops-row exr-warn">{c.date}{c.periodNo ? ` P${c.periodNo}` : ''}: {c.detail}</li>)}</ul>}
          {check.warnings.map((w) => <p key={w} className="exr-warn">{w}</p>)}
          {check.suggestions.length > 0 && <p>Free rooms that fit {check.strength}: {check.suggestions.map((s) => <button type="button" key={s.id} className="exr-chip" onClick={() => set({ toFacilityId: s.id })}>{s.name}{s.capacity ? ` · ${s.capacity}` : ''}</button>)}</p>}
          {!check.canApply && <DataNote>This goes to the administrator or principal for approval, unless the school lets teachers move one period into a free room themselves.</DataNote>}
        </SectionCard>
      )}
      <ErrorNote error={error} />
    </Modal>
  );
}

export function RoomsClassesView() {
  const [tab, setTab] = useState<'classes' | 'rooms' | 'shifts'>('classes');
  const data = useLoad(() => examRoomsApi.rooms(), []);
  const shifts = useLoad(() => (tab === 'shifts' ? examRoomsApi.shifts({ status: 'ALL' }) : Promise.resolve([] as RoomShift[])), [tab]);
  const [assign, setAssign] = useState<ClassRow | null>(null);
  const [history, setHistory] = useState<ClassRow | null>(null);
  const [shifting, setShifting] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const { run, error } = useAction();
  const toast = useToast();
  const reload = () => { void data.reload(); void shifts.reload(); };
  return (
    <div className="ops-stack">
      <Loadable state={data}>{(d) => (<>
        <div className="kpi-grid">
          <Tile label="Classes" value={d.totals.classes} />
          <Tile label="Without a room" value={d.totals.withoutRoom} tone={d.totals.withoutRoom ? 'warn' : 'good'} />
          <Tile label="Over capacity" value={d.totals.overCapacity} tone={d.totals.overCapacity ? 'bad' : 'good'} />
          <Tile label="Moved today" value={d.totals.shiftedToday} />
          <Tile label="Requests waiting" value={d.totals.pendingRequests} tone={d.totals.pendingRequests ? 'warn' : 'neutral'} />
        </div>
        <div className="ops-inline">
          <Tabs tabs={[{ key: 'classes', label: 'Classes' }, { key: 'rooms', label: 'Rooms' }, { key: 'shifts', label: 'Room shifts', count: d.totals.pendingRequests || null }]} value={tab} onChange={setTab} />
          <Button onClick={() => setShifting(true)}>{d.canManage ? 'Move a class' : 'Request a room change'}</Button>
          {d.canManage && <label className="exr-toggle"><input type="checkbox" checked={d.settings.teacherSelfShift} onChange={(e) => void run(async () => { await examRoomsApi.setSettings(e.target.checked); await data.reload(); })} /> Teachers may move one period into a free room themselves</label>}
        </div>
        {tab === 'classes' && <ul className="ops-list">{d.sections.map((c) => (
          <li key={c.sectionId} className="ops-row">
            <div className="ops-row-main"><div className="ops-row-title">{c.className} · {c.homeRoom?.name ?? 'No home room'}</div>
              <div className="ops-row-sub">{c.strength} pupils{c.homeRoom?.capacity ? ` · ${c.homeRoom.capacity} seats` : ''}{c.classTeacher ? ` · ${c.classTeacher}` : ''}{c.shiftedToday.map((x) => ` · moved today to ${x.room}${x.periods.length ? ` (P${x.periods.join(',')})` : ''}: ${x.reason}`).join('')}</div></div>
            {c.fits === false && <StatusPill status="OVERDUE" label="Over capacity" />}
            <Button small variant="ghost" onClick={() => setHistory(c)}>History</Button>
            {d.canManage && <Button small variant="soft" onClick={() => setAssign(c)}>{c.homeRoom ? 'Change' : 'Assign'}</Button>}
          </li>
        ))}</ul>}
        {tab === 'rooms' && <ul className="ops-list">{d.rooms.map((r) => (
          <li key={r.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{r.name} <span className="ops-muted">{r.code} · {humanize(r.kind)}</span></div>
            <div className="ops-row-sub">{r.occupant ? `${r.occupant.className} (${r.occupant.strength}${r.capacity ? `/${r.capacity}` : ''})` : 'Free'}{r.movedInToday.map((x) => ` · today: ${x.className}${x.periods.length ? ` P${x.periods.join(',')}` : ''} (${x.reason})`).join('')}</div></div>
            {r.status !== 'ACTIVE' && <StatusPill status="ON_HOLD" label={humanize(r.status)} />}
            {r.fits === false && <StatusPill status="OVERDUE" label="Too small" />}
          </li>
        ))}</ul>}
        {tab === 'shifts' && <Loadable state={shifts}>{(rows) => (!rows.length ? <EmptyState title="No room shifts" sub="Moves of a class to another room, and teachers' requests, appear here." /> : <ul className="ops-list">{rows.map((s) => (
          <li key={s.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{s.refNo} · {s.className} → {s.to?.name}</div><div className="ops-row-sub">{s.when} · {s.reason}{s.requestedBy ? ` · ${s.requestedBy}` : ''}{s.selfApplied ? ' · self-applied' : ''}{s.decisionNote ? ` · ${s.decisionNote}` : ''}</div></div>
            <StatusPill status={s.status === 'REQUESTED' ? 'PENDING' : s.status === 'APPLIED' ? 'APPROVED' : s.status} label={humanize(s.status)} />
            {d.canManage && s.status === 'REQUESTED' && <><Button small onClick={() => void run(async () => { await examRoomsApi.decideShift(s.id, 'APPROVE'); toast('Applied; everyone told', 'success'); reload(); })}>Approve</Button><Button small variant="ghost" onClick={() => setRejecting(s.id)}>Reject</Button></>}
            {(s.status === 'REQUESTED' || (s.status === 'APPLIED' && s.kind === 'TEMPORARY')) && <Button small variant="ghost" onClick={() => setCancelling(s.id)}>Cancel</Button>}
          </li>
        ))}</ul>)}</Loadable>}
        {assign && <AssignModal row={assign} rooms={d.rooms} onClose={() => setAssign(null)} onDone={() => { setAssign(null); toast('Home room changed', 'success'); reload(); }} />}
        {history && <HistoryModal row={history} onClose={() => setHistory(null)} />}
        {shifting && <ShiftModal classes={d.sections} rooms={d.rooms} onClose={() => setShifting(false)} onDone={(s) => { setShifting(false); toast(s.applied ? `${s.refNo} applied; class, teachers and families told` : `${s.refNo} sent for approval`, 'success'); setTab('shifts'); reload(); }} />}
      </>)}</Loadable>
      {rejecting && <PromptModal title="Turn down this request" label="Reason" onClose={() => setRejecting(null)} onSubmit={async (v) => { await examRoomsApi.decideShift(rejecting, 'REJECT', v); reload(); }} />}
      {cancelling && <PromptModal title="Cancel this room shift" label="Reason" onClose={() => setCancelling(null)} onSubmit={async (v) => { await examRoomsApi.cancelShift(cancelling, v); reload(); }} />}
      <ErrorNote error={error} />
      <DataNote>A temporary move never rewrites the timetable: it overrides the room for those periods, and the timetable, Campus World and the live room page show the new room. Rooms are checked against lessons, exams, bookings and maintenance. Ask AI: &quot;which room is 7B in today?&quot;, &quot;move 7B to the science lab for period 3 tomorrow because of painting&quot;.</DataNote>
    </div>
  );
}
