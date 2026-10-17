'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Button, Field, Modal, Pill, useToast } from '@/components/ui';
import { api, request } from '@/lib/api';
import { useSchoolHref } from '@/lib/school-path';
import { post, patch, put, qs } from '@/lib/ops-api';
import { DataNote, ErrorNote, Loadable, PromptModal, SectionCard, Tabs, Tile, fmtDate, fmtDateTime, humanize, isoDay, useAction, useLoad } from './kit';

/**
 * Part 4, support roles: the screens the librarian, the warden, the
 * admissions team and the compliance officer were missing.
 *
 *   LibraryDeskView      briefing, overdue + reminders, reservations, fines, reading challenges, insights, next-read suggestions
 *   HostelLifeView       tonight's roll call, the mess (menu, headcount, allergy list), incidents with the parent-contact log
 *   FollowupsView        the counsellor's follow-up queue with explained scores, logging a follow-up, counsellor figures
 *   DataProtectionView   readiness checklist, DPDP data requests, breach register (72-hour clock), statutory committees
 *
 * Every figure says where it comes from; every suggestion shows its reasons;
 * nothing here decides on its own.
 */

type Q = Record<string, string | number | boolean | undefined | null>;
const get = <R,>(path: string, params: Q = {}) => request<R>(`${path}${qs(params)}`);
const ymd = (d: string | null | undefined) => (d ? new Date(new Date(d).getTime() + 330 * 60_000).toISOString().slice(0, 10) : '—');

/* ── a student picker shared by the screens ─────────────────────────── */
type Pick = { id: string; name: string; label: string };
function StudentPicker({ value, onChange, label = 'Student' }: { value: Pick | null; onChange: (p: Pick | null) => void; label?: string }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Pick[]>([]);
  const search = async (text: string) => {
    setQ(text);
    if (text.trim().length < 2) { setRows([]); return; }
    const res = await api.students({ search: text.trim() }).catch(() => ({ items: [] }));
    setRows((res.items ?? []).slice(0, 8).map((s) => ({ id: s.id, name: s.name, label: `${s.name} · ${s.admissionNo}${s.enrollment?.class ? ` · ${s.enrollment.class}` : ''}` })));
  };
  if (value) return <Field label={label}><div className="ops-inline"><span>{value.label}</span><Button small variant="ghost" onClick={() => onChange(null)}>Change</Button></div></Field>;
  return (
    <Field label={label} hint="Type at least two letters of the name or the admission number">
      <div>
        <input className="input" value={q} onChange={(e) => void search(e.target.value)} style={{ width: '100%' }} />
        {rows.length > 0 && <div className="ops-list">{rows.map((r) => <button key={r.id} type="button" className="ops-row ops-row-link" onClick={() => { onChange(r); setRows([]); setQ(''); }}><span className="ops-row-title">{r.label}</span></button>)}</div>}
      </div>
    </Field>
  );
}

function Briefing({ lines, note }: { lines: string[]; note?: string }) {
  return (
    <SectionCard title="Briefing" sub={note ?? 'Counts from the records, worked out just now.'}>
      <ul className="p4s-brief">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
    </SectionCard>
  );
}

const Table = ({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) => (
  rows.length ? (
    <div className="ops-table-wrap"><table className="ops-table data-table data-table-cards"><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} data-label={head[j]}>{c}</td>)}</tr>)}</tbody></table></div>
  ) : <p className="ops-muted">{empty}</p>
);

/* ══ Library desk ════════════════════════════════════════════════════ */

type LibBrief = { lines: string[]; evidence: Record<string, number> };
type Overdue = { id: string; bookTitle: string; studentName: string; admissionNo: string | null; className: string | null; dueAt: string; daysLate: number; fineSoFarRupees: number; remindedOn: string | null };
type Hold = { id: string; bookId: string; bookTitle: string | null; studentId: string; studentName: string; status: string; position: number | null; readyUntil: string | null; placedAt: string };
type Fines = { items: Array<{ id: string; bookTitle: string; studentName: string; returnedAt: string | null; fineRupees: number; fineStatus: string; note: string | null }>; totalDueRupees: number };
type Challenge = { id: string; title: string; startsOn: string; endsOn: string; targetBooks: number; categories: string[]; status: string; sectionIds: string[] };
type Progress = { challenge: Challenge; participants: number; completed: number; started: number; rows: Array<{ studentId: string; name: string; className: string | null; read: number; completed: boolean; titles: string[] }> };
type Insights = { days: number; loans: number; activeReaders: number; readerShare: number; onTimeReturnRate: number | null; openHolds: number; finesDueRupees: number; popular: Array<{ title: string; author: string; loans: number }>; byCategory: Array<{ category: string; loans: number }>; byClass: Array<{ className: string; loans: number }>; idleTitles: number; idleSample: Array<{ title: string; category: string; copies: number }> };
type Suggest = { student: string; className: string | null; basedOn: { loans: number; favouriteCategories: string[] }; suggestions: Array<{ bookId: string; title: string; author: string; category: string; reasons: string[] }> };
type BookRow = { id: string; title: string; author: string; availableCopies?: number };

type LibTab = 'brief' | 'overdue' | 'holds' | 'fines' | 'reading' | 'insights' | 'suggest';

export function LibraryDeskView() {
  const [tab, setTab] = useState<LibTab>('brief');
  const brief = useLoad(() => get<LibBrief>('/library/desk/briefing'), []);
  const ev = brief.data?.evidence;
  return (
    <>
      <Tabs<LibTab> value={tab} onChange={setTab} tabs={[
        { key: 'brief', label: 'Today' }, { key: 'overdue', label: 'Overdue', count: ev?.overdue }, { key: 'holds', label: 'Reservations', count: (ev?.holdsReady ?? 0) + (ev?.holdsQueued ?? 0) },
        { key: 'fines', label: 'Fines' }, { key: 'reading', label: 'Reading programme' }, { key: 'insights', label: 'Insights' }, { key: 'suggest', label: 'Suggest a book' },
      ]} />
      {tab === 'brief' && <Loadable state={brief}>{(b) => (<>
        <div className="kpi-grid">
          <Tile label="Overdue loans" value={b.evidence.overdue} tone={b.evidence.overdue ? 'warn' : 'good'} />
          <Tile label="Ready to collect" value={b.evidence.holdsReady} />
          <Tile label="In queues" value={b.evidence.holdsQueued} />
          <Tile label="Fines unsettled" value={`₹${b.evidence.finesDueRupees}`} tone={b.evidence.finesDueRupees ? 'warn' : 'neutral'} />
          <Tile label="Loans, 30 days" value={b.evidence.loans30d} />
        </div>
        <Briefing lines={b.lines} />
      </>)}</Loadable>}
      {tab === 'overdue' && <OverdueTab onChange={() => void brief.reload()} />}
      {tab === 'holds' && <HoldsTab onChange={() => void brief.reload()} />}
      {tab === 'fines' && <FinesTab />}
      {tab === 'reading' && <ReadingTab />}
      {tab === 'insights' && <InsightsTab />}
      {tab === 'suggest' && <SuggestTab />}
    </>
  );
}

