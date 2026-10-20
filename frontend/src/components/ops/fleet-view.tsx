'use client';
import { useState } from 'react';
import { Button, EmptyState, Field, Modal, useToast } from '@/components/ui';
import { fleetApi, type AllocationDto, type ExpiryState, type LiveBoard, type TripDetail, type TripDto, type VehicleDto } from '@/lib/fleet-api';
import { usePermissions } from '@/lib/permissions';
import { Drawer } from './drawer';
import { DataNote, ErrorNote, KeyValues, Loadable, PromptModal, SectionCard, StatusPill, Tabs, Tile, Timeline, fmtDate, fmtDateTime, humanize, isoDay, useAction, useLoad, useQueryParam } from './kit';

/**
 * Transport: vehicles (capacity, papers, service), today's trips (seats,
 * boarding, safe handover, reconciliation), a simple live board of vehicle
 * positions, and transport alerts. `mode="duty"` is the teacher's view of
 * the trips they are attendant on. Parents and students use BusTodayView.
 */

const EXPIRY_TONE: Record<ExpiryState, string> = { VALID: 'ACTIVE', EXPIRING: 'EXPIRING', EXPIRED: 'EXPIRED', MISSING: 'OVERDUE', NOT_SCHEDULED: 'DRAFT' };
function ExpiryBadge({ label, state, days }: { label: string; state: ExpiryState; days?: number | null }) {
  const text = state === 'VALID' ? `${label} ok` : state === 'EXPIRING' ? `${label} ${days ?? ''}d left` : state === 'EXPIRED' ? `${label} expired` : state === 'MISSING' ? `${label} missing` : `${label} not scheduled`;
  return <span className={`fleet-badge is-${state.toLowerCase()}`}><StatusPill status={EXPIRY_TONE[state]} label={text} /></span>;
}

const POS_LABEL: Record<string, string> = { LIVE: 'Live', STALE: 'Stale', OFFLINE: 'Offline', NO_DATA: 'No GPS data' };

// ── Vehicles ─────────────────────────────────────────────────────────────

function VehicleForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ registrationNo: '', type: 'BUS', lawfulCapacity: '', usableSeats: '', contractorName: '', permit: '', insurance: '', fitness: '', puc: '', fire: '', firstAid: '', serviceDue: '' });
  const { run, busy, error } = useAction();
  const docs = [['PERMIT', f.permit], ['INSURANCE', f.insurance], ['FITNESS', f.fitness], ['PUC', f.puc]].filter(([, d]) => d).map(([kind, validTo]) => ({ kind, validTo }));
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Add a vehicle" onClose={onClose} footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.registrationNo || !f.lawfulCapacity} onClick={() => void run(async () => {
      await fleetApi.createVehicle({ registrationNo: f.registrationNo, type: f.type, lawfulCapacity: Number(f.lawfulCapacity), usableSeats: f.usableSeats ? Number(f.usableSeats) : undefined, ownership: f.contractorName ? 'CONTRACTED' : 'OWNED', contractorName: f.contractorName || undefined, documents: docs, safety: { fireExtinguisherDueOn: f.fire || null, firstAidDueOn: f.firstAid || null }, service: { nextDueOn: f.serviceDue || null } });
      onSaved(); onClose();
    })}>Save</Button></>}>
      <div className="ops-form-grid">
        <Field label="Registration no." required><input className="input" value={f.registrationNo} onChange={set('registrationNo')} /></Field>
        <Field label="Type"><select className="input" value={f.type} onChange={set('type')}>{['BUS', 'MINIBUS', 'VAN', 'CAR', 'OTHER'].map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select></Field>
        <Field label="Lawful seating (as on the permit)" required><input className="input" inputMode="numeric" value={f.lawfulCapacity} onChange={set('lawfulCapacity')} /></Field>
        <Field label="Usable seats today" hint="Leave blank to use the lawful seating"><input className="input" inputMode="numeric" value={f.usableSeats} onChange={set('usableSeats')} /></Field>
        <Field label="Contractor (if hired)"><input className="input" value={f.contractorName} onChange={set('contractorName')} /></Field>
        <Field label="Permit valid until"><input type="date" className="input" value={f.permit} onChange={set('permit')} /></Field>
        <Field label="Insurance valid until"><input type="date" className="input" value={f.insurance} onChange={set('insurance')} /></Field>
        <Field label="Fitness certificate valid until"><input type="date" className="input" value={f.fitness} onChange={set('fitness')} /></Field>
        <Field label="Pollution (PUC) valid until"><input type="date" className="input" value={f.puc} onChange={set('puc')} /></Field>
        <Field label="Fire extinguisher check due"><input type="date" className="input" value={f.fire} onChange={set('fire')} /></Field>
        <Field label="First-aid kit check due"><input type="date" className="input" value={f.firstAid} onChange={set('firstAid')} /></Field>
        <Field label="Next service due"><input type="date" className="input" value={f.serviceDue} onChange={set('serviceDue')} /></Field>
      </div>
      <DataNote>Every date here becomes a reminder in Tasks for the transport team. A vehicle with an expired permit, insurance, fitness or PUC cannot be put on a trip.</DataNote>
      <ErrorNote error={error} />
    </Modal>
  );
}

