'use client';
import { useMemo, useState } from 'react';
import { Button, EmptyState, Field, Modal, useToast } from '@/components/ui';
import { opsApi } from '@/lib/ops-api';
import type { CourseModuleDto, SyllabusOverviewDto, SyllabusPlanDto, SyllabusRowDto } from '@/lib/ops-types';
import { Drawer } from './drawer';
import { DataNote, ErrorNote, Loadable, PromptModal, SectionCard, StatusPill, Tabs, Tile, fmtDate, isoDay, useAction, useLoad, useQueryParam } from './kit';

/**
 * Syllabus and module tracking. A teacher lays out each subject as modules with
 * a planned window and topics, then records what was taught after a lesson. The
 * principal sees every subject and every teacher against the plan. Progress is
 * only ever what a teacher recorded; nothing is estimated.
 */
type Tab = 'teachers' | 'subjects';
type Filter = 'ALL' | 'ON_TRACK' | 'BEHIND' | 'NO_RECENT_UPDATE' | 'NO_PLAN';

const HEALTH: Record<string, [string, string]> = {
  ON_TRACK: ['APPROVED', 'On track'], COMPLETED: ['COMPLETED', 'Completed'], BEHIND: ['PENDING', 'Behind'], OVERDUE: ['OVERDUE', 'Overdue'],
  NO_RECENT_UPDATE: ['PENDING', 'No recent update'], NO_PLAN: ['DRAFT', 'No plan yet'],
};
const PACE: Record<string, [string, string]> = {
  UPCOMING: ['DRAFT', 'Upcoming'], ON_TRACK: ['APPROVED', 'On track'], AHEAD: ['APPROVED', 'Ahead'], BEHIND: ['PENDING', 'Behind'],
  OVERDUE: ['OVERDUE', 'Overdue'], COMPLETED: ['COMPLETED', 'Completed'], COMPLETED_LATE: ['CLOSED', 'Completed late'],
};
const matches = (r: SyllabusRowDto, f: Filter) => f === 'ALL'
  || (f === 'ON_TRACK' && ['ON_TRACK', 'COMPLETED'].includes(r.health))
  || (f === 'BEHIND' && ['BEHIND', 'OVERDUE'].includes(r.health))
  || r.health === f;

/** Done against expected: the bar is what was recorded, the tick is where the plan says it should be. */
export function ProgressBar({ done, expected, tone }: { done: number; expected?: number | null; tone?: string }) {
  return (
    <span className={`sy-bar${tone ? ` is-${tone}` : ''}`} role="img" aria-label={`${done}% done${expected !== null && expected !== undefined ? `, ${expected}% expected by now` : ''}`}>
      <span className="sy-bar-fill" style={{ width: `${Math.min(100, Math.max(0, done))}%` }} />
      {expected !== null && expected !== undefined && expected > 0 && expected < 100 && <span className="sy-bar-mark" style={{ left: `${expected}%` }} />}
    </span>
  );
}
const toneOf = (pace: string) => (['BEHIND', 'NO_RECENT_UPDATE'].includes(pace) ? 'warn' : pace === 'OVERDUE' ? 'bad' : 'good');

