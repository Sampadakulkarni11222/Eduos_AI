'use client';
import { useState } from 'react';
import { Button, EmptyState, Field, Modal, useToast } from '@/components/ui';
import { opsApi, downloadCsv } from '@/lib/ops-api';
import { usePermissions } from '@/lib/permissions';
import type { BudgetDto, CompensationDto, PayComponent, PayrollRunDto, PurchaseRequestDto } from '@/lib/ops-types';
import { AttachUpload } from './attach';
import { Drawer } from './drawer';
import {
  DataNote, ErrorNote, KeyValues, Loadable, PromptModal, SectionCard, StatusPill, Stepper, Tabs, Tile, Timeline,
  fmtDate, fmtDateTime, humanize, money, rupeesToPaise, useAction, useLoad, useQueryParam,
} from './kit';

// ═════════════════════════ Payroll ═════════════════════════

const RUN_STEPS = [{ key: 'DRAFT', label: 'Inputs' }, { key: 'CALCULATED', label: 'Calculated' }, { key: 'IN_APPROVAL', label: 'Principal' }, { key: 'APPROVED', label: 'Approved' }, { key: 'BANK_FILE_GENERATED', label: 'Bank file' }, { key: 'PAYMENT_INITIATED', label: 'Initiated' }, { key: 'PAYMENT_CONFIRMED', label: 'Paid' }, { key: 'CLOSED', label: 'Closed' }];

function RunDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { permissions } = usePermissions();
  const canPrep = Boolean(permissions['payroll.prepare']);
  const sensitive = Boolean(permissions['payroll.sensitive.read']);
  const state = useLoad(() => opsApi.payrollRun(id), [id]);
  const comp = useLoad(() => (canPrep ? opsApi.compensation() : Promise.resolve([] as CompensationDto[])), [canPrep]);
  const [inputs, setInputs] = useState<Record<string, { lopDays: string; arrears: string }>>({});
  const [prompt, setPrompt] = useState<null | 'initiated' | 'confirmed' | 'reopen' | 'statutory'>(null);
  const [confirmAmt, setConfirmAmt] = useState('');
  const [stat, setStat] = useState({ code: 'EPF_ECR', acknowledgementNo: '', challanNo: '' });
  const { run, busy, error } = useAction();
  const toast = useToast();
  const reload = async () => { await state.reload(); onChanged(); };
  const act = (action: string, body: unknown, msg: string) => run(async () => { await opsApi.payrollAction(id, action, body); toast(msg, 'success'); await reload(); });
  const r = state.data;
  return (
    <Drawer title={r ? `Payroll ${r.period}` : 'Payroll'} sub={r ? `${r.refNo} · ${humanize(r.kind)}` : undefined} onClose={onClose}>
      <Loadable state={state}>{(d: PayrollRunDto) => (
        <>
          <Stepper steps={RUN_STEPS} current={d.status} />
          <div className="kpi-grid">
            <Tile label="Employees" value={d.totals.headcount} />
            <Tile label="Gross" value={money(d.totals.grossPaise)} />
            <Tile label="Deductions" value={money(d.totals.deductionsPaise)} />
            <Tile label="Net pay" value={money(d.totals.netPaise)} />
            <Tile label="Employer contributions" value={money(d.totals.employerContributionsPaise)} />
          </div>
          {d.unverifiedRules.length > 0 && <div className="ops-callout is-warn">Uses statutory rules not yet verified by your payroll adviser: {[...new Set(d.unverifiedRules)].map(humanize).join(', ')}.</div>}
          {d.warnings.length > 0 && <details><summary>{d.warnings.length} warning(s)</summary><ul>{d.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}

          {canPrep && ['DRAFT', 'CALCULATED'].includes(d.status) && (
            <SectionCard title="Inputs for this period" sub="Loss-of-pay days and arrears per employee. Saving inputs needs a recalculation.">
              <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Employee</th><th>LOP days</th><th>Arrears (₹)</th></tr></thead><tbody>
                {(comp.data ?? []).filter((c) => c.status !== 'EXITED').map((c) => {
                  const existing = d.inputs?.find((i) => String(i.profileId) === c.profileId);
                  const v = inputs[c.profileId] ?? { lopDays: String(existing?.lopDays ?? 0), arrears: existing ? String(existing.arrearsPaise / 100) : '0' };
                  return <tr key={c.id}><td>{c.name} <span className="ops-muted">{c.employeeCode}</span></td><td><input className="input" inputMode="decimal" style={{ width: 80 }} value={v.lopDays} onChange={(e) => setInputs({ ...inputs, [c.profileId]: { ...v, lopDays: e.target.value } })} aria-label={`LOP days for ${c.name}`} /></td><td><input className="input" inputMode="decimal" style={{ width: 110 }} value={v.arrears} onChange={(e) => setInputs({ ...inputs, [c.profileId]: { ...v, arrears: e.target.value } })} aria-label={`Arrears for ${c.name}`} /></td></tr>;
                })}
              </tbody></table></div>
              <div className="ops-inline">
                <Button small variant="soft" disabled={busy || !Object.keys(inputs).length} onClick={() => void run(async () => { await opsApi.payrollInputs(id, Object.entries(inputs).map(([profileId, v]) => ({ profileId, lopDays: Number(v.lopDays || 0), arrearsPaise: rupeesToPaise(v.arrears || '0') }))); setInputs({}); toast('Inputs saved — recalculate', 'info'); await reload(); })}>Save inputs</Button>
                <Button small disabled={busy} onClick={() => void act('calculate', {}, 'Calculated')}>Calculate</Button>
                {d.status === 'CALCULATED' && <Button small disabled={busy} onClick={() => void act('submit', { acknowledgeUnverifiedRules: d.unverifiedRules.length ? window.confirm('Some statutory rules are unverified. Send for approval anyway? The approver will see this.') : undefined }, 'Sent to the principal for approval')}>Send for approval</Button>}
              </div>
            </SectionCard>
          )}

          {d.lines && d.lines.length > 0 && (
            <SectionCard title="Employees" sub={sensitive ? undefined : 'Individual pay is visible to payroll staff only; approvers see totals.'}>
              <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Employee</th><th className="num">Paid days</th>{sensitive && <><th className="num">Gross</th><th className="num">Deductions</th><th className="num">Net</th><th>Bank</th></>}<th>Notes</th></tr></thead><tbody>
                {d.lines.map((l) => <tr key={l.employeeCode}><td>{l.name}<div className="ops-muted">{l.employeeCode}</div></td><td className="num">{l.paidDays}{l.lopDays ? ` (−${l.lopDays})` : ''}</td>{sensitive && <><td className="num">{money(l.grossPaise)}</td><td className="num">{money(l.totalDeductionsPaise)}</td><td className="num"><b>{money(l.netPaise)}</b></td><td>{l.bankReady ? '✓' : '—'}</td></>}<td className="ops-muted">{l.warnings.join(' ')}</td></tr>)}
              </tbody></table></div>
            </SectionCard>
          )}

          {canPrep && (
            <div className="ops-inline">
              {d.status === 'APPROVED' && <Button small variant="ghost" onClick={() => setPrompt('reopen')}>Reopen (voids approval)</Button>}
              {sensitive && ['APPROVED', 'BANK_FILE_GENERATED'].includes(d.status) && <Button small disabled={busy} onClick={() => void run(async () => { await downloadCsv(`/payroll/runs/${id}/bank-file.csv`, `bank-${d.period}.csv`); toast('Bank file downloaded — upload it to the bank, then record the batch reference', 'info'); await reload(); })}>Download bank file</Button>}
              {d.status === 'BANK_FILE_GENERATED' && <Button small onClick={() => setPrompt('initiated')}>Record payment initiated</Button>}
              {d.status === 'PAYMENT_INITIATED' && <Button small onClick={() => setPrompt('confirmed')}>Confirm from bank statement</Button>}
              {d.status === 'PAYMENT_CONFIRMED' && <Button small variant="soft" onClick={() => void act('close', {}, 'Closed')}>Close run</Button>}
            </div>
          )}
          {d.bankFile && <KeyValues rows={[['Bank file', `${d.bankFile.rows} rows · ${money(d.bankFile.totalPaise)} · ${fmtDateTime(d.bankFile.generatedAt)}`], ['Bank reference', d.payment?.bankReference], ['Confirmed', d.payment?.confirmedAt ? `${fmtDateTime(d.payment.confirmedAt)} · ${money(d.payment.confirmedAmountPaise)}${d.payment.mismatchPaise ? ` (difference ${money(d.payment.mismatchPaise)})` : ''}` : 'Not yet']]} />}

          {canPrep && sensitive && ['APPROVED', 'BANK_FILE_GENERATED', 'PAYMENT_INITIATED', 'PAYMENT_CONFIRMED', 'CLOSED'].includes(d.status) && (
            <SectionCard title="Statutory filings" sub="Working files to key into or upload on the EPFO / ESIC / state / TRACES portals. A downloaded file is not a filing — record the acknowledgement after you submit.">
              <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Filing</th><th>Working file</th><th>Submitted</th><th /></tr></thead><tbody>
                {['EPF_ECR', 'ESI', 'PT', 'TDS_24Q'].map((code) => {
                  const s = d.statutory.find((x) => x.code === code);
                  return <tr key={code}><td>{humanize(code)}</td><td>{s?.exportedAt ? fmtDateTime(s.exportedAt) : '—'}</td><td>{s?.submittedAt ? `${fmtDate(s.submittedAt)} · ${s.acknowledgementNo ?? s.challanNo}` : '—'}</td><td className="ops-inline"><Button small variant="soft" onClick={() => void run(async () => { await downloadCsv(`/payroll/runs/${id}/statutory/${code}.csv`, `${code}-${d.period}.csv`); await reload(); })}>Download</Button>{s?.exportedAt && !s.submittedAt && <Button small variant="ghost" onClick={() => { setStat({ code, acknowledgementNo: '', challanNo: '' }); setPrompt('statutory'); }}>Record submission</Button>}</td></tr>;
                })}
              </tbody></table></div>
            </SectionCard>
          )}
          <ErrorNote error={error} />
          <Timeline items={d.history} />
        </>
      )}</Loadable>
      {prompt === 'reopen' && <PromptModal title="Reopen approved payroll" label="Reason" onClose={() => setPrompt(null)} onSubmit={(v) => opsApi.payrollAction(id, 'reopen', { reason: v }).then(reload)} />}
      {prompt === 'initiated' && <PromptModal title="Payment initiated" label="Bank batch / upload reference" multiline={false} onClose={() => setPrompt(null)} onSubmit={(v) => opsApi.payrollAction(id, 'payment-initiated', { bankReference: v }).then(reload)} />}
      {prompt === 'confirmed' && <PromptModal title="Confirm payment from the bank statement" label="Note (required if the amount differs)" required={false} hint="Confirmed by someone other than the person who initiated the payment." onClose={() => setPrompt(null)} extra={<Field label="Amount debited (₹)" required><input className="input" inputMode="decimal" value={confirmAmt} onChange={(e) => setConfirmAmt(e.target.value)} /></Field>} onSubmit={(v) => opsApi.payrollAction(id, 'payment-confirmed', { confirmedAmountPaise: rupeesToPaise(confirmAmt), note: v || undefined }).then(reload)} />}
      {prompt === 'statutory' && <PromptModal title={`Record ${humanize(stat.code)} submission`} label="Acknowledgement / TRRN no." multiline={false} required={false} onClose={() => setPrompt(null)} extra={<Field label="Challan no."><input className="input" value={stat.challanNo} onChange={(e) => setStat({ ...stat, challanNo: e.target.value })} /></Field>} onSubmit={(v) => opsApi.payrollAction(id, 'statutory', { code: stat.code, acknowledgementNo: v || undefined, challanNo: stat.challanNo || undefined }).then(reload)} />}
    </Drawer>
  );
}

