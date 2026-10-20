'use client';
import { useMemo, useState } from 'react';
import { Button, EmptyState, Field, Modal, useToast } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { usePermissions } from '@/lib/permissions';
import { api } from '@/lib/api';
import { usePortalPage, useSchoolHref } from '@/lib/school-path';
import {
  p4Api, KIND_LABELS, AUDIENCE_LABELS, type Opportunity, type OpportunityKind, type OpportunityAudience, type PlannerDto,
} from '@/lib/p4-student-alumnus-api';
import type { DocumentRequestDto, RequestableDocumentType } from '@/lib/document-request-types';
import { alumniApi } from '@/lib/alumni-social-api';
import { NewsroomView } from './newsroom-view';
import { DataNote, ErrorNote, KeyValues, Loadable, PromptModal, SectionCard, StatusPill, Tabs, Tile, fmtDate, humanize, useAction, useLoad } from './kit';

/**
 * Part 4 (student and alumnus audit):
 *   StudentPlannerView      what is due, exams, a suggested study week from the student's own marks,
 *                           and for Classes 10 and 12 the board-registration details to check
 *   GiveBackView            the alumni "give back" board: offers reviewed by the school, interest routed
 *                           through the alumni coordinator (students never contact an alumnus directly)
 *   AlumniCertificatesView  a former student's certificate requests from their own archived record
 */

const isOff = (error: string | null) => Boolean(error && /switched off/i.test(error));
const daysWord = (n: number) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

// ── Student planner ──────────────────────────────────────────────────

const STAGE: Record<string, string> = {
  PRIMARY: 'Primary: short, playful study blocks', MIDDLE: 'Middle school: steady daily habits',
  SECONDARY: 'Secondary: building toward the board years', SENIOR_SECONDARY: 'Senior secondary: boards and entrance preparation', UNKNOWN: 'Your class',
};

