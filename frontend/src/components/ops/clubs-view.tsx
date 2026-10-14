'use client';
import { useMemo, useState, type ReactNode } from 'react';
import { Button, EmptyState, Field, Modal, useToast } from '@/components/ui';
import { usePermissions } from '@/lib/permissions';
import { useAuth } from '@/lib/auth';
import {
  clubsApi, type Club, type ClubOptions, type ClubSession, type EquipmentIssue, type Fixture, type Membership, type MyStudent, type Portfolio,
} from '@/lib/clubs-api';
import { Drawer } from './drawer';
import {
  DataNote, ErrorNote, KeyValues, Loadable, PromptModal, SectionCard, StatusPill, Tabs, Tile, fmtDate, fmtDateTime, humanize, isoDay, useAction, useLoad,
} from './kit';

/**
 * Clubs, teams and houses.
 *
 * Staff (clubs.manage): run their clubs — requests to decide, sessions and the
 * register, fixtures and results (a second teacher approves), houses, kit.
 * Families (clubs.join): browse, ask to join for a child (a parent's consent
 * is part of the request), give or refuse consent to their child's own
 * request, follow the schedule and see the participation portfolio.
 */

const MEMBER_PILL: Record<string, string> = { AWAITING_CONSENT: 'PENDING', AWAITING_APPROVAL: 'PENDING_APPROVAL', PROCESSING: 'IN_PROGRESS', WAITLISTED: 'WAITLISTED', ACTIVE: 'ACTIVE', DECLINED: 'REJECTED', WITHDRAWN: 'WITHDRAWN', LEFT: 'CLOSED' };
const MEMBER_LABEL: Record<string, string> = { AWAITING_CONSENT: 'Waiting for parent consent', AWAITING_APPROVAL: 'Waiting for the teacher', PROCESSING: 'Being decided', WAITLISTED: 'Waiting list', ACTIVE: 'Member', DECLINED: 'Not accepted', WITHDRAWN: 'Withdrawn', LEFT: 'Left' };
const RESULT_LABEL: Record<string, string> = { PENDING_APPROVAL: 'Waiting for a second teacher', APPROVED: 'Approved', REJECTED: 'Returned' };
const time = (d: string) => new Date(d).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });

function MemberStatus({ m }: { m: Membership }) {
  const label = m.status === 'WAITLISTED' && m.waitlistPosition ? `Waiting list · #${m.waitlistPosition}` : MEMBER_LABEL[m.status];
  return <StatusPill status={MEMBER_PILL[m.status]} label={label} />;
}

function Seats({ c }: { c: Club }) {
  const pct = Math.min(100, Math.round((c.memberCount / Math.max(c.capacity, 1)) * 100));
  return (
    <div className="clubs-seats" aria-label={`${c.memberCount} of ${c.capacity} places taken`}>
      <div className="clubs-seats-bar"><span style={{ width: `${pct}%` }} /></div>
      <span className="clubs-seats-text">{c.seatsLeft > 0 ? `${c.seatsLeft} of ${c.capacity} places free` : `Full${c.waitlisted ? ` · ${c.waitlisted} waiting` : ''}`}</span>
    </div>
  );
}

function ClubCard({ c, onOpen, action }: { c: Club; onOpen?: () => void; action?: ReactNode }) {
  return (
    <li className={`clubs-card cat-${c.category.toLowerCase()}`}>
      <button type="button" className="ops-row-link" onClick={onOpen} disabled={!onOpen}>
        <div className="clubs-card-head"><span className="clubs-card-cat">{humanize(c.category)} · {humanize(c.activity)}</span>{c.kind === 'TEAM' && <span className="clubs-card-cat">Team</span>}</div>
        <div className="ops-row-title">{c.name}</div>
        <div className="ops-row-sub">{c.coaches.map((x) => x.name).filter(Boolean).join(', ') || 'Teacher to be named'}{c.externalCoachName ? ` · coach ${c.externalCoachName}` : ''}</div>
        <div className="ops-row-sub">{c.meetingPattern ?? 'Schedule on the club page'}{c.homeFacility ? ` · ${c.homeFacility.name}` : ''}{c.grades.length ? ` · ${c.grades.map((g) => g.name).join(', ')}` : ''}</div>
        <Seats c={c} />
        {(c.awaitingApproval ?? 0) + (c.awaitingConsent ?? 0) > 0 && <div className="ops-row-sub"><b>{c.awaitingApproval ?? 0}</b> to decide · {c.awaitingConsent ?? 0} waiting for consent</div>}
      </button>
      {action && <div className="clubs-card-action">{action}</div>}
    </li>
  );
}

// ── shared: the portfolio ─────────────────────────────────────────────

