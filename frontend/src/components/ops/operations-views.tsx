'use client';
import { useState } from 'react';
import { Button, EmptyState, Field, Modal, useToast } from '@/components/ui';
import { opsApi } from '@/lib/ops-api';
import { usePermissions } from '@/lib/permissions';
import type { ContractDto, EventDto, FacilityDto, WorkOrderDto } from '@/lib/ops-types';
import { AttachUpload } from './attach';
import { Drawer } from './drawer';
import {
  DataNote, ErrorNote, KeyValues, Loadable, PromptModal, SectionCard, StatusPill, Stepper, Tabs, Tile, Timeline,
  fmtDate, fmtDateTime, humanize, money, rupeesToPaise, useAction, useLoad, useQueryParam,
} from './kit';

// ═════════════════════════ Facilities ═════════════════════════

const WO_CATEGORIES = ['ELECTRICAL', 'PLUMBING', 'IT', 'CLEANING', 'CIVIL', 'FURNITURE', 'SAFETY', 'HVAC', 'OTHER'];

export function ReportIssueModal({ facilityId, onClose, onDone }: { facilityId?: string; onClose: () => void; onDone?: () => void }) {
  const facilities = useLoad(() => opsApi.facilities(), []);
  const [f, setF] = useState({ facilityId: facilityId ?? '', title: '', description: '', category: 'ELECTRICAL', priority: 'NORMAL' });
  const [files, setFiles] = useState<Array<{ name: string; url: string }>>([]);
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <Modal title="Report a maintenance issue" onClose={onClose} footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.title} onClick={() => void run(async () => { const w = await opsApi.reportIssue({ ...f, facilityId: f.facilityId || undefined, attachments: files }); toast(`${w.refNo} reported — target ${w.slaHours} h`, 'success'); onDone?.(); onClose(); })}>Report</Button></>}>
      <Field label="Where"><select className="input" value={f.facilityId} onChange={(e) => setF({ ...f, facilityId: e.target.value })}><option value="">Not a specific room</option>{(facilities.data ?? []).filter((x) => !['CAMPUS', 'FLOOR'].includes(x.kind)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      <div className="ops-form-grid">
        <Field label="What is wrong" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Category"><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{WO_CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select></Field>
        <Field label="Priority" hint="Urgent = a safety hazard (4 h target)"><select className="input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select></Field>
      </div>
      <Field label="Details"><textarea className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} style={{ width: '100%' }} /></Field>
      <AttachUpload label="Photo" accept=".jpg,.jpeg,.png,.webp" onUploaded={(a) => setFiles((x) => [...x, { name: a.name, url: a.url }])} />
      <ErrorNote error={error} />
    </Modal>
  );
}

export function BookRoomModal({ facilityId, onClose, onDone }: { facilityId?: string; onClose: () => void; onDone?: () => void }) {
  const facilities = useLoad(() => opsApi.facilities(), []);
  const [f, setF] = useState({ facilityId: facilityId ?? '', title: '', purpose: '', startsAt: '', endsAt: '', attendees: '' });
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <Modal title="Book a room or space" onClose={onClose} footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.facilityId || !f.title || !f.startsAt || !f.endsAt} onClick={() => void run(async () => {
      const b = await opsApi.book({ ...f, startsAt: new Date(f.startsAt).toISOString(), endsAt: new Date(f.endsAt).toISOString(), attendees: f.attendees ? Number(f.attendees) : undefined });
      toast(b.status === 'CONFIRMED' ? 'Booked' : `Requested${b.conflicts?.length ? ` — note: ${b.conflicts.map((c) => c.title).join(', ')}` : ''}`, 'success'); onDone?.(); onClose();
    })}>Book</Button></>}>
      <Field label="Space" required><select className="input" value={f.facilityId} onChange={(e) => setF({ ...f, facilityId: e.target.value })}><option value="">Choose…</option>{(facilities.data ?? []).filter((x) => x.bookable && x.status === 'ACTIVE' && !['CAMPUS', 'BUILDING', 'FLOOR'].includes(x.kind)).map((x) => <option key={x.id} value={x.id}>{x.name}{x.capacity ? ` (${x.capacity})` : ''}</option>)}</select></Field>
      <div className="ops-form-grid">
        <Field label="For" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="From" required><input type="datetime-local" className="input" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></Field>
        <Field label="Until" required><input type="datetime-local" className="input" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></Field>
        <Field label="People"><input className="input" inputMode="numeric" value={f.attendees} onChange={(e) => setF({ ...f, attendees: e.target.value })} /></Field>
      </div>
      <Field label="Purpose"><input className="input" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} style={{ width: '100%' }} /></Field>
      <DataNote>A clash with a confirmed booking is refused; a clash with a timetabled class is flagged for the facilities team to decide.</DataNote>
      <ErrorNote error={error} />
    </Modal>
  );
}

