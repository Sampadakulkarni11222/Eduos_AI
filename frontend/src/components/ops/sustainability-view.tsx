'use client';
import { offlineWrite } from '@/lib/offline-queue';
import { useState } from 'react';
import { Button, EmptyState, Field, Modal, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  greenApi, ACTIVITY_CATEGORIES, DUTY_KINDS, LIFE_THEMES, METER_KINDS, METER_UNITS, PLANT_KINDS, PLANT_STATUSES, RECEIPT_STREAMS, TEAM_KINDS, WASTE_DESTINATIONS, WASTE_STREAMS, ZONE_KINDS,
  type ActivityDto, type DutyDto, type PackDto, type PlantDto, type TeamDto, type ZoneDto,
} from '@/lib/green-api';
import { AttachUpload } from './attach';
import { Attachments, DataNote, ErrorNote, Loadable, PromptModal, SectionCard, StatusPill, Tabs, Tile, fmtDate, humanize, isoDay, useAction, useLoad, useQueryParam } from './kit';

/**
 * Sustainability: greenery, waste, water and energy, sanitation and eco points.
 * Administrators, the principal and the compliance officer manage and verify;
 * a teacher logs plantings and activities for their own class or club. Points
 * appear only once someone other than the person who logged the activity has
 * verified it. Evidence packs are evidence to support a submission; EduOS
 * never files or submits anything to a programme.
 */
type Tab = 'overview' | 'trees' | 'waste' | 'energy' | 'sanitation' | 'activities' | 'packs' | 'setup';
type Ev = Array<{ name: string; url: string }>;
const opts = (list: readonly string[]) => list.map((v) => ({ value: v, label: humanize(v) }));
const day = (s: string) => (s ? `${s}T12:00:00+05:30` : null);
const fmtNum = (v: number | null | undefined, unit = '') => (v === null || v === undefined ? 'Not recorded' : `${Math.round(v * 100) / 100}${unit ? ` ${unit}` : ''}`);

function useGreenAccess() {
  const { me } = useAuth();
  const p = me?.permissions ?? {};
  return {
    manage: Boolean(p['sustainability.manage']), manageAll: p['sustainability.manage'] === 'ALL', verify: Boolean(p['sustainability.verify']),
    profileId: me?.profile?.id ?? null,
  };
}

function Evidence({ label, onAdd, items }: { label: string; onAdd: (a: { name: string; url: string }) => void; items: Ev }) {
  return (
    <>
      <AttachUpload label={label} accept=".jpg,.jpeg,.png,.webp,.pdf" onUploaded={(a) => onAdd({ name: a.name, url: a.url })} />
      {items.length > 0 && <p className="ops-muted">{items.length} file(s) attached.</p>}
    </>
  );
}

// ── overview ────────────────────────────────────────────────────────────

function Overview() {
  const state = useLoad(() => greenApi.overview({ preset: 'academicYear' }), []);
  return (
    <Loadable state={state}>
      {(o) => (
        <>
          <div className="green-kpis">
            <Tile label="Trees and plants planted" value={o.trees.planted} />
            <Tile label="Surviving" value={o.trees.survivalPct === null ? '—' : `${o.trees.survivalPct}%`} tone={o.trees.survivalPct !== null && o.trees.survivalPct < 70 ? 'warn' : 'good'} />
            <Tile label="Waste recorded" value={`${o.waste.totalKg} kg`} />
            <Tile label="Segregated at source" value={o.waste.segregationPct === null ? '—' : `${o.waste.segregationPct}%`} tone={o.waste.segregationPct !== null && o.waste.segregationPct < 80 ? 'warn' : 'good'} />
            <Tile label="Water per student" value={fmtNum(o.water.perStudentKL, 'kL')} />
            <Tile label="Electricity per student" value={fmtNum(o.energy.perStudentKWh, 'kWh')} />
            <Tile label="Open sanitation tasks" value={o.sanitation.openTasks} tone={o.sanitation.openTasks ? 'warn' : 'good'} href="/tasks" />
            <Tile label="Activities awaiting verification" value={o.pendingVerification} tone={o.pendingVerification ? 'warn' : 'neutral'} />
          </div>
          <SectionCard title="Waste by stream" sub={o.period.label}>
            <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Stream</th><th className="num">kg</th></tr></thead>
              <tbody>{Object.entries(o.waste.byStreamKg).map(([k, v]) => <tr key={k}><td>{humanize(k)}</td><td className="num">{v}</td></tr>)}</tbody></table></div>
            <DataNote>Per-student figures divide by the {o.students} pupils on roll now. Composted: {o.waste.compostedKg} kg. Solar generated: {o.energy.solarKWh} kWh. Rainwater harvested: {o.water.rainwaterHarvestedKL} kL.</DataNote>
          </SectionCard>
        </>
      )}
    </Loadable>
  );
}

