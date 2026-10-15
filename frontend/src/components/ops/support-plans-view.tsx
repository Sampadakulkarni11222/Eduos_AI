'use client';
import { useState } from 'react';
import { Button, EmptyState, Field, Modal, useToast } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { usePermissions } from '@/lib/permissions';
import { CONCERN_AREAS, GOAL_STATUSES, PLAN_OUTCOMES, portfolioApi, supportApi, type FamilyPlanDto, type PlanSuggestion, type SupportPlanDto } from '@/lib/p2-api';
import { Drawer } from './drawer';
import { DataNote, ErrorNote, KeyValues, Loadable, SectionCard, StatusPill, Tabs, Tile, Timeline, fmtDate, humanize, isoDay, useAction, useLoad, useQueryParam } from './kit';

/**
 * Student support plans. Staff open a plan from the rule-based risk signals
 * (or their own judgement), set measurable goals with review dates (which
 * become tasks), assign actions, review progress and close with an outcome.
 * Families see, for their own child only, the summary, goals and the review
 * notes written for them, never internal notes or the safeguarding flag.
 */
const FAMILY = ['PARENT', 'STUDENT'];
const inDays = (n: number) => isoDay(new Date(Date.now() + n * 86_400_000));
const goalTone = (s: string) => (s === 'MET' ? 'COMPLETED' : s === 'AT_RISK' || s === 'NOT_MET' ? 'OVERDUE' : s === 'ON_TRACK' ? 'IN_PROGRESS' : 'OPEN');

function GoalLine({ g }: { g: { title: string; measure: string; unit: string | null; baseline: number | null; target: number; reviewOn: string; status: string; latest: { value: number | null } | null } }) {
  const u = g.unit ?? '';
  return (
    <li className="ops-row">
      <div className="ops-row-main">
        <div className="ops-row-title">{g.title}</div>
        <div className="ops-row-sub">{g.measure}: {g.baseline !== null ? `from ${g.baseline}${u} ` : ''}to {g.target}{u}{g.latest?.value != null ? ` · latest ${g.latest.value}${u}` : ''} · review {fmtDate(g.reviewOn)}</div>
      </div>
      <StatusPill status={goalTone(g.status)} label={humanize(g.status)} />
    </li>
  );
}

// ── family view ─────────────────────────────────────────────────────────
function FamilyPlans() {
  const state = useLoad(() => supportApi.family(), []);
  const [ack, setAck] = useState<FamilyPlanDto | null>(null);
  const [comment, setComment] = useState('');
  const { run, busy, error } = useAction();
  return (
    <div className="ops-stack">
      <DataNote>Plans the school has shared with you about your own child: what the plan is for, its goals and how they are going. Teachers&apos; internal notes are not shown here.</DataNote>
      <Loadable state={state}>{(d) => !d.items.length ? <EmptyState title="No support plans" sub="When the school opens a support plan for your child and shares it, it appears here." /> : (
        <>{d.items.map((p) => (
          <SectionCard key={p.id} title={`${p.studentName} · ${p.areaLabel}`} sub={`${p.refNo} · ${p.ownerName ?? ''}${p.nextReviewOn ? ` · next review ${fmtDate(p.nextReviewOn)}` : ''}`} actions={!p.acknowledgedAt && p.status === 'ACTIVE' ? <Button small onClick={() => { setAck(p); setComment(''); }}>I have read this</Button> : <StatusPill status={p.status === 'CLOSED' ? 'CLOSED' : 'ACKNOWLEDGED'} label={p.status === 'CLOSED' ? `Closed${p.closure?.outcome ? `: ${humanize(p.closure.outcome)}` : ''}` : 'Read'} />}>
            <p>{p.summary}</p>
            <h3 className="sp-h">Goals</h3>
            <ul className="ops-list">{p.goals.map((g) => <GoalLine key={g.id} g={g} />)}</ul>
            {!!p.familyActions.length && (<><h3 className="sp-h">What we agreed you will do</h3><ul className="ops-list">{p.familyActions.map((a) => <li key={a.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{a.title}</div><div className="ops-row-sub">{a.dueOn ? `by ${fmtDate(a.dueOn)}` : ''}</div></div><StatusPill status={a.status === 'DONE' ? 'DONE' : 'OPEN'} /></li>)}</ul></>)}
            {!!p.reviews.length && (<><h3 className="sp-h">Progress reviews</h3><ul className="ops-list">{p.reviews.map((r, i) => <li key={i} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{fmtDate(r.at)} · {r.byName}</div><div className="ops-row-sub">{r.summary}</div></div></li>)}</ul></>)}
          </SectionCard>
        ))}</>
      )}</Loadable>
      {ack && (
        <Modal title="I have read this plan" onClose={() => setAck(null)} footer={<><Button variant="soft" onClick={() => setAck(null)}>Cancel</Button><Button disabled={busy} onClick={() => void run(async () => { await supportApi.acknowledge(ack.id, comment); setAck(null); await state.reload(); })}>Confirm</Button></>}>
          <Field label="Anything you want the school to know (optional)"><textarea className="input" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} style={{ width: '100%' }} /></Field>
          <ErrorNote error={error} />
        </Modal>
      )}
    </div>
  );
}

