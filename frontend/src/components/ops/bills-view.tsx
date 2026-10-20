'use client';
import { useState } from 'react';
import { Button, EmptyState, Field, Modal, Select, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { analyticsApi } from '@/lib/analytics-api';
import { useAuth } from '@/lib/auth';
import { usePermissions } from '@/lib/permissions';
import {
  billsApi, BILL_CATEGORIES, BILLING_CYCLES, PAY_MODES,
  type AdjustmentDto, type BillDto, type ConcessionTypeDto, type InvoiceForAdjustmentDto, type ReviewFlagDto, type ServiceAccountDto, type VisitDto,
} from '@/lib/bills-api';
import { AttachUpload } from './attach';
import { Attachments, DataNote, ErrorNote, Loadable, PromptModal, SectionCard, StatusPill, Tabs, Tile, Timeline, fmtDate, humanize, isoDay, money, rupeesToPaise, useAction, useLoad, useQueryParam } from './kit';

/**
 * Bills and services: recurring bills with payments that settle only when a
 * second person confirms them against the bank, service contracts and AMC
 * visits, one renewals list across every register, a review queue whose
 * flags explain themselves, and the cost dashboard. Also the finance extras:
 * fee concessions (with approval) and the accounts export.
 */
type Tab = 'bills' | 'services' | 'renewals' | 'review' | 'dashboard';
type Ev = Array<{ name: string; url: string }>;
const opts = (list: readonly string[]) => list.map((v) => ({ value: v, label: humanize(v) }));
const day = (s: string) => (s ? `${s}T00:00:00+05:30` : null);

// ── Bills ─────────────────────────────────────────────────────────────────

function RecordBill({ accounts, onClose, onDone }: { accounts: ServiceAccountDto[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ accountId: accounts[0]?.id ?? '', billNo: '', billDate: isoDay(), dueOn: isoDay(new Date(Date.now() + 15 * 86_400_000)), amount: '', tax: '', units: '' });
  const [files, setFiles] = useState<Ev>([]);
  const { run, busy, error } = useAction();
  const acct = accounts.find((a) => a.id === f.accountId);
  return (
    <Modal title="Record a bill" onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || !f.accountId || !f.amount} onClick={() => void run(async () => {
        await billsApi.createBill({ accountId: f.accountId, billNo: f.billNo || null, billDate: day(f.billDate), dueOn: day(f.dueOn), amountPaise: rupeesToPaise(f.amount), taxPaise: f.tax ? rupeesToPaise(f.tax) : 0, units: f.units || null, attachments: files });
        onDone(); onClose();
      })}>Record</Button>
    </>}>
      <Select label="Service" value={f.accountId} onChange={(v) => setF({ ...f, accountId: v })} options={accounts.map((a) => ({ value: a.id, label: `${a.name}${a.accountNo ? ` (${a.accountNo})` : ''}` }))} />
      <div className="lab-form-grid">
        <Field label="Bill number"><input className="input" value={f.billNo} onChange={(e) => setF({ ...f, billNo: e.target.value })} /></Field>
        <Field label="Bill date"><input className="input" type="date" value={f.billDate} onChange={(e) => setF({ ...f, billDate: e.target.value })} /></Field>
        <Field label="Due on" required><input className="input" type="date" value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} /></Field>
        <Field label="Amount (₹, incl. tax)" required><input className="input" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Of which tax (₹)"><input className="input" inputMode="decimal" value={f.tax} onChange={(e) => setF({ ...f, tax: e.target.value })} /></Field>
        {acct?.consumptionUnit && <Field label={`Consumption (${acct.consumptionUnit})`}><input className="input" inputMode="decimal" value={f.units} onChange={(e) => setF({ ...f, units: e.target.value })} /></Field>}
      </div>
      {acct?.expectedAmountPaise ? <p className="ops-muted">Usually about {money(acct.expectedAmountPaise)}.</p> : null}
      <AttachUpload label="Attach the bill" onUploaded={(a) => setFiles((l) => [...l, { name: a.name, url: a.url }])} />
      <ErrorNote error={error} />
    </Modal>
  );
}

function PayModal({ b, onClose, onDone }: { b: BillDto; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ amount: String((b.amountPaise - b.recordedPaidPaise) / 100), mode: 'BANK', reference: '', paidOn: isoDay() });
  const [evidence, setEvidence] = useState<Ev>([]);
  const { run, busy, error } = useAction();
  return (
    <Modal title={`Record payment: ${b.accountName ?? b.refNo}`} onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || !f.amount} onClick={() => void run(async () => { await billsApi.recordPayment(b.id, { amountPaise: rupeesToPaise(f.amount), mode: f.mode, reference: f.reference || null, paidOn: day(f.paidOn), evidence }); onDone(); onClose(); })}>Record payment</Button>
    </>}>
      <DataNote>Recorded is not settled: a different person confirms it against the bank statement before the bill counts as paid.</DataNote>
      <div className="lab-form-grid">
        <Field label="Amount (₹)" required><input className="input" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Select label="Mode" value={f.mode} onChange={(v) => setF({ ...f, mode: v })} options={opts(PAY_MODES)} />
        <Field label="Reference (UTR / cheque no.)"><input className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        <Field label="Paid on"><input className="input" type="date" value={f.paidOn} onChange={(e) => setF({ ...f, paidOn: e.target.value })} /></Field>
      </div>
      <AttachUpload label="Attach the payment receipt or screenshot" onUploaded={(a) => setEvidence((l) => [...l, { name: a.name, url: a.url }])} />
      {!evidence.length && <p className="ops-muted">Without evidence the payment shows in the review queue.</p>}
      <ErrorNote error={error} />
    </Modal>
  );
}

