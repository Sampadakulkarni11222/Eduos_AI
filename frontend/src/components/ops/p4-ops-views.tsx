'use client';
import { useState } from 'react';
import { Button, Field, Modal, Pill, Select, useToast } from '@/components/ui';
import { request } from '@/lib/api';
import { usePermissions } from '@/lib/permissions';
import { p4Api, type Candidate, type CashExpected, type ExitCase, type Vacancy } from '@/lib/p4-ops-api';
import { DataNote, ErrorNote, Loadable, SectionCard, StatusPill, Tabs, Tile, Timeline, fmtDate, humanize, isoDay, money, rupeesToPaise, useAction, useLoad } from './kit';

/**
 * Part 4 (finance, HR, nurse audit):
 *   FinanceReportsView  collections by day / mode / cashier / head / class, the day book,
 *                       overdue ageing with reminders, audit flags, the day-end cash close
 *   RecruitmentView     vacancies and the candidate pipeline: scorecards, offer draft, verification
 *   StaffExitsView      notice, clearances, exit interview, full-and-final, letters
 *   HealthWatchView     the nurse's watch list and the register export
 */

const firstOfMonth = () => `${isoDay().slice(0, 8)}01`;
const BUCKET_TONE: Record<string, 'green' | 'amber' | 'red' | 'maroon'> = { '0-30': 'amber', '31-60': 'amber', '61-90': 'red', '90+': 'maroon' };

function BarList({ rows, total }: { rows: Array<{ key: string; label: string; count: number; amountPaise: number }>; total: number }) {
  if (!rows.length) return <p className="ops-muted">Nothing in this range.</p>;
  return (
    <div className="ops-table-wrap"><table className="ops-table"><tbody>
      {rows.map((r) => (
        <tr key={r.key}>
          <td>{r.label}<div className="p4-bar" aria-hidden="true"><span style={{ width: `${total ? Math.max(2, Math.round((r.amountPaise / total) * 100)) : 0}%` }} /></div></td>
          <td className="num">{r.count}</td><td className="num">{money(r.amountPaise)}</td>
        </tr>
      ))}
    </tbody></table></div>
  );
}

// ── finance ──────────────────────────────────────────────────────────────

export function FinanceReportsView() {
  const [tab, setTab] = useState<'collections' | 'ageing' | 'flags' | 'cash'>('collections');
  return (
    <div className="bill-view">
      <Tabs tabs={[{ key: 'collections', label: 'Collections' }, { key: 'ageing', label: 'Overdue & reminders' }, { key: 'flags', label: 'Audit flags' }, { key: 'cash', label: 'Cash close' }]} value={tab} onChange={setTab} />
      {tab === 'collections' && <Collections />}
      {tab === 'ageing' && <AgeingTab />}
      {tab === 'flags' && <Flags />}
      {tab === 'cash' && <CashCloseTab />}
    </div>
  );
}

function RangePicker({ value, onApply }: { value: { from: string; to: string }; onApply: (v: { from: string; to: string }) => void }) {
  const [r, setR] = useState(value);
  return (
    <div className="p4-range">
      <Field label="From"><input className="input" type="date" value={r.from} onChange={(e) => setR({ ...r, from: e.target.value })} /></Field>
      <Field label="To"><input className="input" type="date" value={r.to} onChange={(e) => setR({ ...r, to: e.target.value })} /></Field>
      <Button small variant="soft" onClick={() => onApply(r)}>Show</Button>
      <Button small variant="soft" onClick={() => { const t = { from: isoDay(), to: isoDay() }; setR(t); onApply(t); }}>Today</Button>
    </div>
  );
}

function Collections() {
  const [range, setRange] = useState({ from: firstOfMonth(), to: isoDay() });
  const rep = useLoad(() => p4Api.collections(range), [range.from, range.to]);
  const { run, busy, error } = useAction();
  return (
    <>
      <SectionCard title="Fee collections" sub="Money credited to the ledger, dated by when it was received. Counted on the server from the same rows as the Tally export." actions={<Button small disabled={busy} onClick={() => void run(() => p4Api.downloadDayBook(range))}>Download day book (CSV)</Button>}>
        <RangePicker value={range} onApply={setRange} />
        <ErrorNote error={error} />
        <Loadable state={rep}>{(r) => (<>
          <div className="kpi-grid">
            <Tile label={`Received (${r.totals.receipts} receipts)`} value={money(r.totals.collectedPaise)} tone="good" />
            <Tile label="Refunded" value={money(r.totals.refundsPaise)} />
            <Tile label="Net" value={money(r.totals.netPaise)} />
            <Tile label={`Awaiting approval (${r.pendingApproval.count})`} value={money(r.pendingApproval.amountPaise)} tone={r.pendingApproval.count ? 'warn' : 'neutral'} />
          </div>
          <div className="p4-grid">
            <div><h3 className="p4-h">By mode</h3><BarList rows={r.byMode} total={r.totals.collectedPaise} /></div>
            <div><h3 className="p4-h">By cashier</h3><BarList rows={r.byCashier} total={r.totals.collectedPaise} /></div>
            <div><h3 className="p4-h">By fee head</h3><BarList rows={r.byHead} total={r.totals.collectedPaise} /></div>
            <div><h3 className="p4-h">By class</h3><BarList rows={r.byClass} total={r.totals.collectedPaise} /></div>
          </div>
          <h3 className="p4-h">By day</h3>
          <BarList rows={r.byDay.map((d) => ({ ...d, label: fmtDate(d.key) }))} total={Math.max(...r.byDay.map((d) => d.amountPaise), 0)} />
          {r.refunds.length > 0 && (<><h3 className="p4-h">Refunds paid</h3>
            <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Date</th><th>Voucher</th><th>Receipt</th><th>Mode</th><th>Reason</th><th className="num">Amount</th></tr></thead><tbody>
              {r.refunds.map((x, i) => <tr key={i}><td>{fmtDate(x.on)}</td><td>{x.voucherNo ?? '—'}</td><td>{x.receiptNo ?? '—'}</td><td>{humanize(x.mode)}</td><td>{x.reason}</td><td className="num">{money(x.amountPaise)}</td></tr>)}
            </tbody></table></div></>)}
          {r.notes.map((n) => <DataNote key={n}>{n}</DataNote>)}
        </>)}</Loadable>
      </SectionCard>
    </>
  );
}