function OverdueTab({ onChange }: { onChange: () => void }) {
  const state = useLoad(() => get<Overdue[]>('/library/desk/overdue'), []);
  const { run, busy, error } = useAction();
  const toast = useToast();
  const today = isoDay();
  const remind = () => run(async () => {
    const r = await post<{ reminded: number; alreadyToday: number }>('/library/desk/overdue/remind', {});
    toast(`Reminded ${r.reminded} borrower(s)${r.alreadyToday ? `; ${r.alreadyToday} already reminded today` : ''}`, 'success');
    await state.reload(); onChange();
  });
  return (
    <SectionCard title="Overdue loans" sub="Fine so far at ₹5 a day after the due day; the fine is fixed when the book comes back." actions={<Button disabled={busy || !state.data?.some((r) => r.remindedOn !== today)} onClick={() => void remind()}>Remind borrowers</Button>}>
      <ErrorNote error={error} />
      <Loadable state={state}>{(rows) => <Table head={['Book', 'Student', 'Class', 'Due', 'Late', 'Fine so far', 'Reminded']} empty="No loans are overdue." rows={rows.map((r) => [r.bookTitle, `${r.studentName}${r.admissionNo ? ` (${r.admissionNo})` : ''}`, r.className ?? '—', ymd(r.dueAt), `${r.daysLate} d`, `₹${r.fineSoFarRupees}`, r.remindedOn === today ? 'Today' : (r.remindedOn ?? '—')])} />}</Loadable>
      <DataNote>Reminders go to the student and their guardians in the app (and WhatsApp when the school&apos;s messaging is connected), at most once a day per loan.</DataNote>
    </SectionCard>
  );
}

function HoldsTab({ onChange }: { onChange: () => void }) {
  const state = useLoad(() => get<Hold[]>('/library/desk/holds', { status: 'OPEN' }), []);
  const [placing, setPlacing] = useState(false);
  const [cancel, setCancel] = useState<Hold | null>(null);
  const { run, busy, error } = useAction();
  const toast = useToast();
  const reload = async () => { await state.reload(); onChange(); };
  return (
    <SectionCard title="Reservations" sub="A returned copy is set aside for the first in line for three days; the family is told it is ready." actions={<Button onClick={() => setPlacing(true)}>Reserve a book</Button>}>
      <ErrorNote error={error} />
      <Loadable state={state}>{(rows) => <Table head={['Book', 'Student', 'Status', 'Placed', '']} empty="No open reservations." rows={rows.map((h) => [
        h.bookTitle ?? '—', h.studentName, h.status === 'READY' ? <Pill tone="green">Ready until {ymd(h.readyUntil)}</Pill> : <Pill tone="blue">Queue #{h.position}</Pill>, ymd(h.placedAt),
        <span key="a" className="ops-inline">
          {h.status === 'READY' && <Button small disabled={busy} onClick={() => void run(async () => { await post(`/library/desk/holds/${h.id}/collect`, {}); toast('Issued', 'success'); await reload(); })}>Lend now</Button>}
          <Button small variant="ghost" onClick={() => setCancel(h)}>Cancel</Button>
        </span>,
      ])} />}</Loadable>
      {placing && <PlaceHold onClose={() => setPlacing(false)} onSaved={() => void reload()} />}
      {cancel && <PromptModal title="Cancel reservation" label="Reason (optional)" required={false} onClose={() => setCancel(null)} onSubmit={(note) => post(`/library/desk/holds/${cancel.id}/cancel`, { note }).then(reload)} />}
    </SectionCard>
  );
}

function PlaceHold({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [student, setStudent] = useState<Pick | null>(null);
  const [q, setQ] = useState('');
  const [books, setBooks] = useState<BookRow[]>([]);
  const [book, setBook] = useState<BookRow | null>(null);
  const { run, busy, error } = useAction();
  const find = async (text: string) => {
    setQ(text);
    if (text.trim().length < 2) { setBooks([]); return; }
    const res = await get<BookRow[] | { items: BookRow[] }>('/library/books', { search: text.trim(), resourceType: 'PHYSICAL' }).catch(() => []);
    setBooks((Array.isArray(res) ? res : res.items ?? []).slice(0, 8));
  };
  return (
    <Modal title="Reserve a book" onClose={onClose} footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy || !student || !book} onClick={() => void run(async () => { await post('/library/desk/holds', { bookId: book!.id, studentId: student!.id }); onSaved(); onClose(); })}>Reserve</Button></>}>
      <ErrorNote error={error} />
      <StudentPicker value={student} onChange={setStudent} />
      {book ? <Field label="Book"><div className="ops-inline"><span>{book.title}</span><Button small variant="ghost" onClick={() => setBook(null)}>Change</Button></div></Field> : (
        <Field label="Book" hint="Type part of the title">
          <div>
            <input className="input" value={q} onChange={(e) => void find(e.target.value)} style={{ width: '100%' }} />
            {books.length > 0 && <div className="ops-list">{books.map((b) => <button key={b.id} type="button" className="ops-row ops-row-link" onClick={() => { setBook(b); setBooks([]); }}><span className="ops-row-title">{b.title} · {b.author}{b.availableCopies !== undefined ? ` · ${b.availableCopies} on shelf` : ''}</span></button>)}</div>}
          </div>
        </Field>
      )}
    </Modal>
  );
}

function FinesTab() {
  const [status, setStatus] = useState<'DUE' | 'ALL'>('DUE');
  const state = useLoad(() => get<Fines>('/library/desk/fines', { status }), [status]);
  const [waive, setWaive] = useState<string | null>(null);
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <SectionCard title="Fines" sub={state.data ? `₹${state.data.totalDueRupees} not yet settled` : undefined} actions={<select className="input" value={status} onChange={(e) => setStatus(e.target.value as 'DUE' | 'ALL')}><option value="DUE">Unsettled</option><option value="ALL">All</option></select>}>
      <ErrorNote error={error} />
      <Loadable state={state}>{(f) => <Table head={['Book', 'Student', 'Returned', 'Fine', 'Status', '']} empty="No fines." rows={f.items.map((r) => [
        r.bookTitle, r.studentName, ymd(r.returnedAt), `₹${r.fineRupees}`, humanize(r.fineStatus),
        r.fineStatus === 'DUE' ? <span key="a" className="ops-inline"><Button small disabled={busy} onClick={() => void run(async () => { await post(`/library/desk/loans/${r.id}/fine`, { status: 'PAID' }); toast('Marked paid', 'success'); await state.reload(); })}>Paid</Button><Button small variant="ghost" onClick={() => setWaive(r.id)}>Waive</Button></span> : (r.note ?? ''),
      ])} />}</Loadable>
      {waive && <PromptModal title="Waive fine" label="Reason (kept in the audit trail)" onClose={() => setWaive(null)} onSubmit={(note) => post(`/library/desk/loans/${waive}/fine`, { status: 'WAIVED', note }).then(() => state.reload())} />}
    </SectionCard>
  );
}

function ReadingTab() {
  const list = useLoad(() => get<Challenge[]>('/library/desk/challenges'), []);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const progress = useLoad(() => (open ? get<Progress>(`/library/desk/challenges/${open}`) : Promise.resolve(null)), [open]);
  return (
    <>
      <SectionCard title="Reading challenges" sub="Books borrowed and returned in the window count. Students see only their own progress." actions={<Button onClick={() => setCreating(true)}>New challenge</Button>}>
        <Loadable state={list}>{(rows) => <Table head={['Challenge', 'Window', 'Target', 'Status', '']} empty="No reading challenge yet. Start one for a class or the whole school." rows={rows.map((c) => [c.title, `${c.startsOn} → ${c.endsOn}`, `${c.targetBooks} book(s)${c.categories.length ? ` · ${c.categories.join(', ')}` : ''}`, humanize(c.status), <Button key="v" small variant="ghost" onClick={() => setOpen(c.id)}>Progress</Button>])} />}</Loadable>
      </SectionCard>
      {open && <Loadable state={progress}>{(p) => p && (
        <SectionCard title={p.challenge.title} sub={`${p.completed} of ${p.participants} completed · ${p.started} started`}>
          <Table head={['Student', 'Class', 'Read', 'Books']} empty="Nobody is taking part." rows={p.rows.filter((r) => r.read > 0).concat(p.rows.filter((r) => r.read === 0)).slice(0, 300).map((r) => [r.name, r.className ?? '—', r.completed ? <Pill key="d" tone="green">{r.read} ✓</Pill> : String(r.read), r.titles.join(', ') || '—'])} />
        </SectionCard>
      )}</Loadable>}
      {creating && <NewChallenge onClose={() => setCreating(false)} onSaved={() => void list.reload()} />}
    </>
  );
}