function BillRow({ b, canManage, myId, onChanged }: { b: BillDto; canManage: boolean; myId: string | null; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<null | 'pay' | 'dispute' | 'resolve' | 'cancel' | 'snooze' | { confirm: string } | { reject: string }>(null);
  const toast = useToast();
  const detail = useLoad(() => (open ? billsApi.bill(b.id) : Promise.resolve(null)), [open, b.id]);
  const done = (m: string) => { toast(m); onChanged(); };
  return (
    <li className={`tk-row${b.overdue ? ' is-overdue' : ''}`}>
      <div className="tk-main">
        <button type="button" className="tk-title" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{b.accountName ?? humanize(b.category)}{b.billNo ? ` · ${b.billNo}` : ''}</button>
        <div className="tk-meta">
          <StatusPill status={b.overdue ? 'OVERDUE' : b.status === 'PAYMENT_RECORDED' ? 'PENDING' : b.status} label={b.overdue ? 'Overdue' : b.status === 'PAYMENT_RECORDED' ? 'Paid, awaiting bank confirmation' : undefined} />
          <span>{money(b.amountPaise)}</span>
          {b.outstandingPaise > 0 && b.outstandingPaise < b.amountPaise && <span>{money(b.outstandingPaise)} outstanding</span>}
          <span>Due {fmtDate(b.dueOn)}</span>
          {b.units !== null && <span>{b.units} {b.unitLabel ?? ''}</span>}
          {b.task?.status === 'SNOOZED' && <span>Snoozed: {b.task.snoozeReason}</span>}
          {(b.task?.escalationLevel ?? 0) > 0 && <span className="lab-short">Escalated</span>}
        </div>
      </div>
      {canManage && !['PAID', 'CANCELLED'].includes(b.status) && (
        <div className="tk-actions">
          {b.recordedPaidPaise < b.amountPaise && b.status !== 'DISPUTED' && <Button small onClick={() => setModal('pay')}>Record payment</Button>}
          {b.task && <Button small variant="soft" onClick={() => setModal('snooze')}>Snooze reminder</Button>}
          {b.status === 'DISPUTED' ? <Button small variant="soft" onClick={() => setModal('resolve')}>Resolve dispute</Button> : <Button small variant="soft" onClick={() => setModal('dispute')}>Dispute</Button>}
          {!b.payments.some((p) => p.status !== 'REJECTED') && <Button small variant="soft" onClick={() => setModal('cancel')}>Cancel</Button>}
        </div>
      )}
      {open && (
        <div className="tk-detail">
          <p className="ops-muted">{b.refNo} · bill date {fmtDate(b.billDate)}{b.periodFrom ? ` · period ${fmtDate(b.periodFrom)} – ${fmtDate(b.periodTo)}` : ''}{b.disputeNote ? ` · disputed: ${b.disputeNote}` : ''}</p>
          <div><b>Bill:</b> <Attachments items={b.attachments} /></div>
          {b.payments.length > 0 && (
            <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Paid on</th><th className="num">Amount</th><th>Mode · ref</th><th>Evidence</th><th>Status</th><th /></tr></thead><tbody>
              {b.payments.map((p) => (
                <tr key={p._id}><td>{fmtDate(p.paidOn)}</td><td className="num">{money(p.amountPaise)}</td><td>{humanize(p.mode)}{p.reference ? ` · ${p.reference}` : ''}<div className="ops-muted">by {p.recordedByName ?? '—'}</div></td>
                  <td><Attachments items={p.evidence} /></td><td><StatusPill status={p.status === 'RECORDED' ? 'PENDING' : p.status} label={p.status === 'RECORDED' ? 'Awaiting confirmation' : undefined} />{p.bankReference ? <div className="ops-muted">{p.bankReference}</div> : null}</td>
                  <td>{canManage && p.status === 'RECORDED' && (p.recordedByProfileId === myId ? <span className="ops-muted">Someone else confirms</span> : <>
                    <Button small onClick={() => setModal({ confirm: p._id })}>Confirm</Button> <Button small variant="soft" onClick={() => setModal({ reject: p._id })}>Reject</Button></>)}</td></tr>
              ))}
            </tbody></table></div>
          )}
          <Loadable state={detail}>{(d) => (d ? <Timeline items={d.history} /> : null)}</Loadable>
        </div>
      )}
      {modal === 'pay' && <PayModal b={b} onClose={() => setModal(null)} onDone={() => done('Payment recorded; it settles when confirmed')} />}
      {modal === 'dispute' && <PromptModal title="Dispute this bill" label="What is wrong with it" onClose={() => setModal(null)} onSubmit={async (reason) => { await billsApi.setStatus(b.id, { action: 'DISPUTE', reason }); done('Disputed'); }} />}
      {modal === 'resolve' && <ResolveModal b={b} onClose={() => setModal(null)} onDone={() => done('Dispute resolved')} />}
      {modal === 'cancel' && <PromptModal title="Cancel this bill" label="Why (e.g. recorded twice)" danger onClose={() => setModal(null)} onSubmit={async (reason) => { await billsApi.setStatus(b.id, { action: 'CANCEL', reason }); done('Cancelled'); }} />}
      {modal === 'snooze' && b.task && <SnoozeBill taskId={b.task.id} onClose={() => setModal(null)} onDone={() => done('Reminder snoozed')} />}
      {modal && typeof modal === 'object' && 'confirm' in modal && <PromptModal title="Confirm against the bank" label="Bank reference (UTR or statement line)" multiline={false} confirmLabel="Confirm" onClose={() => setModal(null)} onSubmit={async (bankReference) => { await billsApi.confirmPayment(b.id, modal.confirm, { decision: 'CONFIRM', bankReference }); done('Confirmed'); }} />}
      {modal && typeof modal === 'object' && 'reject' in modal && <PromptModal title="Reject this payment" label="Why (not found in the statement…)" danger onClose={() => setModal(null)} onSubmit={async (reason) => { await billsApi.confirmPayment(b.id, modal.reject, { decision: 'REJECT', reason }); done('Rejected'); }} />}
    </li>
  );
}

function ResolveModal({ b, onClose, onDone }: { b: BillDto; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [revised, setRevised] = useState('');
  const { run, busy, error } = useAction();
  return (
    <Modal title="Resolve dispute" onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || !reason.trim()} onClick={() => void run(async () => { await billsApi.setStatus(b.id, { action: 'RESOLVE_DISPUTE', reason, ...(revised ? { revisedAmountPaise: rupeesToPaise(revised) } : {}) }); onDone(); onClose(); })}>Resolve</Button>
    </>}>
      <Field label="Outcome" required><textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <Field label="Revised amount from the provider (₹)" hint={`Leave blank to keep ${money(b.amountPaise)}. The old amount stays in the history.`}><input className="input" inputMode="decimal" value={revised} onChange={(e) => setRevised(e.target.value)} /></Field>
      <ErrorNote error={error} />
    </Modal>
  );
}

