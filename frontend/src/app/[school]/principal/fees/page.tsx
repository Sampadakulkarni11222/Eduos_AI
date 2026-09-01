'use client';
import { useEffect, useRef, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, Pill, SkeletonRows, StatCard, rupees } from '@/components/ui';
import { Pagination } from '@/components/pagination';
import { api } from '@/lib/api';
import type { FeeSummary, InvoiceDto } from '@/lib/types';

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'gray'> = {
  PAID: 'green', PARTIAL: 'amber', PENDING: 'gray', OVERDUE: 'red', CANCELLED: 'gray',
};

export default function PrincipalFees() {
  const [summary, setSummary] = useState<FeeSummary | null>(null);
  const [invoices, setInvoices] = useState<InvoiceDto[] | null>(null);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  // The school-wide invoice list runs to hundreds of rows; page it in the
  // browser rather than rendering all of them at once.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [appliedSearch, setAppliedSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { api.feeSummary().then(setSummary).catch(() => {}); }, []);

  // Server-side paging: only the visible page is fetched, so the browser no
  // longer downloads the school's whole invoice list to slice it.
  useEffect(() => {
    api.invoicesPage({
      status: filter || undefined,
      search: appliedSearch || undefined,
      page,
      pageSize,
    })
      .then((r) => {
        setInvoices(r.items);
        setTotal(r.total);
        setTotalPages(r.totalPages);
        if (r.page !== page) setPage(r.page);
      })
      .catch(() => { setInvoices([]); setTotal(0); setTotalPages(1); });
  }, [filter, appliedSearch, page, pageSize]);

  // Filtering/searching/paging all happen on the server now.
  const filtered = invoices ?? [];
  const paged = filtered;
  const safePage = page;

  const onSearch = (q: string) => {
    setSearch(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setPage(1); setAppliedSearch(q.trim()); }, 300);
  };

  return (
    <PortalShell expectedSlug="principal" topbar={{ title: 'Fee Health', desc: 'School-wide fee collection overview.' }}>
      <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 18 }}>
        <StatCard label="Total Collected" value={summary ? rupees(summary.totalCollectedPaise) : '—'} delta={summary ? `${summary.collectionPct}% of billed` : undefined} deltaDir="up" />
        <StatCard label="Pending" value={summary ? rupees(summary.pendingPaise) : '—'} deltaDir="down" />
        <StatCard label="Pending Invoices" value={summary ? summary.pendingCount : '—'} />
        <StatCard label="Total Billed" value={summary ? rupees(summary.totalBilledPaise) : '—'} />
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {['', 'PENDING', 'OVERDUE', 'PARTIAL', 'PAID'].map((s) => (
            <button key={s} onClick={() => { setFilter(s); setPage(1); }} className="chip-tab"
              aria-pressed={filter === s}
              style={{ background: filter === s ? 'var(--accent)' : '#fff', color: filter === s ? 'var(--on-accent)' : 'var(--text-2)', borderColor: filter === s ? 'var(--accent)' : 'var(--input-border)' }}>
              {s || 'All'}
            </button>
          ))}
        </div>
        <input
          className="input" type="search" placeholder="Invoice, student or class…"
          value={search} onChange={(e) => onSearch(e.target.value)}
          aria-label="Search invoices" style={{ maxWidth: 260, flex: '1 1 180px' }}
        />
      </div>

      {invoices === null && <Card><SkeletonRows rows={5} /></Card>}
      {invoices?.length === 0 && <EmptyState title="No invoices" sub="Fee invoices appear here once assigned." />}
      {filtered.length === 0 && invoices && invoices.length > 0 && <EmptyState title="No matching invoices" sub="Try a different filter." />}
      {filtered.length > 0 && (
        <Card pad={false}>
          <table className="data-table data-table-cards">
            <thead><tr><th>Invoice</th><th>Student</th><th>Class</th><th>Total</th><th>Paid</th><th>Due Date</th><th>Status</th></tr></thead>
            <tbody>
              {paged.map((i) => (
                <tr key={i.id}>
                  <td className="cell-primary" data-label="Invoice">{i.invoiceNo}</td>
                  <td data-label="Student">{i.studentName}</td>
                  <td data-label="Class">{i.class}</td>
                  <td data-label="Total">{rupees(i.totalPaise)}</td>
                  <td data-label="Paid">{rupees(i.paidPaise)}</td>
                  <td style={{ color: i.status === 'OVERDUE' ? 'var(--red)' : 'var(--text-2)' }} data-label="Due Date">{i.dueOn}</td>
                  <td data-label="Status"><Pill tone={STATUS_TONE[i.status] ?? 'gray'}>{i.status.toLowerCase()}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            page={safePage}
            pageSize={pageSize}
            total={total}
            totalPages={totalPages}
            label="invoices"
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          />
        </Card>
      )}
    </PortalShell>
  );
}