function NewChallenge({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const sections = useLoad(() => api.allSections(), []);
  const [f, setF] = useState({ title: '', startsOn: isoDay(), endsOn: '', targetBooks: '5', categories: '', sectionIds: [] as string[] });
  const { run, busy, error } = useAction();
  return (
    <Modal title="New reading challenge" onClose={onClose} footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.title || !f.endsOn} onClick={() => void run(async () => {
      await post('/library/desk/challenges', { title: f.title, startsOn: f.startsOn, endsOn: f.endsOn, targetBooks: Number(f.targetBooks), sectionIds: f.sectionIds, categories: f.categories.split(',').map((x) => x.trim()).filter(Boolean) });
      onSaved(); onClose();
    })}>Start</Button></>}>
      <ErrorNote error={error} />
      <div className="ops-form-grid">
        <Field label="Title" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Read 5 books this term" /></Field>
        <Field label="Books to read" required><input className="input" type="number" min={1} max={100} value={f.targetBooks} onChange={(e) => setF({ ...f, targetBooks: e.target.value })} /></Field>
        <Field label="Starts" required><input className="input" type="date" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} /></Field>
        <Field label="Ends" required><input className="input" type="date" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} /></Field>
        <Field label="Only these categories" hint="Comma-separated; leave empty for any book"><input className="input" value={f.categories} onChange={(e) => setF({ ...f, categories: e.target.value })} /></Field>
      </div>
      <Field label="Classes taking part" hint="Leave all unticked for every student">
        <div className="p4s-checks">{(sections.data ?? []).map((s) => (
          <label key={s.id}><input type="checkbox" checked={f.sectionIds.includes(s.id)} onChange={(e) => setF({ ...f, sectionIds: e.target.checked ? [...f.sectionIds, s.id] : f.sectionIds.filter((x) => x !== s.id) })} /> {s.gradeName} {s.name}</label>
        ))}</div>
      </Field>
    </Modal>
  );
}

function InsightsTab() {
  const [days, setDays] = useState(90);
  const state = useLoad(() => get<Insights>('/library/desk/insights', { days }), [days]);
  return (
    <Loadable state={state}>{(i) => (<>
      <div className="ops-inline" style={{ marginBottom: 12 }}><select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last year</option></select></div>
      <div className="kpi-grid">
        <Tile label="Loans" value={i.loans} /><Tile label="Active readers" value={`${i.activeReaders} (${i.readerShare}%)`} />
        <Tile label="Returned on time" value={i.onTimeReturnRate === null ? '—' : `${i.onTimeReturnRate}%`} /><Tile label="Idle titles (1 year)" value={i.idleTitles} tone={i.idleTitles ? 'warn' : 'neutral'} />
      </div>
      <div className="p4s-two">
        <SectionCard title="Most borrowed"><Table head={['Title', 'Author', 'Loans']} empty="No loans in this period." rows={i.popular.map((p) => [p.title, p.author, String(p.loans)])} /></SectionCard>
        <SectionCard title="By class"><Table head={['Class', 'Loans']} empty="—" rows={i.byClass.map((c) => [c.className, String(c.loans)])} /></SectionCard>
        <SectionCard title="By category"><Table head={['Category', 'Loans']} empty="—" rows={i.byCategory.map((c) => [c.category, String(c.loans)])} /></SectionCard>
        <SectionCard title="Not borrowed in a year" sub="Candidates for a display, a reading-list push, or a weeding review."><Table head={['Title', 'Category', 'Copies']} empty="Every title has been borrowed this year." rows={i.idleSample.map((b) => [b.title, b.category, String(b.copies)])} /></SectionCard>
      </div>
    </>)}</Loadable>
  );
}

function SuggestTab() {
  const [student, setStudent] = useState<Pick | null>(null);
  const state = useLoad(() => (student ? get<Suggest>(`/library/desk/suggestions/${student.id}`) : Promise.resolve(null)), [student?.id]);
  return (
    <SectionCard title="Suggest a next read" sub="Each suggestion shows why; it is a starting point for a conversation with the student.">
      <StudentPicker value={student} onChange={setStudent} />
      {student && <Loadable state={state}>{(s) => s && (s.suggestions.length ? (
        <div className="ops-list">{s.suggestions.map((b) => <div key={b.bookId} className="ops-row"><div className="ops-row-main"><span className="ops-row-title">{b.title} · {b.author}</span><span className="ops-row-sub">{b.reasons.join(' · ')}</span></div></div>)}</div>
      ) : <p className="ops-muted">Not enough borrowing history for {s.student} yet ({s.basedOn.loans} loan(s)).</p>)}</Loadable>}
    </SectionCard>
  );
}

/* ══ Hostel life ═════════════════════════════════════════════════════ */

type HBrief = { lines: string[]; tonightTaken: boolean; evidence: { residents: number; away: number; meals: number; lateReturns: number; outpassesPending: number; openIncidents: number } };
type RollEntry = { studentId: string; name: string; roomNo: string | null; status: string; outPassRef: string | null; note: string | null };
type Roll = { id: string; date: string; session: string; block: string; submittedAt: string | null; counts: Record<string, number>; total: number; unaccounted: number; entries: RollEntry[] };
type Menu = { weekStart: string; days: Array<{ day: number; date: string; breakfast: string; lunch: string; snacks: string; dinner: string }>; notes: string | null; saved: boolean };
type Diet = { residents: number; withAllergies: number; rows: Array<{ studentId: string; name: string; roomNo: string | null; allergies: string[] }> };
type Incident = { id: string; refNo: string; students: Array<{ id: string; name: string }>; category: string; severity: string; occurredAt: string; description: string; actionTaken: string | null; status: string; resolution: string | null; referredToSafeguarding: boolean; parentContacts: Array<{ id: string; at: string; guardianName: string | null; channel: string; summary: string; by: string | null }> };
type Resident = { studentId: string; name: string; roomNo: string | null };

const ROLL_TONE: Record<string, 'green' | 'blue' | 'amber' | 'red' | 'gray'> = { PRESENT: 'green', LATE: 'amber', ON_LEAVE: 'blue', SICK_BAY: 'blue', ABSENT: 'red', UNMARKED: 'gray' };
type HTab = 'tonight' | 'mess' | 'incidents';

export function HostelLifeView() {
  const [tab, setTab] = useState<HTab>('tonight');
  const brief = useLoad(() => get<HBrief>('/hostel/life/briefing'), []);
  return (
    <>
      <Tabs<HTab> value={tab} onChange={setTab} tabs={[{ key: 'tonight', label: 'Roll call' }, { key: 'mess', label: 'Mess' }, { key: 'incidents', label: 'Incidents', count: brief.data?.evidence.openIncidents }]} />
      {tab === 'tonight' && <>
        <Loadable state={brief}>{(b) => (<>
          <div className="kpi-grid">
            <Tile label="Residents" value={b.evidence.residents} /><Tile label="Away (out-pass)" value={b.evidence.away} />
            <Tile label="Late returns" value={b.evidence.lateReturns} tone={b.evidence.lateReturns ? 'bad' : 'good'} href="/outpass" />
            <Tile label="Out-passes to decide" value={b.evidence.outpassesPending} tone={b.evidence.outpassesPending ? 'warn' : 'neutral'} href="/outpass" />
          </div>
          <Briefing lines={b.lines} />
        </>)}</Loadable>
        <RollCallCard onChange={() => void brief.reload()} />
      </>}
      {tab === 'mess' && <MessTab />}
      {tab === 'incidents' && <IncidentsTab onChange={() => void brief.reload()} />}
    </>
  );
}