function AgeingTab() {
  const { permissions } = usePermissions();
  const canSend = permissions['fees.manage'] === 'ALL';
  const [bucket, setBucket] = useState('');
  const [className, setClassName] = useState('');
  const a = useLoad(() => p4Api.ageing({ bucket, className, limit: 300 }), [bucket, className]);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof p4Api.reminderPreview>> | null>(null);
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <SectionCard title="Overdue fees by age" sub="Each student's unpaid invoices past their due date, oldest first." actions={<>
      <Button small variant="soft" disabled={busy} onClick={() => void run(() => p4Api.downloadAgeing({ bucket, className }))}>Download CSV</Button>
      {canSend && <Button small disabled={busy} onClick={() => void run(async () => setPreview(await p4Api.reminderPreview({ bucket, className })))}>Send reminders…</Button>}
    </>}>
      <div className="p4-range">
        <Select label="Days overdue" value={bucket} onChange={setBucket} placeholder="All" options={['0-30', '31-60', '61-90', '90+'].map((b) => ({ value: b, label: `${b} days` }))} />
        <Field label="Class"><input className="input" placeholder="e.g. Class 8 B" value={className} onChange={(e) => setClassName(e.target.value)} /></Field>
      </div>
      <ErrorNote error={error} />
      <Loadable state={a}>{(d) => (<>
        <div className="kpi-grid">
          {d.buckets.map((b) => <Tile key={b.key} label={`${b.key} days · ${b.students} student(s)`} value={money(b.amountPaise)} tone={b.key === '90+' || b.key === '61-90' ? 'bad' : 'warn'} />)}
        </div>
        {!d.items.length ? <p className="ops-muted">Nobody is overdue{bucket ? ' in this bucket' : ''}.</p> : (
          <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Student</th><th>Class</th><th className="num">Outstanding</th><th>Oldest due</th><th>Age</th><th>Last paid</th><th>Plan</th></tr></thead><tbody>
            {d.items.map((r) => (
              <tr key={r.enrollmentId}><td>{r.name}<div className="ops-muted">{r.admissionNo} · {r.invoices.map((i) => i.invoiceNo).join(', ')}</div></td><td>{r.className}</td>
                <td className="num">{money(r.outstandingPaise)}</td><td>{fmtDate(r.oldestDue)}</td>
                <td><Pill tone={BUCKET_TONE[r.bucket] ?? 'amber'}>{r.daysOverdue} days</Pill></td><td>{r.lastPaidOn ? fmtDate(r.lastPaidOn) : 'Never'}</td><td>{r.onPlan ? <Pill tone="blue">On plan</Pill> : '—'}</td></tr>
            ))}
          </tbody></table></div>
        )}
        {d.total > d.items.length && <p className="ops-muted">Showing {d.items.length} of {d.total}. Download the CSV for all.</p>}
      </>)}</Loadable>
      {preview && (
        <Modal title="Send fee reminders" onClose={() => setPreview(null)} footer={<>
          <Button variant="soft" onClick={() => setPreview(null)}>Cancel</Button>
          <Button disabled={busy || !preview.students} onClick={() => void run(async () => { const r = await p4Api.sendReminders({ bucket, className }); toast(`Reminders sent to ${r.sent} family(ies)`); setPreview(null); })}>Send to {preview.students} family(ies)</Button>
        </>}>
          <p>The guardians of <b>{preview.students}</b> overdue student(s) ({money(preview.amountPaise)} outstanding) receive, by WhatsApp and in the app:</p>
          <blockquote className="p4-quote">{preview.message}</blockquote>
          <p className="ops-muted">Families on an approved fee plan are left out. A family gets at most one reminder a week.{preview.withoutGuardian ? ` ${preview.withoutGuardian} student(s) have no guardian on file and are skipped.` : ''}</p>
          <ul className="p4-list">{preview.items.slice(0, 12).map((i) => <li key={i.studentId}>{i.name} ({i.className}) — {money(i.outstandingPaise)}, {i.daysOverdue} days</li>)}</ul>
          {preview.items.length > 12 && <p className="ops-muted">…and {preview.items.length - 12} more.</p>}
        </Modal>
      )}
    </SectionCard>
  );
}

function Flags() {
  const [range, setRange] = useState({ from: firstOfMonth(), to: isoDay() });
  const f = useLoad(() => p4Api.anomalies(range), [range.from, range.to]);
  return (
    <SectionCard title="Audit flags" sub="Receipts an auditor would ask about, each rule with the rows behind it. Prompts to look; nothing is changed.">
      <RangePicker value={range} onApply={setRange} />
      <Loadable state={f}>{(d) => (<>
        {!d.flags.length ? <p className="ops-muted">No flags over {d.checked} receipt(s).</p> : d.flags.map((fl) => (
          <details key={fl.rule} className="p4-flag" open={d.flags.length === 1}>
            <summary><b>{fl.title}</b> <Pill tone="amber">{fl.count}</Pill></summary>
            <p className="ops-muted">{fl.why}</p>
            <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Receipt</th><th>Student</th><th>Invoice</th><th>Mode</th><th>Date</th><th>By</th><th className="num">Amount</th></tr></thead><tbody>
              {fl.evidence.map((e) => <tr key={String(e.paymentId)}><td>{e.receiptNo ?? '—'}</td><td>{e.student ?? '—'}</td><td>{e.invoiceNo ?? '—'}</td><td>{humanize(String(e.mode))}{e.reference ? ` ${e.reference}` : ''}</td><td>{fmtDate(String(e.on))} {e.at}{e.keyedAt ? <div className="ops-muted">keyed {e.keyedAt}</div> : null}</td><td>{e.recordedBy ?? '—'}</td><td className="num">{money(Number(e.amountPaise))}</td></tr>)}
            </tbody></table></div>
          </details>
        ))}
        <DataNote>{d.note}</DataNote>
      </>)}</Loadable>
    </SectionCard>
  );
}

