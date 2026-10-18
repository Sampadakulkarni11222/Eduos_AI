'use client';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui';
import { opsApi } from '@/lib/ops-api';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { CredentialPart, ShiftBellDto, ShiftDto, ShiftsDto, StaffCredentialDto, TeachersOfDto } from '@/lib/ops-types';
import { DataNote, ErrorNote, Loadable, SectionCard, fmtDateTime, humanize, useAction, useLoad } from './kit';
import { TeacherAbout } from '@/components/campus/campus-moment';

/**
 * Shifts and bell schedules (admin), the staff member's professional profile
 * with a "show to families" consent per part (every member of staff; HR may
 * edit anyone's content but not their consent), and the teacher cards a
 * family sees (only what each teacher agreed to share).
 */

const DAYS: Array<[number, string]> = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']];
const KINDS: ShiftBellDto['kind'][] = ['ARRIVAL', 'ASSEMBLY', 'PERIOD', 'BREAK', 'LUNCH', 'DISPERSAL', 'CLUBS'];
const STANDARD: ShiftBellDto[] = [
  { kind: 'ARRIVAL', label: 'Arrival', periodNo: null, start: '07:45', end: '08:05' },
  { kind: 'ASSEMBLY', label: 'Assembly', periodNo: null, start: '08:05', end: '08:25' },
  { kind: 'PERIOD', label: null, periodNo: 1, start: '08:30', end: '09:15' },
  { kind: 'PERIOD', label: null, periodNo: 2, start: '09:15', end: '10:00' },
  { kind: 'BREAK', label: 'Short break', periodNo: null, start: '10:00', end: '10:15' },
  { kind: 'PERIOD', label: null, periodNo: 3, start: '10:15', end: '11:00' },
  { kind: 'PERIOD', label: null, periodNo: 4, start: '11:00', end: '11:45' },
  { kind: 'LUNCH', label: 'Lunch', periodNo: null, start: '11:45', end: '12:30' },
  { kind: 'PERIOD', label: null, periodNo: 5, start: '12:30', end: '13:15' },
  { kind: 'DISPERSAL', label: 'Home time', periodNo: null, start: '13:15', end: '13:35' },
];
const bellName = (b: ShiftBellDto) => (b.kind === 'PERIOD' ? `Period ${b.periodNo}` : b.label || humanize(b.kind));

type Draft = { id: string | null; code: string; name: string; color: string; daysOfWeek: number[]; bells: ShiftBellDto[]; sectionIds: string[]; note: string };
const fromShift = (s: ShiftDto): Draft => ({ id: s.id, code: s.code, name: s.name, color: s.color ?? '#4F86E8', daysOfWeek: s.daysOfWeek, bells: s.bells, sectionIds: s.sections.map((x) => x.id), note: s.note ?? '' });
const blank = (): Draft => ({ id: null, code: '', name: '', color: '#2BA39A', daysOfWeek: [1, 2, 3, 4, 5, 6], bells: STANDARD.map((b) => ({ ...b })), sectionIds: [], note: '' });