// ── trees ───────────────────────────────────────────────────────────────

function PlantForm({ zones, teams, onClose, onDone, needTeam }: { zones: ZoneDto[]; teams: TeamDto[]; onClose: () => void; onDone: () => void; needTeam: boolean }) {
  const [f, setF] = useState({ species: '', commonName: '', kind: 'TREE', zoneId: zones[0]?.id ?? '', plantedOn: isoDay(), plantedByTeamId: needTeam ? teams[0]?.id ?? '' : '', count: '1', locationNote: '' });
  const { run, busy, error } = useAction();
  return (
    <Modal title="Record a planting" onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || !f.species || (needTeam && !f.plantedByTeamId)} onClick={() => void run(async () => {
        await greenApi.createPlant({ ...f, plantedOn: day(f.plantedOn), count: Number(f.count) || 1, plantedByTeamId: f.plantedByTeamId || undefined, zoneId: f.zoneId || undefined });
        onDone(); onClose();
      })}>Record</Button>
    </>}>
      <div className="lab-form-grid">
        <Field label="Species" required><input className="input" value={f.species} onChange={(e) => setF({ ...f, species: e.target.value })} placeholder="e.g. Azadirachta indica" /></Field>
        <Field label="Common name"><input className="input" value={f.commonName} onChange={(e) => setF({ ...f, commonName: e.target.value })} placeholder="e.g. Neem" /></Field>
        <Select label="Kind" value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={opts(PLANT_KINDS)} />
        <Field label="How many"><input className="input" inputMode="numeric" value={f.count} onChange={(e) => setF({ ...f, count: e.target.value })} /></Field>
        <Select label="Zone" value={f.zoneId} onChange={(v) => setF({ ...f, zoneId: v })} placeholder="No zone" options={zones.map((z) => ({ value: z.id, label: z.name }))} />
        <Field label="Planted on" required><input className="input" type="date" value={f.plantedOn} onChange={(e) => setF({ ...f, plantedOn: e.target.value })} /></Field>
        <Select label="Planted by" value={f.plantedByTeamId} onChange={(v) => setF({ ...f, plantedByTeamId: v })} placeholder={needTeam ? undefined : 'Not a team'} options={teams.map((t) => ({ value: t.id, label: `${t.name} (${humanize(t.kind)})` }))} />
        <Field label="Exact spot"><input className="input" value={f.locationNote} onChange={(e) => setF({ ...f, locationNote: e.target.value })} /></Field>
      </div>
      <ErrorNote error={error} />
    </Modal>
  );
}

function CheckForm({ plant, onClose, onDone }: { plant: PlantDto; onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = useState('ALIVE');
  const [note, setNote] = useState('');
  const [evidence, setEvidence] = useState<Ev>([]);
  const { run, busy, error } = useAction();
  return (
    <Modal title={`Survival check: ${plant.commonName ?? plant.species}`} onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || !evidence.length} onClick={() => void run(async () => { await greenApi.checkPlant(plant.id, { status, note, evidence }); onDone(); onClose(); })}>Record check</Button>
    </>}>
      <Select label="Status" value={status} onChange={setStatus} options={opts(PLANT_STATUSES)} />
      <Field label="Note"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <Evidence label="Photo of the plant (required)" items={evidence} onAdd={(a) => setEvidence((l) => [...l, a])} />
      <ErrorNote error={error} />
    </Modal>
  );
}