function CashCloseTab() {
  const { permissions } = usePermissions();
  const canClose = permissions['fees.pay'] === 'ALL';
  const canCheck = permissions['fees.payments.approve'] === 'ALL';
  const [day, setDay] = useState(isoDay());
  const exp = useLoad(() => p4Api.cashExpected(day), [day]);
  const history = useLoad(() => p4Api.cashCloses(), []);
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [float, setFloat] = useState('');
  const [note, setNote] = useState('');
  const [slip, setSlip] = useState('');
  const { run, busy, error } = useAction();
  const toast = useToast();
  const counted = Object.entries(counts).reduce((n, [d, c]) => n + Number(d) * (Number(c) || 0), 0);
  const reload = () => { void exp.reload(); void history.reload(); };
  return (
    <>
      <SectionCard title="Day-end cash close" sub="Count the notes and coins in the drawer; the system compares them with the cash receipts (less cash refunds) for the day. A second person checks the count.">
        <Field label="Day"><input className="input" type="date" value={day} max={isoDay()} onChange={(e) => setDay(e.target.value)} /></Field>
        <Loadable state={exp}>{(e: CashExpected) => (<>
          <div className="kpi-grid">
            <Tile label={`Cash received (${e.cashReceipts})`} value={money(e.cashInPaise)} />
            <Tile label="Cash refunds" value={money(e.cashRefundsPaise)} />
            <Tile label="Drawer should hold" value={money(e.expectedCashPaise)} tone="good" />
            {Object.entries(e.nonCash).map(([m, v]) => <Tile key={m} label={`${humanize(m)} (${v.count})`} value={money(v.amountPaise)} />)}
          </div>
          {e.awaitingApproval > 0 && <p className="ops-muted">{e.awaitingApproval} cash receipt(s) are still awaiting approval; they are in the drawer, so they are counted.</p>}
          {e.existing ? (
            <div className="p4-closed">
              <p><StatusPill status={e.existing.status} /> Closed by {e.existing.closedBy} — counted {money(e.existing.countedPaise)}, variance <b>{money(e.existing.variancePaise)}</b>{e.existing.note ? ` (${e.existing.note})` : ''}.{e.existing.checkedBy ? ` Checked by ${e.existing.checkedBy}.` : ''}</p>
              {canCheck && e.existing.status === 'CLOSED' && <Button small disabled={busy} onClick={() => void run(async () => { await p4Api.checkClose(e.existing!.id); toast('Count checked'); reload(); })}>Mark checked</Button>}
            </div>
          ) : canClose ? (<>
            <div className="p4-denoms">
              {e.denominations.map((d) => (
                <label key={d} className="p4-denom"><span>₹{d / 100}</span><input className="input" inputMode="numeric" aria-label={`Count of ₹${d / 100}`} value={counts[d] ?? ''} onChange={(ev) => setCounts({ ...counts, [d]: ev.target.value.replace(/\D/g, '') })} /><small>{money(d * (Number(counts[d]) || 0))}</small></label>
              ))}
            </div>
            <div className="lab-form-grid">
              <Field label="Opening float (₹)"><input className="input" inputMode="decimal" value={float} onChange={(ev) => setFloat(ev.target.value)} /></Field>
              <Field label="Bank deposit slip no."><input className="input" value={slip} onChange={(ev) => setSlip(ev.target.value)} /></Field>
            </div>
            {(() => {
              const variance = counted - (float ? rupeesToPaise(float) : 0) - e.expectedCashPaise;
              return (<>
                <p>Counted <b>{money(counted)}</b> · variance <b className={variance ? 'p4-bad' : 'p4-good'}>{variance === 0 ? 'balanced' : `${variance > 0 ? 'over' : 'short'} by ${money(Math.abs(variance))}`}</b></p>
                {variance !== 0 && <Field label="Why the count differs" required><textarea className="input" rows={2} value={note} onChange={(ev) => setNote(ev.target.value)} /></Field>}
                <Button disabled={busy || (variance !== 0 && !note.trim())} onClick={() => void run(async () => {
                  await p4Api.closeDay({ day, counts: Object.entries(counts).map(([d, c]) => ({ denominationPaise: Number(d), count: Number(c) || 0 })), openingFloatPaise: float ? rupeesToPaise(float) : 0, depositSlipNo: slip, note });
                  toast('Day closed'); setCounts({}); setNote(''); reload();
                })}>Close {fmtDate(day)}</Button>
              </>);
            })()}
          </>) : <p className="ops-muted">Not closed yet.</p>}
        </>)}</Loadable>
        <ErrorNote error={error} />
      </SectionCard>
      <SectionCard title="Recent closes">
        <Loadable state={history}>{(h) => (!h.items.length ? <p className="ops-muted">No day has been closed yet.</p> : (
          <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Day</th><th className="num">Expected</th><th className="num">Counted</th><th className="num">Variance</th><th>Closed by</th><th>Checked by</th></tr></thead><tbody>
            {h.items.map((c) => <tr key={c.id}><td>{fmtDate(c.day)}</td><td className="num">{money(c.expectedCashPaise)}</td><td className="num">{money(c.countedPaise)}</td><td className="num">{money(c.variancePaise)}</td><td>{c.closedBy}</td><td>{c.checkedBy ?? <Pill tone="amber">Not checked</Pill>}</td></tr>)}
          </tbody></table></div>
        ))}</Loadable>
      </SectionCard>
    </>
  );
}