function Planner({ studentId }: { studentId?: string | null }) {
  const link = useSchoolHref();
  const page = usePortalPage();
  // Link a tile only to a page this portal has (a parent has no quizzes page).
  const has = (href: string) => (page(href) ? href : undefined);
  const isStudent = !studentId;
  const state = useLoad(() => p4Api.planner(studentId ? { studentId } : {}), [studentId]);
  return (
    <Loadable state={state}>{(p: PlannerDto) => (
      <div className="ops-stack">
        <div className="kpi-grid">
          <Tile label="Homework due" value={p.due.length} tone={p.due.some((d) => d.daysLeft <= 1) ? 'warn' : 'neutral'} href={has('/assignments')} />
          <Tile label="Overdue" value={p.overdue.length} tone={p.overdue.length ? 'bad' : 'good'} />
          <Tile label="Quizzes to take" value={p.quizzes.length} href={has('/quizzes')} />
          <Tile label={`Exam papers (${p.window.days} days)`} value={p.exams.length} tone={p.exams.some((e) => e.daysLeft <= 7) ? 'warn' : 'neutral'} />
        </div>

        {p.board && (
          <SectionCard title={`${p.board.exam}: check ${isStudent ? 'your' : `${p.student.name.split(' ')[0]}’s`} registration details`} sub={p.board.guidance}>
            <KeyValues rows={p.board.checks.map((c) => [c.label, c.missing ? <span className="p4-missing">Missing — ask for it to be added</span> : c.value ?? '—'])} />
            {p.board.deadlines.length > 0 && (
              <ul className="ops-list">{p.board.deadlines.map((d, i) => <li key={i} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{d.title}</div><div className="ops-row-sub">{fmtDate(d.date)}</div></div></li>)}</ul>
            )}
            <div className="ops-inline"><a className="btn btn-soft btn-sm" href={link(isStudent ? '/student/profile' : '/parent/tickets')}>Ask for a correction</a></div>
          </SectionCard>
        )}

        <SectionCard title="Suggested week" sub={`${STAGE[p.student.stage] ?? ''} · about ${p.plan.dailyMinutes} minutes a day. ${p.plan.note}`}>
          <ol className="p4-week">
            {p.plan.days.map((d) => (
              <li key={d.date} className={d.dayOff ? 'p4-day p4-off' : 'p4-day'}>
                <div className="p4-day-head"><strong>{fmtDate(d.date)}</strong>{d.dayOff && <span className="pill">Day off</span>}<span className="p4-mins">{d.totalMinutes ? `${d.totalMinutes} min` : 'Free'}</span></div>
                {d.blocks.length === 0 ? <div className="ops-row-sub">Nothing pressing. Read something you enjoy.</div> : (
                  <ul>{d.blocks.map((b, i) => <li key={i}><span className="pill">{humanize(b.kind)}</span> <strong>{b.subject ?? '—'}</strong> · {b.minutes} min<div className="ops-row-sub">{b.reason}</div></li>)}</ul>
                )}
              </li>
            ))}
          </ol>
        </SectionCard>

        <SectionCard title="Homework due">
          {p.due.length === 0 && p.overdue.length === 0 ? <p className="ops-row-sub">Nothing due in the next {p.window.days} days.</p> : (
            <ul className="ops-list">
              {p.overdue.map((a) => <li key={a.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{a.title}</div><div className="ops-row-sub">{a.subject ?? '—'} · was due {fmtDate(a.dueAt)}</div></div><StatusPill status="OVERDUE" /></li>)}
              {p.due.map((a) => <li key={a.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{a.title}</div><div className="ops-row-sub">{a.subject ?? '—'}{a.chapter ? ` · ${a.chapter}` : ''} · due {daysWord(a.daysLeft)} ({fmtDate(a.dueAt)})</div></div><StatusPill status={a.status} /></li>)}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Exams coming up">
          {p.exams.length === 0 ? <p className="ops-row-sub">No exam papers in the next {p.window.days} days.</p> : (
            <ul className="ops-list">{p.exams.map((e, i) => <li key={i} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{e.exam} · {e.subject ?? '—'}</div><div className="ops-row-sub">{fmtDate(e.date)} · {daysWord(e.daysLeft)} · {e.maxMarks} marks</div></div></li>)}</ul>
          )}
        </SectionCard>

        <SectionCard title={isStudent ? 'Your subjects, from your own published marks' : `${p.student.name.split(' ')[0]}’s subjects, from published marks`} sub={isStudent ? "Only your results are used. Nobody else's marks are shown or compared." : "Only your child's own results are used. Nobody else's marks are shown or compared."}>
          {p.strengths.length === 0 ? <p className="ops-row-sub">No published marks yet.</p> : (
            <ul className="p4-bars">{p.strengths.map((s) => (
              <li key={s.subject}><span>{s.subject}</span><span className="p4-bar" aria-hidden="true"><span style={{ width: `${s.percentage ?? 0}%` }} /></span><span>{s.percentage ?? '—'}%</span></li>
            ))}</ul>
          )}
        </SectionCard>
      </div>
    )}</Loadable>
  );
}

export function StudentPlannerView() {
  const { me } = useAuth();
  const isParent = me?.profile?.role === 'PARENT';
  const kids = useLoad(() => (isParent ? api.students().then((r) => r.items) : Promise.resolve([])), [isParent]);
  const [child, setChild] = useState<string | null>(null);
  if (!isParent) return <Planner />;
  const list = kids.data ?? [];
  const chosen = child ?? list[0]?.id ?? null;
  return (
    <div className="ops-stack">
      {list.length > 1 && (
        <div className="ops-inline" role="group" aria-label="Choose a child">
          {list.map((k) => <Button key={k.id} small variant={k.id === chosen ? 'accent' : 'soft'} onClick={() => setChild(k.id)}>{k.name}</Button>)}
        </div>
      )}
      {chosen ? <Planner studentId={chosen} /> : <Loadable state={kids}>{() => <EmptyState title="No child linked" sub="Ask the school office to link your child to your account." />}</Loadable>}
    </div>
  );
}

// ── Give back: alumni opportunities ──────────────────────────────────

const KINDS = Object.keys(KIND_LABELS) as OpportunityKind[];
const AUDIENCES = Object.keys(AUDIENCE_LABELS) as OpportunityAudience[];

function OfferForm({ onClose, onSaved }: { onClose: () => void; onSaved: (o: Opportunity) => void }) {
  const [f, setF] = useState({ kind: 'CAREER_TALK' as OpportunityKind, title: '', description: '', organisation: '', location: '', mode: 'ONLINE', applyBy: '', audience: 'SENIOR_STUDENTS' as OpportunityAudience, link: '' });
  const { run, busy, error } = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Offer something to the school" onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || !f.title.trim() || !f.description.trim()} onClick={() => void run(async () => {
        const out = await p4Api.offer({ ...f, applyBy: f.applyBy || undefined, link: f.link.trim() || undefined });
        onSaved(out); onClose();
      })}>{busy ? 'Saving…' : 'Send for review'}</Button>
    </>}>
      <DataNote>The school reviews every offer before anyone sees it. Students never see your contact details or link: anyone interested is introduced by the alumni coordinator.</DataNote>
      <div className="ops-form-grid">
        <Field label="What are you offering" required><select className="input" value={f.kind} onChange={set('kind')}>{KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}</select></Field>
        <Field label="Who is it for" required><select className="input" value={f.audience} onChange={set('audience')}>{AUDIENCES.map((a) => <option key={a} value={a}>{AUDIENCE_LABELS[a]}</option>)}</select></Field>
        <Field label="Title" required><input className="input" value={f.title} maxLength={150} onChange={set('title')} /></Field>
        <Field label="Organisation"><input className="input" value={f.organisation} onChange={set('organisation')} /></Field>
        <Field label="Where"><input className="input" value={f.location} onChange={set('location')} /></Field>
        <Field label="How"><select className="input" value={f.mode} onChange={set('mode')}><option value="ONLINE">Online</option><option value="IN_PERSON">In person</option><option value="HYBRID">Hybrid</option></select></Field>
        <Field label="Apply by"><input className="input" type="date" value={f.applyBy} onChange={set('applyBy')} /></Field>
        <Field label="Link for adults (https)" hint="Shown to alumni and staff only"><input className="input" value={f.link} onChange={set('link')} placeholder="https://…" /></Field>
      </div>
      <Field label="Details" required><textarea className="input" rows={4} value={f.description} maxLength={3000} onChange={set('description')} style={{ width: '100%' }} /></Field>
      <ErrorNote error={error} />
    </Modal>
  );
}