function SnoozeBill({ taskId, onClose, onDone }: { taskId: string; onClose: () => void; onDone: () => void }) {
  const tomorrow = isoDay(new Date(Date.now() + 86_400_000));
  const [until, setUntil] = useState(tomorrow);
  const [reason, setReason] = useState('');
  const { run, busy, error } = useAction();
  return (
    <Modal title="Snooze the reminder" onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Back</Button>
      <Button disabled={busy || !reason.trim()} onClick={() => void run(async () => { await analyticsApi.snoozeTask(taskId, `${until}T09:00:00+05:30`, reason.trim()); onDone(); onClose(); })}>Snooze</Button>
    </>}>
      <Field label="Until"><input className="input" type="date" min={tomorrow} value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
      <Field label="Reason" required hint="Recorded on the task; an overdue bill still escalates."><textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <ErrorNote error={error} />
    </Modal>
  );
}

function BillsTab({ canManage, myId }: { canManage: boolean; myId: string | null }) {
  const [status, setStatus] = useState('open');
  const [category, setCategory] = useState('');
  const bills = useLoad(() => billsApi.bills({ status: status || undefined, category: category || undefined, pageSize: 100 }), [status, category]);
  const accounts = useLoad(() => billsApi.accounts({ status: 'ACTIVE' }), []);
  const [adding, setAdding] = useState(false);
  return (
    <SectionCard title="Bills" sub="Each unpaid bill is a reminder in My Tasks for its owner, with escalation when overdue." actions={<>
      <Select hideLabel label="Status" value={status} onChange={setStatus} options={[{ value: 'open', label: 'Unpaid or unconfirmed' }, { value: 'overdue', label: 'Overdue' }, { value: 'unconfirmed', label: 'Payment awaiting confirmation' }, { value: 'PAID', label: 'Paid' }, { value: 'DISPUTED', label: 'Disputed' }, { value: '', label: 'All' }]} />
      <Select hideLabel label="Category" value={category} onChange={setCategory} placeholder="All categories" options={opts(BILL_CATEGORIES)} />
      {canManage && <Button small disabled={!accounts.data?.length} onClick={() => setAdding(true)}>Record a bill</Button>}
    </>}>
      <Loadable state={bills}>{(page) => !page.items.length ? <EmptyState icon="🧾" title="Nothing here" sub="No bills match." /> : (
        <ul className="tk-list">{page.items.map((b) => <BillRow key={b.id} b={b} canManage={canManage} myId={myId} onChanged={() => void bills.reload()} />)}</ul>
      )}</Loadable>
      {adding && accounts.data && <RecordBill accounts={accounts.data} onClose={() => setAdding(false)} onDone={() => void bills.reload()} />}
    </SectionCard>
  );
}

// ── Services and contracts ────────────────────────────────────────────────

function AccountForm({ initial, onClose, onDone }: { initial?: ServiceAccountDto; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    name: initial?.name ?? '', category: initial?.category ?? 'ELECTRICITY', vendorName: initial?.vendorName ?? '', accountNo: initial?.accountNo ?? '', billingCycle: initial?.billingCycle ?? 'MONTHLY',
    expected: initial?.expectedAmountPaise ? String(initial.expectedAmountPaise / 100) : '', nextDueOn: initial?.nextDueOn?.slice(0, 10) ?? '', consumptionUnit: initial?.consumptionUnit ?? '',
    contractEndsOn: initial?.contractEndsOn?.slice(0, 10) ?? '', noticeDays: String(initial?.noticeDays ?? 30), autoRenews: initial?.autoRenews ?? false, visitsPerYear: String(initial?.visitsPerYear ?? 0), firstVisitOn: '',
  });
  const { run, busy, error } = useAction();
  return (
    <Modal wide title={initial ? `Edit ${initial.name}` : 'Add a recurring service'} onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || !f.name.trim()} onClick={() => void run(async () => {
        const body = { name: f.name.trim(), category: f.category, vendorName: f.vendorName || null, accountNo: f.accountNo || null, billingCycle: f.billingCycle, expectedAmountPaise: f.expected ? rupeesToPaise(f.expected) : 0, nextDueOn: day(f.nextDueOn), consumptionUnit: f.consumptionUnit || null, contractEndsOn: day(f.contractEndsOn), noticeDays: f.noticeDays, autoRenews: f.autoRenews, visitsPerYear: f.visitsPerYear, ...(initial ? {} : { firstVisitOn: day(f.firstVisitOn) }) };
        if (initial) await billsApi.updateAccount(initial.id, body); else await billsApi.createAccount(body);
        onDone(); onClose();
      })}>Save</Button>
    </>}>
      <div className="lab-form-grid">
        <Field label="Name" required><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Electricity — main meter" /></Field>
        <Select label="Category" value={f.category} onChange={(v) => setF({ ...f, category: v })} options={opts(BILL_CATEGORIES)} />
        <Field label="Provider"><input className="input" value={f.vendorName} onChange={(e) => setF({ ...f, vendorName: e.target.value })} /></Field>
        <Field label="Consumer / account / policy no." hint="Not a password."><input className="input" value={f.accountNo} onChange={(e) => setF({ ...f, accountNo: e.target.value })} /></Field>
        <Select label="Billing cycle" value={f.billingCycle} onChange={(v) => setF({ ...f, billingCycle: v })} options={opts(BILLING_CYCLES)} />
        <Field label="Usual amount (₹)"><input className="input" inputMode="decimal" value={f.expected} onChange={(e) => setF({ ...f, expected: e.target.value })} /></Field>
        <Field label="Next bill due"><input className="input" type="date" value={f.nextDueOn} onChange={(e) => setF({ ...f, nextDueOn: e.target.value })} /></Field>
        <Field label="Consumption unit" hint="kWh, kL… for utilities"><input className="input" value={f.consumptionUnit} onChange={(e) => setF({ ...f, consumptionUnit: e.target.value })} /></Field>
        <Field label="Contract ends"><input className="input" type="date" value={f.contractEndsOn} onChange={(e) => setF({ ...f, contractEndsOn: e.target.value })} /></Field>
        <Field label="Notice period (days)"><input className="input" inputMode="numeric" value={f.noticeDays} onChange={(e) => setF({ ...f, noticeDays: e.target.value })} /></Field>
        <Field label="Service visits per year" hint="AMC visits; 0 for none"><input className="input" inputMode="numeric" value={f.visitsPerYear} onChange={(e) => setF({ ...f, visitsPerYear: e.target.value })} /></Field>
        {!initial && Number(f.visitsPerYear) > 0 && <Field label="First visit on"><input className="input" type="date" value={f.firstVisitOn} onChange={(e) => setF({ ...f, firstVisitOn: e.target.value })} /></Field>}
      </div>
      <label className="lab-check"><input type="checkbox" checked={f.autoRenews} onChange={(e) => setF({ ...f, autoRenews: e.target.checked })} /> Renews automatically unless notice is given</label>
      <ErrorNote error={error} />
    </Modal>
  );
}