// ── recruitment ──────────────────────────────────────────────────────────

const STAGES = ['APPLIED', 'SCREENED', 'DEMO_LESSON', 'INTERVIEW', 'OFFERED', 'ACCEPTED', 'JOINED'];
const RUBRIC: Array<[string, string]> = [['subjectKnowledge', 'Subject knowledge'], ['pedagogy', 'Teaching method'], ['communication', 'Communication'], ['classroomManagement', 'Classroom management'], ['childSafeguarding', 'Child safeguarding'], ['valuesFit', 'Values and fit']];

export function RecruitmentView() {
  const vac = useLoad(() => p4Api.vacancies(), []);
  const [selected, setSelected] = useState<string>('');
  const cands = useLoad(() => p4Api.candidates(selected ? { vacancyId: selected } : {}), [selected]);
  const [newVac, setNewVac] = useState(false);
  const [newCand, setNewCand] = useState(false);
  const [open, setOpen] = useState<Candidate | null>(null);
  const reload = () => { void vac.reload(); void cands.reload(); };
  return (
    <div className="bill-view">
      <SectionCard title="Vacancies" actions={<Button small onClick={() => setNewVac(true)}>Open a vacancy</Button>}>
        <Loadable state={vac}>{(d) => (!d.items.length ? <p className="ops-muted">No vacancies yet.</p> : (
          <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Post</th><th>Status</th><th>Closes</th>{STAGES.map((s) => <th key={s} className="num">{humanize(s)}</th>)}</tr></thead><tbody>
            {d.items.map((v) => (
              <tr key={v.id} className={`is-clickable${selected === v.id ? ' p4-sel' : ''}`} onClick={() => setSelected(selected === v.id ? '' : v.id)}>
                <td><b>{v.title}</b><div className="ops-muted">{v.refNo}{v.department ? ` · ${v.department}` : ''}{v.qualifications ? ` · ${v.qualifications}` : ''}</div></td>
                <td><StatusPill status={v.status} /></td><td>{v.closesOn ? fmtDate(v.closesOn) : '—'}</td>
                {STAGES.map((s) => <td key={s} className="num">{v.pipeline[s] ?? 0}</td>)}
              </tr>
            ))}
          </tbody></table></div>
        ))}</Loadable>
      </SectionCard>
      <SectionCard title={selected ? `Candidates — ${vac.data?.items.find((v) => v.id === selected)?.title ?? ''}` : 'All candidates'} actions={<Button small variant="soft" disabled={!vac.data?.items.some((v) => v.status === 'OPEN')} onClick={() => setNewCand(true)}>Add candidate</Button>}>
        <Loadable state={cands}>{(d) => (!d.items.length ? <p className="ops-muted">No candidates.</p> : (
          <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Candidate</th><th>Post</th><th>Stage</th><th className="num">Score</th><th>Verification</th></tr></thead><tbody>
            {d.items.map((c) => (
              <tr key={c.id} className="is-clickable" onClick={() => setOpen(c)}>
                <td><b>{c.name}</b><div className="ops-muted">{c.experienceYears !== null ? `${c.experienceYears} yrs` : ''}{c.qualifications ? ` · ${c.qualifications}` : ''}</div></td>
                <td>{c.vacancy?.title}</td><td><StatusPill status={c.stage} /></td><td className="num">{c.averageScore ?? '—'}</td><td>{c.verificationStatus ? humanize(c.verificationStatus) : '—'}</td>
              </tr>
            ))}
          </tbody></table></div>
        ))}</Loadable>
      </SectionCard>
      {newVac && <VacancyModal onClose={() => setNewVac(false)} onDone={reload} />}
      {newCand && <CandidateModal vacancies={(vac.data?.items ?? []).filter((v) => v.status === 'OPEN')} preselect={selected} onClose={() => setNewCand(false)} onDone={reload} />}
      {open && <CandidateDrawer candidate={open} onClose={() => setOpen(null)} onChanged={(c) => { setOpen(c); reload(); }} />}
    </div>
  );
}

function VacancyModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ title: '', department: '', subject: '', positions: '1', qualifications: '', salaryBand: '', closesOn: '', childFacing: true });
  const { run, busy, error } = useAction();
  return (
    <Modal title="Open a vacancy" onClose={onClose} footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.title.trim()} onClick={() => void run(async () => { await p4Api.createVacancy({ ...f, positions: Number(f.positions) || 1, closesOn: f.closesOn || null }); onDone(); onClose(); })}>Open</Button></>}>
      <div className="lab-form-grid">
        <Field label="Post" required><input className="input" placeholder="TGT Mathematics" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Department"><input className="input" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></Field>
        <Field label="Subject"><input className="input" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
        <Field label="Positions"><input className="input" inputMode="numeric" value={f.positions} onChange={(e) => setF({ ...f, positions: e.target.value })} /></Field>
        <Field label="Qualifications" hint="e.g. B.Ed, CTET; PG in the subject"><input className="input" value={f.qualifications} onChange={(e) => setF({ ...f, qualifications: e.target.value })} /></Field>
        <Field label="Salary band"><input className="input" value={f.salaryBand} onChange={(e) => setF({ ...f, salaryBand: e.target.value })} /></Field>
        <Field label="Applications close"><input className="input" type="date" value={f.closesOn} onChange={(e) => setF({ ...f, closesOn: e.target.value })} /></Field>
      </div>
      <label className="p4-check"><input type="checkbox" checked={f.childFacing} onChange={(e) => setF({ ...f, childFacing: e.target.checked })} /> Works with children (background verification must clear before joining)</label>
      <ErrorNote error={error} />
    </Modal>
  );
}