const DEFAULT_COMPONENTS: PayComponent[] = [
  { code: 'BASIC', name: 'Basic', kind: 'EARNING', calc: 'FIXED', value: 0, statutoryWage: true },
  { code: 'DA', name: 'Dearness allowance', kind: 'EARNING', calc: 'PERCENT_OF_BASIC', value: 0, statutoryWage: true },
  { code: 'HRA', name: 'House rent allowance', kind: 'EARNING', calc: 'PERCENT_OF_BASIC', value: 4000 },
];

function CompensationModal({ c, onClose, onSaved }: { c: CompensationDto | null; onClose: () => void; onSaved: () => void }) {
  const staff = useLoad(() => opsApi.orgStaff(), []);
  const [f, setF] = useState({ profileId: c?.profileId ?? '', employeeCode: c?.employeeCode ?? '', designation: c?.designation ?? '', department: c?.department ?? '', employmentType: c?.employmentType ?? 'PERMANENT', joiningDate: c?.joiningDate?.slice(0, 10) ?? '', workState: c?.workState ?? '', pfApplicable: c?.pfApplicable ?? true, esiApplicable: c?.esiApplicable ?? false, uan: c?.uan ?? '', tds: c?.monthlyTdsPaise ? String(c.monthlyTdsPaise / 100) : '' });
  const [components, setComponents] = useState<Array<PayComponent & { input: string }>>((c?.components ?? DEFAULT_COMPONENTS).map((x) => ({ ...x, input: x.calc === 'FIXED' ? String(x.value / 100) : String(x.value / 100) })));
  const [bank, setBank] = useState({ accountNo: '', ifsc: '', holder: '' });
  const { run, busy, error } = useAction();
  return (
    <Modal title={c ? `Pay structure: ${c.name}` : 'Add pay structure'} onClose={onClose} wide footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.profileId || !f.employeeCode || !f.joiningDate} onClick={() => void run(async () => {
      await opsApi.saveCompensation({ ...f, monthlyTdsPaise: f.tds ? rupeesToPaise(f.tds) : 0, components: components.map(({ input, ...x }) => ({ ...x, value: Math.round(Number(input || 0) * 100) })), bank: bank.accountNo ? bank : undefined });
      onSaved(); onClose();
    })}>Save</Button></>}>
      <div className="ops-form-grid">
        <Field label="Employee" required><select className="input" value={f.profileId} disabled={Boolean(c)} onChange={(e) => setF({ ...f, profileId: e.target.value })}><option value="">Choose…</option>{(staff.data ?? []).map((s) => <option key={s.profileId} value={s.profileId}>{s.name}</option>)}</select></Field>
        <Field label="Employee code" required><input className="input" value={f.employeeCode} onChange={(e) => setF({ ...f, employeeCode: e.target.value })} /></Field>
        <Field label="Designation"><input className="input" value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} /></Field>
        <Field label="Department"><input className="input" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></Field>
        <Field label="Employment type"><select className="input" value={f.employmentType} onChange={(e) => setF({ ...f, employmentType: e.target.value })}>{['PERMANENT', 'PROBATION', 'CONTRACT', 'VISITING', 'PART_TIME'].map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select></Field>
        <Field label="Joined" required><input type="date" className="input" value={f.joiningDate} onChange={(e) => setF({ ...f, joiningDate: e.target.value })} /></Field>
        <Field label="Work state (for professional tax)"><input className="input" value={f.workState} onChange={(e) => setF({ ...f, workState: e.target.value })} placeholder="Maharashtra" /></Field>
        <Field label="UAN"><input className="input" value={f.uan} onChange={(e) => setF({ ...f, uan: e.target.value })} /></Field>
        <Field label="Monthly TDS (₹)" hint="From your tax adviser — EduOS does not compute income tax"><input className="input" inputMode="decimal" value={f.tds} onChange={(e) => setF({ ...f, tds: e.target.value })} /></Field>
      </div>
      <div className="ops-inline"><label className="ops-chip"><input type="checkbox" checked={f.pfApplicable} onChange={(e) => setF({ ...f, pfApplicable: e.target.checked })} />PF applies</label><label className="ops-chip"><input type="checkbox" checked={f.esiApplicable} onChange={(e) => setF({ ...f, esiApplicable: e.target.checked })} />ESI applies (state-notified)</label></div>
      <SectionCard title="Components (monthly)">
        {components.map((x, i) => (
          <div key={i} className="ops-inline" style={{ marginBottom: 6 }}>
            <input className="input" value={x.code} onChange={(e) => setComponents(components.map((y, j) => (j === i ? { ...y, code: e.target.value.toUpperCase() } : y)))} style={{ width: 90 }} aria-label="Code" />
            <input className="input" value={x.name} onChange={(e) => setComponents(components.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} aria-label="Name" />
            <select className="input" value={x.kind} onChange={(e) => setComponents(components.map((y, j) => (j === i ? { ...y, kind: e.target.value as PayComponent['kind'] } : y)))} aria-label="Kind"><option value="EARNING">Earning</option><option value="DEDUCTION">Deduction</option></select>
            <select className="input" value={x.calc} onChange={(e) => setComponents(components.map((y, j) => (j === i ? { ...y, calc: e.target.value as PayComponent['calc'] } : y)))} aria-label="Calculation"><option value="FIXED">₹ fixed</option><option value="PERCENT_OF_BASIC">% of basic</option></select>
            <input className="input" inputMode="decimal" value={x.input} onChange={(e) => setComponents(components.map((y, j) => (j === i ? { ...y, input: e.target.value } : y)))} style={{ width: 110 }} aria-label={x.calc === 'FIXED' ? 'Amount in rupees' : 'Percent'} />
            <label className="ops-chip" title="Counts as wages for PF/ESI (basic, DA, retaining allowance)"><input type="checkbox" checked={Boolean(x.statutoryWage)} onChange={(e) => setComponents(components.map((y, j) => (j === i ? { ...y, statutoryWage: e.target.checked } : y)))} />wage</label>
          </div>
        ))}
        <Button small variant="ghost" onClick={() => setComponents([...components, { code: 'NEW', name: 'New component', kind: 'EARNING', calc: 'FIXED', value: 0, input: '0' }])}>+ Component</Button>
      </SectionCard>
      <SectionCard title="Bank account" sub={c?.bankLast4 ? `On file: ••••${c.bankLast4}. Enter new details only to replace them.` : 'Stored encrypted. Visible only in the bank file.'}>
        <div className="ops-form-grid">
          <Field label="Account no."><input className="input" inputMode="numeric" autoComplete="off" value={bank.accountNo} onChange={(e) => setBank({ ...bank, accountNo: e.target.value })} /></Field>
          <Field label="IFSC"><input className="input" value={bank.ifsc} onChange={(e) => setBank({ ...bank, ifsc: e.target.value.toUpperCase() })} /></Field>
          <Field label="Account holder"><input className="input" value={bank.holder} onChange={(e) => setBank({ ...bank, holder: e.target.value })} /></Field>
        </div>
      </SectionCard>
      <ErrorNote error={error} />
    </Modal>
  );
}