function ShiftEditor({ draft, all, data, onDone, onCancel }: { draft: Draft; all: ShiftsDto['sections']; data: ShiftsDto; onDone: () => void; onCancel: () => void }) {
  const [d, setD] = useState<Draft>(draft);
  const [move, setMove] = useState<string | null>(null);
  const { run, busy, error, clearError } = useAction();
  const inOther = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of data.shifts) if (s.id !== d.id) for (const x of s.sections) m.set(x.id, s.name);
    return m;
  }, [data, d.id]);
  const setBell = (i: number, patch: Partial<ShiftBellDto>) => setD({ ...d, bells: d.bells.map((b, k) => (k === i ? { ...b, ...patch } : b)) });
  const save = (moveSections = false) => void run(async () => {
    setMove(null);
    const body = { code: d.code, name: d.name, color: d.color, daysOfWeek: d.daysOfWeek, bells: d.bells.map((b) => ({ ...b, periodNo: b.kind === 'PERIOD' ? Number(b.periodNo) : null })), sectionIds: d.sectionIds, note: d.note || null, moveSections };
    try {
      if (d.id) await opsApi.updateShift(d.id, body); else await opsApi.createShift(body);
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SECTION_IN_OTHER_SHIFT') { setMove(e.message); return; }
      throw e;
    }
  });
  return (
    <SectionCard title={d.id ? `Edit ${d.name}` : 'New shift'} sub="Saving sets the timetable times of the classes in this shift to its period bells.">
      <div className="p3s-grid">
        <label className="field"><span className="field-label">Code</span><input className="input" value={d.code} maxLength={20} onChange={(e) => setD({ ...d, code: e.target.value.toUpperCase() })} placeholder="MORNING" /></label>
        <label className="field"><span className="field-label">Name</span><input className="input" value={d.name} maxLength={80} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Primary morning shift" /></label>
        <label className="field"><span className="field-label">Colour on the map</span><input className="input" type="color" value={d.color} onChange={(e) => setD({ ...d, color: e.target.value })} /></label>
      </div>
      <fieldset className="p3s-days"><legend className="field-label">Days it runs</legend>
        {DAYS.map(([n, label]) => (
          <label key={n} className="ops-chip"><input type="checkbox" checked={d.daysOfWeek.includes(n)} onChange={(e) => setD({ ...d, daysOfWeek: e.target.checked ? [...d.daysOfWeek, n].sort() : d.daysOfWeek.filter((x) => x !== n) })} />{label}</label>
        ))}
      </fieldset>
      <div className="field-label">Bell schedule</div>
      <div className="p3s-bells" role="table" aria-label="Bell schedule">
        {d.bells.map((b, i) => (
          <div key={i} className="p3s-bell" role="row">
            <select className="input" aria-label={`Bell ${i + 1} kind`} value={b.kind} onChange={(e) => setBell(i, { kind: e.target.value as ShiftBellDto['kind'] })}>{KINDS.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select>
            {b.kind === 'PERIOD'
              ? <input className="input" type="number" min={1} max={20} aria-label={`Bell ${i + 1} period number`} value={b.periodNo ?? ''} onChange={(e) => setBell(i, { periodNo: Number(e.target.value) || null })} />
              : <input className="input" aria-label={`Bell ${i + 1} label`} value={b.label ?? ''} onChange={(e) => setBell(i, { label: e.target.value })} placeholder="Label" />}
            <input className="input" type="time" aria-label={`Bell ${i + 1} start`} value={b.start} onChange={(e) => setBell(i, { start: e.target.value })} />
            <input className="input" type="time" aria-label={`Bell ${i + 1} end`} value={b.end} onChange={(e) => setBell(i, { end: e.target.value })} />
            <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove bell ${i + 1}`} onClick={() => setD({ ...d, bells: d.bells.filter((_, k) => k !== i) })}>✕</button>
          </div>
        ))}
      </div>
      <div className="ops-inline">
        <Button small variant="soft" onClick={() => { const last = d.bells[d.bells.length - 1]; const nextNo = Math.max(0, ...d.bells.filter((b) => b.kind === 'PERIOD').map((b) => b.periodNo ?? 0)) + 1; setD({ ...d, bells: [...d.bells, { kind: 'PERIOD', label: null, periodNo: nextNo, start: last?.end ?? '08:30', end: last?.end ?? '09:15' }] }); }}>+ Add a bell</Button>
        <Button small variant="ghost" onClick={() => setD({ ...d, bells: STANDARD.map((b) => ({ ...b })) })}>Start from a standard morning</Button>
      </div>
      <fieldset className="p3s-classes"><legend className="field-label">Classes in this shift</legend>
        {all.map((s) => (
          <label key={s.id} className="ops-chip" title={inOther.has(s.id) ? `Now in ${inOther.get(s.id)}` : undefined}>
            <input type="checkbox" checked={d.sectionIds.includes(s.id)} onChange={(e) => setD({ ...d, sectionIds: e.target.checked ? [...d.sectionIds, s.id] : d.sectionIds.filter((x) => x !== s.id) })} />
            {s.name}{inOther.has(s.id) ? <span className="ops-muted"> · {inOther.get(s.id)}</span> : null}
          </label>
        ))}
      </fieldset>
      <label className="field"><span className="field-label">Note</span><input className="input" value={d.note} maxLength={400} onChange={(e) => setD({ ...d, note: e.target.value })} /></label>
      {move && (
        <div className="p3s-move" role="alert">
          <p>{move}</p>
          <Button small onClick={() => save(true)} disabled={busy}>Move them to this shift</Button>
          <Button small variant="ghost" onClick={() => setMove(null)}>Keep them where they are</Button>
        </div>
      )}
      <ErrorNote error={error} />
      <div className="ops-inline">
        <Button onClick={() => { clearError(); save(false); }} disabled={busy || !d.code || !d.name}>{busy ? 'Saving…' : 'Save shift'}</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </SectionCard>
  );
}

export function ShiftsView() {
  const state = useLoad(() => opsApi.shifts(), []);
  const [editing, setEditing] = useState<Draft | null>(null);
  const { run, error } = useAction();
  return (
    <div className="ops-stack">
      <DataNote>A shift is a school day with its own bells. Each class belongs to one shift; teachers may teach in any. Two classes of different shifts can never be in the same room at the same time: saving such a plan is refused and the clash is named. Campus World and the timetable use each class&apos;s shift times.</DataNote>
      <ErrorNote error={error} />
      <Loadable state={state}>{(data) => (
        <>
          {editing ? <ShiftEditor draft={editing} all={data.sections} data={data} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); void state.reload(); }} />
            : <div className="ops-inline"><Button onClick={() => setEditing(blank())}>+ New shift</Button></div>}
          {data.conflicts.length > 0 && (
            <SectionCard title="Room clashes between shifts" sub="Fix the timetable room or the bells so these do not overlap.">
              <ul className="ops-list">{data.conflicts.map((c, i) => <li key={i} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{c.room} · {c.day} {c.from}–{c.to}</div><div className="ops-row-sub">{c.classes.join(' and ')}</div></div></li>)}</ul>
            </SectionCard>
          )}
          {data.shifts.length === 0 && !editing && <p className="ops-muted">No shifts yet: the whole school follows the bells its timetable implies. Add a shift to give classes their own bell schedule.</p>}
          {data.shifts.map((s) => (
            <SectionCard key={s.id} title={s.name} sub={`${s.code} · ${DAYS.filter(([n]) => s.daysOfWeek.includes(n)).map(([, l]) => l).join(', ')} · ${s.startsAt ?? ''}–${s.endsAt ?? ''} · ${s.periods} periods`}
              actions={<><Button small variant="soft" onClick={() => setEditing(fromShift(s))}>Edit</Button><Button small variant="ghost" onClick={() => { if (window.confirm(`Retire ${s.name}? Its classes keep their timetable times.`)) void run(async () => { await opsApi.retireShift(s.id); await state.reload(); }); }}>Retire</Button></>}>
              <ol className="p3s-timeline" aria-label={`${s.name} bells`}>
                {s.bells.map((b, i) => <li key={i} className={`is-${b.kind.toLowerCase()}`}><span>{b.start}–{b.end}</span><b>{bellName(b)}</b></li>)}
              </ol>
              <div className="cw-room-chips" aria-label="Classes">{s.sections.length ? s.sections.map((x) => <span key={x.id} className="ops-chip" style={{ borderColor: s.color ?? undefined }}>{x.name}</span>) : <span className="ops-muted">No classes yet.</span>}</div>
              {s.note && <p className="ops-muted">{s.note}</p>}
              {s.updatedAt && <p className="ops-muted">Updated {fmtDateTime(s.updatedAt)}</p>}
            </SectionCard>
          ))}
          {data.unassigned.length > 0 && (
            <SectionCard title="Classes without a shift" sub="They follow the bells their own timetable implies.">
              <div className="cw-room-chips">{data.unassigned.map((x) => <span key={x.id} className="ops-chip">{x.name}</span>)}</div>
            </SectionCard>
          )}
        </>
      )}</Loadable>
    </div>
  );
}

// ── Professional profile ─────────────────────────────────────────────────

const PARTS: Array<[CredentialPart, string]> = [['qualifications', 'Qualifications'], ['subjects', 'Subjects and specialisations'], ['experience', 'Years of experience'], ['certifications', 'Certifications'], ['bio', 'Short public bio']];
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

export function CredentialsEditor({ profile, onSaved, save }: { profile: StaffCredentialDto; onSaved: (p: StaffCredentialDto) => void; save: (body: unknown) => Promise<StaffCredentialDto> }) {
  const [p, setP] = useState(profile);
  const [subjects, setSubjects] = useState(profile.subjects.join(', '));
  const [spec, setSpec] = useState(profile.specialisations.join(', '));
  const [saved, setSaved] = useState(false);
  const { run, busy, error } = useAction();
  useEffect(() => { setP(profile); setSubjects(profile.subjects.join(', ')); setSpec(profile.specialisations.join(', ')); }, [profile]);
  const consentEditable = profile.canEditConsent !== false;
  const toggle = (k: CredentialPart) => (
    <label className={`ops-chip p3c-consent${p.showToFamilies[k] ? ' is-on' : ''}`} title={consentEditable ? undefined : 'Only the person may change what families see.'}>
      <input type="checkbox" disabled={!consentEditable} checked={p.showToFamilies[k]} onChange={(e) => setP({ ...p, showToFamilies: { ...p.showToFamilies, [k]: e.target.checked } })} />
      Show to families
    </label>
  );
  const submit = () => void run(async () => {
    const out = await save({ qualifications: p.qualifications.filter((q) => q.degree.trim()), subjects: list(subjects), specialisations: list(spec), experienceYears: p.experienceYears, certifications: p.certifications.filter((c) => c.name.trim()), bio: p.bio, ...(consentEditable ? { showToFamilies: p.showToFamilies } : {}) });
    onSaved(out); setSaved(true);
  });
  return (
    <div className="ops-stack">
      <SectionCard title="Qualifications" actions={toggle('qualifications')}>
        {p.qualifications.map((q, i) => (
          <div key={i} className="p3s-grid">
            <input className="input" aria-label={`Degree ${i + 1}`} placeholder="Degree or diploma, e.g. M.Sc. Mathematics" value={q.degree} onChange={(e) => setP({ ...p, qualifications: p.qualifications.map((x, k) => (k === i ? { ...x, degree: e.target.value } : x)) })} />
            <input className="input" aria-label={`Institution ${i + 1}`} placeholder="Institution" value={q.institution ?? ''} onChange={(e) => setP({ ...p, qualifications: p.qualifications.map((x, k) => (k === i ? { ...x, institution: e.target.value } : x)) })} />
            <input className="input" aria-label={`Year ${i + 1}`} type="number" min={1950} max={2100} placeholder="Year" value={q.year ?? ''} onChange={(e) => setP({ ...p, qualifications: p.qualifications.map((x, k) => (k === i ? { ...x, year: Number(e.target.value) || null } : x)) })} />
            <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove qualification ${i + 1}`} onClick={() => setP({ ...p, qualifications: p.qualifications.filter((_, k) => k !== i) })}>✕</button>
          </div>
        ))}
        <Button small variant="soft" onClick={() => setP({ ...p, qualifications: [...p.qualifications, { degree: '', institution: null, year: null }] })}>+ Add a qualification</Button>
      </SectionCard>
      <SectionCard title="Subjects and specialisations" actions={toggle('subjects')}>
        <label className="field"><span className="field-label">Subjects (comma separated)</span><input className="input" value={subjects} onChange={(e) => setSubjects(e.target.value)} /></label>
        <label className="field"><span className="field-label">Specialisations</span><input className="input" value={spec} onChange={(e) => setSpec(e.target.value)} /></label>
      </SectionCard>
      <SectionCard title="Experience" actions={toggle('experience')}>
        <label className="field"><span className="field-label">Years of teaching or professional experience</span><input className="input" type="number" min={0} max={60} value={p.experienceYears ?? ''} onChange={(e) => setP({ ...p, experienceYears: e.target.value === '' ? null : Number(e.target.value) })} /></label>
      </SectionCard>
      <SectionCard title="Certifications" sub="For example CTET, a state TET, or a subject certification." actions={toggle('certifications')}>
        {p.certifications.map((c, i) => (
          <div key={i} className="p3s-grid">
            <input className="input" aria-label={`Certification ${i + 1}`} placeholder="Name, e.g. CTET (Paper II)" value={c.name} onChange={(e) => setP({ ...p, certifications: p.certifications.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)) })} />
            <input className="input" aria-label={`Issuer ${i + 1}`} placeholder="Issued by" value={c.issuer ?? ''} onChange={(e) => setP({ ...p, certifications: p.certifications.map((x, k) => (k === i ? { ...x, issuer: e.target.value } : x)) })} />
            <input className="input" aria-label={`Certification year ${i + 1}`} type="number" min={1950} max={2100} placeholder="Year" value={c.year ?? ''} onChange={(e) => setP({ ...p, certifications: p.certifications.map((x, k) => (k === i ? { ...x, year: Number(e.target.value) || null } : x)) })} />
            <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove certification ${i + 1}`} onClick={() => setP({ ...p, certifications: p.certifications.filter((_, k) => k !== i) })}>✕</button>
          </div>
        ))}
        <Button small variant="soft" onClick={() => setP({ ...p, certifications: [...p.certifications, { name: '', issuer: null, year: null }] })}>+ Add a certification</Button>
      </SectionCard>
      <SectionCard title="Short public bio" actions={toggle('bio')}>
        <textarea className="input" rows={3} maxLength={600} aria-label="Short public bio" value={p.bio ?? ''} onChange={(e) => setP({ ...p, bio: e.target.value })} style={{ width: '100%' }} />
      </SectionCard>
      {!consentEditable && <DataNote>What families see is {profile.name}&apos;s own choice; HR can correct the details but not change it.</DataNote>}
      <ErrorNote error={error} />
      <div className="ops-inline"><Button onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</Button>{saved && <span className="ops-muted" role="status">Saved.</span>}</div>
      <SectionCard title="What families see" sub="Parents and students of the classes you teach see only the parts switched on.">
        {profile.familiesSee?.shown.length ? <TeacherAbout about={profile.familiesSee} /> : <p className="ops-muted">Nothing: every part is private.</p>}
      </SectionCard>
    </div>
  );
}

/** Every member of staff: their own professional profile and what families may see of it. */
export function ProfessionalProfileView() {
  const state = useLoad(() => opsApi.myStaffProfile(), []);
  const { me } = useAuth();
  // Families see a staff profile only through the classes that person teaches.
  const teaches = ['TEACHER', 'PRINCIPAL'].includes(me?.profile?.role ?? 'TEACHER');
  return (
    <div className="ops-stack">
      <DataNote>Each part has its own &quot;Show to families&quot; switch, off until you turn it on. Families of the classes you teach then see that part in Campus World, on the live class page and on their teacher cards. Colleagues in the school can see your profile.</DataNote>
      {!teaches && <DataNote>Families see a staff profile only through the classes that person teaches, so these switches matter only if you take a class or period. Colleagues can always see it.</DataNote>}
      <Loadable state={state}>{(p) => <CredentialsEditor profile={p} save={(b) => opsApi.saveMyStaffProfile(b)} onSaved={() => void state.reload()} />}</Loadable>
    </div>
  );
}

/** HR: everyone's profile, how complete it is, and what each shares; editable (not the consent). */
export function StaffProfilesView() {
  const [search, setSearch] = useState('');
  const rows = useLoad(() => opsApi.staffProfiles(search), [search]);
  const [open, setOpen] = useState<string | null>(null);
  const one = useLoad(() => (open ? opsApi.staffProfile(open) : Promise.resolve(null)), [open]);
  return (
    <div className="ops-stack">
      <DataNote>HR may correct a staff member&apos;s qualifications and details. Whether a part is shown to families stays the staff member&apos;s own choice.</DataNote>
      <input className="input" aria-label="Search staff" placeholder="Search by name" value={search} onChange={(e) => setSearch(e.target.value)} />
      <Loadable state={rows}>{(list2) => (
        <ul className="ops-list">{list2.map((r) => (
          <li key={r.profileId} className="ops-row">
            <div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => setOpen(open === r.profileId ? null : r.profileId)}><div className="ops-row-title">{r.name}</div><div className="ops-row-sub">{r.role ?? ''} · {r.filled} of {r.of} parts filled · {r.shownToFamilies.length ? `shares ${r.shownToFamilies.join(', ')}` : 'nothing shared with families'}</div></button></div>
          </li>
        ))}</ul>
      )}</Loadable>
      {open && <Loadable state={one}>{(p) => (p ? <CredentialsEditor profile={p} save={(b) => opsApi.saveStaffProfile(open, b)} onSaved={() => { void one.reload(); void rows.reload(); }} /> : null)}</Loadable>}
    </div>
  );
}

/** A family's teacher cards: each teacher of the child's class, what they teach, and what they chose to share. */
export function ChildTeachersCard({ studentId }: { studentId?: string | null }) {
  const [data, setData] = useState<TeachersOfDto | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    opsApi.teachersOf(studentId ?? null).then((d) => { if (live) setData(d); }).catch((e) => { if (live) setErr(e instanceof Error ? e.message : 'Could not load'); });
    return () => { live = false; };
  }, [studentId]);
  if (err || !data || !data.teachers.length) return null;
  return (
    <div className="p3c-teachers" aria-label="Your child's teachers">
      <div className="field-label">{data.child ? `${data.child}'s teachers` : 'Teachers'}</div>
      <ul className="p3c-tlist">
        {data.teachers.map((t) => (
          <li key={t.profileId} className="p3c-tcard">
            <div><b>{t.name}</b>{t.classTeacher ? <span className="cw-pill is-good"> class teacher</span> : null}</div>
            <div className="ops-muted">{t.teaches.join(', ') || 'Class teacher'}</div>
            <TeacherAbout about={t} compact />
          </li>
        ))}
      </ul>
      <p className="ops-muted">{data.note}</p>
    </div>
  );
}