function CandidateModal({ vacancies, preselect, onClose, onDone }: { vacancies: Vacancy[]; preselect: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ vacancyId: vacancies.some((v) => v.id === preselect) ? preselect : (vacancies[0]?.id ?? ''), name: '', email: '', phone: '', source: '', experienceYears: '', qualifications: '', expectedCtc: '', noticeDays: '' });
  const { run, busy, error } = useAction();
  return (
    <Modal title="Add a candidate" onClose={onClose} footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.name.trim() || !f.vacancyId} onClick={() => void run(async () => {
      await p4Api.addCandidate({ vacancyId: f.vacancyId, name: f.name, email: f.email, phone: f.phone, source: f.source, experienceYears: f.experienceYears === '' ? null : Number(f.experienceYears), qualifications: f.qualifications, expectedCtcPaise: f.expectedCtc ? rupeesToPaise(f.expectedCtc) : null, noticeDays: f.noticeDays === '' ? null : Number(f.noticeDays) });
      onDone(); onClose();
    })}>Add</Button></>}>
      <Select label="Vacancy" value={f.vacancyId} onChange={(v) => setF({ ...f, vacancyId: v })} options={vacancies.map((v) => ({ value: v.id, label: `${v.title} (${v.refNo})` }))} />
      <div className="lab-form-grid">
        <Field label="Name" required><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Email"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Phone"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Source" hint="Referral, job portal, walk-in"><input className="input" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} /></Field>
        <Field label="Experience (years)"><input className="input" inputMode="decimal" value={f.experienceYears} onChange={(e) => setF({ ...f, experienceYears: e.target.value })} /></Field>
        <Field label="Qualifications"><input className="input" value={f.qualifications} onChange={(e) => setF({ ...f, qualifications: e.target.value })} /></Field>
        <Field label="Expected CTC (₹ a year)"><input className="input" inputMode="decimal" value={f.expectedCtc} onChange={(e) => setF({ ...f, expectedCtc: e.target.value })} /></Field>
        <Field label="Notice period (days)"><input className="input" inputMode="numeric" value={f.noticeDays} onChange={(e) => setF({ ...f, noticeDays: e.target.value })} /></Field>
      </div>
      <DataNote>Candidate contact details are personal data: they are seen only by HR and kept for this recruitment.</DataNote>
      <ErrorNote error={error} />
    </Modal>
  );
}

function CandidateDrawer({ candidate: c, onClose, onChanged }: { candidate: Candidate; onClose: () => void; onChanged: (c: Candidate) => void }) {
  const { permissions } = usePermissions();
  const [ratings, setRatings] = useState<Record<string, string>>({});
  const [rec, setRec] = useState('MAYBE');
  const [offer, setOffer] = useState({ ctc: c.offer?.ctcPaise ? String(c.offer.ctcPaise / 100) : '', joiningOn: c.offer?.joiningOn ?? '' });
  const [letter, setLetter] = useState<string | null>(c.offer?.letterText ?? null);
  const [reason, setReason] = useState('');
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <Modal wide title={`${c.name} — ${c.vacancy?.title ?? ''}`} onClose={onClose}>
      <p><StatusPill status={c.stage} /> {c.refNo}{c.email ? ` · ${c.email}` : ''}{c.phone ? ` · ${c.phone}` : ''}{c.expectedCtcPaise ? ` · expects ${money(c.expectedCtcPaise)}` : ''}{c.verificationStatus ? ` · verification ${humanize(c.verificationStatus)}` : ''}</p>
      {c.nextStages.length > 0 && (
        <div className="lab-actions p4-stage-actions">
          {c.nextStages.filter((s) => s !== 'REJECTED' && s !== 'WITHDRAWN').map((s) => <Button key={s} small disabled={busy} onClick={() => void run(async () => onChanged(await p4Api.moveCandidate(c.id, s)))}>Move to {humanize(s)}</Button>)}
          {c.nextStages.includes('WITHDRAWN') && <Button small variant="soft" disabled={busy} onClick={() => void run(async () => onChanged(await p4Api.moveCandidate(c.id, 'WITHDRAWN', reason || undefined)))}>Withdrawn</Button>}
          {c.nextStages.includes('REJECTED') && <><input className="input" placeholder="Reason, to not go forward" value={reason} onChange={(e) => setReason(e.target.value)} /><Button small variant="soft" disabled={busy || !reason.trim()} onClick={() => void run(async () => onChanged(await p4Api.moveCandidate(c.id, 'REJECTED', reason)))}>Not going forward</Button></>}
        </div>
      )}
      <ErrorNote error={error} />
      {!['REJECTED', 'WITHDRAWN', 'JOINED'].includes(c.stage) && (
        <SectionCard title="Your scorecard" sub="1 to 5 on each; leave out what you did not see.">
          <div className="lab-form-grid">{RUBRIC.map(([k, label]) => <Select key={k} label={label} value={ratings[k] ?? ''} onChange={(v) => setRatings({ ...ratings, [k]: v })} placeholder="—" options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))} />)}
            <Select label="Recommendation" value={rec} onChange={setRec} options={['STRONG_YES', 'YES', 'MAYBE', 'NO'].map((r) => ({ value: r, label: humanize(r) }))} /></div>
          <Button small disabled={busy || !Object.values(ratings).some(Boolean)} onClick={() => void run(async () => { onChanged(await p4Api.scoreCandidate(c.id, { ratings: Object.fromEntries(Object.entries(ratings).filter(([, v]) => v).map(([k, v]) => [k, Number(v)])), recommendation: rec })); setRatings({}); toast('Scorecard saved'); })}>Save scorecard</Button>
        </SectionCard>
      )}
      {c.scores.length > 0 && (
        <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Interviewer</th><th>Stage</th><th className="num">Average</th><th>Recommendation</th><th>Note</th></tr></thead><tbody>
          {c.scores.map((s) => <tr key={s.id}><td>{s.by}</td><td>{humanize(s.stage)}</td><td className="num">{s.total}</td><td>{humanize(s.recommendation)}</td><td>{s.note ?? ''}</td></tr>)}
        </tbody></table></div>
      )}
      {['SCREENED', 'DEMO_LESSON', 'INTERVIEW', 'OFFERED'].includes(c.stage) && (
        <SectionCard title="Offer" sub="Drafted from the vacancy and these terms for you to edit, print and sign. Nothing is sent.">
          <div className="lab-form-grid">
            <Field label="Annual CTC (₹)"><input className="input" inputMode="decimal" value={offer.ctc} onChange={(e) => setOffer({ ...offer, ctc: e.target.value })} /></Field>
            <Field label="Joining date"><input className="input" type="date" value={offer.joiningOn} onChange={(e) => setOffer({ ...offer, joiningOn: e.target.value })} /></Field>
          </div>
          <Button small disabled={busy || !offer.ctc || !offer.joiningOn} onClick={() => void run(async () => { const r = await p4Api.draftOffer(c.id, { ctcPaise: rupeesToPaise(offer.ctc), joiningOn: offer.joiningOn }); setLetter(r.letter); onChanged(r.candidate); })}>Draft offer letter</Button>
          {letter && <textarea className="input p4-letter" rows={14} value={letter} onChange={(e) => setLetter(e.target.value)} aria-label="Offer letter draft" />}
        </SectionCard>
      )}
      {permissions['verification.manage'] === 'ALL' && !c.verificationCaseId && ['INTERVIEW', 'OFFERED', 'ACCEPTED'].includes(c.stage) && (
        <Button small variant="soft" disabled={busy} onClick={() => void run(async () => { const r = await p4Api.startVerification(c.id); toast(`Verification ${r.verification.refNo} started`); onChanged({ ...c, verificationCaseId: 'x', verificationStatus: 'INITIATED' }); })}>Start background verification</Button>
      )}
      <Timeline items={c.history} />
    </Modal>
  );
}