export function PayrollView() {
  const { permissions } = usePermissions();
  const canPrep = Boolean(permissions['payroll.prepare']);
  const [tab, setTab] = useState<'runs' | 'people' | 'rules'>('runs');
  const runs = useLoad(() => opsApi.payrollRuns(), []);
  const comp = useLoad(() => (tab === 'people' && canPrep ? opsApi.compensation() : Promise.resolve([] as CompensationDto[])), [tab, canPrep]);
  const rules = useLoad(() => (tab === 'rules' ? opsApi.payrollRules() : Promise.resolve([])), [tab]);
  const [selected, setSelected] = useState<string | null>(useQueryParam('id'));
  const [period, setPeriod] = useState(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7));
  const [editComp, setEditComp] = useState<CompensationDto | null | 'new'>(null);
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <div className="ops-stack">
      <Tabs tabs={[{ key: 'runs', label: 'Payroll runs' }, ...(canPrep ? [{ key: 'people' as const, label: 'Pay structures' }] : []), { key: 'rules', label: 'Statutory rules' }]} value={tab} onChange={setTab} />
      {tab === 'runs' && (
        <>
          {canPrep && <div className="ops-inline"><input type="month" className="input" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Pay period" /><Button disabled={busy} onClick={() => void run(async () => { const r = await opsApi.createPayrollRun({ period }); await runs.reload(); setSelected(r.id); })}>Start payroll for {period}</Button></div>}
          <Loadable state={runs}>{(rows) => !rows.length ? <EmptyState title="No payroll runs" sub="Set up pay structures, verify statutory rules, then start a run." /> : (
            <SectionCard title="Runs">
              <ul className="ops-list">{rows.map((r) => <li key={r.id} className="ops-row"><div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => setSelected(r.id)}><div className="ops-row-title">{r.period} · {humanize(r.kind)}</div><div className="ops-row-sub">{r.refNo} · {r.totals.headcount} employees · net {money(r.totals.netPaise)}</div></button></div><StatusPill status={r.status} /></li>)}</ul>
            </SectionCard>
          )}</Loadable>
        </>
      )}
      {tab === 'people' && <Loadable state={comp}>{(rows) => (
        <SectionCard title="Pay structures" actions={<Button small onClick={() => setEditComp('new')}>+ Add</Button>}>
          {!rows.length ? <p className="ops-muted">None yet.</p> : (
            <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Employee</th><th>Type</th><th>Joined</th><th>PF</th><th>ESI</th><th>Bank</th><th>Status</th></tr></thead><tbody>
              {rows.map((c) => <tr key={c.id} className="is-clickable" onClick={() => setEditComp(c)}><td><b>{c.name}</b><div className="ops-muted">{c.employeeCode} · {c.designation ?? ''}</div></td><td>{humanize(c.employmentType)}</td><td>{fmtDate(c.joiningDate)}</td><td>{c.pfApplicable ? '✓' : '—'}</td><td>{c.esiApplicable ? '✓' : '—'}</td><td>{c.bankLast4 ? `••••${c.bankLast4}` : <span className="ops-flag-overdue">missing</span>}</td><td><StatusPill status={c.status} /></td></tr>)}
            </tbody></table></div>
          )}
        </SectionCard>
      )}</Loadable>}
      {tab === 'rules' && <Loadable state={rules}>{(rows) => (
        <SectionCard title="Statutory rules" sub="Effective-dated parameters. Payroll uses the row in force on the last day of the period. Seeded rows come from the source register and are unverified until your payroll adviser confirms them." actions={canPrep ? <Button small variant="soft" disabled={busy} onClick={() => void run(async () => { const r = await opsApi.seedPayrollRules(); toast(`${r.added} rule(s) added (unverified)`, 'info'); await rules.reload(); })}>Load starting rules</Button> : undefined}>
          {!rows.length ? <p className="ops-muted">No rules configured.</p> : (
            <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Rule</th><th>From</th><th>To</th><th>Parameters</th><th>Source</th><th>Verified</th></tr></thead><tbody>
              {rows.map((r) => <tr key={r.id}><td><b>{humanize(r.code)}</b>{r.jurisdiction ? ` · ${r.jurisdiction}` : ''}{r.note && <div className="ops-muted">{r.note}</div>}</td><td>{fmtDate(r.effectiveFrom)}</td><td>{r.effectiveTo ? fmtDate(r.effectiveTo) : 'open'}</td><td className="ops-muted">{Object.entries(r.params).map(([k, v]) => `${k}: ${k.endsWith('Bp') ? `${Number(v) / 100}%` : k.endsWith('Paise') ? money(Number(v)) : JSON.stringify(v)}`).join(' · ')}</td><td>{r.sourceRef ?? '—'}</td><td>{r.verified ? <StatusPill status="CLEARED" label="Verified" /> : canPrep ? <Button small variant="soft" onClick={() => void run(async () => { await opsApi.verifyRule(r.id); await rules.reload(); })}>Mark verified</Button> : <StatusPill status="PENDING" label="Unverified" />}</td></tr>)}
            </tbody></table></div>
          )}
          <DataNote>The EPF wage ceiling changed from ₹15,000 to ₹25,000 on 17 Sep 2026 (S.O. 5109(E)); both rows are kept so earlier periods recalculate correctly. Professional tax is state-specific and is not pre-loaded.</DataNote>
        </SectionCard>
      )}</Loadable>}
      <ErrorNote error={error} />
      {selected && <RunDetail id={selected} onClose={() => setSelected(null)} onChanged={() => void runs.reload()} />}
      {editComp && <CompensationModal c={editComp === 'new' ? null : editComp} onClose={() => setEditComp(null)} onSaved={() => void comp.reload()} />}
    </div>
  );
}

