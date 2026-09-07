'use client';
import { useCallback, useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, Pill, Select, SkeletonRows, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import type { InvoiceDto, PaymentOverviewDto } from '@/lib/types';
import { FeeDashboardCards } from '@/components/fees/fee-dashboard-cards';
import { FeeBreakdownChart } from '@/components/fees/fee-breakdown-chart';
import { PaymentHistoryChart } from '@/components/fees/payment-history-chart';
import { InvoiceList } from '@/components/fees/invoice-list';
import { InstallmentPlanCard } from '@/components/fees/installment-plan-card';
import { PayInvoiceModal } from '@/components/fees/pay-invoice-modal';
import { InvoiceTimelineModal } from '@/components/fees/invoice-timeline-modal';
import { PaymentHistoryTable } from '@/components/fees/payment-history-table';

type Tab = 'overview' | 'plans' | 'pending' | 'paid' | 'history';

/**
 * The student's fee page, for one academic year at a time.
 *
 * Everything on the page comes from a single `/fees/overview?academicYearId=`
 * call. That is what makes the year switch trustworthy: the summary, the
 * plans, the invoices and the receipts are selected together by the server for
 * one year, so no combination of loading states can leave last year's invoices
 * beside this year's total.
 *
 * The years offered come from the student's own records, so the dropdown never
 * lists a year they were not enrolled in.
 */
export default function StudentPayments() {
  const [data, setData] = useState<PaymentOverviewDto | null>(null);
  const [year, setYear] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [paying, setPaying] = useState<InvoiceDto | null>(null);
  const [timelineInvoiceId, setTimelineInvoiceId] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback((academicYearId?: string) => {
    setLoading(true);
    setFailed(false);
    api.paymentOverview(academicYearId)
      .then((res) => {
        setData(res);
        // The server decides which year is shown when none was asked for, so
        // the picker follows its answer rather than guessing alongside it.
        if (res.academicYearId) setYear(res.academicYearId);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const years = data?.years ?? [];
  const invoices = data?.invoices ?? [];
  const payments = data?.payments ?? [];
  const plans = data?.plans ?? [];
  const summary = data?.summary ?? null;
  const canPayOnline = summary?.onlinePaymentEnabled !== false;

  const pendingInvoices = invoices.filter((i) => i.status !== 'PAID' && i.status !== 'CANCELLED');
  const paidInvoices = invoices.filter((i) => i.status === 'PAID');
  const selectedYear = years.find((y) => y.id === year);
  const hasRecords = invoices.length > 0 || payments.length > 0 || plans.length > 0;

  const payProps = {
    onPay: setPaying,
    onViewTimeline: (inv: InvoiceDto) => setTimelineInvoiceId(inv.id),
    canPayOnline,
    downloadLabel: 'Download Invoice',
  };

  return (
    <PortalShell
      expectedSlug="student"
      topbar={{ title: 'Payments', desc: 'Your fee invoices, installments, payment history and receipts.' }}
    >
      {/* The year selector sits above everything it governs, and repeats the
          chosen year as a chip so it stays readable once the page is scrolled
          on a phone. */}
      <Card style={{ marginBottom: 16 }}>
        <div className="year-bar">
          <div className="year-bar-field">
            <Select
              label="Academic Year"
              value={year}
              onChange={(next) => { setYear(next); load(next); }}
              disabled={loading || years.length === 0}
              options={years.map((y) => ({
                value: y.id,
                label: `${y.name}${y.isCurrent ? ' (current)' : ''}`,
              }))}
            />
          </div>
          <div className="year-bar-meta">
            {selectedYear && (
              <Pill tone={selectedYear.isCurrent ? 'green' : 'gray'}>
                Showing {selectedYear.name}
              </Pill>
            )}
            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
              {loading
                ? 'Loading…'
                : `${invoices.length} invoice(s) · ${payments.length} payment(s) in this year`}
            </span>
          </div>
        </div>
      </Card>

      {failed && (
        <EmptyState
          title="Could not load your payments"
          sub="Please refresh the page, or contact the school office if this keeps happening."
        />
      )}

      {!failed && !loading && years.length === 0 && (
        <EmptyState
          title="No fee records yet"
          sub="Once the school raises your first invoice it will appear here, year by year."
        />
      )}

      {!failed && years.length > 0 && (
        <>
          <FeeDashboardCards summary={summary} />

          <div className="tabs" style={{ marginBottom: 16 }}>
            {([
              ['overview', 'Overview'],
              ['plans', `Installments${plans.length ? ` (${plans.length})` : ''}`],
              ['pending', 'Pending Invoices'],
              ['paid', 'Paid Invoices'],
              ['history', 'Payment History'],
            ] as [Tab, string][]).map(([key, label]) => (
              <button key={key} className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
                {label}
              </button>
            ))}
          </div>

          {loading && <Card><SkeletonRows rows={5} /></Card>}

          {!loading && !hasRecords && (
            <EmptyState
              title={`No fee records for ${selectedYear?.name ?? 'this year'}`}
              sub="Nothing was billed or paid in this academic year. Pick another year from the dropdown above."
            />
          )}

          {!loading && hasRecords && tab === 'overview' && (
            <>
              <div className="fee-chart-grid">
                <Card>
                  <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Fee Breakdown</strong>
                  <div style={{ marginTop: 14 }}>
                    <FeeBreakdownChart
                      paidPaise={summary?.totalCollectedPaise ?? 0}
                      pendingPaise={summary?.pendingPaise ?? 0}
                      overduePaise={summary?.overduePaise ?? 0}
                    />
                  </div>
                </Card>
                <Card>
                  <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Payment Trend</strong>
                  <div style={{ marginTop: 10 }}>
                    <PaymentHistoryChart payments={payments} />
                  </div>
                </Card>
              </div>

              {plans.map((plan) => (
                <InstallmentPlanCard
                  key={plan.id}
                  plan={plan}
                  invoices={invoices}
                  onPay={setPaying}
                  canPayOnline={canPayOnline}
                />
              ))}

              <Card pad={false}>
                <div style={{ padding: '16px 20px 0' }}>
                  <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>
                    Fee History — {selectedYear?.name ?? ''}
                  </strong>
                </div>
                <InvoiceList invoices={invoices} {...payProps} />
              </Card>
            </>
          )}

          {!loading && hasRecords && tab === 'plans' && (
            plans.length === 0
              ? (
                <EmptyState
                  title="No installment plan for this year"
                  sub="Your fees are billed as individual invoices. If you have agreed an installment schedule with the school, it appears here once approved."
                />
              )
              : plans.map((plan) => (
                <InstallmentPlanCard
                  key={plan.id}
                  plan={plan}
                  invoices={invoices}
                  onPay={setPaying}
                  canPayOnline={canPayOnline}
                />
              ))
          )}

          {!loading && hasRecords && tab === 'pending' && (
            <Card pad={false}><InvoiceList invoices={pendingInvoices} {...payProps} /></Card>
          )}

          {!loading && hasRecords && tab === 'paid' && (
            <Card pad={false}><InvoiceList invoices={paidInvoices} {...payProps} /></Card>
          )}

          {!loading && hasRecords && tab === 'history' && (
            <Card pad={false}><PaymentHistoryTable payments={payments} /></Card>
          )}
        </>
      )}

      {paying && (
        <PayInvoiceModal
          invoice={paying}
          onClose={() => setPaying(null)}
          onPaid={(receiptNo, sandbox) => {
            setPaying(null);
            toast(`Payment successful — receipt ${receiptNo}${sandbox ? ' (sandbox)' : ''}.`);
            load(year);
          }}
        />
      )}

      {timelineInvoiceId && (
        <InvoiceTimelineModal invoiceId={timelineInvoiceId} onClose={() => setTimelineInvoiceId(null)} />
      )}
    </PortalShell>
  );
}