function OfferRow({ o, role, manager, onChanged }: { o: Opportunity; role: string | undefined; manager: boolean; onChanged: () => void }) {
  const toast = useToast();
  const { run, busy, error } = useAction();
  const [ask, setAsk] = useState<null | 'interest' | 'reject'>(null);
  const canInterest = (role === 'STUDENT' || role === 'ALUMNUS') && !o.mine && o.status === 'PUBLISHED';
  return (
    <li className="ops-row p4-offer">
      <div className="ops-row-main">
        <div className="ops-row-title"><span className="pill">{o.kindLabel}</span> {o.title}</div>
        <div className="ops-row-sub">
          {[o.organisation, o.location, humanize(o.mode), o.applyBy ? `apply by ${fmtDate(o.applyBy)}` : null, AUDIENCE_LABELS[o.audience]].filter(Boolean).join(' · ')}
        </div>
        <p className="p4-offer-body">{o.description}</p>
        <div className="ops-row-sub">Offered by {o.postedBy ?? 'the school'}{o.batchLabel ? ` (${o.batchLabel})` : ''}{o.link ? <> · <a href={o.link} target="_blank" rel="noopener noreferrer nofollow">Link</a></> : null}</div>
        {o.interested && <div className="ops-row-sub"><strong>You asked for an introduction.</strong> The alumni coordinator will be in touch.</div>}
        {o.interestCount !== undefined &&<div className="ops-row-sub">{o.interestCount} interested{o.reviewNote ? ` · Note: ${o.reviewNote}` : ''}</div>}
        {manager && o.interests && o.interests.length > 0 && (
          <ul className="p4-interests">{o.interests.map((i, k) => <li key={k}>{i.name ?? '—'} · {humanize(i.roleKey)}{i.className ? ` · ${i.className}` : ''}{i.note ? ` — “${i.note}”` : ''}</li>)}</ul>
        )}
        <ErrorNote error={error} />
      </div>
      <div className="ops-inline">
        {o.status !== 'PUBLISHED' && <StatusPill status={o.status} />}
        {canInterest && !o.interested && <Button small onClick={() => setAsk('interest')}>I&apos;m interested</Button>}
        {canInterest && o.interested && <Button small variant="soft" disabled={busy} onClick={() => void run(async () => { await p4Api.interest(o.id, { withdraw: true }); toast('Interest withdrawn', 'success'); onChanged(); })}>Withdraw interest</Button>}
        {o.mine && ['PENDING_REVIEW', 'PUBLISHED'].includes(o.status) && <Button small variant="soft" disabled={busy} onClick={() => void run(async () => { await p4Api.withdrawOffer(o.id); toast('Offer withdrawn', 'success'); onChanged(); })}>Withdraw</Button>}
        {manager && !o.mine && o.status === 'PENDING_REVIEW' && <>
          <Button small disabled={busy} onClick={() => void run(async () => { await p4Api.reviewOffer(o.id, 'PUBLISH'); toast('Published', 'success'); onChanged(); })}>Publish</Button>
          <Button small variant="soft" onClick={() => setAsk('reject')}>Reject</Button>
        </>}
      </div>
      {ask === 'interest' && <PromptModal title={`Interested in “${o.title}”`} label="A line about why (optional)" required={false} confirmLabel="Send to the alumni coordinator"
        extra={<DataNote>{role === 'STUDENT' ? 'The school’s alumni coordinator gets this and will introduce you. Your details are not shared with the alumnus.' : 'The alumni coordinator will put you in touch.'}</DataNote>}
        onSubmit={async (note) => { await p4Api.interest(o.id, { note: note || undefined }); toast('Sent. The school will be in touch.', 'success'); onChanged(); }} onClose={() => setAsk(null)} />}
      {ask === 'reject' && <PromptModal title="Reject this offer" label="Why (sent to the alumnus)" confirmLabel="Reject" danger
        onSubmit={async (note) => { await p4Api.reviewOffer(o.id, 'REJECT', note); toast('Rejected', 'success'); onChanged(); }} onClose={() => setAsk(null)} />}
    </li>
  );
}