// ── staff: open a plan ──────────────────────────────────────────────────
function NewPlan({ preset, onClose, onDone }: { preset?: PlanSuggestion | null; onClose: () => void; onDone: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const students = useLoad(() => portfolioApi.students(search ? { search } : {}), [search]);
  const [f, setF] = useState({ studentId: preset?.studentId ?? '', concernArea: preset?.concernArea ?? 'ACADEMIC', summary: '', goalTitle: '', measure: '', unit: '%', baseline: '', target: '', reviewOn: inDays(28), actionTitle: '' });
  const { run, busy, error } = useAction();
  const { me } = useAuth();
  return (
    <Modal wide title="Open a support plan" onClose={onClose} footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.studentId || !f.summary || !f.goalTitle || !f.measure || f.target === ''} onClick={() => void run(async () => {
      const p = await supportApi.create({
        studentId: f.studentId, concernArea: f.concernArea, riskType: preset?.riskType, summary: f.summary,
        goals: [{ title: f.goalTitle, measure: f.measure, unit: f.unit || null, baseline: f.baseline === '' ? null : Number(f.baseline), target: Number(f.target), reviewOn: f.reviewOn }],
        actions: f.actionTitle ? [{ title: f.actionTitle, ownerKind: 'STAFF', ownerProfileId: me?.profile?.id, dueOn: inDays(7) }] : [],
      });
      onDone(p.id);
    })}>Open plan</Button></>}>
      {preset ? <DataNote>From the risk signals: {preset.studentName} ({preset.className}), {preset.evidence?.label ?? humanize(preset.riskType)}. A signal is a prompt to look, not a judgement.</DataNote> : (
        <div className="ops-form-grid">
          <Field label="Find a student"><input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or admission no." /></Field>
          <Field label="Student" required><select className="input" value={f.studentId} onChange={(e) => setF({ ...f, studentId: e.target.value })}><option value="">Choose…</option>{(students.data ?? []).map((s) => <option key={s.studentId} value={s.studentId}>{s.name}{s.className ? ` · ${s.className}` : ''}</option>)}</select></Field>
        </div>
      )}
      <div className="ops-form-grid">
        <Field label="Concern area" required><select className="input" value={f.concernArea} onChange={(e) => setF({ ...f, concernArea: e.target.value })}>{CONCERN_AREAS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</select></Field>
      </div>
      {f.concernArea === 'WELLBEING_REFERRAL' && <DataNote>Record the referral only. No diagnoses, medication or clinical details here; safeguarding concerns go to the Safeguarding page.</DataNote>}
      <Field label="Summary for the family (what the plan is for)" required><textarea className="input" rows={3} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} style={{ width: '100%' }} /></Field>
      <h3 className="sp-h">First goal (measurable)</h3>
      <div className="ops-form-grid">
        <Field label="Goal" required><input className="input" value={f.goalTitle} onChange={(e) => setF({ ...f, goalTitle: e.target.value })} placeholder="Attend school every day" /></Field>
        <Field label="How it is measured" required><input className="input" value={f.measure} onChange={(e) => setF({ ...f, measure: e.target.value })} placeholder="Attendance % over 4 weeks" /></Field>
        <Field label="Unit"><input className="input" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
        <Field label="Now (baseline)"><input className="input" inputMode="decimal" value={f.baseline} onChange={(e) => setF({ ...f, baseline: e.target.value })} /></Field>
        <Field label="Target" required><input className="input" inputMode="decimal" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></Field>
        <Field label="Review on" required><input className="input" type="date" value={f.reviewOn} onChange={(e) => setF({ ...f, reviewOn: e.target.value })} /></Field>
      </div>
      <Field label="First action (yours, due in a week; optional)"><input className="input" value={f.actionTitle} onChange={(e) => setF({ ...f, actionTitle: e.target.value })} placeholder="Call home after any absence" /></Field>
      <DataNote>The review date becomes a task in My Tasks, with reminders.</DataNote>
      <ErrorNote error={error} />
    </Modal>
  );
}