function WorkOrderDetail({ w, onClose, onSaved }: { w: WorkOrderDto; onClose: () => void; onSaved: () => void }) {
  const { permissions } = usePermissions();
  const canManage = Boolean(permissions['facilities.manage']);
  const [prompt, setPrompt] = useState(false);
  const { run, busy, error } = useAction();
  const update = (body: unknown) => run(async () => { await opsApi.updateWorkOrder(w.id, body); onSaved(); onClose(); });
  return (
    <Drawer title={w.title} sub={`${w.refNo} · ${humanize(w.category)} · ${w.facilityName ?? 'No location'}`} onClose={onClose}>
      <Stepper steps={[{ key: 'OPEN', label: 'Reported' }, { key: 'ASSIGNED', label: 'Assigned' }, { key: 'IN_PROGRESS', label: 'In progress' }, { key: 'RESOLVED', label: 'Resolved' }, { key: 'CLOSED', label: 'Closed' }]} current={w.status === 'ON_HOLD' ? 'IN_PROGRESS' : w.status} />
      <div className="ops-inline"><StatusPill status={w.status} /><StatusPill status={w.priority === 'URGENT' ? 'REJECTED' : 'DRAFT'} label={humanize(w.priority)} />{w.isOverdue && <span className="ops-flag-overdue">PAST SLA</span>}{w.closesFacility && <StatusPill status="BLOCKED" label="Room out of use" />}</div>
      <KeyValues rows={[['Reported by', w.reportedByName], ['Target', `${w.slaHours} h · by ${fmtDateTime(w.dueAt)}`], ['Cost', money(w.costPaise)]]} />
      {w.description && <p>{w.description}</p>}
      {w.resolution && <p><b>Resolution:</b> {w.resolution}</p>}
      {canManage && !['CLOSED', 'CANCELLED'].includes(w.status) && (
        <div className="ops-inline">
          {['OPEN', 'ASSIGNED'].includes(w.status) && <Button small variant="soft" disabled={busy} onClick={() => void update({ status: 'IN_PROGRESS' })}>Start</Button>}
          <Button small variant="soft" disabled={busy} onClick={() => void update({ closesFacility: !w.closesFacility })}>{w.closesFacility ? 'Reopen the room' : 'Take room out of use'}</Button>
          {w.status !== 'RESOLVED' && <Button small disabled={busy} onClick={() => setPrompt(true)}>Resolve</Button>}
          {w.status === 'RESOLVED' && <Button small disabled={busy} onClick={() => void update({ status: 'CLOSED' })}>Close</Button>}
        </div>
      )}
      <ErrorNote error={error} />
      <Timeline items={w.history} />
      {prompt && <PromptModal title="Resolve work order" label="What was done" onClose={() => setPrompt(false)} onSubmit={(v) => opsApi.updateWorkOrder(w.id, { status: 'RESOLVED', resolution: v }).then(() => { onSaved(); onClose(); })} />}
    </Drawer>
  );
}

const KINDS = ['BUILDING', 'FLOOR', 'CLASSROOM', 'LECTURE_HALL', 'LAB', 'LIBRARY', 'OFFICE', 'STAFF_ROOM', 'AUDITORIUM', 'GROUND', 'COURT', 'CANTEEN', 'HOSTEL', 'CLINIC', 'PARKING', 'GATE', 'TRANSPORT_BAY', 'STORE', 'SERVER_ROOM', 'OTHER'];

