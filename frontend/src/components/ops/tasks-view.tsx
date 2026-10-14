'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Button, EmptyState, Field, Modal, Select, useToast } from '@/components/ui';
import { analyticsApi, TASK_CATEGORIES, TASK_DEPARTMENTS, type TaskDto, type TaskSummaryDto } from '@/lib/analytics-api';
import { opsApi } from '@/lib/ops-api';
import { usePermissions } from '@/lib/permissions';
import { usePortalPage } from '@/lib/school-path';
import { AttachUpload } from './attach';
import { Attachments, DataNote, ErrorNote, Loadable, PromptModal, SectionCard, StatusPill, Tabs, Tile, Timeline, fmtDate, humanize, isoDay, money, rupeesToPaise, useAction, useLoad, useQueryParam } from './kit';

/**
 * My Tasks: everything due — bills, renewals, services, inspections and
 * follow-ups — with its owner, due date and what was done about it. The
 * server decides what each person sees: at OWN scope only items you own or
 * are the delegate for; at ALL scope the whole school.
 */
type View = 'mine' | 'department' | 'all' | 'exceptions';

const opts = (list: string[]) => list.map((v) => ({ value: v, label: humanize(v) }));

function SummaryTiles({ s }: { s: TaskSummaryDto }) {
  return (
    <div className="kpi-grid">
      <Tile label="Overdue" value={s.total.overdue} tone={s.total.overdue ? 'bad' : 'good'} />
      <Tile label="Due this week" value={s.total.week} tone={s.total.week ? 'warn' : 'neutral'} />
      <Tile label="Due this month" value={s.total.month} />
      <Tile label="Forecast cost, next 90 days" value={money(s.total.quarterCostPaise)} />
    </div>
  );
}

function TaskRow({ t, canAll, onChanged }: { t: TaskDto; canAll: boolean; onChanged: () => void }) {
  const page = usePortalPage();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<null | 'snooze' | 'complete' | 'reassign' | 'cancel'>(null);
  const { run, busy, error } = useAction();
  const closed = t.status === 'DONE' || t.status === 'CANCELLED';
  const done = (msg: string) => { toast(msg); onChanged(); };
  const source = page(t.source?.link ?? null);
  return (
    <li className={`tk-row${t.overdue ? ' is-overdue' : ''}`}>
      <div className="tk-main">
        <button type="button" className="tk-title" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{t.title}</button>
        <div className="tk-meta">
          <StatusPill status={t.overdue ? 'OVERDUE' : t.status} label={t.overdue ? 'Overdue' : undefined} />
          {t.severity !== 'NORMAL' && <StatusPill status={t.severity === 'CRITICAL' || t.severity === 'HIGH' ? 'REJECTED' : 'DRAFT'} label={humanize(t.severity)} />}
          <span>{humanize(t.department)} · {humanize(t.category)}</span>
          <span>Due {fmtDate(t.dueAt)}{!closed && (t.daysLeft >= 0 ? ` (in ${t.daysLeft} day${t.daysLeft === 1 ? '' : 's'})` : ` (${-t.daysLeft} day${t.daysLeft === -1 ? '' : 's'} late)`)}</span>
          <span>Owner: {t.ownerName ?? 'Unassigned'}{t.delegateName ? ` · delegate ${t.delegateName}` : ''}</span>
          {t.amountPaise !== null && <span>{money(t.amountPaise)}</span>}
        </div>
      </div>
      {!closed && (
        <div className="tk-actions">
          {t.status === 'OPEN' && <Button small variant="soft" disabled={busy} onClick={() => void run(async () => { await analyticsApi.acknowledgeTask(t.id); done('Acknowledged'); })}>Acknowledge</Button>}
          <Button small variant="soft" onClick={() => setModal('snooze')}>Snooze</Button>
          <Button small onClick={() => setModal('complete')}>Complete</Button>
          {canAll && <Button small variant="soft" onClick={() => setModal('reassign')}>Reassign</Button>}
          <Button small variant="soft" onClick={() => setModal('cancel')}>Cancel</Button>
        </div>
      )}
      <ErrorNote error={error} />
      {open && (
        <div className="tk-detail">
          {t.description && <p>{t.description}</p>}
          {t.snoozeReason && <p className="ops-muted">Snoozed: {t.snoozeReason}{t.snoozedUntil ? ` (until ${fmtDate(t.snoozedUntil)})` : ''}</p>}
          {source && <p><Link href={source}>Open the record <span aria-hidden="true">→</span></Link></p>}
          <div><b>Evidence:</b> <Attachments items={t.evidence} /></div>
          <Timeline items={t.history} />
        </div>
      )}
      {modal === 'snooze' && <SnoozeModal t={t} onClose={() => setModal(null)} onDone={() => done('Snoozed')} />}
      {modal === 'complete' && <CompleteModal t={t} onClose={() => setModal(null)} onDone={() => done('Completed')} />}
      {modal === 'reassign' && <ReassignModal t={t} onClose={() => setModal(null)} onDone={() => done('Reassigned')} />}
      {modal === 'cancel' && <PromptModal title="Cancel this task" label="Reason" danger confirmLabel="Cancel task" onClose={() => setModal(null)} onSubmit={async (reason) => { await analyticsApi.cancelTask(t.id, reason); done('Cancelled'); }} />}
    </li>
  );
}

