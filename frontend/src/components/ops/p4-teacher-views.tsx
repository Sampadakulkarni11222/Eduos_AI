'use client';
import { useMemo, useState } from 'react';
import { Button, Field, Modal, Pill, useToast } from '@/components/ui';
import { request } from '@/lib/api';
import { post, patch, del, qs } from '@/lib/ops-api';
import { useAuth } from '@/lib/auth';
import { DataNote, ErrorNote, Loadable, SectionCard, Tabs, Tile, fmtDate, humanize, isoDay, useAction, useLoad, PromptModal } from './kit';

/**
 * Part 4, teacher audit: the teacher's planning and professional record.
 *
 *   LessonPlansView   the week's lesson plans: plan (or start from a suggestion
 *                     built from the syllabus module), copy to another section,
 *                     mark taught (ticks the syllabus, sets homework); the
 *                     principal reads every plan and leaves feedback.
 *   QuestionBankView  the shared bank per subject and class, and question
 *                     papers built against a blueprint with the checks a head
 *                     of department makes (marks, competency share, spread).
 *   CpdView           CPD hours this year against the CBSE reference of 50;
 *                     HR and the principal see every teacher and verify.
 */

/* ── types (kept here: these screens are their only users) ───────────── */
type Step = { phase: string; minutes: number; activity: string };
type Plan = {
  id: string; subjectOfferingId: string; courseModuleId: string | null; class: string | null; subject: string | null; teacher?: string | null;
  module: { id: string; title: string; topics: Array<{ id: string; title: string; done: boolean }> } | null;
  date: string; periodNo: number | null; durationMinutes: number; title: string; topicIds: string[]; objectives: string[]; learningOutcomes: string | null;
  pedagogies: string[]; materials: string | null; steps: Step[]; plannedMinutes: number; timingWarning: string | null; differentiation: string | null;
  assessment: string | null; competencyCheck: string | null; homework: string | null; status: 'DRAFT' | 'READY' | 'TAUGHT'; reflection: string | null;
  homeworkAssignmentId: string | null; source: string; feedback: Array<{ at: string; by: string | null; note: string }>;
};
type PlanList = { items: Plan[]; totals: { plans: number; taught: number; ready: number; draft: number; pastNotTaught: number; withCompetencyCheck: number }; canReviewAll: boolean };
type Suggestion = { label: string; evidence: string[]; plan: Partial<Plan> & { subjectOfferingId: string } };
type Offering = { id: string; label: string };
type Question = { id: string; chapter: string; type: string; typeLabel: string; marks: number; bloom: string; competencyBased: boolean; difficulty: string; text: string; options: Array<{ text: string; isCorrect?: boolean }>; answer?: string | null; author: string | null; mine?: boolean; timesUsed: number };
type BankScope = { subjectId: string; subject: string; gradeId: string; grade: string; chapters: string[]; questions: number };
type Analysis = { totalMarks: number; questions: number; competencyPct: number; competencyTargetPct: number; higherOrderPct: number; byType: Array<{ key: string; label: string; marks: number; pct: number }>; byBloom: Array<{ key: string; marks: number; pct: number }>; byChapter: Array<{ key: string; marks: number; pct: number }>; warnings: string[]; ok: boolean };
type Paper = { id: string; title: string; subject: string | null; grade: string | null; subjectId: string; gradeId: string; durationMinutes: number; targetMarks: number | null; competencyTargetPct: number; instructions: string | null; status: 'DRAFT' | 'FINAL'; author: string | null; mine: boolean; sections: Array<{ title: string; instructions: string | null; questions: Question[] }>; analysis: Analysis; shortfalls?: string[] };
type CpdEntryT = { id: string; source: 'LOGGED' | 'TRAINING'; title: string; provider: string | null; mode: 'EXTERNAL' | 'IN_HOUSE'; area: string; hours: number; date: string; online?: boolean; verified: boolean; evidenceUrl?: string | null };
type CpdSummary = { total: number; target: number; pct: number; byMode: Record<'EXTERNAL' | 'IN_HOUSE', number>; targets: Record<'EXTERNAL' | 'IN_HOUSE', number>; byArea: Array<{ area: string; label: string; hours: number; target: number }>; unverifiedHours: number; gaps: string[]; met: boolean };
type CpdMine = { year: string; from: string; to: string; entries: CpdEntryT[]; summary: CpdSummary; areas: Record<string, string> };
type CpdOverview = { year: string; rows: Array<{ profileId: string; name: string; role: string | null; total: number; external: number; inHouse: number; unverifiedHours: number; met: boolean; pct: number }>; pendingVerification: Array<CpdEntryT & { name: string | null }>; totals: { staff: number; met: number; under25: number } };

const get = <R,>(path: string, params: Record<string, string | number | boolean | undefined | null> = {}) => request<R>(`${path}${qs(params)}`);

const PHASES = ['ENGAGE', 'EXPLORE', 'EXPLAIN', 'ELABORATE', 'EVALUATE'];
const PEDAGOGIES = ['EXPERIENTIAL', 'INQUIRY', 'ART_INTEGRATED', 'SPORTS_INTEGRATED', 'TOY_BASED', 'STORYTELLING', 'PEER_LEARNING', 'PROJECT', 'DIGITAL', 'FIELD_VISIT'];
const QTYPES: Array<[string, string]> = [['MCQ', 'MCQ'], ['ASSERTION_REASON', 'Assertion-reason'], ['VSA', 'Very short answer'], ['SA', 'Short answer'], ['LA', 'Long answer'], ['CASE_BASED', 'Case-based'], ['SOURCE_BASED', 'Source-based'], ['MAP_DIAGRAM', 'Map / diagram']];
const BLOOMS = ['REMEMBER', 'UNDERSTAND', 'APPLY', 'ANALYSE', 'EVALUATE', 'CREATE'];
const STATUS_TONE: Record<string, 'gray' | 'blue' | 'green'> = { DRAFT: 'gray', READY: 'blue', TAUGHT: 'green' };

function mondayOf(day: string) {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - dow * 86_400_000).toISOString().slice(0, 10);
}
const addDays = (day: string, n: number) => new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

/* ── Lesson plans ───────────────────────────────────────────────────── */

type PlanDraft = {
  id: string | null; subjectOfferingId: string; courseModuleId: string | null; topicIds: string[]; date: string; periodNo: string; durationMinutes: string;
  title: string; objectives: string; pedagogies: string[]; materials: string; steps: Step[]; differentiation: string; assessment: string; competencyCheck: string;
  homework: string; status: 'DRAFT' | 'READY'; source: string;
};
const blankDraft = (offeringId: string, date: string): PlanDraft => ({
  id: null, subjectOfferingId: offeringId, courseModuleId: null, topicIds: [], date, periodNo: '', durationMinutes: '40', title: '', objectives: '', pedagogies: [], materials: '',
  steps: PHASES.map((phase, i) => ({ phase, minutes: [5, 10, 10, 10, 5][i], activity: '' })), differentiation: '', assessment: '', competencyCheck: '', homework: '', status: 'DRAFT', source: 'MANUAL',
});
const draftOf = (p: Partial<Plan> & { subjectOfferingId: string }, date: string, id: string | null = null): PlanDraft => ({
  id, subjectOfferingId: p.subjectOfferingId, courseModuleId: p.courseModuleId ?? null, topicIds: p.topicIds ?? [], date: p.date ?? date,
  periodNo: p.periodNo != null ? String(p.periodNo) : '', durationMinutes: String(p.durationMinutes ?? 40), title: p.title ?? '', objectives: (p.objectives ?? []).join('\n'),
  pedagogies: p.pedagogies ?? [], materials: p.materials ?? '', steps: p.steps?.length ? p.steps : blankDraft('', date).steps, differentiation: p.differentiation ?? '',
  assessment: p.assessment ?? '', competencyCheck: p.competencyCheck ?? '', homework: p.homework ?? '', status: p.status === 'READY' ? 'READY' : 'DRAFT', source: p.source ?? 'MANUAL',
});