function VehicleDetail({ id, canManage, onClose, onChanged }: { id: string; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const state = useLoad(() => fleetApi.vehicle(id), [id]);
  const [log, setLog] = useState<null | string>(null);
  const [f, setF] = useState({ odometerKm: '', litres: '', amount: '', note: '', check: 'FIRE_EXTINGUISHER', severity: 'NORMAL' });
  const { run, busy, error } = useAction();
  const reload = async () => { await state.reload(); onChanged(); };
  return (
    <Drawer title={state.data?.registrationNo ?? 'Vehicle'} sub={state.data ? `${humanize(state.data.type)} · ${state.data.usableSeats}/${state.data.lawfulCapacity} seats` : undefined} onClose={onClose}
      footer={canManage && state.data && <>
        {['FUEL', 'SERVICE', 'SAFETY_CHECK', 'BREAKDOWN', 'ODOMETER'].map((k) => <Button key={k} small variant="soft" onClick={() => setLog(k)}>+ {humanize(k)}</Button>)}
        {state.data.status === 'ACTIVE' && <Button small variant="ghost" onClick={() => void run(async () => { await fleetApi.vehicleStatus(id, { status: 'IN_SERVICE', note: 'Sent for service' }); await reload(); })}>Mark in service</Button>}
        {state.data.status === 'IN_SERVICE' && <Button small variant="ghost" onClick={() => void run(async () => { await fleetApi.vehicleStatus(id, { status: 'ACTIVE', note: 'Back on the road' }); await reload(); })}>Back on the road</Button>}
      </>}>
      <Loadable state={state}>{(v) => (
        <>
          <div className="ops-inline"><StatusPill status={v.status === 'ACTIVE' ? 'ACTIVE' : v.status === 'BREAKDOWN' ? 'BLOCKED' : 'PENDING'} label={humanize(v.status)} />{v.statusNote && <span className="ops-muted">{v.statusNote}</span>}</div>
          {v.blockingDocuments.length > 0 && <div className="ops-callout is-warn">Cannot run a trip: {v.blockingDocuments.map(humanize).join(', ')} missing or expired.</div>}
          <div className="fleet-badges">
            {v.documents.map((d) => <ExpiryBadge key={d.id} label={humanize(d.kind)} state={d.state} days={d.daysLeft} />)}
            <ExpiryBadge label="Fire extinguisher" state={v.safetyState.fireExtinguisher} />
            <ExpiryBadge label="First aid" state={v.safetyState.firstAid} />
            <ExpiryBadge label="Service" state={v.safetyState.service} />
          </div>
          <KeyValues rows={[['Odometer', `${v.odometerKm} km`], ['Ownership', v.contractorName ? `Contracted · ${v.contractorName}` : humanize(v.ownership)], ['Next service', fmtDate(v.service?.nextDueOn)], ['GPS', v.gpsDeviceId ? `${POS_LABEL[v.positionStatus ?? 'NO_DATA']}${v.lastPosition?.eventAt ? ` · last fix ${fmtDateTime(v.lastPosition.eventAt)}` : ''}` : 'No tracker linked']]} />
          <SectionCard title="Fuel, service, checks and breakdowns">
            {!v.logs?.length ? <p className="ops-muted">Nothing recorded yet.</p> : (
              <ul className="ops-list">{v.logs.map((l) => (
                <li key={l.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{humanize(l.kind)}{l.check ? ` · ${humanize(l.check)}` : ''}{l.litres ? ` · ${l.litres} L` : ''}</div><div className="ops-row-sub">{fmtDateTime(l.at)}{l.odometerKm !== null ? ` · ${l.odometerKm} km` : ''}{l.note ? ` · ${l.note}` : ''}{l.byName ? ` · ${l.byName}` : ''}</div></div>
                  {l.kind === 'BREAKDOWN' && (l.resolvedAt ? <StatusPill status="RESOLVED" /> : canManage ? <Button small variant="soft" onClick={() => setLog(`RESOLVE:${l.id}`)}>Resolve</Button> : <StatusPill status="OPEN" />)}
                </li>
              ))}</ul>
            )}
          </SectionCard>
        </>
      )}</Loadable>
      {log?.startsWith('RESOLVE:') && <PromptModal title="Breakdown resolved" label="What was done" onClose={() => setLog(null)} onSubmit={(note) => fleetApi.resolveBreakdown(id, log.slice(8), note).then(reload)} />}
      {log && !log.startsWith('RESOLVE:') && (
        <Modal title={`Record ${humanize(log).toLowerCase()}`} onClose={() => setLog(null)} footer={<><Button variant="soft" onClick={() => setLog(null)}>Cancel</Button><Button disabled={busy} onClick={() => void run(async () => {
          await fleetApi.addLog(id, { kind: log, odometerKm: f.odometerKm || null, litres: f.litres || null, amountPaise: f.amount ? Math.round(Number(f.amount) * 100) : null, note: f.note || null, check: log === 'SAFETY_CHECK' ? f.check : undefined, severity: log === 'BREAKDOWN' ? f.severity : undefined });
          setLog(null); await reload();
        })}>Save</Button></>}>
          <div className="ops-form-grid">
            {log === 'SAFETY_CHECK' && <Field label="Check"><select className="input" value={f.check} onChange={(e) => setF({ ...f, check: e.target.value })}><option value="FIRE_EXTINGUISHER">Fire extinguisher</option><option value="FIRST_AID">First-aid kit</option></select></Field>}
            {log === 'BREAKDOWN' && <Field label="Severity"><select className="input" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>{['LOW', 'NORMAL', 'HIGH', 'CRITICAL'].map((x) => <option key={x}>{x}</option>)}</select></Field>}
            <Field label="Odometer (km)"><input className="input" inputMode="numeric" value={f.odometerKm} onChange={(e) => setF({ ...f, odometerKm: e.target.value })} /></Field>
            {log === 'FUEL' && <Field label="Litres" required><input className="input" inputMode="decimal" value={f.litres} onChange={(e) => setF({ ...f, litres: e.target.value })} /></Field>}
            {['FUEL', 'SERVICE'].includes(log) && <Field label="Amount (₹)"><input className="input" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>}
          </div>
          <Field label="Note"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} style={{ width: '100%' }} /></Field>
          {log === 'BREAKDOWN' && <DataNote>A breakdown takes the vehicle off the road until it is resolved. Use “Substitute vehicle” on its trips.</DataNote>}
          <ErrorNote error={error} />
        </Modal>
      )}
    </Drawer>
  );
}

function VehiclesTab({ canManage }: { canManage: boolean }) {
  const list = useLoad(() => fleetApi.vehicles(), []);
  const [selected, setSelected] = useState<string | null>(useQueryParam('vehicle'));
  const [adding, setAdding] = useState(false);
  return (
    <div className="ops-stack">
      {canManage && <div className="ops-inline"><Button onClick={() => setAdding(true)}>+ Add vehicle</Button></div>}
      <Loadable state={list}>{(rows) => !rows.length ? <EmptyState title="No vehicles yet" sub="Add each bus or van with its lawful seating and papers." /> : (
        <SectionCard title={`${rows.length} vehicle(s)`}>
          <ul className="ops-list">{rows.map((v: VehicleDto) => (
            <li key={v.id} className="ops-row">
              <div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => setSelected(v.id)}>
                <div className="ops-row-title">{v.registrationNo} <span className="ops-muted">· {humanize(v.type)} · {v.usableSeats}/{v.lawfulCapacity} seats</span></div>
                <div className="fleet-badges">{v.documents.filter((d) => d.state !== 'VALID').map((d) => <ExpiryBadge key={d.id} label={humanize(d.kind)} state={d.state} days={d.daysLeft} />)}{v.safetyState.fireExtinguisher === 'EXPIRED' && <ExpiryBadge label="Fire extinguisher" state="EXPIRED" />}</div>
              </button></div>
              <StatusPill status={v.status === 'ACTIVE' ? (v.blockingDocuments.length ? 'BLOCKED' : 'ACTIVE') : 'PENDING'} label={v.blockingDocuments.length && v.status === 'ACTIVE' ? 'Papers expired' : humanize(v.status)} />
            </li>
          ))}</ul>
        </SectionCard>
      )}</Loadable>
      {adding && <VehicleForm onClose={() => setAdding(false)} onSaved={() => void list.reload()} />}
      {selected && <VehicleDetail id={selected} canManage={canManage} onClose={() => setSelected(null)} onChanged={() => void list.reload()} />}
    </div>
  );
}