function SnoozeModal({ t, onClose, onDone }: { t: TaskDto; onClose: () => void; onDone: () => void }) {
  const tomorrow = isoDay(new Date(Date.now() + 86_400_000));
  const [until, setUntil] = useState(tomorrow);
  const [reason, setReason] = useState('');
  const { run, busy, error } = useAction();
  return (
    <Modal title="Snooze" onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Back</Button>
      <Button disabled={busy || !reason.trim() || !until} onClick={() => void run(async () => { await analyticsApi.snoozeTask(t.id, `${until}T09:00:00+05:30`, reason.trim()); onDone(); onClose(); })}>Snooze</Button>
    </>}>
      <Field label="Until" hint={t.severity === 'CRITICAL' ? 'A critical task can be put off by a day at most.' : 'At most 30 days.'}><input className="input" type="date" min={tomorrow} value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
      <Field label="Reason" required><textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <ErrorNote error={error} />
    </Modal>
  );
}

function CompleteModal({ t, onClose, onDone }: { t: TaskDto; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [evidence, setEvidence] = useState<Array<{ name: string; url: string }>>([]);
  const { run, busy, error } = useAction();
  const blocked = t.requiresEvidence && !evidence.length && !note.trim();
  return (
    <Modal title="Complete" onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Back</Button>
      <Button disabled={busy || blocked} onClick={() => void run(async () => { await analyticsApi.completeTask(t.id, note.trim(), evidence); onDone(); onClose(); })}>Mark complete</Button>
    </>}>
      <Field label="What was done" required={t.requiresEvidence} hint={t.requiresEvidence ? 'This task needs evidence: attach it or describe it.' : undefined}><textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <AttachUpload label="Attach evidence (receipt, certificate, photo)" onUploaded={(a) => setEvidence((list) => [...list, { name: a.name, url: a.url }])} />
      {evidence.length > 0 && <ul className="ops-attachments">{evidence.map((e) => <li key={e.url}>📎 {e.name}</li>)}</ul>}
      <ErrorNote error={error} />
    </Modal>
  );
}

function ReassignModal({ t, onClose, onDone }: { t: TaskDto; onClose: () => void; onDone: () => void }) {
  const staff = useLoad(() => opsApi.orgStaff(), []);
  const [owner, setOwner] = useState('');
  const [note, setNote] = useState('');
  const { run, busy, error } = useAction();
  return (
    <Modal title="Reassign" onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Back</Button>
      <Button disabled={busy || !owner} onClick={() => void run(async () => { await analyticsApi.reassignTask(t.id, owner, note.trim() || undefined); onDone(); onClose(); })}>Reassign</Button>
    </>}>
      <Loadable state={staff}>{(list) => (
        <Select label="New owner" value={owner} onChange={setOwner} placeholder="Choose a person" options={list.filter((p) => p.profileId !== t.ownerProfileId).map((p) => ({ value: p.profileId, label: `${p.name}${p.roleKey ? ` (${humanize(p.roleKey)})` : ''}` }))} />
      )}</Loadable>
      <Field label="Note"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <ErrorNote error={error} />
    </Modal>
  );
}