type GiveTab = 'board' | 'mine' | 'review';

export function GiveBackView() {
  const { me } = useAuth();
  const { permissions } = usePermissions();
  const role = me?.profile?.role;
  const manager = Boolean(permissions['alumni.manage']);
  const tabs = useMemo(() => {
    const t: Array<{ key: GiveTab; label: string }> = [{ key: 'board', label: 'Opportunities' }];
    if (role === 'ALUMNUS' || manager) t.push({ key: 'mine', label: role === 'ALUMNUS' ? 'My offers' : 'Posted by me' });
    if (manager) t.push({ key: 'review', label: 'To review' });
    return t;
  }, [role, manager]);
  const [tab, setTab] = useState<GiveTab>('board');
  const [kind, setKind] = useState<OpportunityKind | ''>('');
  const [creating, setCreating] = useState(false);
  const board = useLoad(() => (tab === 'mine' ? p4Api.myOpportunities() : p4Api.opportunities({ kind: kind || undefined, queue: tab === 'review' ? 'review' : undefined })), [tab, kind]);
  if (isOff(board.error)) return <EmptyState icon="⏻" title="Alumni is switched off" sub="An administrator can switch it on in Settings → Features." />;
  return (
    <div className="ops-stack">
      {role === 'STUDENT' && <DataNote>Offers from former students, checked by the school. Say you are interested and the alumni coordinator will introduce you; you never need to share your own contact details.</DataNote>}
      <div className="ops-inline">
        <Tabs tabs={tabs} value={tab} onChange={setTab} />
        {tab === 'board' && <select className="input" aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as OpportunityKind | '')}><option value="">All kinds</option>{KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}</select>}
        {(role === 'ALUMNUS' || manager) && <Button small onClick={() => setCreating(true)}>Offer something</Button>}
      </div>
      <Loadable state={board} empty={null}>{(rows) => rows.length === 0
        ? <EmptyState title={tab === 'review' ? 'Nothing waiting for review' : 'No opportunities yet'} sub={role === 'ALUMNUS' ? 'Offer a career talk, mentoring hours or an internship for the students who come after you.' : 'Offers from alumni appear here once the school has reviewed them.'} />
        : <ul className="ops-list">{rows.map((o) => <OfferRow key={o.id} o={o} role={role} manager={manager} onChanged={board.reload} />)}</ul>}
      </Loadable>
      {creating && <OfferForm onClose={() => setCreating(false)} onSaved={() => { setTab(manager && role !== 'ALUMNUS' ? 'board' : 'mine'); board.reload(); }} />}
    </div>
  );
}

