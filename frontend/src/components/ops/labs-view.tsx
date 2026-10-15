'use client';
import { offlineWrite } from '@/lib/offline-queue';
import { Fragment, useMemo, useState } from 'react';
import { Button, EmptyState, Field, Modal, Select, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { usePermissions } from '@/lib/permissions';
import {
  labsApi, HAZARD_CLASSES, INCIDENT_KINDS, LAB_TYPES, LAB_UNITS, STORAGE_GROUPS,
  type BatchDto, type DeviceDto, type EquipmentDto, type LabDto, type LabItemDto, type MovementDto, type ScanResult, type SessionDto, type SoftwareDto,
} from '@/lib/labs-api';
import { AttachUpload } from './attach';
import { DataNote, ErrorNote, Loadable, PromptModal, SectionCard, StatusPill, Tabs, Tile, fmtDate, fmtDateTime, humanize, isoDay, money, useAction, useLoad, useQueryParam } from './kit';

/**
 * Science and computer labs: stock in batches with expiry badges and a
 * ledger, receive / issue / return / stocktake with a scan box (type the code
 * when a label will not scan), instruments and calibration, computers and
 * software seats, practical sessions with a readiness check, and incidents.
 * The server enforces every rule (no expired issue, no negative stock, no
 * hazardous handling by students); this screen shows why when it refuses.
 */
type Tab = 'labs' | 'stock' | 'equipment' | 'devices' | 'sessions' | 'incidents';
const opts = (list: readonly string[]) => list.map((v) => ({ value: v, label: humanize(v) }));
type Ev = Array<{ name: string; url: string }>;

function ExpiryBadge({ b }: { b: Pick<BatchDto, 'expired' | 'daysToExpiry' | 'status'> }) {
  if (b.status === 'QUARANTINED') return <StatusPill status="BLOCKED" label="Quarantined" />;
  if (b.expired) return <StatusPill status="EXPIRED" label="Expired" />;
  if (b.daysToExpiry === null) return <span className="lab-badge">No expiry</span>;
  if (b.daysToExpiry <= 30) return <StatusPill status="OVERDUE" label={`Expires in ${b.daysToExpiry} d`} />;
  if (b.daysToExpiry <= 90) return <StatusPill status="EXPIRING" label={`Expires in ${b.daysToExpiry} d`} />;
  return <span className="lab-badge">Expires {fmtDate(new Date(Date.now() + b.daysToExpiry * 86_400_000))}</span>;
}

function HazardChips({ list }: { list: string[] }) {
  if (!list.length) return null;
  return <span className="lab-hazards">{list.map((h) => <span key={h} className={`lab-hazard lab-hz-${h.toLowerCase()}`} title={humanize(h)}>{humanize(h)}</span>)}</span>;
}

/** The scan box: a scanner types the code and presses Enter, or a person types it. */
function ScanBox({ onResult }: { onResult: (r: ScanResult) => void }) {
  const [code, setCode] = useState('');
  const { run, busy, error } = useAction();
  return (
    <form className="lab-scan" onSubmit={(e) => { e.preventDefault(); if (code.trim()) void run(async () => { onResult(await labsApi.scan(code.trim())); setCode(''); }); }}>
      <label className="field-label" htmlFor="lab-scan-input">Scan or type a code</label>
      <div className="lab-scan-row">
        <input id="lab-scan-input" className="input" autoComplete="off" placeholder="LB-000123, LD-000004, a device tag, serial or lot number" value={code} onChange={(e) => setCode(e.target.value)} />
        <Button type="submit" disabled={busy || !code.trim()}>Find</Button>
      </div>
      <ErrorNote error={error} />
    </form>
  );
}

// ── Labs ──────────────────────────────────────────────────────────────────

function NewLab({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const rooms = useLoad(() => labsApi.freeFacilities(), []);
  const staff = useLoad(() => import('@/lib/ops-api').then((m) => m.opsApi.orgStaff()), []);
  const [f, setF] = useState({ facilityId: '', type: 'SCIENCE_CHEMISTRY', inCharge: '', assistant: '', checklist: 'Safety goggles on\nFirst-aid kit checked' });
  const { run, busy, error } = useAction();
  return (
    <Modal title="Set up a lab" onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || !f.facilityId} onClick={() => void run(async () => {
        await labsApi.createLab({ facilityId: f.facilityId, type: f.type, inChargeProfileIds: f.inCharge ? [f.inCharge] : [], assistantProfileId: f.assistant || null, safetyChecklist: f.checklist.split('\n').map((s) => s.trim()).filter(Boolean) });
        onDone(); onClose();
      })}>Create</Button>
    </>}>
      <Loadable state={rooms}>{(list) => list.length ? <Select label="Room (a LAB facility)" value={f.facilityId} onChange={(v) => setF({ ...f, facilityId: v })} placeholder="Choose a room" options={list.map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` }))} /> : <p className="ops-muted">Every LAB room already has a lab profile. Add a LAB room under Facilities first.</p>}</Loadable>
      <Select label="Type" value={f.type} onChange={(v) => setF({ ...f, type: v })} options={opts(LAB_TYPES)} />
      <Loadable state={staff}>{(list) => (<>
        <Select label="In charge" value={f.inCharge} onChange={(v) => setF({ ...f, inCharge: v })} placeholder="Choose a person" options={list.map((p) => ({ value: p.profileId, label: p.name }))} />
        <Select label="Lab assistant" value={f.assistant} onChange={(v) => setF({ ...f, assistant: v })} placeholder="None" options={list.map((p) => ({ value: p.profileId, label: p.name }))} />
      </>)}</Loadable>
      <Field label="Safety checklist (one per line)" hint="Checked before every practical."><textarea className="input" rows={4} value={f.checklist} onChange={(e) => setF({ ...f, checklist: e.target.value })} /></Field>
      <ErrorNote error={error} />
    </Modal>
  );
}

function LabsTab({ labs, canAll, onChanged, open }: { labs: LabDto[]; canAll: boolean; onChanged: () => void; open: (labId: string, tab: Tab) => void }) {
  const [adding, setAdding] = useState(false);
  return (
    <SectionCard title="Labs" sub="Each lab is a room from Facilities with its people, stock and equipment." actions={canAll ? <Button small onClick={() => setAdding(true)}>Set up a lab</Button> : undefined}>
      {!labs.length ? <EmptyState icon="⚗" title="No labs yet" sub={canAll ? 'Set up a lab on one of the LAB rooms.' : 'You are not in charge of a lab.'} /> : (
        <div className="lab-cards">
          {labs.map((l) => (
            <article key={l.id} className="lab-card">
              <header><h3>{l.name}</h3><span className="ops-muted">{l.facilityCode} · {humanize(l.type)}</span></header>
              <p className="ops-muted">In charge: {l.inChargeNames.join(', ') || '—'}{l.assistantName ? ` · assistant ${l.assistantName}` : ''}</p>
              {l.counts && (
                <ul className="lab-counts">
                  {l.type !== 'COMPUTER' && <li className={l.counts.expired ? 'is-bad' : ''}><button type="button" onClick={() => open(l.id, 'stock')}>{l.counts.expired} expired</button></li>}
                  {l.type !== 'COMPUTER' && <li className={l.counts.expiringSoon ? 'is-warn' : ''}><button type="button" onClick={() => open(l.id, 'stock')}>{l.counts.expiringSoon} expiring soon</button></li>}
                  {l.type !== 'COMPUTER' && <li className={l.counts.lowStock ? 'is-warn' : ''}><button type="button" onClick={() => open(l.id, 'stock')}>{l.counts.lowStock} low stock</button></li>}
                  <li className={l.counts.calibrationOverdue || l.counts.outOfService ? 'is-bad' : ''}><button type="button" onClick={() => open(l.id, 'equipment')}>{l.counts.outOfService} out of service · {l.counts.calibrationOverdue} calibration overdue</button></li>
                  {l.type === 'COMPUTER' && <li className={l.counts.devicesInRepair ? 'is-warn' : ''}><button type="button" onClick={() => open(l.id, 'devices')}>{l.counts.devices} computers · {l.counts.devicesInRepair} in repair</button></li>}
                  <li><button type="button" onClick={() => open(l.id, 'sessions')}>{l.counts.sessionsThisWeek} practicals this week</button></li>
                  <li className={l.counts.openIncidents ? 'is-warn' : ''}><button type="button" onClick={() => open(l.id, 'incidents')}>{l.counts.openIncidents} open incidents</button></li>
                </ul>
              )}
            </article>
          ))}
        </div>
      )}
      {adding && <NewLab onClose={() => setAdding(false)} onDone={onChanged} />}
    </SectionCard>
  );
}

// ── Stock ─────────────────────────────────────────────────────────────────

function NewItem({ labId, onClose, onDone }: { labId: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: '', casNo: '', kind: 'CHEMICAL', unit: 'g', minStock: '', reorderQty: '', storageGroup: 'GENERAL', hazards: [] as string[], restricted: false, sdsUrl: '', location: '' });
  const { run, busy, error } = useAction();
  return (
    <Modal wide title="Add an item to the catalogue" onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || !f.name.trim()} onClick={() => void run(async () => {
        await labsApi.createItem(labId, { name: f.name.trim(), casNo: f.casNo.trim() || null, kind: f.kind, unit: f.unit, minStock: f.minStock || 0, reorderQty: f.reorderQty || 0, storageGroup: f.storageGroup, hazardClasses: f.hazards, restricted: f.restricted, sdsUrl: f.sdsUrl.trim() || null, location: f.location.trim() || null });
        onDone(); onClose();
      })}>Add</Button>
    </>}>
      <div className="lab-form-grid">
        <Field label="Name" required><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="CAS number" hint="Optional, e.g. 7647-01-0"><input className="input" value={f.casNo} onChange={(e) => setF({ ...f, casNo: e.target.value })} /></Field>
        <Select label="Kind" value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={opts(['CHEMICAL', 'CONSUMABLE', 'GLASSWARE', 'SPECIMEN', 'COMPONENT', 'OTHER'])} />
        <Select label="Counted in" value={f.unit} onChange={(v) => setF({ ...f, unit: v })} options={LAB_UNITS.map((u) => ({ value: u, label: u }))} />
        <Field label={`Minimum stock (${f.unit})`}><input className="input" inputMode="decimal" value={f.minStock} onChange={(e) => setF({ ...f, minStock: e.target.value })} /></Field>
        <Field label={`Reorder quantity (${f.unit})`}><input className="input" inputMode="decimal" value={f.reorderQty} onChange={(e) => setF({ ...f, reorderQty: e.target.value })} /></Field>
        <Select label="Storage group" value={f.storageGroup} onChange={(v) => setF({ ...f, storageGroup: v })} options={opts(STORAGE_GROUPS)} />
        <Field label="Location"><input className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="Cupboard A, shelf 2" /></Field>
      </div>
      <fieldset className="lab-hazard-pick"><legend>Hazard classes (GHS)</legend>
        {HAZARD_CLASSES.map((h) => <label key={h}><input type="checkbox" checked={f.hazards.includes(h)} onChange={(e) => setF({ ...f, hazards: e.target.checked ? [...f.hazards, h] : f.hazards.filter((x) => x !== h) })} /> {humanize(h)}</label>)}
      </fieldset>
      <label className="lab-check"><input type="checkbox" checked={f.restricted} onChange={(e) => setF({ ...f, restricted: e.target.checked })} /> Kept in the locked cupboard</label>
      <Field label="Safety data sheet link"><input className="input" value={f.sdsUrl} onChange={(e) => setF({ ...f, sdsUrl: e.target.value })} /></Field>
      <ErrorNote error={error} />
    </Modal>
  );
}

function ReceiveModal({ item, onClose, onDone }: { item: LabItemDto; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ quantity: '', unit: item.displayUnit, lotNo: '', supplierName: '', expiresOn: '', noExpiry: item.kind !== 'CHEMICAL' });
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <Modal title={`Receive ${item.name}`} onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || !f.quantity} onClick={() => void run(async () => {
        const out = await labsApi.receive(item.id, { quantity: f.quantity, unit: f.unit, lotNo: f.lotNo || null, supplierName: f.supplierName || null, expiresOn: f.expiresOn ? `${f.expiresOn}T00:00:00+05:30` : null, noExpiry: f.noExpiry });
        toast(`Received as batch ${out.batch.code}; print this code on the label.`); onDone(); onClose();
      })}>Receive</Button>
    </>}>
      <div className="lab-form-grid">
        <Field label="Quantity" required><input className="input" inputMode="decimal" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
        <Select label="Unit" value={f.unit} onChange={(v) => setF({ ...f, unit: v })} options={LAB_UNITS.map((u) => ({ value: u, label: u }))} />
        <Field label="Lot / batch no. on the container"><input className="input" value={f.lotNo} onChange={(e) => setF({ ...f, lotNo: e.target.value })} /></Field>
        <Field label="Supplier"><input className="input" value={f.supplierName} onChange={(e) => setF({ ...f, supplierName: e.target.value })} /></Field>
        <Field label="Expiry date" required={!f.noExpiry}><input className="input" type="date" value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })} /></Field>
      </div>
      <label className="lab-check"><input type="checkbox" checked={f.noExpiry} onChange={(e) => setF({ ...f, noExpiry: e.target.checked })} /> No expiry printed</label>
      <DataNote>Units convert within mass (mg, g, kg) or volume (mL, L) only; the system never assumes a density.</DataNote>
      <ErrorNote error={error} />
    </Modal>
  );
}

type OutKind = 'issue' | 'consume' | 'damage' | 'dispose';
function OutModal({ kind, batch, item, onClose, onDone }: { kind: OutKind; batch: BatchDto; item: Pick<LabItemDto, 'id' | 'name' | 'displayUnit' | 'hazardous'>; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ quantity: '', unit: item.displayUnit, reason: '', issuedToName: '' });
  const [evidence, setEvidence] = useState<Ev>([]);
  const { run, busy, error } = useAction();
  const fefo = useLoad(() => (kind === 'issue' && Number(f.quantity) > 0 ? labsApi.fefo(item.id, Number(f.quantity), f.unit) : Promise.resolve(null)), [kind, f.quantity, f.unit]);
  const title = { issue: 'Issue', consume: 'Record consumption', damage: 'Record damage or breakage', dispose: 'Dispose of stock' }[kind];
  return (
    <Modal title={`${title}: ${item.name} (${batch.code})`} onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button className={kind === 'dispose' ? 'btn-danger' : undefined} disabled={busy || !f.quantity} onClick={() => void run(async () => {
        const body = { batchId: batch.id, quantity: f.quantity, unit: f.unit, reason: f.reason || null, issuedToName: f.issuedToName || null, evidence };
        // Issue works offline too: queued on this device and sent once, with an idempotency key.
        if (kind === 'issue') await offlineWrite('LAB_STOCK', '/labs/stock/issue', body, `Issue ${f.quantity} ${f.unit} of ${item.name}`);
        else await labsApi.moveOut(kind, body);
        onDone(); onClose();
      })}>{title}</Button>
    </>}>
      <p className="ops-muted">In this batch: {batch.quantityDisplay} {batch.displayUnit} · <ExpiryBadge b={batch} /></p>
      {kind === 'issue' && item.hazardous && <DataNote>Hazardous: issued to the supervising teacher, never to a student.</DataNote>}
      <div className="lab-form-grid">
        <Field label="Quantity" required><input className="input" inputMode="decimal" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
        <Select label="Unit" value={f.unit} onChange={(v) => setF({ ...f, unit: v })} options={LAB_UNITS.map((u) => ({ value: u, label: u }))} />
        {kind === 'issue' && <Field label="Issued to"><input className="input" value={f.issuedToName} onChange={(e) => setF({ ...f, issuedToName: e.target.value })} placeholder="Teacher's name" /></Field>}
      </div>
      {kind === 'issue' && fefo.data && (
        <div className="lab-fefo">
          <b>First expiry, first out:</b> {fefo.data.plan.map((p) => `${p.code} (${p.takeDisplay} ${fefo.data?.displayUnit}${p.expiresOn ? `, exp ${fmtDate(p.expiresOn)}` : ''})`).join(' then ') || 'no usable batch'}
          {fefo.data.shortByDisplay > 0 && <span className="lab-short"> · short by {fefo.data.shortByDisplay} {fefo.data.displayUnit}</span>}
          {fefo.data.plan[0] && fefo.data.plan[0].batchId !== batch.id && <span className="ops-muted"> · this is not the batch that expires first</span>}
        </div>
      )}
      <Field label={kind === 'dispose' ? 'How it was disposed of' : 'Reason / note'} required={kind === 'dispose' || kind === 'damage'}><textarea className="input" rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      {(kind === 'dispose' || kind === 'damage') && <AttachUpload label={kind === 'dispose' ? 'Attach disposal evidence (required)' : 'Attach a photo'} onUploaded={(a) => setEvidence((l) => [...l, { name: a.name, url: a.url }])} />}
      {evidence.length > 0 && <ul className="ops-attachments">{evidence.map((e) => <li key={e.url}>📎 {e.name}</li>)}</ul>}
      <ErrorNote error={error} />
    </Modal>
  );
}

function StocktakeModal({ labId, items, onClose, onDone }: { labId: string; items: LabItemDto[]; onClose: () => void; onDone: () => void }) {
  const batches = items.flatMap((i) => i.batches.map((b) => ({ ...b, itemName: i.name })));
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const { run, busy, error } = useAction();
  return (
    <Modal wide title="Stocktake" onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Close</Button>
      <Button disabled={busy || !reason.trim() || !Object.values(counts).some((v) => v !== '')} onClick={() => void run(async () => {
        const lines = batches.filter((b) => counts[b.id] !== undefined && counts[b.id] !== '').map((b) => ({ batchId: b.id, counted: counts[b.id], expected: b.quantityDisplay, unit: b.displayUnit }));
        const out = await labsApi.stocktake(labId, { reason: reason.trim(), lines });
        setResult(`${out.adjusted} adjustment(s) recorded.${out.lines.filter((l) => l.error).map((l) => ` ${l.code}: ${l.error}`).join('')}`);
        onDone();
      })}>Record count</Button>
    </>}>
      <Field label="Reason" required hint="Recorded on every adjustment, e.g. 'Term-end count'."><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Item</th><th>Batch</th><th className="num">On record</th><th>Counted</th></tr></thead><tbody>
        {batches.map((b) => (
          <tr key={b.id}><td>{b.itemName}</td><td>{b.code}</td><td className="num">{b.quantityDisplay} {b.displayUnit}</td>
            <td><input className="input lab-count" inputMode="decimal" aria-label={`Counted for ${b.code}`} value={counts[b.id] ?? ''} onChange={(e) => setCounts({ ...counts, [b.id]: e.target.value })} /></td></tr>
        ))}
      </tbody></table></div>
      {result && <p className="ops-muted" role="status">{result}</p>}
      <ErrorNote error={error} />
    </Modal>
  );
}

function StockTab({ labs, labId, setLabId, canManage, scanned }: { labs: LabDto[]; labId: string; setLabId: (v: string) => void; canManage: boolean; scanned: ScanResult | null }) {
  const [filter, setFilter] = useState('');
  const items = useLoad(() => labsApi.items({ labId: labId || undefined, filter: filter || undefined }), [labId, filter]);
  const ledger = useLoad(() => labsApi.movements({ labId: labId || undefined, pageSize: 30 }), [labId]);
  const [modal, setModal] = useState<null | { kind: 'new' | 'receive' | 'stocktake' } | { kind: OutKind; batch: BatchDto; item: LabItemDto }>(null);
  const [retFor, setRetFor] = useState<MovementDto | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const toast = useToast();
  const { run, error } = useAction();
  const reload = () => { void items.reload(); void ledger.reload(); };
  const sci = labs.filter((l) => l.type !== 'COMPUTER');
  const receiveItem = modal?.kind === 'receive' && open ? items.data?.find((i) => i.id === open) : null;
  const scannedItem = scanned?.type === 'BATCH' ? items.data?.find((i) => i.id === scanned.item?.id) : null;
  return (
    <>
      <SectionCard title="Stock" sub="Usable stock counts only active, unexpired batches." actions={<>
        <Select hideLabel label="Lab" value={labId} onChange={setLabId} placeholder="All labs" options={sci.map((l) => ({ value: l.id, label: l.name }))} />
        <Select hideLabel label="Show" value={filter} onChange={setFilter} placeholder="Everything" options={[{ value: 'low', label: 'Low stock' }, { value: 'expiring', label: 'Expiring within 60 days' }, { value: 'hazardous', label: 'Hazardous' }]} />
        {canManage && labId && <Button small variant="soft" onClick={() => setModal({ kind: 'stocktake' })}>Stocktake</Button>}
        {canManage && labId && <Button small onClick={() => setModal({ kind: 'new' })}>Add item</Button>}
      </>}>
        {scanned?.type === 'BATCH' && scanned.batch && (
          <div className="lab-scanned">
            <b>Scanned: {scanned.item?.name} · batch {scanned.batch.code}</b> — {scanned.batch.quantityDisplay} {scanned.batch.displayUnit} <ExpiryBadge b={scanned.batch} />
            {scanned.item && <HazardChips list={scanned.item.hazardClasses} />}
            {canManage && scannedItem && (
              <span className="lab-actions">
                {scanned.batch.issuable && <Button small onClick={() => setModal({ kind: 'issue', batch: scanned.batch as BatchDto, item: scannedItem })}>Issue</Button>}
                <Button small variant="soft" onClick={() => setModal({ kind: 'dispose', batch: scanned.batch as BatchDto, item: scannedItem })}>Dispose</Button>
              </span>
            )}
          </div>
        )}
        <ErrorNote error={error} />
        <Loadable state={items} empty={<EmptyState icon="⚗" title="No items" sub="Add the lab's chemicals and consumables to the catalogue." />}>{(list) => list.length === 0 ? <EmptyState icon="⚗" title="Nothing to show" sub="No items match." /> : (
          <div className="ops-table-wrap"><table className="ops-table lab-stock"><thead><tr><th>Item</th><th>Storage</th><th className="num">Usable</th><th>Next expiry</th><th /></tr></thead><tbody>
            {list.map((i) => (
              <Fragment key={i.id}>
                <tr className={i.lowStock ? 'is-low' : undefined}>
                  <td><button type="button" className="lab-link" aria-expanded={open === i.id} onClick={() => setOpen(open === i.id ? null : i.id)}>{i.name}</button>
                    {i.casNo && <span className="ops-muted"> · CAS {i.casNo}</span>} <HazardChips list={i.hazardClasses} />{i.restricted && <span className="lab-badge">🔒 locked cupboard</span>}
                    {i.sdsUrl && <> · <a href={i.sdsUrl} target="_blank" rel="noreferrer">SDS</a></>}</td>
                  <td>{humanize(i.storageGroup)}{i.location ? ` · ${i.location}` : ''}</td>
                  <td className="num">{i.onHandDisplay} {i.displayUnit}{i.lowStock && <div><StatusPill status="OVERDUE" label={`Below ${i.minStockDisplay}`} /></div>}{i.expiredQuantity > 0 && <div><StatusPill status="EXPIRED" label="Has expired stock" /></div>}</td>
                  <td>{i.nextExpiry ? fmtDate(i.nextExpiry) : '—'}</td>
                  <td className="lab-actions">{canManage && <>
                    <Button small variant="soft" onClick={() => { setOpen(i.id); setModal({ kind: 'receive' }); }}>Receive</Button>
                    {i.lowStock && <Button small variant="soft" onClick={() => void run(async () => { const out = await labsApi.reorder(i.id); toast(`Purchase request ${out.purchaseRequest.refNo} drafted in Procurement.`); })}>Reorder</Button>}
                  </>}</td>
                </tr>
                {open === i.id && (
                  <tr key={`${i.id}-b`} className="lab-batches"><td colSpan={5}>
                    {!i.batches.length ? <span className="ops-muted">No stock in hand.</span> : (
                      <ul>{i.batches.map((b) => (
                        <li key={b.id}><code>{b.code}</code> {b.lotNo && <span className="ops-muted">lot {b.lotNo}</span>} · {b.quantityDisplay} {b.displayUnit} <ExpiryBadge b={b} />
                          {canManage && <span className="lab-actions">
                            {b.issuable && <Button small onClick={() => setModal({ kind: 'issue', batch: b, item: i })}>Issue</Button>}
                            {b.issuable && <Button small variant="soft" onClick={() => setModal({ kind: 'consume', batch: b, item: i })}>Used</Button>}
                            <Button small variant="soft" onClick={() => setModal({ kind: 'damage', batch: b, item: i })}>Damaged</Button>
                            <Button small variant="soft" onClick={() => setModal({ kind: 'dispose', batch: b, item: i })}>Dispose</Button>
                            {b.status === 'ACTIVE' && !b.expired && <Button small variant="soft" onClick={() => { const reason = window.prompt('Why quarantine this batch?'); if (reason) void run(async () => { await labsApi.updateBatch(b.id, { status: 'QUARANTINED', reason }); reload(); }); }}>Quarantine</Button>}
                            {b.status === 'QUARANTINED' && !b.expired && <Button small variant="soft" onClick={() => void run(async () => { await labsApi.updateBatch(b.id, { status: 'ACTIVE' }); reload(); })}>Release</Button>}
                          </span>}
                        </li>
                      ))}</ul>
                    )}
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody></table></div>
        )}</Loadable>
      </SectionCard>
      <SectionCard title="Stock ledger" sub="Every receipt, issue, return, use, breakage, disposal and adjustment. Rows are never edited; corrections are new adjustments.">
        <Loadable state={ledger}>{(page) => !page.items.length ? <p className="ops-muted">No movements yet.</p> : (
          <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>When</th><th>Type</th><th>Item · batch</th><th className="num">Qty</th><th className="num">Balance</th><th>By / to</th><th>Note</th><th /></tr></thead><tbody>
            {page.items.map((m) => (
              <tr key={m.id}><td>{fmtDateTime(m.at)}</td><td><span className={`lab-mv lab-mv-${m.type.toLowerCase()}`}>{humanize(m.type)}</span></td><td>{m.itemName} · {m.batchCode}</td>
                <td className="num">{m.quantityDisplay > 0 ? '+' : ''}{m.quantityDisplay} {m.displayUnit}</td><td className="num">{m.balanceDisplay}</td>
                <td>{m.byName ?? '—'}{m.issuedToName ? ` → ${m.issuedToName}` : ''}</td><td>{m.reason ?? ''}</td>
                <td>{canManage && m.type === 'ISSUE' && (m.outstanding ?? 0) > 0 && <Button small variant="soft" onClick={() => setRetFor(m)}>Return</Button>}</td></tr>
            ))}
          </tbody></table></div>
        )}</Loadable>
      </SectionCard>
      {modal?.kind === 'new' && labId && <NewItem labId={labId} onClose={() => setModal(null)} onDone={reload} />}
      {receiveItem && <ReceiveModal item={receiveItem} onClose={() => setModal(null)} onDone={reload} />}
      {modal?.kind === 'stocktake' && items.data && <StocktakeModal labId={labId} items={items.data} onClose={() => setModal(null)} onDone={reload} />}
      {modal && 'batch' in modal && <OutModal kind={modal.kind} batch={modal.batch} item={modal.item} onClose={() => setModal(null)} onDone={reload} />}
      {retFor && <PromptModal title={`Return to ${retFor.batchCode}`} label={`Quantity returned (${retFor.displayUnit}); up to ${retFor.outstandingDisplay}`} multiline={false} confirmLabel="Return" onClose={() => setRetFor(null)} onSubmit={async (q) => { await offlineWrite('LAB_STOCK', '/labs/stock/return', { issueMovementId: retFor.id, quantity: q, unit: retFor.displayUnit }, `Return to ${retFor.batchCode}`); reload(); }} />}
    </>
  );
}

// ── Instruments ───────────────────────────────────────────────────────────

function EquipmentTab({ labs, labId, setLabId, canManage }: { labs: LabDto[]; labId: string; setLabId: (v: string) => void; canManage: boolean }) {
  const list = useLoad(() => labsApi.equipment({ labId: labId || undefined }), [labId]);
  const [calibrate, setCalibrate] = useState<EquipmentDto | null>(null);
  const [repair, setRepair] = useState<EquipmentDto | null>(null);
  const [adding, setAdding] = useState(false);
  const { run, error } = useAction();
  return (
    <SectionCard title="Instruments and equipment" sub="An instrument out of service or overdue for calibration shows on every practical that needs it." actions={<>
      <Select hideLabel label="Lab" value={labId} onChange={setLabId} placeholder="All labs" options={labs.map((l) => ({ value: l.id, label: l.name }))} />
      {canManage && labId && <Button small onClick={() => setAdding(true)}>Add instrument</Button>}
    </>}>
      <ErrorNote error={error} />
      <Loadable state={list}>{(rows) => !rows.length ? <EmptyState icon="⚖" title="No instruments" sub="Add the lab's instruments, linked to the asset register where they were bought through procurement." /> : (
        <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Instrument</th><th>Code</th><th>Calibration</th><th>Warranty / AMC</th><th>State</th><th /></tr></thead><tbody>
          {rows.map((e) => (
            <tr key={e.id}><td>{e.name}{e.quantity > 1 ? ` ×${e.quantity}` : ''}{e.serialNo ? <div className="ops-muted">S/N {e.serialNo}</div> : null}</td><td><code>{e.code}</code></td>
              <td>{e.calibrationRequired ? (e.calibrationOverdue ? <StatusPill status="OVERDUE" label={`Overdue since ${fmtDate(e.calibrationDueOn)}`} /> : e.calibrationDaysLeft !== null && e.calibrationDaysLeft <= 30 ? <StatusPill status="EXPIRING" label={`Due ${fmtDate(e.calibrationDueOn)}`} /> : `Due ${fmtDate(e.calibrationDueOn)}`) : <span className="ops-muted">Not needed</span>}</td>
              <td>{e.warrantyUntil ? `Warranty ${fmtDate(e.warrantyUntil)}` : '—'}{e.amcUntil ? <div>AMC {fmtDate(e.amcUntil)}</div> : null}</td>
              <td>{e.outOfService ? <StatusPill status="BLOCKED" label="Out of service" /> : <StatusPill status="ACTIVE" label={humanize(e.condition)} />}{e.outOfServiceReason && <div className="ops-muted">{e.outOfServiceReason}</div>}</td>
              <td className="lab-actions">{canManage && <>
                {e.calibrationRequired && <Button small variant="soft" onClick={() => setCalibrate(e)}>Calibrated</Button>}
                {e.openRepairs ? <Button small variant="soft" onClick={() => void run(async () => { const r = e.repairs.find((x) => !x.closedAt); if (r) await labsApi.closeEquipmentRepair(e.id, r._id, { action: 'Repaired' }); void list.reload(); })}>Repair done</Button>
                  : <Button small variant="soft" onClick={() => setRepair(e)}>Log repair</Button>}
              </>}</td></tr>
          ))}
        </tbody></table></div>
      )}</Loadable>
      {calibrate && <CalibrateModal e={calibrate} onClose={() => setCalibrate(null)} onDone={() => void list.reload()} />}
      {repair && <PromptModal title={`Repair: ${repair.name}`} label="What is wrong" confirmLabel="Log repair (marks it out of service)" onClose={() => setRepair(null)} onSubmit={async (issue) => { await labsApi.equipmentRepair(repair.id, { issue }); void list.reload(); }} />}
      {adding && labId && <AddEquipment labId={labId} onClose={() => setAdding(false)} onDone={() => void list.reload()} />}
    </SectionCard>
  );
}

function CalibrateModal({ e, onClose, onDone }: { e: EquipmentDto; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ certificateNo: '', calibratedOn: isoDay(), validUntil: '', by: '' });
  const [evidence, setEvidence] = useState<Ev>([]);
  const { run, busy, error } = useAction();
  return (
    <Modal title={`Calibration: ${e.name}`} onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || !f.certificateNo.trim()} onClick={() => void run(async () => { await labsApi.calibrate(e.id, { ...f, validUntil: f.validUntil || null, evidence }); onDone(); onClose(); })}>Record</Button>
    </>}>
      <Field label="Certificate number" required><input className="input" value={f.certificateNo} onChange={(ev) => setF({ ...f, certificateNo: ev.target.value })} /></Field>
      <Field label="Calibrated on"><input className="input" type="date" value={f.calibratedOn} onChange={(ev) => setF({ ...f, calibratedOn: ev.target.value })} /></Field>
      <Field label="Valid until" hint={`Blank: ${e.calibrationIntervalMonths} months from the calibration.`}><input className="input" type="date" value={f.validUntil} onChange={(ev) => setF({ ...f, validUntil: ev.target.value })} /></Field>
      <Field label="Calibrated by"><input className="input" value={f.by} onChange={(ev) => setF({ ...f, by: ev.target.value })} /></Field>
      <AttachUpload label="Attach the certificate" onUploaded={(a) => setEvidence((l) => [...l, { name: a.name, url: a.url }])} />
      <ErrorNote error={error} />
    </Modal>
  );
}

function AddEquipment({ labId, onClose, onDone }: { labId: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: '', serialNo: '', quantity: '1', calibrationRequired: false, calibrationDueOn: '', warrantyUntil: '', amcUntil: '' });
  const { run, busy, error } = useAction();
  return (
    <Modal title="Add instrument" onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || !f.name.trim()} onClick={() => void run(async () => { await labsApi.createEquipment(labId, { ...f, calibrationDueOn: f.calibrationDueOn || null, warrantyUntil: f.warrantyUntil || null, amcUntil: f.amcUntil || null }); onDone(); onClose(); })}>Add</Button>
    </>}>
      <Field label="Name" required><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <div className="lab-form-grid">
        <Field label="Serial no."><input className="input" value={f.serialNo} onChange={(e) => setF({ ...f, serialNo: e.target.value })} /></Field>
        <Field label="Quantity"><input className="input" inputMode="numeric" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
        <Field label="Warranty until"><input className="input" type="date" value={f.warrantyUntil} onChange={(e) => setF({ ...f, warrantyUntil: e.target.value })} /></Field>
        <Field label="AMC until"><input className="input" type="date" value={f.amcUntil} onChange={(e) => setF({ ...f, amcUntil: e.target.value })} /></Field>
      </div>
      <label className="lab-check"><input type="checkbox" checked={f.calibrationRequired} onChange={(e) => setF({ ...f, calibrationRequired: e.target.checked })} /> Needs calibration</label>
      {f.calibrationRequired && <Field label="Calibration due"><input className="input" type="date" value={f.calibrationDueOn} onChange={(e) => setF({ ...f, calibrationDueOn: e.target.value })} /></Field>}
      <ErrorNote error={error} />
    </Modal>
  );
}

// ── Computers ─────────────────────────────────────────────────────────────

function DevicesTab({ labs, labId, setLabId, canManage }: { labs: LabDto[]; labId: string; setLabId: (v: string) => void; canManage: boolean }) {
  const devices = useLoad(() => labsApi.devices({ labId: labId || undefined }), [labId]);
  const software = useLoad(() => labsApi.software({ labId: labId || undefined }), [labId]);
  const [repair, setRepair] = useState<DeviceDto | null>(null);
  const [decom, setDecom] = useState<DeviceDto | null>(null);
  const [seats, setSeats] = useState<SoftwareDto | null>(null);
  const { run, error } = useAction();
  const comp = labs.filter((l) => l.type === 'COMPUTER');
  return (
    <>
      <SectionCard title="Computers and devices" sub="Status, hardware and repairs are recorded by staff; nothing here reads from the machines." actions={<Select hideLabel label="Lab" value={labId} onChange={setLabId} placeholder="All labs" options={comp.map((l) => ({ value: l.id, label: l.name }))} />}>
        <ErrorNote error={error} />
        <Loadable state={devices}>{(rows) => !rows.length ? <EmptyState icon="🖥" title="No devices" sub="Register the lab's computers by tag and serial number." /> : (
          <>
            <div className="kpi-grid">
              <Tile label="Devices" value={rows.length} />
              <Tile label="In use" value={rows.filter((d) => d.status === 'IN_USE').length} tone="good" />
              <Tile label="In repair" value={rows.filter((d) => d.status === 'IN_REPAIR').length} tone={rows.some((d) => d.status === 'IN_REPAIR') ? 'warn' : 'neutral'} />
              <Tile label="Warranty ends in 90 days" value={rows.filter((d) => d.warrantyUntil && new Date(d.warrantyUntil).getTime() - Date.now() < 90 * 86_400_000).length} />
            </div>
            <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Workstation</th><th>Tag · code</th><th>Hardware / OS</th><th>Software</th><th>Warranty / AMC</th><th>Status</th><th /></tr></thead><tbody>
              {rows.map((d) => (
                <tr key={d.id}><td>{d.workstationNo ?? '—'}</td><td>{d.tag}<div className="ops-muted"><code>{d.code}</code>{d.serialNo ? ` · S/N ${d.serialNo}` : ''}</div></td>
                  <td>{[d.hardware?.cpu, d.hardware?.ramGb ? `${d.hardware.ramGb} GB RAM` : null, d.hardware?.storageGb ? `${d.hardware.storageGb} GB` : null].filter(Boolean).join(', ') || '—'}<div className="ops-muted">{d.os ?? ''}</div></td>
                  <td>{d.software.join(', ') || '—'}</td><td>{fmtDate(d.warrantyUntil)}{d.amcUntil ? <div className="ops-muted">AMC {fmtDate(d.amcUntil)}</div> : null}</td>
                  <td><StatusPill status={d.status === 'IN_REPAIR' ? 'PENDING' : d.status === 'IN_USE' ? 'ACTIVE' : 'DRAFT'} label={humanize(d.status)} /></td>
                  <td className="lab-actions">{canManage && <>
                    {d.status === 'IN_REPAIR' ? <Button small variant="soft" onClick={() => void run(async () => { const r = d.repairs.find((x) => !x.closedAt); if (r) await labsApi.closeDeviceRepair(d.id, r._id, { action: 'Repaired' }); void devices.reload(); })}>Repaired</Button>
                      : <Button small variant="soft" onClick={() => setRepair(d)}>Log repair</Button>}
                    <Button small variant="soft" onClick={() => setDecom(d)}>Decommission</Button>
                  </>}</td></tr>
              ))}
            </tbody></table></div>
          </>
        )}</Loadable>
      </SectionCard>
      <SectionCard title="Software and licence seats" sub="Seats and renewal dates only. Licence keys and passwords are not stored here.">
        <Loadable state={software}>{(rows) => !rows.length ? <p className="ops-muted">No software recorded.</p> : (
          <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Software</th><th>Licence</th><th className="num">Seats used</th><th>Renewal</th><th className="num">Cost</th><th /></tr></thead><tbody>
            {rows.map((s) => (
              <tr key={s.id}><td>{s.name}{s.publisher ? <div className="ops-muted">{s.publisher}</div> : null}</td><td>{humanize(s.licenceType)}</td>
                <td className="num">{s.seatsUsed} / {s.seatsTotal || '∞'}{s.seatsTotal > 0 && s.seatsFree === 0 && <div><StatusPill status="BLOCKED" label="Full" /></div>}</td>
                <td>{s.renewalOn ? (s.renewalDaysLeft !== null && s.renewalDaysLeft <= 30 ? <StatusPill status="EXPIRING" label={`${fmtDate(s.renewalOn)} (${s.renewalDaysLeft} d)`} /> : fmtDate(s.renewalOn)) : '—'}</td>
                <td className="num">{s.costPaise ? money(s.costPaise) : '—'}</td>
                <td>{canManage && <Button small variant="soft" onClick={() => setSeats(s)}>Seats</Button>}</td></tr>
            ))}
          </tbody></table></div>
        )}</Loadable>
      </SectionCard>
      {repair && <PromptModal title={`Repair: ${repair.tag}`} label="What is wrong" confirmLabel="Log repair" onClose={() => setRepair(null)} onSubmit={async (issue) => { await labsApi.deviceRepair(repair.id, { issue }); void devices.reload(); }} />}
      {decom && <DecommissionModal d={decom} onClose={() => setDecom(null)} onDone={() => { void devices.reload(); void software.reload(); }} />}
      {seats && devices.data && <SeatsModal s={seats} devices={devices.data} onClose={() => setSeats(null)} onDone={() => { void software.reload(); void devices.reload(); }} />}
    </>
  );
}

function DecommissionModal({ d, onClose, onDone }: { d: DeviceDto; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ reason: '', eWasteHandler: '', certificateNo: '' });
  const [evidence, setEvidence] = useState<Ev>([]);
  const { run, busy, error } = useAction();
  return (
    <Modal title={`Decommission ${d.tag}`} onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button className="btn-danger" disabled={busy || !f.reason.trim() || !f.eWasteHandler.trim() || !evidence.length} onClick={() => void run(async () => { await labsApi.decommission(d.id, { ...f, evidence }); onDone(); onClose(); })}>Decommission</Button>
    </>}>
      <Field label="Reason" required><input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      <Field label="Authorised e-waste recycler" required><input className="input" value={f.eWasteHandler} onChange={(e) => setF({ ...f, eWasteHandler: e.target.value })} /></Field>
      <Field label="Certificate / receipt no."><input className="input" value={f.certificateNo} onChange={(e) => setF({ ...f, certificateNo: e.target.value })} /></Field>
      <AttachUpload label="Attach the handover note (required)" onUploaded={(a) => setEvidence((l) => [...l, { name: a.name, url: a.url }])} />
      {evidence.length > 0 && <ul className="ops-attachments">{evidence.map((e) => <li key={e.url}>📎 {e.name}</li>)}</ul>}
      <DataNote>Its software seats are released. Remove school data from the drive before handover.</DataNote>
      <ErrorNote error={error} />
    </Modal>
  );
}

function SeatsModal({ s, devices, onClose, onDone }: { s: SoftwareDto; devices: DeviceDto[]; onClose: () => void; onDone: () => void }) {
  const [used, setUsed] = useState(new Set(s.deviceIds));
  const { run, busy, error } = useAction();
  const toggle = (id: string, on: boolean) => run(async () => {
    const out = on ? await labsApi.assignSeat(s.id, id) : await labsApi.releaseSeat(s.id, id);
    setUsed(new Set(out.deviceIds)); onDone();
  });
  const pool = devices.filter((d) => !s.labId || d.labId === s.labId);
  return (
    <Modal title={`${s.name}: seats (${used.size} / ${s.seatsTotal || '∞'})`} onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
      <ul className="lab-seat-list">{pool.map((d) => (
        <li key={d.id}><label><input type="checkbox" disabled={busy} checked={used.has(d.id)} onChange={(e) => void toggle(d.id, e.target.checked)} /> {d.workstationNo ?? d.tag} · {d.tag}</label></li>
      ))}</ul>
      <ErrorNote error={error} />
    </Modal>
  );
}

// ── Practicals ────────────────────────────────────────────────────────────

function PlanPractical({ labs, onClose, onDone }: { labs: LabDto[]; onClose: () => void; onDone: () => void }) {
  const sections = useLoad(() => api.allSections().catch(() => api.mySections()), []);
  const [labId, setLabId] = useState(labs[0]?.id ?? '');
  const items = useLoad(() => (labId ? labsApi.items({ labId }) : Promise.resolve([])), [labId]);
  const equipment = useLoad(() => (labId ? labsApi.equipment({ labId }) : Promise.resolve([])), [labId]);
  const [f, setF] = useState({ title: '', subject: '', sectionId: '', date: isoDay(new Date(Date.now() + 2 * 86_400_000)), time: '10:00', duration: '45', safetyNotes: '', devicesNeeded: '' });
  const [need, setNeed] = useState<Record<string, string>>({});
  const [eqNeed, setEqNeed] = useState<Record<string, string>>({});
  const { run, busy, error } = useAction();
  const lab = labs.find((l) => l.id === labId);
  return (
    <Modal wide title="Plan a practical" onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || !f.title.trim() || !labId} onClick={() => void run(async () => {
        const startsAt = new Date(`${f.date}T${f.time}:00+05:30`);
        await labsApi.createSession({
          labId, title: f.title.trim(), subject: f.subject || null, sectionId: f.sectionId || undefined, startsAt: startsAt.toISOString(),
          endsAt: new Date(startsAt.getTime() + (Number(f.duration) || 45) * 60_000).toISOString(), safetyNotes: f.safetyNotes, devicesNeeded: f.devicesNeeded || 0,
          items: Object.entries(need).filter(([, q]) => Number(q) > 0).map(([itemId, quantity]) => ({ itemId, quantity, unit: items.data?.find((i) => i.id === itemId)?.displayUnit })),
          equipment: Object.entries(eqNeed).filter(([, q]) => Number(q) > 0).map(([equipmentId, quantity]) => ({ equipmentId, quantity })),
        });
        onDone(); onClose();
      })}>Plan</Button>
    </>}>
      <div className="lab-form-grid">
        <Select label="Lab" value={labId} onChange={setLabId} options={labs.map((l) => ({ value: l.id, label: l.name }))} />
        <Field label="Title" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Subject"><input className="input" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
        <Loadable state={sections}>{(list) => <Select label="Class" value={f.sectionId} onChange={(v) => setF({ ...f, sectionId: v })} placeholder="Choose a class" options={list.map((s) => ({ value: s.id, label: `${s.gradeName} ${s.name}` }))} />}</Loadable>
        <Field label="Date"><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Starts"><input className="input" type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
        <Field label="Minutes"><input className="input" inputMode="numeric" value={f.duration} onChange={(e) => setF({ ...f, duration: e.target.value })} /></Field>
        {lab?.type === 'COMPUTER' && <Field label="Computers needed"><input className="input" inputMode="numeric" value={f.devicesNeeded} onChange={(e) => setF({ ...f, devicesNeeded: e.target.value })} /></Field>}
      </div>
      {lab?.type !== 'COMPUTER' && (
        <Loadable state={items}>{(list) => list.length ? (
          <fieldset className="lab-need"><legend>Materials for the whole class</legend>
            {list.map((i) => <label key={i.id}><span>{i.name} <span className="ops-muted">({i.onHandDisplay} {i.displayUnit} usable)</span></span><input className="input lab-count" inputMode="decimal" placeholder={i.displayUnit} value={need[i.id] ?? ''} onChange={(e) => setNeed({ ...need, [i.id]: e.target.value })} /></label>)}
          </fieldset>
        ) : null}</Loadable>
      )}
      <Loadable state={equipment}>{(list) => list.length ? (
        <fieldset className="lab-need"><legend>Instruments</legend>
          {list.map((e) => <label key={e.id}><span>{e.name} <span className="ops-muted">({e.quantity} in lab{e.usable ? '' : ', not usable now'})</span></span><input className="input lab-count" inputMode="numeric" value={eqNeed[e.id] ?? ''} onChange={(ev) => setEqNeed({ ...eqNeed, [e.id]: ev.target.value })} /></label>)}
        </fieldset>
      ) : null}</Loadable>
      <Field label="Safety notes"><textarea className="input" rows={3} value={f.safetyNotes} onChange={(e) => setF({ ...f, safetyNotes: e.target.value })} /></Field>
      <ErrorNote error={error} />
    </Modal>
  );
}

function SessionCard({ s, canManage, onChanged, labs }: { s: SessionDto; canManage: boolean; onChanged: () => void; labs: LabDto[] }) {
  const [checks, setChecks] = useState<Set<string>>(new Set());
  const [present, setPresent] = useState<Set<string>>(new Set(s.attendance.filter((a) => a.present && a.enrollmentId).map((a) => a.enrollmentId as string)));
  const [modal, setModal] = useState<null | 'cancel' | 'complete'>(null);
  const { run, busy, error } = useAction();
  const lab = labs.find((l) => l.id === s.labId);
  const act = (fn: () => Promise<unknown>) => void run(async () => { await fn(); onChanged(); });
  const blocking = s.readiness.problems.filter((p) => !p.kind.startsWith('NOTE_'));
  const notes = s.readiness.problems.filter((p) => p.kind.startsWith('NOTE_'));
  return (
    <article className="lab-session">
      <header>
        <div><h3>{s.title}</h3><span className="ops-muted">{s.refNo} · {s.labName} · {s.className ?? 'No class'} · {fmtDateTime(s.startsAt)} · {s.teacherName ?? ''}</span></div>
        <StatusPill status={s.status === 'READY' ? 'APPROVED' : s.status === 'PREP_REQUESTED' ? 'PENDING' : s.status} label={humanize(s.status)} />
      </header>
      {s.items.length > 0 && <p><b>Materials:</b> {s.items.map((i) => `${i.name} ${i.quantityDisplay} ${i.displayUnit}${i.hazardous ? ' ⚠' : ''}`).join(' · ')}</p>}
      {s.equipment.length > 0 && <p><b>Instruments:</b> {s.equipment.map((e) => `${e.name} ×${e.quantity}`).join(' · ')}</p>}
      {s.safetyNotes && <p><b>Safety:</b> {s.safetyNotes}</p>}
      {s.readiness.checkedAt && (
        <div className={blocking.length ? 'lab-ready is-bad' : 'lab-ready is-good'} role="status">
          <b>{blocking.length ? `Not ready (${blocking.length})` : 'Ready'}</b> <span className="ops-muted">checked {fmtDateTime(s.readiness.checkedAt)}</span>
          <ul>{blocking.map((p, i) => <li key={i}>{p.message}</li>)}{notes.map((p, i) => <li key={`n${i}`} className="ops-muted">{p.message}</li>)}</ul>
        </div>
      )}
      {canManage && ['PLANNED', 'PREP_REQUESTED', 'READY'].includes(s.status) && (
        <div className="lab-actions">
          <Button small variant="soft" disabled={busy} onClick={() => act(() => labsApi.readiness(s.id))}>Check readiness</Button>
          {s.status === 'PLANNED' && <Button small variant="soft" disabled={busy} onClick={() => act(() => labsApi.requestPrep(s.id))}>Send to lab assistant</Button>}
          {s.status !== 'READY' && <Button small variant="soft" disabled={busy} onClick={() => act(() => labsApi.markPrepared(s.id))}>Mark prepared</Button>}
          <Button small variant="soft" onClick={() => setModal('cancel')}>Cancel</Button>
        </div>
      )}
      {canManage && ['PLANNED', 'PREP_REQUESTED', 'READY'].includes(s.status) && (lab?.safetyChecklist?.length ?? 0) > 0 && (
        <fieldset className="lab-checklist"><legend>Safety checks before starting</legend>
          {lab?.safetyChecklist.map((c) => <label key={c.item}><input type="checkbox" checked={checks.has(c.item)} onChange={(e) => { const n = new Set(checks); if (e.target.checked) n.add(c.item); else n.delete(c.item); setChecks(n); }} /> {c.item}{c.required ? '' : ' (optional)'}</label>)}
          <Button small disabled={busy} onClick={() => act(() => labsApi.startSession(s.id, [...checks]))}>Start practical</Button>
        </fieldset>
      )}
      {s.status === 'IN_PROGRESS' && canManage && (
        <fieldset className="lab-checklist"><legend>Supervised attendance ({present.size} present)</legend>
          {s.attendance.filter((a) => a.enrollmentId).map((a) => <label key={a.enrollmentId}><input type="checkbox" checked={present.has(a.enrollmentId as string)} onChange={(e) => { const n = new Set(present); if (e.target.checked) n.add(a.enrollmentId as string); else n.delete(a.enrollmentId as string); setPresent(n); }} /> {a.name}</label>)}
          <div className="lab-actions">
            <Button small variant="soft" disabled={busy} onClick={() => act(() => labsApi.attendance(s.id, [...present]))}>Save attendance</Button>
            <Button small disabled={busy} onClick={() => setModal('complete')}>Complete</Button>
          </div>
        </fieldset>
      )}
      {s.status === 'COMPLETED' && <p className="ops-muted">{s.presentCount} present. {s.outcomeNote ?? ''}</p>}
      <ErrorNote error={error} />
      {modal === 'cancel' && <PromptModal title="Cancel practical" label="Reason" danger onClose={() => setModal(null)} onSubmit={async (r) => { await labsApi.cancelSession(s.id, r); onChanged(); }} />}
      {modal === 'complete' && <PromptModal title="Complete practical" label="How it went" required={false} onClose={() => setModal(null)} onSubmit={async (r) => { await labsApi.attendance(s.id, [...present]); await labsApi.completeSession(s.id, r); onChanged(); }} />}
    </article>
  );
}

function SessionsTab({ labs, labId, canManage }: { labs: LabDto[]; labId: string; canManage: boolean }) {
  const [status, setStatus] = useState('open');
  const sessions = useLoad(() => labsApi.sessions({ labId: labId || undefined, status, order: status === 'open' ? 'asc' : 'desc', pageSize: 50 }), [labId, status]);
  const [planning, setPlanning] = useState(false);
  const allLabs = useLoad(() => labsApi.labs(), []);
  return (
    <SectionCard title="Practical sessions" sub="Plan, send to the lab assistant, check readiness against real stock and instruments, run with the safety checklist." actions={<>
      <Select hideLabel label="Show" value={status} onChange={setStatus} options={[{ value: 'open', label: 'Upcoming and running' }, { value: 'COMPLETED', label: 'Completed' }, { value: 'CANCELLED', label: 'Cancelled' }]} />
      {canManage && <Button small onClick={() => setPlanning(true)}>Plan a practical</Button>}
    </>}>
      <Loadable state={sessions}>{(page) => !page.items.length ? <EmptyState icon="🧪" title="No practicals" sub="Plan one to send its materials list to the lab assistant." /> : (
        <div className="lab-sessions">{page.items.map((s) => <SessionCard key={s.id} s={s} canManage={canManage} labs={labs} onChanged={() => void sessions.reload()} />)}</div>
      )}</Loadable>
      {planning && <PlanPractical labs={(allLabs.data?.length ? allLabs.data : labs).filter((l) => l.status === 'ACTIVE')} onClose={() => setPlanning(false)} onDone={() => void sessions.reload()} />}
    </SectionCard>
  );
}

// ── Incidents ─────────────────────────────────────────────────────────────

function IncidentsTab({ labs, labId, canManage }: { labs: LabDto[]; labId: string; canManage: boolean }) {
  const list = useLoad(() => labsApi.incidents({ labId: labId || undefined }), [labId]);
  const [reporting, setReporting] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);
  return (
    <SectionCard title="Incidents" sub="Spills, breakages, injuries and near misses. A concern about a child's welfare goes to Safeguarding; reference it here." actions={canManage ? <Button small onClick={() => setReporting(true)}>Report an incident</Button> : undefined}>
      <Loadable state={list}>{(rows) => !rows.length ? <p className="ops-muted">No incidents recorded.</p> : (
        <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>When</th><th>Lab</th><th>What</th><th>Severity</th><th>Status</th><th /></tr></thead><tbody>
          {rows.map((r) => (
            <tr key={r.id}><td>{fmtDateTime(r.at)}<div className="ops-muted">{r.refNo}</div></td><td>{r.labName}</td><td><b>{humanize(r.kind)}</b>: {r.description}{r.actionsTaken ? <div className="ops-muted">Action: {r.actionsTaken}</div> : null}{r.workOrderId ? <div className="ops-muted">Work order raised</div> : null}</td>
              <td><StatusPill status={r.severity === 'HIGH' ? 'REJECTED' : r.severity === 'MEDIUM' ? 'PENDING' : 'DRAFT'} label={humanize(r.severity)} /></td><td><StatusPill status={r.status} /></td>
              <td>{canManage && r.status === 'OPEN' && <Button small variant="soft" onClick={() => setClosing(r.id)}>Close</Button>}</td></tr>
          ))}
        </tbody></table></div>
      )}</Loadable>
      {reporting && <ReportIncident labs={labs} defaultLab={labId} onClose={() => setReporting(false)} onDone={() => void list.reload()} />}
      {closing && <PromptModal title="Close incident" label="What was done" onClose={() => setClosing(null)} onSubmit={async (note) => { await labsApi.closeIncident(closing, note); void list.reload(); }} />}
    </SectionCard>
  );
}

function ReportIncident({ labs, defaultLab, onClose, onDone }: { labs: LabDto[]; defaultLab: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ labId: defaultLab || labs[0]?.id || '', kind: 'SPILL', severity: 'LOW', description: '', actionsTaken: '', createWorkOrder: false, safeguardingRef: '' });
  const [evidence, setEvidence] = useState<Ev>([]);
  const { run, busy, error } = useAction();
  return (
    <Modal title="Report an incident" onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || !f.description.trim() || !f.labId} onClick={() => void run(async () => { await labsApi.reportIncident({ ...f, safeguardingRef: f.safeguardingRef || null, evidence }); onDone(); onClose(); })}>Report</Button>
    </>}>
      <div className="lab-form-grid">
        <Select label="Lab" value={f.labId} onChange={(v) => setF({ ...f, labId: v })} options={labs.map((l) => ({ value: l.id, label: l.name }))} />
        <Select label="What happened" value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={opts(INCIDENT_KINDS)} />
        <Select label="Severity" value={f.severity} onChange={(v) => setF({ ...f, severity: v })} options={opts(['LOW', 'MEDIUM', 'HIGH'])} />
      </div>
      <Field label="Description" required><textarea className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="Action taken"><textarea className="input" rows={2} value={f.actionsTaken} onChange={(e) => setF({ ...f, actionsTaken: e.target.value })} /></Field>
      <label className="lab-check"><input type="checkbox" checked={f.createWorkOrder} onChange={(e) => setF({ ...f, createWorkOrder: e.target.checked })} /> Raise a maintenance work order for the room</label>
      <Field label="Safeguarding reference" hint="If a concern was raised on the Safeguarding page, its reference only."><input className="input" value={f.safeguardingRef} onChange={(e) => setF({ ...f, safeguardingRef: e.target.value })} /></Field>
      <AttachUpload label="Attach a photo" onUploaded={(a) => setEvidence((l) => [...l, { name: a.name, url: a.url }])} />
      <ErrorNote error={error} />
    </Modal>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export function LabsView() {
  const { permissions } = usePermissions();
  const canManage = Boolean(permissions['labs.manage']);
  const canAll = permissions['labs.manage'] === 'ALL';
  const initial = (useQueryParam('tab') as Tab | null) ?? 'labs';
  const [tab, setTab] = useState<Tab>(['labs', 'stock', 'equipment', 'devices', 'sessions', 'incidents'].includes(initial) ? initial : 'labs');
  const [labId, setLabId] = useState('');
  const [scanned, setScanned] = useState<ScanResult | null>(null);
  const labs = useLoad(() => labsApi.labs(), []);
  const totals = useMemo(() => (labs.data ?? []).reduce((t, l) => ({ expired: t.expired + (l.counts?.expired ?? 0), low: t.low + (l.counts?.lowStock ?? 0), cal: t.cal + (l.counts?.calibrationOverdue ?? 0), inc: t.inc + (l.counts?.openIncidents ?? 0) }), { expired: 0, low: 0, cal: 0, inc: 0 }), [labs.data]);
  const open = (id: string, t: Tab) => { setLabId(id); setTab(t); };
  const onScan = (r: ScanResult) => {
    setScanned(r);
    setLabId(r.labId);
    setTab(r.type === 'BATCH' ? 'stock' : r.type === 'EQUIPMENT' ? 'equipment' : 'devices');
  };
  return (
    <div className="lab-view">
      <Loadable state={labs}>{(list) => (
        <>
          <div className="kpi-grid">
            <Tile label="Labs" value={list.length} />
            <Tile label="Expired batches" value={totals.expired} tone={totals.expired ? 'bad' : 'good'} />
            <Tile label="Items below minimum" value={totals.low} tone={totals.low ? 'warn' : 'good'} />
            <Tile label="Calibration overdue" value={totals.cal} tone={totals.cal ? 'bad' : 'good'} />
            <Tile label="Open incidents" value={totals.inc} tone={totals.inc ? 'warn' : 'good'} />
          </div>
          <ScanBox onResult={onScan} />
          {scanned && scanned.type !== 'BATCH' && (
            <p className="lab-scanned" role="status"><b>Scanned {scanned.type === 'EQUIPMENT' ? `${scanned.equipment?.name} (${scanned.code})` : `${scanned.device?.tag} (${scanned.code}), ${humanize(scanned.device?.status)}`}</b></p>
          )}
          <Tabs<Tab> value={tab} onChange={setTab} tabs={[
            { key: 'labs', label: 'Labs' }, { key: 'stock', label: 'Stock', count: totals.expired + totals.low || null }, { key: 'equipment', label: 'Instruments', count: totals.cal || null },
            { key: 'devices', label: 'Computers & software' }, { key: 'sessions', label: 'Practicals' }, { key: 'incidents', label: 'Incidents', count: totals.inc || null },
          ]} />
          {tab === 'labs' && <LabsTab labs={list} canAll={canAll} onChanged={() => void labs.reload()} open={open} />}
          {tab === 'stock' && <StockTab labs={list} labId={labId} setLabId={setLabId} canManage={canManage} scanned={scanned} />}
          {tab === 'equipment' && <EquipmentTab labs={list} labId={labId} setLabId={setLabId} canManage={canManage} />}
          {tab === 'devices' && <DevicesTab labs={list} labId={labId} setLabId={setLabId} canManage={canManage} />}
          {tab === 'sessions' && <SessionsTab labs={list} labId={labId} canManage={canManage} />}
          {tab === 'incidents' && <IncidentsTab labs={list} labId={labId} canManage={canManage} />}
          <DataNote>Reminders for expiries, calibrations, warranty and AMC ends, licence renewals and low stock appear in My Tasks.</DataNote>
        </>
      )}</Loadable>
    </div>
  );
}