function PlanEditor({ initial, offerings, onClose, onSaved }: { initial: PlanDraft; offerings: Offering[]; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<PlanDraft>(initial);
  const [hint, setHint] = useState<{ label: string; evidence: string[] } | null>(null);
  const { run, busy, error } = useAction();
  const toast = useToast();
  const minutes = d.steps.reduce((n, s) => n + (Number(s.minutes) || 0), 0);
  const set = (patchD: Partial<PlanDraft>) => setD({ ...d, ...patchD });
  const setStep = (i: number, s: Partial<Step>) => set({ steps: d.steps.map((x, k) => (k === i ? { ...x, ...s } : x)) });
  const suggest = () => void run(async () => {
    const s = await post<Suggestion>('/teaching/lesson-plans/suggest', { subjectOfferingId: d.subjectOfferingId, date: d.date, durationMinutes: Number(d.durationMinutes) || 40 });
    setD({ ...draftOf(s.plan, d.date, d.id), date: d.date, periodNo: d.periodNo });
    setHint({ label: s.label, evidence: s.evidence });
  });
  const save = () => void run(async () => {
    const body = {
      subjectOfferingId: d.subjectOfferingId, courseModuleId: d.courseModuleId, topicIds: d.topicIds, date: d.date, periodNo: d.periodNo === '' ? null : Number(d.periodNo),
      durationMinutes: Number(d.durationMinutes) || 40, title: d.title, objectives: lines(d.objectives), pedagogies: d.pedagogies, materials: d.materials || null,
      steps: d.steps.filter((s) => s.activity.trim()).map((s) => ({ ...s, minutes: Number(s.minutes) })), differentiation: d.differentiation || null, assessment: d.assessment || null,
      competencyCheck: d.competencyCheck || null, homework: d.homework || null, status: d.status, source: d.source,
    };
    if (d.id) { const { subjectOfferingId: _o, source: _s, ...rest } = body; await patch(`/teaching/lesson-plans/${d.id}`, rest); } else await post('/teaching/lesson-plans', body);
    toast('Lesson plan saved', 'success');
    onSaved();
  });
  return (
    <Modal wide title={d.id ? 'Edit lesson plan' : 'New lesson plan'} onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || !d.title.trim() || !d.subjectOfferingId} onClick={save}>{busy ? 'Saving…' : 'Save plan'}</Button>
    </>}>
      <div className="ops-form-grid">
        <Field label="Class and subject" required>
          <select className="input" value={d.subjectOfferingId} disabled={Boolean(d.id)} onChange={(e) => set({ subjectOfferingId: e.target.value, courseModuleId: null, topicIds: [] })}>
            {offerings.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </Field>
        <Field label="Date" required><input className="input" type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} /></Field>
        <Field label="Period"><input className="input" type="number" min={0} max={15} value={d.periodNo} onChange={(e) => set({ periodNo: e.target.value })} /></Field>
        <Field label="Minutes"><input className="input" type="number" min={10} max={240} value={d.durationMinutes} onChange={(e) => set({ durationMinutes: e.target.value })} /></Field>
      </div>
      {!d.id && (
        <div className="ops-inline" style={{ marginBottom: 10 }}>
          <Button variant="soft" small disabled={busy || !d.subjectOfferingId} onClick={suggest}>✦ Suggest from my syllabus plan</Button>
          <span className="ops-muted" style={{ fontSize: 12 }}>A starting point from the module&apos;s next topics and the question bank; you edit it before saving.</span>
        </div>
      )}
      {hint && <div className="ops-callout" style={{ marginBottom: 12 }}><strong>{hint.label}</strong><ul style={{ margin: '6px 0 0 18px' }}>{hint.evidence.map((e) => <li key={e}>{e}</li>)}</ul></div>}
      <Field label="Title" required><input className="input" value={d.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Fractions: comparing unlike fractions" /></Field>
      <Field label="Learning objectives" hint="One per line: students will be able to…"><textarea className="input" rows={3} value={d.objectives} onChange={(e) => set({ objectives: e.target.value })} /></Field>
      <fieldset style={{ border: 'none', padding: 0, margin: '0 0 12px' }}>
        <legend className="field-label">Pedagogy (NEP 2020)</legend>
        <div className="ops-inline">
          {PEDAGOGIES.map((p) => (
            <label key={p} className="ops-chip"><input type="checkbox" checked={d.pedagogies.includes(p)} onChange={(e) => set({ pedagogies: e.target.checked ? [...d.pedagogies, p] : d.pedagogies.filter((x) => x !== p) })} /> {humanize(p)}</label>
          ))}
        </div>
      </fieldset>
      <div className="field-label">Lesson flow (5E) · {minutes} of {d.durationMinutes || 40} minutes{minutes !== Number(d.durationMinutes || 40) && <span style={{ color: 'var(--amber)' }}> · steps and lesson length differ</span>}</div>
      <div className="p4t-steps">
        {d.steps.map((s, i) => (
          <div key={i} className="p4t-step">
            <select className="input" aria-label={`Step ${i + 1} phase`} value={s.phase} onChange={(e) => setStep(i, { phase: e.target.value })}>{PHASES.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}</select>
            <input className="input" aria-label={`Step ${i + 1} minutes`} type="number" min={1} max={120} value={s.minutes} onChange={(e) => setStep(i, { minutes: Number(e.target.value) })} />
            <input className="input" aria-label={`Step ${i + 1} activity`} value={s.activity} onChange={(e) => setStep(i, { activity: e.target.value })} placeholder="What happens" />
            <Button variant="ghost" small aria-label={`Remove step ${i + 1}`} onClick={() => set({ steps: d.steps.filter((_, k) => k !== i) })}>✕</Button>
          </div>
        ))}
        {d.steps.length < 8 && <Button variant="soft" small onClick={() => set({ steps: [...d.steps, { phase: 'ELABORATE', minutes: 5, activity: '' }] })}>+ Step</Button>}
      </div>
      <div className="ops-grid-2" style={{ marginTop: 12 }}>
        <Field label="Teaching aids (TLM)"><textarea className="input" rows={2} value={d.materials} onChange={(e) => set({ materials: e.target.value })} /></Field>
        <Field label="Differentiation" hint="Support and stretch"><textarea className="input" rows={2} value={d.differentiation} onChange={(e) => set({ differentiation: e.target.value })} /></Field>
        <Field label="Competency-based check" hint="A case or real-life question that asks students to apply, not recall"><textarea className="input" rows={2} value={d.competencyCheck} onChange={(e) => set({ competencyCheck: e.target.value })} /></Field>
        <Field label="Assessment / exit ticket"><textarea className="input" rows={2} value={d.assessment} onChange={(e) => set({ assessment: e.target.value })} /></Field>
        <Field label="Homework" hint="Can be set as an assignment when you mark the lesson taught"><textarea className="input" rows={2} value={d.homework} onChange={(e) => set({ homework: e.target.value })} /></Field>
        <Field label="Status">
          <select className="input" value={d.status} onChange={(e) => set({ status: e.target.value as 'DRAFT' | 'READY' })}><option value="DRAFT">Draft</option><option value="READY">Ready to teach</option></select>
        </Field>
      </div>
      <ErrorNote error={error} />
    </Modal>
  );
}