function RollCallCard({ onChange }: { onChange: () => void }) {
  const [session, setSession] = useState<'NIGHT' | 'MORNING'>('NIGHT');
  const [date, setDate] = useState(isoDay());
  const [roll, setRoll] = useState<Roll | null>(null);
  const [filter, setFilter] = useState('');
  const { run, busy, error } = useAction();
  const toast = useToast();
  const open = () => run(async () => setRoll(await post<Roll>('/hostel/life/rollcalls', { date, session })));
  const mark = (studentId: string, status: string) => run(async () => setRoll(await post<Roll>(`/hostel/life/rollcalls/${roll!.id}/mark`, { entries: [{ studentId, status }] })));
  const allPresent = () => run(async () => setRoll(await post<Roll>(`/hostel/life/rollcalls/${roll!.id}/mark`, { allPresent: true })));
  const submit = () => run(async () => { const r = await post<Roll>(`/hostel/life/rollcalls/${roll!.id}/submit`, {}); setRoll(r); toast(r.unaccounted ? `${r.unaccounted} not accounted for: wardens and the principal alerted` : 'Everyone accounted for', r.unaccounted ? 'error' : 'success'); onChange(); });
  const shown = (roll?.entries ?? []).filter((e) => !filter || e.name.toLowerCase().includes(filter.toLowerCase()) || String(e.roomNo ?? '').includes(filter));
  return (
    <SectionCard title="Roll call" sub={roll ? `${roll.session.toLowerCase()} ${roll.date} · ${roll.counts.PRESENT + roll.counts.LATE} present · ${roll.counts.ON_LEAVE} on leave · ${roll.counts.UNMARKED} unmarked${roll.submittedAt ? ` · submitted ${fmtDateTime(roll.submittedAt)}` : ''}` : 'Residents out on an out-pass are marked on leave for you.'}
      actions={<span className="ops-inline">
        <input className="input" type="date" value={date} onChange={(e) => { setDate(e.target.value); setRoll(null); }} />
        <select className="input" value={session} onChange={(e) => { setSession(e.target.value as 'NIGHT' | 'MORNING'); setRoll(null); }}><option value="NIGHT">Night</option><option value="MORNING">Morning</option></select>
        <Button disabled={busy} onClick={() => void open()}>{roll ? 'Refresh' : 'Open roll call'}</Button>
      </span>}>
      <ErrorNote error={error} />
      {roll && <>
        <div className="ops-inline" style={{ marginBottom: 10 }}>
          <input className="input" placeholder="Find by name or room" value={filter} onChange={(e) => setFilter(e.target.value)} />
          {!roll.submittedAt && <Button variant="soft" disabled={busy || !roll.counts.UNMARKED} onClick={() => void allPresent()}>Mark everyone else present</Button>}
          {!roll.submittedAt && <Button disabled={busy} onClick={() => void submit()}>Submit</Button>}
        </div>
        <div className="p4s-roll">{shown.map((e) => (
          <div key={e.studentId} className="p4s-roll-row">
            <div><strong>{e.name}</strong><span className="ops-muted"> · room {e.roomNo ?? '—'}{e.outPassRef ? ` · ${e.outPassRef}` : ''}</span></div>
            <div className="ops-inline">
              <Pill tone={ROLL_TONE[e.status] ?? 'gray'}>{humanize(e.status)}</Pill>
              {!roll.submittedAt && ['PRESENT', 'ABSENT', 'SICK_BAY'].map((st) => <Button key={st} small variant={e.status === st ? 'accent' : 'ghost'} disabled={busy} onClick={() => void mark(e.studentId, st)}>{humanize(st)}</Button>)}
              {roll.submittedAt && ['ABSENT', 'UNMARKED'].includes(e.status) && <Button small disabled={busy} onClick={() => void mark(e.studentId, 'LATE')}>Arrived</Button>}
            </div>
          </div>
        ))}</div>
      </>}
    </SectionCard>
  );
}

function MessTab() {
  const [week, setWeek] = useState(isoDay());
  const menu = useLoad(() => get<Menu>('/hostel/life/mess/menu', { week }), [week]);
  const hc = useLoad(() => get<{ date: string; residents: number; away: number; meals: number }>('/hostel/life/mess/headcount'), []);
  const [showDiet, setShowDiet] = useState(false);
  const diet = useLoad(() => (showDiet ? get<Diet>('/hostel/life/mess/diet') : Promise.resolve(null)), [showDiet]);
  const [draft, setDraft] = useState<Menu['days'] | null>(null);
  const { run, busy, error } = useAction();
  const toast = useToast();
  const days = draft ?? menu.data?.days ?? [];
  const meals = ['breakfast', 'lunch', 'snacks', 'dinner'] as const;
  return (
    <>
      <Loadable state={hc}>{(h) => <div className="kpi-grid"><Tile label="Meals tonight" value={h.meals} /><Tile label="Residents" value={h.residents} /><Tile label="Away" value={h.away} /></div>}</Loadable>
      <SectionCard title={`Menu · week of ${menu.data?.weekStart ?? ''}`} actions={<span className="ops-inline">
        <input className="input" type="date" value={week} onChange={(e) => { setWeek(e.target.value); setDraft(null); }} />
        {draft ? <Button disabled={busy} onClick={() => void run(async () => { await put('/hostel/life/mess/menu', { week, days: draft.map((d) => ({ day: d.day, breakfast: d.breakfast, lunch: d.lunch, snacks: d.snacks, dinner: d.dinner })) }); setDraft(null); toast('Menu saved', 'success'); await menu.reload(); })}>Save menu</Button>
          : <Button variant="soft" onClick={() => setDraft(menu.data?.days ?? [])}>Edit</Button>}
      </span>}>
        <ErrorNote error={error} />
        <div className="ops-table-wrap"><table className="ops-table data-table data-table-cards"><thead><tr><th>Day</th>{meals.map((m) => <th key={m}>{humanize(m)}</th>)}</tr></thead><tbody>
          {days.map((d, i) => <tr key={d.date}><td data-label="Day">{new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}</td>
            {meals.map((m) => <td key={m} data-label={humanize(m)}>{draft ? <input className="input" value={d[m]} onChange={(e) => setDraft(days.map((x, j) => (j === i ? { ...x, [m]: e.target.value } : x)))} /> : (d[m] || '—')}</td>)}</tr>)}
        </tbody></table></div>
        {!menu.data?.saved && !draft && <p className="ops-muted">No menu saved for this week yet.</p>}
      </SectionCard>
      <SectionCard title="Allergies for the kitchen" sub="From each resident's medical record. Medical data: every view is recorded in the audit trail." actions={!showDiet && <Button variant="soft" onClick={() => setShowDiet(true)}>Show list</Button>}>
        {showDiet && <Loadable state={diet}>{(d) => d && <Table head={['Resident', 'Room', 'Allergies']} empty="No resident has an allergy recorded." rows={d.rows.map((r) => [r.name, r.roomNo ?? '—', r.allergies.join(', ')])} />}</Loadable>}
      </SectionCard>
    </>
  );
}