// ── exits ────────────────────────────────────────────────────────────────

const DEPTS = ['ACADEMICS', 'LIBRARY', 'IT', 'ACCOUNTS', 'ADMIN', 'TRANSPORT', 'LABS', 'HOSTEL'];

export function StaffExitsView() {
  const [showAll, setShowAll] = useState(false);
  const list = useLoad(() => p4Api.exits(showAll ? { status: 'ALL' } : {}), [showAll]);
  const [start, setStart] = useState(false);
  const [open, setOpen] = useState<ExitCase | null>(null);
  return (
    <div className="bill-view">
      <SectionCard title="Staff exits" sub="Resignations, retirements and contract ends: notice, department clearances, exit interview, full-and-final and letters." actions={<>
        <Button small variant="soft" onClick={() => setShowAll(!showAll)}>{showAll ? 'Open only' : 'Show closed too'}</Button>
        <Button small onClick={() => setStart(true)}>Start an exit</Button>
      </>}>
        <Loadable state={list}>{(d) => (!d.items.length ? <p className="ops-muted">No exits{showAll ? '' : ' open'}.</p> : (
          <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Staff</th><th>Kind</th><th>Last working day</th><th>Notice</th><th>Clearances</th><th>Status</th></tr></thead><tbody>
            {d.items.map((x) => (
              <tr key={x.id} className="is-clickable" onClick={() => setOpen(x)}>
                <td><b>{x.name}</b><div className="ops-muted">{x.refNo}</div></td><td>{humanize(x.kind)}</td><td>{fmtDate(x.lastWorkingDay)}</td>
                <td>{x.noticeWaived ? 'Waived' : `${x.noticeServedDays} / ${x.noticeDaysRequired} days`}</td>
                <td>{x.clearancesPending ? <Pill tone="amber">{x.clearancesPending} pending</Pill> : <Pill tone="green">All in</Pill>}</td><td><StatusPill status={x.status} /></td>
              </tr>
            ))}
          </tbody></table></div>
        ))}</Loadable>
      </SectionCard>
      {start && <StartExitModal onClose={() => setStart(false)} onDone={() => void list.reload()} />}
      {open && <ExitDrawer x={open} onClose={() => setOpen(null)} onChanged={(x) => { setOpen(x); void list.reload(); }} />}
    </div>
  );
}

function StartExitModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const staff = useLoad(() => request<Array<{ profileId: string; name: string; role: string }>>('/staff-profile'), []);
  const [f, setF] = useState({ profileId: '', kind: 'RESIGNATION', noticeOn: isoDay(), lastWorkingDay: '', noticeDaysRequired: '30', reason: '', departments: ['ACADEMICS', 'LIBRARY', 'IT', 'ACCOUNTS', 'ADMIN'] });
  const { run, busy, error } = useAction();
  return (
    <Modal title="Start an exit" onClose={onClose} footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.profileId || !f.lastWorkingDay} onClick={() => void run(async () => { await p4Api.startExit({ ...f, noticeDaysRequired: Number(f.noticeDaysRequired) || 0 }); onDone(); onClose(); })}>Start</Button></>}>
      <Loadable state={staff}>{(rows) => <Select label="Staff member" value={f.profileId} onChange={(v) => setF({ ...f, profileId: v })} placeholder="Choose…" options={rows.map((r) => ({ value: r.profileId, label: `${r.name} (${r.role})` }))} />}</Loadable>
      <div className="lab-form-grid">
        <Select label="Kind" value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={['RESIGNATION', 'RETIREMENT', 'TERMINATION', 'CONTRACT_END', 'DEATH'].map((k) => ({ value: k, label: humanize(k) }))} />
        <Field label="Notice given on"><input className="input" type="date" value={f.noticeOn} onChange={(e) => setF({ ...f, noticeOn: e.target.value })} /></Field>
        <Field label="Last working day" required><input className="input" type="date" value={f.lastWorkingDay} onChange={(e) => setF({ ...f, lastWorkingDay: e.target.value })} /></Field>
        <Field label="Notice required (days)"><input className="input" inputMode="numeric" value={f.noticeDaysRequired} onChange={(e) => setF({ ...f, noticeDaysRequired: e.target.value })} /></Field>
      </div>
      <Field label="Departments to clear"><div className="p4-chips">{DEPTS.map((d) => (
        <label key={d} className="p4-check"><input type="checkbox" checked={f.departments.includes(d)} onChange={(e) => setF({ ...f, departments: e.target.checked ? [...f.departments, d] : f.departments.filter((x) => x !== d) })} /> {humanize(d)}</label>
      ))}</div></Field>
      <Field label="Reason"><textarea className="input" rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      <ErrorNote error={error} />
    </Modal>
  );
}

