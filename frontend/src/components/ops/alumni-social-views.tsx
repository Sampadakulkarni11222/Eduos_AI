'use client';
import { useMemo, useState } from 'react';
import { Button, EmptyState, Field, Modal, useToast } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { usePermissions } from '@/lib/permissions';
import {
  alumniApi, digestApi, socialApi, LINK_HINTS, LINK_LABELS, NETWORKS, NETWORK_LABELS,
  type AlumniEvent, type AlumniPost, type AlumnusMe, type DirectoryEntry, type DigestSourceDto, type LinkKey, type Links, type Network, type OutboxRow, type SocialPostDto, type StudentLinks,
} from '@/lib/alumni-social-api';
import { DataNote, ErrorNote, KeyValues, Loadable, PromptModal, SectionCard, StatusPill, Tabs, Tile, fmtDate, fmtDateTime, humanize, useAction, useLoad } from './kit';

/**
 * Alumni (community, directory, batch, reunions; manage for HR/admin), newsroom
 * social publishing (staff only; simulated without provider credentials), the
 * daily learning digest, and a student's own profile links. The server
 * enforces every rule; these screens explain it where it refuses.
 */

const LINK_KEYS: LinkKey[] = ['linkedin', 'instagram', 'github', 'website'];
const isOff = (error: string | null) => Boolean(error && /switched off/i.test(error));

/** A link from the API, shown only when it is https (the server already insists). */
function SafeLink({ href, children }: { href: string | null | undefined; children: React.ReactNode }) {
  if (!href || !/^https:\/\//i.test(href)) return null;
  return <a href={href} target="_blank" rel="noopener noreferrer nofollow">{children}</a>;
}

function LinkList({ links }: { links?: Links | null }) {
  const shown = LINK_KEYS.filter((k) => links?.[k]);
  if (!shown.length) return null;
  return <span className="alu-links">{shown.map((k) => <SafeLink key={k} href={links?.[k]}>{LINK_LABELS[k]}</SafeLink>)}</span>;
}

function LinksForm({ value, onChange }: { value: Links; onChange: (v: Links) => void }) {
  return (
    <div className="ops-form-grid">
      {LINK_KEYS.map((k) => (
        <Field key={k} label={LINK_LABELS[k]} hint={LINK_HINTS[k]}>
          <input className="input" inputMode="url" value={value[k] ?? ''} onChange={(e) => onChange({ ...value, [k]: e.target.value })} />
        </Field>
      ))}
    </div>
  );
}

// ── Alumni ───────────────────────────────────────────────────────────

function DirectoryList({ rows }: { rows: DirectoryEntry[] }) {
  if (!rows.length) return <EmptyState title="Nobody listed here yet" sub="Only alumni who chose to be listed appear, with their name and batch." />;
  return (
    <ul className="ops-list">{rows.map((r) => (
      <li key={r.id} className="ops-row">
        <div className="ops-row-main">
          <div className="ops-row-title">{r.name}</div>
          <div className="ops-row-sub">{r.batchLabel}{r.profession ? ` · ${r.profession}` : ''}{r.city ? ` · ${r.city}` : ''}</div>
        </div>
        <LinkList links={r.links} />
        <StatusPill status={r.kind === 'FORMER_STAFF' ? 'ASSIGNED' : 'ACTIVE'} label={r.kind === 'FORMER_STAFF' ? 'Former staff' : 'Alumnus'} />
      </li>
    ))}</ul>
  );
}

function Directory({ fixedYear }: { fixedYear?: number | null }) {
  const [year, setYear] = useState(fixedYear ? String(fixedYear) : '');
  const [q, setQ] = useState('');
  const state = useLoad(() => alumniApi.directory({ batchYear: year || undefined, q: q || undefined }), [year, q]);
  return (
    <SectionCard title={fixedYear ? `Your batch · ${fixedYear}` : 'Alumni directory'} sub="Name and batch for everyone listed; profession, city and links only where the person chose to share them. Former staff appear under the years they served.">
      {!fixedYear && (
        <div className="ops-form-grid">
          <Field label="Batch year"><input className="input" inputMode="numeric" placeholder="e.g. 2018" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} /></Field>
          <Field label="Search by name"><input className="input" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        </div>
      )}
      <Loadable state={state}>{(d) => <DirectoryList rows={d.items} />}</Loadable>
    </SectionCard>
  );
}

function Batches() {
  const state = useLoad(() => alumniApi.batches(), []);
  return (
    <SectionCard title="Batches" sub="Passing-out years, and how many former staff served in each.">
      <Loadable state={state}>{(rows) => !rows.length ? <p className="ops-muted">No alumni yet.</p> : (
        <div className="alu-batches">{rows.slice(0, 40).map((b) => <Tile key={b.year} label={String(b.year)} value={`${b.students} alumni${b.staff ? ` · ${b.staff} staff` : ''}`} />)}</div>
      )}</Loadable>
    </SectionCard>
  );
}

