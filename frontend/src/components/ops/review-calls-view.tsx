'use client';
import { useState } from 'react';
import { Button, EmptyState, Field, Modal, useToast } from '@/components/ui';
import { usePermissions } from '@/lib/permissions';
import { usePortalHref } from '@/lib/school-path';
import { conversationsApi, reviewApi, CALL_CHANNELS, REVIEW_REASONS, type ReviewCase } from '@/lib/ptm-api';
import { Drawer } from './drawer';
import { BriefingPanel } from './ptm-view';
import {
  DataNote, ErrorNote, Loadable, PromptModal, SectionCard, StatusPill, Tabs, Tile, Timeline, fmtDate, fmtDateTime, humanize, isoDay, useAction, useLoad, useQueryParam,
} from './kit';

/**
 * Parent review calls: open a case for a pupil, schedule the call, log each
 * attempt, keep private notes, agree actions (they become tasks) and close it.
 * Notes are visible only to the assigned person, the class teacher and the
 * principal/administration.
 */

const STATUS_PILL: Record<string, string> = { OPEN: 'OPEN', SCHEDULED: 'SCHEDULED', IN_PROGRESS: 'IN_PROGRESS', CLOSED: 'CLOSED' };

function NewCase({ onClose, onDone }: { onClose: () => void; onDone: (c: ReviewCase) => void }) {
  const { permissions } = usePermissions();
  const pupils = useLoad(() => conversationsApi.contacts(), []);
  const [f, setF] = useState({ studentId: '', reason: 'ATTENDANCE', priority: 'NORMAL', summary: '', nextFollowUpOn: isoDay(new Date(Date.now() + 3 * 86_400_000)), language: '' });
  const { run, busy, error } = useAction();
  const reasons = REVIEW_REASONS.filter((r) => r !== 'FEES' || permissions['fees.read']);
  return (
    <Modal title="Open a review call" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.studentId} onClick={() => void run(async () => {
      onDone(await reviewApi.create({ studentId: f.studentId, reason: f.reason, priority: f.priority, summary: f.summary || undefined, nextFollowUpOn: f.nextFollowUpOn || undefined, contactPreferences: { language: f.language || null } }));
    })}>Open case</Button></>}>
      <Loadable state={pupils}>{(c) => c.kind === 'STAFF' ? (
        <Field label="Pupil" required><select className="input" value={f.studentId} onChange={(e) => setF({ ...f, studentId: e.target.value })}><option value="">Choose…</option>{c.pupils.map((p) => <option key={p.studentId} value={p.studentId}>{p.name} · {p.className}</option>)}</select></Field>
      ) : <p className="ops-muted">Only staff open review calls.</p>}</Loadable>
      <div className="ops-grid-2">
        <Field label="Reason"><select className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>{reasons.map((r) => <option key={r} value={r}>{humanize(r)}</option>)}</select></Field>
        <Field label="Priority"><select className="input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => <option key={p} value={p}>{humanize(p)}</option>)}</select></Field>
        <Field label="Follow up by"><input className="input" type="date" value={f.nextFollowUpOn} onChange={(e) => setF({ ...f, nextFollowUpOn: e.target.value })} /></Field>
        <Field label="Family's language"><input className="input" value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })} placeholder="Optional" /></Field>
      </div>
      <Field label="What prompted it" hint="Facts, briefly. Safeguarding concerns go to the safeguarding module, not here."><textarea className="input" rows={3} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></Field>
      <ErrorNote error={error} />
    </Modal>
  );
}

function CaseDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const link = usePortalHref();
  const c = useLoad(() => reviewApi.get(id), [id]);
  const [tab, setTab] = useState<'work' | 'briefing' | 'history'>('work');
  const brief = useLoad(() => (tab === 'briefing' ? reviewApi.briefing(id) : Promise.resolve(null)), [id, tab]);
  const [attempt, setAttempt] = useState({ channel: 'PHONE', reached: 'false', note: '' });
  const [note, setNote] = useState({ kind: 'DISCUSSION', text: '' });
  const [action, setAction] = useState({ title: '', ownerType: 'STAFF', dueOn: isoDay(new Date(Date.now() + 7 * 86_400_000)) });
  const [sched, setSched] = useState('');
  const [closing, setClosing] = useState<null | { outcome: string; note: string }>(null);
  const [reopen, setReopen] = useState(false);
  const { run, busy, error } = useAction();
  const toast = useToast();
  const after = async (msg: string) => { await c.reload(); onChanged(); toast(msg, 'success'); };
  const d = c.data;
  return (
    <Drawer title={d ? `${d.studentName} · ${humanize(d.reason)}` : 'Review call'} sub={d ? `${d.refNo} · ${d.className ?? ''} · assigned to ${d.assignedName ?? '—'}` : undefined} onClose={onClose} footer={d && (
      d.status === 'CLOSED' ? <Button variant="soft" onClick={() => setReopen(true)}>Reopen</Button> : <Button onClick={() => setClosing({ outcome: 'RESOLVED', note: '' })}>Close case</Button>
    )}>
      <Loadable state={c}>{(x) => (
        <div className="ops-stack">
          <div className="ops-inline"><StatusPill status={STATUS_PILL[x.status]} label={humanize(x.status)} /><StatusPill status={x.priority === 'URGENT' || x.priority === 'HIGH' ? 'OVERDUE' : 'DRAFT'} label={`${humanize(x.priority)} priority`} />{x.followUpOverdue && <StatusPill status="OVERDUE" label="Follow-up overdue" />}</div>
          {x.summary && <p>{x.summary}</p>}
          <Tabs tabs={[{ key: 'work', label: 'Calls & actions' }, { key: 'briefing', label: 'Child briefing' }, { key: 'history', label: 'History' }]} value={tab} onChange={setTab} />
          {tab === 'work' && (
            <>
              {x.suggestion && <p className="ops-callout is-warn">{x.suggestion.text}</p>}
              {x.status !== 'CLOSED' && (
                <SectionCard title="Schedule the call" sub={x.scheduledAt ? `Scheduled ${fmtDateTime(x.scheduledAt)} by ${humanize(x.scheduledChannel)}` : 'Not scheduled'}>
                  <div className="ops-inline"><input className="input" type="datetime-local" value={sched} onChange={(e) => setSched(e.target.value)} aria-label="When" /><Button small disabled={!sched || busy} onClick={() => void run(async () => { await reviewApi.schedule(id, { scheduledAt: new Date(sched).toISOString(), channel: attempt.channel }); await after('Scheduled'); })}>Schedule</Button></div>
                </SectionCard>
              )}
              <SectionCard title={`Attempts (${x.attemptsCount})`}>
                <ul className="ops-list">{(x.attempts ?? []).map((a, i) => <li key={i} className="ops-row"><div className="ops-row-main">{fmtDateTime(a.at)} · {humanize(a.channel)}{a.note ? ` · ${a.note}` : ''}<div className="ops-row-sub">{a.byName}</div></div><StatusPill status={a.reached ? 'DONE' : 'FAILED'} label={a.reached ? 'Reached' : 'Not reached'} /></li>)}</ul>
                {x.status !== 'CLOSED' && (
                  <div className="ops-grid-2">
                    <Field label="Channel"><select className="input" value={attempt.channel} onChange={(e) => setAttempt({ ...attempt, channel: e.target.value })}>{CALL_CHANNELS.map((ch) => <option key={ch} value={ch}>{humanize(ch)}</option>)}</select></Field>
                    <Field label="Outcome"><select className="input" value={attempt.reached} onChange={(e) => setAttempt({ ...attempt, reached: e.target.value })}><option value="false">Not reached</option><option value="true">Reached</option></select></Field>
                    <Field label="Note"><input className="input" value={attempt.note} onChange={(e) => setAttempt({ ...attempt, note: e.target.value })} placeholder="Optional" /></Field>
                    <div><Button disabled={busy} onClick={() => void run(async () => { await reviewApi.attempt(id, { channel: attempt.channel, reached: attempt.reached === 'true', note: attempt.note || undefined }); setAttempt({ ...attempt, note: '' }); await after('Attempt logged'); })}>Log attempt</Button></div>
                  </div>
                )}
              </SectionCard>
              <SectionCard title="Private notes" sub="Seen by the assigned person, the class teacher and the principal only. Calls are never recorded.">
                {(x.notes ?? []).map((n, i) => <p key={i}><b>{humanize(n.kind)}</b> · {fmtDateTime(n.at)} · {n.byName}<br />{n.text}</p>)}
                {x.status !== 'CLOSED' && <div className="ops-stack">
                  <select className="input" value={note.kind} onChange={(e) => setNote({ ...note, kind: e.target.value })} aria-label="Kind of note">{['CONTEXT', 'DISCUSSION', 'PARENT_VIEW', 'AGREEMENT', 'OTHER'].map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select>
                  <textarea className="input" rows={3} value={note.text} onChange={(e) => setNote({ ...note, text: e.target.value })} aria-label="Note" />
                  <div className="ops-inline"><Button small disabled={!note.text.trim() || busy} onClick={() => void run(async () => { await reviewApi.note(id, note); setNote({ ...note, text: '' }); await after('Note added'); })}>Add note</Button><a href={link('/safeguarding')} className="ops-muted">Safeguarding concern? Report it here instead.</a></div>
                </div>}
              </SectionCard>
              <SectionCard title="Agreed actions" sub="Staff actions are tasks with reminders; overdue ones escalate.">
                <ul className="ops-list">{x.actions.map((a) => <li key={a.id} className="ops-row"><div className="ops-row-main">{a.title}<div className="ops-row-sub">{a.ownerName} · due {fmtDate(a.dueOn)}</div></div><StatusPill status={a.overdue ? 'OVERDUE' : a.status} />{a.status === 'OPEN' && <Button small variant="soft" onClick={() => void run(async () => { await reviewApi.completeAction(id, a.id); await after('Action done'); })}>Done</Button>}</li>)}</ul>
                {x.status !== 'CLOSED' && <div className="ops-grid-2">
                  <Field label="Action"><input className="input" value={action.title} onChange={(e) => setAction({ ...action, title: e.target.value })} /></Field>
                  <Field label="Owner"><select className="input" value={action.ownerType} onChange={(e) => setAction({ ...action, ownerType: e.target.value })}><option value="STAFF">Me</option><option value="PARENT">Parent</option></select></Field>
                  <Field label="Due"><input className="input" type="date" value={action.dueOn} onChange={(e) => setAction({ ...action, dueOn: e.target.value })} /></Field>
                  <div><Button disabled={!action.title.trim() || busy} onClick={() => void run(async () => { await reviewApi.action(id, action); setAction({ ...action, title: '' }); await after('Action agreed'); })}>Add action</Button></div>
                </div>}
              </SectionCard>
              {x.status !== 'CLOSED' && <SectionCard title="Next follow-up"><div className="ops-inline"><input className="input" type="date" defaultValue={x.nextFollowUpOn?.slice(0, 10) ?? ''} onChange={(e) => void run(async () => { await reviewApi.update(id, { nextFollowUpOn: e.target.value || null }); await after('Follow-up saved'); })} aria-label="Next follow-up" /></div></SectionCard>}
              {x.closedAt && <p className="ops-callout">Closed {fmtDate(x.closedAt)}: {humanize(x.outcome)}. {x.closureNote}</p>}
            </>
          )}
          {tab === 'briefing' && <Loadable state={brief}>{(b) => (b ? <BriefingPanel b={b} /> : null)}</Loadable>}
          {tab === 'history' && <Timeline items={x.history} />}
          <ErrorNote error={error} />
        </div>
      )}</Loadable>
      {closing && (
        <Modal title="Close this case" onClose={() => setClosing(null)} footer={<><Button variant="ghost" onClick={() => setClosing(null)}>Cancel</Button><Button disabled={!closing.note.trim() || busy} onClick={() => void run(async () => { await reviewApi.close(id, closing); setClosing(null); await after('Case closed'); })}>Close case</Button></>}>
          <Field label="Outcome"><select className="input" value={closing.outcome} onChange={(e) => setClosing({ ...closing, outcome: e.target.value })}>{['RESOLVED', 'IMPROVING', 'REFERRED', 'NO_CONTACT', 'OTHER'].map((o) => <option key={o} value={o}>{humanize(o)}</option>)}</select></Field>
          <Field label="Closing note" required><textarea className="input" rows={3} value={closing.note} onChange={(e) => setClosing({ ...closing, note: e.target.value })} /></Field>
        </Modal>
      )}
      {reopen && <PromptModal title="Reopen this case" label="Why?" onClose={() => setReopen(false)} onSubmit={async (v) => { await reviewApi.reopen(id, v); await after('Reopened'); }} />}
    </Drawer>
  );
}