export function PortfolioPanel({ p }: { p: Portfolio }) {
  return (
    <div className="ops-stack">
      <div className="kpi-grid">
        <Tile label="Clubs and teams" value={p.summary.clubs} />
        <Tile label="Current" value={p.summary.currentClubs} tone="good" />
        <Tile label="Fixtures played" value={p.summary.fixtures} />
        <Tile label="Awards" value={p.summary.awards} />
        <Tile label="Session attendance" value={p.summary.attendancePct === null ? 'No registers yet' : `${p.summary.attendancePct}%`} />
      </div>
      <KeyValues rows={[['Student', `${p.student.name}${p.student.className ? ` · ${p.student.className}` : ''}`], ['House', p.house ?? 'Not in a house']]} />
      <SectionCard title="Clubs and teams">
        {p.clubs.length ? <ul className="ops-list">{p.clubs.map((c) => (
          <li key={c.clubId + c.joinedAt} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{c.name}{c.role !== 'MEMBER' ? ` · ${humanize(c.role)}` : ''}</div><div className="ops-row-sub">{humanize(c.category)} · from {fmtDate(c.joinedAt)}{c.leftAt ? ` to ${fmtDate(c.leftAt)}` : ''} · came to {c.sessionsAttended} of {c.sessionsMarked} sessions marked</div></div><StatusPill status={c.current ? 'ACTIVE' : 'CLOSED'} label={c.current ? 'Current' : 'Past'} /></li>
        ))}</ul> : <p className="ops-muted">Not in any club or team yet.</p>}
      </SectionCard>
      <SectionCard title="Fixtures and events" sub="Only results a second teacher approved.">
        {p.fixtures.length ? <ul className="ops-list">{p.fixtures.map((f) => (
          <li key={f.fixtureId} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{f.title}</div><div className="ops-row-sub">{fmtDate(f.on)} · {humanize(f.level)}{f.outcome ? ` · ${humanize(f.outcome)}` : ''}{f.awards.length ? ` · 🏅 ${f.awards.join(', ')}` : ''}</div></div></li>
        ))}</ul> : <p className="ops-muted">No approved results yet.</p>}
      </SectionCard>
      <SectionCard title="Co-curricular records" sub="Approved by the class teacher.">
        {p.records.length ? <ul className="ops-list">{p.records.map((r) => <li key={r.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{r.name}</div><div className="ops-row-sub">{fmtDate(r.on)} · {humanize(r.category)} · {humanize(r.level)}{r.achievement ? ` · ${r.achievement}` : ''}</div></div></li>)}</ul> : <p className="ops-muted">None yet.</p>}
      </SectionCard>
      {p.honours.length > 0 && <SectionCard title="On the school showcase">{p.honours.map((h, i) => <p key={i}>🏆 <b>{h.title}</b> · {h.edition}</p>)}</SectionCard>}
      <DataNote>{p.definition}</DataNote>
    </div>
  );
}

// ── family ─────────────────────────────────────────────────────────────

function JoinModal({ club, kids, onClose, onDone }: { club: Club; kids: MyStudent[]; onClose: () => void; onDone: () => void }) {
  const eligible = kids.filter((k) => !club.grades.length || club.grades.some((g) => g.id === k.gradeId));
  const [studentId, setStudentId] = useState(eligible[0]?.studentId ?? '');
  const [note, setNote] = useState('');
  const { run, busy, error } = useAction();
  const { me } = useAuth();
  const isParent = me?.profile?.role === 'PARENT';
  const kid = eligible.find((k) => k.studentId === studentId);
  return (
    <Modal title={`Join ${club.name}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !studentId} onClick={() => void run(async () => { await clubsApi.join({ clubId: club.id, studentId, note: note || undefined }); onDone(); })}>Send request</Button></>}>
      {eligible.length === 0 ? <p className="ops-callout is-warn">{club.name} is open to {club.grades.map((g) => g.name).join(', ')} only.</p> : (
        <>
          {isParent && <Field label="Child"><select className="input" value={studentId} onChange={(e) => setStudentId(e.target.value)}>{eligible.map((k) => <option key={k.studentId} value={k.studentId}>{k.name}{k.className ? ` (${k.className})` : ''}</option>)}</select></Field>}
          <Field label="Note for the teacher (optional)"><textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <p className="ops-callout">{isParent
            ? 'Sending this request gives your consent as parent. The teacher in charge then decides; if the club is full, your child goes on the waiting list in order.'
            : kid?.needsConsent ? 'Your parent will be asked for consent first, then the teacher in charge decides.' : 'The teacher in charge decides.'}</p>
        </>
      )}
      <ErrorNote error={error} />
    </Modal>
  );
}

function MyRequests({ onChange }: { onChange: () => void }) {
  const list = useLoad(() => clubsApi.my(), []);
  const { me } = useAuth();
  const isParent = me?.profile?.role === 'PARENT';
  const { run, error } = useAction();
  const toast = useToast();
  const [leaving, setLeaving] = useState<Membership | null>(null);
  const act = (fn: () => Promise<unknown>, msg: string) => void run(async () => { await fn(); toast(msg, 'success'); await list.reload(); onChange(); });
  return (
    <SectionCard title={isParent ? "Your children's clubs and requests" : 'My clubs and requests'}>
      <ErrorNote error={error} />
      <Loadable state={list}>{(rows) => !rows.length ? <EmptyState title="No requests yet" sub="Browse the clubs and ask to join one." /> : (
        <ul className="ops-list">{rows.map((m) => (
          <li key={m.id} className="ops-row">
            <div className="ops-row-main"><div className="ops-row-title">{m.clubName}{isParent ? ` · ${m.studentName}` : ''}</div>
              <div className="ops-row-sub">Asked {fmtDate(m.requestedAt)}{m.joinedAt ? ` · member since ${fmtDate(m.joinedAt)}` : ''}{m.declineReason ? ` · ${m.declineReason}` : ''}{m.role !== 'MEMBER' ? ` · ${humanize(m.role)}` : ''}</div></div>
            <MemberStatus m={m} />
            {isParent && m.status === 'AWAITING_CONSENT' && <>
              <Button small onClick={() => act(() => clubsApi.consent(m.id, 'GIVE'), 'Consent given')}>Give consent</Button>
              <Button small variant="ghost" onClick={() => act(() => clubsApi.consent(m.id, 'REFUSE'), 'Consent refused')}>Refuse</Button>
            </>}
            {['AWAITING_CONSENT', 'AWAITING_APPROVAL', 'WAITLISTED', 'ACTIVE'].includes(m.status) && <Button small variant="ghost" onClick={() => setLeaving(m)}>{m.status === 'ACTIVE' ? 'Leave' : 'Withdraw'}</Button>}
          </li>
        ))}</ul>
      )}</Loadable>
      {leaving && <PromptModal title={leaving.status === 'ACTIVE' ? `Leave ${leaving.clubName}` : 'Withdraw the request'} label="Reason (optional)" required={false} confirmLabel="Confirm" onClose={() => setLeaving(null)} onSubmit={async (v) => { await clubsApi.leave(leaving.id, v || undefined); toast('Done', 'info'); await list.reload(); onChange(); }} />}
    </SectionCard>
  );
}

function Schedule() {
  const list = useLoad(() => clubsApi.sessions({ from: new Date(Date.now() - 86_400_000).toISOString(), to: new Date(Date.now() + 21 * 86_400_000).toISOString() }), []);
  return (
    <SectionCard title="Coming up" sub="Sessions of the clubs you (or your children) are members of.">
      <Loadable state={list}>{(rows) => !rows.length ? <p className="ops-muted">Nothing scheduled in the next three weeks.</p> : <SessionList rows={rows} />}</Loadable>
    </SectionCard>
  );
}

function SessionList({ rows, onRegister, onCancel }: { rows: ClubSession[]; onRegister?: (s: ClubSession) => void; onCancel?: (s: ClubSession) => void }) {
  return (
    <ul className="ops-list">{rows.map((s) => (
      <li key={s.id} className="ops-row">
        <div className="clubs-date" aria-hidden="true"><b>{new Date(s.startsAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit' })}</b><span>{new Date(s.startsAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short' })}</span></div>
        <div className="ops-row-main"><div className="ops-row-title">{s.clubName}{s.title ? `: ${s.title}` : ''}</div>
          <div className="ops-row-sub">{time(s.startsAt)}–{time(s.endsAt)} · {s.venue?.name ?? 'Venue to be set'}{s.bookingStatus === 'REQUESTED' ? ' (venue requested)' : ''}{s.cancelReason ? ` · ${s.cancelReason}` : ''}{s.marked ? ` · ${s.present}/${s.marked} present` : ''}</div></div>
        <StatusPill status={s.status === 'PLANNED' ? 'SCHEDULED' : s.status === 'HELD' ? 'COMPLETED' : 'CANCELLED'} label={s.status === 'HELD' ? 'Held' : humanize(s.status)} />
        {onRegister && s.iCoach !== false && s.status !== 'CANCELLED' && new Date(s.startsAt).getTime() < Date.now() + 30 * 60_000 && <Button small onClick={() => onRegister(s)}>{s.attendanceTaken ? 'Register' : 'Take register'}</Button>}
        {onCancel && s.status === 'PLANNED' && new Date(s.startsAt).getTime() > Date.now() && <Button small variant="ghost" onClick={() => onCancel(s)}>Cancel</Button>}
      </li>
    ))}</ul>
  );
}

function PortfolioTab() {
  const kids = useLoad(() => clubsApi.myStudents(), []);
  const [pick, setPick] = useState<string | null>(null);
  return (
    <Loadable state={kids}>{(list) => {
      const id = pick ?? list[0]?.studentId;
      if (!id) return <EmptyState title="No student linked" sub="Your account is not linked to a student record." />;
      return (
        <div className="ops-stack">
          {list.length > 1 && <div className="ops-inline">{list.map((k) => <Button key={k.studentId} small variant={k.studentId === id ? 'accent' : 'soft'} onClick={() => setPick(k.studentId)}>{k.name}</Button>)}</div>}
          <PortfolioLoader studentId={id} />
        </div>
      );
    }}</Loadable>
  );
}

function PortfolioLoader({ studentId }: { studentId: string }) {
  const p = useLoad(() => clubsApi.portfolio(studentId), [studentId]);
  return <Loadable state={p}>{(x) => <PortfolioPanel p={x} />}</Loadable>;
}

function FamilyClubs() {
  const [tab, setTab] = useState<'browse' | 'mine' | 'schedule' | 'fixtures' | 'portfolio'>('browse');
  const clubs = useLoad(() => clubsApi.list({}), []);
  const kids = useLoad(() => clubsApi.myStudents(), []);
  const [joining, setJoining] = useState<Club | null>(null);
  const [cat, setCat] = useState('ALL');
  const toast = useToast();
  return (
    <div className="ops-stack">
      <Tabs tabs={[{ key: 'browse', label: 'Browse' }, { key: 'mine', label: 'My requests' }, { key: 'schedule', label: 'Schedule' }, { key: 'fixtures', label: 'Fixtures & houses' }, { key: 'portfolio', label: 'Portfolio' }]} value={tab} onChange={setTab} />
      {tab === 'browse' && (
        <SectionCard title="Clubs and teams" sub="Sports, arts and more. Ask to join; a teacher in charge decides." actions={<CategoryFilter value={cat} onChange={setCat} />}>
          <Loadable state={clubs}>{(rows) => {
            const shown = rows.filter((c) => cat === 'ALL' || c.category === cat);
            return !shown.length ? <EmptyState title="No clubs here yet" sub="The school has not opened any clubs in this category." /> : (
              <ul className="clubs-grid">{shown.map((c) => <ClubCard key={c.id} c={c} action={c.joinOpen ? <Button small onClick={() => setJoining(c)}>{c.seatsLeft > 0 ? 'Ask to join' : 'Join the waiting list'}</Button> : <span className="ops-muted">Not taking requests</span>} />)}</ul>
            );
          }}</Loadable>
        </SectionCard>
      )}
      {tab === 'mine' && <MyRequests onChange={() => void clubs.reload()} />}
      {tab === 'schedule' && <Schedule />}
      {tab === 'fixtures' && <FixturesAndHouses staff={false} />}
      {tab === 'portfolio' && <PortfolioTab />}
      {joining && <JoinModal club={joining} kids={kids.data ?? []} onClose={() => setJoining(null)} onDone={() => { setJoining(null); toast('Request sent', 'success'); void clubs.reload(); setTab('mine'); }} />}
    </div>
  );
}

function CategoryFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select className="input" aria-label="Category" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="ALL">All categories</option>{['SPORTS', 'ARTS', 'ACADEMIC', 'SERVICE', 'OTHER'].map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
    </select>
  );
}

// ── fixtures and houses (everyone) ──────────────────────────────────────

function HouseTable() {
  const pts = useLoad(() => clubsApi.housePoints({}), []);
  return (
    <SectionCard title="House points" sub="Only results a second teacher has approved count.">
      <Loadable state={pts}>{(t) => !t.table.length ? <p className="ops-muted">No houses set up yet.</p> : (
        <>
          <ol className="clubs-houses">{t.table.map((h) => {
            const top = Math.max(...t.table.map((x) => x.points), 1);
            return (
              <li key={h.houseId}>
                <span className="clubs-house-pos">{h.position}</span>
                <span className="clubs-house-swatch" style={{ background: h.colour ?? 'var(--hairline-2)' }} aria-hidden="true" />
                <span className="clubs-house-name">{h.name}</span>
                <span className="clubs-house-bar" aria-hidden="true"><span style={{ width: `${Math.round((h.points / top) * 100)}%`, background: h.colour ?? 'var(--accent)' }} /></span>
                <b className="clubs-house-pts">{h.points}</b>
              </li>
            );
          })}</ol>
          <DataNote>{t.approvedResults} approved result(s) counted{t.pendingResults ? `; ${t.pendingResults} waiting for approval and not counted yet` : ''}.</DataNote>
        </>
      )}</Loadable>
    </SectionCard>
  );
}

function FixturesAndHouses({ staff, options }: { staff: boolean; options?: ClubOptions | null }) {
  const list = useLoad(() => clubsApi.fixtures({}), []);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Fixture | null>(null);
  const { permissions } = usePermissions();
  return (
    <div className="ops-stack">
      <HouseTable />
      <SectionCard title="Fixtures and events" actions={staff ? <Button onClick={() => setCreating(true)}>New fixture</Button> : undefined}>
        <Loadable state={list}>{(rows) => !rows.length ? <p className="ops-muted">No fixtures yet.</p> : (
          <ul className="ops-list">{rows.map((f) => (
            <li key={f.id} className="ops-row">
              <div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => staff && setOpen(f)} disabled={!staff}>
                <div className="ops-row-title">{f.title}</div>
                <div className="ops-row-sub">{fmtDateTime(f.startsAt)} · {humanize(f.kind)}{f.houses.length ? ` · ${f.houses.map((h) => h.name).join(' v ')}` : ''}{f.opponent ? ` · v ${f.opponent}` : ''}{f.venue ? ` · ${f.venue}` : ''}</div>
                {f.result && <div className="ops-row-sub">{f.result.summary}{f.result.awards.length ? ` · 🏅 ${f.result.awards.map((a) => `${a.name}: ${a.title}`).join('; ')}` : ''}</div>}
                {!staff && f.myStudents?.length ? <div className="ops-row-sub">Playing: {f.myStudents.map((m) => m.name).join(', ')}</div> : null}
              </button></div>
              {f.result ? <StatusPill status={f.result.status === 'APPROVED' ? 'APPROVED' : f.result.status === 'REJECTED' ? 'RETURNED' : 'PENDING_APPROVAL'} label={RESULT_LABEL[f.result.status]} /> : <StatusPill status={f.status} />}
            </li>
          ))}</ul>
        )}</Loadable>
      </SectionCard>
      {creating && <FixtureForm options={options ?? null} allScope={permissions['clubs.manage'] === 'ALL'} onClose={() => setCreating(false)} onDone={() => { setCreating(false); void list.reload(); }} />}
      {open && <FixtureDrawer fixtureId={open.id} initial={open} onClose={() => setOpen(null)} onChange={() => void list.reload()} />}
    </div>
  );
}

function FixtureForm({ options, allScope, onClose, onDone }: { options: ClubOptions | null; allScope: boolean; onClose: () => void; onDone: () => void }) {
  const houses = useLoad(() => clubsApi.houses(), []);
  const clubs = useLoad(() => clubsApi.list({ mine: allScope ? undefined : 'true' }), [allScope]);
  const [f, setF] = useState({ kind: 'HOUSE', title: '', clubId: '', houseIds: [] as string[], opponent: '', level: '', date: isoDay(new Date(Date.now() + 7 * 86_400_000)), time: '10:00', facilityId: '', venueText: '' });
  const { run, busy, error } = useAction();
  return (
    <Modal title="New fixture or event" wide onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.title.trim()} onClick={() => void run(async () => {
      const startsAt = new Date(`${f.date}T${f.time}:00+05:30`).toISOString();
      await clubsApi.createFixture({ kind: f.kind, title: f.title, clubId: f.clubId || undefined, houseIds: f.houseIds, opponent: f.opponent || undefined, level: f.level || undefined, startsAt, facilityId: f.facilityId || undefined, venueText: f.venueText || undefined });
      onDone();
    })}>Schedule</Button></>}>
      <div className="ops-grid-2">
        <Field label="Kind"><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="HOUSE">Inter-house</option><option value="INTERNAL">Inside the school</option><option value="EXTERNAL">Against other schools</option></select></Field>
        <Field label="Title" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Inter-house basketball final" /></Field>
        <Field label="Date"><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Time"><input className="input" type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
        {f.kind !== 'HOUSE' && <Field label="Club or team" required><select className="input" value={f.clubId} onChange={(e) => setF({ ...f, clubId: e.target.value })}><option value="">Choose…</option>{(clubs.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
        {f.kind === 'EXTERNAL' && <Field label="Opponent or organiser"><input className="input" value={f.opponent} onChange={(e) => setF({ ...f, opponent: e.target.value })} /></Field>}
        {f.kind === 'EXTERNAL' && <Field label="Level"><select className="input" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}><option value="">Inter-school</option>{['DISTRICT', 'STATE', 'NATIONAL', 'INTERNATIONAL'].map((l) => <option key={l} value={l}>{humanize(l)}</option>)}</select></Field>}
        {f.kind !== 'EXTERNAL' ? <Field label="Venue"><select className="input" value={f.facilityId} onChange={(e) => setF({ ...f, facilityId: e.target.value })}><option value="">Not booked</option>{(options?.venues ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
          : <Field label="Venue"><input className="input" value={f.venueText} onChange={(e) => setF({ ...f, venueText: e.target.value })} /></Field>}
      </div>
      {f.kind === 'HOUSE' && <Field label="Houses taking part" hint="At least two."><div className="ops-chips">{(houses.data ?? []).map((h) => <label key={h.id} className="ops-chip"><input type="checkbox" checked={f.houseIds.includes(h.id)} onChange={() => setF({ ...f, houseIds: f.houseIds.includes(h.id) ? f.houseIds.filter((x) => x !== h.id) : [...f.houseIds, h.id] })} />{h.name}</label>)}</div></Field>}
      <DataNote>A school venue is booked through Facilities; a clash with another booking is refused.</DataNote>
      <ErrorNote error={error} />
    </Modal>
  );
}

function FixtureDrawer({ fixtureId, initial, onClose, onChange }: { fixtureId: string; initial: Fixture; onClose: () => void; onChange: () => void }) {
  const [fx, setFx] = useState<Fixture>(initial);
  const { run, busy, error } = useAction();
  const [mode, setMode] = useState<'view' | 'team' | 'result'>('view');
  const [rejecting, setRejecting] = useState(false);
  const toast = useToast();
  const done = (f: Fixture, msg: string) => { setFx(f); setMode('view'); toast(msg, 'success'); onChange(); };
  return (
    <Drawer title={fx.title} sub={`${fx.refNo} · ${humanize(fx.kind)} · ${fmtDateTime(fx.startsAt)}`} onClose={onClose}>
      <div className="ops-stack">
        <KeyValues rows={[
          ['Taking part', fx.houses.length ? fx.houses.map((h) => h.name).join(', ') : fx.clubName],
          ['Opponent', fx.opponent ?? undefined], ['Venue', fx.venue ?? '—'], ['Team sheet', `${fx.participantCount} student(s)`],
        ]} />
        {fx.result && (
          <SectionCard title="Result" actions={<StatusPill status={fx.result.status === 'APPROVED' ? 'APPROVED' : fx.result.status === 'REJECTED' ? 'RETURNED' : 'PENDING_APPROVAL'} label={RESULT_LABEL[fx.result.status]} />}>
            <p>{fx.result.summary}</p>
            {fx.result.placements.length > 0 && <ol>{fx.result.placements.map((p) => <li key={p.houseId}>{p.house}: {p.points} points</li>)}</ol>}
            {fx.result.awards.length > 0 && <p>🏅 {fx.result.awards.map((a) => `${a.name}: ${a.title}`).join('; ')}</p>}
            <DataNote>Recorded by {fx.result.recordedBy ?? '—'}{fx.result.approvedBy ? `; approved by ${fx.result.approvedBy}` : ''}{fx.result.rejectionReason ? `; returned: ${fx.result.rejectionReason}` : ''}.</DataNote>
            {fx.result.status === 'PENDING_APPROVAL' && (fx.result.recordedByMe
              ? <p className="ops-muted">Another teacher must approve a result you recorded.</p>
              : <div className="ops-inline"><Button disabled={busy} onClick={() => void run(async () => done(await clubsApi.decideResult(fx.id, 'APPROVE'), 'Result approved'))}>Approve result</Button><Button variant="ghost" onClick={() => setRejecting(true)}>Return</Button></div>)}
          </SectionCard>
        )}
        {fx.canManage && fx.status !== 'CANCELLED' && fx.result?.status !== 'APPROVED' && mode === 'view' && (
          <div className="ops-inline">
            <Button variant="soft" onClick={() => setMode('team')}>Team sheet</Button>
            {new Date(fx.startsAt).getTime() <= Date.now() && <Button onClick={() => setMode('result')}>Record result</Button>}
          </div>
        )}
        {mode === 'team' && <TeamSheet fx={fx} onSaved={(f) => done(f, 'Team sheet saved')} />}
        {mode === 'result' && <ResultForm fx={fx} onSaved={(f) => done(f, 'Result recorded; a second teacher approves it')} />}
        <ErrorNote error={error} />
      </div>
      {rejecting && <PromptModal title="Return the result" label="What needs correcting" onClose={() => setRejecting(false)} onSubmit={async (v) => { done(await clubsApi.decideResult(fixtureId, 'REJECT', v), 'Result returned'); }} />}
    </Drawer>
  );
}

function TeamSheet({ fx, onSaved }: { fx: Fixture; onSaved: (f: Fixture) => void }) {
  const club = useLoad(() => (fx.clubId ? clubsApi.get(fx.clubId) : Promise.resolve(null)), [fx.clubId]);
  const [ids, setIds] = useState<string[]>((fx.participants ?? []).map((p) => p.studentId));
  const [extra, setExtra] = useState('');
  const { run, busy, error } = useAction();
  const pool = (club.data?.members ?? []).filter((m) => m.status === 'ACTIVE');
  return (
    <SectionCard title="Team sheet" sub={fx.kind === 'HOUSE' ? 'Students from the houses taking part.' : 'Current members of the club.'}>
      {fx.kind !== 'HOUSE' ? (
        <div className="ops-chips">{pool.map((m) => <label key={m.studentId} className="ops-chip"><input type="checkbox" checked={ids.includes(m.studentId)} onChange={() => setIds(ids.includes(m.studentId) ? ids.filter((x) => x !== m.studentId) : [...ids, m.studentId])} />{m.studentName}</label>)}</div>
      ) : (
        <>
          <ul className="ops-list">{(fx.participants ?? []).filter((p) => ids.includes(p.studentId)).map((p) => <li key={p.studentId} className="ops-row"><div className="ops-row-main">{p.name}</div><Button small variant="ghost" onClick={() => setIds(ids.filter((x) => x !== p.studentId))}>Remove</Button></li>)}</ul>
          <Field label="Add student IDs (one per line)" hint="From the house lists."><textarea className="input" rows={3} value={extra} onChange={(e) => setExtra(e.target.value)} /></Field>
        </>
      )}
      <Button disabled={busy} onClick={() => void run(async () => onSaved(await clubsApi.setParticipants(fx.id, [...new Set([...ids, ...extra.split(/\s+/).filter(Boolean)])])))}>Save team sheet</Button>
      <ErrorNote error={error} />
    </SectionCard>
  );
}

function ResultForm({ fx, onSaved }: { fx: Fixture; onSaved: (f: Fixture) => void }) {
  const [summary, setSummary] = useState('');
  const [outcome, setOutcome] = useState(fx.kind === 'HOUSE' ? 'PLACED' : 'WON');
  const [places, setPlaces] = useState(fx.houses.map((h, i) => ({ houseId: h.id, name: h.name, position: String(i + 1), points: String(Math.max(10 - i * 3, 1)) })));
  const [awards, setAwards] = useState<Array<{ studentId: string; title: string }>>([]);
  const { run, busy, error } = useAction();
  return (
    <SectionCard title="Record the result" sub="It counts once a second teacher approves it.">
      <Field label="Summary" required><textarea className="input" rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} /></Field>
      {fx.kind !== 'HOUSE' && <Field label="Outcome"><select className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)}>{['WON', 'LOST', 'DRAWN', 'PLACED', 'PARTICIPATED'].map((o) => <option key={o} value={o}>{humanize(o)}</option>)}</select></Field>}
      {fx.kind === 'HOUSE' && (
        <table className="ops-table"><thead><tr><th>House</th><th>Position</th><th>Points</th></tr></thead><tbody>
          {places.map((p, i) => <tr key={p.houseId}><td>{p.name}</td><td><input className="input" type="number" min={1} max={20} aria-label={`${p.name} position`} value={p.position} onChange={(e) => setPlaces(places.map((x, k) => (k === i ? { ...x, position: e.target.value } : x)))} /></td><td><input className="input" type="number" min={0} max={1000} aria-label={`${p.name} points`} value={p.points} onChange={(e) => setPlaces(places.map((x, k) => (k === i ? { ...x, points: e.target.value } : x)))} /></td></tr>)}
        </tbody></table>
      )}
      <Field label="Awards (optional)" hint="Only students on the team sheet.">
        <div className="ops-stack">
          {awards.map((a, i) => <div key={i} className="ops-inline"><select className="input" aria-label="Student" value={a.studentId} onChange={(e) => setAwards(awards.map((x, k) => (k === i ? { ...x, studentId: e.target.value } : x)))}><option value="">Choose…</option>{(fx.participants ?? []).map((p) => <option key={p.studentId} value={p.studentId}>{p.name}</option>)}</select><input className="input" aria-label="Award" placeholder="e.g. Player of the match" value={a.title} onChange={(e) => setAwards(awards.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)))} /></div>)}
          <Button small variant="soft" onClick={() => setAwards([...awards, { studentId: '', title: '' }])}>Add an award</Button>
        </div>
      </Field>
      <Button disabled={busy || !summary.trim()} onClick={() => void run(async () => onSaved(await clubsApi.recordResult(fx.id, {
        summary, outcome, placements: fx.kind === 'HOUSE' ? places.map((p) => ({ houseId: p.houseId, position: Number(p.position), points: Number(p.points) })) : [],
        awards: awards.filter((a) => a.studentId && a.title.trim()),
      })))}>Save result</Button>
      <ErrorNote error={error} />
    </SectionCard>
  );
}

// ── staff ──────────────────────────────────────────────────────────────

function ClubForm({ options, onClose, onDone }: { options: ClubOptions; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: '', kind: 'CLUB', category: 'SPORTS', activity: 'CRICKET', capacity: '20', coachProfileIds: [] as string[], homeFacilityId: '', meetingPattern: '', gradeIds: [] as string[], description: '' });
  const { run, busy, error } = useAction();
  const toggle = (k: 'coachProfileIds' | 'gradeIds', id: string) => setF({ ...f, [k]: f[k].includes(id) ? f[k].filter((x) => x !== id) : [...f[k], id] });
  return (
    <Modal title="New club or team" wide onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.name.trim() || !f.coachProfileIds.length} onClick={() => void run(async () => { await clubsApi.create({ ...f, capacity: Number(f.capacity), homeFacilityId: f.homeFacilityId || null }); onDone(); })}>Create</Button></>}>
      <div className="ops-grid-2">
        <Field label="Name" required><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Under-14 football" /></Field>
        <Field label="Club or team"><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="CLUB">Club</option><option value="TEAM">Team</option></select></Field>
        <Field label="Category"><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{options.categories.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select></Field>
        <Field label="Activity"><select className="input" value={f.activity} onChange={(e) => setF({ ...f, activity: e.target.value })}>{options.activities.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select></Field>
        <Field label="Places" hint="When full, approved students join a waiting list."><input className="input" type="number" min={1} max={500} value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} /></Field>
        <Field label="Usual venue"><select className="input" value={f.homeFacilityId} onChange={(e) => setF({ ...f, homeFacilityId: e.target.value })}><option value="">None</option>{options.venues.map((v) => <option key={v.id} value={v.id}>{v.name} ({humanize(v.kind)})</option>)}</select></Field>
        <Field label="When it meets"><input className="input" value={f.meetingPattern} onChange={(e) => setF({ ...f, meetingPattern: e.target.value })} placeholder="e.g. Tue and Thu, 15:30–16:30" /></Field>
      </div>
      <Field label="Teachers in charge" required><div className="ops-chips">{(options.staff ?? []).map((p) => <label key={p.profileId} className="ops-chip"><input type="checkbox" checked={f.coachProfileIds.includes(p.profileId)} onChange={() => toggle('coachProfileIds', p.profileId)} />{p.name}</label>)}</div></Field>
      <Field label="Open to" hint="Leave empty for every class."><div className="ops-chips">{options.grades.map((g) => <label key={g.id} className="ops-chip"><input type="checkbox" checked={f.gradeIds.includes(g.id)} onChange={() => toggle('gradeIds', g.id)} />{g.name}</label>)}</div></Field>
      <Field label="Description"><textarea className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <ErrorNote error={error} />
    </Modal>
  );
}

function SessionForm({ club, options, onClose, onDone }: { club: Club; options: ClubOptions | null; onClose: () => void; onDone: (n: number, skipped: number) => void }) {
  const [f, setF] = useState({ date: isoDay(), from: '15:30', to: '16:30', repeatWeeks: '0', facilityId: club.homeFacility?.id ?? '', venueText: '', title: '' });
  const { run, busy, error } = useAction();
  return (
    <Modal title={`Schedule ${club.name}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={() => void run(async () => {
      const out = await clubsApi.createSessions(club.id, { ...f, repeatWeeks: Number(f.repeatWeeks), facilityId: f.facilityId || undefined, venueText: f.facilityId ? undefined : f.venueText });
      onDone(out.created, out.skipped.length);
    })}>Schedule</Button></>}>
      <div className="ops-grid-2">
        <Field label="First date"><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Repeat weekly for" hint="0 = once"><select className="input" value={f.repeatWeeks} onChange={(e) => setF({ ...f, repeatWeeks: e.target.value })}>{[0, 1, 3, 5, 7, 11, 15, 19].map((n) => <option key={n} value={n}>{n === 0 ? 'Just once' : `${n + 1} weeks`}</option>)}</select></Field>
        <Field label="From"><input className="input" type="time" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
        <Field label="To"><input className="input" type="time" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        <Field label="Venue"><select className="input" value={f.facilityId} onChange={(e) => setF({ ...f, facilityId: e.target.value })}><option value="">Somewhere else…</option>{(options?.venues ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
        {!f.facilityId && <Field label="Where"><input className="input" value={f.venueText} onChange={(e) => setF({ ...f, venueText: e.target.value })} placeholder="e.g. City swimming pool" /></Field>}
        <Field label="Focus (optional)"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Fielding drills" /></Field>
      </div>
      <DataNote>A school venue is booked through Facilities. An occurrence that clashes with another booking is left out and listed.</DataNote>
      <ErrorNote error={error} />
    </Modal>
  );
}

function RegisterModal({ session, onClose, onDone }: { session: ClubSession; onClose: () => void; onDone: () => void }) {
  const reg = useLoad(() => clubsApi.register(session.id), [session.id]);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const { run, busy, error } = useAction();
  const value = (id: string, existing: string | null) => marks[id] ?? existing ?? 'PRESENT';
  return (
    <Modal title={`Register: ${session.clubName}`} wide onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button disabled={busy || !reg.data?.rows.length} onClick={() => void run(async () => {
      await clubsApi.takeAttendance(session.id, (reg.data?.rows ?? []).map((r) => ({ studentId: r.studentId, status: value(r.studentId, r.status) })));
      onDone();
    })}>Save register</Button></>}>
      <p className="ops-muted">{fmtDateTime(session.startsAt)} · {session.venue?.name ?? '—'}</p>
      <Loadable state={reg}>{(r) => !r.rows.length ? <p className="ops-muted">No members on that day.</p> : (
        <ul className="ops-list">{r.rows.map((row) => (
          <li key={row.studentId} className="ops-row">
            <div className="ops-row-main"><div className="ops-row-title">{row.name}</div><div className="ops-row-sub">{row.admissionNo}{row.role !== 'MEMBER' ? ` · ${humanize(row.role)}` : ''}</div></div>
            <div className="clubs-marks" role="radiogroup" aria-label={`${row.name}`}>
              {(['PRESENT', 'ABSENT', 'EXCUSED'] as const).map((s) => <button key={s} type="button" role="radio" aria-checked={value(row.studentId, row.status) === s} className={`clubs-mark ${value(row.studentId, row.status) === s ? 'is-on' : ''} m-${s.toLowerCase()}`} onClick={() => setMarks({ ...marks, [row.studentId]: s })}>{humanize(s)}</button>)}
            </div>
          </li>
        ))}</ul>
      )}</Loadable>
      <ErrorNote error={error} />
    </Modal>
  );
}

function ClubDrawer({ clubId, options, onClose, onChange }: { clubId: string; options: ClubOptions | null; onClose: () => void; onChange: () => void }) {
  const club = useLoad(() => clubsApi.get(clubId), [clubId]);
  const { run, error } = useAction();
  const [declining, setDeclining] = useState<Membership | null>(null);
  const [removing, setRemoving] = useState<Membership | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [portfolioOf, setPortfolioOf] = useState<string | null>(null);
  const toast = useToast();
  const refresh = async () => { await club.reload(); onChange(); };
  const c = club.data;
  return (
    <Drawer title={c?.name ?? 'Club'} sub={c ? `${humanize(c.category)} · ${c.memberCount}/${c.capacity} members${c.waitlisted ? ` · ${c.waitlisted} waiting` : ''}` : undefined} onClose={onClose}>
      <Loadable state={club}>{(x) => (
        <div className="ops-stack">
          {x.description && <p>{x.description}</p>}
          <Seats c={x} />
          {x.canManage && (
            <div className="ops-inline">
              <Button small onClick={() => setScheduling(true)}>Schedule sessions</Button>
              <Button small variant="soft" onClick={() => void run(async () => { await clubsApi.update(x.id, { joinOpen: !x.joinOpen }); toast(x.joinOpen ? 'Requests paused' : 'Requests open', 'info'); await refresh(); })}>{x.joinOpen ? 'Pause requests' : 'Open requests'}</Button>
            </div>
          )}
          <ErrorNote error={error} />
          <SectionCard title="Members and requests">
            {!x.members?.length ? <p className="ops-muted">No members yet.</p> : (
              <ul className="ops-list">{x.members.map((m) => (
                <li key={m.id} className="ops-row">
                  <div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => setPortfolioOf(m.studentId)}><div className="ops-row-title">{m.studentName}{m.role !== 'MEMBER' ? ` · ${humanize(m.role)}` : ''}</div><div className="ops-row-sub">{m.className ?? ''}{m.consent.required ? (m.consent.given ? ' · parent consent given' : ' · no parent consent yet') : ''}{m.note ? ` · “${m.note}”` : ''}</div></button></div>
                  <MemberStatus m={m} />
                  {x.canManage && m.status === 'AWAITING_APPROVAL' && <>
                    <Button small onClick={() => void run(async () => { const out = await clubsApi.decide(m.id, 'APPROVE'); toast(out.status === 'ACTIVE' ? 'Approved: now a member' : 'Approved: on the waiting list', 'success'); await refresh(); })}>Approve</Button>
                    <Button small variant="ghost" onClick={() => setDeclining(m)}>Decline</Button>
                  </>}
                  {x.canManage && m.status === 'ACTIVE' && <>
                    <select className="input clubs-role" aria-label={`Role of ${m.studentName}`} value={m.role} onChange={(e) => void run(async () => { await clubsApi.setRole(m.id, e.target.value); await refresh(); })}>{['MEMBER', 'CAPTAIN', 'VICE_CAPTAIN'].map((r) => <option key={r} value={r}>{humanize(r)}</option>)}</select>
                    <Button small variant="ghost" onClick={() => setRemoving(m)}>Remove</Button>
                  </>}
                </li>
              ))}</ul>
            )}
          </SectionCard>
          <SectionCard title="Sessions">
            {x.sessions?.length ? <ul className="ops-list">{x.sessions.map((s) => <li key={s.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{fmtDateTime(s.startsAt)}</div><div className="ops-row-sub">{s.venue ?? '—'}{s.attendanceTaken ? ` · ${s.present} present` : ''}</div></div><StatusPill status={s.status === 'PLANNED' ? 'SCHEDULED' : s.status === 'HELD' ? 'COMPLETED' : 'CANCELLED'} label={s.status === 'HELD' ? 'Held' : humanize(s.status)} /></li>)}</ul> : <p className="ops-muted">Nothing scheduled.</p>}
          </SectionCard>
        </div>
      )}</Loadable>
      {declining && <PromptModal title={`Decline ${declining.studentName}`} label="Reason (the family is told)" onClose={() => setDeclining(null)} onSubmit={async (v) => { await clubsApi.decide(declining.id, 'DECLINE', v); toast('Declined', 'info'); await refresh(); }} />}
      {removing && <PromptModal title={`Remove ${removing.studentName}`} label="Reason" danger confirmLabel="Remove" onClose={() => setRemoving(null)} onSubmit={async (v) => { await clubsApi.leave(removing.id, v); toast('Removed; the next on the waiting list gets the place', 'info'); await refresh(); }} />}
      {scheduling && c && <SessionForm club={c} options={options} onClose={() => setScheduling(false)} onDone={(n, k) => { setScheduling(false); toast(`${n} session(s) scheduled${k ? `, ${k} left out (clash)` : ''}`, k ? 'info' : 'success'); void refresh(); }} />}
      {portfolioOf && <Modal title="Participation portfolio" wide onClose={() => setPortfolioOf(null)}><PortfolioLoader studentId={portfolioOf} /></Modal>}
    </Drawer>
  );
}

function Approvals({ onChange }: { onChange: () => void }) {
  const list = useLoad(() => clubsApi.approvals(), []);
  const { run, error } = useAction();
  const [declining, setDeclining] = useState<Membership | null>(null);
  const toast = useToast();
  return (
    <SectionCard title="Requests to decide" sub="A request from a student under 18 waits for a parent's consent before you can approve it.">
      <ErrorNote error={error} />
      <Loadable state={list}>{(rows) => !rows.length ? <EmptyState title="Nothing waiting" sub="New requests to join your clubs appear here." /> : (
        <ul className="ops-list">{rows.map((m) => (
          <li key={m.id} className="ops-row">
            <div className="ops-row-main"><div className="ops-row-title">{m.studentName} → {m.clubName}</div><div className="ops-row-sub">{m.className ?? ''} · asked {fmtDate(m.requestedAt)} by {humanize(m.requestedByRole)}{m.note ? ` · “${m.note}”` : ''}</div></div>
            <MemberStatus m={m} />
            {m.status === 'AWAITING_APPROVAL' && <>
              <Button small onClick={() => void run(async () => { const out = await clubsApi.decide(m.id, 'APPROVE'); toast(out.status === 'ACTIVE' ? 'Approved: now a member' : `Approved: waiting list #${out.waitlistPosition ?? ''}`, 'success'); await list.reload(); onChange(); })}>Approve</Button>
              <Button small variant="ghost" onClick={() => setDeclining(m)}>Decline</Button>
            </>}
          </li>
        ))}</ul>
      )}</Loadable>
      {declining && <PromptModal title={`Decline ${declining.studentName}`} label="Reason (the family is told)" onClose={() => setDeclining(null)} onSubmit={async (v) => { await clubsApi.decide(declining.id, 'DECLINE', v); await list.reload(); onChange(); }} />}
    </SectionCard>
  );
}

function StaffSessions() {
  const [mine, setMine] = useState(true);
  const list = useLoad(() => clubsApi.sessions({ mine: mine ? 'true' : undefined, from: new Date(Date.now() - 7 * 86_400_000).toISOString(), to: new Date(Date.now() + 14 * 86_400_000).toISOString() }), [mine]);
  const [register, setRegister] = useState<ClubSession | null>(null);
  const [cancelling, setCancelling] = useState<ClubSession | null>(null);
  const toast = useToast();
  return (
    <SectionCard title="Sessions" sub="The last week and the next two." actions={<label className="ops-chip"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />Only clubs I run</label>}>
      <Loadable state={list}>{(rows) => !rows.length ? <p className="ops-muted">No sessions in this window. Open a club to schedule them.</p> : <SessionList rows={rows} onRegister={setRegister} onCancel={setCancelling} />}</Loadable>
      {register && <RegisterModal session={register} onClose={() => setRegister(null)} onDone={() => { setRegister(null); toast('Register saved', 'success'); void list.reload(); }} />}
      {cancelling && <PromptModal title="Cancel the session" label="Reason (members are told)" danger confirmLabel="Cancel session" onClose={() => setCancelling(null)} onSubmit={async (v) => { await clubsApi.cancelSession(cancelling.id, v); await list.reload(); }} />}
    </SectionCard>
  );
}

function Kit() {
  const items = useLoad(() => clubsApi.equipment({}), []);
  const issues = useLoad(() => clubsApi.issues({}), []);
  const clubs = useLoad(() => clubsApi.list({ mine: 'true' }), []);
  const [adding, setAdding] = useState(false);
  const [lending, setLending] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', totalQty: '1', clubId: '' });
  const [lend, setLend] = useState({ studentId: '', qty: '1', dueAt: isoDay(new Date(Date.now() + 7 * 86_400_000)) });
  const { run, busy, error } = useAction();
  const toast = useToast();
  const lendClub = useLoad(() => {
    const it = (items.data ?? []).find((i) => i.id === lending);
    return it?.clubId ? clubsApi.get(it.clubId) : Promise.resolve(null);
  }, [lending]);
  const back = (i: EquipmentIssue, outcome: 'RETURNED' | 'LOST', condition?: 'GOOD' | 'DAMAGED') => void run(async () => { await clubsApi.returnIssue(i.id, { outcome, condition }); toast(outcome === 'LOST' ? 'Written off' : 'Returned', 'info'); await Promise.all([items.reload(), issues.reload()]); });
  return (
    <div className="ops-stack">
      <SectionCard title="Kit" actions={<Button onClick={() => setAdding(true)}>Add kit</Button>}>
        <Loadable state={items}>{(rows) => !rows.length ? <p className="ops-muted">No kit recorded.</p> : (
          <ul className="ops-list">{rows.map((i) => <li key={i.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{i.name}</div><div className="ops-row-sub">{i.code}{i.clubName ? ` · ${i.clubName}` : ' · shared'} · {i.availableQty} of {i.totalQty} on the shelf</div></div><Button small variant="soft" disabled={!i.availableQty} onClick={() => setLending(i.id)}>Lend</Button></li>)}</ul>
        )}</Loadable>
      </SectionCard>
      <SectionCard title="Lent out">
        <ErrorNote error={error} />
        <Loadable state={issues}>{(rows) => !rows.filter((r) => r.status === 'ISSUED').length ? <p className="ops-muted">Everything is back.</p> : (
          <ul className="ops-list">{rows.filter((r) => r.status === 'ISSUED').map((i) => <li key={i.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{i.qty} × {i.equipmentName} · {i.studentName}</div><div className="ops-row-sub">Lent {fmtDate(i.issuedAt)}{i.dueAt ? ` · due ${fmtDate(i.dueAt)}` : ''}</div></div>{i.overdue && <StatusPill status="OVERDUE" />}<Button small onClick={() => back(i, 'RETURNED', 'GOOD')}>Back, good</Button><Button small variant="soft" onClick={() => back(i, 'RETURNED', 'DAMAGED')}>Back, damaged</Button><Button small variant="ghost" onClick={() => back(i, 'LOST')}>Lost</Button></li>)}</ul>
        )}</Loadable>
      </SectionCard>
      {adding && <Modal title="Add kit" onClose={() => setAdding(false)} footer={<><Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button><Button disabled={busy || !form.name.trim()} onClick={() => void run(async () => { await clubsApi.addEquipment({ name: form.name, totalQty: Number(form.totalQty), clubId: form.clubId || undefined }); setAdding(false); await items.reload(); })}>Add</Button></>}>
        <Field label="What" required><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Football (size 5)" /></Field>
        <Field label="How many"><input className="input" type="number" min={1} value={form.totalQty} onChange={(e) => setForm({ ...form, totalQty: e.target.value })} /></Field>
        <Field label="Club"><select className="input" value={form.clubId} onChange={(e) => setForm({ ...form, clubId: e.target.value })}><option value="">Shared (administration)</option>{(clubs.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <ErrorNote error={error} />
      </Modal>}
      {lending && <Modal title="Lend kit" onClose={() => setLending(null)} footer={<><Button variant="ghost" onClick={() => setLending(null)}>Cancel</Button><Button disabled={busy || !lend.studentId} onClick={() => void run(async () => { await clubsApi.issue({ equipmentId: lending, studentId: lend.studentId, qty: Number(lend.qty), dueAt: lend.dueAt ? new Date(`${lend.dueAt}T17:00:00+05:30`).toISOString() : undefined }); setLending(null); toast('Lent; a reminder is on your task list', 'success'); await Promise.all([items.reload(), issues.reload()]); })}>Lend</Button></>}>
        <Field label="Student" required>{lendClub.data?.members ? <select className="input" value={lend.studentId} onChange={(e) => setLend({ ...lend, studentId: e.target.value })}><option value="">Choose a member…</option>{lendClub.data.members.filter((m) => m.status === 'ACTIVE').map((m) => <option key={m.studentId} value={m.studentId}>{m.studentName}</option>)}</select> : <input className="input" value={lend.studentId} onChange={(e) => setLend({ ...lend, studentId: e.target.value })} placeholder="Student ID" />}</Field>
        <div className="ops-grid-2">
          <Field label="How many"><input className="input" type="number" min={1} value={lend.qty} onChange={(e) => setLend({ ...lend, qty: e.target.value })} /></Field>
          <Field label="Back by"><input className="input" type="date" value={lend.dueAt} onChange={(e) => setLend({ ...lend, dueAt: e.target.value })} /></Field>
        </div>
        <ErrorNote error={error} />
      </Modal>}
    </div>
  );
}

function StaffClubs({ scope }: { scope: string }) {
  const [tab, setTab] = useState<'clubs' | 'approvals' | 'sessions' | 'fixtures' | 'kit'>('clubs');
  const [mine, setMine] = useState(scope !== 'ALL');
  const [cat, setCat] = useState('ALL');
  const clubs = useLoad(() => clubsApi.list({ mine: mine ? 'true' : undefined }), [mine]);
  const options = useLoad(() => clubsApi.options(), []);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const toast = useToast();
  const pending = useMemo(() => (clubs.data ?? []).reduce((t, c) => t + (c.iCoach || scope === 'ALL' ? c.awaitingApproval ?? 0 : 0), 0), [clubs.data, scope]);
  return (
    <div className="ops-stack">
      <Tabs tabs={[{ key: 'clubs', label: 'Clubs & teams' }, { key: 'approvals', label: 'Requests', count: pending }, { key: 'sessions', label: 'Sessions & registers' }, { key: 'fixtures', label: 'Fixtures & houses' }, { key: 'kit', label: 'Kit' }]} value={tab} onChange={setTab} />
      {tab === 'clubs' && (
        <SectionCard title="Clubs and teams" actions={<div className="ops-inline">
          <CategoryFilter value={cat} onChange={setCat} />
          <label className="ops-chip"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />Only mine</label>
          {scope === 'ALL' && <Button onClick={() => setCreating(true)} disabled={!options.data}>New club</Button>}
        </div>}>
          <Loadable state={clubs}>{(rows) => {
            const shown = rows.filter((c) => cat === 'ALL' || c.category === cat);
            return !shown.length ? <EmptyState title={mine ? 'You are not in charge of a club' : 'No clubs yet'} sub={scope === 'ALL' ? 'Create a club and name the teachers in charge.' : 'Administration names the teachers in charge of each club.'} /> : (
              <ul className="clubs-grid">{shown.map((c) => <ClubCard key={c.id} c={c} onOpen={() => setOpen(c.id)} />)}</ul>
            );
          }}</Loadable>
        </SectionCard>
      )}
      {tab === 'approvals' && <Approvals onChange={() => void clubs.reload()} />}
      {tab === 'sessions' && <StaffSessions />}
      {tab === 'fixtures' && <FixturesAndHouses staff options={options.data} />}
      {tab === 'kit' && <Kit />}
      {open && <ClubDrawer clubId={open} options={options.data} onClose={() => setOpen(null)} onChange={() => void clubs.reload()} />}
      {creating && options.data && <ClubForm options={options.data} onClose={() => setCreating(false)} onDone={() => { setCreating(false); toast('Club created', 'success'); void clubs.reload(); }} />}
    </div>
  );
}

export function ClubsView() {
  const { permissions } = usePermissions();
  const manage = permissions['clubs.manage'];
  if (manage) return <StaffClubs scope={manage} />;
  return <FamilyClubs />;
}