function Trees() {
  const access = useGreenAccess();
  const state = useLoad(() => Promise.all([greenApi.plants(), greenApi.zones(), greenApi.teams()]), []);
  const [adding, setAdding] = useState(false);
  const [checking, setChecking] = useState<PlantDto | null>(null);
  return (
    <Loadable state={state}>
      {([plants, zones, teams]) => (
        <SectionCard title="Trees and plants" sub="Survival is the share still alive at their latest check. Every check carries a photo." actions={access.manage ? <Button small onClick={() => setAdding(true)}>Record a planting</Button> : null}>
          {plants.length === 0 ? <EmptyState icon="🌱" title="No plantings yet" sub="Record a planting to start tracking survival." /> : (
            <div className="ops-table-wrap"><table className="ops-table">
              <thead><tr><th>Code</th><th>Plant</th><th className="num">Count</th><th>Zone</th><th>Planted</th><th>By</th><th>Status</th><th>Last check</th><th /></tr></thead>
              <tbody>{plants.map((p) => (
                <tr key={p.id}>
                  <td>{p.code}</td><td><b>{p.commonName ?? p.species}</b><div className="ops-muted"><i>{p.species}</i></div></td><td className="num">{p.count}</td>
                  <td>{p.zoneName ?? '—'}</td><td>{fmtDate(p.plantedOn)}</td><td>{p.plantedBy ?? '—'}</td><td><StatusPill status={p.status === 'ALIVE' ? 'ACTIVE' : p.status === 'DEAD' ? 'FAILED' : 'PENDING'} label={humanize(p.status)} /></td>
                  <td>{p.lastCheck ? <>{fmtDate(p.lastCheck.at)}<Attachments items={p.lastCheck.evidence} /></> : 'Never'}</td>
                  <td>{access.manage && <Button small variant="soft" onClick={() => setChecking(p)}>Check</Button>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          {adding && <PlantForm zones={zones} teams={teams} needTeam={!access.manageAll} onClose={() => setAdding(false)} onDone={() => void state.reload()} />}
          {checking && <CheckForm plant={checking} onClose={() => setChecking(null)} onDone={() => void state.reload()} />}
        </SectionCard>
      )}
    </Loadable>
  );
}

// ── waste ───────────────────────────────────────────────────────────────

function WasteForm({ zones, onClose, onDone }: { zones: ZoneDto[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ date: isoDay(), stream: 'WET', weightKg: '', segregated: true, destination: 'COMPOST', vendorName: '', receiptNo: '', zoneId: '', notes: '' });
  const [receipts, setReceipts] = useState<Ev>([]);
  const { run, busy, error } = useAction();
  const needsReceipt = f.destination === 'VENDOR' && RECEIPT_STREAMS.includes(f.stream);
  return (
    <Modal title="Record waste" onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || !f.weightKg || (needsReceipt && (!f.vendorName || (!f.receiptNo && !receipts.length)))} onClick={() => void run(async () => {
        await greenApi.createWaste({ ...f, date: day(f.date), weightKg: Number(f.weightKg), zoneId: f.zoneId || undefined, receipts });
        onDone(); onClose();
      })}>Record</Button>
    </>}>
      <div className="lab-form-grid">
        <Field label="Date" required><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Select label="Stream" value={f.stream} onChange={(v) => setF({ ...f, stream: v, destination: v === 'WET' ? 'COMPOST' : 'VENDOR' })} options={opts(WASTE_STREAMS)} />
        <Field label="Weight (kg)" required><input className="input" inputMode="decimal" value={f.weightKg} onChange={(e) => setF({ ...f, weightKg: e.target.value })} /></Field>
        <Select label="Goes to" value={f.destination} onChange={(v) => setF({ ...f, destination: v })} options={opts(WASTE_DESTINATIONS)} />
        <Select label="Zone" value={f.zoneId} onChange={(v) => setF({ ...f, zoneId: v })} placeholder="No zone" options={zones.map((z) => ({ value: z.id, label: z.name }))} />
        <Field label="Vendor"><input className="input" value={f.vendorName} onChange={(e) => setF({ ...f, vendorName: e.target.value })} /></Field>
        <Field label="Vendor receipt no."><input className="input" value={f.receiptNo} onChange={(e) => setF({ ...f, receiptNo: e.target.value })} /></Field>
      </div>
      <label className="green-check"><input type="checkbox" checked={f.segregated} onChange={(e) => setF({ ...f, segregated: e.target.checked })} /> Collected already separated at source</label>
      {needsReceipt && <DataNote>E-waste, sanitary and hazardous lab waste handed to a vendor needs the vendor&apos;s name and their receipt.</DataNote>}
      <Evidence label="Vendor handover receipt" items={receipts} onAdd={(a) => setReceipts((l) => [...l, a])} />
      <ErrorNote error={error} />
    </Modal>
  );
}

function Waste() {
  const access = useGreenAccess();
  const state = useLoad(() => Promise.all([greenApi.waste(), greenApi.zones()]), []);
  const [adding, setAdding] = useState(false);
  return (
    <Loadable state={state}>
      {([rows, zones]) => (
        <SectionCard title="Waste log" sub="Weights by stream, where it went, and the vendor's handover receipt." actions={access.manageAll ? <Button small onClick={() => setAdding(true)}>Record waste</Button> : null}>
          {rows.length === 0 ? <EmptyState icon="♻" title="No waste recorded" sub="Weigh each stream and record it here." /> : (
            <div className="ops-table-wrap"><table className="ops-table">
              <thead><tr><th>Ref</th><th>Date</th><th>Stream</th><th className="num">kg</th><th>Segregated</th><th>Went to</th><th>Receipt</th></tr></thead>
              <tbody>{rows.map((w) => (
                <tr key={w.id}><td>{w.refNo}</td><td>{fmtDate(w.date)}</td><td>{humanize(w.stream)}</td><td className="num">{w.weightKg}</td><td>{w.segregated ? 'Yes' : 'No'}</td>
                  <td>{humanize(w.destination)}{w.vendorName ? ` · ${w.vendorName}` : ''}</td><td>{w.receiptNo ?? ''}<Attachments items={w.receipts} /></td></tr>
              ))}</tbody>
            </table></div>
          )}
          {adding && <WasteForm zones={zones} onClose={() => setAdding(false)} onDone={() => void state.reload()} />}
        </SectionCard>
      )}
    </Loadable>
  );
}

// ── water, energy and compost ───────────────────────────────────────────

function MeterForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ kind: 'WATER', meterLabel: 'Main', period: isoDay().slice(0, 7), startReading: '', endReading: '', quantity: '' });
  const [evidence, setEvidence] = useState<Ev>([]);
  const { run, busy, error } = useAction();
  return (
    <Modal title="Record a monthly reading" onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || (!f.quantity && !(f.startReading && f.endReading))} onClick={() => void run(async () => {
        await greenApi.recordMeter({ ...f, startReading: f.startReading === '' ? null : Number(f.startReading), endReading: f.endReading === '' ? null : Number(f.endReading), quantity: f.quantity === '' ? undefined : Number(f.quantity), evidence });
        onDone(); onClose();
      })}>Save</Button>
    </>}>
      <div className="lab-form-grid">
        <Select label="Meter" value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={opts(METER_KINDS)} />
        <Field label="Meter name"><input className="input" value={f.meterLabel} onChange={(e) => setF({ ...f, meterLabel: e.target.value })} /></Field>
        <Field label="Month" required><input className="input" type="month" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} /></Field>
        <Field label="Opening reading"><input className="input" inputMode="decimal" value={f.startReading} onChange={(e) => setF({ ...f, startReading: e.target.value })} /></Field>
        <Field label="Closing reading"><input className="input" inputMode="decimal" value={f.endReading} onChange={(e) => setF({ ...f, endReading: e.target.value })} /></Field>
        <Field label={`Or the month's total (${METER_UNITS[f.kind]})`}><input className="input" inputMode="decimal" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
      </div>
      <Evidence label="Bill or meter photo" items={evidence} onAdd={(a) => setEvidence((l) => [...l, a])} />
      <DataNote>Recording the same meter and month again corrects it.</DataNote>
      <ErrorNote error={error} />
    </Modal>
  );
}