function FacilityModal({ fac, all, onClose, onSaved }: { fac: FacilityDto | null; all: FacilityDto[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: fac?.code ?? '', name: fac?.name ?? '', kind: fac?.kind ?? 'CLASSROOM', parentId: fac?.parentId ?? '', floorNo: fac?.floorNo?.toString() ?? '', capacity: fac?.capacity?.toString() ?? '', restricted: fac?.restricted ?? false, bookable: fac?.bookable ?? true, accessible: fac?.accessible ?? true, status: fac?.status ?? 'ACTIVE', equipment: fac?.equipment?.join(', ') ?? '' });
  const { run, busy, error } = useAction();
  return (
    <Modal title={fac ? `Edit ${fac.name}` : 'Add facility'} onClose={onClose} wide footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.code || !f.name} onClick={() => void run(async () => {
      await opsApi.saveFacility({ ...f, parentId: f.parentId || null, floorNo: f.floorNo === '' ? null : Number(f.floorNo), capacity: f.capacity === '' ? null : Number(f.capacity), equipment: f.equipment.split(',').map((x) => x.trim()).filter(Boolean) }, fac?.id);
      onSaved(); onClose();
    })}>Save</Button></>}>
      <div className="ops-form-grid">
        <Field label="Code" required><input className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} disabled={Boolean(fac)} /></Field>
        <Field label="Name" required><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Kind"><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{KINDS.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select></Field>
        <Field label="Inside"><select className="input" value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}><option value="">— (top level)</option>{all.filter((x) => ['CAMPUS', 'BUILDING', 'FLOOR'].includes(x.kind) && x.id !== fac?.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label="Floor"><input className="input" inputMode="numeric" value={f.floorNo} onChange={(e) => setF({ ...f, floorNo: e.target.value })} /></Field>
        <Field label="Capacity"><input className="input" inputMode="numeric" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} /></Field>
        <Field label="Status"><select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="ACTIVE">Active</option><option value="UNDER_MAINTENANCE">Under maintenance</option><option value="CLOSED">Closed</option></select></Field>
        <Field label="Equipment (comma separated)"><input className="input" value={f.equipment} onChange={(e) => setF({ ...f, equipment: e.target.value })} /></Field>
      </div>
      <div className="ops-inline">
        <label className="ops-chip"><input type="checkbox" checked={f.bookable} onChange={(e) => setF({ ...f, bookable: e.target.checked })} />Bookable</label>
        <label className="ops-chip"><input type="checkbox" checked={f.accessible} onChange={(e) => setF({ ...f, accessible: e.target.checked })} />Step-free access</label>
        <label className="ops-chip"><input type="checkbox" checked={f.restricted} onChange={(e) => setF({ ...f, restricted: e.target.checked })} />Restricted (hidden from families, masked for staff)</label>
      </div>
      <ErrorNote error={error} />
    </Modal>
  );
}