function VisitClose({ v, onClose, onDone }: { v: VisitDto; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ outcome: 'DONE', technician: '', findings: '', reason: '' });
  const [evidence, setEvidence] = useState<Ev>([]);
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <Modal title={`Close visit: ${v.accountName}`} onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || (f.outcome === 'DONE' ? !evidence.length : !f.reason.trim())} onClick={() => void run(async () => {
        const out = await billsApi.completeVisit(v.id, { outcome: f.outcome, technician: f.technician || null, findings: f.findings || null, reason: f.reason || null, evidence });
        toast(out.next ? `Next visit scheduled for ${fmtDate(out.next.scheduledOn)}` : 'Visit closed'); onDone(); onClose();
      })}>Close visit</Button>
    </>}>
      <Select label="Outcome" value={f.outcome} onChange={(o) => setF({ ...f, outcome: o })} options={[{ value: 'DONE', label: 'Done' }, { value: 'MISSED', label: 'Vendor did not come' }, { value: 'CANCELLED', label: 'Cancelled' }]} />
      {f.outcome === 'DONE' ? (<>
        <Field label="Technician"><input className="input" value={f.technician} onChange={(e) => setF({ ...f, technician: e.target.value })} /></Field>
        <Field label="Findings"><textarea className="input" rows={3} value={f.findings} onChange={(e) => setF({ ...f, findings: e.target.value })} /></Field>
        <AttachUpload label="Attach the service report or photos (required)" onUploaded={(a) => setEvidence((l) => [...l, { name: a.name, url: a.url }])} />
        {evidence.length > 0 && <ul className="ops-attachments">{evidence.map((e) => <li key={e.url}>📎 {e.name}</li>)}</ul>}
      </>) : <Field label="Reason" required><textarea className="input" rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>}
      <ErrorNote error={error} />
    </Modal>
  );
}