const INCIDENT_CATEGORIES = ['DISCIPLINE', 'LATE_RETURN', 'PROPERTY_DAMAGE', 'CONFLICT', 'HOMESICKNESS', 'SAFETY', 'HEALTH_REFERRAL', 'OTHER'];

function IncidentsTab({ onChange }: { onChange: () => void }) {
  const [status, setStatus] = useState<'OPEN' | 'RESOLVED' | 'ALL'>('OPEN');
  const state = useLoad(() => get<Incident[]>('/hostel/life/incidents', { status }), [status]);
  const [creating, setCreating] = useState(false);
  const [contact, setContact] = useState<Incident | null>(null);
  const [resolve, setResolve] = useState<Incident | null>(null);
  const reload = async () => { await state.reload(); onChange(); };
  return (
    <SectionCard title="Incidents" sub="Discipline notes and incidents with the record of each conversation with the family." actions={<span className="ops-inline"><select className="input" value={status} onChange={(e) => setStatus(e.target.value as 'OPEN')}><option value="OPEN">Open</option><option value="RESOLVED">Resolved</option><option value="ALL">All</option></select><Button onClick={() => setCreating(true)}>Record incident</Button></span>}>
      <Loadable state={state}>{(rows) => rows.length ? <div className="ops-list">{rows.map((i) => (
        <div key={i.id} className="ops-row">
          <div className="ops-row-main">
            <span className="ops-row-title">{i.refNo} · {i.students.map((s) => s.name).join(', ')} <Pill tone={i.severity === 'HIGH' ? 'red' : i.severity === 'MEDIUM' ? 'amber' : 'gray'}>{humanize(i.severity)}</Pill> {i.referredToSafeguarding && <Pill tone="maroon">Referred to safeguarding</Pill>}</span>
            <span className="ops-row-sub">{humanize(i.category)} · {fmtDateTime(i.occurredAt)} · {i.description}</span>
            {i.parentContacts.map((c) => <span key={c.id} className="ops-row-sub">☎ {fmtDateTime(c.at)} {humanize(c.channel)} {c.guardianName ? `with ${c.guardianName}` : ''}: {c.summary}</span>)}
            {i.resolution && <span className="ops-row-sub">✓ {i.resolution}</span>}
          </div>
          {i.status === 'OPEN' && <div className="ops-inline"><Button small variant="soft" onClick={() => setContact(i)}>Log parent contact</Button><Button small variant="ghost" onClick={() => setResolve(i)}>Resolve</Button></div>}
        </div>
      ))}</div> : <p className="ops-muted">No incidents.</p>}</Loadable>
      {creating && <NewIncident onClose={() => setCreating(false)} onSaved={() => void reload()} />}
      {contact && <ContactModal incident={contact} onClose={() => setContact(null)} onSaved={() => void reload()} />}
      {resolve && <PromptModal title={`Resolve ${resolve.refNo}`} label="How it was resolved" onClose={() => setResolve(null)} onSubmit={(resolution) => post(`/hostel/life/incidents/${resolve.id}/resolve`, { resolution }).then(reload)} />}
    </SectionCard>
  );
}

function NewIncident({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const residents = useLoad(() => get<Resident[]>('/hostel/life/residents'), []);
  const [f, setF] = useState({ studentIds: [] as string[], category: 'DISCIPLINE', severity: 'LOW', description: '', actionTaken: '', location: '', referredToSafeguarding: false });
  const { run, busy, error } = useAction();
  return (
    <Modal title="Record an incident" onClose={onClose} footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.studentIds.length || !f.description} onClick={() => void run(async () => { await post('/hostel/life/incidents', f); onSaved(); onClose(); })}>Record</Button></>}>
      <ErrorNote error={error} />
      <Field label="Residents involved" required><select className="input" multiple size={6} value={f.studentIds} onChange={(e) => setF({ ...f, studentIds: [...e.target.selectedOptions].map((o) => o.value) })}>{(residents.data ?? []).map((r) => <option key={r.studentId} value={r.studentId}>{r.name} · room {r.roomNo ?? '—'}</option>)}</select></Field>
      <div className="ops-form-grid">
        <Field label="Category"><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{INCIDENT_CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select></Field>
        <Field label="Severity"><select className="input" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>{['LOW', 'MEDIUM', 'HIGH'].map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select></Field>
        <Field label="Where"><input className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
      </div>
      <Field label="What happened" required><textarea className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="What was done"><textarea className="input" rows={2} value={f.actionTaken} onChange={(e) => setF({ ...f, actionTaken: e.target.value })} /></Field>
      <label className="ops-inline"><input type="checkbox" checked={f.referredToSafeguarding} onChange={(e) => setF({ ...f, referredToSafeguarding: e.target.checked })} /> This is a safeguarding concern: I am reporting it on the Safeguarding page too</label>
      <DataNote>Do not write safeguarding details here; the designated officer keeps them on the Safeguarding page.</DataNote>
    </Modal>
  );
}

function ContactModal({ incident, onClose, onSaved }: { incident: Incident; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ guardianName: '', channel: 'CALL', summary: '' });
  const { run, busy, error } = useAction();
  return (
    <Modal title={`Parent contact · ${incident.refNo}`} onClose={onClose} footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.summary} onClick={() => void run(async () => { await post(`/hostel/life/incidents/${incident.id}/contact`, f); onSaved(); onClose(); })}>Save</Button></>}>
      <ErrorNote error={error} />
      <div className="ops-form-grid">
        <Field label="Spoke with"><input className="input" value={f.guardianName} onChange={(e) => setF({ ...f, guardianName: e.target.value })} /></Field>
        <Field label="How"><select className="input" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>{['CALL', 'WHATSAPP', 'MEETING', 'EMAIL'].map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select></Field>
      </div>
      <Field label="What was said" required><textarea className="input" rows={3} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></Field>
    </Modal>
  );
}

/* ══ Admissions follow-ups ═══════════════════════════════════════════ */

type FRow = { id: string; childName: string; guardianName: string; phone: string; gradeApplying: string | null; source: string; stage: string; nextActionAt: string | null; createdAt: string; assignee: string | null; doNotContact: boolean; score: number; band: string; reasons: string[]; lastTouchAt: string | null; nextAppointmentAt: string | null };
type FQueue = { counts: Record<string, number>; overdue: FRow[]; today: FRow[]; untouched: FRow[]; noNextAction: FRow[]; rules: { firstResponseHours: number; scoring: string } };
type CStat = { profileId: string | null; name: string; leads: number; open: number; overdue: number; enrolled: number; lost: number; conversionPct: number | null; medianFirstResponseHours: number | null };
type FTab = 'overdue' | 'today' | 'untouched' | 'noNextAction' | 'counsellors';
const BAND_TONE: Record<string, 'red' | 'amber' | 'gray'> = { HOT: 'red', WARM: 'amber', COLD: 'gray' };