function PostRow({ p, manager, onChanged }: { p: AlumniPost; manager: boolean; onChanged: () => void }) {
  const [asking, setAsking] = useState<null | 'REJECT' | 'TAKE_DOWN'>(null);
  const { run, busy, error } = useAction();
  return (
    <li className="ops-row alu-post">
      <div className="ops-row-main">
        <div className="ops-row-title">{p.title || 'Post'} <span className="ops-muted">· {p.circle}</span></div>
        <p className="alu-post-body">{p.body}</p>
        <div className="ops-row-sub">{p.authorName ?? '—'} · {fmtDateTime(p.publishedAt ?? p.createdAt)}{p.note ? ` · ${p.note}` : ''}</div>
        <ErrorNote error={error} />
      </div>
      <StatusPill status={p.status} label={p.status === 'PENDING_REVIEW' ? 'Waiting for review' : undefined} />
      {manager && p.status === 'PENDING_REVIEW' && <>
        <Button small disabled={busy} onClick={() => void run(async () => { await alumniApi.moderatePost(p.id, 'PUBLISH'); onChanged(); })}>Publish</Button>
        <Button small variant="ghost" onClick={() => setAsking('REJECT')}>Reject</Button>
      </>}
      {manager && p.status === 'PUBLISHED' && <Button small variant="ghost" onClick={() => setAsking('TAKE_DOWN')}>Take down</Button>}
      {asking && <PromptModal title={asking === 'REJECT' ? 'Reject post' : 'Take down post'} label="Reason (the author sees it)" danger onClose={() => setAsking(null)} onSubmit={(note) => alumniApi.moderatePost(p.id, asking, note).then(onChanged)} />}
    </li>
  );
}

function Community({ manager }: { manager: boolean }) {
  const circles = useLoad(() => alumniApi.circles(), []);
  const [status, setStatus] = useState<'PENDING_REVIEW' | 'PUBLISHED' | ''>(manager ? 'PENDING_REVIEW' : '');
  const posts = useLoad(() => alumniApi.posts({ status: status || undefined }), [status]);
  const [f, setF] = useState({ circleId: '', title: '', body: '' });
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <div className="ops-stack">
      <SectionCard title="Write to your circle" sub={manager ? 'Your post is published at once.' : 'Posts wait for the school to review them before your circle sees them.'}>
        <div className="ops-form-grid">
          <Field label="Circle" required>
            <select className="input" value={f.circleId} onChange={(e) => setF({ ...f, circleId: e.target.value })}>
              <option value="">Choose…</option>
              {(circles.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.members})</option>)}
            </select>
          </Field>
          <Field label="Title"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        </div>
        <Field label="Post" required><textarea className="input" rows={3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} style={{ width: '100%' }} /></Field>
        <ErrorNote error={error} />
        <Button disabled={busy || !f.circleId || !f.body.trim()} onClick={() => void run(async () => { await alumniApi.createPost({ circleId: f.circleId, title: f.title || undefined, body: f.body }); toast(manager ? 'Published' : 'Sent for review', 'success'); setF({ ...f, title: '', body: '' }); await posts.reload(); })}>{manager ? 'Publish' : 'Send for review'}</Button>
      </SectionCard>
      <SectionCard title="Posts" actions={manager ? <Tabs tabs={[{ key: 'PENDING_REVIEW', label: 'To review' }, { key: 'PUBLISHED', label: 'Published' }]} value={status || 'PENDING_REVIEW'} onChange={(v) => setStatus(v as 'PENDING_REVIEW' | 'PUBLISHED')} /> : undefined}>
        <Loadable state={posts}>{(rows) => !rows.length ? <p className="ops-muted">Nothing here yet.</p> : <ul className="ops-list">{rows.map((p) => <PostRow key={p.id} p={p} manager={manager} onChanged={() => void posts.reload()} />)}</ul>}</Loadable>
      </SectionCard>
    </div>
  );
}

function EventForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ title: '', batchYear: '', startsAt: '', venue: '', description: '' });
  const { run, busy, error } = useAction();
  return (
    <Modal title="Plan a reunion or alumni event" onClose={onClose} footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.title || !f.startsAt} onClick={() => void run(async () => {
      await alumniApi.createEvent({ title: f.title, batchYear: f.batchYear || undefined, startsAt: new Date(f.startsAt).toISOString(), venue: f.venue || undefined, description: f.description || undefined });
      onSaved(); onClose();
    })}>Create and invite</Button></>}>
      <div className="ops-form-grid">
        <Field label="Title" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Batch year" hint="Leave empty to invite every alumnus"><input className="input" inputMode="numeric" value={f.batchYear} onChange={(e) => setF({ ...f, batchYear: e.target.value.replace(/\D/g, '').slice(0, 4) })} /></Field>
        <Field label="Starts" required><input type="datetime-local" className="input" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></Field>
        <Field label="Venue"><input className="input" value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} /></Field>
      </div>
      <Field label="Details"><textarea className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} style={{ width: '100%' }} /></Field>
      <ErrorNote error={error} />
    </Modal>
  );
}