export function PayslipsView() {
  const state = useLoad(() => opsApi.myPayslips(), []);
  return (
    <Loadable state={state}>{(rows) => !rows.length ? <EmptyState title="No payslips yet" sub="Payslips appear once a payroll that includes you is approved." /> : (
      <div className="ops-stack">{rows.map((s) => (
        <SectionCard key={`${s.runId}`} title={`Payslip · ${s.period}`} actions={<StatusPill status={s.status === 'PAID' ? 'PAID' : 'APPROVED'} label={s.status === 'PAID' ? 'Paid' : 'Approved, payment pending'} />}>
          <div className="ops-grid-2">
            <div><h3 className="ops-section-title">Earnings</h3><table className="ops-table"><tbody>{s.earnings?.map((e) => <tr key={e.code}><td>{e.name}</td><td className="num">{money(e.amountPaise)}</td></tr>)}{s.arrearsPaise ? <tr><td>Arrears</td><td className="num">{money(s.arrearsPaise)}</td></tr> : null}<tr><td><b>Gross</b></td><td className="num"><b>{money(s.grossPaise)}</b></td></tr></tbody></table></div>
            <div><h3 className="ops-section-title">Deductions</h3><table className="ops-table"><tbody>{s.deductions?.map((d) => <tr key={d.code}><td>{d.name}</td><td className="num">{money(d.amountPaise)}</td></tr>)}<tr><td><b>Total</b></td><td className="num"><b>{money(s.totalDeductionsPaise)}</b></td></tr></tbody></table></div>
          </div>
          <KeyValues rows={[['Paid days', `${s.paidDays}${s.lopDays ? ` (loss of pay ${s.lopDays})` : ''}`], ['Net pay', <b key="n">{money(s.netPaise)}</b>], ['Employer contributions', money((s.employerContributions ?? []).reduce((n, e) => n + e.amountPaise, 0))]]} />
        </SectionCard>
      ))}</div>
    )}</Loadable>
  );
}

// ═════════════════════════ Procurement ═════════════════════════

const PR_STEPS = [{ key: 'DRAFT', label: 'Draft' }, { key: 'IN_APPROVAL', label: 'Approval' }, { key: 'APPROVED', label: 'Approved' }, { key: 'PO_ISSUED', label: 'PO' }, { key: 'RECEIVED', label: 'Received' }, { key: 'INVOICED', label: 'Invoiced' }, { key: 'PAYMENT_APPROVED', label: 'Pay approved' }, { key: 'PAID', label: 'Paid' }];

function PrDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { permissions } = usePermissions();
  const canManage = Boolean(permissions['procurement.manage']);
  const state = useLoad(() => opsApi.purchaseRequest(id), [id]);
  const vendors = useLoad(() => opsApi.vendors(), []);
  const [quotes, setQuotes] = useState<Array<{ vendorId: string; amount: string; url: string; selected: boolean }> | null>(null);
  const [selectionNote, setSelectionNote] = useState('');
  const [receipt, setReceipt] = useState<Record<number, { received: string; rejected: string }>>({});
  const [inv, setInv] = useState({ vendorInvoiceNo: '', amount: '', url: '' });
  const [prompt, setPrompt] = useState<null | 'cancel' | 'pay-mismatch' | 'initiate' | 'confirm'>(null);
  const { run, busy, error } = useAction();
  const toast = useToast();
  const reload = async () => { await state.reload(); onChanged(); };
  const act = (action: string, body: unknown, msg: string) => run(async () => { await opsApi.prAction(id, action, body); toast(msg, 'success'); await reload(); });
  return (
    <Drawer title={state.data?.title ?? 'Purchase request'} sub={state.data ? `${state.data.refNo} · ${state.data.requesterName ?? ''} · ${humanize(state.data.kind)}` : undefined} onClose={onClose}
      footer={state.data && ['DRAFT', 'APPROVED', 'PO_ISSUED'].includes(state.data.status) && <Button variant="ghost" onClick={() => setPrompt('cancel')}>Cancel request</Button>}>
      <Loadable state={state}>{(p: PurchaseRequestDto) => (
        <>
          <Stepper steps={PR_STEPS} current={p.status === 'PARTIALLY_RECEIVED' ? 'PO_ISSUED' : p.status === 'PAYMENT_INITIATED' ? 'PAYMENT_APPROVED' : p.status} failed={['REJECTED', 'CANCELLED'].includes(p.status)} />
          <div className="ops-inline"><StatusPill status={p.status} />{p.emergency && <StatusPill status="REJECTED" label="Emergency" />}<span className="ops-muted">Amount {money(p.amountPaise)}</span></div>
          {p.checks.length > 0 && <div className="ops-callout is-warn"><b>Checks shown to approvers</b><ul>{p.checks.map((c, i) => <li key={i}>{c.message}</li>)}</ul></div>}
          <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Est. unit</th><th className="num">Received</th></tr></thead><tbody>
            {p.items.map((it, i) => <tr key={i}><td>{it.description}{it.isAsset && <span className="ops-chip">asset</span>}</td><td className="num">{it.qty} {it.unit}</td><td className="num">{money(it.estUnitPaise)}</td><td className="num">{it.receivedQty}{it.rejectedQty ? ` (−${it.rejectedQty} rejected)` : ''}</td></tr>)}
          </tbody></table></div>
          {p.justification && <p><b>Why:</b> {p.justification}</p>}

          <SectionCard title="Quotes" sub="Purchases of ₹50,000 or more need three quotes unless declared an emergency.">
            {p.status === 'DRAFT' && (p.isRequester || canManage) ? (
              <>
                {(quotes ?? p.quotes.map((q) => ({ vendorId: q.vendorId, amount: String(q.amountPaise / 100), url: q.url ?? '', selected: q.selected }))).map((q, i, arr) => (
                  <div key={i} className="ops-inline" style={{ marginBottom: 6 }}>
                    <select className="input" value={q.vendorId} onChange={(e) => setQuotes(arr.map((y, j) => (j === i ? { ...y, vendorId: e.target.value } : y)))} aria-label="Vendor"><option value="">Vendor…</option>{(vendors.data ?? []).filter((v) => v.status !== 'BLOCKED').map((v) => <option key={v.id} value={v.id}>{v.name}{v.status !== 'ACTIVE' ? ' (not vetted)' : ''}</option>)}</select>
                    <input className="input" inputMode="decimal" value={q.amount} onChange={(e) => setQuotes(arr.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} placeholder="₹" style={{ width: 120 }} aria-label="Quote amount" />
                    <label className="ops-chip"><input type="radio" name="sel" checked={q.selected} onChange={() => setQuotes(arr.map((y, j) => ({ ...y, selected: j === i })))} />select</label>
                  </div>
                ))}
                <div className="ops-inline">
                  <Button small variant="ghost" onClick={() => setQuotes([...(quotes ?? p.quotes.map((q) => ({ vendorId: q.vendorId, amount: String(q.amountPaise / 100), url: q.url ?? '', selected: q.selected }))), { vendorId: '', amount: '', url: '', selected: false }])}>+ Quote</Button>
                  <input className="input" value={selectionNote} onChange={(e) => setSelectionNote(e.target.value)} placeholder="Why this vendor (needed if not the lowest)" aria-label="Selection note" style={{ flex: 1 }} />
                  {quotes && <Button small variant="soft" disabled={busy} onClick={() => void run(async () => { await opsApi.setQuotes(id, { quotes: quotes.filter((q) => q.vendorId && q.amount).map((q) => ({ vendorId: q.vendorId, amountPaise: rupeesToPaise(q.amount), url: q.url || undefined, selected: q.selected })), selectionNote }); setQuotes(null); await reload(); })}>Save quotes</Button>}
                </div>
                <Button disabled={busy} onClick={() => void act('submit', {}, 'Sent for approval')}>Submit for approval</Button>
              </>
            ) : !p.quotes.length ? <p className="ops-muted">No quotes.</p> : <ul className="ops-list">{p.quotes.map((q, i) => <li key={i} className="ops-row"><div className="ops-row-main">{q.vendorName}</div><b>{money(q.amountPaise)}</b>{q.selected && <StatusPill status="APPROVED" label="Selected" />}</li>)}</ul>}
            {p.selectionNote && <p className="ops-muted">Selection: {p.selectionNote}</p>}
          </SectionCard>

          {canManage && p.status === 'APPROVED' && <Button disabled={busy} onClick={() => void act('po', {}, 'Purchase order issued')}>Issue purchase order</Button>}
          {p.po && <KeyValues rows={[['PO', `${p.po.number} · ${fmtDate(p.po.issuedAt)}`], ['Vendor', p.po.vendorName], ['PO amount', money(p.po.amountPaise)]]} />}

          {canManage && ['PO_ISSUED', 'PARTIALLY_RECEIVED'].includes(p.status) && (
            <SectionCard title="Goods / service receipt" sub="Recorded by someone other than the requester.">
              {p.items.map((it, i) => (
                <div key={i} className="ops-inline" style={{ marginBottom: 6 }}><span style={{ flex: 1 }}>{it.description} ({it.receivedQty}/{it.qty})</span>
                  <input className="input" inputMode="decimal" style={{ width: 90 }} placeholder="received" value={receipt[i]?.received ?? ''} onChange={(e) => setReceipt({ ...receipt, [i]: { received: e.target.value, rejected: receipt[i]?.rejected ?? '' } })} aria-label={`Received ${it.description}`} />
                  <input className="input" inputMode="decimal" style={{ width: 90 }} placeholder="rejected" value={receipt[i]?.rejected ?? ''} onChange={(e) => setReceipt({ ...receipt, [i]: { received: receipt[i]?.received ?? '', rejected: e.target.value } })} aria-label={`Rejected ${it.description}`} />
                </div>
              ))}
              <Button small disabled={busy} onClick={() => void act('receive', { lines: Object.entries(receipt).map(([i, v]) => ({ itemIndex: Number(i), received: Number(v.received || 0), rejected: Number(v.rejected || 0) })) }, 'Receipt recorded').then(() => setReceipt({}))}>Record receipt</Button>
            </SectionCard>
          )}

          {canManage && ['RECEIVED', 'INVOICED'].includes(p.status) && p.status === 'RECEIVED' && (
            <SectionCard title="Vendor invoice" sub="Matched against the PO price for the quantity accepted (1% tolerance).">
              <div className="ops-form-grid"><Field label="Invoice no."><input className="input" value={inv.vendorInvoiceNo} onChange={(e) => setInv({ ...inv, vendorInvoiceNo: e.target.value })} /></Field><Field label="Amount (₹)"><input className="input" inputMode="decimal" value={inv.amount} onChange={(e) => setInv({ ...inv, amount: e.target.value })} /></Field></div>
              <AttachUpload label="Invoice copy" onUploaded={(a) => setInv((x) => ({ ...x, url: a.url }))} />
              <Button small disabled={busy || !inv.vendorInvoiceNo || !inv.amount} onClick={() => void act('invoice', { vendorInvoiceNo: inv.vendorInvoiceNo, amountPaise: rupeesToPaise(inv.amount), url: inv.url || undefined }, 'Invoice booked')}>Book invoice</Button>
            </SectionCard>
          )}
          {p.invoices.map((iv, i) => <div key={i} className={`ops-callout ${iv.matchStatus === 'MATCHED' ? '' : 'is-warn'}`}>Invoice {iv.vendorInvoiceNo}: {money(iv.amountPaise)} — <b>{humanize(iv.matchStatus)}</b>{iv.matchNote ? `. ${iv.matchNote}` : ''}</div>)}
          {canManage && p.status === 'INVOICED' && !p.payment?.approvalRequestId && (p.invoices.at(-1)?.matchStatus === 'MATCHED'
            ? <Button disabled={busy} onClick={() => void act('approve-payment', {}, 'Payment approved')}>Approve payment</Button>
            : <Button disabled={busy} onClick={() => setPrompt('pay-mismatch')}>Request approval to pay despite mismatch</Button>)}
          {canManage && p.status === 'PAYMENT_APPROVED' && <Button onClick={() => setPrompt('initiate')}>Record payment initiated</Button>}
          {canManage && p.status === 'PAYMENT_INITIATED' && <Button onClick={() => setPrompt('confirm')}>Confirm from bank statement</Button>}
          {p.payment?.confirmedAt && <p><b>Paid</b> {fmtDate(p.payment.confirmedAt)} · UTR {p.payment.bankReference}</p>}
          <ErrorNote error={error} />
          <Timeline items={p.history} />
        </>
      )}</Loadable>
      {prompt === 'cancel' && <PromptModal title="Cancel purchase request" label="Reason" danger onClose={() => setPrompt(null)} onSubmit={(v) => opsApi.prAction(id, 'cancel', { reason: v }).then(reload)} />}
      {prompt === 'pay-mismatch' && <PromptModal title="Pay despite invoice mismatch" label="Why it should be paid" hint="This goes to the approvers with the mismatch details." onClose={() => setPrompt(null)} onSubmit={(v) => opsApi.prAction(id, 'approve-payment', { reason: v }).then(reload)} />}
      {prompt === 'initiate' && <PromptModal title="Payment initiated" label="Reference (NEFT batch / cheque no.)" multiline={false} onClose={() => setPrompt(null)} onSubmit={(v) => opsApi.prAction(id, 'payment-initiated', { reference: v }).then(reload)} />}
      {prompt === 'confirm' && <PromptModal title="Confirm payment" label="Bank UTR / reference from the statement" hint="Confirmed by someone other than the person who initiated it." multiline={false} onClose={() => setPrompt(null)} onSubmit={(v) => opsApi.prAction(id, 'payment-confirmed', { bankReference: v }).then(reload)} />}
    </Drawer>
  );
}