export function FollowupsView() {
  const [mine, setMine] = useState(false);
  const [tab, setTab] = useState<FTab>('overdue');
  const q = useLoad(() => get<FQueue>('/admissions/followups', { mine }), [mine]);
  const stats = useLoad(() => (tab === 'counsellors' ? get<CStat[]>('/admissions/followups/counsellors') : Promise.resolve(null)), [tab]);
  const [log, setLog] = useState<FRow | null>(null);
  const [why, setWhy] = useState<FRow | null>(null);
  const rows = tab !== 'counsellors' ? (q.data?.[tab] ?? []) : [];
  return (
    <>
      <div className="ops-inline" style={{ marginBottom: 10 }}><label className="ops-inline"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only my enquiries</label></div>
      <Tabs<FTab> value={tab} onChange={setTab} tabs={[
        { key: 'overdue', label: 'Overdue', count: q.data?.counts.overdue }, { key: 'today', label: 'Due today', count: q.data?.counts.today },
        { key: 'untouched', label: 'Never contacted', count: q.data?.counts.untouched }, { key: 'noNextAction', label: 'No next step', count: q.data?.counts.noNextAction },
        { key: 'counsellors', label: 'Counsellors' },
      ]} />
      {tab !== 'counsellors' && <SectionCard title="Follow-ups" sub={q.data ? `Sorted by warmth. ${q.data.rules.scoring} Never contacted = no response ${q.data.rules.firstResponseHours} hours after the enquiry.` : undefined}>
        <Loadable state={q}>{() => <Table head={['Child', 'Family', 'Grade', 'Stage', 'Next action', 'Warmth', '']} empty="Nothing in this list." rows={rows.map((r) => [
          r.childName, <span key="f">{r.guardianName}{r.doNotContact ? <> <Pill tone="maroon">Do not contact</Pill></> : null}</span>, r.gradeApplying ?? '—', humanize(r.stage), r.nextActionAt ? fmtDateTime(r.nextActionAt) : '—',
          <button key="w" type="button" className="p4s-link" onClick={() => setWhy(r)}><Pill tone={BAND_TONE[r.band] ?? 'gray'}>{r.score} {humanize(r.band)}</Pill></button>,
          <Button key="l" small onClick={() => setLog(r)}>Log follow-up</Button>,
        ])} />}</Loadable>
      </SectionCard>}
      {tab === 'counsellors' && <SectionCard title="Counsellors · last 90 days"><Loadable state={stats}>{(s) => s && <Table head={['Counsellor', 'Enquiries', 'Open', 'Overdue', 'Enrolled', 'Lost', 'Conversion', 'First response (median)']} empty="No enquiries." rows={s.map((c) => [c.name, String(c.leads), String(c.open), String(c.overdue), String(c.enrolled), String(c.lost), c.conversionPct === null ? '—' : `${c.conversionPct}%`, c.medianFirstResponseHours === null ? '—' : `${c.medianFirstResponseHours} h`])} />}</Loadable></SectionCard>}
      {why && <Modal title={`Why ${why.score} (${humanize(why.band)}) · ${why.childName}`} onClose={() => setWhy(null)} footer={<Button variant="soft" onClick={() => setWhy(null)}>Close</Button>}>
        <ul className="p4s-brief">{why.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        <DataNote>The score orders the list. It does not move, drop or prioritise an enquiry on its own.</DataNote>
      </Modal>}
      {log && <LogFollowUp row={log} onClose={() => setLog(null)} onSaved={() => void q.reload()} />}
    </>
  );
}

function LogFollowUp({ row, onClose, onSaved }: { row: FRow; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ channel: row.doNotContact ? 'NOTE' : 'CALL', outcome: '', nextActionAt: '', stage: '', lostReason: '' });
  const { run, busy, error } = useAction();
  return (
    <Modal title={`Follow-up · ${row.childName}`} onClose={onClose} footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.outcome || (f.stage === 'LOST' && !f.lostReason)} onClick={() => void run(async () => {
      await post(`/admissions/followups/${row.id}`, { channel: f.channel, outcome: f.outcome, nextActionAt: f.nextActionAt ? new Date(f.nextActionAt).toISOString() : undefined, stage: f.stage || undefined, lostReason: f.lostReason || undefined });
      onSaved(); onClose();
    })}>Save</Button></>}>
      <ErrorNote error={error} />
      {row.doNotContact && <DataNote>This family withdrew consent to be contacted: only a note can be recorded.</DataNote>}
      <div className="ops-form-grid">
        <Field label="How"><select className="input" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>{['CALL', 'WHATSAPP', 'EMAIL', 'VISIT', 'NOTE'].filter((c) => !row.doNotContact || c === 'NOTE' || c === 'VISIT').map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select></Field>
        <Field label="Next action"><input className="input" type="datetime-local" value={f.nextActionAt} onChange={(e) => setF({ ...f, nextActionAt: e.target.value })} /></Field>
        <Field label="Move stage to"><select className="input" value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}><option value="">Keep ({humanize(row.stage)})</option>{['CONTACTED', 'TOUR_SCHEDULED', 'APPLICATION', 'ENROLLED', 'LOST'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select></Field>
      </div>
      <Field label="What happened" required><textarea className="input" rows={3} value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })} /></Field>
      {f.stage === 'LOST' && <Field label="Why lost" required><input className="input" value={f.lostReason} onChange={(e) => setF({ ...f, lostReason: e.target.value })} /></Field>}
    </Modal>
  );
}

/* ══ Data protection and committees ══════════════════════════════════ */

type Ready = { checkedAt: string; tally: Record<string, number>; items: Array<{ area: string; item: string; state: string; evidence: string; where: string }>; note: string };
type DReq = { id: string; refNo: string; kind: string; kindLabel: string; requesterName: string; requesterRelation: string; contact: string | null; studentName: string | null; details: string | null; receivedAt: string; dueAt: string; status: string; identityVerified: boolean; outcome: string | null; overdue: boolean; daysLeft: number | null };
type Breach = { id: string; refNo: string; title: string; discoveredAt: string; affectedCount: number; childrenAffected: boolean; containment: string | null; status: string; boardIntimatedAt: string | null; boardReportAt: string | null; principalsInformedAt: string | null; reportDeadline: string; hoursLeft: number | null; reportOverdue: boolean };
type Committee = { id: string; kind: string; name: string; members: Array<{ name: string; role: string | null; phone: string | null }>; constitutedOn: string | null; reviewDueOn: string | null; lastMeetingOn: string | null; displayedOnWebsite: boolean; displayedOnNoticeBoard: boolean; reviewOverdue: boolean };
const STATE_TONE: Record<string, 'green' | 'amber' | 'red' | 'gray'> = { OK: 'green', SOON: 'amber', ACTION: 'red', MISSING: 'red' };
const KINDS = ['ACCESS', 'CORRECTION', 'ERASURE', 'CONSENT_WITHDRAWAL', 'GRIEVANCE', 'NOMINATION'];
const COMMITTEES = ['POCSO', 'ICC_POSH', 'SCHOOL_SAFETY', 'SMC', 'GRIEVANCE', 'ANTI_BULLYING', 'DISASTER_MANAGEMENT', 'PTA', 'OTHER'];
type DTab = 'readiness' | 'requests' | 'breaches' | 'committees';

export function DataProtectionView() {
  const [tab, setTab] = useState<DTab>('readiness');
  const ov = useLoad(() => get<{ openRequests: number; overdueRequests: number; openBreaches: number; breachesPastClock: number; committees: number; committeesReviewOverdue: number }>('/compliance/privacy/overview'), []);
  return (
    <>
      <Tabs<DTab> value={tab} onChange={setTab} tabs={[{ key: 'readiness', label: 'Readiness' }, { key: 'requests', label: 'Data requests', count: ov.data?.openRequests }, { key: 'breaches', label: 'Breaches', count: ov.data?.openBreaches }, { key: 'committees', label: 'Committees' }]} />
      {tab === 'readiness' && <ReadinessTab />}
      {tab === 'requests' && <RequestsTab onChange={() => void ov.reload()} />}
      {tab === 'breaches' && <BreachesTab onChange={() => void ov.reload()} />}
      {tab === 'committees' && <CommitteesTab />}
    </>
  );
}