export function FacilitiesView() {
  const { permissions } = usePermissions();
  const canManage = Boolean(permissions['facilities.manage']);
  const [tab, setTab] = useState<'work' | 'bookings' | 'spaces'>((useQueryParam('tab') as 'work' | 'bookings' | 'spaces' | null) ?? 'work');
  const stats = useLoad(() => opsApi.facilityStats(), []);
  const work = useLoad(() => (tab === 'work' ? opsApi.workOrders({ status: 'OPEN', pageSize: 100 }) : Promise.resolve(null)), [tab]);
  const bookings = useLoad(() => (tab === 'bookings' ? opsApi.bookings({ from: new Date(Date.now() - 86_400_000).toISOString() }) : Promise.resolve([])), [tab]);
  const spaces = useLoad(() => (tab === 'spaces' ? opsApi.facilities() : Promise.resolve([] as FacilityDto[])), [tab]);
  const [modal, setModal] = useState<null | 'issue' | 'book' | 'facility'>(null);
  const [editFac, setEditFac] = useState<FacilityDto | null>(null);
  const [openWo, setOpenWo] = useState<WorkOrderDto | null>(null);
  const { run, error } = useAction();
  const toast = useToast();
  const refresh = () => { void stats.reload(); void work.reload(); void bookings.reload(); void spaces.reload(); };
  return (
    <div className="ops-stack">
      <Loadable state={stats}>{(s) => (
        <div className="kpi-grid">
          <Tile label="Open work orders" value={s.openWorkOrders} />
          <Tile label="Past SLA" value={s.overdueWorkOrders} tone={s.overdueWorkOrders ? 'bad' : 'good'} />
          <Tile label="Urgent" value={s.urgentWorkOrders} tone={s.urgentWorkOrders ? 'bad' : 'good'} />
          <Tile label="Booking requests" value={s.pendingBookings} tone={s.pendingBookings ? 'warn' : 'neutral'} />
          <Tile label="Spaces out of use" value={s.facilitiesOutOfUse} tone={s.facilitiesOutOfUse ? 'warn' : 'good'} />
        </div>
      )}</Loadable>
      <div className="ops-inline">
        <Tabs tabs={[{ key: 'work', label: 'Maintenance' }, { key: 'bookings', label: 'Bookings' }, { key: 'spaces', label: 'Spaces' }]} value={tab} onChange={setTab} />
        <Button onClick={() => setModal('issue')}>Report an issue</Button>
        <Button variant="soft" onClick={() => setModal('book')}>Book a room</Button>
      </div>
      {tab === 'work' && <Loadable state={work}>{(d) => !d?.items.length ? <EmptyState icon="✓" title="No open work orders" sub="Reported issues appear here with their SLA." /> : (
        <SectionCard title="Open work orders">
          <ul className="ops-list">{d.items.map((w) => <li key={w.id} className="ops-row"><div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => setOpenWo(w)}><div className="ops-row-title">{w.title}</div><div className="ops-row-sub">{w.refNo} · {w.facilityName ?? '—'} · {humanize(w.category)} · due {fmtDateTime(w.dueAt)}</div></button></div>{w.isOverdue && <span className="ops-flag-overdue">PAST SLA</span>}<StatusPill status={w.priority === 'URGENT' ? 'REJECTED' : 'DRAFT'} label={humanize(w.priority)} /><StatusPill status={w.status} /></li>)}</ul>
        </SectionCard>
      )}</Loadable>}
      {tab === 'bookings' && <Loadable state={bookings}>{(rows) => !rows.length ? <EmptyState title="No bookings" sub="Book a room, lab, hall or ground." /> : (
        <SectionCard title="Bookings">
          <ul className="ops-list">{rows.map((b) => <li key={b.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{b.title}</div><div className="ops-row-sub">{b.facilityName} · {fmtDateTime(b.startsAt)} – {fmtDateTime(b.endsAt)} · {b.bookedByName}</div></div><StatusPill status={b.status} />
            {canManage && b.status === 'REQUESTED' && <><Button small onClick={() => void run(async () => { await opsApi.decideBooking(b.id, 'CONFIRMED'); toast('Confirmed', 'success'); refresh(); })}>Confirm</Button><Button small variant="ghost" onClick={() => void run(async () => { await opsApi.decideBooking(b.id, 'REJECTED', 'Not available'); refresh(); })}>Decline</Button></>}
            {['REQUESTED', 'CONFIRMED'].includes(b.status) && <Button small variant="ghost" onClick={() => void run(async () => { await opsApi.cancelBooking(b.id); refresh(); })}>Cancel</Button>}
          </li>)}</ul>
        </SectionCard>
      )}</Loadable>}
      {tab === 'spaces' && <Loadable state={spaces}>{(rows) => (
        <SectionCard title={`${rows.length} spaces`} sub={rows.some((r) => r.sampleLayout) ? 'Includes a SAMPLE layout — replace it with your real buildings and rooms.' : undefined}
          actions={canManage ? <><Button small onClick={() => { setEditFac(null); setModal('facility'); }}>+ Add space</Button>{!rows.length && <Button small variant="soft" onClick={() => void run(async () => { await opsApi.sampleCampus(); toast('Sample campus created (labelled as sample)', 'info'); refresh(); })}>Create a sample campus</Button>}</> : undefined}>
          <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Space</th><th>Kind</th><th>Floor</th><th className="num">Capacity</th><th>Status</th><th /></tr></thead><tbody>
            {rows.filter((r) => r.kind !== 'CAMPUS').map((r) => <tr key={r.id}><td><b>{r.name}</b> <span className="ops-muted">{r.code}</span>{r.restricted && <> <StatusPill status="BLOCKED" label="Restricted" /></>}{r.sampleLayout && <> <span className="ops-chip">sample</span></>}</td><td>{humanize(r.kind)}</td><td>{r.floorNo ?? '—'}</td><td className="num">{r.capacity ?? '—'}</td><td><StatusPill status={r.status} /></td><td>{canManage && !r.restricted && <Button small variant="soft" onClick={() => { setEditFac(r); setModal('facility'); }}>Edit</Button>}{canManage && r.restricted && r.name !== 'Restricted area' && <Button small variant="soft" onClick={() => { setEditFac(r); setModal('facility'); }}>Edit</Button>}</td></tr>)}
          </tbody></table></div>
        </SectionCard>
      )}</Loadable>}
      <ErrorNote error={error} />
      {modal === 'issue' && <ReportIssueModal onClose={() => setModal(null)} onDone={refresh} />}
      {modal === 'book' && <BookRoomModal onClose={() => setModal(null)} onDone={refresh} />}
      {modal === 'facility' && <FacilityModal fac={editFac} all={spaces.data ?? []} onClose={() => setModal(null)} onSaved={refresh} />}
      {openWo && <WorkOrderDetail w={openWo} onClose={() => setOpenWo(null)} onSaved={refresh} />}
    </div>
  );
}

// ═════════════════════════ Events ═════════════════════════

const EVENT_STEPS = [{ key: 'PROPOSED', label: 'Proposed' }, { key: 'PENDING_APPROVAL', label: 'Approval' }, { key: 'APPROVED', label: 'Approved' }, { key: 'IN_PREPARATION', label: 'Preparing' }, { key: 'LIVE', label: 'Live' }, { key: 'COMPLETED', label: 'Completed' }];
const EVENT_KINDS = ['FEST', 'CEREMONY', 'SPORTS', 'CULTURAL', 'COMPETITION', 'MEETING', 'PTM', 'VISIT', 'TRIP', 'WORKSHOP', 'OTHER'];

function EventDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const state = useLoad(() => opsApi.event(id), [id]);
  const [tasks, setTasks] = useState<EventDto['tasks'] | null>(null);
  const [prompt, setPrompt] = useState<null | 'cancel' | 'complete'>(null);
  const [spend, setSpend] = useState('');
  const { run, busy, error } = useAction();
  const toast = useToast();
  const reload = async () => { await state.reload(); onChanged(); };
  const act = (fn: () => Promise<unknown>, msg: string) => run(async () => { await fn(); toast(msg, 'success'); await reload(); });
  return (
    <Drawer title={state.data?.title ?? 'Event'} sub={state.data ? `${state.data.refNo} · ${humanize(state.data.kind)}` : undefined} onClose={onClose}>
      <Loadable state={state}>{(e) => (
        <>
          <Stepper steps={EVENT_STEPS} current={['CANCELLED', 'REJECTED'].includes(e.status) ? 'PENDING_APPROVAL' : e.status} failed={['CANCELLED', 'REJECTED'].includes(e.status)} />
          <div className="ops-inline"><StatusPill status={e.status} />{e.readiness !== null && <span className="ops-chip">{e.readiness}% ready</span>}{e.consentRequired && <span className="ops-chip">Consent {e.consentsReceived}/{e.expectedAttendance || '?'}</span>}</div>
          {e.conflicts.length > 0 && <div className="ops-callout is-warn"><b>Check:</b> {e.conflicts.join(' · ')}</div>}
          <KeyValues rows={[['When', `${fmtDateTime(e.startsAt)} – ${fmtDateTime(e.endsAt)}`], ['Venue', e.venueText ?? (e.facilityId ? 'Booked space' : '—')], ['Audience', humanize(e.audience)], ['Expected', String(e.expectedAttendance)], ['Budget', money(e.budgetPaise)], ['Spent', money(e.actualSpendPaise)], ['Organiser', e.organiserName]]} />
          {e.description && <p>{e.description}</p>}
          {e.safetyPlan ? <p><b>Safety:</b> {e.safetyPlan}</p> : <p className="ops-callout is-warn">No safety plan recorded.</p>}
          {e.accessibilityPlan && <p><b>Accessibility:</b> {e.accessibilityPlan}</p>}
          <SectionCard title="Tasks">
            {(tasks ?? e.tasks).map((t, i, arr) => (
              <div key={i} className="ops-inline" style={{ marginBottom: 6 }}>
                <input className="input" value={t.title} onChange={(ev) => setTasks(arr.map((y, j) => (j === i ? { ...y, title: ev.target.value } : y)))} style={{ flex: 1 }} aria-label={`Task ${i + 1}`} />
                <input className="input" value={t.ownerName ?? ''} onChange={(ev) => setTasks(arr.map((y, j) => (j === i ? { ...y, ownerName: ev.target.value } : y)))} placeholder="Owner" aria-label="Owner" />
                <select className="input" value={t.status} onChange={(ev) => setTasks(arr.map((y, j) => (j === i ? { ...y, status: ev.target.value } : y)))} aria-label="Status"><option value="TODO">To do</option><option value="IN_PROGRESS">In progress</option><option value="DONE">Done</option><option value="BLOCKED">Blocked</option></select>
              </div>
            ))}
            <div className="ops-inline">
              <Button small variant="ghost" onClick={() => setTasks([...(tasks ?? e.tasks), { title: '', department: null, ownerName: '', dueOn: null, status: 'TODO' }])}>+ Task</Button>
              {tasks && <Button small disabled={busy} onClick={() => void act(() => opsApi.updateEvent(e.id, { tasks: tasks.filter((t) => t.title.trim()) }), 'Tasks saved').then(() => setTasks(null))}>Save tasks</Button>}
            </div>
          </SectionCard>
          <div className="ops-inline">
            {['PROPOSED'].includes(e.status) && <Button disabled={busy} onClick={() => void act(() => opsApi.submitEvent(e.id), 'Sent for approval')}>Submit for approval</Button>}
            {e.status === 'APPROVED' && <Button small variant="soft" onClick={() => void act(() => opsApi.moveEvent(e.id, 'IN_PREPARATION'), 'Preparing')}>Start preparation</Button>}
            {['APPROVED', 'IN_PREPARATION'].includes(e.status) && <Button small onClick={() => void act(() => opsApi.moveEvent(e.id, 'LIVE'), 'Event is live')}>Mark live</Button>}
            {e.status === 'LIVE' && <Button small onClick={() => setPrompt('complete')}>Complete & record outcome</Button>}
            {e.status === 'COMPLETED' && !e.newsroomPostId && <Button small variant="soft" onClick={() => void act(() => opsApi.eventHighlight(e.id), 'Draft highlight created in the newsroom')}>Draft a newsroom highlight</Button>}
            {['PROPOSED', 'APPROVED', 'IN_PREPARATION'].includes(e.status) && <Button small variant="ghost" onClick={() => setPrompt('cancel')}>Cancel event</Button>}
          </div>
          {e.status !== 'COMPLETED' && e.status !== 'CANCELLED' && (
            <div className="ops-inline"><Field label="Actual spend so far (₹)"><input className="input" inputMode="decimal" value={spend} onChange={(ev) => setSpend(ev.target.value)} /></Field><Button small variant="soft" disabled={!spend} onClick={() => void act(() => opsApi.updateEvent(e.id, { actualSpendPaise: rupeesToPaise(spend) }), 'Spend updated')}>Update</Button></div>
          )}
          {e.outcome.summary && <SectionCard title="Outcome"><p>{e.outcome.summary}</p><p className="ops-muted">Attendance {e.outcome.attendance ?? '—'} · Budget variance {money(e.budgetVariancePaise)}</p></SectionCard>}
          <ErrorNote error={error} />
          <Timeline items={e.history} />
        </>
      )}</Loadable>
      {prompt === 'cancel' && <PromptModal title="Cancel event" label="Reason" danger onClose={() => setPrompt(null)} onSubmit={(v) => opsApi.moveEvent(id, 'CANCELLED', v).then(reload)} />}
      {prompt === 'complete' && <PromptModal title="Event outcome" label="Summary (what happened, highlights — not attendee names)" onClose={() => setPrompt(null)} onSubmit={(v) => opsApi.completeEvent(id, { summary: v }).then(reload)} />}
    </Drawer>
  );
}