// ── Trips ────────────────────────────────────────────────────────────────

function HandoverModal({ trip, alloc, onClose, onDone }: { trip: TripDetail; alloc: AllocationDto; onClose: () => void; onDone: () => void }) {
  const adults = useLoad(() => fleetApi.adultsFor(alloc.studentId), [alloc.studentId]);
  const [choice, setChoice] = useState('');
  const [verification, setVerification] = useState('ID_CHECKED');
  const { run, busy, error } = useAction();
  const submit = (returnToSchool: boolean) => run(async () => {
    const [kind, id] = choice.split(':');
    await fleetApi.tripAction(trip.id, 'handover', returnToSchool ? { studentId: alloc.studentId, returnToSchool: true, note: 'Nobody authorised at the stop' } : { studentId: alloc.studentId, receiver: kind === 'G' ? { guardianProfileId: id } : { pickupAdultId: id }, verification });
    onDone(); onClose();
  });
  return (
    <Modal title={`Hand over ${alloc.studentName}`} onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button variant="ghost" disabled={busy} onClick={() => void submit(true)}>Nobody authorised — keep with school</Button>
      <Button disabled={busy || !choice} onClick={() => void submit(false)}>Release to this adult</Button>
    </>}>
      <Loadable state={adults}>{(a) => (
        <div className="ops-stack">
          <p className="ops-muted">Release only to someone listed here and checked against their ID. A name given at the stop is never enough.</p>
          <ul className="ops-list">
            {a.guardians.map((g) => (
              <li key={g.guardianProfileId} className="ops-row"><label className="ops-row-main"><input type="radio" name="rcv" disabled={!g.pickupAuthorized} checked={choice === `G:${g.guardianProfileId}`} onChange={() => setChoice(`G:${g.guardianProfileId}`)} /> {g.name} <span className="ops-muted">({humanize(g.relation)})</span></label>{g.restricted ? <StatusPill status="BLOCKED" label="Custody restriction" /> : !g.pickupAuthorized ? <StatusPill status="REJECTED" label="Not authorised" /> : <StatusPill status="ACTIVE" label="Guardian" />}</li>
            ))}
            {a.adults.map((x) => (
              <li key={x.id} className="ops-row"><label className="ops-row-main"><input type="radio" name="rcv" disabled={x.kind === 'RESTRICTED' || !x.validNow} checked={choice === `A:${x.id}`} onChange={() => setChoice(`A:${x.id}`)} /> {x.name} <span className="ops-muted">{x.relationship ? `(${x.relationship})` : ''}{x.validTo ? ` · until ${fmtDateTime(x.validTo)}` : ''}</span></label>
                {x.kind === 'RESTRICTED' ? <StatusPill status="BLOCKED" label="Do not release" /> : <StatusPill status={x.validNow ? 'ACTIVE' : 'EXPIRED'} label={x.validNow ? humanize(x.kind) : 'Not valid now'} />}</li>
            ))}
          </ul>
          <Field label="How you checked"><select className="input" value={verification} onChange={(e) => setVerification(e.target.value)}><option value="ID_CHECKED">Photo ID checked</option><option value="KNOWN_TO_STAFF">Known to staff</option><option value="PHOTO_MATCHED">Matched the photo on record</option><option value="OTP">One-time code</option></select></Field>
        </div>
      )}</Loadable>
      <ErrorNote error={error} />
    </Modal>
  );
}