function TaughtModal({ plan, onClose, onDone }: { plan: Plan; onClose: () => void; onDone: () => void }) {
  const [reflection, setReflection] = useState('');
  const [setHw, setSetHw] = useState(Boolean(plan.homework));
  const [due, setDue] = useState(addDays(isoDay(), 2));
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <Modal title={`Taught: ${plan.title}`} onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy} onClick={() => void run(async () => {
        const r = await post<Plan & { syllabusRecorded: boolean; assignmentId: string | null }>(`/teaching/lesson-plans/${plan.id}/taught`, { reflection, ...(setHw && plan.homework && { setHomework: { dueAt: due } }) });
        toast(`Marked taught${r.syllabusRecorded ? '; syllabus updated' : ''}${r.assignmentId ? '; homework set' : ''}`, 'success');
        onDone();
      })}>{busy ? 'Saving…' : 'Mark taught'}</Button>
    </>}>
      {plan.module && plan.topicIds.length > 0 && <DataNote>Ticks {plan.topicIds.length} topic(s) of “{plan.module.title}” in the syllabus tracker.</DataNote>}
      <Field label="Reflection" hint="What worked, what to revisit tomorrow"><textarea className="input" rows={3} value={reflection} onChange={(e) => setReflection(e.target.value)} /></Field>
      {plan.homework && (
        <div className="ops-inline">
          <label className="ops-inline"><input type="checkbox" checked={setHw} onChange={(e) => setSetHw(e.target.checked)} /> Set the homework as an assignment, due</label>
          <input className="input" type="date" aria-label="Homework due date" value={due} min={isoDay()} disabled={!setHw} onChange={(e) => setDue(e.target.value)} style={{ maxWidth: 170 }} />
        </div>
      )}
      <ErrorNote error={error} />
    </Modal>
  );
}