function Energy() {
  const access = useGreenAccess();
  const state = useLoad(() => Promise.all([greenApi.meters(), greenApi.compost()]), []);
  const [adding, setAdding] = useState(false);
  const [composting, setComposting] = useState(false);
  return (
    <Loadable state={state}>
      {([meters, compost]) => (
        <>
          <SectionCard title="Water and electricity" sub="Monthly figures, with rainwater harvesting and solar generation where the school has them." actions={access.manageAll ? <Button small onClick={() => setAdding(true)}>Record a reading</Button> : null}>
            {meters.length === 0 ? <EmptyState icon="💧" title="No readings yet" sub="Record each meter once a month." /> : (
              <div className="ops-table-wrap"><table className="ops-table">
                <thead><tr><th>Month</th><th>Meter</th><th className="num">Quantity</th><th>Evidence</th></tr></thead>
                <tbody>{meters.map((m) => <tr key={m.id}><td>{m.period}</td><td>{humanize(m.kind)} · {m.meterLabel}</td><td className="num">{m.quantity} {m.unit}</td><td><Attachments items={m.evidence} /></td></tr>)}</tbody>
              </table></div>
            )}
          </SectionCard>
          <SectionCard title="Compost" actions={access.manageAll ? <Button small variant="soft" onClick={() => setComposting(true)}>Start a batch</Button> : null}>
            {compost.length === 0 ? <p className="ops-muted">No compost batches.</p> : (
              <div className="ops-table-wrap"><table className="ops-table">
                <thead><tr><th>Batch</th><th>Started</th><th className="num">In (kg)</th><th>Status</th><th className="num">Out (kg)</th><th /></tr></thead>
                <tbody>{compost.map((c) => (
                  <tr key={c.id}><td>{c.code}</td><td>{fmtDate(c.startedOn)}</td><td className="num">{c.inputKg}</td><td><StatusPill status={c.status} /></td><td className="num">{c.outputKg ?? '—'}</td>
                    <td>{access.manageAll && c.status === 'ACTIVE' && <Button small variant="soft" onClick={() => void greenApi.updateCompost(c.id, { status: 'MATURED' }).then(() => state.reload())}>Mark matured</Button>}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </SectionCard>
          {adding && <MeterForm onClose={() => setAdding(false)} onDone={() => void state.reload()} />}
          {composting && <PromptModal title="Start a compost batch" label="Wet waste put in (kg)" multiline={false} confirmLabel="Start" onClose={() => setComposting(false)} onSubmit={async (v) => { await greenApi.createCompost({ startedOn: day(isoDay()), inputKg: Number(v) || 0 }); await state.reload(); }} />}
        </>
      )}
    </Loadable>
  );
}

// ── sanitation ──────────────────────────────────────────────────────────

function DutyForm({ zones, onClose, onDone }: { zones: ZoneDto[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ kind: 'TOILET_CLEANING', title: '', zoneId: '', frequency: 'DAY', every: '1', firstDueAt: isoDay(new Date(Date.now() + 86_400_000)), stockLevel: '', reorderLevel: '' });
  const { run, busy, error } = useAction();
  const stocked = f.kind === 'PAD_DISPENSER' || f.kind === 'INCINERATOR';
  return (
    <Modal title="Add a sanitation duty" onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || !f.title} onClick={() => void run(async () => {
        await greenApi.createDuty({ ...f, zoneId: f.zoneId || undefined, every: Number(f.every) || 1, firstDueAt: day(f.firstDueAt), stockLevel: f.stockLevel || undefined, reorderLevel: f.reorderLevel || undefined });
        onDone(); onClose();
      })}>Add</Button>
    </>}>
      <div className="lab-form-grid">
        <Select label="Duty" value={f.kind} onChange={(v) => setF({ ...f, kind: v, frequency: v === 'WATER_TANK_CLEANING' ? 'MONTH' : f.frequency, every: v === 'WATER_TANK_CLEANING' ? '6' : f.every })} options={opts(DUTY_KINDS)} />
        <Field label="Title" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Clean Block A girls' toilets" /></Field>
        <Select label="Zone / block" value={f.zoneId} onChange={(v) => setF({ ...f, zoneId: v })} placeholder="No zone" options={zones.map((z) => ({ value: z.id, label: z.name }))} />
        <Select label="Repeats every" value={f.frequency} onChange={(v) => setF({ ...f, frequency: v })} options={[{ value: 'DAY', label: 'Day(s)' }, { value: 'WEEK', label: 'Week(s)' }, { value: 'MONTH', label: 'Month(s)' }]} />
        <Field label="Interval"><input className="input" inputMode="numeric" value={f.every} onChange={(e) => setF({ ...f, every: e.target.value })} /></Field>
        <Field label="First due"><input className="input" type="date" value={f.firstDueAt} onChange={(e) => setF({ ...f, firstDueAt: e.target.value })} /></Field>
        {stocked && <Field label="Stock now"><input className="input" inputMode="numeric" value={f.stockLevel} onChange={(e) => setF({ ...f, stockLevel: e.target.value })} /></Field>}
        {stocked && <Field label="Reorder at"><input className="input" inputMode="numeric" value={f.reorderLevel} onChange={(e) => setF({ ...f, reorderLevel: e.target.value })} /></Field>}
      </div>
      <DataNote>Each occurrence becomes a task in Tasks, with reminders and escalation. A standard checklist is used for the duty.</DataNote>
      <ErrorNote error={error} />
    </Modal>
  );
}

function DutyCheck({ duty, onClose, onDone }: { duty: DutyDto; onClose: () => void; onDone: () => void }) {
  const [done, setDone] = useState<string[]>(duty.checklist);
  const [note, setNote] = useState('');
  const [stock, setStock] = useState('');
  const [evidence, setEvidence] = useState<Ev>([]);
  const { run, busy, error } = useAction();
  const gaps = done.length < duty.checklist.length;
  return (
    <Modal title={`Check: ${duty.title}`} onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || !evidence.length || (gaps && !note)} onClick={() => void run(async () => {
        await offlineWrite('SANITATION_CHECK', `/sustainability/sanitation/${duty.id}/checks`, { itemsDone: done, note, evidence, stockAfter: stock === '' ? null : Number(stock) }, `Sanitation check: ${duty.title}`);
        onDone(); onClose();
      })}>Record check</Button>
    </>}>
      <fieldset className="green-checklist"><legend>Checklist</legend>
        {duty.checklist.map((item) => (
          <label key={item} className="green-check"><input type="checkbox" checked={done.includes(item)} onChange={(e) => setDone((l) => (e.target.checked ? [...l, item] : l.filter((x) => x !== item)))} /> {item}</label>
        ))}
      </fieldset>
      {duty.stockLevel !== null && <Field label="Stock after this check"><input className="input" inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} /></Field>}
      <Field label={gaps ? 'What was not done (required)' : 'Note'}><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <Evidence label="Photo or service slip (required)" items={evidence} onAdd={(a) => setEvidence((l) => [...l, a])} />
      <ErrorNote error={error} />
    </Modal>
  );
}