function Events({ manager }: { manager: boolean }) {
  const state = useLoad(() => alumniApi.events(), []);
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<AlumniEvent | null>(null);
  const { run, busy, error } = useAction();
  return (
    <SectionCard title="Reunions and events" actions={manager ? <Button onClick={() => setAdding(true)}>+ New event</Button> : undefined}>
      <ErrorNote error={error} />
      <Loadable state={state}>{(rows) => !rows.length ? <p className="ops-muted">No reunions planned yet.</p> : (
        <ul className="ops-list">{rows.map((e) => (
          <li key={e.id} className="ops-row">
            <div className="ops-row-main">
              <div className="ops-row-title">{e.title}</div>
              <div className="ops-row-sub">{e.audience} · {fmtDateTime(e.startsAt)}{e.venue ? ` · ${e.venue}` : ''} · {e.rsvp.yes} going, {e.rsvp.maybe} maybe</div>
              {e.description && <p className="alu-post-body">{e.description}</p>}
            </div>
            <StatusPill status={e.status === 'PLANNED' ? 'SCHEDULED' : e.status} label={humanize(e.status)} />
            {!manager && e.status === 'PLANNED' && (
              <span className="alu-rsvp" role="group" aria-label={`Reply to ${e.title}`}>
                {(['YES', 'MAYBE', 'NO'] as const).map((r) => (
                  <Button key={r} small variant={e.rsvp.mine === r ? 'accent' : 'soft'} aria-pressed={e.rsvp.mine === r} disabled={busy} onClick={() => void run(async () => { await alumniApi.rsvp(e.id, r); await state.reload(); })}>{r === 'YES' ? 'Going' : r === 'MAYBE' ? 'Maybe' : 'Not going'}</Button>
                ))}
              </span>
            )}
            {manager && e.status === 'PLANNED' && <Button small variant="ghost" onClick={() => setCancelling(e)}>Cancel</Button>}
          </li>
        ))}</ul>
      )}</Loadable>
      {adding && <EventForm onClose={() => setAdding(false)} onSaved={() => void state.reload()} />}
      {cancelling && <PromptModal title={`Cancel ${cancelling.title}`} label="Note" required={false} danger onClose={() => setCancelling(null)} onSubmit={(note) => alumniApi.cancelEvent(cancelling.id, note).then(() => state.reload())} />}
    </SectionCard>
  );
}

function MyProfile({ me, onSaved }: { me: AlumnusMe; onSaved: (m: AlumnusMe) => void }) {
  const [f, setF] = useState({ profession: me.profession ?? '', city: me.city ?? '', links: me.links ?? {}, consent: me.consent, listed: me.listed });
  const record = useLoad(() => alumniApi.myRecord(), []);
  const { run, busy, error } = useAction();
  const toast = useToast();
  const toggle = (k: 'profession' | 'city' | 'links') => setF({ ...f, consent: { ...f.consent, [k]: !f.consent[k] } });
  return (
    <div className="ops-stack">
      <SectionCard title="What others see" sub="Your name and batch are listed by default. Each other detail appears only if you switch it on.">
        <label className="alu-consent"><input type="checkbox" checked={f.listed} onChange={() => setF({ ...f, listed: !f.listed })} /> List me in the alumni directory</label>
        <div className="ops-form-grid">
          <Field label="Profession"><input className="input" value={f.profession} onChange={(e) => setF({ ...f, profession: e.target.value })} /></Field>
          <Field label="City"><input className="input" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
        </div>
        <label className="alu-consent"><input type="checkbox" checked={f.consent.profession} onChange={() => toggle('profession')} /> Show my profession</label>
        <label className="alu-consent"><input type="checkbox" checked={f.consent.city} onChange={() => toggle('city')} /> Show my city</label>
        <LinksForm value={f.links} onChange={(links) => setF({ ...f, links })} />
        <label className="alu-consent"><input type="checkbox" checked={f.consent.links} onChange={() => toggle('links')} /> Show my links</label>
        <ErrorNote error={error} />
        <Button disabled={busy} onClick={() => void run(async () => {
          const links = Object.fromEntries(LINK_KEYS.map((k) => [k, (f.links[k] ?? '').trim() || null]));
          const out = await alumniApi.updateMe({ profession: f.profession, city: f.city, links, consent: f.consent, listed: f.listed });
          toast('Saved', 'success'); onSaved(out);
        })}>Save</Button>
      </SectionCard>
      <SectionCard title="Your school record" sub="Kept by the school. Marks, fees and certificates are not shown here.">
        <Loadable state={record}>{(r) => (
          <>
            <KeyValues rows={[['Name', r.name], ['Admission no.', r.admissionNo ?? undefined], ['Batch', r.batchLabel ?? (r.servedFrom ? `Staff ${r.servedFrom}–${r.servedTo}` : undefined)], ['Left as', humanize(r.leftReason)]]} />
            {r.enrolments?.length ? <ul className="ops-list">{r.enrolments.map((e, i) => <li key={i} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{e.year ?? '—'} · {e.class ?? '—'}</div></div><StatusPill status={e.status} /></li>)}</ul> : null}
            <DataNote>{r.note}</DataNote>
          </>
        )}</Loadable>
      </SectionCard>
    </div>
  );
}

function TransitionForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<'student' | 'staff'>('student');
  const [f, setF] = useState({ id: '', reason: 'GRADUATED', batchYear: '', house: '', servedFrom: '', servedTo: '' });
  const { run, busy, error } = useAction();
  return (
    <Modal title="Move to alumni" onClose={onClose} footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.id.trim()} onClick={() => void run(async () => {
      await alumniApi.transition(kind === 'student'
        ? { studentId: f.id.trim(), reason: f.reason, batchYear: f.batchYear || undefined, house: f.house || undefined }
        : { staffProfileId: f.id.trim(), reason: f.reason, servedFrom: f.servedFrom || undefined, servedTo: f.servedTo || undefined });
      onSaved(); onClose();
    })}>Move to alumni</Button></>}>
      <Tabs tabs={[{ key: 'student', label: 'A student' }, { key: 'staff', label: 'A member of staff' }]} value={kind} onChange={(k) => { setKind(k); setF({ ...f, reason: k === 'student' ? 'GRADUATED' : 'LEFT' }); }} />
      <div className="ops-form-grid">
        <Field label={kind === 'student' ? 'Student record id' : 'Staff profile id'} required hint="From the student's or staff member's page"><input className="input" value={f.id} onChange={(e) => setF({ ...f, id: e.target.value })} /></Field>
        <Field label="Reason">
          <select className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>
            {(kind === 'student' ? ['GRADUATED', 'LEFT', 'TRANSFERRED'] : ['LEFT', 'RESIGNED', 'RETIRED']).map((r) => <option key={r} value={r}>{humanize(r)}</option>)}
          </select>
        </Field>
        {kind === 'student' ? <>
          <Field label="Passing-out year" hint="Defaults to the end of their last academic year"><input className="input" inputMode="numeric" value={f.batchYear} onChange={(e) => setF({ ...f, batchYear: e.target.value.replace(/\D/g, '').slice(0, 4) })} /></Field>
          <Field label="House"><input className="input" value={f.house} onChange={(e) => setF({ ...f, house: e.target.value })} /></Field>
        </> : <>
          <Field label="Served from (year)"><input className="input" inputMode="numeric" value={f.servedFrom} onChange={(e) => setF({ ...f, servedFrom: e.target.value.replace(/\D/g, '').slice(0, 4) })} /></Field>
          <Field label="Served to (year)"><input className="input" inputMode="numeric" value={f.servedTo} onChange={(e) => setF({ ...f, servedTo: e.target.value.replace(/\D/g, '').slice(0, 4) })} /></Field>
        </>}
      </div>
      <DataNote>Their {kind === 'student' ? 'student' : 'staff'} sign-in is closed and an alumni profile opens on the same account: community, directory and reunions only — no student records, marks or fees.</DataNote>
      <ErrorNote error={error} />
    </Modal>
  );
}