function PlanDetail({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  return (
    <Modal wide title={plan.title} onClose={onClose} footer={<><Button variant="soft" onClick={() => window.print()}>Print</Button><Button onClick={onClose}>Close</Button></>}>
      <p className="ops-muted">{plan.class} · {plan.subject} · {weekday(plan.date)}{plan.periodNo != null ? ` · period ${plan.periodNo}` : ''} · {plan.durationMinutes} min{plan.teacher ? ` · ${plan.teacher}` : ''}</p>
      {plan.module && <p><strong>Module:</strong> {plan.module.title}{plan.topicIds.length ? ` — ${plan.module.topics.filter((t) => plan.topicIds.includes(t.id)).map((t) => t.title).join(', ')}` : ''}</p>}
      {plan.objectives.length > 0 && <><h4>Objectives</h4><ul>{plan.objectives.map((o) => <li key={o}>{o}</li>)}</ul></>}
      {plan.pedagogies.length > 0 && <p className="ops-inline">{plan.pedagogies.map((p) => <span key={p} className="ops-chip">{humanize(p)}</span>)}</p>}
      {plan.steps.length > 0 && (
        <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Phase</th><th>Min</th><th>Activity</th></tr></thead>
          <tbody>{plan.steps.map((s, i) => <tr key={i}><td>{humanize(s.phase)}</td><td>{s.minutes}</td><td>{s.activity}</td></tr>)}</tbody></table></div>
      )}
      {plan.timingWarning && <p style={{ color: 'var(--amber)' }}>{plan.timingWarning}</p>}
      {([['Teaching aids', plan.materials], ['Differentiation', plan.differentiation], ['Competency-based check', plan.competencyCheck], ['Assessment', plan.assessment], ['Homework', plan.homework], ['Reflection', plan.reflection]] as Array<[string, string | null]>).filter(([, v]) => v).map(([k, v]) => <p key={k}><strong>{k}:</strong> {v}</p>)}
      {plan.feedback.length > 0 && <><h4>Feedback</h4>{plan.feedback.map((f, i) => <div key={i} className="ops-callout" style={{ marginBottom: 6 }}>{f.note}<div className="ops-row-sub">{f.by} · {fmtDate(f.at)}</div></div>)}</>}
    </Modal>
  );
}

export function LessonPlansView() {
  const [week, setWeek] = useState(mondayOf(isoDay()));
  const [offeringFilter, setOfferingFilter] = useState('');
  const offerings = useLoad(() => get<Offering[]>('/syllabus/offerings'), []);
  const plans = useLoad(() => get<PlanList>('/teaching/lesson-plans', { from: week, to: addDays(week, 6), subjectOfferingId: offeringFilter || undefined }), [week, offeringFilter]);
  const [editing, setEditing] = useState<PlanDraft | null>(null);
  const [taught, setTaught] = useState<Plan | null>(null);
  const [viewing, setViewing] = useState<Plan | null>(null);
  const [copying, setCopying] = useState<Plan | null>(null);
  const [feedbackFor, setFeedbackFor] = useState<Plan | null>(null);
  const { run, busy, error } = useAction();
  const toast = useToast();
  const opts = offerings.data ?? [];
  const byDay = useMemo(() => {
    const m = new Map<string, Plan[]>();
    for (let i = 0; i < 7; i++) m.set(addDays(week, i), []);
    for (const p of plans.data?.items ?? []) m.get(p.date)?.push(p);
    return [...m.entries()].filter(([day, list]) => list.length || new Date(`${day}T00:00:00Z`).getUTCDay() !== 0);
  }, [plans.data, week]);
  const open = (id: string) => void run(async () => setViewing(await get<Plan>(`/teaching/lesson-plans/${id}`)));
  const edit = (id: string) => void run(async () => { const p = await get<Plan>(`/teaching/lesson-plans/${id}`); setEditing(draftOf(p, p.date, p.id)); });
  const done = () => { setEditing(null); setTaught(null); setCopying(null); void plans.reload(); };
  const reviewer = plans.data?.canReviewAll;

  return (
    <div className="ops-stack">
      <SectionCard title={`Week of ${fmtDate(week)}`} sub="Plan each lesson, then mark it taught: the syllabus tracker and homework follow from it." actions={
        <div className="ops-inline">
          <Button variant="soft" small onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week">‹</Button>
          <Button variant="soft" small onClick={() => setWeek(mondayOf(isoDay()))}>This week</Button>
          <Button variant="soft" small onClick={() => setWeek(addDays(week, 7))} aria-label="Next week">›</Button>
          <select className="input" aria-label="Class and subject" value={offeringFilter} onChange={(e) => setOfferingFilter(e.target.value)} style={{ maxWidth: 220 }}>
            <option value="">All my classes</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          {opts.length > 0 && <Button small onClick={() => setEditing(blankDraft(offeringFilter || opts[0].id, isoDay() < week ? week : isoDay()))}>+ New plan</Button>}
        </div>
      }>
        <Loadable state={plans}>{(data) => (
          <>
            <div className="card-grid p4t-tiles">
              <Tile label="Plans this week" value={data.totals.plans} />
              <Tile label="Taught" value={data.totals.taught} tone="good" />
              <Tile label="Ready" value={data.totals.ready} />
              <Tile label="Past, not marked taught" value={data.totals.pastNotTaught} tone={data.totals.pastNotTaught ? 'warn' : 'neutral'} />
              <Tile label="With a competency check" value={`${data.totals.withCompetencyCheck}/${data.totals.plans}`} />
            </div>
            {!opts.length && !reviewer && <p className="ops-muted">You have no classes assigned yet, so there is nothing to plan.</p>}
            {byDay.map(([day, list]) => (
              <div key={day} className="p4t-day">
                <div className="p4t-day-head">{weekday(day)}{day === isoDay() && <Pill tone="blue">Today</Pill>}</div>
                {!list.length ? <p className="ops-muted" style={{ margin: '4px 0 10px' }}>No plans.</p> : (
                  <ul className="ops-list">
                    {list.map((p) => (
                      <li key={p.id} className="ops-row">
                        <div className="ops-row-main">
                          <button type="button" className="ops-row-link" onClick={() => open(p.id)}>
                            <div className="ops-row-title">{p.periodNo != null ? `P${p.periodNo} · ` : ''}{p.title}</div>
                            <div className="ops-row-sub">{p.class} · {p.subject}{reviewer && p.teacher ? ` · ${p.teacher}` : ''}{p.feedback.length ? ` · ${p.feedback.length} feedback note${p.feedback.length === 1 ? '' : 's'}` : ''}{p.timingWarning ? ' · timing differs' : ''}</div>
                          </button>
                        </div>
                        <Pill tone={STATUS_TONE[p.status]}>{humanize(p.status)}</Pill>
                        <div className="ops-inline">
                          {p.status !== 'TAUGHT' && !reviewer && <Button small variant="soft" disabled={busy} onClick={() => edit(p.id)}>Edit</Button>}
                          {p.status !== 'TAUGHT' && !reviewer && p.date <= isoDay() && <Button small disabled={busy} onClick={() => setTaught(p)}>Mark taught</Button>}
                          {!reviewer && <Button small variant="ghost" disabled={busy} onClick={() => setCopying(p)}>Copy</Button>}
                          {p.status !== 'TAUGHT' && !reviewer && <Button small variant="ghost" disabled={busy} onClick={() => { if (window.confirm('Remove this plan?')) void run(async () => { await del(`/teaching/lesson-plans/${p.id}`); toast('Plan removed', 'success'); await plans.reload(); }); }}>Remove</Button>}
                          {reviewer && <Button small variant="soft" onClick={() => setFeedbackFor(p)}>Feedback</Button>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            <DataNote>“Past, not marked taught” counts plans dated before today that are still draft or ready: a prompt to close the loop, not a measure of teaching.</DataNote>
          </>
        )}</Loadable>
        <ErrorNote error={error} />
      </SectionCard>
      {editing && <PlanEditor initial={editing} offerings={opts} onClose={() => setEditing(null)} onSaved={done} />}
      {taught && <TaughtModal plan={taught} onClose={() => setTaught(null)} onDone={done} />}
      {viewing && <PlanDetail plan={viewing} onClose={() => setViewing(null)} />}
      {copying && <CopyModal plan={copying} offerings={opts} onClose={() => setCopying(null)} onDone={done} />}
      {feedbackFor && <PromptModal title={`Feedback on “${feedbackFor.title}”`} label="Note for the teacher" hint="It is added to the plan; it never changes the plan or its status." confirmLabel="Add feedback"
        onSubmit={async (note) => { await post(`/teaching/lesson-plans/${feedbackFor.id}/feedback`, { note }); toast('Feedback added', 'success'); await plans.reload(); }} onClose={() => setFeedbackFor(null)} />}
    </div>
  );
}

function CopyModal({ plan, offerings, onClose, onDone }: { plan: Plan; offerings: Offering[]; onClose: () => void; onDone: () => void }) {
  const subject = plan.subject ?? '';
  const targets = offerings.filter((o) => o.id !== plan.subjectOfferingId && o.label.split('·').pop()?.trim() === subject);
  const [target, setTarget] = useState(targets[0]?.id ?? '');
  const [date, setDate] = useState(plan.date);
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <Modal title={`Copy “${plan.title}”`} onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || !target} onClick={() => void run(async () => { await post(`/teaching/lesson-plans/${plan.id}/copy`, { subjectOfferingId: target, date }); toast('Copied as a draft', 'success'); onDone(); })}>Copy</Button>
    </>}>
      {!targets.length ? <p className="ops-muted">You teach {subject} in no other class.</p> : (
        <>
          <Field label="To class"><select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>{targets.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></Field>
          <Field label="Date"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <DataNote>The copy is a draft. Topics are matched to the other class&apos;s module of the same name, if it has one.</DataNote>
        </>
      )}
      <ErrorNote error={error} />
    </Modal>
  );
}

/* ── Question bank and papers ───────────────────────────────────────── */

function QuestionForm({ scope, onClose, onSaved }: { scope: BankScope; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ chapter: scope.chapters[0] ?? '', type: 'MCQ', marks: '1', bloom: 'UNDERSTAND', difficulty: 'MEDIUM', text: '', options: ['', '', '', ''], correct: 0, answer: '' });
  const { run, busy, error } = useAction();
  const toast = useToast();
  const choice = f.type === 'MCQ' || f.type === 'ASSERTION_REASON';
  return (
    <Modal wide title={`Add a question · ${scope.subject} ${scope.grade}`} onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || !f.text.trim() || !f.chapter.trim()} onClick={() => void run(async () => {
        await post('/teaching/question-bank', {
          subjectId: scope.subjectId, gradeId: scope.gradeId, chapter: f.chapter, type: f.type, marks: Number(f.marks), bloom: f.bloom, difficulty: f.difficulty, text: f.text,
          options: choice ? f.options.map((t, i) => ({ text: t, isCorrect: i === f.correct })).filter((o) => o.text.trim()) : [], answer: f.answer || null,
        });
        toast('Question added to the bank', 'success');
        onSaved();
      })}>Add</Button>
    </>}>
      <div className="ops-form-grid">
        <Field label="Chapter" required><input className="input" list="p4t-chapters" value={f.chapter} onChange={(e) => setF({ ...f, chapter: e.target.value })} /></Field>
        <datalist id="p4t-chapters">{scope.chapters.map((c) => <option key={c} value={c} />)}</datalist>
        <Field label="Type"><select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{QTYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Marks"><input className="input" type="number" min={0.5} max={20} step={0.5} value={f.marks} onChange={(e) => setF({ ...f, marks: e.target.value })} /></Field>
        <Field label="Cognitive level"><select className="input" value={f.bloom} onChange={(e) => setF({ ...f, bloom: e.target.value })}>{BLOOMS.map((b) => <option key={b} value={b}>{humanize(b)}</option>)}</select></Field>
        <Field label="Difficulty"><select className="input" value={f.difficulty} onChange={(e) => setF({ ...f, difficulty: e.target.value })}>{['EASY', 'MEDIUM', 'HARD'].map((b) => <option key={b} value={b}>{humanize(b)}</option>)}</select></Field>
      </div>
      <Field label="Question" required><textarea className="input" rows={3} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></Field>
      {choice && (
        <fieldset style={{ border: 'none', padding: 0, margin: '0 0 12px' }}>
          <legend className="field-label">Options (choose the correct one)</legend>
          {f.options.map((o, i) => (
            <div key={i} className="ops-inline" style={{ marginBottom: 6 }}>
              <input type="radio" name="p4t-correct" aria-label={`Option ${i + 1} is correct`} checked={f.correct === i} onChange={() => setF({ ...f, correct: i })} />
              <input className="input" aria-label={`Option ${i + 1}`} value={o} onChange={(e) => setF({ ...f, options: f.options.map((x, k) => (k === i ? e.target.value : x)) })} style={{ flex: 1 }} />
            </div>
          ))}
        </fieldset>
      )}
      <Field label="Answer / marking scheme"><textarea className="input" rows={2} value={f.answer} onChange={(e) => setF({ ...f, answer: e.target.value })} /></Field>
      <DataNote>Case-based, source-based and assertion-reason questions, and those asking students to apply or analyse, are marked competency-based.</DataNote>
      <ErrorNote error={error} />
    </Modal>
  );
}

function BuildPaperModal({ scope, onClose, onBuilt }: { scope: BankScope; onClose: () => void; onBuilt: (p: Paper) => void }) {
  const [title, setTitle] = useState(`${scope.subject} ${scope.grade}: Periodic Test`);
  const [target, setTarget] = useState('40');
  const [duration, setDuration] = useState('90');
  const [comp, setComp] = useState('50');
  const [chapters, setChapters] = useState<string[]>([]);
  const [rows, setRows] = useState([{ type: 'MCQ', count: '10', marks: '1' }, { type: 'SA', count: '4', marks: '3' }, { type: 'CASE_BASED', count: '2', marks: '4' }, { type: 'LA', count: '1', marks: '5' }]);
  const { run, busy, error } = useAction();
  const planned = rows.reduce((n, r) => n + (Number(r.count) || 0) * (Number(r.marks) || 0), 0);
  return (
    <Modal wide title="Build a paper from the bank" onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy} onClick={() => void run(async () => {
        const p = await post<Paper>('/teaching/papers/build', { subjectId: scope.subjectId, gradeId: scope.gradeId, title, targetMarks: Number(target) || null, durationMinutes: Number(duration) || 90, competencyTargetPct: Number(comp), chapters, blueprint: rows.map((r) => ({ type: r.type, count: Number(r.count), ...(r.marks && { marks: Number(r.marks) }) })) });
        onBuilt(p);
      })}>{busy ? 'Building…' : 'Build draft'}</Button>
    </>}>
      <div className="ops-form-grid">
        <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Total marks"><input className="input" type="number" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
        <Field label="Minutes"><input className="input" type="number" value={duration} onChange={(e) => setDuration(e.target.value)} /></Field>
        <Field label="Competency-based at least (%)" hint="CBSE asks for about half"><input className="input" type="number" min={0} max={100} value={comp} onChange={(e) => setComp(e.target.value)} /></Field>
      </div>
      <div className="field-label">Blueprint · {planned} marks planned</div>
      {rows.map((r, i) => (
        <div key={i} className="p4t-step">
          <select className="input" aria-label={`Section ${i + 1} type`} value={r.type} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, type: e.target.value } : x)))}>{QTYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input className="input" aria-label={`Section ${i + 1} how many`} type="number" min={1} max={40} value={r.count} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, count: e.target.value } : x)))} />
          <input className="input" aria-label={`Section ${i + 1} marks each`} type="number" min={0.5} max={20} step={0.5} value={r.marks} placeholder="any" onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, marks: e.target.value } : x)))} />
          <Button variant="ghost" small aria-label={`Remove section ${i + 1}`} onClick={() => setRows(rows.filter((_, k) => k !== i))}>✕</Button>
        </div>
      ))}
      {rows.length < 8 && <Button variant="soft" small onClick={() => setRows([...rows, { type: 'VSA', count: '2', marks: '2' }])}>+ Section</Button>}
      {scope.chapters.length > 0 && (
        <fieldset style={{ border: 'none', padding: 0, margin: '12px 0' }}>
          <legend className="field-label">Chapters (none ticked = all)</legend>
          <div className="ops-inline">{scope.chapters.map((c) => <label key={c} className="ops-chip"><input type="checkbox" checked={chapters.includes(c)} onChange={(e) => setChapters(e.target.checked ? [...chapters, c] : chapters.filter((x) => x !== c))} /> {c}</label>)}</div>
        </fieldset>
      )}
      <DataNote>The builder prefers questions used least, spreads chapters and leans to competency-based ones until the target is met. It never pads a section it cannot fill: it tells you instead.</DataNote>
      <ErrorNote error={error} />
    </Modal>
  );
}