// ── staff: one plan ─────────────────────────────────────────────────────
type Dialog = null | 'goal' | 'action' | 'review' | 'note' | 'close' | { progress: string };
function PlanDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const state = useLoad(() => supportApi.get(id), [id]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const { run, busy, error } = useAction();
  const toast = useToast();
  const { permissions } = usePermissions();
  const after = async (msg: string) => { toast(msg, 'success'); setDialog(null); setF({}); await state.reload(); onChanged(); };
  const p = state.data;
  const active = p?.status === 'ACTIVE';
  return (
    <Drawer title={p ? `${p.studentName} · ${p.areaLabel}` : 'Support plan'} sub={p ? `${p.refNo} · ${p.className ?? ''} · owner ${p.ownerName ?? '—'}` : undefined} onClose={onClose}
      footer={p && active && <>
        <Button small variant="soft" onClick={() => setDialog('review')}>Record review</Button>
        {!p.family.sharedAt && <Button small variant="soft" disabled={busy} onClick={() => void run(async () => { await supportApi.share(id); await after('Shared with the family'); })}>Share with family</Button>}
        {(permissions['safeguarding.report'] || permissions['supportplans.referral.view']) && !p.referral?.referred && <Button small variant="ghost" disabled={busy} onClick={() => void run(async () => { await supportApi.referral(id); await after('Referral recorded'); })}>Mark referred to safeguarding</Button>}
        <Button small variant="ghost" onClick={() => setDialog('close')}>Close plan</Button>
      </>}>
      <ErrorNote error={error} />
      <Loadable state={state}>{(d: SupportPlanDto) => (
        <div className="ops-stack">
          <div className="ops-inline"><StatusPill status={d.status === 'ACTIVE' ? 'ACTIVE' : 'CLOSED'} />{d.reviewOverdue && <StatusPill status="OVERDUE" label="Review overdue" />}{d.family.sharedAt && <span className="ops-muted">Shared {fmtDate(d.family.sharedAt)}{d.family.acknowledgedAt ? `, read by family ${fmtDate(d.family.acknowledgedAt)}` : ''}</span>}{d.referral?.referred && <StatusPill status="IN_REVIEW" label="Referred to safeguarding" />}</div>
          <p>{d.summary}</p>
          <KeyValues rows={[['Next review', fmtDate(d.nextReviewOn)], ['Opened from', d.source.kind === 'RISK_SIGNAL' ? `Risk signal: ${humanize(d.source.riskType)} (${humanize(d.source.riskLevel)})` : 'Staff judgement'], ['Family comment', d.family.comment ?? undefined], ['Outcome', d.closure.outcome ? `${humanize(d.closure.outcome)}: ${d.closure.note ?? ''}` : undefined]]} />
          {!!(d.source.figures.length || d.signalsNow?.length) && (
            <div className="ops-callout"><b>Evidence:</b> {d.source.figures.map((x) => `${x.label}: ${x.value}`).join(' · ') || 'none recorded'}{d.signalsNow?.length ? <> <br /><b>Now:</b> {d.signalsNow.map((x) => `${x.label}: ${x.value}`).join(' · ')}</> : null}</div>
          )}
          <SectionCard title="Goals" actions={active && <Button small variant="soft" onClick={() => setDialog('goal')}>+ Goal</Button>}>
            <ul className="ops-list">{d.goals.map((g) => (<div key={g.id}><GoalLine g={g} />{active && <div className="sp-row-actions"><Button small variant="ghost" onClick={() => { setDialog({ progress: g.id }); setF({}); }}>Record progress</Button></div>}</div>))}</ul>
          </SectionCard>
          <SectionCard title="Actions" actions={active && <Button small variant="soft" onClick={() => setDialog('action')}>+ Action</Button>}>
            {!d.actions.length ? <p className="ops-muted">No actions yet.</p> : <ul className="ops-list">{d.actions.map((a) => (
              <li key={a.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{a.title}</div><div className="ops-row-sub">{humanize(a.ownerKind)}{a.ownerName ? ` · ${a.ownerName}` : ''}{a.dueOn ? ` · due ${fmtDate(a.dueOn)}` : ''}</div></div>
                <StatusPill status={a.status === 'OPEN' ? (a.overdue ? 'OVERDUE' : 'OPEN') : a.status === 'DONE' ? 'DONE' : 'CANCELLED'} />
                {active && a.status === 'OPEN' && <Button small variant="ghost" disabled={busy} onClick={() => void run(async () => { await supportApi.completeAction(id, a.id); await after('Action done'); })}>Done</Button>}
              </li>))}</ul>}
          </SectionCard>
          <SectionCard title="Reviews">{!d.reviews.length ? <p className="ops-muted">No reviews yet.</p> : <ul className="ops-list">{d.reviews.map((r) => <li key={r.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{fmtDate(r.at)} · {r.byName}</div><div className="ops-row-sub">For the family: {r.familySummary}{r.internalNote ? ` · Internal: ${r.internalNote}` : ''}{r.nextReviewOn ? ` · next ${fmtDate(r.nextReviewOn)}` : ''}</div></div></li>)}</ul>}</SectionCard>
          <SectionCard title="Internal notes" sub="Staff only. Never shown to the family." actions={<Button small variant="soft" onClick={() => setDialog('note')}>+ Note</Button>}>{!d.internalNotes?.length ? <p className="ops-muted">None.</p> : <ul className="ops-list">{d.internalNotes.map((n, i) => <li key={i} className="ops-row"><div className="ops-row-main"><div className="ops-row-sub">{fmtDate(n.at)} · {n.byName}: {n.text}</div></div></li>)}</ul>}</SectionCard>
          <SectionCard title="History"><Timeline items={d.history as never} /></SectionCard>
        </div>
      )}</Loadable>
      {dialog && (
        <Modal title={typeof dialog === 'object' ? 'Record progress' : { goal: 'Add a goal', action: 'Add an action', review: 'Record a progress review', note: 'Internal note', close: 'Close the plan' }[dialog]} onClose={() => setDialog(null)} footer={<><Button variant="soft" onClick={() => setDialog(null)}>Cancel</Button><Button disabled={busy} onClick={() => void run(async () => {
          if (typeof dialog === 'object') { await supportApi.progress(id, dialog.progress, { value: f.value === '' || f.value === undefined ? null : Number(f.value), note: f.note, status: f.status || undefined }); return after('Progress recorded'); }
          if (dialog === 'goal') { await supportApi.addGoal(id, { title: f.title, measure: f.measure, unit: f.unit, baseline: f.baseline, target: f.target, reviewOn: f.reviewOn || inDays(28) }); return after('Goal added'); }
          if (dialog === 'action') { await supportApi.addAction(id, { title: f.title, ownerKind: f.ownerKind || 'FAMILY', ownerName: f.ownerName, dueOn: f.dueOn || null }); return after('Action added'); }
          if (dialog === 'review') { await supportApi.review(id, { familySummary: f.familySummary, internalNote: f.internalNote, nextReviewOn: f.nextReviewOn || null, goalStatuses: (state.data?.goals ?? []).filter((g) => f[`g:${g.id}`]).map((g) => ({ goalId: g.id, status: f[`g:${g.id}`] })) }); return after('Review recorded'); }
          if (dialog === 'note') { await supportApi.addNote(id, f.text ?? ''); return after('Note added'); }
          await supportApi.close(id, { outcome: f.outcome || 'GOALS_MET', note: f.note }); return after('Plan closed');
        })}>Save</Button></>}>
          {typeof dialog === 'object' && (<div className="ops-form-grid">
            <Field label="Value now"><input className="input" inputMode="decimal" value={f.value ?? ''} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>
            <Field label="Status (optional)"><select className="input" value={f.status ?? ''} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Work it out from the target</option>{GOAL_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select></Field>
            <Field label="Note"><input className="input" value={f.note ?? ''} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
          </div>)}
          {dialog === 'goal' && (<div className="ops-form-grid">
            {[['title', 'Goal'], ['measure', 'How it is measured'], ['unit', 'Unit'], ['baseline', 'Now (baseline)'], ['target', 'Target']].map(([k, l]) => <Field key={k} label={l} required={['title', 'measure', 'target'].includes(k)}><input className="input" value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}
            <Field label="Review on" required><input className="input" type="date" value={f.reviewOn ?? inDays(28)} onChange={(e) => setF({ ...f, reviewOn: e.target.value })} /></Field>
          </div>)}
          {dialog === 'action' && (<div className="ops-form-grid">
            <Field label="Action" required><input className="input" value={f.title ?? ''} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
            <Field label="Who does it"><select className="input" value={f.ownerKind ?? 'FAMILY'} onChange={(e) => setF({ ...f, ownerKind: e.target.value })}><option value="FAMILY">The family</option><option value="STUDENT">The student</option></select></Field>
            <Field label="Due"><input className="input" type="date" value={f.dueOn ?? ''} onChange={(e) => setF({ ...f, dueOn: e.target.value })} /></Field>
            <DataNote>Staff actions are added when the plan is opened or by the plan owner with a named colleague through the API; each becomes a task for its owner.</DataNote>
          </div>)}
          {dialog === 'review' && (<>
            <Field label="Summary for the family" required><textarea className="input" rows={3} value={f.familySummary ?? ''} onChange={(e) => setF({ ...f, familySummary: e.target.value })} style={{ width: '100%' }} /></Field>
            <Field label="Internal note (staff only)"><textarea className="input" rows={2} value={f.internalNote ?? ''} onChange={(e) => setF({ ...f, internalNote: e.target.value })} style={{ width: '100%' }} /></Field>
            {(state.data?.goals ?? []).map((g) => <Field key={g.id} label={`Goal: ${g.title}`}><select className="input" value={f[`g:${g.id}`] ?? ''} onChange={(e) => setF({ ...f, [`g:${g.id}`]: e.target.value })}><option value="">Unchanged ({humanize(g.status)})</option>{GOAL_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select></Field>)}
            <Field label="Next review"><input className="input" type="date" value={f.nextReviewOn ?? ''} onChange={(e) => setF({ ...f, nextReviewOn: e.target.value })} /></Field>
          </>)}
          {dialog === 'note' && <Field label="Note (no clinical details)" required><textarea className="input" rows={3} value={f.text ?? ''} onChange={(e) => setF({ ...f, text: e.target.value })} style={{ width: '100%' }} /></Field>}
          {dialog === 'close' && (<>
            <Field label="Outcome" required><select className="input" value={f.outcome ?? 'GOALS_MET'} onChange={(e) => setF({ ...f, outcome: e.target.value })}>{PLAN_OUTCOMES.map((o) => <option key={o} value={o}>{humanize(o)}</option>)}</select></Field>
            <Field label="What changed, and why the plan is closing" required><textarea className="input" rows={3} value={f.note ?? ''} onChange={(e) => setF({ ...f, note: e.target.value })} style={{ width: '100%' }} /></Field>
          </>)}
          <ErrorNote error={error} />
        </Modal>
      )}
    </Drawer>
  );
}

function StaffPlans() {
  const [tab, setTab] = useState<'ACTIVE' | 'CLOSED' | 'suggest'>('ACTIVE');
  const list = useLoad(() => supportApi.list({ status: tab === 'CLOSED' ? 'CLOSED' : 'ACTIVE' }), [tab]);
  const sug = useLoad(() => (tab === 'suggest' ? supportApi.suggestions() : Promise.resolve(null)), [tab]);
  const [selected, setSelected] = useState<string | null>(useQueryParam('id'));
  const [creating, setCreating] = useState<PlanSuggestion | null | false>(false);
  const { run, busy } = useAction();
  const s = list.data?.summary;
  return (
    <div className="ops-stack">
      {s && <div className="kpi-grid"><Tile label="Active plans" value={s.active} /><Tile label="Reviews overdue" value={s.reviewOverdue} tone={s.reviewOverdue ? 'bad' : 'good'} />{CONCERN_AREAS.map((a) => <Tile key={a.key} label={a.label} value={s.byArea[a.key] ?? 0} />)}</div>}
      <div className="ops-inline"><Tabs tabs={[{ key: 'ACTIVE', label: 'Active' }, { key: 'suggest', label: 'From risk signals' }, { key: 'CLOSED', label: 'Closed' }]} value={tab} onChange={setTab} /><Button onClick={() => setCreating(null)}>+ Open a plan</Button></div>
      {tab === 'suggest' ? (
        <Loadable state={sug}>{(d) => d && (
          <SectionCard title="Students the risk signals flag" sub={d.note} actions={<Button small variant="soft" disabled={busy} onClick={() => void run(async () => { sug.setData(await supportApi.suggestions(true)); })}>Re-check signals</Button>}>
            {!d.items.length ? <p className="ops-muted">No attendance or academic signals without a plan.</p> : <ul className="ops-list">{d.items.map((x) => (
              <li key={`${x.studentId}-${x.riskType}`} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{x.studentName} · {x.className}</div><div className="ops-row-sub">{x.evidence?.label ?? humanize(x.riskType)}</div></div><StatusPill status={x.level === 'HIGH' ? 'OVERDUE' : 'PENDING'} label={humanize(x.level)} /><Button small variant="soft" onClick={() => setCreating(x)}>Open plan</Button></li>
            ))}</ul>}
          </SectionCard>
        )}</Loadable>
      ) : (
        <Loadable state={list}>{(d) => !d.items.length ? <EmptyState title={tab === 'ACTIVE' ? 'No active plans' : 'No closed plans'} sub="Open a plan from the risk signals or for any student you teach." /> : (
          <SectionCard title={`${d.items.length} plan(s)`}>
            <ul className="ops-list">{d.items.map((p) => (
              <li key={p.id} className="ops-row"><div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => setSelected(p.id)}>
                <div className="ops-row-title">{p.studentName} · {p.areaLabel}</div>
                <div className="ops-row-sub">{p.refNo} · {p.className} · {p.goals.length} goal(s) · {p.ownerName}{p.nextReviewOn ? ` · review ${fmtDate(p.nextReviewOn)}` : ''}</div>
              </button></div>{p.reviewOverdue ? <StatusPill status="OVERDUE" label="Review overdue" /> : <StatusPill status={p.status === 'ACTIVE' ? 'ACTIVE' : 'CLOSED'} />}</li>
            ))}</ul>
          </SectionCard>
        )}</Loadable>
      )}
      <DataNote>Safeguarding concerns are reported on the Safeguarding page. A plan only records that a referral was made, and only authorised staff can see that.</DataNote>
      {creating !== false && <NewPlan preset={creating} onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); setSelected(id); void list.reload(); }} />}
      {selected && <PlanDrawer id={selected} onClose={() => setSelected(null)} onChanged={() => void list.reload()} />}
    </div>
  );
}

export function SupportPlansView() {
  const { me } = useAuth();
  return FAMILY.includes(me?.profile?.role ?? '') ? <FamilyPlans /> : <StaffPlans />;
}