function Records() {
  const state = useLoad(() => alumniApi.records(), []);
  const [adding, setAdding] = useState(false);
  const { run, error } = useAction();
  return (
    <SectionCard title="Alumni records" sub="Consent flags are shown; private details are not." actions={<Button onClick={() => setAdding(true)}>+ Move to alumni</Button>}>
      <ErrorNote error={error} />
      <Loadable state={state}>{(rows) => !rows.length ? <p className="ops-muted">No alumni yet. When a student graduates or a teacher leaves, move them here.</p> : (
        <ul className="ops-list">{rows.map((r) => (
          <li key={r.id} className="ops-row">
            <div className="ops-row-main">
              <div className="ops-row-title">{r.name}</div>
              <div className="ops-row-sub">{r.batchLabel} · {humanize(r.leftReason)} · {r.hasLogin ? 'has a sign-in' : 'no sign-in'} · shares: {(['profession', 'city', 'links'] as const).filter((k) => r.consent[k]).join(', ') || 'name and batch only'}{r.listed ? '' : ' · not listed'}</div>
            </div>
            <StatusPill status={r.status === 'ACTIVE' ? 'ACTIVE' : 'BLOCKED'} label={r.status === 'ACTIVE' ? 'Active' : 'Suspended'} />
            <Button small variant="ghost" onClick={() => void run(async () => { await alumniApi.updateRecord(r.id, { status: r.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' }); await state.reload(); })}>{r.status === 'ACTIVE' ? 'Suspend' : 'Restore'}</Button>
          </li>
        ))}</ul>
      )}</Loadable>
      {adding && <TransitionForm onClose={() => setAdding(false)} onSaved={() => void state.reload()} />}
    </SectionCard>
  );
}

type AlumniTab = 'community' | 'directory' | 'batch' | 'events' | 'profile' | 'records' | 'batches';

export function AlumniView() {
  const { me: auth } = useAuth();
  const { permissions } = usePermissions();
  const isAlumnus = auth?.profile?.role === 'ALUMNUS';
  const manager = Boolean(permissions['alumni.manage']);
  const mine = useLoad(() => (isAlumnus ? alumniApi.me() : Promise.resolve(null)), [isAlumnus]);
  const tabs = useMemo(() => {
    const t: Array<{ key: AlumniTab; label: string }> = [];
    if (isAlumnus || manager) t.push({ key: 'community', label: manager && !isAlumnus ? 'Posts to review' : 'Community' });
    t.push({ key: 'directory', label: 'Directory' });
    if (isAlumnus) t.push({ key: 'batch', label: 'My batch' });
    if (isAlumnus || manager) t.push({ key: 'events', label: 'Reunions' });
    if (isAlumnus) t.push({ key: 'profile', label: 'My profile' });
    if (manager) t.push({ key: 'records', label: 'Manage alumni' });
    t.push({ key: 'batches', label: 'Batches' });
    return t;
  }, [isAlumnus, manager]);
  const [tab, setTab] = useState<AlumniTab>(tabs[0].key);
  if (isOff(mine.error)) return <EmptyState icon="⏻" title="Alumni is switched off" sub="An administrator can switch it on in Settings → Features." />;
  const me = mine.data;
  return (
    <div className="ops-stack">
      {me && <DataNote>You are signed in as an alumnus ({me.batchLabel}). Alumni see the community, directory and reunions — not student records, marks or fees.</DataNote>}
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'community' && <Community manager={manager} />}
      {tab === 'directory' && <Directory />}
      {tab === 'batch' && me && <Directory fixedYear={me.kind === 'FORMER_STAFF' ? me.servedTo : me.batchYear} />}
      {tab === 'events' && <Events manager={manager} />}
      {tab === 'profile' && me && <MyProfile me={me} onSaved={(m) => mine.setData(m)} />}
      {tab === 'records' && <Records />}
      {tab === 'batches' && <Batches />}
    </div>
  );
}

// ── Profile links on a student's profile ─────────────────────────────

function StudentLinksCard({ row, onSaved }: { row: StudentLinks; onSaved: (r: StudentLinks) => void }) {
  const self = row.relation === 'SELF';
  const [links, setLinks] = useState<Links>(row.links ?? {});
  const { run, busy, error } = useAction();
  const toast = useToast();
  const save = (body: unknown) => run(async () => { const out = await alumniApi.setStudentLinks(row.studentId, body); toast('Saved', 'success'); onSaved(out); });
  return (
    <SectionCard title={self ? 'My profile links' : `${row.name}'s profile links`} sub={row.rule} actions={<StatusPill status={row.shared ? 'ACTIVE' : 'DRAFT'} label={row.shared ? 'Visible to other students and parents' : 'Private: you, guardians and staff'} />}>
      {self ? <>
        <LinksForm value={links} onChange={setLinks} />
        <label className="alu-consent"><input type="checkbox" checked={Boolean(row.studentConsent)} disabled={busy} onChange={() => void save({ studentConsent: !row.studentConsent })} /> Show my links to other students and parents</label>
        {row.minor && <DataNote>{row.guardianConsent ? 'A guardian has agreed.' : 'A guardian also needs to agree before anyone else can see them. Changing a link asks them again.'}</DataNote>}
        <Button disabled={busy} onClick={() => void save({ links: Object.fromEntries(LINK_KEYS.map((k) => [k, (links[k] ?? '').trim() || null])) })}>Save links</Button>
      </> : <>
        {LINK_KEYS.some((k) => row.links?.[k]) ? <p><LinkList links={row.links} /></p> : <p className="ops-muted">No links added yet.</p>}
        {row.minor && <label className="alu-consent"><input type="checkbox" checked={Boolean(row.guardianConsent)} disabled={busy} onChange={() => void save({ guardianConsent: !row.guardianConsent })} /> I agree these links may be shown to other students and parents</label>}
        <DataNote>{row.studentConsent ? `${row.name} has chosen to share them.` : `${row.name} has not chosen to share them, so they stay private whatever you choose.`}</DataNote>
      </>}
      <ErrorNote error={error} />
    </SectionCard>
  );
}

export function ProfileLinksView() {
  const state = useLoad(() => alumniApi.myStudentLinks(), []);
  return (
    <div className="ops-stack">
      <DataNote>LinkedIn, Instagram, GitHub and a personal site, as https links. Other students and parents never see them unless the student agrees and, for anyone under 18, a guardian agrees too.</DataNote>
      <Loadable state={state}>{(rows) => !rows.length ? <EmptyState title="No student profile here" sub="Profile links belong to a student's own profile." /> : (
        <>{rows.map((r) => <StudentLinksCard key={r.studentId} row={r} onSaved={(out) => state.setData(rows.map((x) => (x.studentId === out.studentId ? out : x)))} />)}</>
      )}</Loadable>
    </div>
  );
}

// ── Social publishing ────────────────────────────────────────────────

const outboxTone = (r: OutboxRow) => (r.status === 'SIMULATED' ? 'SIMULATED' : r.status === 'SENT' ? 'DONE' : r.status === 'FAILED' ? 'FAILED' : r.status === 'SENDING' ? 'IN_PROGRESS' : 'PENDING');

function Composer({ onSaved }: { onSaved: () => void }) {
  const stories = useLoad(() => socialApi.stories(), []);
  const [f, setF] = useState({ storyId: '', text: '', link: '', none: false, networks: [] as Network[] });
  const { run, busy, error } = useAction();
  const toast = useToast();
  const story = (stories.data ?? []).find((s) => s.id === f.storyId);
  const flip = (n: Network) => setF({ ...f, networks: f.networks.includes(n) ? f.networks.filter((x) => x !== n) : [...f.networks, n] });
  return (
    <SectionCard title="Compose" sub="Share a public newsroom story, or write a post with no identifiable child. Every child tagged in a story needs public-media consent, checked now and again when you publish.">
      <div className="ops-form-grid">
        <Field label="Newsroom story (optional)">
          <select className="input" value={f.storyId} onChange={(e) => setF({ ...f, storyId: e.target.value })}>
            <option value="">None — write a post</option>
            {(stories.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.title ?? s.excerpt.slice(0, 50)}{s.taggedStudents ? ` · ${s.taggedStudents} child(ren) tagged` : ''}</option>)}
          </select>
        </Field>
        <Field label="Link (optional)" hint="https://…"><input className="input" inputMode="url" value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} /></Field>
      </div>
      <Field label="Text" required={!f.storyId} hint={story ? 'Leave empty to use the story\'s title and text' : undefined}><textarea className="input" rows={3} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} style={{ width: '100%' }} /></Field>
      <fieldset className="soc-networks"><legend>Networks</legend>
        {NETWORKS.map((n) => <label key={n} className="ops-chip"><input type="checkbox" checked={f.networks.includes(n)} onChange={() => flip(n)} /> {NETWORK_LABELS[n]}</label>)}
      </fieldset>
      {!story?.taggedStudents && <label className="alu-consent"><input type="checkbox" checked={f.none} onChange={() => setF({ ...f, none: !f.none })} /> No child can be identified in this post</label>}
      <ErrorNote error={error} />
      <Button disabled={busy || !f.networks.length || (!f.text.trim() && !f.storyId)} onClick={() => void run(async () => {
        await socialApi.compose({ communityPostId: f.storyId || undefined, text: f.text || undefined, link: f.link || undefined, networks: f.networks, noIdentifiableStudents: f.none });
        toast('Saved to the outbox', 'success'); setF({ storyId: '', text: '', link: '', none: false, networks: [] }); onSaved();
      })}>Save to outbox</Button>
    </SectionCard>
  );
}

function OutboxCard({ p, onChanged }: { p: SocialPostDto; onChanged: (p: SocialPostDto) => void }) {
  const { run, busy, error } = useAction();
  const pending = p.outbox.some((r) => r.status === 'QUEUED' || r.status === 'FAILED');
  return (
    <li className="ops-row soc-post">
      <div className="ops-row-main">
        <div className="ops-row-title">{p.text.length > 120 ? `${p.text.slice(0, 119)}…` : p.text}</div>
        <div className="ops-row-sub">{p.createdByName ?? '—'} · {fmtDateTime(p.createdAt)}{p.studentIds.length ? ` · ${p.studentIds.length} child(ren) tagged` : ' · no identifiable child'}{p.blockedReason ? ` · ${p.blockedReason}` : ''}</div>
        <ul className="soc-outbox" aria-label="Outbox">{p.outbox.map((r) => (
          <li key={r.network}><b>{r.label}</b> <StatusPill status={outboxTone(r)} label={r.display} />{r.statusReason && r.status !== 'SIMULATED' ? <span className="ops-muted"> {r.statusReason}</span> : null}</li>
        ))}</ul>
        <ErrorNote error={error} />
      </div>
      {pending && <Button small disabled={busy} onClick={() => void run(async () => onChanged(await socialApi.publish(p.id)))}>{p.outbox.some((r) => r.status === 'FAILED') ? 'Retry failed' : 'Publish'}</Button>}
    </li>
  );
}

function Accounts({ canConnect }: { canConnect: boolean }) {
  const state = useLoad(() => socialApi.accounts(), []);
  const [f, setF] = useState<{ network: Network; handle: string }>({ network: 'FACEBOOK', handle: '' });
  const { run, busy, error } = useAction();
  return (
    <SectionCard title="School accounts" sub="Connecting needs each network's official sign-in with provider credentials. Until then an account is recorded as pending and posts are simulated.">
      <Loadable state={state}>{(d) => (
        <>
          {!d.accounts.length ? <p className="ops-muted">No accounts recorded.</p> : (
            <ul className="ops-list">{d.accounts.map((a) => (
              <li key={a.id} className="ops-row">
                <div className="ops-row-main"><div className="ops-row-title">{a.label} · @{a.handle}</div><div className="ops-row-sub">{a.statusNote}</div></div>
                <StatusPill status={a.status === 'CONNECTION_PENDING' ? 'PENDING' : 'CANCELLED'} label={a.status === 'CONNECTION_PENDING' ? 'Connection pending' : 'Disconnected'} />
                {canConnect && a.status !== 'DISCONNECTED' && <Button small variant="ghost" disabled={busy} onClick={() => void run(async () => { await socialApi.disconnect(a.id); await state.reload(); })}>Disconnect</Button>}
              </li>
            ))}</ul>
          )}
          <KeyValues rows={d.networks.map((n) => [n.label, `Provider credentials ${n.credentials}`])} />
        </>
      )}</Loadable>
      {canConnect && (
        <div className="ops-form-grid">
          <Field label="Network"><select className="input" value={f.network} onChange={(e) => setF({ ...f, network: e.target.value as Network })}>{NETWORKS.map((n) => <option key={n} value={n}>{NETWORK_LABELS[n]}</option>)}</select></Field>
          <Field label="Account handle"><input className="input" value={f.handle} onChange={(e) => setF({ ...f, handle: e.target.value })} /></Field>
          <div className="soc-connect"><Button disabled={busy || !f.handle.trim()} onClick={() => void run(async () => { await socialApi.connect(f); setF({ ...f, handle: '' }); await state.reload(); })}>Record account</Button></div>
        </div>
      )}
      <ErrorNote error={error} />
    </SectionCard>
  );
}

export function SocialPublishingView() {
  const { permissions } = usePermissions();
  const canPublish = Boolean(permissions['social.publish']);
  const canConnect = Boolean(permissions['social.connect']);
  const [tab, setTab] = useState<'outbox' | 'accounts'>(canPublish ? 'outbox' : 'accounts');
  const posts = useLoad(() => (canPublish ? socialApi.posts() : Promise.resolve([] as SocialPostDto[])), [canPublish]);
  if (isOff(posts.error)) return <EmptyState icon="⏻" title="Social publishing is switched off" sub="An administrator can switch it on in Settings → Features. Nothing is posted until each network is connected with provider credentials." />;
  return (
    <div className="ops-stack">
      <DataNote>No network is connected with provider credentials, so every send is recorded as “Simulated — not posted”. Parents and students cannot publish here.</DataNote>
      <Tabs tabs={[...(canPublish ? [{ key: 'outbox' as const, label: 'Compose and outbox' }] : []), { key: 'accounts' as const, label: 'Accounts' }]} value={tab} onChange={setTab} />
      {tab === 'outbox' && canPublish && <>
        <Composer onSaved={() => void posts.reload()} />
        <SectionCard title="Outbox" sub="One line per network. A network that was sent or simulated is never sent again; only failures can be retried.">
          <Loadable state={posts}>{(rows) => !rows.length ? <p className="ops-muted">Nothing in the outbox.</p> : <ul className="ops-list">{rows.map((p) => <OutboxCard key={p.id} p={p} onChanged={(out) => posts.setData(rows.map((x) => (x.id === out.id ? out : x)))} />)}</ul>}</Loadable>
        </SectionCard>
      </>}
      {tab === 'accounts' && <Accounts canConnect={canConnect} />}
    </div>
  );
}

// ── Digest ───────────────────────────────────────────────────────────

function MyDigest() {
  const state = useLoad(() => digestApi.today(), []);
  return (
    <Loadable state={state}>{(d) => (
      <SectionCard title={`Your digest · ${fmtDate(d.day)}`} sub={d.note}>
        {!d.items.length ? <p className="ops-muted">{d.interests.length ? 'No new headlines for your interests today.' : 'Choose your interests to start your daily digest.'}</p> : (
          <ul className="ops-list">{d.items.map((i) => (
            <li key={i.id} className="ops-row dig-item">
              <div className="ops-row-main">
                <div className="ops-row-title"><SafeLink href={i.link}>{i.title}</SafeLink>{!/^https:\/\//i.test(i.link) && i.title}</div>
                {i.summary && <p className="alu-post-body">{i.summary}</p>}
                <div className="ops-row-sub">{i.sourceTitle ?? 'Approved feed'}{i.publishedAt ? ` · ${fmtDateTime(i.publishedAt)}` : ''}</div>
              </div>
              {i.interestLabel && <span className="ops-chip">{i.interestLabel}</span>}
            </li>
          ))}</ul>
        )}
      </SectionCard>
    )}</Loadable>
  );
}

function Interests() {
  const state = useLoad(() => digestApi.interests(), []);
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <SectionCard title="Your interests" sub="Your digest shows only these. An email copy is sent only if you ask for it.">
      <Loadable state={state}>{(d) => (
        <>
          <div className="dig-interests" role="group" aria-label="Interests">
            {d.interests.map((i) => {
              const on = d.mine.interests.includes(i.key);
              return <label key={i.key} className="ops-chip"><input type="checkbox" checked={on} disabled={busy} onChange={() => void run(async () => { state.setData(await digestApi.setPreferences({ interests: on ? d.mine.interests.filter((x) => x !== i.key) : [...d.mine.interests, i.key] })); })} /> {i.label}</label>;
            })}
          </div>
          <label className="alu-consent"><input type="checkbox" checked={d.mine.emailOptIn} disabled={busy} onChange={() => void run(async () => { state.setData(await digestApi.setPreferences({ emailOptIn: !d.mine.emailOptIn })); toast('Saved', 'success'); })} /> Also email me the daily digest</label>
        </>
      )}</Loadable>
      <ErrorNote error={error} />
    </SectionCard>
  );
}

function Sources() {
  const state = useLoad(() => digestApi.sources(), []);
  const interests = useLoad(() => digestApi.interests(), []);
  const [f, setF] = useState({ title: '', url: '', interests: [] as string[] });
  const { run, busy, error } = useAction();
  const toast = useToast();
  const flip = (k: string) => setF({ ...f, interests: f.interests.includes(k) ? f.interests.filter((x) => x !== k) : [...f.interests, k] });
  return (
    <div className="ops-stack">
      <SectionCard title="Approve a feed" sub="RSS or Atom feeds only, by their https address. Feeds are read once a day; addresses inside a private network are refused, and feed text is shown as plain text.">
        <div className="ops-form-grid">
          <Field label="Name" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Feed address" required hint="https://…/feed.xml"><input className="input" inputMode="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></Field>
        </div>
        <div className="dig-interests" role="group" aria-label="Feed interests">{(interests.data?.interests ?? []).map((i) => <label key={i.key} className="ops-chip"><input type="checkbox" checked={f.interests.includes(i.key)} onChange={() => flip(i.key)} /> {i.label}</label>)}</div>
        <Button disabled={busy || !f.title || !f.url || !f.interests.length} onClick={() => void run(async () => { await digestApi.addSource(f); setF({ title: '', url: '', interests: [] }); toast('Feed approved', 'success'); await state.reload(); })}>Approve feed</Button>
      </SectionCard>
      <SectionCard title="Approved feeds" actions={<Button variant="soft" disabled={busy} onClick={() => void run(async () => { const r = await digestApi.run(); toast(`Read ${r.sources} feed(s), ${r.added} new headline(s), ${r.built} digest(s) built`, 'success'); await state.reload(); })}>Build today&apos;s digests now</Button>}>
        <Loadable state={state}>{(rows: DigestSourceDto[]) => !rows.length ? <p className="ops-muted">No feeds approved yet.</p> : (
          <ul className="ops-list">{rows.map((s) => (
            <li key={s.id} className="ops-row">
              <div className="ops-row-main">
                <div className="ops-row-title">{s.title}</div>
                <div className="ops-row-sub dig-url">{s.url}</div>
                <div className="ops-row-sub">{s.interestLabels.join(', ')} · {s.lastFetchedAt ? `read ${fmtDateTime(s.lastFetchedAt)}` : 'not read yet'}{s.lastStatus === 'OK' ? ` · ${s.lastItemCount} item(s)` : ''}{s.lastError ? ` · ${s.lastError}` : ''}</div>
              </div>
              <StatusPill status={s.status === 'PAUSED' ? 'CANCELLED' : s.lastStatus === 'FAILED' ? 'FAILED' : 'APPROVED'} label={s.status === 'PAUSED' ? 'Paused' : s.lastStatus === 'FAILED' ? 'Could not read' : 'Approved'} />
              <Button small variant="ghost" disabled={busy} onClick={() => void run(async () => { await digestApi.checkSource(s.id); await state.reload(); })}>Read now</Button>
              <Button small variant="ghost" disabled={busy} onClick={() => void run(async () => { await digestApi.updateSource(s.id, { status: s.status === 'PAUSED' ? 'APPROVED' : 'PAUSED' }); await state.reload(); })}>{s.status === 'PAUSED' ? 'Resume' : 'Pause'}</Button>
            </li>
          ))}</ul>
        )}</Loadable>
      </SectionCard>
      <ErrorNote error={error} />
    </div>
  );
}

export function DigestView() {
  const { permissions } = usePermissions();
  const manage = Boolean(permissions['digest.manage']);
  const [tab, setTab] = useState<'today' | 'interests' | 'sources'>('today');
  const probe = useLoad(() => digestApi.interests(), []);
  if (isOff(probe.error)) return <EmptyState icon="⏻" title="The daily digest is switched off" sub="An administrator can switch it on in Settings → Features." />;
  return (
    <div className="ops-stack">
      <Tabs tabs={[{ key: 'today', label: 'My digest' }, { key: 'interests', label: 'Interests' }, ...(manage ? [{ key: 'sources' as const, label: 'Sources' }] : [])]} value={tab} onChange={setTab} />
      {tab === 'today' && <MyDigest />}
      {tab === 'interests' && <Interests />}
      {tab === 'sources' && manage && <Sources />}
    </div>
  );
}

export type { AlumnusMe };