function AnalysisPanel({ a }: { a: Analysis }) {
  return (
    <div>
      <div className="card-grid p4t-tiles">
        <Tile label="Total marks" value={a.totalMarks} />
        <Tile label="Questions" value={a.questions} />
        <Tile label="Competency-based" value={`${a.competencyPct}%`} tone={a.competencyPct >= a.competencyTargetPct ? 'good' : 'warn'} />
        <Tile label="Higher-order (analyse+)" value={`${a.higherOrderPct}%`} />
      </div>
      <div className="ops-grid-2">
        {([['By type', a.byType.map((t) => ({ key: t.label, pct: t.pct, marks: t.marks }))], ['By chapter', a.byChapter], ['By cognitive level', a.byBloom.map((b) => ({ ...b, key: humanize(b.key) }))]] as Array<[string, Array<{ key: string; pct: number; marks: number }>]>).map(([title, rows]) => (
          <div key={title}>
            <div className="field-label">{title}</div>
            {rows.map((r) => <div key={r.key} className="p4t-bar-row"><span>{r.key}</span><div className="ops-bar"><span style={{ width: `${r.pct}%` }} /></div><span>{r.marks} m</span></div>)}
          </div>
        ))}
      </div>
      {a.warnings.length > 0 ? <div className="ops-callout is-warn" style={{ marginTop: 10 }}><strong>Check before printing</strong><ul style={{ margin: '6px 0 0 18px' }}>{a.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div> : <p className="ops-muted">No warnings.</p>}
    </div>
  );
}

function printPaper(p: Paper, withAnswers: boolean) {
  const w = window.open('', '_blank', 'noopener=no');
  if (!w) return;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  let n = 0;
  const body = p.sections.map((s) => `<h3>${esc(s.title)}</h3>${s.questions.map((q) => {
    n += 1;
    const opts = q.options.length ? `<ol type="a">${q.options.map((o) => `<li>${esc(o.text)}${withAnswers && o.isCorrect ? ' ✔' : ''}</li>`).join('')}</ol>` : '';
    return `<div class="q"><span class="m">[${q.marks}]</span><b>${n}.</b> ${esc(q.text)}${opts}${withAnswers && q.answer ? `<p class="a">Answer: ${esc(q.answer)}</p>` : ''}</div>`;
  }).join('')}`).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.title)}</title><style>body{font:14px/1.5 Georgia,serif;max-width:760px;margin:24px auto;padding:0 16px}h1{font-size:20px;text-align:center}.meta{text-align:center;color:#444}.q{margin:10px 0;break-inside:avoid}.m{float:right;color:#444}.a{color:#185;font-style:italic}</style></head><body><h1>${esc(p.title)}</h1><p class="meta">${esc(p.subject ?? '')} · ${esc(p.grade ?? '')} · Time: ${p.durationMinutes} min · Maximum marks: ${p.analysis.totalMarks}</p>${p.instructions ? `<p>${esc(p.instructions)}</p>` : ''}${body}</body></html>`);
  w.document.close();
  w.print();
}