function ServicesTab({ canManage }: { canManage: boolean }) {
  const accounts = useLoad(() => billsApi.accounts(), []);
  const visits = useLoad(() => billsApi.visits({ status: 'SCHEDULED' }), []);
  const [editing, setEditing] = useState<ServiceAccountDto | 'new' | null>(null);
  const [closing, setClosing] = useState<VisitDto | null>(null);
  return (
    <>
      <SectionCard title="Recurring services and contracts" sub="Utilities, AMCs, subscriptions, rent and other services the school pays for again and again." actions={canManage ? <Button small onClick={() => setEditing('new')}>Add service</Button> : undefined}>
        <Loadable state={accounts}>{(rows) => !rows.length ? <EmptyState icon="🔁" title="No services yet" sub="Add the electricity connection, water, internet and AMCs." /> : (
          <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Service</th><th>Provider · account</th><th>Cycle</th><th className="num">Usual</th><th className="num">Last bill</th><th>Next due</th><th>Contract</th><th>Owner</th><th /></tr></thead><tbody>
            {rows.map((a) => (
              <tr key={a.id}><td>{a.name}<div className="ops-muted">{humanize(a.category)}{a.status !== 'ACTIVE' ? ` · ${humanize(a.status)}` : ''}</div></td><td>{a.vendorName ?? '—'}<div className="ops-muted">{a.accountNo ?? ''}</div></td>
                <td>{humanize(a.billingCycle)}</td><td className="num">{money(a.expectedAmountPaise)}</td><td className="num">{a.lastAmountPaise !== null && a.lastAmountPaise !== undefined ? money(a.lastAmountPaise) : '—'}<div className="ops-muted">{fmtDate(a.lastBillDate)}</div></td>
                <td>{fmtDate(a.nextDueOn)}</td><td>{a.contractEndsOn ? <>Ends {fmtDate(a.contractEndsOn)}<div className="ops-muted">Notice by {fmtDate(a.noticeBy)}{a.autoRenews ? ' · auto-renews' : ''}</div></> : '—'}{a.nextVisitOn ? <div className="ops-muted">Next visit {fmtDate(a.nextVisitOn)}</div> : null}</td>
                <td>{a.ownerName ?? '—'}</td><td>{canManage && <Button small variant="soft" onClick={() => setEditing(a)}>Edit</Button>}</td></tr>
            ))}
          </tbody></table></div>
        )}</Loadable>
      </SectionCard>
      <SectionCard title="Scheduled service visits" sub="A visit closes with the service report; the next one is scheduled from it.">
        <Loadable state={visits}>{(rows) => !rows.length ? <p className="ops-muted">No visits scheduled.</p> : (
          <ul className="tk-list">{rows.map((v) => (
            <li key={v.id} className={`tk-row${v.overdue ? ' is-overdue' : ''}`}>
              <div className="tk-main"><span className="tk-title">{v.accountName}</span><div className="tk-meta"><StatusPill status={v.overdue ? 'OVERDUE' : 'SCHEDULED'} label={v.overdue ? 'Overdue' : undefined} /><span>{fmtDate(v.scheduledOn)}</span><span>{v.vendorName ?? ''}</span><span>{v.refNo}</span></div></div>
              {canManage && <div className="tk-actions"><Button small onClick={() => setClosing(v)}>Close visit</Button></div>}
            </li>
          ))}</ul>
        )}</Loadable>
      </SectionCard>
      {editing && <AccountForm initial={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onDone={() => void accounts.reload()} />}
      {closing && <VisitClose v={closing} onClose={() => setClosing(null)} onDone={() => { void visits.reload(); void accounts.reload(); }} />}
    </>
  );
}

// ── Renewals ──────────────────────────────────────────────────────────────

function RenewalsTab() {
  const [within, setWithin] = useState('90');
  const data = useLoad(() => billsApi.renewals(Number(within)), [within]);
  return (
    <SectionCard title="Renewals" sub="Licences, agreements, warranties, AMCs, lab calibrations and software licences in one list, sorted by when a decision is needed." actions={
      <Select hideLabel label="Window" value={within} onChange={setWithin} options={[{ value: '30', label: 'Next 30 days' }, { value: '90', label: 'Next quarter' }, { value: '180', label: 'Next 6 months' }, { value: '365', label: 'Next year' }]} />
    }>
      <Loadable state={data}>{(d) => (<>
        <div className="kpi-grid">
          <Tile label="Due" value={d.total.count} />
          <Tile label="Already past due" value={d.total.overdue} tone={d.total.overdue ? 'bad' : 'good'} />
          <Tile label="Expected cost" value={money(d.total.costPaise)} />
          <Tile label="No owner" value={d.total.unowned} tone={d.total.unowned ? 'warn' : 'good'} />
        </div>
        {!d.items.length ? <p className="ops-muted">Nothing due in this window.</p> : (
          <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Decide by</th><th>What</th><th>Ends</th><th className="num">Cost</th><th>Owner</th><th>If nothing is done</th></tr></thead><tbody>
            {d.items.map((r) => (
              <tr key={`${r.source}:${r.entityId}`} className={r.overdue ? 'is-low' : undefined}>
                <td>{fmtDate(r.decideBy)}<div className="ops-muted">{r.decideInDays < 0 ? `${-r.decideInDays} d ago` : `in ${r.decideInDays} d`}</div></td>
                <td>{r.title}<div className="ops-muted">{humanize(r.source)}{r.counterparty ? ` · ${r.counterparty}` : ''}</div></td>
                <td>{r.overdue ? <StatusPill status="EXPIRED" label={fmtDate(r.dueOn)} /> : fmtDate(r.dueOn)}</td>
                <td className="num">{r.costPaise ? money(r.costPaise) : '—'}</td><td>{r.ownerName ?? <span className="lab-short">Unassigned</span>}</td><td>{r.consequence}</td>
              </tr>
            ))}
          </tbody></table></div>
        )}
        <DataNote>{d.definition} Each item inside its lead time is also a task in My Tasks.</DataNote>
      </>)}</Loadable>
    </SectionCard>
  );
}

// ── Review queue ──────────────────────────────────────────────────────────

function ReviewTab({ canManage }: { canManage: boolean }) {
  const [show, setShow] = useState('open');
  const q = useLoad(() => billsApi.review(show), [show]);
  const [reviewing, setReviewing] = useState<{ flag: ReviewFlagDto; status: string } | null>(null);
  return (
    <SectionCard title="Review queue" sub="Things worth a second look, each with the rule and the numbers that raised it. A flag is a prompt to check, not a finding." actions={
      <Select hideLabel label="Show" value={show} onChange={setShow} options={[{ value: 'open', label: 'Needs review' }, { value: 'reviewed', label: 'Reviewed' }, { value: 'all', label: 'All' }]} />
    }>
      <Loadable state={q}>{(d) => !d.items.length ? <EmptyState icon="✓" title="Nothing to review" sub="No flags in this view." /> : (
        <ul className="bill-flags">{d.items.map((f) => (
          <li key={f.key} className={`bill-flag sev-${f.severity.toLowerCase()}`}>
            <div className="bill-flag-head"><b>{f.title}</b><span className="lab-badge">{humanize(f.code)}</span>{f.amountPaise ? <span>{money(f.amountPaise)}</span> : null}</div>
            <p>{f.explanation}</p>
            {f.review ? <p className="ops-muted">{humanize(f.review.status)} by {f.review.byName ?? '—'} on {fmtDate(f.review.at)}: {f.review.note}</p> : canManage && (
              <div className="lab-actions">
                <Button small variant="soft" onClick={() => setReviewing({ flag: f, status: 'EXPLAINED' })}>Explained</Button>
                <Button small variant="soft" onClick={() => setReviewing({ flag: f, status: 'DISMISSED' })}>Not a concern</Button>
                <Button small variant="soft" onClick={() => setReviewing({ flag: f, status: 'ESCALATED' })}>Needs follow-up</Button>
              </div>
            )}
          </li>
        ))}</ul>
      )}</Loadable>
      {reviewing && <PromptModal title={humanize(reviewing.status)} label="Note (what you checked)" onClose={() => setReviewing(null)} onSubmit={async (note) => { await billsApi.reviewFlag(reviewing.flag.key, reviewing.status, note); void q.reload(); }} />}
    </SectionCard>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────

function DashboardTab() {
  const [preset, setPreset] = useState('financialYear');
  const [compare, setCompare] = useState('lastYear');
  const d = useLoad(() => billsApi.dashboard({ preset, compare }), [preset, compare]);
  return (
    <SectionCard title="Cost of services" sub="Bills by category and month, against a comparison period." actions={<>
      <Select hideLabel label="Period" value={preset} onChange={setPreset} options={[{ value: 'month', label: 'This month' }, { value: 'quarter', label: 'This quarter' }, { value: 'financialYear', label: 'This financial year' }, { value: 'year', label: 'This calendar year' }]} />
      <Select hideLabel label="Compare with" value={compare} onChange={setCompare} options={[{ value: 'lastYear', label: 'Same period last year' }, { value: 'previous', label: 'Previous period' }, { value: 'none', label: 'No comparison' }]} />
    </>}>
      <Loadable state={d}>{(x) => {
        const max = Math.max(1, ...x.series.map((s) => s.totalPaise));
        return (<>
          <div className="kpi-grid">
            <Tile label={x.period.label} value={money(x.totalPaise)} />
            <Tile label={x.comparison?.label ?? 'Comparison'} value={x.previousTotalPaise !== null ? money(x.previousTotalPaise) : '—'} />
            <Tile label="Change" value={x.change.comparable ? `${x.change.pct! > 0 ? '+' : ''}${x.change.pct}%` : 'Not comparable'} tone={x.change.comparable && (x.change.pct ?? 0) > 10 ? 'warn' : 'neutral'} />
            <Tile label="Outstanding now" value={money(x.open.outstandingPaise)} tone={x.open.overdue ? 'bad' : 'neutral'} />
          </div>
          {!x.change.comparable && x.change.reason && <p className="ops-muted">{x.change.reason}.</p>}
          <h3 className="bill-sub">By month</h3>
          <ul className="bill-bars" aria-label="Bills by month">{x.series.map((s) => (
            <li key={s.label}><span className="bill-bar-label">{s.label}</span><span className="bill-bar-track"><span className="bill-bar" style={{ width: `${(s.totalPaise / max) * 100}%` }} /></span><span className="bill-bar-value">{money(s.totalPaise)}</span></li>
          ))}</ul>
          <h3 className="bill-sub">By category</h3>
          <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Category</th><th className="num">Bills</th><th className="num">Amount</th><th className="num">Comparison</th><th className="num">Change</th><th className="num">Consumption</th><th className="num">Confirmed paid</th></tr></thead><tbody>
            {x.byCategory.map((c) => (
              <tr key={c.category}><td>{humanize(c.category)}</td><td className="num">{c.bills}</td><td className="num">{money(c.amountPaise)}</td><td className="num">{c.previousPaise !== null ? money(c.previousPaise) : '—'}</td>
                <td className="num">{c.change.comparable ? `${c.change.pct! > 0 ? '+' : ''}${c.change.pct}%` : '—'}</td><td className="num">{c.units || '—'}</td><td className="num">{money(c.confirmedPaidPaise)}</td></tr>
            ))}
          </tbody></table></div>
          {Object.values(x.definitions).map((t) => <DataNote key={t}>{t}</DataNote>)}
        </>);
      }}</Loadable>
    </SectionCard>
  );
}

export function BillsView() {
  const { permissions } = usePermissions();
  const canManage = permissions['bills.manage'] === 'ALL';
  const { me } = useAuth();
  const initial = (useQueryParam('tab') as Tab | null) ?? 'bills';
  const [tab, setTab] = useState<Tab>(['bills', 'services', 'renewals', 'review', 'dashboard'].includes(initial) ? initial : 'bills');
  return (
    <div className="bill-view">
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ key: 'bills', label: 'Bills' }, { key: 'services', label: 'Services & contracts' }, { key: 'renewals', label: 'Renewals' }, { key: 'review', label: 'Review queue' }, { key: 'dashboard', label: 'Cost dashboard' }]} />
      {tab === 'bills' && <BillsTab canManage={canManage} myId={me?.profile?.id ?? me?.activeProfileId ?? null} />}
      {tab === 'services' && <ServicesTab canManage={canManage} />}
      {tab === 'renewals' && <RenewalsTab />}
      {tab === 'review' && <ReviewTab canManage={canManage} />}
      {tab === 'dashboard' && <DashboardTab />}
    </div>
  );
}