function TripDetailDrawer({ id, canManage, onClose, onChanged }: { id: string; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const state = useLoad(() => fleetApi.trip(id), [id]);
  const toast = useToast();
  const [handover, setHandover] = useState<AllocationDto | null>(null);
  const [prompt, setPrompt] = useState<null | 'complete' | 'substitute' | 'cancel' | 'suppress'>(null);
  const [subVehicle, setSubVehicle] = useState('');
  const vehicles = useLoad(() => (canManage ? fleetApi.vehicles({ status: 'ACTIVE' }) : Promise.resolve([] as VehicleDto[])), [canManage]);
  const { run, busy, error } = useAction();
  const reload = async () => { await state.reload(); onChanged(); };
  const act = (action: string, body: unknown = {}, msg?: string) => run(async () => { await fleetApi.tripAction(id, action, body); if (msg) toast(msg, 'success'); await reload(); });
  const t = state.data;
  return (
    <Drawer title={t?.title ?? 'Trip'} sub={t ? `${t.refNo} · ${t.vehicle?.registrationNo ?? ''} · ${t.seatsAllocated}/${t.usableSeats} seats` : undefined} onClose={onClose}
      footer={t && <>
        {t.status === 'PLANNED' && <Button onClick={() => void act('allocate-enrolled', {}, 'Enrolled students seated')}>Seat enrolled students</Button>}
        {t.status === 'PLANNED' && <Button onClick={() => void act('start')}>Start trip</Button>}
        {t.status === 'IN_PROGRESS' && <Button variant="soft" onClick={() => void act('reconcile', {}, 'Reconciled')}>Reconcile</Button>}
        {t.status === 'IN_PROGRESS' && <Button onClick={() => setPrompt('complete')}>Complete trip</Button>}
        {t.status === 'IN_PROGRESS' && <Button variant="ghost" onClick={() => setPrompt('suppress')}>Pause alerts</Button>}
        {canManage && ['PLANNED', 'IN_PROGRESS'].includes(t.status) && <Button variant="ghost" onClick={() => setPrompt('substitute')}>Substitute vehicle</Button>}
        {canManage && ['PLANNED', 'IN_PROGRESS'].includes(t.status) && <Button variant="ghost" onClick={() => setPrompt('cancel')}>Cancel trip</Button>}
      </>}>
      <ErrorNote error={error} />
      <Loadable state={state}>{(d) => (
        <>
          <div className="ops-inline"><StatusPill status={d.status === 'IN_PROGRESS' ? 'LIVE' : d.status} label={humanize(d.status)} /><span className="ops-muted">{d.kindLabel} · {fmtDate(d.date)}</span></div>
          <KeyValues rows={[
            ['Driver', d.driver?.name ? `${d.driver.name}${d.driver.cleared === false ? ` — not cleared (${d.driver.clearanceNote})` : ''}` : '—'],
            ['Attendant', d.attendant?.name ? `${d.attendant.name}${d.attendant.cleared === false ? ` — not cleared (${d.attendant.clearanceNote})` : ''}` : '—'],
            ['Location', d.vehicle ? `${POS_LABEL[d.vehicle.positionStatus]}${d.vehicle.lastPosition?.eventAt ? ` · last fix ${fmtDateTime(d.vehicle.lastPosition.eventAt)}` : ''}` : '—'],
            ['Next stop', d.nextStop ? `${d.nextStop.name}${d.nextStop.eta ? ` · ${d.nextStop.eta.isEstimate ? 'about ' : ''}${fmtDateTime(d.nextStop.eta.at)} (${d.nextStop.eta.label})` : ''}` : 'All stops reached'],
          ]} />
          {d.alerts.filter((a) => a.status !== 'RESOLVED').map((a) => <div key={a.id} className={`ops-callout ${a.severity === 'CRITICAL' ? 'is-danger' : 'is-warn'}`}>⚠ {a.message}</div>)}
          <SectionCard title="Stops">
            <ol className="fleet-stops">{d.plannedStops.map((s) => (
              <li key={s._id} className={s.arrivedAt ? 'is-done' : ''}><span>{s.sequenceNo}. {s.name}</span><span className="ops-muted">{s.arrivedAt ? `reached ${fmtDateTime(s.arrivedAt)}` : s.plannedAt ? `planned ${fmtDateTime(s.plannedAt)}` : ''}</span>
                {d.status === 'IN_PROGRESS' && !s.arrivedAt && <Button small variant="soft" disabled={busy} onClick={() => void run(async () => { await fleetApi.markStop(id, s._id, 'ARRIVED'); await reload(); })}>Reached</Button>}</li>
            ))}</ol>
          </SectionCard>
          <SectionCard title={`Students (${d.allocations.filter((a) => a.status !== 'RELEASED').length})`} sub="Seat → boarded → got off → handed over. Manual entry always works, with or without card readers.">
            {!d.allocations.length ? <p className="ops-muted">No seats allocated yet.</p> : (
              <ul className="ops-list">{d.allocations.map((a) => (
                <li key={a.id} className="ops-row">
                  <div className="ops-row-main"><div className="ops-row-title">{a.studentName}</div><div className="ops-row-sub">{a.stopName ?? 'No stop'}{a.boardedAt ? ` · boarded ${fmtDateTime(a.boardedAt)}${a.boardedVia === 'SCAN' ? ' (card)' : ''}` : ''}{a.handover?.receivedByName ? ` · received by ${a.handover.receivedByName}` : ''}</div></div>
                  <StatusPill status={a.status === 'HANDED_OVER' || a.status === 'ALIGHTED' ? 'DONE' : a.status === 'BOARDED' ? 'IN_PROGRESS' : a.status === 'NO_SHOW' ? 'WITHDRAWN' : a.status === 'RETURNED_TO_SCHOOL' ? 'PENDING' : a.status === 'RELEASED' ? 'CANCELLED' : 'SCHEDULED'} label={humanize(a.status)} />
                  {['PLANNED', 'IN_PROGRESS'].includes(d.status) && <span className="ops-inline">
                    {a.status === 'ALLOCATED' && <><Button small onClick={() => void act('board', { studentId: a.studentId })}>Boarded</Button><Button small variant="soft" onClick={() => void act('no-show', { studentId: a.studentId })}>No-show</Button><Button small variant="ghost" onClick={() => void run(async () => { await fleetApi.releaseSeat(id, a.id, 'Not travelling'); await reload(); })}>Release seat</Button></>}
                    {a.status === 'BOARDED' && d.kind === 'MORNING_PICKUP' && <Button small onClick={() => void act('alight', { studentId: a.studentId })}>Got off at school</Button>}
                    {['BOARDED', 'ALIGHTED'].includes(a.status) && d.kind !== 'MORNING_PICKUP' && <Button small onClick={() => setHandover(a)}>Hand over</Button>}
                  </span>}
                </li>
              ))}</ul>
            )}
          </SectionCard>
          {d.reconciliation?.at && (
            <SectionCard title="Reconciliation" sub={`At ${fmtDateTime(d.reconciliation.at)}`}>
              <div className="kpi-grid">
                <Tile label="Enrolled" value={d.reconciliation.enrolled ?? '—'} />
                <Tile label="Allocated" value={d.reconciliation.allocated ?? 0} />
                <Tile label="Boarded" value={d.reconciliation.boarded ?? 0} />
                <Tile label="Handed over" value={d.reconciliation.handedOver ?? 0} />
                <Tile label="No-show" value={d.reconciliation.noShow ?? 0} />
                <Tile label="Unmatched" value={d.reconciliation.unmatched.length} tone={d.reconciliation.unmatched.length ? 'bad' : 'good'} />
              </div>
              {d.reconciliation.unmatched.map((u) => <div key={u.studentId} className="ops-callout is-danger">{u.studentName}: {u.issue}</div>)}
            </SectionCard>
          )}
          <div><h3 className="ops-section-title">History</h3><Timeline items={d.history as never} /></div>
        </>
      )}</Loadable>
      {handover && t && <HandoverModal trip={t} alloc={handover} onClose={() => setHandover(null)} onDone={() => void reload()} />}
      {prompt === 'complete' && <PromptModal title="Complete trip" label="Note (required if anyone is unaccounted for)" required={false} onClose={() => setPrompt(null)} onSubmit={(note) => fleetApi.tripAction(id, 'complete', { note: note || undefined }).then(reload)} />}
      {prompt === 'cancel' && <PromptModal title="Cancel trip" label="Reason (families with a seat are told)" danger onClose={() => setPrompt(null)} onSubmit={(reason) => fleetApi.tripAction(id, 'cancel', { reason }).then(reload)} />}
      {prompt === 'suppress' && <PromptModal title="Pause delay alerts for 30 minutes" label="Reason (e.g. agreed diversion)" onClose={() => setPrompt(null)} onSubmit={(reason) => fleetApi.tripAction(id, 'suppress-alerts', { minutes: 30, reason }).then(reload)} />}
      {prompt === 'substitute' && <PromptModal title="Substitute vehicle" label="Reason" onClose={() => setPrompt(null)} extra={<Field label="Vehicle"><select className="input" value={subVehicle} onChange={(e) => setSubVehicle(e.target.value)}><option value="">Choose…</option>{(vehicles.data ?? []).filter((v) => v.id !== t?.vehicleId).map((v) => <option key={v.id} value={v.id}>{v.registrationNo} · {v.usableSeats} seats</option>)}</select></Field>} onSubmit={(reason) => fleetApi.tripAction(id, 'substitute', { vehicleId: subVehicle, reason }).then(reload)} />}
    </Drawer>
  );
}

function TripsTab({ canManage, duty }: { canManage: boolean; duty: boolean }) {
  const [date, setDate] = useState(isoDay());
  const list = useLoad(() => fleetApi.trips({ date }), [date]);
  const [selected, setSelected] = useState<string | null>(useQueryParam('trip'));
  const [planning, setPlanning] = useState(false);
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <div className="ops-stack">
      <div className="ops-inline">
        <Field label="Date"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {canManage && <Button disabled={busy || planning} onClick={() => void run(async () => { setPlanning(true); try { const out = await fleetApi.planDay(date); toast(`${out.filter((o) => o.tripId).length} trip(s) planned`, 'success'); await list.reload(); } finally { setPlanning(false); } })}>Plan the day&apos;s trips</Button>}
      </div>
      <ErrorNote error={error} />
      <Loadable state={list}>{(rows) => !rows.length ? <EmptyState title={duty ? 'No bus duty on this day' : 'No trips on this day'} sub={duty ? 'Trips where you are the attendant appear here.' : 'Plan the day: a morning pickup and an afternoon drop for every route with a registered vehicle.'} /> : (
        <SectionCard title={`${rows.length} trip(s)`}>
          <ul className="ops-list">{rows.map((t: TripDto) => (
            <li key={t.id} className="ops-row"><div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => setSelected(t.id)}>
              <div className="ops-row-title">{t.title}</div>
              <div className="ops-row-sub">{t.refNo} · {t.registrationNo} · {t.seatsAllocated}/{t.usableSeats} seats · boarded {(t.counts?.BOARDED ?? 0) + (t.counts?.ALIGHTED ?? 0) + (t.counts?.HANDED_OVER ?? 0)}{t.attendant?.name ? ` · attendant ${t.attendant.name}` : ''}</div>
            </button></div><StatusPill status={t.status === 'IN_PROGRESS' ? 'LIVE' : t.status} label={humanize(t.status)} /></li>
          ))}</ul>
        </SectionCard>
      )}</Loadable>
      {selected && <TripDetailDrawer id={selected} canManage={canManage} onClose={() => setSelected(null)} onChanged={() => void list.reload()} />}
    </div>
  );
}