function PaperDetail({ paper, offerings, onClose, onChanged }: { paper: Paper; offerings: Offering[]; onClose: () => void; onChanged: (p: Paper | null) => void }) {
  const { run, busy, error } = useAction();
  const toast = useToast();
  const [quizFor, setQuizFor] = useState('');
  const mcqs = paper.sections.flatMap((s) => s.questions).filter((q) => q.type === 'MCQ').length;
  const classes = offerings.filter((o) => o.label.split('·').pop()?.trim() === paper.subject && o.label.startsWith(paper.grade ?? '§'));
  return (
    <Modal wide title={paper.title} onClose={onClose} footer={<>
      <Button variant="soft" onClick={() => printPaper(paper, false)}>Print paper</Button>
      <Button variant="soft" onClick={() => printPaper(paper, true)}>Print with answers</Button>
      {paper.status === 'DRAFT' && paper.mine && <Button disabled={busy} onClick={() => { if (window.confirm('Make this paper final? It is then locked, and each question counts as used.')) void run(async () => { onChanged(await post<Paper>(`/teaching/papers/${paper.id}/final`)); toast('Paper is final', 'success'); }); }}>Make final</Button>}
    </>}>
      <p className="ops-muted">{paper.subject} · {paper.grade} · {paper.durationMinutes} min · <Pill tone={paper.status === 'FINAL' ? 'green' : 'gray'}>{humanize(paper.status)}</Pill></p>
      {paper.shortfalls && paper.shortfalls.length > 0 && <div className="ops-callout is-warn" style={{ marginBottom: 10 }}><strong>The bank was short</strong><ul style={{ margin: '6px 0 0 18px' }}>{paper.shortfalls.map((w) => <li key={w}>{w}</li>)}</ul></div>}
      <AnalysisPanel a={paper.analysis} />
      {paper.sections.map((s) => (
        <div key={s.title} style={{ marginTop: 12 }}>
          <div className="field-label">{s.title} · {s.questions.reduce((n, q) => n + q.marks, 0)} marks</div>
          <ol style={{ margin: '4px 0 0 18px' }}>{s.questions.map((q) => <li key={q.id} style={{ marginBottom: 4 }}>{q.text} <span className="ops-muted">({q.marks} m · {q.chapter}{q.competencyBased ? ' · competency' : ''})</span></li>)}</ol>
        </div>
      ))}
      {mcqs > 0 && classes.length > 0 && (
        <div className="ops-inline" style={{ marginTop: 12 }}>
          <span>Use the {mcqs} MCQ{mcqs === 1 ? '' : 's'} as an online quiz for</span>
          <select className="input" aria-label="Quiz class" value={quizFor} onChange={(e) => setQuizFor(e.target.value)} style={{ maxWidth: 220 }}><option value="">choose a class</option>{classes.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
          <Button small variant="soft" disabled={busy || !quizFor} onClick={() => void run(async () => { await post('/teaching/papers/to-quiz', { paperId: paper.id, subjectOfferingId: quizFor, title: `${paper.title} (quiz)` }); toast('Draft quiz created: publish it from Quizzes', 'success'); })}>Create draft quiz</Button>
        </div>
      )}
      {paper.status === 'DRAFT' && paper.mine && <div style={{ marginTop: 12 }}><Button small variant="ghost" disabled={busy} onClick={() => { if (window.confirm('Remove this draft paper?')) void run(async () => { await del(`/teaching/papers/${paper.id}`); onChanged(null); }); }}>Remove draft</Button></div>}
      <ErrorNote error={error} />
    </Modal>
  );
}

export function QuestionBankView() {
  const scopes = useLoad(() => get<BankScope[]>('/teaching/question-bank/scopes'), []);
  const offerings = useLoad(() => get<Offering[]>('/syllabus/offerings'), []);
  const [key, setKey] = useState('');
  const [tab, setTab] = useState<'bank' | 'papers'>('bank');
  const [chapter, setChapter] = useState('');
  const [type, setType] = useState('');
  const [compOnly, setCompOnly] = useState(false);
  const [adding, setAdding] = useState(false);
  const [building, setBuilding] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [paper, setPaper] = useState<Paper | null>(null);
  const { run, busy, error } = useAction();
  const toast = useToast();
  const list = scopes.data ?? [];
  const scope = list.find((s) => `${s.subjectId}|${s.gradeId}` === key) ?? list[0] ?? null;
  const questions = useLoad(() => (scope ? get<{ items: Question[]; totals: { questions: number; competencyBased: number; marks: number } }>('/teaching/question-bank', { subjectId: scope.subjectId, gradeId: scope.gradeId, chapter: chapter || undefined, type: type || undefined, competencyBased: compOnly || undefined }) : Promise.resolve(null)), [scope?.subjectId, scope?.gradeId, chapter, type, compOnly]);
  const papers = useLoad(() => (scope ? get<Paper[]>('/teaching/papers', { subjectId: scope.subjectId, gradeId: scope.gradeId }) : Promise.resolve([])), [scope?.subjectId, scope?.gradeId]);
  return (
    <div className="ops-stack">
      <Loadable state={scopes}>{() => !scope ? <SectionCard title="Question bank"><p className="ops-muted">You teach no subject yet, so there is no bank to show.</p></SectionCard> : (
        <SectionCard title={`${scope.subject} · ${scope.grade}`} sub="Shared with every teacher of this subject and class. Answers stay with staff." actions={
          <div className="ops-inline">
            <select className="input" aria-label="Subject and class" value={`${scope.subjectId}|${scope.gradeId}`} onChange={(e) => { setKey(e.target.value); setChapter(''); setPicked([]); }} style={{ maxWidth: 240 }}>
              {list.map((s) => <option key={`${s.subjectId}|${s.gradeId}`} value={`${s.subjectId}|${s.gradeId}`}>{s.subject} · {s.grade} ({s.questions})</option>)}
            </select>
            <Button small variant="soft" onClick={() => setAdding(true)}>+ Question</Button>
            <Button small onClick={() => setBuilding(true)}>Build a paper</Button>
          </div>
        }>
          <Tabs tabs={[{ key: 'bank', label: 'Questions', count: questions.data?.totals.questions ?? null }, { key: 'papers', label: 'Papers', count: papers.data?.length ?? null }]} value={tab} onChange={setTab} />
          {tab === 'bank' && (
            <>
              <div className="ops-inline" style={{ margin: '10px 0' }}>
                <select className="input" aria-label="Chapter" value={chapter} onChange={(e) => setChapter(e.target.value)} style={{ maxWidth: 220 }}><option value="">All chapters</option>{scope.chapters.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                <select className="input" aria-label="Type" value={type} onChange={(e) => setType(e.target.value)} style={{ maxWidth: 200 }}><option value="">All types</option>{QTYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <label className="ops-inline"><input type="checkbox" checked={compOnly} onChange={(e) => setCompOnly(e.target.checked)} /> Competency-based only</label>
                {picked.length > 0 && <Button small disabled={busy} onClick={() => void run(async () => { const p = await post<Paper>('/teaching/papers', { subjectId: scope.subjectId, gradeId: scope.gradeId, title: `${scope.subject} ${scope.grade}: worksheet`, sections: [{ title: 'Section A', questionIds: picked }] }); setPicked([]); setPaper(p); await papers.reload(); })}>Make a paper from {picked.length} selected</Button>}
              </div>
              <Loadable state={questions}>{(q) => !q || !q.items.length ? <p className="ops-muted">No questions here yet. Add the first one, or ask the assistant to add them for you.</p> : (
                <>
                  <p className="ops-muted">{q.totals.questions} question{q.totals.questions === 1 ? '' : 's'} · {q.totals.competencyBased} competency-based · {q.totals.marks} marks in all</p>
                  <ul className="ops-list">{q.items.map((x) => (
                    <li key={x.id} className="ops-row">
                      <label className="p5-pick"><input type="checkbox" aria-label="Select for a paper" checked={picked.includes(x.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, x.id] : picked.filter((y) => y !== x.id))} /></label>
                      <div className="ops-row-main">
                        <div className="ops-row-title" style={{ fontWeight: 600 }}>{x.text}</div>
                        {x.options.length > 0 && <div className="ops-row-sub">{x.options.map((o, i) => `${String.fromCharCode(97 + i)}) ${o.text}${o.isCorrect ? ' ✔' : ''}`).join('   ')}</div>}
                        <div className="ops-row-sub">{x.chapter} · {x.typeLabel} · {x.marks} m · {humanize(x.bloom)} · {humanize(x.difficulty)}{x.author ? ` · by ${x.author}` : ''}{x.timesUsed ? ` · used ${x.timesUsed}×` : ''}</div>
                      </div>
                      {x.competencyBased && <Pill tone="blue">Competency</Pill>}
                      {x.mine && <Button small variant="ghost" disabled={busy} onClick={() => { if (window.confirm('Remove this question from the bank?')) void run(async () => { await del(`/teaching/question-bank/${x.id}`); toast('Removed', 'success'); await questions.reload(); }); }}>Remove</Button>}
                    </li>
                  ))}</ul>
                </>
              )}</Loadable>
            </>
          )}
          {tab === 'papers' && (
            <Loadable state={papers}>{(ps) => !ps.length ? <p className="ops-muted" style={{ marginTop: 10 }}>No papers yet. Build one from a blueprint.</p> : (
              <ul className="ops-list">{ps.map((p) => (
                <li key={p.id} className="ops-row">
                  <div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => setPaper(p)}>
                    <div className="ops-row-title">{p.title}</div>
                    <div className="ops-row-sub">{p.analysis.totalMarks} marks · {p.analysis.questions} questions · {p.analysis.competencyPct}% competency-based{p.author ? ` · ${p.author}` : ''}</div>
                  </button></div>
                  {p.analysis.warnings.length > 0 && <Pill tone="amber">{p.analysis.warnings.length} to check</Pill>}
                  <Pill tone={p.status === 'FINAL' ? 'green' : 'gray'}>{humanize(p.status)}</Pill>
                </li>
              ))}</ul>
            )}</Loadable>
          )}
          <ErrorNote error={error} />
        </SectionCard>
      )}</Loadable>
      {adding && scope && <QuestionForm scope={scope} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void questions.reload(); void scopes.reload(); }} />}
      {building && scope && <BuildPaperModal scope={scope} onClose={() => setBuilding(false)} onBuilt={(p) => { setBuilding(false); setPaper(p); setTab('papers'); void papers.reload(); }} />}
      {paper && <PaperDetail paper={paper} offerings={offerings.data ?? []} onClose={() => setPaper(null)} onChanged={(p) => { setPaper(p); void papers.reload(); void questions.reload(); }} />}
    </div>
  );
}