// ── Finance extras: concessions ───────────────────────────────────────────

function ConcessionTypeForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ code: '', name: '', kind: 'SIBLING', method: 'PERCENT', percent: '', amount: '', eligibility: '' });
  const { run, busy, error } = useAction();
  return (
    <Modal title="Add a concession scheme" onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || !f.code.trim() || !f.name.trim()} onClick={() => void run(async () => {
        await billsApi.createConcessionType({ code: f.code, name: f.name, kind: f.kind, method: f.method, valueBp: f.method === 'PERCENT' ? Math.round(Number(f.percent) * 100) : undefined, amountPaise: f.method === 'FIXED' ? rupeesToPaise(f.amount) : undefined, eligibility: f.eligibility || null });
        onDone(); onClose();
      })}>Add</Button>
    </>}>
      <div className="lab-form-grid">
        <Field label="Code" required><input className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <Field label="Name" required><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Select label="Kind" value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={opts(['SIBLING', 'STAFF_WARD', 'MERIT', 'RTE', 'NEED_BASED', 'SPORTS', 'OTHER'])} />
        <Select label="How much" value={f.method} onChange={(v) => setF({ ...f, method: v })} options={[{ value: 'PERCENT', label: 'Percentage' }, { value: 'FIXED', label: 'Fixed amount' }, { value: 'DISCRETIONARY', label: 'Decided per case' }]} />
        {f.method === 'PERCENT' && <Field label="Percent" required><input className="input" inputMode="decimal" value={f.percent} onChange={(e) => setF({ ...f, percent: e.target.value })} /></Field>}
        {f.method === 'FIXED' && <Field label="Amount per invoice (₹)" required><input className="input" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>}
      </div>
      <Field label="Eligibility (what has to be shown)"><textarea className="input" rows={2} value={f.eligibility} onChange={(e) => setF({ ...f, eligibility: e.target.value })} /></Field>
      <ErrorNote error={error} />
    </Modal>
  );
}