function Sanitation() {
  const access = useGreenAccess();
  const state = useLoad(() => Promise.all([greenApi.duties(), greenApi.zones()]), []);
  const [adding, setAdding] = useState(false);
  const [checking, setChecking] = useState<DutyDto | null>(null);
  return (
    <Loadable state={state}>
      {([duties, zones]) => (
        <SectionCard title="Sanitation duties" sub="Toilet cleaning per block, sanitary-pad dispensers and incinerators, drinking-water tank cleaning. Each due date is a task in Tasks." actions={access.manageAll ? <Button small onClick={() => setAdding(true)}>Add a duty</Button> : null}>
          {duties.length === 0 ? <EmptyState icon="🚿" title="No sanitation duties" sub="Add the duties the school runs; their tasks and reminders follow." /> : (
            <div className="green-duties">{duties.map((d) => (
              <article key={d.id} className={`green-duty${d.overdue ? ' is-overdue' : ''}`}>
                <div className="green-duty-head"><b>{d.title}</b><StatusPill status={d.overdue ? 'OVERDUE' : d.active ? 'SCHEDULED' : 'CANCELLED'} label={d.overdue ? 'Overdue' : d.active ? 'Scheduled' : 'Paused'} /></div>
                <div className="ops-muted">{humanize(d.kind)}{d.zoneName ? ` · ${d.zoneName}` : ''} · every {d.every > 1 ? `${d.every} ` : ''}{humanize(d.frequency).toLowerCase()}{d.every > 1 ? 's' : ''}</div>
                <div>Next due {fmtDate(d.nextDueAt)}{d.openTask ? ` · task ${d.openTask.refNo}` : ''}{d.lastDoneAt ? ` · last done ${fmtDate(d.lastDoneAt)}` : ''}</div>
                {d.stockLevel !== null && <div className={d.lowStock ? 'tone-bad' : ''}>Stock {d.stockLevel}{d.reorderLevel !== null ? ` (reorder at ${d.reorderLevel})` : ''}</div>}
                {access.manage && d.active && (access.manageAll || d.ownerProfileId === access.profileId) && <Button small variant="soft" onClick={() => setChecking(d)}>Record check</Button>}
              </article>
            ))}</div>
          )}
          {adding && <DutyForm zones={zones} onClose={() => setAdding(false)} onDone={() => void state.reload()} />}
          {checking && <DutyCheck duty={checking} onClose={() => setChecking(null)} onDone={() => void state.reload()} />}
        </SectionCard>
      )}
    </Loadable>
  );
}