function NewPrModal({ onClose, onDone }: { onClose: () => void; onDone: (p: PurchaseRequestDto) => void }) {
  const budgets = useLoad(() => opsApi.budgets().catch(() => [] as BudgetDto[]), []);
  const [f, setF] = useState({ title: '', department: '', justification: '', budgetKey: '', emergency: false, emergencyReason: '' });
  const [items, setItems] = useState([{ description: '', qty: '1', unit: 'nos', est: '', isAsset: false }]);
  const { run, busy, error } = useAction();
  const lines = (budgets.data ?? []).filter((b) => b.status === 'APPROVED').flatMap((b) => b.lines.map((l) => ({ key: `${b.id}|${l.code}`, label: `${b.fiscalYear} · ${l.code} ${l.head} (available ${money(l.availablePaise)})` })));
  return (
    <Modal title="New purchase request" onClose={onClose} wide footer={<><Button variant="soft" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.title || !items.some((i) => i.description && i.est)} onClick={() => void run(async () => {
      const [budgetId, budgetLineCode] = f.budgetKey ? f.budgetKey.split('|') : [undefined, undefined];
      const p = await opsApi.createPurchaseRequest({ title: f.title, department: f.department, justification: f.justification, budgetId, budgetLineCode, emergency: f.emergency, emergencyReason: f.emergency ? f.emergencyReason : undefined, items: items.filter((i) => i.description && i.est).map((i) => ({ description: i.description, qty: Number(i.qty), unit: i.unit, estUnitPaise: rupeesToPaise(i.est), isAsset: i.isAsset })) });
      onDone(p); onClose();
    })}>Create</Button></>}>
      <div className="ops-form-grid">
        <Field label="What for" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Department"><input className="input" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></Field>
        <Field label="Budget line"><select className="input" value={f.budgetKey} onChange={(e) => setF({ ...f, budgetKey: e.target.value })}><option value="">Not linked</option>{lines.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}</select></Field>
      </div>
      {items.map((it, i) => (
        <div key={i} className="ops-inline" style={{ marginBottom: 6 }}>
          <input className="input" value={it.description} onChange={(e) => setItems(items.map((y, j) => (j === i ? { ...y, description: e.target.value } : y)))} placeholder="Item" style={{ flex: 1 }} aria-label={`Item ${i + 1}`} />
          <input className="input" inputMode="decimal" value={it.qty} onChange={(e) => setItems(items.map((y, j) => (j === i ? { ...y, qty: e.target.value } : y)))} style={{ width: 70 }} aria-label="Quantity" />
          <input className="input" inputMode="decimal" value={it.est} onChange={(e) => setItems(items.map((y, j) => (j === i ? { ...y, est: e.target.value } : y)))} placeholder="₹ each" style={{ width: 110 }} aria-label="Estimated unit price" />
          <label className="ops-chip"><input type="checkbox" checked={it.isAsset} onChange={(e) => setItems(items.map((y, j) => (j === i ? { ...y, isAsset: e.target.checked } : y)))} />asset</label>
        </div>
      ))}
      <Button small variant="ghost" onClick={() => setItems([...items, { description: '', qty: '1', unit: 'nos', est: '', isAsset: false }])}>+ Item</Button>
      <Field label="Justification"><textarea className="input" rows={2} value={f.justification} onChange={(e) => setF({ ...f, justification: e.target.value })} style={{ width: '100%' }} /></Field>
      <label className="ops-inline"><input type="checkbox" checked={f.emergency} onChange={(e) => setF({ ...f, emergency: e.target.checked })} /> Emergency purchase</label>
      {f.emergency && <Field label="Emergency reason" required><input className="input" value={f.emergencyReason} onChange={(e) => setF({ ...f, emergencyReason: e.target.value })} style={{ width: '100%' }} /></Field>}
      <ErrorNote error={error} />
    </Modal>
  );
}