function ReadinessTab() {
  const state = useLoad(() => get<Ready>('/compliance/privacy/readiness'), []);
  return (
    <Loadable state={state}>{(r) => (
      <SectionCard title="Readiness checklist" sub={`Checked ${fmtDateTime(r.checkedAt)} · ${r.tally.OK ?? 0} OK · ${(r.tally.ACTION ?? 0) + (r.tally.MISSING ?? 0)} to act on · ${r.tally.SOON ?? 0} soon`}>
        <Table head={['Area', 'Item', 'State', 'What was found']} empty="—" rows={r.items.map((i) => [i.area, i.item, <Pill key="s" tone={STATE_TONE[i.state] ?? 'gray'}>{humanize(i.state)}</Pill>, i.evidence])} />
        <DataNote>{r.note}</DataNote>
      </SectionCard>
    )}</Loadable>
  );
}

function RequestsTab({ onChange }: { onChange: () => void }) {
  const [status, setStatus] = useState('OPEN');
  const state = useLoad(() => get<DReq[]>('/compliance/privacy/requests', { status }), [status]);
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState<{ r: DReq; to: 'COMPLETED' | 'DECLINED' } | null>(null);
  const { run, busy, error } = useAction();
  const reload = async () => { await state.reload(); onChange(); };
  return (
    <SectionCard title="Data principal requests" sub="Rights under the DPDP Act 2023 (access, correction, erasure, consent withdrawal, grievance, nomination). For a child, the parent asks." actions={<span className="ops-inline"><select className="input" value={status} onChange={(e) => setStatus(e.target.value)}><option value="OPEN">Open</option><option value="ALL">All</option></select><Button onClick={() => setCreating(true)}>Log a request</Button></span>}>
      <ErrorNote error={error} />
      <Loadable state={state}>{(rows) => <Table head={['Ref', 'Kind', 'Requester', 'Respond by', 'Status', '']} empty="No requests." rows={rows.map((r) => [
        r.refNo, humanize(r.kind), `${r.requesterName} (${humanize(r.requesterRelation)})${r.studentName ? ` · ${r.studentName}` : ''}`,
        <span key="d">{ymd(r.dueAt)} {r.overdue ? <Pill tone="red">Overdue</Pill> : r.daysLeft !== null ? <span className="ops-muted">{r.daysLeft} d</span> : null}</span>,
        <span key="s">{humanize(r.status)}{r.identityVerified ? ' · ID ✓' : ''}</span>,
        ['RECEIVED', 'IN_PROGRESS'].includes(r.status) ? <span key="a" className="ops-inline">
          {!r.identityVerified && <Button small variant="soft" disabled={busy} onClick={() => void run(async () => { await patch(`/compliance/privacy/requests/${r.id}`, { identityVerified: true }); await reload(); })}>ID verified</Button>}
          {r.status === 'RECEIVED' && <Button small variant="ghost" disabled={busy} onClick={() => void run(async () => { await patch(`/compliance/privacy/requests/${r.id}`, { status: 'IN_PROGRESS' }); await reload(); })}>Start</Button>}
          <Button small disabled={!r.identityVerified} onClick={() => setClosing({ r, to: 'COMPLETED' })}>Complete</Button>
          <Button small variant="ghost" onClick={() => setClosing({ r, to: 'DECLINED' })}>Decline</Button>
        </span> : (r.outcome ?? ''),
      ])} />}</Loadable>
      {creating && <NewRequest onClose={() => setCreating(false)} onSaved={() => void reload()} />}
      {closing && <PromptModal title={`${closing.to === 'COMPLETED' ? 'Complete' : 'Decline'} ${closing.r.refNo}`} label={closing.to === 'COMPLETED' ? 'What was done (given, corrected, erased)' : 'Why it is declined'} onClose={() => setClosing(null)} onSubmit={(outcome) => patch(`/compliance/privacy/requests/${closing.r.id}`, { status: closing.to, outcome }).then(reload)} />}
    </SectionCard>
  );
}

function NewRequest({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ kind: 'ACCESS', requesterName: '', requesterRelation: 'PARENT', contact: '', details: '', receivedAt: isoDay() });
  const { run, busy, error } = useAction();
  return (
    <Modal title="Log a data request" onClose={onClose} footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.requesterName} onClick={() => void run(async () => { await post('/compliance/privacy/requests', f); onSaved(); onClose(); })}>Log</Button></>}>
      <ErrorNote error={error} />
      <div className="ops-form-grid">
        <Field label="Kind"><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{KINDS.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select></Field>
        <Field label="Requester" required><input className="input" value={f.requesterName} onChange={(e) => setF({ ...f, requesterName: e.target.value })} /></Field>
        <Field label="Relation"><select className="input" value={f.requesterRelation} onChange={(e) => setF({ ...f, requesterRelation: e.target.value })}>{['PARENT', 'GUARDIAN', 'SELF', 'NOMINEE'].map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select></Field>
        <Field label="Contact"><input className="input" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} /></Field>
        <Field label="Received on"><input className="input" type="date" value={f.receivedAt} onChange={(e) => setF({ ...f, receivedAt: e.target.value })} /></Field>
      </div>
      <Field label="Details"><textarea className="input" rows={3} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} /></Field>
    </Modal>
  );
}

function BreachesTab({ onChange }: { onChange: () => void }) {
  const state = useLoad(() => get<Breach[]>('/compliance/privacy/breaches'), []);
  const [creating, setCreating] = useState(false);
  const { run, busy, error } = useAction();
  const reload = async () => { await state.reload(); onChange(); };
  const stamp = (b: Breach, field: string, extra: Record<string, unknown> = {}) => run(async () => { await patch(`/compliance/privacy/breaches/${b.id}`, { [field]: new Date().toISOString(), ...extra }); await reload(); });
  return (
    <SectionCard title="Breach register" sub="DPDP Rules 2025: tell the Data Protection Board without delay and send the detailed report within 72 hours of becoming aware. This register records what was done; nothing is sent from here." actions={<Button onClick={() => setCreating(true)}>Log a breach</Button>}>
      <ErrorNote error={error} />
      <Loadable state={state}>{(rows) => rows.length ? <div className="ops-list">{rows.map((b) => (
        <div key={b.id} className="ops-row">
          <div className="ops-row-main">
            <span className="ops-row-title">{b.refNo} · {b.title} <Pill tone={b.status === 'CLOSED' ? 'gray' : 'amber'}>{humanize(b.status)}</Pill> {b.childrenAffected && <Pill tone="maroon">Children</Pill>}</span>
            <span className="ops-row-sub">Discovered {fmtDateTime(b.discoveredAt)} · {b.affectedCount} affected · Board report {b.boardReportAt ? `sent ${fmtDateTime(b.boardReportAt)}` : b.reportOverdue ? <strong className="ops-flag-overdue">past the 72-hour clock</strong> : `due within ${b.hoursLeft} h`}</span>
            <span className="ops-row-sub">Board intimated: {b.boardIntimatedAt ? fmtDateTime(b.boardIntimatedAt) : '—'} · People informed: {b.principalsInformedAt ? fmtDateTime(b.principalsInformedAt) : '—'}</span>
          </div>
          {b.status !== 'CLOSED' && <div className="ops-inline">
            {!b.boardIntimatedAt && <Button small variant="soft" disabled={busy} onClick={() => void stamp(b, 'boardIntimatedAt')}>Board told now</Button>}
            {!b.principalsInformedAt && <Button small variant="soft" disabled={busy} onClick={() => void stamp(b, 'principalsInformedAt')}>People informed now</Button>}
            {!b.boardReportAt && <Button small disabled={busy} onClick={() => void stamp(b, 'boardReportAt')}>Report sent now</Button>}
            {b.boardReportAt && <Button small variant="ghost" disabled={busy} onClick={() => void run(async () => { await patch(`/compliance/privacy/breaches/${b.id}`, { status: 'CLOSED' }); await reload(); })}>Close</Button>}
          </div>}
        </div>
      ))}</div> : <p className="ops-muted">No breaches recorded.</p>}</Loadable>
      {creating && <NewBreach onClose={() => setCreating(false)} onSaved={() => void reload()} />}
    </SectionCard>
  );
}