function ProposeEventModal({ onClose, onDone }: { onClose: () => void; onDone: (e: EventDto) => void }) {
  const facilities = useLoad(() => opsApi.facilities(), []);
  const [f, setF] = useState({ title: '', kind: 'FEST', description: '', startsAt: '', endsAt: '', facilityId: '', venueText: '', audience: 'INSTITUTION', expectedAttendance: '', consentRequired: false, safetyPlan: '', accessibilityPlan: '', transportPlan: '' });
  const [lines, setLines] = useState([{ head: '', amount: '' }]);
  const { run, busy, error } = useAction();
  return (
    <Modal title="Propose an event" onClose={onClose} wide footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.title || !f.startsAt || !f.endsAt} onClick={() => void run(async () => {
      const e = await opsApi.proposeEvent({ ...f, startsAt: new Date(f.startsAt).toISOString(), endsAt: new Date(f.endsAt).toISOString(), facilityId: f.facilityId || undefined, expectedAttendance: Number(f.expectedAttendance || 0), budgetLines: lines.filter((l) => l.head && l.amount).map((l) => ({ head: l.head, amountPaise: rupeesToPaise(l.amount) })) });
      onDone(e); onClose();
    })}>Save proposal</Button></>}>
      <div className="ops-form-grid">
        <Field label="Title" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Kind"><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{EVENT_KINDS.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select></Field>
        <Field label="From" required><input type="datetime-local" className="input" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></Field>
        <Field label="Until" required><input type="datetime-local" className="input" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></Field>
        <Field label="Venue on campus"><select className="input" value={f.facilityId} onChange={(e) => setF({ ...f, facilityId: e.target.value })}><option value="">Off campus / other</option>{(facilities.data ?? []).filter((x) => x.bookable && !['CAMPUS', 'BUILDING', 'FLOOR'].includes(x.kind)).map((x) => <option key={x.id} value={x.id}>{x.name}{x.capacity ? ` (${x.capacity})` : ''}</option>)}</select></Field>
        {!f.facilityId && <Field label="Venue"><input className="input" value={f.venueText} onChange={(e) => setF({ ...f, venueText: e.target.value })} /></Field>}
        <Field label="Audience"><select className="input" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}>{['INSTITUTION', 'STUDENTS', 'PARENTS', 'STAFF', 'PUBLIC', 'INVITED'].map((a) => <option key={a} value={a}>{humanize(a)}</option>)}</select></Field>
        <Field label="Expected attendance"><input className="input" inputMode="numeric" value={f.expectedAttendance} onChange={(e) => setF({ ...f, expectedAttendance: e.target.value })} /></Field>
      </div>
      <Field label="Description"><textarea className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} style={{ width: '100%' }} /></Field>
      <fieldset style={{ border: 'none' }}><legend className="field-label">Budget</legend>
        {lines.map((l, i) => <div key={i} className="ops-inline" style={{ marginBottom: 6 }}><input className="input" value={l.head} onChange={(e) => setLines(lines.map((y, j) => (j === i ? { ...y, head: e.target.value } : y)))} placeholder="Head (decor, sound, prizes…)" aria-label={`Budget head ${i + 1}`} /><input className="input" inputMode="decimal" value={l.amount} onChange={(e) => setLines(lines.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} placeholder="₹" aria-label="Amount" /></div>)}
        <Button small variant="ghost" onClick={() => setLines([...lines, { head: '', amount: '' }])}>+ Line</Button>
      </fieldset>
      <Field label="Safety plan" hint="Supervision ratio, first aid, emergency exits, crowd control"><textarea className="input" rows={2} value={f.safetyPlan} onChange={(e) => setF({ ...f, safetyPlan: e.target.value })} style={{ width: '100%' }} /></Field>
      <Field label="Accessibility plan"><input className="input" value={f.accessibilityPlan} onChange={(e) => setF({ ...f, accessibilityPlan: e.target.value })} style={{ width: '100%' }} /></Field>
      <Field label="Transport"><input className="input" value={f.transportPlan} onChange={(e) => setF({ ...f, transportPlan: e.target.value })} style={{ width: '100%' }} /></Field>
      <label className="ops-inline"><input type="checkbox" checked={f.consentRequired} onChange={(e) => setF({ ...f, consentRequired: e.target.checked })} /> Guardian consent needed (trips, off-campus, overnight)</label>
      <ErrorNote error={error} />
    </Modal>
  );
}