function ExitDrawer({ x, onClose, onChanged }: { x: ExitCase; onClose: () => void; onChanged: (x: ExitCase) => void }) {
  const { permissions } = usePermissions();
  const canPay = permissions['payroll.sensitive.read'] === 'ALL';
  const [dues, setDues] = useState<Record<string, { amount: string; note: string }>>({});
  const [interview, setInterview] = useState(x.exitInterview?.note ?? '');
  const [letters, setLetters] = useState<{ relieving: string; experience: string } | null>(null);
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <Modal wide title={`${x.name} — ${humanize(x.kind)}`} onClose={onClose}>
      <p><StatusPill status={x.status} /> {x.refNo} · notice {fmtDate(x.noticeOn)} · last working day {fmtDate(x.lastWorkingDay)} · {x.noticeWaived ? 'notice waived' : `${x.noticeServedDays} of ${x.noticeDaysRequired} days served`}</p>
      <ErrorNote error={error} />
      <SectionCard title="Clearances">
        <div className="ops-table-wrap"><table className="ops-table"><tbody>
          {x.clearances.map((c) => (
            <tr key={c.department}><td>{humanize(c.department)}</td><td><StatusPill status={c.status} />{c.duesPaise ? ` ${money(c.duesPaise)}` : ''}{c.note ? <div className="ops-muted">{c.note}</div> : null}</td>
              <td>{!['CLOSED', 'WITHDRAWN'].includes(x.status) && <div className="lab-actions">
                <Button small variant="soft" disabled={busy} onClick={() => void run(async () => onChanged(await p4Api.clearance(x.id, { department: c.department, status: 'CLEARED' })))}>Cleared</Button>
                <input className="input lab-count" placeholder="₹ due" aria-label={`Dues for ${c.department}`} value={dues[c.department]?.amount ?? ''} onChange={(e) => setDues({ ...dues, [c.department]: { ...(dues[c.department] ?? { note: '' }), amount: e.target.value } })} />
                <input className="input" placeholder="What is due" aria-label={`What is due for ${c.department}`} value={dues[c.department]?.note ?? ''} onChange={(e) => setDues({ ...dues, [c.department]: { ...(dues[c.department] ?? { amount: '' }), note: e.target.value } })} />
                <Button small variant="soft" disabled={busy || (!dues[c.department]?.amount && !dues[c.department]?.note)} onClick={() => void run(async () => onChanged(await p4Api.clearance(x.id, { department: c.department, status: 'DUES', duesPaise: dues[c.department]?.amount ? rupeesToPaise(dues[c.department].amount) : 0, note: dues[c.department]?.note })))}>Dues</Button>
              </div>}</td></tr>
          ))}
        </tbody></table></div>
      </SectionCard>
      <SectionCard title="Exit interview">
        <textarea className="input" rows={3} value={interview} onChange={(e) => setInterview(e.target.value)} aria-label="Exit interview notes" style={{ width: '100%' }} />
        <Button small variant="soft" disabled={busy || !interview.trim()} onClick={() => void run(async () => { onChanged(await p4Api.interview(x.id, interview)); toast('Saved'); })}>Save notes</Button>
      </SectionCard>
      {canPay && (
        <SectionCard title="Full and final" sub="Gratuity (Payment of Gratuity Act), earned-leave encashment, notice recovery and clearance dues. A worksheet: payroll approval still applies.">
          <div className="lab-actions">
            <Button small disabled={busy} onClick={() => void run(async () => onChanged((await p4Api.settlement(x.id)).exit))}>Work it out</Button>
            {x.settlement && !x.payrollRunId && permissions['payroll.prepare'] === 'ALL' && <Button small variant="soft" disabled={busy || x.clearancesPending > 0} onClick={() => void run(async () => { const r = await p4Api.settlementToPayroll(x.id); toast(`Put on payroll run ${r.run.refNo}`); onChanged({ ...x, payrollRunId: r.run.refNo }); })}>Put on a full-and-final payroll run</Button>}
          </div>
          {x.settlement && (<>
            <p className="ops-muted">Service {x.settlement.serviceYears} years (joined {fmtDate(x.settlement.joiningDate)}); wage for gratuity {money(x.settlement.wagePaise)} a month.</p>
            <div className="ops-table-wrap"><table className="ops-table"><tbody>
              {x.settlement.lines.map((l) => <tr key={l.name}><td>{l.name}<div className="ops-muted">{l.reason}</div></td><td className="num">{money(l.amountPaise)}</td></tr>)}
              <tr className="bill-total"><td>Net</td><td className="num">{money(x.settlement.netPaise)}</td></tr>
            </tbody></table></div>
            {x.settlement.warnings.map((w) => <DataNote key={w}>{w}</DataNote>)}
            {x.payrollRunId && <p><Pill tone="blue">On a payroll run</Pill></p>}
          </>)}
        </SectionCard>
      )}
      <div className="lab-actions">
        <Button small variant="soft" disabled={busy} onClick={() => void run(async () => setLetters(await p4Api.letters(x.id)))}>Draft relieving and experience letters</Button>
        {!['CLOSED', 'WITHDRAWN'].includes(x.status) && <Button small variant="soft" disabled={busy || x.clearancesPending > 0} onClick={() => void run(async () => onChanged(await p4Api.closeExit(x.id)))}>Close the exit</Button>}
        {!['CLOSED', 'WITHDRAWN'].includes(x.status) && <Button small variant="soft" disabled={busy} onClick={() => void run(async () => onChanged(await p4Api.closeExit(x.id, true)))}>Withdrawn (staying on)</Button>}
      </div>
      {letters && <>
        <textarea className="input p4-letter" rows={9} defaultValue={letters.relieving} aria-label="Relieving letter draft" />
        <textarea className="input p4-letter" rows={8} defaultValue={letters.experience} aria-label="Experience letter draft" />
      </>}
      <Timeline items={x.history} />
    </Modal>
  );
}