function NewBreach({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ title: '', discoveredAt: '', description: '', dataCategories: '', affectedCount: '', childrenAffected: false, containment: '' });
  const { run, busy, error } = useAction();
  return (
    <Modal title="Log a data breach" onClose={onClose} footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.title} onClick={() => void run(async () => {
      await post('/compliance/privacy/breaches', { ...f, discoveredAt: f.discoveredAt ? new Date(f.discoveredAt).toISOString() : undefined, affectedCount: Number(f.affectedCount) || 0, dataCategories: f.dataCategories.split(',').map((x) => x.trim()).filter(Boolean) });
      onSaved(); onClose();
    })}>Log and start the clock</Button></>}>
      <ErrorNote error={error} />
      <Field label="What happened" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <div className="ops-form-grid">
        <Field label="Discovered at" hint="Leave empty for now"><input className="input" type="datetime-local" value={f.discoveredAt} onChange={(e) => setF({ ...f, discoveredAt: e.target.value })} /></Field>
        <Field label="People affected"><input className="input" type="number" min={0} value={f.affectedCount} onChange={(e) => setF({ ...f, affectedCount: e.target.value })} /></Field>
        <Field label="Data involved" hint="e.g. names, marks, phone numbers"><input className="input" value={f.dataCategories} onChange={(e) => setF({ ...f, dataCategories: e.target.value })} /></Field>
      </div>
      <label className="ops-inline"><input type="checkbox" checked={f.childrenAffected} onChange={(e) => setF({ ...f, childrenAffected: e.target.checked })} /> Children&apos;s data is involved</label>
      <Field label="Details"><textarea className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="Containment so far"><textarea className="input" rows={2} value={f.containment} onChange={(e) => setF({ ...f, containment: e.target.value })} /></Field>
    </Modal>
  );
}

function CommitteesTab() {
  const state = useLoad(() => get<Committee[]>('/compliance/privacy/committees'), []);
  const [edit, setEdit] = useState<Committee | 'new' | null>(null);
  return (
    <SectionCard title="Statutory committees" sub="POCSO, Internal Committee (POSH), school safety, SMC (RTE), grievance and others: who is on them, when they were constituted and are due for review, and whether they are displayed." actions={<Button onClick={() => setEdit('new')}>Add committee</Button>}>
      <Loadable state={state}>{(rows) => <Table head={['Committee', 'Members', 'Constituted', 'Review by', 'Displayed', '']} empty="No committees recorded yet." rows={rows.map((c) => [
        <span key="n">{c.name} <span className="ops-muted">({humanize(c.kind)})</span></span>, c.members.map((m) => `${m.name}${m.role ? ` (${m.role})` : ''}`).join(', ') || '—', fmtDate(c.constitutedOn),
        <span key="r">{fmtDate(c.reviewDueOn)} {c.reviewOverdue && <Pill tone="red">Overdue</Pill>}</span>, [c.displayedOnWebsite && 'Website', c.displayedOnNoticeBoard && 'Notice board'].filter(Boolean).join(', ') || 'No',
        <Button key="e" small variant="ghost" onClick={() => setEdit(c)}>Edit</Button>,
      ])} />}</Loadable>
      {edit && <CommitteeModal committee={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => void state.reload()} />}
    </SectionCard>
  );
}

function CommitteeModal({ committee, onClose, onSaved }: { committee: Committee | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    kind: committee?.kind ?? 'POCSO', name: committee?.name ?? '', members: (committee?.members ?? []).map((m) => [m.name, m.role ?? '', m.phone ?? ''].join(' | ')).join('\n'),
    constitutedOn: committee?.constitutedOn?.slice(0, 10) ?? '', reviewDueOn: committee?.reviewDueOn?.slice(0, 10) ?? '', lastMeetingOn: committee?.lastMeetingOn?.slice(0, 10) ?? '',
    displayedOnWebsite: committee?.displayedOnWebsite ?? false, displayedOnNoticeBoard: committee?.displayedOnNoticeBoard ?? false,
  });
  const { run, busy, error } = useAction();
  const body = () => ({
    ...f, name: f.name || undefined, constitutedOn: f.constitutedOn || undefined, reviewDueOn: f.reviewDueOn || undefined, lastMeetingOn: f.lastMeetingOn || undefined,
    members: f.members.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((p) => p[0]).map(([name, role, phone]) => ({ name, role: role || undefined, phone: phone || undefined })),
  });
  return (
    <Modal title={committee ? `Edit ${committee.name}` : 'Add a committee'} onClose={onClose} footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={() => void run(async () => { if (committee) await patch(`/compliance/privacy/committees/${committee.id}`, body()); else await post('/compliance/privacy/committees', body()); onSaved(); onClose(); })}>Save</Button></>}>
      <ErrorNote error={error} />
      <div className="ops-form-grid">
        <Field label="Kind"><select className="input" value={f.kind} disabled={Boolean(committee)} onChange={(e) => setF({ ...f, kind: e.target.value })}>{COMMITTEES.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select></Field>
        <Field label="Name" hint="Defaults to the usual name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Constituted on"><input className="input" type="date" value={f.constitutedOn} onChange={(e) => setF({ ...f, constitutedOn: e.target.value })} /></Field>
        <Field label="Review by" hint="Default a year after constitution"><input className="input" type="date" value={f.reviewDueOn} onChange={(e) => setF({ ...f, reviewDueOn: e.target.value })} /></Field>
        <Field label="Last meeting"><input className="input" type="date" value={f.lastMeetingOn} onChange={(e) => setF({ ...f, lastMeetingOn: e.target.value })} /></Field>
      </div>
      <Field label="Members" hint="One per line: name | role | phone"><textarea className="input" rows={5} value={f.members} onChange={(e) => setF({ ...f, members: e.target.value })} /></Field>
      <label className="ops-inline"><input type="checkbox" checked={f.displayedOnWebsite} onChange={(e) => setF({ ...f, displayedOnWebsite: e.target.checked })} /> Displayed on the school website</label>
      <label className="ops-inline"><input type="checkbox" checked={f.displayedOnNoticeBoard} onChange={(e) => setF({ ...f, displayedOnNoticeBoard: e.target.checked })} /> Displayed on the notice board</label>
    </Modal>
  );
}

/* ── A briefing card for the librarian's and warden's home pages ─────── */
export function SupportBriefCard({ kind }: { kind: 'library' | 'hostel' }) {
  const link = useSchoolHref();
  const conf = kind === 'library'
    ? { path: '/library/desk/briefing', title: 'Library desk today', href: '/librarian/library-desk', open: 'Open the library desk' }
    : { path: '/hostel/life/briefing', title: 'Hostel tonight', href: '/warden/hostel-life', open: 'Open roll call and hostel life' };
  const state = useLoad(() => get<{ lines: string[]; tonightTaken?: boolean }>(conf.path), [conf.path]);
  if (state.error || !state.data) return null;
  return (
    <SectionCard title={conf.title} sub={kind === 'hostel' && state.data.tonightTaken === false ? 'Tonight’s roll call has not been taken yet.' : 'Counts from the records, worked out just now.'} actions={<Link className="btn btn-soft btn-sm" href={link(conf.href)}>{conf.open}</Link>}>
      <ul className="p4s-brief">{state.data.lines.map((l) => <li key={l}>{l}</li>)}</ul>
    </SectionCard>
  );
}
