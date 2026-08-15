'use client';
import { useEffect, useState, useCallback } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, Pill, SkeletonRows, StatCard, rupees } from '@/components/ui';
import { Pagination } from '@/components/pagination';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePermissions } from '@/lib/permissions';
import type { FeeSummary, InvoiceDto, PaymentReceiptDto } from '@/lib/types';

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'gray' | 'blue'> = {
  PAID: 'green', PARTIAL: 'amber', PENDING: 'gray', OVERDUE: 'red', CANCELLED: 'gray',
};

export default function FinancePayments() {
  const [summary, setSummary] = useState<FeeSummary | null>(null);
  const [invoices, setInvoices] = useState<InvoiceDto[] | null>(null);
  const [receipts, setReceipts] = useState<PaymentReceiptDto[] | null>(null);
  const [paying, setPaying] = useState<InvoiceDto | null>(null);
  const [activeTab, setActiveTab] = useState<'invoices' | 'receipts'>('invoices');

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

  const reload = useCallback(() => {
    api.feeSummary().then(setSummary).catch(() => {});
    loadReceipts();
  }, [loadReceipts]);

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

  useEffect(() => { setInvoicePage(1); }, [statusFilter, invoicePageSize]);

  const { me } = useAuth();
  const { hasAccess } = usePermissions();
  const canRecord = hasAccess(me?.profile?.role, 'record_payment');

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
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.map((r) => (
                    <tr key={r.id}>
                      <td className="cell-primary" style={{ fontWeight: 600 }} data-label="Receipt No.">{r.receiptNo}</td>
                      <td data-label="Invoice No.">{r.invoiceNo}</td>
                      <td data-label="Student Name">{r.studentName}</td>
                      <td data-label="Class">{r.class}</td>
                      <td data-label="Amount Paid">{rupees(r.amountPaise)}</td>
                      <td data-label="Mode"><Pill tone="blue">{r.mode}</Pill></td>
                      <td data-label="Status"><Pill tone={r.status === 'SUCCESS' ? 'green' : 'gray'}>{r.status}</Pill></td>
                      <td style={{ color: 'var(--text-faint)' }} data-label="Date">{new Date(r.createdAt).toLocaleDateString('en-IN')}</td>
                    </tr>
                  ))}
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

      {paying && <RecordModal invoice={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); reload(); }} />}
    </PortalShell>
  );
}

function RecordModal({ invoice, onClose, onDone }: { invoice: InvoiceDto; onClose: () => void; onDone: () => void }) {
  const remaining = invoice.totalPaise - invoice.paidPaise;
  const [amount, setAmount] = useState(String(remaining / 100));
  const [mode, setMode] = useState('CASH');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  
  const [receipt, setReceipt] = useState<{ receiptNo: string; status: string; paidPaise: number } | null>(null);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await api.recordPayment({ invoiceId: invoice.id, amountPaise: Math.round(parseFloat(amount) * 100), mode });
      setReceipt(res);
    } catch (e: any) {
      setErr(e?.code === 'OVERPAYMENT' ? 'Amount exceeds the balance due.' : 'Could not record payment.');
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={receipt ? onDone : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
        {receipt ? (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: 'var(--text-1)' }}>Payment Successful</h3>
            <p style={{ fontSize: 13, color: 'var(--text-faint)', marginBottom: 20 }}>The payment has been recorded successfully.</p>
            
            <div style={{ background: 'var(--card-bg-header)', border: '1px solid var(--hairline)', borderRadius: 8, padding: 16, textAlign: 'left', marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>Receipt No:</span>
                <span style={{ fontWeight: 600, fontSize: 13, fontFamily: 'monospace' }}>{receipt.receiptNo}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>Invoice No:</span>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{invoice.invoiceNo}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>Student Name:</span>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{invoice.studentName}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>Class:</span>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{invoice.class || '—'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>Amount Paid:</span>
                <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--green)' }}>{rupees(Math.round(parseFloat(amount) * 100))}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>Mode:</span>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{mode}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>Invoice Status:</span>
                <span style={{ fontWeight: 600, fontSize: 13 }}><Pill tone={STATUS_TONE[receipt.status] ?? 'gray'}>{receipt.status}</Pill></span>
              </div>
            </div>

            <Button onClick={onDone} className="btn-block">Close & Reload</Button>
          </div>
        ) : (
          <>
            <div className="modal-header">
              <div className="modal-title">Record payment</div>
              <button className="modal-close" aria-label="Close dialog" title="Close" onClick={onClose}>×</button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 12 }}>
              {invoice.invoiceNo} · {invoice.studentName} · balance {rupees(remaining)}
            </p>
            <div className="field-label">Amount (₹)</div>
            <input className="field-input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <div className="field-label">Mode</div>
            <select className="field-input" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="CASH">Cash</option><option value="CHEQUE">Cheque</option><option value="BANK">Bank transfer</option>
            </select>
            {err && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 10 }}>{err}</p>}
            <Button onClick={submit} disabled={busy} className="btn-block">{busy ? 'Recording…' : 'Record payment'}</Button>
          </>
        )}
      </div>
    </div>
  );
}