export function EventsView() {
  const openId = useQueryParam('id');
  const [selected, setSelected] = useState<string | null>(openId);
  const [proposing, setProposing] = useState(false);
  const [tab, setTab] = useState<'upcoming' | 'mine' | 'all'>('upcoming');
  const state = useLoad(() => opsApi.events({ upcoming: tab === 'upcoming' ? 'true' : undefined, mine: tab === 'mine' ? 'true' : undefined, pageSize: 100 }), [tab]);
  return (
    <div className="ops-stack">
      <div className="ops-inline"><Tabs tabs={[{ key: 'upcoming', label: 'Upcoming' }, { key: 'mine', label: 'Organised by me' }, { key: 'all', label: 'All' }]} value={tab} onChange={setTab} /><Button onClick={() => setProposing(true)}>+ Propose an event</Button></div>
      <Loadable state={state}>{(d) => !d.items.length ? <EmptyState title="No events" sub="Propose a fest, ceremony, sports day, PTM or visit." /> : (
        <SectionCard title="Events">
          <ul className="ops-list">{d.items.map((e) => <li key={e.id} className="ops-row"><div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => setSelected(e.id)}><div className="ops-row-title">{e.title}</div><div className="ops-row-sub">{humanize(e.kind)} · {fmtDateTime(e.startsAt)} · {money(e.budgetPaise)}{e.readiness !== null ? ` · ${e.readiness}% ready` : ''}{e.conflicts.length ? ' · ⚠ conflicts' : ''}</div></button></div><StatusPill status={e.status} /></li>)}</ul>
        </SectionCard>
      )}</Loadable>
      <DataNote>On approval the venue is confirmed and the event is added to the school calendar. Newsroom highlights are drafts until a moderator publishes them, and never include attendee lists.</DataNote>
      {proposing && <ProposeEventModal onClose={() => setProposing(false)} onDone={(e) => { void state.reload(); setSelected(e.id); }} />}
      {selected && <EventDetail id={selected} onClose={() => setSelected(null)} onChanged={() => void state.reload()} />}
    </div>
  );
}

// ═════════════════════════ Agreements ═════════════════════════

const CONTRACT_KINDS = ['VENDOR', 'SERVICE', 'STAFF', 'LEASE', 'TRANSPORT', 'FACILITIES', 'MOU', 'PARTNERSHIP', 'OTHER'];