export function ProcurementView() {
  const { permissions } = usePermissions();
  const canManage = Boolean(permissions['procurement.manage']);
  const [tab, setTab] = useState<'requests' | 'vendors' | 'assets'>('requests');
  const stats = useLoad(() => opsApi.procurementStats(), []);
  const list = useLoad(() => (tab === 'requests' ? opsApi.purchaseRequests({ pageSize: 100 }) : Promise.resolve(null)), [tab]);
  const vendors = useLoad(() => (tab === 'vendors' ? opsApi.vendors() : Promise.resolve([])), [tab]);
  const assets = useLoad(() => (tab === 'assets' ? opsApi.assets() : Promise.resolve([])), [tab]);
  const [selected, setSelected] = useState<string | null>(useQueryParam('id'));
  const [creating, setCreating] = useState(false);
  const [vendorForm, setVendorForm] = useState<null | { name: string; gstin: string; category: string; contactName: string; phone: string }>(null);
  const [dd, setDd] = useState<string | null>(null);
  const { run, busy, error } = useAction();
  return (
    <div className="ops-stack">
      <Loadable state={stats}>{(s) => (
        <div className="kpi-grid">
          <Tile label="In approval" value={s.purchaseRequestsInApproval} />
          <Tile label="Awaiting receipt" value={s.ordersAwaitingReceipt} />
          <Tile label="Invoices to pay" value={s.invoicesAwaitingPayment} />
          <Tile label="Budget used" value={s.budgetPlannedPaise ? `${Math.round(((s.budgetActualPaise + s.budgetCommittedPaise) / s.budgetPlannedPaise) * 100)}%` : 'No budget'} />
          <Tile label="Lines over budget" value={s.linesOverBudget} tone={s.linesOverBudget ? 'bad' : 'good'} />
        </div>
      )}</Loadable>
      <div className="ops-inline"><Tabs tabs={[{ key: 'requests', label: 'Purchase requests' }, { key: 'vendors', label: 'Vendors' }, { key: 'assets', label: 'Assets' }]} value={tab} onChange={setTab} /><Button onClick={() => setCreating(true)}>+ Purchase request</Button>{canManage && tab === 'vendors' && <Button variant="soft" onClick={() => setVendorForm({ name: '', gstin: '', category: '', contactName: '', phone: '' })}>+ Vendor</Button>}</div>
      {tab === 'requests' && <Loadable state={list}>{(d) => !d?.items.length ? <EmptyState title="No purchase requests" sub="Raise one for anything the institution needs to buy." /> : (
        <SectionCard title="Purchase requests">
          <ul className="ops-list">{d.items.map((p) => <li key={p.id} className="ops-row"><div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => setSelected(p.id)}><div className="ops-row-title">{p.title}</div><div className="ops-row-sub">{p.refNo} · {p.requesterName} · {money(p.amountPaise)}{p.checks.some((c) => c.level === 'WARNING') ? ' · ⚠ checks' : ''}</div></button></div><StatusPill status={p.status} /></li>)}</ul>
        </SectionCard>
      )}</Loadable>}
      {tab === 'vendors' && <Loadable state={vendors}>{(rows) => (
        <SectionCard title="Vendors" sub="New vendors need due diligence before they are marked active. Staff can declare a relationship with a vendor; they are then excluded from approving its purchases.">
          {!rows.length ? <p className="ops-muted">No vendors.</p> : <ul className="ops-list">{rows.map((v) => <li key={v.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{v.name}</div><div className="ops-row-sub">{v.category ?? ''}{v.gstin ? ` · GSTIN ${v.gstin}` : ''}{v.contactName ? ` · ${v.contactName}` : ''}</div></div><StatusPill status={v.status === 'PENDING_DUE_DILIGENCE' ? 'PENDING' : v.status} label={humanize(v.status)} />{canManage && v.status !== 'ACTIVE' && <Button small variant="soft" onClick={() => setDd(v.id)}>Due diligence</Button>}<Button small variant="ghost" onClick={() => { const d = window.prompt('Describe your relationship with this vendor'); if (d) void run(async () => { await opsApi.vendorAction(v.id, 'conflict', { declaration: d }); }); }}>Declare conflict</Button></li>)}</ul>}
        </SectionCard>
      )}</Loadable>}
      {tab === 'assets' && <Loadable state={assets}>{(rows) => (
        <SectionCard title="Asset register" sub="Created automatically when a capital purchase is paid.">
          {!rows.length ? <p className="ops-muted">No assets yet.</p> : <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Tag</th><th>Description</th><th className="num">Cost</th><th>Acquired</th><th>Status</th></tr></thead><tbody>{rows.map((a) => <tr key={a.id}><td>{a.tag}</td><td>{a.description}<div className="ops-muted">{a.vendorName}</div></td><td className="num">{money(a.costPaise)}</td><td>{fmtDate(a.acquiredOn)}</td><td><StatusPill status={a.status === 'IN_USE' ? 'ACTIVE' : 'DRAFT'} label={humanize(a.status)} /></td></tr>)}</tbody></table></div>}
        </SectionCard>
      )}</Loadable>}
      <ErrorNote error={error} />
      {creating && <NewPrModal onClose={() => setCreating(false)} onDone={(p) => { void list.reload(); setSelected(p.id); }} />}
      {selected && <PrDetail id={selected} onClose={() => setSelected(null)} onChanged={() => { void list.reload(); void stats.reload(); }} />}
      {vendorForm && (
        <Modal title="Add vendor" onClose={() => setVendorForm(null)} footer={<><Button variant="soft" onClick={() => setVendorForm(null)}>Cancel</Button><Button disabled={busy || !vendorForm.name} onClick={() => void run(async () => { await opsApi.createVendor(vendorForm); setVendorForm(null); await vendors.reload(); })}>Save</Button></>}>
          <div className="ops-form-grid">{(['name', 'gstin', 'category', 'contactName', 'phone'] as const).map((k) => <Field key={k} label={humanize(k === 'gstin' ? 'GSTIN' : k)}><input className="input" value={vendorForm[k]} onChange={(e) => setVendorForm({ ...vendorForm, [k]: e.target.value })} /></Field>)}</div>
        </Modal>
      )}
      {dd && <PromptModal title="Vendor due diligence" label="What was checked (GST, PAN, references, past performance, conflicts)" onClose={() => setDd(null)} onSubmit={(v) => opsApi.vendorAction(dd, 'due-diligence', { status: 'ACTIVE', note: v }).then(() => vendors.reload())} />}
      {busy && null}
    </div>
  );
}

// ═════════════════════════ Budgets & funding ═════════════════════════

