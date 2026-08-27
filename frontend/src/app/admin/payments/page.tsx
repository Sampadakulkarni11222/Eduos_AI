'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, Pill, SkeletonRows, StatCard, rupees, useToast } from '@/components/ui';
import { BulkUploadModal } from '@/components/bulk-upload-modal';
import { Pagination } from '@/components/pagination';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePermissions } from '@/lib/permissions';
import type { FeeSummary, InvoiceDto, PaymentReceiptDto, StudentListItem, GradeDto, SectionDto } from '@/lib/types';
import { FeeStructuresPanel } from '@/components/fees/fee-structures-panel';

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'gray' | 'blue'> = {
  PAID: 'green', PARTIAL: 'amber', PENDING: 'gray', OVERDUE: 'red', CANCELLED: 'gray',
};

const INVOICE_STATUSES = ['PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED'];
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export default function AdminPayments() {
  const [summary, setSummary] = useState<FeeSummary | null>(null);
  const [invoices, setInvoices] = useState<InvoiceDto[] | null>(null);
  const [students, setStudents] = useState<StudentListItem[]>([]);
  const [paying, setPaying] = useState<InvoiceDto | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showBulkCreate, setShowBulkCreate] = useState(false);
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<'invoices' | 'receipts' | 'plans'>('invoices');

  // Grade / Section / Student filter for the Invoices tab. All optional now —
  // invoices are visible straight away and these only narrow the list.
  const [grades, setGrades] = useState<GradeDto[]>([]);
  const [filterGradeId, setFilterGradeId] = useState('');
  const [sections, setSections] = useState<SectionDto[]>([]);
  const [filterSectionId, setFilterSectionId] = useState('');
  const [filterStudentId, setFilterStudentId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [invoicePage, setInvoicePage] = useState(1);
  const [invoicePageSize, setInvoicePageSize] = useState(25);

  // Receipts tab — paginated, searched and date-filtered on the server.
  const [receipts, setReceipts] = useState<PaymentReceiptDto[] | null>(null);
  const [receiptSearch, setReceiptSearch] = useState('');
  const [appliedReceiptSearch, setAppliedReceiptSearch] = useState('');
  const [receiptFrom, setReceiptFrom] = useState('');
  const [receiptTo, setReceiptTo] = useState('');
  const [receiptPage, setReceiptPage] = useState(1);
  const [receiptPageSize, setReceiptPageSize] = useState(25);
  const [receiptTotal, setReceiptTotal] = useState(0);
  const [receiptTotalPages, setReceiptTotalPages] = useState(1);
  const [receiptsBusy, setReceiptsBusy] = useState(false);
  const receiptSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadReceipts = useCallback(() => {
    setReceiptsBusy(true);
    api.listPaymentsPage({
      search: appliedReceiptSearch || undefined,
      from: receiptFrom || undefined,
      to: receiptTo || undefined,
      page: receiptPage,
      pageSize: receiptPageSize,
    })
      .then((r) => {
        setReceipts(r.items);
        setReceiptTotal(r.total);
        setReceiptTotalPages(r.totalPages);
        if (r.page !== receiptPage) setReceiptPage(r.page);
      })
      .catch(() => { setReceipts([]); setReceiptTotal(0); setReceiptTotalPages(1); })
      .finally(() => setReceiptsBusy(false));
  }, [appliedReceiptSearch, receiptFrom, receiptTo, receiptPage, receiptPageSize]);

  const reload = useCallback(() => {
    api.feeSummary().then(setSummary).catch(() => {});
    api.invoices().then(setInvoices).catch(() => setInvoices([]));
    loadReceipts();
  }, [loadReceipts]);

  useEffect(() => {
    api.feeSummary().then(setSummary).catch(() => {});
    api.invoices().then(setInvoices).catch(() => setInvoices([]));
    // Load ALL students (admitted + enrolled) so invoice creation covers everyone
    api.students().then((r) => setStudents(r.items)).catch(() => setStudents([]));
    api.listGrades().then(setGrades).catch(() => setGrades([]));
  }, []);

  useEffect(() => { loadReceipts(); }, [loadReceipts]);

  // Sections reload whenever the selected grade changes.
  useEffect(() => {
    if (!filterGradeId) { setSections([]); setFilterSectionId(''); return; }
    api.allSections(filterGradeId).then(setSections).catch(() => setSections([]));
    setFilterSectionId('');
  }, [filterGradeId]);

  useEffect(() => { setFilterStudentId(''); }, [filterSectionId]);

  // Any change to the invoice filters restarts paging from the first page.
  useEffect(() => {
    setInvoicePage(1);
  }, [filterGradeId, filterSectionId, filterStudentId, filterStatus, invoiceSearch, invoicePageSize]);

  const onReceiptSearch = (q: string) => {
    setReceiptSearch(q);
    if (receiptSearchTimer.current) clearTimeout(receiptSearchTimer.current);
    receiptSearchTimer.current = setTimeout(() => {
      setReceiptPage(1);
      setAppliedReceiptSearch(q.trim());
    }, 300);
  };

  useEffect(() => () => { if (receiptSearchTimer.current) clearTimeout(receiptSearchTimer.current); }, []);

  const studentsInSection = filterSectionId
    ? students.filter((s) => s.enrollment?.sectionId === filterSectionId)
    : students;

  const sectionIdsInGrade = sections.map((s) => s.id);
  const search = invoiceSearch.trim().toLowerCase();

  // Every filter is optional; the full invoice list is the starting point.
  const filteredInvoices = (invoices ?? []).filter((i) => {
    if (filterStudentId && i.studentId !== filterStudentId) return false;
    if (filterSectionId && i.sectionId !== filterSectionId) return false;
    if (!filterSectionId && filterGradeId && !(i.sectionId && sectionIdsInGrade.includes(i.sectionId))) return false;
    if (filterStatus && i.status !== filterStatus) return false;
    if (search
      && !i.invoiceNo.toLowerCase().includes(search)
      && !(i.studentName ?? '').toLowerCase().includes(search)) return false;
    return true;
  });

  const invoiceTotalPages = Math.max(Math.ceil(filteredInvoices.length / invoicePageSize), 1);
  const safeInvoicePage = Math.min(invoicePage, invoiceTotalPages);
  const pagedInvoices = filteredInvoices.slice(
    (safeInvoicePage - 1) * invoicePageSize,
    safeInvoicePage * invoicePageSize,
  );
  const hasInvoiceFilters = !!(filterGradeId || filterSectionId || filterStudentId || filterStatus || search);

  const clearInvoiceFilters = () => {
    setFilterGradeId('');
    setFilterSectionId('');
    setFilterStudentId('');
    setFilterStatus('');
    setInvoiceSearch('');
  };

  const { me } = useAuth();
  const { hasAccess } = usePermissions();
  const canCreate = hasAccess(me?.profile?.role, 'create_invoice');
  const canRecord = hasAccess(me?.profile?.role, 'record_payment');

  return (
    <PortalShell expectedSlug="admin" topbar={{
      title: 'Payments & Fees',
      desc: 'Manage fee items, view payment records, and issue receipts.',
      actions: canCreate ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="soft" onClick={() => setShowBulkCreate(true)}>Bulk Upload</Button>
          <Button onClick={() => setShowCreate(true)}>+ Create Invoice</Button>
        </div>
      ) : undefined,
    }}>
      <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 18 }}>
        <StatCard label="Total Collected" value={summary ? rupees(summary.totalCollectedPaise) : '—'} delta={summary ? `${summary.collectionPct}% of billed` : undefined} deltaDir="up" />
        <StatCard label="Pending" value={summary ? rupees(summary.pendingPaise) : '—'} deltaDir="down" />
        <StatCard label="Pending Invoices" value={summary ? summary.pendingCount : '—'} />
        <StatCard label="Total Billed" value={summary ? rupees(summary.totalBilledPaise) : '—'} />
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        <button className={`chip-tab ${activeTab === 'invoices' ? 'active' : ''}`} onClick={() => setActiveTab('invoices')}>Invoices</button>
        <button className={`chip-tab ${activeTab === 'receipts' ? 'active' : ''}`} onClick={() => setActiveTab('receipts')}>Payment Receipts</button>
        <button className={`chip-tab ${activeTab === 'plans' ? 'active' : ''}`} onClick={() => setActiveTab('plans')}>Fee Plans</button>
      </div>

      {activeTab === 'invoices' && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16, alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 200px', maxWidth: 260 }}>
              <div className="field-label">Search</div>
              <input
                className="field-input"
                style={{ marginBottom: 0 }}
                type="search"
                placeholder="Invoice no or student…"
                value={invoiceSearch}
                onChange={(e) => setInvoiceSearch(e.target.value)}
                aria-label="Search invoices"
              />
            </div>
            <div style={{ flex: '1 1 160px', maxWidth: 200 }}>
              <div className="field-label">Grade</div>
              <select className="field-input" style={{ marginBottom: 0 }} value={filterGradeId} onChange={(e) => setFilterGradeId(e.target.value)}>
                <option value="">All grades</option>
                {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div style={{ flex: '1 1 160px', maxWidth: 200 }}>
              <div className="field-label">Section</div>
              <select
                className="field-input"
                style={{ marginBottom: 0 }}
                value={filterSectionId}
                onChange={(e) => setFilterSectionId(e.target.value)}
                disabled={!filterGradeId || sections.length === 0}
              >
                <option value="">All sections</option>
                {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div style={{ flex: '1 1 180px', maxWidth: 240 }}>
              <div className="field-label">Student</div>
              <select
                className="field-input"
                style={{ marginBottom: 0 }}
                value={filterStudentId}
                onChange={(e) => setFilterStudentId(e.target.value)}
                disabled={studentsInSection.length === 0}
              >
                <option value="">All students</option>
                {studentsInSection.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div style={{ flex: '1 1 150px', maxWidth: 180 }}>
              <div className="field-label">Status</div>
              <select className="field-input" style={{ marginBottom: 0 }} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="">All statuses</option>
                {INVOICE_STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
              </select>
            </div>
            {hasInvoiceFilters && (
              <Button variant="soft" small onClick={clearInvoiceFilters}>Clear filters</Button>
            )}
          </div>

          {invoices === null && <Card><SkeletonRows rows={5} /></Card>}
          {invoices !== null && filteredInvoices.length === 0 && (
            hasInvoiceFilters
              ? <EmptyState title="No matching invoices" sub="No invoices match the current filters. Clear them to see the full list." />
              : <EmptyState title="No invoices yet" sub="No fee invoices have been raised. Click '+ Create Invoice' to raise one." />
          )}
          {invoices !== null && filteredInvoices.length > 0 && (
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
                total={filteredInvoices.length}
                totalPages={invoiceTotalPages}
                pageSizes={PAGE_SIZE_OPTIONS}
                label="invoices"
                onPageChange={setInvoicePage}
                onPageSizeChange={(size) => { setInvoicePageSize(size); setInvoicePage(1); }}
              />
            </Card>
          )}
        </>
      )}

      {activeTab === 'plans' && <FeeStructuresPanel />}

      {activeTab === 'receipts' && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16, alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 220px', maxWidth: 300 }}>
              <div className="field-label">Search</div>
              <input
                className="field-input"
                style={{ marginBottom: 0 }}
                type="search"
                placeholder="Receipt no, invoice no or student…"
                value={receiptSearch}
                onChange={(e) => onReceiptSearch(e.target.value)}
                aria-label="Search receipts"
              />
            </div>
            <div style={{ flex: '1 1 160px', maxWidth: 190 }}>
              <div className="field-label">Paid from</div>
              <input
                className="field-input"
                style={{ marginBottom: 0 }}
                type="date"
                value={receiptFrom}
                max={receiptTo || undefined}
                onChange={(e) => { setReceiptFrom(e.target.value); setReceiptPage(1); }}
                aria-label="Payments from date"
              />
            </div>
            <div style={{ flex: '1 1 160px', maxWidth: 190 }}>
              <div className="field-label">Paid to</div>
              <input
                className="field-input"
                style={{ marginBottom: 0 }}
                type="date"
                value={receiptTo}
                min={receiptFrom || undefined}
                onChange={(e) => { setReceiptTo(e.target.value); setReceiptPage(1); }}
                aria-label="Payments to date"
              />
            </div>
            {(receiptSearch || receiptFrom || receiptTo) && (
              <Button
                variant="soft"
                small
                onClick={() => {
                  setReceiptSearch(''); setAppliedReceiptSearch('');
                  setReceiptFrom(''); setReceiptTo(''); setReceiptPage(1);
                }}
              >
                Clear filters
              </Button>
            )}
          </div>

          {receipts === null && <Card><SkeletonRows rows={5} /></Card>}
          {receipts?.length === 0 && (
            appliedReceiptSearch || receiptFrom || receiptTo
              ? <EmptyState title="No matching receipts" sub="No payments match the current search or date range." />
              : <EmptyState title="No payment receipts" sub="No payments have been recorded yet." />
          )}
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
                pageSizes={PAGE_SIZE_OPTIONS}
                busy={receiptsBusy}
                label="receipts"
                onPageChange={setReceiptPage}
                onPageSizeChange={(size) => { setReceiptPageSize(size); setReceiptPage(1); }}
              />
            </Card>
          )}
        </>
      )}

      {paying && <RecordModal invoice={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); reload(); }} />}
      {showCreate && <CreateInvoiceModal students={students} onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); reload(); }} />}
      {showBulkCreate && (
        <BulkUploadModal
          title="Bulk upload invoices"
          description="Upload a CSV to raise many one-line invoices at once. invoiceNo is optional — auto-generated if left blank."
          templateHeaders={['admissionNo', 'invoiceNo', 'description', 'amount', 'dueOn']}
          templateSampleRow={['ADM-2026-0010', '', 'Tuition Fee', '5000', '2026-08-15']}
          onSubmit={(file) => api.bulkCreateInvoices(file)}
          onClose={() => setShowBulkCreate(false)}
          onImported={(r) => { toast(`Created ${r.imported} of ${r.imported + r.failed} invoices.`, r.failed > 0 ? 'error' : 'success'); reload(); }}
        />
      )}
    </PortalShell>
  );
}