function ContractModal({ c, onClose, onSaved }: { c: ContractDto | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ title: c?.title ?? '', kind: c?.kind ?? 'VENDOR', counterparty: c?.counterparty ?? '', value: c ? String(c.valuePaise / 100) : '', startsOn: c?.startsOn?.slice(0, 10) ?? '', endsOn: c?.endsOn?.slice(0, 10) ?? '', noticePeriodDays: String(c?.noticePeriodDays ?? 30), legalReviewNote: c?.legalReviewNote ?? '', signatureMethod: c?.signatureMethod ?? '' });
  const [versionUrl, setVersionUrl] = useState('');
  const { run, busy, error } = useAction();
  const locked = c && ['AWAITING_APPROVAL', 'APPROVED', 'EXECUTED', 'ACTIVE'].includes(c.status);
  return (
    <Modal title={c ? c.title : 'New agreement'} onClose={onClose} wide footer={<>
      <Button variant="soft" onClick={onClose}>Close</Button>
      <Button disabled={busy || !f.title || !f.counterparty} onClick={() => void run(async () => {
        const body: Record<string, unknown> = { title: f.title, counterparty: f.counterparty, startsOn: f.startsOn || null, endsOn: f.endsOn || null, noticePeriodDays: Number(f.noticePeriodDays), legalReviewNote: f.legalReviewNote, signatureMethod: f.signatureMethod || null, ...(versionUrl ? { newVersionUrl: versionUrl } : {}) };
        if (!c) Object.assign(body, { kind: f.kind, valuePaise: f.value ? rupeesToPaise(f.value) : 0, draft: true });
        else if (!locked) body.valuePaise = f.value ? rupeesToPaise(f.value) : 0;
        await opsApi.saveContract(body, c?.id); onSaved(); onClose();
      })}>Save</Button>
      {c && ['DRAFTING', 'UNDER_REVIEW'].includes(c.status) && <Button disabled={busy} onClick={() => void run(async () => { await opsApi.submitContract(c.id); onSaved(); onClose(); })}>Send for approval</Button>}
      {c?.status === 'APPROVED' && <Button disabled={busy || !f.signatureMethod} onClick={() => void run(async () => { await opsApi.saveContract({ to: 'EXECUTED', signatureMethod: f.signatureMethod }, c.id); onSaved(); onClose(); })}>Mark signed</Button>}
      {c?.status === 'EXECUTED' && <Button disabled={busy} onClick={() => void run(async () => { await opsApi.saveContract({ to: 'ACTIVE' }, c.id); onSaved(); onClose(); })}>Mark active</Button>}
    </>}>
      {c && <div className="ops-inline"><StatusPill status={c.status} />{c.renewalAttention && <span className="ops-flag-overdue">RENEWAL / NOTICE DUE</span>}</div>}
      <div className="ops-form-grid">
        <Field label="Title" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Kind"><select className="input" value={f.kind} disabled={Boolean(c)} onChange={(e) => setF({ ...f, kind: e.target.value })}>{CONTRACT_KINDS.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select></Field>
        <Field label="Counterparty" required><input className="input" value={f.counterparty} onChange={(e) => setF({ ...f, counterparty: e.target.value })} /></Field>
        <Field label="Value (₹)" hint={locked ? 'Fixed once in approval' : undefined}><input className="input" inputMode="decimal" value={f.value} disabled={Boolean(locked)} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>
        <Field label="Starts"><input type="date" className="input" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} /></Field>
        <Field label="Ends"><input type="date" className="input" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} /></Field>
        <Field label="Notice period (days)"><input className="input" inputMode="numeric" value={f.noticePeriodDays} onChange={(e) => setF({ ...f, noticePeriodDays: e.target.value })} /></Field>
        <Field label="How it is signed"><select className="input" value={f.signatureMethod} onChange={(e) => setF({ ...f, signatureMethod: e.target.value })}><option value="">—</option><option value="WET_INK">Wet ink</option><option value="AADHAAR_ESIGN">Aadhaar eSign</option><option value="DSC">Digital signature certificate</option><option value="OTHER">Other</option></select></Field>
      </div>
      <Field label="Legal / stamp-duty review note" hint="Whether e-signature is valid for this document and what stamp duty applies depends on the document and state — record the reviewer's conclusion."><textarea className="input" rows={2} value={f.legalReviewNote} onChange={(e) => setF({ ...f, legalReviewNote: e.target.value })} style={{ width: '100%' }} /></Field>
      <AttachUpload label="Upload a new version" accept=".pdf,.doc,.docx" onUploaded={(a) => setVersionUrl(a.url)} />
      <ErrorNote error={error} />
    </Modal>
  );
}

export function ContractsView() {
  const { permissions } = usePermissions();
  const canManage = Boolean(permissions['contracts.manage']);
  const [tab, setTab] = useState<'all' | 'expiring'>('all');
  const state = useLoad(() => opsApi.contracts(tab === 'expiring' ? { expiringWithinDays: 90 } : {}), [tab]);
  const [edit, setEdit] = useState<ContractDto | null | 'new'>(null);
  return (
    <div className="ops-stack">
      <div className="ops-inline"><Tabs tabs={[{ key: 'all', label: 'All agreements' }, { key: 'expiring', label: 'Expiring in 90 days' }]} value={tab} onChange={setTab} />{canManage && <Button onClick={() => setEdit('new')}>+ New agreement</Button>}</div>
      <Loadable state={state}>{(rows) => !rows.length ? <EmptyState title="No agreements" sub="Vendor, service, lease, transport and partnership agreements, with renewal and notice dates." /> : (
        <SectionCard title="Agreements">
          <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Agreement</th><th>Counterparty</th><th className="num">Value</th><th>Ends</th><th>Notice by</th><th>Status</th></tr></thead><tbody>
            {rows.map((c) => <tr key={c.id} className="is-clickable" onClick={() => setEdit(c)}><td><b>{c.title}</b><div className="ops-muted">{c.refNo} · {humanize(c.kind)}</div></td><td>{c.counterparty}</td><td className="num">{money(c.valuePaise)}</td><td>{fmtDate(c.endsOn)}</td><td>{c.noticeDeadline ? fmtDate(c.noticeDeadline) : '—'}{c.renewalAttention && <div className="ops-flag-overdue">ATTENTION</div>}</td><td><StatusPill status={c.status} /></td></tr>)}
          </tbody></table></div>
        </SectionCard>
      )}</Loadable>
      {edit && <ContractModal c={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => void state.reload()} />}
    </div>
  );
}
