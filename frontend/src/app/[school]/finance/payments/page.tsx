'use client';
import { useEffect, useState, useCallback } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, Pill, SkeletonRows, StatCard, rupees, useToast } from '@/components/ui';
import { Pagination } from '@/components/pagination';
import { api, fileHref } from '@/lib/api';
import { RecordPaymentModal, PaymentRecordedNotice } from '@/components/fees/record-payment-modal';
import { PaymentChangeRequestModal } from '@/components/fees/change-request-modal';
import { FeePlanModal } from '@/components/fees/fee-plan-modal';
import { useAuth } from '@/lib/auth';
import { usePermissions } from '@/lib/permissions';
import type { FeePlanDto, FeeSummary, InvoiceDto, PaymentReceiptDto } from '@/lib/types';

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'gray' | 'blue'> = {
  PAID: 'green', PARTIAL: 'amber', PENDING: 'gray', OVERDUE: 'red', CANCELLED: 'gray',
};

export default function FinancePayments() {
  const [summary, setSummary] = useState<FeeSummary | null>(null);
  const [invoices, setInvoices] = useState<InvoiceDto[] | null>(null);
  const [receipts, setReceipts] = useState<PaymentReceiptDto[] | null>(null);
  const [paying, setPaying] = useState<InvoiceDto | null>(null);
  const [recorded, setRecorded] = useState<{ receiptNo: string; awaitingApproval: boolean } | null>(null);
  const [changing, setChanging] = useState<PaymentReceiptDto | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [plans, setPlans] = useState<FeePlanDto[] | null>(null);
  const [planBusy, setPlanBusy] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'invoices' | 'receipts' | 'plans'>('invoices');
  const toast = useToast();

  // Invoices are school-wide (hundreds of rows), so the table is paged in the
  // browser over the list already fetched for the summary figures. Receipts
  // are paged server-side, which also lifts the old 200-row response cap.
  const [invoicePage, setInvoicePage] = useState(1);
  const [invoicePageSize, setInvoicePageSize] = useState(25);
  const [statusFilter, setStatusFilter] = useState('');
  const [invoiceTotal, setInvoiceTotal] = useState(0);
  const [invoiceTotalPages, setInvoiceTotalPages] = useState(1);
  const [receiptPage, setReceiptPage] = useState(1);
  const [receiptPageSize, setReceiptPageSize] = useState(25);
  const [receiptTotal, setReceiptTotal] = useState(0);
  const [receiptTotalPages, setReceiptTotalPages] = useState(1);
  const [receiptsBusy, setReceiptsBusy] = useState(false);

  const loadReceipts = useCallback(() => {
    setReceiptsBusy(true);
    api.listPaymentsPage({ page: receiptPage, pageSize: receiptPageSize })
      .then((r) => {
        setReceipts(r.items);
        setReceiptTotal(r.total);
        setReceiptTotalPages(r.totalPages);
        if (r.page !== receiptPage) setReceiptPage(r.page);
      })
      .catch(() => { setReceipts([]); setReceiptTotal(0); setReceiptTotalPages(1); })
      .finally(() => setReceiptsBusy(false));
  }, [receiptPage, receiptPageSize]);

  const loadPlans = useCallback(() => {
    api.feePlans().then(setPlans).catch(() => setPlans([]));
  }, []);

  const reload = useCallback(() => {
    api.feeSummary().then(setSummary).catch(() => {});
    loadReceipts();
    loadPlans();
  }, [loadReceipts, loadPlans]);

  useEffect(() => { api.feeSummary().then(setSummary).catch(() => {}); }, []);

  // Server-side paging for the invoice tab.
  useEffect(() => {
    api.invoicesPage({ status: statusFilter || undefined, page: invoicePage, pageSize: invoicePageSize })
      .then((r) => {
        setInvoices(r.items);
        setInvoiceTotal(r.total);
        setInvoiceTotalPages(r.totalPages);
        if (r.page !== invoicePage) setInvoicePage(r.page);
      })
      .catch(() => { setInvoices([]); setInvoiceTotal(0); setInvoiceTotalPages(1); });
  }, [statusFilter, invoicePage, invoicePageSize]);

  useEffect(() => { loadReceipts(); }, [loadReceipts]);
  useEffect(() => { loadPlans(); }, [loadPlans]);

  useEffect(() => { setInvoicePage(1); }, [statusFilter, invoicePageSize]);

  const { me } = useAuth();
  const { hasAccess } = usePermissions();
  // Matches the guard on POST /fees/payments. Whether a payment recorded here
  // publishes or queues for approval is the server's call, not this flag's —
  // Finance holds fees.pay but not fees.payments.approve, so its payments wait.
  const canRecord = hasAccess(me?.profile?.role, 'fees.pay');
  const canPlan = hasAccess(me?.profile?.role, 'fees.plan.request');
  const canReviewPlans = hasAccess(me?.profile?.role, 'fees.plan.review');

  const advancePlan = async (id: string, step: string, done: string) => {
    setPlanBusy(id);
    try {
      await api.transitionFeePlan(id, step);
      toast(done);
      loadPlans();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That step could not be completed.');
    } finally {
      setPlanBusy(null);
    }
  };

  // Status filtering and paging are done by the server.
  const filteredInvoices = invoices ?? [];
  const safeInvoicePage = invoicePage;
  const pagedInvoices = filteredInvoices;

  return (
    <PortalShell expectedSlug="finance" topbar={{ title: 'Payments & Fees', desc: 'Manage fee items, view payment records, and issue receipts.' }}>
      <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 18 }}>
        <StatCard label="Total Collected" value={summary ? rupees(summary.totalCollectedPaise) : '—'} delta={summary ? `${summary.collectionPct}% of billed` : undefined} deltaDir="up" />
        <StatCard label="Pending" value={summary ? rupees(summary.pendingPaise) : '—'} deltaDir="down" />
        <StatCard label="Pending Invoices" value={summary ? summary.pendingCount : '—'} />
        <StatCard label="Total Billed" value={summary ? rupees(summary.totalBilledPaise) : '—'} />
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        <button className={`chip-tab ${activeTab === 'invoices' ? 'active' : ''}`} onClick={() => setActiveTab('invoices')}>Invoices</button>
        <button className={`chip-tab ${activeTab === 'receipts' ? 'active' : ''}`} onClick={() => setActiveTab('receipts')}>Payment Receipts</button>
        <button className={`chip-tab ${activeTab === 'plans' ? 'active' : ''}`} onClick={() => setActiveTab('plans')}>
          Installment Plans{plans?.length ? ` (${plans.length})` : ''}
        </button>
      </div>

      {activeTab === 'invoices' && (
        <>
          {invoices && invoices.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              {['', 'PENDING', 'OVERDUE', 'PARTIAL', 'PAID'].map((s) => (
                <button
                  key={s} onClick={() => setStatusFilter(s)} className="chip-tab"
                  aria-pressed={statusFilter === s}
                  style={{
                    background: statusFilter === s ? 'var(--accent)' : '#fff',
                    color: statusFilter === s ? 'var(--on-accent)' : 'var(--text-2)',
                    borderColor: statusFilter === s ? 'var(--accent)' : 'var(--input-border)',
                  }}
                >
                  {s ? s.charAt(0) + s.slice(1).toLowerCase() : 'All'}
                </button>
              ))}
            </div>
          )}
          {invoices === null && <Card><SkeletonRows rows={5} /></Card>}
          {invoices?.length === 0 && <EmptyState title="No invoices yet" sub="Fee invoices appear here once fee structures are assigned." />}
          {invoices && invoices.length > 0 && filteredInvoices.length === 0 && (
            <EmptyState title="No matching invoices" sub="No invoices have this status." />
          )}
          {filteredInvoices.length > 0 && (
            <Card pad={false}>
              <table className="data-table data-table-cards">
                <thead><tr><th>Invoice</th><th>Student</th><th>Class</th><th>Total</th><th>Paid</th><th>Due On</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {pagedInvoices.map((i) => (
                    <tr key={i.id}>
                      <td className="cell-primary" data-label="Invoice">{i.invoiceNo}</td>
                      <td data-label="Student">{i.studentName}</td>
                      <td data-label="Class">{i.class}</td>
                      <td data-label="Total">{rupees(i.totalPaise)}</td>
                      <td data-label="Paid">{rupees(i.paidPaise)}</td>
                      <td data-label="Due On">{i.dueOn}</td>
                      <td data-label="Status"><Pill tone={STATUS_TONE[i.status] ?? 'gray'}>{i.status.toLowerCase()}</Pill></td>
                      <td data-label="Actions">{i.status !== 'PAID' && i.status !== 'CANCELLED' && canRecord && <Button small variant="soft" onClick={() => setPaying(i)}>Record</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination
                page={safeInvoicePage}
                pageSize={invoicePageSize}
                total={invoiceTotal}
                totalPages={invoiceTotalPages}
                label="invoices"
                onPageChange={setInvoicePage}
                onPageSizeChange={(s) => { setInvoicePageSize(s); setInvoicePage(1); }}
              />
            </Card>
          )}
        </>
      )}

      {activeTab === 'receipts' && (
        <>
          {receipts === null && <Card><SkeletonRows rows={5} /></Card>}
          {receipts?.length === 0 && <EmptyState title="No payment receipts" sub="No payments have been recorded yet." />}
          {receipts && receipts.length > 0 && (
            <Card pad={false}>
              <table className="data-table data-table-cards">
                <thead>
                  <tr>
                    <th>Receipt No.</th>
                    <th>Invoice No.</th>
                    <th>Student Name</th>
                    <th>Class</th>
                    <th>Amount Paid</th>
                    <th>Mode</th>
                    <th>Approval</th>
                    <th>Date</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.map((r) => {
                    const published = (r.recordStatus ?? 'PUBLISHED') === 'PUBLISHED';
                    return (
                      <tr key={r.id}>
                        <td className="cell-primary" style={{ fontWeight: 600 }} data-label="Receipt No.">{r.receiptNo}</td>
                        <td data-label="Invoice No.">{r.invoiceNo}</td>
                        <td data-label="Student Name">{r.studentName}</td>
                        <td data-label="Class">{r.class}</td>
                        <td data-label="Amount Paid">{rupees(r.amountPaise)}</td>
                        <td data-label="Mode">
                          <Pill tone="blue">{r.mode}</Pill>
                          {r.instrument?.proofUrl && (
                            <a
                              href={fileHref(r.instrument.proofUrl)}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ display: 'block', fontSize: 11, marginTop: 3, color: 'var(--accent)', fontWeight: 600 }}
                            >
                              proof
                            </a>
                          )}
                        </td>
                        {/* The record's approval state, which is a different
                            question from whether the transaction succeeded. */}
                        <td data-label="Approval">
                          <Pill tone={published ? 'green' : r.recordStatus === 'REJECTED' ? 'red' : 'amber'}>
                            {published ? 'published' : (r.recordStatus ?? '').toLowerCase().replace(/_/g, ' ')}
                          </Pill>
                        </td>
                        <td style={{ color: 'var(--text-faint)' }} data-label="Date">
                          {new Date(r.paidOn ?? r.createdAt).toLocaleDateString('en-IN')}
                        </td>
                        <td data-label="Actions">
                          {/* A published payment can no longer be edited here,
                              only asked about. That is the rule, not a hint. */}
                          {published && (
                            <Button small variant="ghost" onClick={() => setChanging(r)}>Request change</Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Pagination
                page={receiptPage}
                pageSize={receiptPageSize}
                total={receiptTotal}
                totalPages={receiptTotalPages}
                busy={receiptsBusy}
                label="receipts"
                onPageChange={setReceiptPage}
                onPageSizeChange={(s) => { setReceiptPageSize(s); setReceiptPage(1); }}
              />
            </Card>
          )}
        </>
      )}

      {activeTab === 'plans' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: 0, maxWidth: 620 }}>
              A plan sets a student&rsquo;s total fee and how it may be paid. It goes to finance review and then to an
              administrator &mdash; no invoice exists until the plan is approved and published.
            </p>
            {canPlan && <Button small onClick={() => setPlanOpen(true)}>New plan</Button>}
          </div>

          {plans === null && <Card><SkeletonRows rows={4} /></Card>}
          {plans?.length === 0 && (
            <EmptyState title="No fee plans yet" sub="Create one to offer a student a one-time, partial or installment schedule." />
          )}
          {plans && plans.length > 0 && (
            <Card pad={false}>
              <table className="data-table data-table-cards">
                <thead>
                  <tr><th>Plan</th><th>Year</th><th>Mode</th><th>Total</th><th>Paid</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {plans.map((p) => (
                    <tr key={p.id}>
                      <td className="cell-primary" data-label="Plan">
                        {p.name}
                        <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                          {p.installments.length} installment(s) · first due {new Date(p.firstPaymentOn ?? p.createdAt).toLocaleDateString('en-IN')}
                        </div>
                      </td>
                      <td data-label="Year">{p.academicYearName ?? '—'}</td>
                      <td data-label="Mode">{p.mode.toLowerCase().replace(/_/g, ' ')}</td>
                      <td data-label="Total">{rupees(p.totalPaise)}</td>
                      <td data-label="Paid">{rupees(p.paidPaise)}</td>
                      <td data-label="Status">
                        <Pill tone={p.status === 'PUBLISHED' ? 'green' : p.status === 'REJECTED' ? 'red' : 'amber'}>
                          {p.status.toLowerCase().replace(/_/g, ' ')}
                        </Pill>
                      </td>
                      <td data-label="Actions">
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {canPlan && (p.status === 'DRAFT' || p.status === 'REJECTED') && (
                            <Button small disabled={planBusy === p.id} onClick={() => advancePlan(p.id, 'submit', 'Submitted for finance review.')}>
                              Submit for review
                            </Button>
                          )}
                          {canReviewPlans && p.status === 'PENDING_FINANCE_REVIEW' && (
                            <Button small disabled={planBusy === p.id} onClick={() => advancePlan(p.id, 'review', 'Marked as reviewed.')}>
                              Mark reviewed
                            </Button>
                          )}
                          {canReviewPlans && p.status === 'FINANCE_REVIEWED' && (
                            <Button small disabled={planBusy === p.id} onClick={() => advancePlan(p.id, 'requestApproval', 'Sent for admin approval.')}>
                              Request admin approval
                            </Button>
                          )}
                          {p.status === 'PENDING_ADMIN_APPROVAL' && (
                            <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Waiting on an administrator</span>
                          )}
                          {p.status === 'PUBLISHED' && (
                            <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Live for the student</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}

      {paying && (
        <RecordPaymentModal
          invoice={paying}
          onClose={() => setPaying(null)}
          onDone={(res) => { setPaying(null); setRecorded(res); reload(); }}
        />
      )}
      {recorded && (
        <PaymentRecordedNotice
          receiptNo={recorded.receiptNo}
          awaitingApproval={recorded.awaitingApproval}
          onClose={() => setRecorded(null)}
        />
      )}
      {changing && (
        <PaymentChangeRequestModal
          payment={changing}
          onClose={() => setChanging(null)}
          onDone={() => { setChanging(null); toast('Change request submitted for admin approval.'); reload(); }}
        />
      )}
      {planOpen && (
        <FeePlanModal onClose={() => setPlanOpen(false)} onDone={(msg) => { setPlanOpen(false); toast(msg); loadPlans(); }} />
      )}
    </PortalShell>
  );
}