/* ── CPD hours ──────────────────────────────────────────────────────── */

function LogHoursModal({ areas, onClose, onSaved }: { areas: Record<string, string>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ title: '', provider: '', mode: 'EXTERNAL', area: 'KNOWLEDGE_PRACTICE', hours: '3', date: isoDay(), online: false, evidenceUrl: '' });
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <Modal title="Log CPD hours" onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || !f.title.trim()} onClick={() => void run(async () => { await post('/teaching/cpd', { ...f, hours: Number(f.hours), evidenceUrl: f.evidenceUrl || null }); toast('Hours logged; HR verifies them', 'success'); onSaved(); })}>Log hours</Button>
    </>}>
      <Field label="Training or activity" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. CBSE COE workshop: competency-based assessment" /></Field>
      <div className="ops-form-grid">
        <Field label="Provider"><input className="input" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} /></Field>
        <Field label="Type"><select className="input" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="EXTERNAL">External (CBSE / government institute)</option><option value="IN_HOUSE">In-house / school complex</option></select></Field>
        <Field label="NPST area"><select className="input" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })}>{Object.entries(areas).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Hours"><input className="input" type="number" min={0.5} max={100} step={0.5} value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} /></Field>
        <Field label="Date"><input className="input" type="date" max={isoDay()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Certificate link" hint="https:// link"><input className="input" value={f.evidenceUrl} onChange={(e) => setF({ ...f, evidenceUrl: e.target.value })} /></Field>
      </div>
      <label className="ops-inline"><input type="checkbox" checked={f.online} onChange={(e) => setF({ ...f, online: e.target.checked })} /> Online</label>
      <ErrorNote error={error} />
    </Modal>
  );
}