// ── activities and verification ─────────────────────────────────────────

function ActivityForm({ teams, onClose, onDone }: { teams: TeamDto[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ teamId: teams[0]?.id ?? '', title: '', category: 'CLEANUP', lifeTheme: '', date: isoDay(), participants: '', description: '' });
  const [evidence, setEvidence] = useState<Ev>([]);
  const { run, busy, error } = useAction();
  return (
    <Modal title="Log an eco activity" onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || !f.teamId || !f.title} onClick={() => void run(async () => {
        await greenApi.logActivity({ ...f, date: day(f.date), participants: Number(f.participants) || 0, lifeTheme: f.lifeTheme || undefined, evidence });
        onDone(); onClose();
      })}>Log</Button>
    </>}>
      <div className="lab-form-grid">
        <Select label="Class, house or club" value={f.teamId} onChange={(v) => setF({ ...f, teamId: v })} options={teams.map((t) => ({ value: t.id, label: `${t.name} (${humanize(t.kind)})` }))} />
        <Field label="What happened" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Select label="Category" value={f.category} onChange={(v) => setF({ ...f, category: v })} options={opts(ACTIVITY_CATEGORIES)} />
        <Select label="Mission LiFE theme" value={f.lifeTheme} onChange={(v) => setF({ ...f, lifeTheme: v })} placeholder="None" options={opts(LIFE_THEMES)} />
        <Field label="Date"><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Participants"><input className="input" inputMode="numeric" value={f.participants} onChange={(e) => setF({ ...f, participants: e.target.value })} /></Field>
      </div>
      <Field label="Description"><textarea className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} style={{ width: '100%' }} /></Field>
      <Evidence label="Photos or sign-in sheet" items={evidence} onAdd={(a) => setEvidence((l) => [...l, a])} />
      <DataNote>The activity earns points only after someone else verifies it.</DataNote>
      <ErrorNote error={error} />
    </Modal>
  );
}