// ── Alumni certificates ──────────────────────────────────────────────

function RequestForm({ types, onClose, onSaved }: { types: RequestableDocumentType[]; onClose: () => void; onSaved: () => void }) {
  const [typeId, setTypeId] = useState(types[0]?.id ?? '');
  const [purpose, setPurpose] = useState('');
  const [requiredBy, setRequiredBy] = useState('');
  const [info, setInfo] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const { run, busy, error } = useAction();
  const t = types.find((x) => x.id === typeId);
  return (
    <Modal title="Request a certificate" onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || !typeId || !purpose.trim()} onClick={() => void run(async () => {
        await p4Api.requestCertificate({ documentTypeId: typeId, purpose, requiredBy: requiredBy || undefined, additionalInformation: info || undefined, fields });
        onSaved(); onClose();
      })}>{busy ? 'Sending…' : 'Send to the school office'}</Button>
    </>}>
      <Field label="Certificate" required><select className="input" value={typeId} onChange={(e) => { setTypeId(e.target.value); setFields({}); }}>{types.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      {t?.instructions && <DataNote>{t.instructions}</DataNote>}
      <Field label="What is it for" required hint="For example: university admission abroad, a job verification, a passport"><input className="input" value={purpose} maxLength={500} onChange={(e) => setPurpose(e.target.value)} /></Field>
      <Field label="Needed by"><input className="input" type="date" value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} /></Field>
      {(t?.fields ?? []).map((f) => (
        <Field key={f.key} label={f.label} required={f.required}>
          {f.kind === 'select' ? <select className="input" value={fields[f.key] ?? ''} onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })}><option value="">Choose…</option>{f.options.map((o) => <option key={o}>{o}</option>)}</select>
            : f.kind === 'textarea' ? <textarea className="input" rows={3} value={fields[f.key] ?? ''} onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })} />
              : <input className="input" type={f.kind === 'date' ? 'date' : f.kind === 'number' ? 'number' : 'text'} value={fields[f.key] ?? ''} onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })} />}
        </Field>
      ))}
      <Field label="Anything else the office should know"><textarea className="input" rows={2} value={info} maxLength={2000} onChange={(e) => setInfo(e.target.value)} /></Field>
      <ErrorNote error={error} />
    </Modal>
  );
}