export function BudgetsView() {
  const { permissions } = usePermissions();
  const canManage = Boolean(permissions['budget.manage']);
  const canFund = Boolean(permissions['funding.manage']);
  const [tab, setTab] = useState<'budgets' | 'funding'>('budgets');
  const budgets = useLoad(() => opsApi.budgets(), []);
  const funding = useLoad(() => (tab === 'funding' && permissions['funding.read'] ? opsApi.funding() : Promise.resolve([])), [tab]);
  const [creating, setCreating] = useState<null | 'budget' | 'funding'>(null);
  const [bf, setBf] = useState({ fiscalYear: '2026-27', name: 'Main budget', lines: [{ code: 'ACAD', head: 'Academics', kind: 'OPEX', planned: '' }] });
  const [ff, setFf] = useState({ kind: 'LOAN', title: '', purpose: '', amount: '', offers: [{ provider: '', principal: '', ratePct: '', tenureMonths: '', fee: '', selected: true }] });
  const [variance, setVariance] = useState<null | { budgetId: string; code: string }>(null);
  const { run, busy, error } = useAction();
  return (
    <div className="ops-stack">
      <div className="ops-inline"><Tabs tabs={[{ key: 'budgets', label: 'Budgets' }, ...(permissions['funding.read'] ? [{ key: 'funding' as const, label: 'Funding' }] : [])]} value={tab} onChange={setTab} />{tab === 'budgets' && canManage && <Button onClick={() => setCreating('budget')}>+ Budget</Button>}{tab === 'funding' && canFund && <Button onClick={() => setCreating('funding')}>+ Funding proposal</Button>}</div>
      {tab === 'budgets' && <Loadable state={budgets}>{(rows) => !rows.length ? <EmptyState title="No budgets" sub="Plan the year by department and head; approvals and payments update commitments and actuals." /> : (
        <div className="ops-stack">{rows.map((b) => (
          <SectionCard key={b.id} title={`${b.fiscalYear} · ${b.name}`} sub={`Planned ${money(b.totals.planned)} · committed ${money(b.totals.committed)} · spent ${money(b.totals.actual)}`} actions={<><StatusPill status={b.status} />{canManage && b.status === 'DRAFT' && <Button small disabled={busy} onClick={() => void run(async () => { await opsApi.submitBudget(b.id); await budgets.reload(); })}>Send for approval</Button>}</>}>
            <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Line</th><th className="num">Planned</th><th className="num">Committed</th><th className="num">Actual</th><th className="num">Available</th><th>Use</th><th>Variance note</th></tr></thead><tbody>
              {b.lines.map((l) => <tr key={l.code}><td><b>{l.code}</b> {l.head}<div className="ops-muted">{humanize(l.kind)}</div></td><td className="num">{money(l.plannedPaise)}</td><td className="num">{money(l.committedPaise)}</td><td className="num">{money(l.actualPaise)}</td><td className="num">{money(l.availablePaise)}</td><td style={{ minWidth: 110 }}><div className={`ops-bar${(l.utilisationPct ?? 0) > 100 ? ' is-over' : ''}`}><span style={{ width: `${Math.min(l.utilisationPct ?? 0, 100)}%` }} /></div><span className="ops-muted">{l.utilisationPct ?? 0}%</span></td><td>{l.varianceExplanation ?? (canManage && (l.utilisationPct ?? 0) > 100 ? <Button small variant="soft" onClick={() => setVariance({ budgetId: b.id, code: l.code })}>Explain</Button> : '—')}</td></tr>)}
            </tbody></table></div>
          </SectionCard>
        ))}</div>
      )}</Loadable>}
      {tab === 'funding' && <Loadable state={funding}>{(rows) => !rows.length ? <EmptyState title="No funding proposals" sub="Compare loan offers, grants and CSR funding; approval never applies for or draws funds automatically." /> : (
        <div className="ops-stack">{rows.map((f) => (
          <SectionCard key={f.id} title={`${f.title}`} sub={`${f.refNo} · ${humanize(f.kind)} · ${money(f.amountRequestedPaise)}${f.restricted ? ' · restricted funds' : ''}`} actions={<><StatusPill status={f.status} />{canFund && f.status === 'DRAFT' && <Button small disabled={busy} onClick={() => void run(async () => { await opsApi.submitFunding(f.id); await funding.reload(); })}>Send for approval</Button>}</>}>
            {f.purpose && <p>{f.purpose}</p>}
            {f.offers.length > 0 && <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Provider</th><th className="num">Rate</th><th className="num">Months</th><th className="num">EMI</th><th className="num">Total cost</th></tr></thead><tbody>{[...f.offers].sort((a, b) => a.totalCostPaise - b.totalCostPaise).map((o, i) => <tr key={i}><td>{o.provider}{o.selected && <> <StatusPill status="APPROVED" label="Selected" /></>}</td><td className="num">{o.annualRateBp / 100}%</td><td className="num">{o.tenureMonths}</td><td className="num">{money(o.emiPaise)}</td><td className="num">{money(o.totalCostPaise)}</td></tr>)}</tbody></table></div>}
          </SectionCard>
        ))}</div>
      )}</Loadable>}
      <ErrorNote error={error} />
      {creating === 'budget' && (
        <Modal title="New budget" onClose={() => setCreating(null)} wide footer={<><Button variant="soft" onClick={() => setCreating(null)}>Cancel</Button><Button disabled={busy} onClick={() => void run(async () => { await opsApi.createBudget({ fiscalYear: bf.fiscalYear, name: bf.name, lines: bf.lines.filter((l) => l.code && l.head).map((l) => ({ code: l.code, head: l.head, kind: l.kind, plannedPaise: rupeesToPaise(l.planned || '0') })) }); setCreating(null); await budgets.reload(); })}>Create</Button></>}>
          <div className="ops-form-grid"><Field label="Financial year"><input className="input" value={bf.fiscalYear} onChange={(e) => setBf({ ...bf, fiscalYear: e.target.value })} /></Field><Field label="Name"><input className="input" value={bf.name} onChange={(e) => setBf({ ...bf, name: e.target.value })} /></Field></div>
          {bf.lines.map((l, i) => <div key={i} className="ops-inline" style={{ marginBottom: 6 }}><input className="input" value={l.code} onChange={(e) => setBf({ ...bf, lines: bf.lines.map((y, j) => (j === i ? { ...y, code: e.target.value.toUpperCase() } : y)) })} style={{ width: 90 }} aria-label="Code" /><input className="input" value={l.head} onChange={(e) => setBf({ ...bf, lines: bf.lines.map((y, j) => (j === i ? { ...y, head: e.target.value } : y)) })} style={{ flex: 1 }} aria-label="Head" /><select className="input" value={l.kind} onChange={(e) => setBf({ ...bf, lines: bf.lines.map((y, j) => (j === i ? { ...y, kind: e.target.value } : y)) })} aria-label="Kind"><option value="OPEX">Opex</option><option value="CAPEX">Capex</option></select><input className="input" inputMode="decimal" value={l.planned} onChange={(e) => setBf({ ...bf, lines: bf.lines.map((y, j) => (j === i ? { ...y, planned: e.target.value } : y)) })} placeholder="₹ planned" style={{ width: 130 }} aria-label="Planned" /></div>)}
          <Button small variant="ghost" onClick={() => setBf({ ...bf, lines: [...bf.lines, { code: '', head: '', kind: 'OPEX', planned: '' }] })}>+ Line</Button>
          <ErrorNote error={error} />
        </Modal>
      )}
      {creating === 'funding' && (
        <Modal title="Funding proposal" onClose={() => setCreating(null)} wide footer={<><Button variant="soft" onClick={() => setCreating(null)}>Cancel</Button><Button disabled={busy || !ff.title || !ff.amount} onClick={() => void run(async () => { await opsApi.createFunding({ kind: ff.kind, title: ff.title, purpose: ff.purpose, amountRequestedPaise: rupeesToPaise(ff.amount), offers: ff.offers.filter((o) => o.provider).map((o) => ({ provider: o.provider, principalPaise: rupeesToPaise(o.principal || ff.amount), annualRateBp: Math.round(Number(o.ratePct || 0) * 100), tenureMonths: Number(o.tenureMonths || 0), processingFeePaise: rupeesToPaise(o.fee || '0'), selected: o.selected })) }); setCreating(null); await funding.reload(); })}>Create</Button></>}>
          <div className="ops-form-grid"><Field label="Kind"><select className="input" value={ff.kind} onChange={(e) => setFf({ ...ff, kind: e.target.value })}>{['LOAN', 'GRANT', 'DONATION', 'CSR', 'GOVERNMENT_SCHEME', 'INTERNAL_RESERVE'].map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select></Field><Field label="Title"><input className="input" value={ff.title} onChange={(e) => setFf({ ...ff, title: e.target.value })} /></Field><Field label="Amount (₹)"><input className="input" inputMode="decimal" value={ff.amount} onChange={(e) => setFf({ ...ff, amount: e.target.value })} /></Field></div>
          <Field label="Purpose"><textarea className="input" rows={2} value={ff.purpose} onChange={(e) => setFf({ ...ff, purpose: e.target.value })} style={{ width: '100%' }} /></Field>
          {ff.kind === 'LOAN' && <>{ff.offers.map((o, i) => <div key={i} className="ops-inline" style={{ marginBottom: 6 }}><input className="input" value={o.provider} onChange={(e) => setFf({ ...ff, offers: ff.offers.map((y, j) => (j === i ? { ...y, provider: e.target.value } : y)) })} placeholder="Lender" aria-label="Lender" /><input className="input" inputMode="decimal" value={o.ratePct} onChange={(e) => setFf({ ...ff, offers: ff.offers.map((y, j) => (j === i ? { ...y, ratePct: e.target.value } : y)) })} placeholder="% p.a." style={{ width: 80 }} aria-label="Rate" /><input className="input" inputMode="numeric" value={o.tenureMonths} onChange={(e) => setFf({ ...ff, offers: ff.offers.map((y, j) => (j === i ? { ...y, tenureMonths: e.target.value } : y)) })} placeholder="months" style={{ width: 80 }} aria-label="Tenure" /><input className="input" inputMode="decimal" value={o.fee} onChange={(e) => setFf({ ...ff, offers: ff.offers.map((y, j) => (j === i ? { ...y, fee: e.target.value } : y)) })} placeholder="fee ₹" style={{ width: 90 }} aria-label="Processing fee" /><label className="ops-chip"><input type="radio" name="sel" checked={o.selected} onChange={() => setFf({ ...ff, offers: ff.offers.map((y, j) => ({ ...y, selected: j === i })) })} />select</label></div>)}<Button small variant="ghost" onClick={() => setFf({ ...ff, offers: [...ff.offers, { provider: '', principal: '', ratePct: '', tenureMonths: '', fee: '', selected: false }] })}>+ Offer</Button></>}
          <ErrorNote error={error} />
        </Modal>
      )}
      {variance && <PromptModal title={`Explain variance on ${variance.code}`} label="Explanation" onClose={() => setVariance(null)} onSubmit={(v) => opsApi.explainVariance(variance.budgetId, variance.code, v).then(() => budgets.reload())} />}
    </div>
  );
}