// ── nurse ────────────────────────────────────────────────────────────────

export function HealthWatchView() {
  const w = useLoad(() => p4Api.healthWatch(), []);
  const [range, setRange] = useState({ from: firstOfMonth(), to: isoDay() });
  const { run, busy, error } = useAction();
  return (
    <div className="bill-view">
      <Loadable state={w}>{(d) => (<>
        <SectionCard title="Possible clusters" sub={`${d.rules.clusterThreshold}+ children in one class with a similar complaint within ${d.rules.clusterWindowDays} days.`}>
          {!d.clusters.length ? <p className="ops-muted">Nothing that looks like a cluster in the last 30 days.</p> : d.clusters.map((c) => (
            <details key={`${c.className}-${c.category}`} className="p4-flag" open={c.recent}>
              <summary><b>{c.className}: {c.label}</b> <Pill tone={c.recent ? 'red' : 'amber'}>{c.children} children</Pill> <span className="ops-muted">{fmtDate(c.from)} – {fmtDate(c.to)}</span></summary>
              <p className="ops-muted">{c.suggestion}</p>
              <ul className="p4-list">{c.evidence.map((e) => <li key={e.ref}>{e.ref} · {e.student} · {fmtDate(e.on)} {e.at} · {e.complaint} · {humanize(e.outcome)}</li>)}</ul>
            </details>
          ))}
        </SectionCard>
        <SectionCard title="Frequent visitors" sub={`Children seen ${d.rules.frequentVisitsIn30Days} or more times in 30 days.`}>
          {!d.frequentVisitors.length ? <p className="ops-muted">No one.</p> : (
            <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Student</th><th>Class</th><th className="num">Visits</th><th className="num">Sent home</th><th>Complaints</th><th>Last</th></tr></thead><tbody>
              {d.frequentVisitors.map((f) => <tr key={f.studentId}><td>{f.student}</td><td>{f.className}</td><td className="num">{f.visits}</td><td className="num">{f.sentHome}</td><td>{f.complaints.join(', ')}</td><td>{fmtDate(f.lastOn)}</td></tr>)}
            </tbody></table></div>
          )}
          {d.frequentVisitors.length > 0 && <DataNote>{d.frequentVisitors[0].suggestion}</DataNote>}
        </SectionCard>
        <SectionCard title="Immunisations due" sub={`Next doses recorded as due in the next ${d.rules.immunisationAheadDays} days, or overdue.`}>
          {!d.immunisationsDue.length ? <p className="ops-muted">None due.</p> : (
            <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Student</th><th>Class</th><th>Vaccine</th><th>Last dose</th><th>Next due</th></tr></thead><tbody>
              {d.immunisationsDue.map((i) => <tr key={`${i.studentId}-${i.vaccine}`}><td>{i.student}</td><td>{i.className}</td><td>{i.vaccine}</td><td>{i.lastDose ?? '—'} ({fmtDate(i.lastOn)})</td><td>{i.overdue ? <Pill tone="red">Overdue {fmtDate(i.nextDueOn)}</Pill> : fmtDate(i.nextDueOn)}</td></tr>)}
            </tbody></table></div>
          )}
        </SectionCard>
        <SectionCard title={`Screening ${d.screening.academicYear}`} sub={`${d.screening.screened} of ${d.screening.totalStudents} children screened this year. Classes with the least coverage first.`}>
          <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Class</th><th className="num">Screened</th><th className="num">Coverage</th></tr></thead><tbody>
            {d.screening.byClass.slice(0, 15).map((c) => <tr key={c.className}><td>{c.className}</td><td className="num">{c.screened} / {c.students}</td><td className="num">{c.pct}%</td></tr>)}
          </tbody></table></div>
          {d.screening.followUps.length > 0 && (<><h3 className="p4-h">Follow-ups</h3>
            <ul className="p4-list">{d.screening.followUps.map((f) => <li key={`${f.studentId}-${f.on}`}>{f.student} ({f.className}) — {f.reasons.join('; ')}</li>)}</ul></>)}
        </SectionCard>
        <DataNote>{d.note}</DataNote>
      </>)}</Loadable>
      <SectionCard title="Health-room register" sub="Every visit in a date range as a spreadsheet, for the school's records or an inspection. The export is logged.">
        <RangePicker value={range} onApply={setRange} />
        <Button small disabled={busy} onClick={() => void run(() => p4Api.downloadRegister(range))}>Download register (CSV)</Button>
        <ErrorNote error={error} />
      </SectionCard>
    </div>
  );
}