// ── Live board ───────────────────────────────────────────────────────────

function LiveMap({ board }: { board: LiveBoard }) {
  const pts = board.vehicles.filter((v) => v.position);
  if (!pts.length) return <p className="ops-muted">No vehicle has sent a position yet.</p>;
  const lats = pts.map((v) => v.position!.lat); const lngs = pts.map((v) => v.position!.lng);
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const pad = 0.002;
  const x = (lng: number) => 20 + ((lng - minLng + pad) / (maxLng - minLng + 2 * pad)) * 360;
  const y = (lat: number) => 220 - ((lat - minLat + pad) / (maxLat - minLat + 2 * pad)) * 200;
  return (
    <svg viewBox="0 0 400 240" className="fleet-map" role="img" aria-label="Vehicle positions (schematic, not to scale)">
      <rect x="0" y="0" width="400" height="240" className="fleet-map-bg" />
      {pts.map((v) => (
        <g key={v.id} className={`fleet-dot is-${v.positionStatus.toLowerCase()}`}>
          <circle cx={x(v.position!.lng)} cy={y(v.position!.lat)} r="7" />
          <text x={x(v.position!.lng) + 10} y={y(v.position!.lat) + 4}>{v.registrationNo}{v.positionStatus !== 'LIVE' ? ` (${POS_LABEL[v.positionStatus].toLowerCase()})` : ''}</text>
        </g>
      ))}
    </svg>
  );
}