function AddTask({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ title: '', department: 'ADMINISTRATION', category: 'OTHER', severity: 'NORMAL', dueAt: isoDay(new Date(Date.now() + 7 * 86_400_000)), amount: '', description: '', recurrence: '', requiresEvidence: false });
  const { run, busy, error } = useAction();
  const set = (patch: Partial<typeof f>) => setF((cur) => ({ ...cur, ...patch }));
  const submit = () => run(async () => {
    await analyticsApi.createTask({
      title: f.title.trim(), department: f.department, category: f.category, severity: f.severity, dueAt: `${f.dueAt}T09:00:00+05:30`,
      description: f.description.trim() || undefined, amountPaise: f.amount ? rupeesToPaise(f.amount) : undefined,
      recurrence: f.recurrence ? { unit: f.recurrence, every: 1 } : undefined, requiresEvidence: f.requiresEvidence,
    });
    onDone(); onClose();
  });
  return (
    <Modal title="Add a task" onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || !f.title.trim() || !f.dueAt} onClick={() => void submit()}>{busy ? 'Adding…' : 'Add task'}</Button>
    </>}>
      <Field label="What is due" required><input className="input" value={f.title} onChange={(e) => set({ title: e.target.value })} /></Field>
      <div className="tk-form-grid">
        <Select label="Department" value={f.department} onChange={(v) => set({ department: v })} options={opts(TASK_DEPARTMENTS)} />
        <Select label="Kind" value={f.category} onChange={(v) => set({ category: v })} options={opts(TASK_CATEGORIES)} />
        <Select label="Severity" value={f.severity} onChange={(v) => set({ severity: v })} options={opts(['LOW', 'NORMAL', 'HIGH', 'CRITICAL'])} />
        <Field label="Due on" required><input className="input" type="date" value={f.dueAt} onChange={(e) => set({ dueAt: e.target.value })} /></Field>
        <Field label="Expected cost (₹)"><input className="input" inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} /></Field>
        <Select label="Repeats" value={f.recurrence} onChange={(v) => set({ recurrence: v })} placeholder="Does not repeat" options={opts(['WEEK', 'MONTH', 'YEAR']).map((o) => ({ ...o, label: `Every ${o.label.toLowerCase()}` }))} />
      </div>
      <Field label="Details"><textarea className="input" rows={3} value={f.description} onChange={(e) => set({ description: e.target.value })} /></Field>
      <label className="tk-check"><input type="checkbox" checked={f.requiresEvidence} onChange={(e) => set({ requiresEvidence: e.target.checked })} /> Evidence is needed to close it</label>
      <ErrorNote error={error} />
    </Modal>
  );
}

export function TasksView() {
  const { permissions } = usePermissions();
  const canAll = permissions['tasks.read'] === 'ALL';
  const canManage = Boolean(permissions['tasks.manage']);
  const initialView = useQueryParam('view') as View | null;
  const [view, setView] = useState<View>(initialView && ['mine', 'department', 'all', 'exceptions'].includes(initialView) ? initialView : 'mine');
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState('open');
  const [adding, setAdding] = useState(false);
  const toast = useToast();
  const summary = useLoad(() => analyticsApi.taskSummary(), []);
  const params = { view: view === 'department' ? 'all' : view, department: view === 'department' || view === 'all' ? department || undefined : undefined, status: view === 'exceptions' ? undefined : status, pageSize: 100 };
  const list = useLoad(() => analyticsApi.tasks(params), [JSON.stringify(params)]);
  const reload = () => { void list.reload(); void summary.reload(); };
  const tabs: Array<{ key: View; label: string; count?: number | null }> = [
    { key: 'mine', label: 'Mine' },
    { key: 'department', label: 'Department' },
    ...(canAll ? [{ key: 'all' as View, label: 'All' }] : []),
    { key: 'exceptions', label: 'Exceptions', count: summary.data?.total.overdue ?? null },
  ];
  return (
    <div className="tk-root">
      <Loadable state={summary}>{(s) => <SummaryTiles s={s} />}</Loadable>
      <SectionCard
        title="Tasks"
        sub={canAll ? 'Everything due across the school.' : 'Items you own or are the delegate for.'}
        actions={canManage ? <Button onClick={() => setAdding(true)}>Add task</Button> : undefined}
      >
        <Tabs tabs={tabs} value={view} onChange={setView} />
        <div className="tk-filters">
          {(view === 'department' || view === 'all') && <Select label="Department" value={department} onChange={setDepartment} placeholder="All departments" options={opts(TASK_DEPARTMENTS)} />}
          {view !== 'exceptions' && <Select label="Status" value={status} onChange={setStatus} options={[{ value: 'open', label: 'Open' }, { value: 'done', label: 'Done' }, { value: 'all', label: 'All' }]} />}
        </div>
        {view === 'department' && !canAll && <DataNote>You see your own items in the chosen department; the department lead sees all of them.</DataNote>}
        {view === 'exceptions' && <DataNote>Overdue items, and critical items due within a week.</DataNote>}
        <Loadable state={list}>{(d) => d.items.length === 0 ? (
          <EmptyState title="Nothing here" sub={view === 'exceptions' ? 'Nothing is overdue or critical.' : 'No tasks match.'} />
        ) : (
          <ul className="tk-list">{d.items.map((t) => <TaskRow key={t.id} t={t} canAll={canAll} onChanged={reload} />)}</ul>
        )}</Loadable>
        {summary.data && <DataNote>{summary.data.definition}</DataNote>}
      </SectionCard>
      {adding && <AddTask onClose={() => setAdding(false)} onDone={() => { toast('Task added'); reload(); }} />}
    </div>
  );
}