export function ReviewCallsView() {
  const { permissions } = usePermissions();
  const all = permissions['reviewcalls.manage'] === 'ALL';
  const [tab, setTab] = useState<'open' | 'mine' | 'closed'>('open');
  const [open, setOpen] = useState<string | null>(useQueryParam('id'));
  const [creating, setCreating] = useState(false);
  const list = useLoad(() => reviewApi.list(tab === 'closed' ? { status: 'CLOSED' } : tab === 'mine' ? { mine: true } : {}), [tab]);
  const metrics = useLoad(() => reviewApi.metrics({}), []);
  const reload = () => { void list.reload(); void metrics.reload(); };
  return (
    <div className="ops-stack">
      <Loadable state={metrics}>{(m) => (
        <>
          <div className="kpi-grid">
            <Tile label="Open cases" value={m.openCases} />
            <Tile label="Overdue actions" value={m.overdueActions} tone={m.overdueActions ? 'bad' : 'good'} href="/tasks" />
            <Tile label="Follow-ups overdue" value={m.followUpsOverdue} tone={m.followUpsOverdue ? 'warn' : 'neutral'} />
            <Tile label={`Not reached after ${m.notReachedThreshold} tries`} value={m.familiesNotReached.length} tone={m.familiesNotReached.length ? 'warn' : 'neutral'} />
            <Tile label="Resolved or improving (90 days)" value={`${m.resolvedLast90Days} of ${m.closedLast90Days}`} />
          </div>
          {m.familiesNotReached.length > 0 && <SectionCard title="Families to try another way">{m.familiesNotReached.map((f) => <p key={f.id}><button type="button" className="ops-row-link" onClick={() => setOpen(f.id)}><b>{f.studentName}</b> ({f.refNo})</button>: {f.text}</p>)}</SectionCard>}
          <DataNote>{m.definition}</DataNote>
        </>
      )}</Loadable>
      <div className="ops-inline"><Tabs tabs={[{ key: 'open', label: all ? 'Open' : 'My cases' }, ...(all ? [{ key: 'mine' as const, label: 'Assigned to me' }] : []), { key: 'closed', label: 'Closed' }]} value={tab} onChange={setTab} /><Button onClick={() => setCreating(true)}>Open a review call</Button></div>
      <Loadable state={list}>{(d) => !d.items.length ? <EmptyState title="No review calls" sub="Open one when a family needs a call about attendance, progress or well-being." /> : (
        <ul className="ops-list card card-pad">{d.items.map((c) => (
          <li key={c.id} className="ops-row">
            <div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => setOpen(c.id)}><div className="ops-row-title">{c.studentName} · {humanize(c.reason)}</div><div className="ops-row-sub">{c.refNo} · {c.className} · {c.assignedName} · {c.attemptsCount} attempt(s){c.nextFollowUpOn ? ` · follow up ${fmtDate(c.nextFollowUpOn)}` : ''}</div></button></div>
            {c.overdueActions > 0 && <StatusPill status="OVERDUE" label={`${c.overdueActions} overdue`} />}
            <StatusPill status={STATUS_PILL[c.status]} label={humanize(c.status)} />
          </li>
        ))}</ul>
      )}</Loadable>
      {creating && <NewCase onClose={() => setCreating(false)} onDone={(c) => { setCreating(false); reload(); setOpen(c.id); }} />}
      {open && <CaseDrawer id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}