function LiveTab() {
  const board = useLoad(() => fleetApi.live(), []);
  return (
    <Loadable state={board}>{(b) => (
      <div className="ops-stack">
        <div className="ops-inline"><Button variant="soft" onClick={() => void board.reload()}>Refresh</Button><span className="ops-muted">As of {fmtDateTime(b.asOf)} · stale after {b.staleAfterMinutes} min, offline after {b.offlineAfterMinutes} min</span></div>
        <SectionCard title="Where the vehicles are" sub="A simple schematic from the last GPS fix of each vehicle."><LiveMap board={b} /></SectionCard>
        <SectionCard title="Vehicles">
          <ul className="ops-list">{b.vehicles.map((v) => (
            <li key={v.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{v.registrationNo}{v.trip ? ` · ${v.trip.routeName ?? v.trip.refNo} (${humanize(v.trip.status)})` : ''}</div>
              <div className="ops-row-sub">{v.hasGps ? (v.position ? `Last fix ${fmtDateTime(v.position.eventAt)} (${v.lastSeenMinutes} min ago)${v.position.speedKmh ? ` · ${Math.round(v.position.speedKmh)} km/h` : ''}` : 'Tracker linked, nothing received') : 'No tracker — use manual boarding'}</div></div>
              <StatusPill status={v.positionStatus === 'LIVE' ? 'LIVE' : v.positionStatus === 'STALE' ? 'EXPIRING' : v.positionStatus === 'OFFLINE' ? 'EXPIRED' : 'DRAFT'} label={POS_LABEL[v.positionStatus]} />
            </li>
          ))}</ul>
        </SectionCard>
        <DataNote>Positions come from GPS devices registered with the school (or the labelled simulator in a demo). A stale or offline vehicle is not lost; call the attendant and use manual boarding.</DataNote>
      </div>
    )}</Loadable>
  );
}

function AlertsTab() {
  const list = useLoad(() => fleetApi.alerts({ department: 'TRANSPORT' }), []);
  const { run, error } = useAction();
  return (
    <div className="ops-stack">
      <ErrorNote error={error} />
      <Loadable state={list}>{(rows) => !rows.length ? <EmptyState title="No open transport alerts" sub="Delays, wrong-vehicle boarding, unmatched students and GPS problems appear here." /> : (
        <SectionCard title={`${rows.length} open alert(s)`}>
          <ul className="ops-list">{rows.map((a) => (
            <li key={a.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{a.message}</div><div className="ops-row-sub">{humanize(a.kind)} · {fmtDateTime(a.lastSeenAt)}{a.count > 1 ? ` · seen ${a.count} times` : ''}</div></div>
              <StatusPill status={a.severity === 'CRITICAL' ? 'OVERDUE' : 'PENDING'} label={humanize(a.severity)} />
              {a.status === 'OPEN' && <Button small variant="soft" onClick={() => void run(async () => { await fleetApi.closeAlert(a.id, 'ACKNOWLEDGED'); await list.reload(); })}>Acknowledge</Button>}
              <Button small variant="ghost" onClick={() => void run(async () => { await fleetApi.closeAlert(a.id, 'RESOLVED', 'Resolved from the transport screen'); await list.reload(); })}>Resolve</Button>
            </li>
          ))}</ul>
        </SectionCard>
      )}</Loadable>
    </div>
  );
}

export function FleetView({ mode = 'office' }: { mode?: 'office' | 'duty' }) {
  const { permissions } = usePermissions();
  const canManage = Boolean(permissions['transport.fleet.manage']);
  const duty = mode === 'duty';
  const [tab, setTab] = useState<'trips' | 'vehicles' | 'live' | 'alerts'>('trips');
  if (duty) return <div className="ops-stack"><TripsTab canManage={false} duty /><DataNote>You see the trips where you are the attendant. Record boarding by hand if the card reader or GPS is not working; hand a child only to an adult the screen lists as authorised.</DataNote></div>;
  return (
    <div className="ops-stack">
      <Tabs tabs={[{ key: 'trips', label: 'Trips' }, { key: 'vehicles', label: 'Vehicles' }, { key: 'live', label: 'Live board' }, { key: 'alerts', label: 'Alerts' }]} value={tab} onChange={setTab} />
      {tab === 'trips' && <TripsTab canManage={canManage} duty={false} />}
      {tab === 'vehicles' && <VehiclesTab canManage={canManage} />}
      {tab === 'live' && <LiveTab />}
      {tab === 'alerts' && <AlertsTab />}
    </div>
  );
}

// ── Families ─────────────────────────────────────────────────────────────

export function BusTodayView() {
  const state = useLoad(() => fleetApi.myTrips(), []);
  return (
    <div className="ops-stack">
      <div className="ops-inline"><Button variant="soft" onClick={() => void state.reload()}>Refresh</Button></div>
      <Loadable state={state}>{(d) => !d.children.length || d.children.every((c) => !c.trips.length) ? <EmptyState icon="🚌" title="No bus trip today" sub="When your child has a seat on today's bus, its status and arrival estimate show here." /> : (
        <>
          {d.children.map((c) => (
            <SectionCard key={c.studentId} title={c.name}>
              {!c.trips.length ? <p className="ops-muted">No bus today.</p> : c.trips.map((t) => (
                <div key={t.tripId} className="fleet-mybus">
                  <div className="ops-inline"><b>{t.kindLabel}</b><StatusPill status={t.status === 'IN_PROGRESS' ? 'LIVE' : t.status} label={t.status === 'IN_PROGRESS' ? 'On the way' : humanize(t.status)} /><span className="ops-muted">{t.vehicle?.registrationNo}</span></div>
                  <KeyValues rows={[
                    ['Stop', t.stop?.name ?? '—'],
                    ['Your child', humanize(t.myStatus) + (t.boardedAt ? ` · boarded ${fmtDateTime(t.boardedAt)}` : '')],
                    ['Arrival', t.eta ? `${t.eta.isEstimate ? 'About ' : ''}${fmtDateTime(t.eta.at)} — ${t.eta.label}` : t.stop?.arrivedAt ? `Reached ${fmtDateTime(t.stop.arrivedAt)}` : '—'],
                    ['Bus location', t.positionStatus ? `${POS_LABEL[t.positionStatus]}${t.position ? ` · updated ${fmtDateTime(t.position.eventAt)}` : ''}` : '—'],
                    ['Handed to', t.handover ? `${t.handover.receivedByName} at ${fmtDateTime(t.handover.at)}` : '—'],
                    ['Attendant', t.attendantName ?? '—'],
                  ]} />
                </div>
              ))}
            </SectionCard>
          ))}
          {d.note && <DataNote>{d.note}</DataNote>}
        </>
      )}</Loadable>
    </div>
  );
}