function ModuleForm({ offeringId, module: m, onClose, onDone }: { offeringId: string; module?: CourseModuleDto; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ title: m?.title ?? '', description: m?.description ?? '', plannedStart: (m?.plannedStart ?? '').slice(0, 10) || isoDay(), plannedEnd: (m?.plannedEnd ?? '').slice(0, 10), plannedPeriods: m?.plannedPeriods ? String(m.plannedPeriods) : '', topics: '' });
  const { run, busy, error } = useAction();
  const toast = useToast();
  const save = () => run(async () => {
    const body = { title: f.title, description: f.description || null, plannedStart: f.plannedStart, plannedEnd: f.plannedEnd, plannedPeriods: f.plannedPeriods ? Number(f.plannedPeriods) : null };
    if (m) await opsApi.updateModule(m.id, { ...body, addTopics: f.topics.split('\n').map((t) => t.trim()).filter(Boolean) });
    else await opsApi.createModule({ ...body, subjectOfferingId: offeringId, topics: f.topics });
    toast(m ? 'Module updated' : 'Module added to the plan', 'success');
    onDone();
  });
  return (
    <Modal title={m ? `Edit: ${m.title}` : 'Add a module'} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.title.trim() || !f.plannedStart || !f.plannedEnd} onClick={() => void save()}>{m ? 'Save' : 'Add module'}</Button></>}>
      <Field label="Module or unit title" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Unit 3: Fractions" /></Field>
      <div className="ops-grid-2">
        <Field label="Start teaching on" required><input className="input" type="date" value={f.plannedStart} onChange={(e) => setF({ ...f, plannedStart: e.target.value })} /></Field>
        <Field label="Finish by" required><input className="input" type="date" value={f.plannedEnd} min={f.plannedStart} onChange={(e) => setF({ ...f, plannedEnd: e.target.value })} /></Field>
      </div>
      <Field label="Periods planned" hint="Optional."><input className="input" type="number" min={1} max={500} value={f.plannedPeriods} onChange={(e) => setF({ ...f, plannedPeriods: e.target.value })} /></Field>
      <Field label={m ? 'Add topics' : 'Topics'} hint="One per line. Progress is the share of topics you tick off."><textarea className="input" rows={5} value={f.topics} onChange={(e) => setF({ ...f, topics: e.target.value })} placeholder={'Equivalent fractions\nAdding fractions\nWord problems'} /></Field>
      <Field label="Notes"><textarea className="input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <ErrorNote error={error} />
    </Modal>
  );
}

