'use client';
import { useEffect, useState, useCallback } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, Pill, SkeletonRows, StatCard, rupees, useToast } from '@/components/ui';
import { BulkUploadModal } from '@/components/bulk-upload-modal';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePermissions } from '@/lib/permissions';
import type { FeeSummary, InvoiceDto, PaymentReceiptDto, StudentListItem, GradeDto, SectionDto } from '@/lib/types';

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'gray' | 'blue'> = {
  PAID: 'green', PARTIAL: 'amber', PENDING: 'gray', OVERDUE: 'red', CANCELLED: 'gray',
};

export default function AdminPayments() {
  const [summary, setSummary] = useState<FeeSummary | null>(null);
  const [invoices, setInvoices] = useState<InvoiceDto[] | null>(null);
  const [receipts, setReceipts] = useState<PaymentReceiptDto[] | null>(null);
  const [students, setStudents] = useState<StudentListItem[]>([]);
  const [paying, setPaying] = useState<InvoiceDto | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showBulkCreate, setShowBulkCreate] = useState(false);
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<'invoices' | 'receipts'>('invoices');

  // Grade / Section / Student filter for the Invoices tab
  const [grades, setGrades] = useState<GradeDto[]>([]);
  const [filterGradeId, setFilterGradeId] = useState('');
  const [sections, setSections] = useState<SectionDto[]>([]);
  const [filterSectionId, setFilterSectionId] = useState('');
  const [filterStudentId, setFilterStudentId] = useState('');

  const reload = useCallback(() => {
    api.feeSummary().then(setSummary).catch(() => {});
    api.invoices().then(setInvoices).catch(() => setInvoices([]));
    api.listPayments().then(setReceipts).catch(() => setReceipts([]));
  }, []);

  useEffect(() => {
    reload();
    // Load ALL students (admitted + enrolled) so invoice creation covers everyone
    api.students().then((r) => setStudents(r.items)).catch(() => setStudents([]));
    api.listGrades().then(setGrades).catch(() => setGrades([]));
  }, [reload]);

  // Sections reload whenever the selected grade changes.
  useEffect(() => {
    if (!filterGradeId) { setSections([]); setFilterSectionId(''); return; }
    api.allSections(filterGradeId).then(setSections).catch(() => setSections([]));
    setFilterSectionId('');
  }, [filterGradeId]);

  useEffect(() => { setFilterStudentId(''); }, [filterSectionId]);

  const studentsInSection = students.filter((s) => s.enrollment?.sectionId === filterSectionId);

  // Invoices tab shows nothing until a specific student is picked — no
  // browsing the full unfiltered list.
  const filteredInvoices = filterStudentId
    ? (invoices ?? []).filter((i) => i.studentId === filterStudentId)
    : [];

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
      </div>

      {activeTab === 'invoices' && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <div style={{ flex: '1 1 200px', maxWidth: 260 }}>
              <div className="field-label">Grade *</div>
              <select className="field-input" style={{ marginBottom: 0 }} value={filterGradeId} onChange={(e) => setFilterGradeId(e.target.value)}>
                <option value="">-- Choose grade --</option>
                {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div style={{ flex: '1 1 200px', maxWidth: 260 }}>
              <div className="field-label">Section *</div>
              <select
                className="field-input"
                style={{ marginBottom: 0 }}
                value={filterSectionId}
                onChange={(e) => setFilterSectionId(e.target.value)}
                disabled={!filterGradeId || sections.length === 0}
              >
                <option value="">-- Choose section --</option>
                {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div style={{ flex: '1 1 200px', maxWidth: 260 }}>
              <div className="field-label">Student *</div>
              <select
                className="field-input"
                style={{ marginBottom: 0 }}
                value={filterStudentId}
                onChange={(e) => setFilterStudentId(e.target.value)}
                disabled={!filterSectionId || studentsInSection.length === 0}
              >
                <option value="">-- Choose student --</option>
                {studentsInSection.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          {invoices === null && <Card><SkeletonRows rows={5} /></Card>}
          {invoices !== null && !filterStudentId && (
            <EmptyState title="Select a grade, section, and student" sub="Choose a student above to view their fee invoices and payment status." />
          )}
          {invoices !== null && filterStudentId && filteredInvoices.length === 0 && (
            <EmptyState title="No invoices for this student" sub="This student has no fee invoices yet. Click '+ Create Invoice' to raise one." />
          )}
          {invoices !== null && filterStudentId && filteredInvoices.length > 0 && (
            <Card pad={false}>
              <table className="data-table data-table-cards">
                <thead><tr><th>Invoice</th><th>Student</th><th>Class</th><th>Total</th><th>Paid</th><th>Due On</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {filteredInvoices.map((i) => (
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
              <button className="modal-close" onClick={onClose}>×</button>
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
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to create invoice.');
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-header">
          <div className="modal-title">Create Invoice</div>
          <button className="modal-close" onClick={onClose}>×</button>
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