function RequestAdjustment({ types, canFeesManage, onClose, onDone }: { types: ConcessionTypeDto[]; canFeesManage: boolean; onClose: () => void; onDone: () => void }) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const found = useLoad(() => (query ? api.invoicesPage({ search: query, pageSize: 10 }).then((p) => p.items) : Promise.resolve([])), [query]);
  const [invoiceId, setInvoiceId] = useState('');
  const inv = useLoad<InvoiceForAdjustmentDto | null>(() => (invoiceId ? billsApi.invoiceForAdjustment(invoiceId) : Promise.resolve(null)), [invoiceId]);
  const [f, setF] = useState({ kind: 'CONCESSION', typeId: types.find((t) => t.active)?.id ?? '', amount: '', reason: '' });
  const [evidence, setEvidence] = useState<Ev>([]);
  const { run, busy, error } = useAction();
  const type = types.find((t) => t.id === f.typeId);
  const needsAmount = f.kind === 'CREDIT_NOTE' || (f.kind === 'CONCESSION' && type?.method === 'DISCRETIONARY');
  return (
    <Modal wide title="Concession, credit note or void" onClose={onClose} footer={<>
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy || !invoiceId || !f.reason.trim() || (needsAmount && !f.amount)} onClick={() => void run(async () => {
        await billsApi.requestAdjustment({ kind: f.kind, invoiceId, concessionTypeId: f.kind === 'CONCESSION' ? f.typeId : undefined, amountPaise: needsAmount ? rupeesToPaise(f.amount) : undefined, reason: f.reason, evidence });
        onDone(); onClose();
      })}>Send for approval</Button>
    </>}>
      <form className="lab-scan-row" onSubmit={(e) => { e.preventDefault(); setQuery(search.trim()); }}>
        <input className="input" aria-label="Find an invoice" placeholder="Invoice number or student name" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button type="submit" variant="soft">Find</Button>
      </form>
      <Loadable state={found}>{(list) => list.length ? <Select label="Invoice" value={invoiceId} onChange={setInvoiceId} placeholder="Choose an invoice" options={list.map((i) => ({ value: i.id, label: `${i.invoiceNo} · ${i.studentName} · ${money(i.totalPaise)} (${humanize(i.status)})` }))} /> : null}</Loadable>
      <Loadable state={inv}>{(d) => d ? (
        <p className="ops-muted">Total {money(d.invoice.totalPaise)}{d.invoice.grossTotalPaise !== null ? ` (issued ${money(d.invoice.grossTotalPaise)})` : ''} · paid {money(d.invoice.paidPaise)} · can still be reduced by {money(d.adjustablePaise)}{d.reservedPaise ? ` (${money(d.reservedPaise)} waiting for approval)` : ''}</p>
      ) : null}</Loadable>
      <div className="lab-form-grid">
        <Select label="Kind" value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={[{ value: 'CONCESSION', label: 'Concession' }, ...(canFeesManage ? [{ value: 'CREDIT_NOTE', label: 'Credit note (correction)' }, { value: 'VOID', label: 'Void the invoice' }] : [])]} />
        {f.kind === 'CONCESSION' && <Select label="Scheme" value={f.typeId} onChange={(v) => setF({ ...f, typeId: v })} options={types.filter((t) => t.active).map((t) => ({ value: t.id, label: t.name }))} />}
        {needsAmount && <Field label="Amount (₹)" required><input className="input" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>}
      </div>
      {type?.eligibility && f.kind === 'CONCESSION' && <p className="ops-muted">Eligibility: {type.eligibility}</p>}
      <Field label="Reason" required><textarea className="input" rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      <AttachUpload label="Attach supporting document" onUploaded={(a) => setEvidence((l) => [...l, { name: a.name, url: a.url }])} />
      <DataNote>Nothing changes on the invoice until the request is approved. The issued amount stays on record; a void keeps the invoice as cancelled.</DataNote>
      <ErrorNote error={error} />
    </Modal>
  );
}

export function ConcessionsView() {
  const { permissions } = usePermissions();
  const canFeesManage = permissions['fees.manage'] === 'ALL';
  const types = useLoad(() => billsApi.concessionTypes(), []);
  const [status, setStatus] = useState('');
  const list = useLoad(() => billsApi.adjustments({ status: status || undefined }), [status]);
  const [modal, setModal] = useState<null | 'type' | 'request'>(null);
  const [withdraw, setWithdraw] = useState<AdjustmentDto | null>(null);
  return (
    <div className="bill-view">
      <SectionCard title="Concession schemes" sub="Applied only through approval, as a recorded adjustment on the invoice." actions={<Button small variant="soft" onClick={() => setModal('type')}>Add scheme</Button>}>
        <Loadable state={types}>{(rows) => !rows.length ? <p className="ops-muted">No schemes yet.</p> : (
          <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Scheme</th><th>Kind</th><th>Amount</th><th>Applies to</th><th>Eligibility</th></tr></thead><tbody>
            {rows.map((t) => <tr key={t.id}><td>{t.name} <span className="ops-muted">{t.code}</span>{!t.active && <StatusPill status="CANCELLED" label="Inactive" />}</td><td>{humanize(t.kind)}</td>
              <td>{t.method === 'PERCENT' ? `${(t.valueBp ?? 0) / 100}%` : t.method === 'FIXED' ? money(t.amountPaise) : 'Per case'}</td><td>{t.feeHeadNames.join(', ') || 'All fees'}</td><td>{t.eligibility ?? '—'}</td></tr>)}
          </tbody></table></div>
        )}</Loadable>
      </SectionCard>
      <SectionCard title="Adjustments" sub="Concessions, credit notes and voids, with the invoice total before and after." actions={<>
        <Select hideLabel label="Status" value={status} onChange={setStatus} placeholder="All" options={opts(['PENDING_APPROVAL', 'APPLIED', 'REJECTED', 'WITHDRAWN'])} />
        <Button small disabled={!types.data} onClick={() => setModal('request')}>New request</Button>
      </>}>
        <Loadable state={list}>{(rows) => !rows.length ? <EmptyState icon="％" title="No adjustments" sub="Requests go to the approvals inbox." /> : (
          <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Ref</th><th>Student · invoice</th><th>Kind</th><th className="num">Amount</th><th>Before → after</th><th>Status</th><th /></tr></thead><tbody>
            {rows.map((a) => <tr key={a.id}><td>{a.refNo}<div className="ops-muted">{fmtDate(a.createdAt)} · {a.requestedByName ?? ''}</div></td><td>{a.studentName ?? '—'} {a.admissionNo ? <span className="ops-muted">({a.admissionNo})</span> : null}<div className="ops-muted">{a.invoiceNo}</div></td>
              <td>{humanize(a.kind)}{a.concessionName ? <div className="ops-muted">{a.concessionName}</div> : null}</td><td className="num">{money(a.amountPaise)}</td>
              <td>{a.beforeTotalPaise !== null ? `${money(a.beforeTotalPaise)} → ${money(a.afterTotalPaise)}` : '—'}</td><td><StatusPill status={a.status} /></td>
              <td>{a.status === 'PENDING_APPROVAL' && <Button small variant="soft" onClick={() => setWithdraw(a)}>Withdraw</Button>}</td></tr>)}
          </tbody></table></div>
        )}</Loadable>
      </SectionCard>
      {modal === 'type' && <ConcessionTypeForm onClose={() => setModal(null)} onDone={() => void types.reload()} />}
      {modal === 'request' && types.data && <RequestAdjustment types={types.data} canFeesManage={canFeesManage} onClose={() => setModal(null)} onDone={() => void list.reload()} />}
      {withdraw && <PromptModal title="Withdraw request" label="Reason" required={false} onClose={() => setWithdraw(null)} onSubmit={async (r) => { await billsApi.withdrawAdjustment(withdraw.id, r || undefined); void list.reload(); }} />}
    </div>
  );
}