export function AlumniCertificatesView() {
  const types = useLoad(() => p4Api.certificateTypes(), []);
  const mine = useLoad(() => p4Api.myCertificates(), []);
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const { run, error } = useAction();
  if (isOff(mine.error)) return <EmptyState icon="⏻" title="Alumni is switched off" sub="An administrator can switch it on in Settings → Features." />;
  if (mine.error && /former students/i.test(mine.error)) return <EmptyState title="For former students" sub={mine.error} />;
  return (
    <div className="ops-stack">
      <DataNote>Certificates come from your own school record. The school office checks each request, issues a signed copy here, and you download it. Board documents (a duplicate board marksheet or migration certificate) are issued by the board itself, not the school; for CBSE use its Duplicate Academic Documents service or DigiLocker.</DataNote>
      <div className="ops-inline"><Button disabled={!types.data?.length} onClick={() => setOpen(true)}>Request a certificate</Button></div>
      {types.data && types.data.length === 0 && <p className="ops-row-sub">The school has not set up any certificates to request yet.</p>}
      <ErrorNote error={error} />
      <SectionCard title="My requests">
        <Loadable state={mine}>{(rows: DocumentRequestDto[]) => rows.length === 0 ? <p className="ops-row-sub">No requests yet.</p> : (
          <ul className="ops-list">{rows.map((r) => (
            <li key={r.id} className="ops-row">
              <div className="ops-row-main">
                <div className="ops-row-title">{r.documentTypeName}</div>
                <div className="ops-row-sub">{r.purpose} · asked {fmtDate(r.requestedAt)}{r.requiredBy ? ` · needed by ${fmtDate(r.requiredBy)}` : ''}</div>
                {r.rejectionReason && <div className="ops-row-sub">Not issued: {r.rejectionReason}</div>}
                {r.adminRemarks && <div className="ops-row-sub">Office: {r.adminRemarks}</div>}
              </div>
              <div className="ops-inline">
                <StatusPill status={r.status} />
                {r.document && <Button small onClick={() => void run(async () => { await p4Api.downloadCertificate(r.id, r.document!.fileName); mine.reload(); })}>Download</Button>}
                {r.status === 'PENDING' && <Button small variant="soft" onClick={() => void run(async () => { await p4Api.cancelCertificate(r.id); toast('Request cancelled', 'success'); mine.reload(); })}>Cancel</Button>}
              </div>
            </li>
          ))}</ul>
        )}</Loadable>
      </SectionCard>
      {open && types.data && <RequestForm types={types.data} onClose={() => setOpen(false)} onSaved={() => { toast('Sent to the school office', 'success'); mine.reload(); }} />}
    </div>
  );
}

// ── Alumnus home ─────────────────────────────────────────────────────

const settled = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null);

/**
 * The alumnus's own things at a glance, above the newsroom: the next reunion
 * and their reply, certificate requests, their give-back offers and what the
 * directory shows of them. Each tile opens the page where they act.
 */
export function AlumnusHomeStrip() {
  const data = useLoad(async () => {
    const [me, events, certs, offers] = await Promise.allSettled([alumniApi.me(), alumniApi.events(), p4Api.myCertificates(), p4Api.myOpportunities()]);
    return { me: settled(me), events: settled(events), certs: settled(certs), offers: settled(offers) };
  }, []);
  const d = data.data;
  if (!d || !d.me) return null;
  const next = (d.events ?? []).filter((e) => e.status === 'PLANNED' && new Date(e.startsAt) >= new Date()).sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt))[0];
  const openCerts = (d.certs ?? []).filter((c) => ['PENDING', 'UNDER_REVIEW', 'APPROVED'].includes(c.status)).length;
  const readyCerts = (d.certs ?? []).filter((c) => c.status === 'READY').length;
  const live = (d.offers ?? []).filter((o) => o.status === 'PUBLISHED').length;
  const waiting = (d.offers ?? []).filter((o) => o.status === 'PENDING_REVIEW').length;
  const shown = Object.entries(d.me.consent).filter(([, v]) => v).map(([k]) => k);
  return (
    <div className="ops-stack" style={{ marginBottom: 16 }}>
      <div className="kpi-grid">
        <Tile label="Next reunion" value={next ? `${fmtDate(next.startsAt)} · ${next.rsvp.mine ? humanize(next.rsvp.mine) : 'reply'}` : 'None planned'} href="/alumni" />
        <Tile label="Certificates" value={readyCerts ? `${readyCerts} ready` : openCerts ? `${openCerts} with the office` : 'Request one'} tone={readyCerts ? 'good' : 'neutral'} href="/certificates" />
        <Tile label="My offers" value={live || waiting ? `${live} live · ${waiting} in review` : 'Offer something'} href="/give-back" />
        <Tile label="Directory shows" value={d.me.listed ? (shown.length ? `Name, batch, ${shown.join(', ')}` : 'Name and batch') : 'Not listed'} href="/alumni" />
      </div>
      {next && <DataNote>{next.title} — {next.audience}{next.venue ? ` · ${next.venue}` : ''}. {next.rsvp.yes} coming so far.</DataNote>}
    </div>
  );
}

export function AlumnusHomeView() {
  return (<><AlumnusHomeStrip /><NewsroomView /></>);
}