/* ── Record Payment Modal ─────────────────────────────────── */
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
    } catch (e: unknown) {
      // The server names the specific failure and, for an over-payment, states
      // the exact balance remaining — better than anything we could word here.
      // ('OVERPAYMENT' was the code this checked for before the server actually
      // emitted one; the real code is PAYMENT_EXCEEDS_BALANCE.)
      const known = e instanceof ApiError
        && ['PAYMENT_EXCEEDS_BALANCE', 'INVOICE_CANCELLED', 'INVALID_AMOUNT', 'INVALID_PAYMENT_MODE'].includes(e.code);
      setErr(known ? (e as ApiError).message : errorMessage(e, 'Could not record payment.'));
    } finally { setBusy(false); }
  };

  return (
    // Backdrop dismissal is a mouse convenience; ModalA11yBridge supplies
    // Escape-to-close and a focus trap, and a backdrop must not be a tab stop.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && (receipt ? onDone : onClose)()}>
      <div className="modal" style={{ maxWidth: 400 }}>
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

/* ── Create Invoice Modal ─────────────────────────────────── */
function CreateInvoiceModal({
  students,
  onClose,
  onDone,
}: {
  students: StudentListItem[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [enrollments, setEnrollments] = useState<{ id: string; studentName: string; class: string }[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [enrollmentId, setEnrollmentId] = useState('');
  const [feeDesc, setFeeDesc] = useState('Tuition Fee');
  const [amount, setAmount] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Load enrollments when a student is selected
  useEffect(() => {
    if (!selectedStudentId) { setEnrollments([]); setEnrollmentId(''); return; }
    api.listEnrollments(selectedStudentId)
      .then((list) => {
        setEnrollments(list);
        if (list.length === 1) setEnrollmentId(list[0].id);
        else setEnrollmentId('');
      })
      .catch(() => setEnrollments([]));
  }, [selectedStudentId]);

  const submit = async () => {
    if (!enrollmentId) return setErr('Please select the student enrollment.');
    if (!amount || parseFloat(amount) <= 0) return setErr('Enter a valid amount.');
    if (!dueOn) return setErr('Please set a due date.');
    setBusy(true); setErr(null);
    try {
      const invoiceNo = `INV-${Date.now()}`;
      await api.createInvoice({
        enrollmentId,
        invoiceNo,
        dueOn: new Date(dueOn).toISOString(),
        lines: [{ description: feeDesc, amountPaise: Math.round(parseFloat(amount) * 100), concessionPaise: 0 }],
      });
      onDone();
    } catch (e: unknown) {
      setErr(errorMessage(e, 'Failed to create invoice.'));
    } finally { setBusy(false); }
  };

  return (
    // Backdrop dismissal is a mouse convenience; ModalA11yBridge supplies
    // Escape-to-close and a focus trap, and a backdrop must not be a tab stop.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 440 }}>
        <div className="modal-header">
          <div className="modal-title">Create Invoice</div>
          <button className="modal-close" aria-label="Close dialog" title="Close" onClick={onClose}>×</button>
        </div>

        <div className="field-label">Student *</div>
        <select className="field-input" value={selectedStudentId} onChange={(e) => setSelectedStudentId(e.target.value)}>
          <option value="">— select a student —</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} {s.enrollment ? `(${s.enrollment.class})` : '(admitted – no class yet)'}
            </option>
          ))}
        </select>

        {selectedStudentId && enrollments.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--amber, #b08020)', marginTop: 4 }}>
            ⚠ This student has no enrollment record yet. Assign them to a section first to raise a fee invoice.
          </p>
        )}

        {enrollments.length > 1 && (
          <>
            <div className="field-label">Enrollment *</div>
            <select className="field-input" value={enrollmentId} onChange={(e) => setEnrollmentId(e.target.value)}>
              <option value="">— select enrollment —</option>
              {enrollments.map((e) => (
                <option key={e.id} value={e.id}>{e.studentName} – {e.class}</option>
              ))}
            </select>
          </>
        )}

        <div className="field-label" style={{ marginTop: 12 }}>Fee Description *</div>
        <input className="field-input" value={feeDesc} onChange={(e) => setFeeDesc(e.target.value)} placeholder="e.g. Tuition Fee – Term 1" />

        <div className="field-label" style={{ marginTop: 12 }}>Amount (₹) *</div>
        <input className="field-input" type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 15000" />

        <div className="field-label" style={{ marginTop: 12 }}>Due Date *</div>
        <input className="field-input" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />

        {err && <p style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{err}</p>}

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <Button variant="soft" onClick={onClose} disabled={busy} style={{ flex: 1 }}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !enrollmentId || !amount || !dueOn} style={{ flex: 1 }}>
            {busy ? 'Creating…' : 'Create Invoice'}
          </Button>
        </div>
      </div>
    </div>
  );
}