// ── Finance extras: accounts export ───────────────────────────────────────

export function AccountsExportView() {
  const { permissions } = usePermissions();
  const canHeads = Boolean(permissions['fees.structure.manage']);
  const firstOfMonth = `${isoDay().slice(0, 8)}01`;
  const [range, setRange] = useState({ from: firstOfMonth, to: isoDay() });
  const [applied, setApplied] = useState(range);
  const [company, setCompany] = useState('');
  const summary = useLoad(() => billsApi.voucherSummary(applied), [applied.from, applied.to]);
  const gst = useLoad(() => billsApi.gst(applied), [applied.from, applied.to]);
  const heads = useLoad(() => billsApi.feeHeads(), []);
  const [edit, setEdit] = useState<Record<string, { hsnSac: string; rate: string }>>({});
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <div className="bill-view">
      <SectionCard title="Vouchers for the accountant" sub="Fee invoices (sales), concessions and credit notes, fee receipts, refunds and confirmed bill payments, as Tally import XML or CSV.">
        <div className="lab-form-grid">
          <Field label="From"><input className="input" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
          <Field label="To"><input className="input" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
          <Field label="Tally company name" hint="Optional; must match the company in Tally."><input className="input" value={company} onChange={(e) => setCompany(e.target.value)} /></Field>
        </div>
        <div className="lab-actions">
          <Button small variant="soft" onClick={() => setApplied(range)}>Show</Button>
          <Button small disabled={busy} onClick={() => void run(async () => { await billsApi.downloadVouchers({ ...applied, company }, 'xml'); toast('Tally XML downloaded'); })}>Download Tally XML</Button>
          <Button small variant="soft" disabled={busy} onClick={() => void run(async () => { await billsApi.downloadVouchers(applied, 'csv'); })}>Download CSV</Button>
        </div>
        <ErrorNote error={error} />
        <Loadable state={summary}>{(s) => (
          <div className="kpi-grid">{Object.entries(s.byType).map(([t, v]) => <Tile key={t} label={`${t} (${v.count})`} value={money(v.amountPaise)} />)}{!s.count && <p className="ops-muted">No vouchers in this range.</p>}</div>
        )}</Loadable>
        <DataNote>Ledger names default to Cash, Bank Account, Student Fees Receivable, Fee Income (one ledger per fee head), Fee Concessions, Output CGST / SGST and an expense ledger per bill category. Create or map them in Tally before importing. Every voucher is checked to balance before export.</DataNote>
      </SectionCard>
      <SectionCard title="GST summary" sub="Fee lines that carry a GST rate, by HSN/SAC and rate. Lines without a rate are shown separately.">
        <Loadable state={gst}>{(g) => (<>
          {!g.rows.length ? <p className="ops-muted">No taxable fee lines in this range.</p> : (
            <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>HSN/SAC</th><th className="num">Rate</th><th className="num">Taxable value</th><th className="num">CGST</th><th className="num">SGST</th><th className="num">Invoices</th></tr></thead><tbody>
              {g.rows.map((r) => <tr key={`${r.hsnSac}-${r.ratePct}`}><td>{r.hsnSac ?? '—'}</td><td className="num">{r.ratePct}%</td><td className="num">{money(r.taxablePaise)}</td><td className="num">{money(r.cgstPaise)}</td><td className="num">{money(r.sgstPaise)}</td><td className="num">{r.invoices}</td></tr>)}
              <tr className="bill-total"><td>Total</td><td /><td className="num">{money(g.totals.taxablePaise)}</td><td className="num">{money(g.totals.cgstPaise)}</td><td className="num">{money(g.totals.sgstPaise)}</td><td /></tr>
            </tbody></table></div>
          )}
          <p className="ops-muted">Not taxed in the system: {money(g.untaxed.amountPaise)} over {g.untaxed.lines} line(s). {g.untaxed.note}</p>
          {g.creditsOnTaxedInvoices.length > 0 && <p className="ops-muted">Credit notes on taxable invoices in this range: {g.creditsOnTaxedInvoices.map((c) => `${c.refNo} (${c.invoiceNo}, ${money(c.amountPaise)})`).join(', ')}.</p>}
          <DataNote>{g.disclaimer}</DataNote>
        </>)}</Loadable>
      </SectionCard>
      <SectionCard title="Tax set-up of fee heads" sub="Only heads the school marks taxable carry a rate onto new invoices. Issued invoices keep what they were issued with.">
        <Loadable state={heads}>{(rows) => (
          <div className="ops-table-wrap"><table className="ops-table data-table-cards"><thead><tr><th>Fee head</th><th>HSN/SAC</th><th>GST rate %</th><th /></tr></thead><tbody>
            {rows.map((h) => {
              const e = edit[h.id] ?? { hsnSac: h.hsnSac ?? '', rate: h.gstRateBp !== null ? String(h.gstRateBp / 100) : '' };
              return (
                <tr key={h.id}><td data-label="Fee head">{h.name}<div className="ops-muted">{humanize(h.category)}</div></td>
                  <td data-label="HSN/SAC"><input className="input lab-count" aria-label={`HSN/SAC for ${h.name}`} disabled={!canHeads} value={e.hsnSac} onChange={(ev) => setEdit({ ...edit, [h.id]: { ...e, hsnSac: ev.target.value } })} /></td>
                  <td data-label="GST rate %"><input className="input lab-count" aria-label={`GST rate for ${h.name}`} inputMode="decimal" disabled={!canHeads} placeholder="exempt" value={e.rate} onChange={(ev) => setEdit({ ...edit, [h.id]: { ...e, rate: ev.target.value } })} /></td>
                  <td>{canHeads && edit[h.id] && <Button small variant="soft" disabled={busy} onClick={() => void run(async () => { await billsApi.setFeeHeadTax(h.id, { hsnSac: e.hsnSac.trim() || null, gstRateBp: e.rate ? Math.round(Number(e.rate) * 100) : null }); toast('Saved'); void heads.reload(); })}>Save</Button>}</td></tr>
              );
            })}
          </tbody></table></div>
        )}</Loadable>
        <DataNote>Rates are the school&apos;s to set with its accountant; the system does not decide what is taxable.</DataNote>
      </SectionCard>
    </div>
  );
}