function Activities() {
  const access = useGreenAccess();
  const state = useLoad(() => Promise.all([greenApi.activities(), greenApi.teams()]), []);
  const [adding, setAdding] = useState(false);
  const [rejecting, setRejecting] = useState<ActivityDto | null>(null);
  const { run, error } = useAction();
  return (
    <Loadable state={state}>
      {([acts, teams]) => (
        <SectionCard title="Eco activities" sub="Logged by a class, house or club; points once verified by someone other than the person who logged it." actions={access.manage && teams.length ? <Button small onClick={() => setAdding(true)}>Log an activity</Button> : null}>
          <ErrorNote error={error} />
          {acts.length === 0 ? <EmptyState icon="🌿" title="No activities yet" sub={teams.length ? 'Log what your class or club did.' : 'An administrator sets up eco teams first.'} /> : (
            <div className="ops-table-wrap"><table className="ops-table">
              <thead><tr><th>Ref</th><th>Activity</th><th>Team</th><th>Date</th><th>Evidence</th><th>Status</th><th className="num">Points</th><th /></tr></thead>
              <tbody>{acts.map((a) => {
                const mine = a.loggedByProfileId === access.profileId;
                return (
                  <tr key={a.id}><td>{a.refNo}</td><td><b>{a.title}</b><div className="ops-muted">{humanize(a.category)}{a.lifeTheme ? ` · LiFE: ${humanize(a.lifeTheme)}` : ''} · {a.participants} took part</div></td>
                    <td>{a.teamName}</td><td>{fmtDate(a.date)}</td><td><Attachments items={a.evidence} /></td>
                    <td><StatusPill status={a.status === 'VERIFIED' ? 'APPROVED' : a.status === 'REJECTED' ? 'REJECTED' : 'PENDING'} label={humanize(a.status)} />{a.verifiedByName && <div className="ops-muted">by {a.verifiedByName}</div>}</td>
                    <td className="num">{a.status === 'VERIFIED' ? a.points : '—'}</td>
                    <td>{access.verify && a.status === 'SUBMITTED' && (mine ? <span className="ops-muted">Someone else verifies</span> : (
                      <div className="green-actions">
                        <Button small onClick={() => void run(async () => { await greenApi.decide(a.id, { decision: 'VERIFY', evidenceSeen: !a.evidence.length }); await state.reload(); })}>Verify</Button>
                        <Button small variant="soft" onClick={() => setRejecting(a)}>Reject</Button>
                      </div>
                    ))}</td></tr>
                );
              })}</tbody>
            </table></div>
          )}
          {adding && <ActivityForm teams={teams} onClose={() => setAdding(false)} onDone={() => void state.reload()} />}
          {rejecting && <PromptModal title="Reject activity" label="Reason" confirmLabel="Reject" danger onClose={() => setRejecting(null)} onSubmit={async (note) => { await greenApi.decide(rejecting.id, { decision: 'REJECT', note }); await state.reload(); }} />}
        </SectionCard>
      )}
    </Loadable>
  );
}

// ── evidence packs ──────────────────────────────────────────────────────