export function CpdView() {
  const { me } = useAuth();
  const isHr = me?.permissions?.['staffleave.manage'] === 'ALL';
  const [tab, setTab] = useState<'mine' | 'staff'>('mine');
  const mine = useLoad(() => get<CpdMine>('/teaching/cpd'), []);
  const staff = useLoad(() => (isHr ? get<CpdOverview>('/teaching/cpd/overview') : Promise.resolve(null)), [isHr]);
  const [logging, setLogging] = useState(false);
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <div className="ops-stack">
      {isHr && <Tabs tabs={[{ key: 'mine', label: 'My hours' }, { key: 'staff', label: 'All staff' }]} value={tab} onChange={setTab} />}
      {tab === 'mine' && (
        <Loadable state={mine}>{(m) => (
          <>
            <SectionCard title={`CPD hours · ${m.year}`} sub={`${fmtDate(m.from)} to ${fmtDate(m.to)}. CBSE reference: at least 50 hours a year, 25 external and 25 in-house.`} actions={<Button small onClick={() => setLogging(true)}>+ Log hours</Button>}>
              <div className="card-grid p4t-tiles">
                <Tile label="Total" value={`${m.summary.total} / ${m.summary.target} h`} tone={m.summary.total >= m.summary.target ? 'good' : 'neutral'} />
                <Tile label="External" value={`${m.summary.byMode.EXTERNAL} / ${m.summary.targets.EXTERNAL} h`} />
                <Tile label="In-house" value={`${m.summary.byMode.IN_HOUSE} / ${m.summary.targets.IN_HOUSE} h`} />
                <Tile label="Awaiting verification" value={`${m.summary.unverifiedHours} h`} tone={m.summary.unverifiedHours ? 'warn' : 'neutral'} />
              </div>
              <div className="ops-bar" style={{ height: 12, margin: '6px 0 14px' }} aria-label={`${m.summary.pct}% of 50 hours`}><span style={{ width: `${m.summary.pct}%` }} /></div>
              {m.summary.byArea.map((a) => <div key={a.area} className="p4t-bar-row"><span>{a.label}</span><div className="ops-bar"><span style={{ width: `${Math.min(100, Math.round((a.hours / a.target) * 100))}%` }} /></div><span>{a.hours}/{a.target} h</span></div>)}
              {m.summary.gaps.length > 0 ? <div className="ops-callout" style={{ marginTop: 10 }}><strong>Still to do this year</strong><ul style={{ margin: '6px 0 0 18px' }}>{m.summary.gaps.map((g) => <li key={g}>{g}</li>)}</ul></div> : <p className="ops-muted">All reference targets met. Well done.</p>}
            </SectionCard>
            <SectionCard title="Entries">
              {!m.entries.length ? <p className="ops-muted">Nothing yet. In-house trainings you attend appear here by themselves.</p> : (
                <ul className="ops-list">{m.entries.map((e) => (
                  <li key={e.id} className="ops-row">
                    <div className="ops-row-main"><div className="ops-row-title">{e.title}</div><div className="ops-row-sub">{fmtDate(e.date)} · {e.provider ?? '—'} · {e.mode === 'EXTERNAL' ? 'External' : 'In-house'} · {m.areas[e.area] ?? humanize(e.area)}{e.online ? ' · online' : ''}{e.source === 'TRAINING' ? ' · from the trainings register' : ''}</div></div>
                    <strong>{e.hours} h</strong>
                    <Pill tone={e.verified ? 'green' : 'amber'}>{e.verified ? 'Verified' : 'To verify'}</Pill>
                    {e.source === 'LOGGED' && !e.verified && <Button small variant="ghost" disabled={busy} onClick={() => void run(async () => { await del(`/teaching/cpd/${e.id}`); toast('Removed', 'success'); await mine.reload(); })}>Remove</Button>}
                  </li>
                ))}</ul>
              )}
              <ErrorNote error={error} />
            </SectionCard>
            {logging && <LogHoursModal areas={m.areas} onClose={() => setLogging(false)} onSaved={() => { setLogging(false); void mine.reload(); }} />}
          </>
        )}</Loadable>
      )}
      {tab === 'staff' && isHr && (
        <Loadable state={staff}>{(o) => !o ? null : (
          <>
            <SectionCard title={`Staff CPD · ${o.year}`} sub="Furthest behind first. The 50-hour figure is the CBSE reference the school works to.">
              <div className="card-grid p4t-tiles">
                <Tile label="Staff" value={o.totals.staff} />
                <Tile label="Met 50 h" value={o.totals.met} tone="good" />
                <Tile label="Under 25 h" value={o.totals.under25} tone={o.totals.under25 ? 'warn' : 'neutral'} />
              </div>
              <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Name</th><th>Total</th><th>External</th><th>In-house</th><th>To verify</th><th>Status</th></tr></thead>
                <tbody>{o.rows.map((r) => <tr key={r.profileId}><td>{r.name}</td><td>{r.total} h</td><td>{r.external}</td><td>{r.inHouse}</td><td>{r.unverifiedHours || '—'}</td><td>{r.met ? <Pill tone="green">Met</Pill> : <Pill tone="gray">{r.pct}%</Pill>}</td></tr>)}</tbody></table></div>
            </SectionCard>
            <SectionCard title="Waiting for verification" sub="Check each entry against its certificate. Nobody verifies their own.">
              {!o.pendingVerification.length ? <p className="ops-muted">Nothing waiting.</p> : (
                <ul className="ops-list">{o.pendingVerification.map((e) => (
                  <li key={e.id} className="ops-row">
                    <div className="ops-row-main"><div className="ops-row-title">{e.name}: {e.title}</div><div className="ops-row-sub">{fmtDate(e.date)} · {e.provider ?? '—'} · {e.hours} h · {e.mode === 'EXTERNAL' ? 'External' : 'In-house'}{e.evidenceUrl ? ' · ' : ''}{e.evidenceUrl && <a href={e.evidenceUrl} target="_blank" rel="noreferrer noopener">certificate</a>}</div></div>
                    {e.name !== me?.profile?.displayName && <Button small disabled={busy} onClick={() => void run(async () => { await post(`/teaching/cpd/${e.id}/verify`); toast('Verified', 'success'); await staff.reload(); })}>Verify</Button>}
                  </li>
                ))}</ul>
              )}
              <ErrorNote error={error} />
            </SectionCard>
          </>
        )}</Loadable>
      )}
    </div>
  );
}

/* ── One paper's class result (Exams page) ──────────────────────────── */

type PaperResults = {
  paper: { examName: string; subject: string; class: string; maxMarks: number; held: boolean };
  total: number; entered: number; absent: number; medical: number; pending: number; average: number | null; averageMarks: number | null;
  highest: number | null; lowest: number | null; passPct: number | null; bands: Array<{ grade: string; count: number }>;
  remedial: Array<{ rollNo: number | null; name: string; marks: number; pct: number }>; notes: string[]; published: boolean;
};

/** Class result analysis for the selected paper: shown under marks entry once any mark exists. */
export function PaperResultsPanel({ examSubjectId, version = 0 }: { examSubjectId: string; version?: number }) {
  const r = useLoad(() => get<PaperResults>('/teaching/paper-results', { examSubjectId }), [examSubjectId, version]);
  if (r.error || !r.data || !r.data.entered) return null;
  const d = r.data;
  const peak = Math.max(1, ...d.bands.map((b) => b.count));
  return (
    <SectionCard title={`Class result · ${d.paper.examName} · ${d.paper.subject} · ${d.paper.class}`} sub={`${d.entered} of ${d.total} marked${d.absent ? ` · ${d.absent} absent` : ''}${d.medical ? ` · ${d.medical} medical leave` : ''}${d.published ? ' · published' : ' · draft'}`}>
      <div className="card-grid p4t-tiles">
        <Tile label="Average" value={d.average === null ? '—' : `${d.average}% (${d.averageMarks}/${d.paper.maxMarks})`} />
        <Tile label="Highest" value={d.highest ?? '—'} />
        <Tile label="Lowest" value={d.lowest ?? '—'} />
        <Tile label="At or above 33%" value={d.passPct === null ? '—' : `${d.passPct}%`} tone={d.passPct !== null && d.passPct < 80 ? 'warn' : 'good'} />
      </div>
      <div className="field-label">Grade spread (CBSE eight-point)</div>
      {d.bands.map((b) => <div key={b.grade} className="p4t-bar-row"><span>{b.grade}</span><div className="ops-bar"><span style={{ width: `${Math.round((b.count / peak) * 100)}%` }} /></div><span>{b.count}</span></div>)}
      {d.remedial.length > 0 && (
        <div className="ops-callout is-warn" style={{ marginTop: 10 }}>
          <strong>Suggested remedial group ({d.remedial.length})</strong>
          <div className="ops-row-sub">{d.remedial.map((x) => `${x.rollNo != null ? `${x.rollNo}. ` : ''}${x.name} (${x.marks})`).join(' · ')}</div>
        </div>
      )}
      {d.notes.map((n) => <DataNote key={n}>{n}</DataNote>)}
    </SectionCard>
  );
}
