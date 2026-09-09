'use client';
import { Button, Card, Pill, rupees } from '../ui';
import { api } from '@/lib/api';
import type { FeePlanDto, FeePlanInstallmentDto, InvoiceDto } from '@/lib/types';

const MODE_LABEL: Record<string, string> = {
  ONE_TIME: 'One-time payment',
  PARTIAL: 'Partial payment',
  INSTALLMENT: 'Installments',
};

/**
 * How each installment status reads to a family.
 *
 * "Approval pending" is deliberately the words for NOT_BILLED: from a
 * student's side an installment with no invoice behind it is one the school
 * has not raised yet, and saying "not billed" invites the reading that it has
 * been waived.
 */
const STATUS: Record<FeePlanInstallmentDto['status'], { label: string; tone: 'green' | 'amber' | 'red' | 'gray' | 'blue' }> = {
  PAID: { label: 'Paid', tone: 'green' },
  PARTIALLY_PAID: { label: 'Partially paid', tone: 'amber' },
  OVERDUE: { label: 'Overdue', tone: 'red' },
  DUE: { label: 'Due', tone: 'blue' },
  NOT_BILLED: { label: 'Approval pending', tone: 'gray' },
};

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * One published fee plan, as the student sees it: what the whole year costs,
 * how much of it is settled, and the schedule of what is left.
 *
 * Only published plans ever reach this component — the API does not serve a
 * family anything else — so there is no draft/approval state to render here.
 */
export function InstallmentPlanCard({
  plan, invoices, onPay, canPayOnline = true,
}: {
  plan: FeePlanDto;
  /** The year's invoices, so a due installment can be paid from this table. */
  invoices: InvoiceDto[];
  onPay: (invoice: InvoiceDto) => void;
  canPayOnline?: boolean;
}) {
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  const paidPct = plan.totalPaise > 0 ? Math.round((plan.paidPaise / plan.totalPaise) * 100) : 0;

  return (
    <Card pad={false} style={{ marginBottom: 16 }}>
      <div className="plan-head">
        <div>
          <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>{plan.name}</strong>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 3 }}>
            {MODE_LABEL[plan.mode] ?? plan.mode}
            {plan.mode !== 'ONE_TIME' && ` · ${plan.installments.length} installments`}
            {plan.academicYearName ? ` · ${plan.academicYearName}` : ''}
          </div>
        </div>
        <div className="plan-figures">
          <div>
            <span className="plan-figure-label">Total fee</span>
            <span className="plan-figure-value">{rupees(plan.totalPaise)}</span>
          </div>
          <div>
            <span className="plan-figure-label">Paid</span>
            <span className="plan-figure-value" style={{ color: 'var(--green)' }}>{rupees(plan.paidPaise)}</span>
          </div>
          <div>
            <span className="plan-figure-label">Remaining</span>
            <span className="plan-figure-value" style={{ color: plan.remainingPaise > 0 ? 'var(--amber)' : 'var(--text-2)' }}>
              {rupees(plan.remainingPaise)}
            </span>
          </div>
        </div>
      </div>

      <div className="plan-progress" role="img" aria-label={`${paidPct}% of this plan paid`}>
        <div className="plan-progress-fill" style={{ width: `${Math.min(100, paidPct)}%` }} />
      </div>

      <table className="data-table data-table-cards">
        <thead>
          <tr>
            <th>Installment</th>
            <th>Amount</th>
            <th>Due date</th>
            <th>Paid</th>
            <th>Remaining</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {plan.installments.map((inst) => {
            const invoice = inst.invoiceId ? invoiceById.get(inst.invoiceId) : null;
            const meta = STATUS[inst.status];
            return (
              <tr key={inst.seq}>
                <td className="cell-primary" data-label="Installment">
                  {inst.label ?? `Installment ${inst.seq}`}
                  {inst.invoiceNo && (
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>{inst.invoiceNo}</div>
                  )}
                </td>
                <td data-label="Amount">{rupees(inst.amountPaise)}</td>
                <td data-label="Due date">{fmtDate(inst.dueOn)}</td>
                <td data-label="Paid">{rupees(inst.paidPaise)}</td>
                <td data-label="Remaining">{rupees(inst.remainingPaise)}</td>
                <td data-label="Status"><Pill tone={meta.tone}>{meta.label}</Pill></td>
                <td data-label="Actions">
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {canPayOnline && invoice && inst.remainingPaise > 0 && invoice.status !== 'CANCELLED' && (
                      <Button small onClick={() => onPay(invoice)}>Pay {rupees(inst.remainingPaise)}</Button>
                    )}
                    {invoice && (
                      <Button small variant="ghost" onClick={() => api.downloadInvoicePdf(invoice.id)}>Invoice</Button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