function Packs() {
  const [key, setKey] = useState('shvr');
  const [pack, setPack] = useState<PackDto | null>(null);
  const { run, busy, error } = useAction();
  const load = (k: string) => void run(async () => setPack(await greenApi.pack(k, { preset: 'academicYear' })));
  return (
    <SectionCard title="Evidence packs" sub="The school's own records and files, arranged under each programme's headings.">
      <DataNote>Evidence to support your submission. EduOS does not file or submit anything to any programme; a coordinator fills in the programme&apos;s own form.</DataNote>
      <div className="green-pack-pick">
        <Select label="Programme" value={key} onChange={(v) => { setKey(v); setPack(null); }} options={[{ value: 'shvr', label: 'Swachh Vidyalaya / SHVR' }, { value: 'cse', label: 'CSE Green Schools audit' }, { value: 'life', label: 'Eco Club for Mission LiFE' }]} />
        <Button disabled={busy} onClick={() => load(key)}>{busy ? 'Compiling…' : 'Compile'}</Button>
        {pack && <Button variant="soft" onClick={() => void greenApi.packCsv(key, { preset: 'academicYear' }, `evidence-pack-${key}.csv`)}>Download CSV</Button>}
      </div>
      <ErrorNote error={error} />
      {pack && (
        <div className="green-pack">
          <h3>{pack.title}</h3>
          <p className="ops-muted">{pack.period.label} · {pack.fieldsNote}</p>
          {pack.sections.map((s) => (
            <section key={s.key} className="green-pack-section">
              <h4>{s.title}</h4>
              {s.rows.length > 0 && <dl className="ops-kv">{s.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
              {s.gaps.map((g) => <p key={g} className="ops-muted">ⓘ {g}</p>)}
              {s.evidence.length > 0 && <details><summary>{s.evidenceCount} evidence file(s)</summary><Attachments items={s.evidence} /></details>}
            </section>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ── setup (zones and teams) ─────────────────────────────────────────────

function Setup() {
  const state = useLoad(() => Promise.all([greenApi.zones(), greenApi.teams(), api.allSections()]), []);
  const [zone, setZone] = useState({ name: '', kind: 'GARDEN' });
  const [team, setTeam] = useState({ kind: 'CLASS', name: '', sectionId: '' });
  const { run, busy, error } = useAction();
  return (
    <Loadable state={state}>
      {([zones, teams, sections]) => (
        <>
          <SectionCard title="Zones" sub="Gardens, grounds, toilet blocks and tanks, so records and the campus map can say where.">
            <div className="green-inline">
              <Field label="Zone name"><input className="input" value={zone.name} onChange={(e) => setZone({ ...zone, name: e.target.value })} /></Field>
              <Select label="Kind" value={zone.kind} onChange={(v) => setZone({ ...zone, kind: v })} options={opts(ZONE_KINDS)} />
              <Button disabled={busy || !zone.name} onClick={() => void run(async () => { await greenApi.createZone(zone); setZone({ name: '', kind: zone.kind }); await state.reload(); })}>Add zone</Button>
            </div>
            <p className="ops-muted">{zones.map((z) => z.name).join(' · ') || 'No zones yet.'}</p>
          </SectionCard>
          <SectionCard title="Eco teams" sub="Classes, houses and eco clubs that earn points.">
            <div className="green-inline">
              <Select label="Kind" value={team.kind} onChange={(v) => setTeam({ ...team, kind: v })} options={opts(TEAM_KINDS)} />
              {team.kind === 'CLASS'
                ? <Select label="Class" value={team.sectionId} onChange={(v) => { const s = sections.find((x) => x.id === v); setTeam({ ...team, sectionId: v, name: s ? `${s.gradeName} ${s.name}` : '' }); }} placeholder="Choose a class" options={sections.map((s) => ({ value: s.id, label: `${s.gradeName} ${s.name}` }))} />
                : <Field label="Name"><input className="input" value={team.name} onChange={(e) => setTeam({ ...team, name: e.target.value })} /></Field>}
              <Button disabled={busy || !team.name || (team.kind === 'CLASS' && !team.sectionId)} onClick={() => void run(async () => { await greenApi.createTeam({ ...team, sectionId: team.sectionId || undefined }); setTeam({ kind: team.kind, name: '', sectionId: '' }); await state.reload(); })}>Add team</Button>
            </div>
            <p className="ops-muted">{teams.map((t) => `${t.name} (${humanize(t.kind)})`).join(' · ') || 'No teams yet.'}</p>
          </SectionCard>
          <ErrorNote error={error} />
        </>
      )}
    </Loadable>
  );
}

export function SustainabilityView() {
  const access = useGreenAccess();
  const initial = (useQueryParam('tab') as Tab | null) ?? 'overview';
  const [tab, setTab] = useState<Tab>(initial);
  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'overview', label: 'Overview' }, { key: 'trees', label: 'Trees' }, { key: 'waste', label: 'Waste' }, { key: 'energy', label: 'Water & energy' },
    { key: 'sanitation', label: 'Sanitation' }, { key: 'activities', label: 'Activities & points' },
    ...(access.manageAll ? [{ key: 'packs' as Tab, label: 'Evidence packs' }, { key: 'setup' as Tab, label: 'Zones & teams' }] : []),
  ];
  return (
    <div className="green-view">
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'overview' && <Overview />}
      {tab === 'trees' && <Trees />}
      {tab === 'waste' && <Waste />}
      {tab === 'energy' && <Energy />}
      {tab === 'sanitation' && <Sanitation />}
      {tab === 'activities' && <Activities />}
      {tab === 'packs' && access.manageAll && <Packs />}
      {tab === 'setup' && access.manageAll && <Setup />}
    </div>
  );
}

/** Students and parents: the school's and each class's verified eco points. */
export function EcoPointsView() {
  const state = useLoad(() => greenApi.ecoPoints(), []);
  return (
    <Loadable state={state}>
      {(b) => (
        <div className="green-view">
          <div className="green-kpis">
            <Tile label="School eco points" value={b.schoolPoints} tone="good" />
            <Tile label="Verified activities" value={b.verifiedActivities} />
          </div>
          <SectionCard title="Points by class, house and club" sub={b.note}>
            {b.teams.length === 0 ? <EmptyState icon="🌱" title="No eco teams yet" sub="The school has not set up eco teams." /> : (
              <ul className="green-board">{b.teams.map((t) => (
                <li key={t.id} className={t.mine ? 'is-mine' : undefined}>
                  <span className="green-board-name">{t.name}{t.mine && <span className="green-mine"> (your class)</span>}<span className="ops-muted"> · {humanize(t.kind)}</span></span>
                  <span className="green-board-points">{t.points}</span>
                </li>
              ))}</ul>
            )}
          </SectionCard>
          {b.recent.length > 0 && (
            <SectionCard title="Recently verified">
              <ul className="green-recent">{b.recent.map((r) => <li key={r.id}><b>{r.title}</b> · {r.teamName} · {fmtDate(r.date)} <span className="green-board-points">+{r.points}</span></li>)}</ul>
            </SectionCard>
          )}
        </div>
      )}
    </Loadable>
  );
}