function RecordLesson({ module: m, onClose, onDone }: { module: CourseModuleDto; onClose: () => void; onDone: () => void }) {
  const open = m.topics.filter((t) => !t.done);
  const [picked, setPicked] = useState<string[]>([]);
  const [f, setF] = useState({ taughtOn: isoDay(), note: '', homework: '' });
  const { run, busy, error } = useAction();
  const toast = useToast();
  const toggle = (id: string) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  const closes = open.length > 0 && picked.length === open.length;
  const save = () => run(async () => {
    await opsApi.recordModuleProgress(m.id, { topicIds: picked, taughtOn: f.taughtOn, note: f.note || undefined, homework: f.homework || undefined });
    toast(closes ? 'Recorded. The module is complete.' : 'Lesson recorded', 'success');
    onDone();
  });
  return (
    <Modal title={`Record a lesson: ${m.title}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || (!picked.length && !f.note.trim() && !f.homework.trim())} onClick={() => void save()}>{closes ? 'Record and complete module' : 'Record lesson'}</Button></>}>
      <Field label="Taught on" required><input className="input" type="date" max={isoDay()} value={f.taughtOn} onChange={(e) => setF({ ...f, taughtOn: e.target.value })} /></Field>
      <Field label="Topics covered" hint={open.length ? 'Tick what you finished in this lesson.' : 'Every topic is already ticked off.'}>
        <div className="sy-topics">{open.map((t) => <label key={t.id} className="sy-topic"><input type="checkbox" checked={picked.includes(t.id)} onChange={() => toggle(t.id)} />{t.title}</label>)}</div>
      </Field>
      <Field label="What happened in class"><textarea className="input" rows={3} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Used fraction strips; half the class needs another go at word problems." /></Field>
      <Field label="Homework given"><input className="input" value={f.homework} onChange={(e) => setF({ ...f, homework: e.target.value })} placeholder="e.g. Exercise 4.2, questions 1-8" /></Field>
      <ErrorNote error={error} />
    </Modal>
  );
}

/** Every module of the subject on one calendar strip, with today marked. */
function PlanTimeline({ plan }: { plan: SyllabusPlanDto }) {
  const span = useMemo(() => {
    if (!plan.modules.length) return null;
    const from = Math.min(...plan.modules.map((m) => new Date(m.plannedStart).getTime()));
    const to = Math.max(...plan.modules.map((m) => new Date(m.plannedEnd).getTime())) + 86_400_000;
    return { from, to, len: Math.max(1, to - from) };
  }, [plan.modules]);
  if (!span) return null;
  const pos = (t: number) => Math.min(100, Math.max(0, ((t - span.from) / span.len) * 100));
  const today = pos(Date.now());
  return (
    <div className="sy-gantt" aria-label="Module timeline">
      {plan.modules.map((m) => {
        const left = pos(new Date(m.plannedStart).getTime());
        const width = Math.max(2, pos(new Date(m.plannedEnd).getTime() + 86_400_000) - left);
        return (
          <div key={m.id} className="sy-gantt-row">
            <span className="sy-gantt-name" title={m.title}>{m.order}. {m.title}</span>
            <span className="sy-gantt-track">
              <span className={`sy-gantt-bar is-${toneOf(m.pace)}${m.status === 'PLANNED' ? ' is-planned' : ''}`} style={{ left: `${left}%`, width: `${width}%` }} title={`${fmtDate(m.plannedStart)} to ${fmtDate(m.plannedEnd)} · ${m.progressPct}% done`}>
                <span className="sy-gantt-done" style={{ width: `${m.progressPct}%` }} />
              </span>
              {today > 0 && today < 100 && <span className="sy-gantt-today" style={{ left: `${today}%` }} />}
            </span>
          </div>
        );
      })}
      <div className="sy-gantt-axis"><span>{fmtDate(new Date(span.from))}</span><span>Today is the line</span><span>{fmtDate(new Date(span.to - 86_400_000))}</span></div>
    </div>
  );
}

function PlanDrawer({ offeringId, onClose, onChanged }: { offeringId: string; onClose: () => void; onChanged: () => void }) {
  const state = useLoad(() => opsApi.syllabusPlan(offeringId), [offeringId]);
  const [form, setForm] = useState<null | { module?: CourseModuleDto }>(null);
  const [record, setRecord] = useState<CourseModuleDto | null>(null);
  const [remove, setRemove] = useState<CourseModuleDto | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const { run, busy, error } = useAction();
  const toast = useToast();
  const plan = state.data;
  const after = async () => { setForm(null); setRecord(null); await state.reload(); onChanged(); };
  return (
    <Drawer title={plan ? `${plan.class} · ${plan.subject}` : 'Syllabus'} sub={plan ? `${plan.teacher ?? 'No teacher assigned'} · ${plan.modulesDone} of ${plan.modulesTotal} modules complete` : undefined} onClose={onClose}
      footer={plan?.canManage ? <Button onClick={() => setForm({})}>Add a module</Button> : undefined}>
      <Loadable state={state}>{(p) => (
        <div className="ops-stack">
          <div className="ops-inline">
            <StatusPill status={HEALTH[p.health]?.[0]} label={HEALTH[p.health]?.[1]} />
            {p.coveragePct !== null && <span className="ops-muted">{p.coveragePct}% of all topics covered{p.lastUpdateOn ? ` · last lesson recorded ${fmtDate(p.lastUpdateOn)}` : ''}</span>}
          </div>
          {!p.modules.length && <EmptyState title="No plan yet" sub={p.canManage ? 'Add the first module with its dates and topics.' : 'The teacher has not laid out this subject yet.'} />}
          {p.modules.length > 0 && <SectionCard title="Timeline"><PlanTimeline plan={p} /></SectionCard>}
          {p.modules.map((m) => {
            const isOpen = openId === m.id || (openId === null && m.id === p.current?.id);
            return (
              <div key={m.id} className={`card card-pad sy-module${isOpen ? ' is-open' : ''}`}>
                <button type="button" className="sy-module-head" aria-expanded={isOpen} onClick={() => setOpenId(isOpen ? '' : m.id)}>
                  <span className="sy-module-title">{m.order}. {m.title}</span>
                  <StatusPill status={PACE[m.pace]?.[0]} label={PACE[m.pace]?.[1]} />
                </button>
                <div className="sy-module-meta">
                  <ProgressBar done={m.progressPct} expected={m.status === 'COMPLETED' ? null : m.expectedPct} tone={toneOf(m.pace)} />
                  <span className="ops-muted">{m.topicsDone} of {m.topicsTotal} topics · {fmtDate(m.plannedStart)} to {fmtDate(m.plannedEnd)}{m.status !== 'COMPLETED' && m.daysLeft > 0 ? ` · ${m.daysLeft} day${m.daysLeft === 1 ? '' : 's'} left` : ''}</span>
                </div>
                {isOpen && (
                  <div className="ops-stack">
                    {m.description && <p className="ops-muted">{m.description}</p>}
                    <ul className="sy-topic-list">{m.topics.map((t) => (
                      <li key={t.id} className={t.done ? 'is-done' : ''}>
                        <span aria-hidden>{t.done ? '✓' : '○'}</span>{t.title}{t.done && t.doneAt ? <span className="ops-muted"> · {fmtDate(t.doneAt)}</span> : null}
                        {t.done && p.canManage && <button type="button" className="sy-link" disabled={busy} onClick={() => void run(async () => { await opsApi.recordModuleProgress(m.id, { reopenTopicIds: [t.id], note: `Reopened: ${t.title}` }); toast('Topic reopened', 'info'); await after(); })}>reopen</button>}
                      </li>
                    ))}</ul>
                    {m.updates.length > 0 && (
                      <div>
                        <div className="sy-sub">Lessons recorded</div>
                        <ul className="sy-updates">{m.updates.map((u, i) => (
                          <li key={i}>
                            <b>{fmtDate(u.taughtOn)}</b>{u.byName ? ` · ${u.byName}` : ''}
                            {u.topicsCovered.length > 0 && <div>Covered: {u.topicsCovered.join(', ')}</div>}
                            {u.note && <div>{u.note}</div>}
                            {u.homework && <div className="ops-muted">Homework: {u.homework}</div>}
                          </li>
                        ))}</ul>
                      </div>
                    )}
                    {p.canManage && (
                      <div className="ops-inline">
                        <Button small onClick={() => setRecord(m)}>Record a lesson</Button>
                        <Button small variant="ghost" onClick={() => setForm({ module: m })}>Edit dates or add topics</Button>
                        {!m.updates.length && <Button small variant="ghost" onClick={() => setRemove(m)}>Remove</Button>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <ErrorNote error={error} />
        </div>
      )}</Loadable>
      {form && <ModuleForm offeringId={offeringId} module={form.module} onClose={() => setForm(null)} onDone={() => void after()} />}
      {record && <RecordLesson module={record} onClose={() => setRecord(null)} onDone={() => void after()} />}
      {remove && <PromptModal title={`Remove "${remove.title}"`} label="Why (optional)" required={false} confirmLabel="Remove module" danger onClose={() => setRemove(null)} onSubmit={async () => { await opsApi.removeModule(remove.id); toast('Module removed', 'info'); await after(); }} />}
    </Drawer>
  );
}

function SubjectRows({ rows, onOpen, showTeacher }: { rows: SyllabusRowDto[]; onOpen: (id: string) => void; showTeacher: boolean }) {
  if (!rows.length) return <EmptyState title="Nothing here" sub="No subject matches this filter." />;
  return (
    <div className="card card-pad ops-table-wrap">
      <table className="ops-table">
        <thead><tr><th>Class and subject</th>{showTeacher && <th>Teacher</th>}<th>Teaching now</th><th>Module progress</th><th>Whole syllabus</th><th>Last lesson</th><th>Status</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.subjectOfferingId} className="is-clickable" onClick={() => onOpen(r.subjectOfferingId)}>
            <td><button type="button" className="ops-row-link" onClick={(e) => { e.stopPropagation(); onOpen(r.subjectOfferingId); }}><b>{r.class}</b> · {r.subject}</button></td>
            {showTeacher && <td>{r.teacher ?? '—'}</td>}
            <td>{r.current ? <><div>{r.current.title}</div>{r.current.nextTopic && <div className="ops-muted">Next: {r.current.nextTopic}</div>}</> : <span className="ops-muted">{r.health === 'NO_PLAN' ? 'Not planned' : r.health === 'COMPLETED' ? 'All modules done' : 'Between modules'}</span>}</td>
            <td>{r.current ? <><ProgressBar done={r.current.progressPct} expected={r.current.expectedPct} tone={toneOf(r.current.pace)} /><div className="ops-muted">{r.current.progressPct}% done · {r.current.expectedPct}% expected</div></> : '—'}</td>
            <td>{r.coveragePct === null ? '—' : <><ProgressBar done={r.coveragePct} /><div className="ops-muted">{r.modulesDone} of {r.modulesTotal} modules</div></>}</td>
            <td>{r.lastUpdateOn ? fmtDate(r.lastUpdateOn) : <span className="ops-muted">Never</span>}</td>
            <td><StatusPill status={HEALTH[r.health]?.[0]} label={HEALTH[r.health]?.[1]} /></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export function SyllabusView() {
  const state = useLoad(() => opsApi.syllabus(), []);
  const [tab, setTab] = useState<Tab | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [teacherId, setTeacherId] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(useQueryParam('offering'));
  return (
    <div className="ops-stack">
      <Loadable state={state}>{(d: SyllabusOverviewDto) => {
        const principal = d.byTeacher.length > 0;
        const active: Tab = tab ?? (principal ? 'teachers' : 'subjects');
        const teacher = teacherId ? d.byTeacher.find((t) => t.teacherId === teacherId) : null;
        const rows = d.rows.filter((r) => matches(r, filter) && (!teacherId || r.teacherId === teacherId));
        const pick = (f: Filter) => { setFilter(f); setTab('subjects'); };
        return (
          <>
            <div className="kpi-grid">
              <button type="button" className="sy-tile" onClick={() => pick('ALL')}><Tile label="Subjects" value={d.totals.subjects} /></button>
              <button type="button" className="sy-tile" onClick={() => pick('ON_TRACK')}><Tile label="On track" value={d.totals.onTrack} tone="good" /></button>
              <button type="button" className="sy-tile" onClick={() => pick('BEHIND')}><Tile label="Behind plan" value={d.totals.behind} tone={d.totals.behind ? 'bad' : 'good'} /></button>
              <button type="button" className="sy-tile" onClick={() => pick('NO_RECENT_UPDATE')}><Tile label="No lesson recorded this week" value={d.totals.noRecentUpdate} tone={d.totals.noRecentUpdate ? 'warn' : 'good'} /></button>
              <button type="button" className="sy-tile" onClick={() => pick('NO_PLAN')}><Tile label="No plan yet" value={d.totals.noPlan} tone={d.totals.noPlan ? 'warn' : 'good'} /></button>
            </div>
            {principal && <Tabs tabs={[{ key: 'teachers', label: 'By teacher', count: d.byTeacher.length }, { key: 'subjects', label: 'By subject', count: d.rows.length }]} value={active} onChange={(t) => { setTab(t); if (t === 'teachers') { setTeacherId(null); setFilter('ALL'); } }} />}
            {active === 'teachers' && principal ? (
              <div className="card card-pad ops-table-wrap">
                <table className="ops-table">
                  <thead><tr><th>Teacher</th><th className="num">Subjects</th><th>Syllabus covered</th><th className="num">On track</th><th className="num">Behind</th><th className="num">No lesson this week</th><th className="num">No plan</th><th className="num">Lessons recorded (7 days)</th><th className="num">Average exam result</th></tr></thead>
                  <tbody>{d.byTeacher.map((t) => (
                    <tr key={t.teacherId ?? 'none'} className="is-clickable" onClick={() => { setTeacherId(t.teacherId); setFilter('ALL'); setTab('subjects'); }}>
                      <td><button type="button" className="ops-row-link"><b>{t.teacher}</b></button></td>
                      <td className="num">{t.subjects}</td>
                      <td>{t.coveragePct === null ? '—' : <><ProgressBar done={t.coveragePct} tone={t.behind ? 'warn' : 'good'} /><span className="ops-muted"> {t.coveragePct}%</span></>}</td>
                      <td className="num">{t.onTrack}</td>
                      <td className="num">{t.behind ? <b className="sy-bad">{t.behind}</b> : 0}</td>
                      <td className="num">{t.noUpdate ? <b className="sy-warn">{t.noUpdate}</b> : 0}</td>
                      <td className="num">{t.noPlan}</td>
                      <td className="num">{t.lessonsThisWeek}</td>
                      <td className="num">{t.avgScorePct === null ? '—' : `${t.avgScorePct}%`}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : (
              <>
                {(filter !== 'ALL' || teacher) && (
                  <div className="ops-inline">
                    <span className="ops-muted">Showing {rows.length} of {d.rows.length}{teacher ? ` · ${teacher.teacher}` : ''}{filter !== 'ALL' ? ` · ${HEALTH[filter]?.[1] ?? 'Behind'}` : ''}</span>
                    <Button small variant="ghost" onClick={() => { setFilter('ALL'); setTeacherId(null); }}>Show all</Button>
                  </div>
                )}
                {!d.rows.length ? <EmptyState title="No subjects" sub="Subjects appear here once classes have a timetable and teachers." /> : <SubjectRows rows={rows} onOpen={setOpen} showTeacher={principal} />}
              </>
            )}
            <DataNote>{d.definition} The thin line on a bar is where the plan expects the class to be today.</DataNote>
          </>
        );
      }}</Loadable>
      {open && <PlanDrawer offeringId={open} onClose={() => setOpen(null)} onChanged={() => void state.reload()} />}
    </div>
  );
}
