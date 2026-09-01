'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, Pill, SkeletonRows, StatCard, cx, rupees } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import type {
  AdminDashboardDto, FinanceDashboardDto, WardenDashboardDto, LibrarianDashboardDto,
} from '@/lib/types';

/**
 * Every school-wide dashboard, in one place.
 *
 * The four aggregations behind this page are the same ones the school's own
 * portals render — `/dashboard/admin`, `/finance`, `/warden`, `/librarian` —
 * which now list SUPER_ADMIN in their role gate. Nothing is recomputed here.
 *
 * The per-person dashboards (teacher/student/parent) are deliberately absent:
 * each is an aggregation of one signed-in profile's own classes, record or
 * children, so there is nothing for a platform actor to open.
 */

type TabKey = 'operations' | 'finance' | 'hostel' | 'library';

const TABS: Array<{ key: TabKey; label: string; icon: string }> = [
  { key: 'operations', label: 'Operations', icon: '◫' },
  { key: 'finance', label: 'Finance', icon: '₹' },
  { key: 'hostel', label: 'Hostel', icon: '▦' },
  { key: 'library', label: 'Library', icon: '▢' },
];

const TAB_KEY = 'eduos.superadmin.dashboardTab';

export default function SuperAdminDashboardsPage() {
  const [tab, setTab] = useState<TabKey>('operations');

  const [ops, setOps] = useState<AdminDashboardDto | null>(null);
  const [finance, setFinance] = useState<FinanceDashboardDto | null>(null);
  const [hostel, setHostel] = useState<WardenDashboardDto | null>(null);
  const [library, setLibrary] = useState<LibrarianDashboardDto | null>(null);
  const [errors, setErrors] = useState<Partial<Record<TabKey, string>>>({});

  // Which panel was last open is a per-device convenience, so it lives in
  // localStorage. Read after mount to keep server and client markup equal.
  useEffect(() => {
    const saved = localStorage.getItem(TAB_KEY);
    if (saved && TABS.some((t) => t.key === saved)) setTab(saved as TabKey);
  }, []);

  const selectTab = (key: TabKey) => {
    setTab(key);
    localStorage.setItem(TAB_KEY, key);
  };

  useEffect(() => {
    const fail = (key: TabKey) => (e: unknown) =>
      setErrors((prev) => ({ ...prev, [key]: errorMessage(e, 'The server did not respond.') }));

    // All four load up front: the counts in the tab strip come from them, and
    // switching panels should not re-fetch what is already on screen.
    void api.adminDashboard().then(setOps).catch(fail('operations'));
    void api.financeDashboard().then(setFinance).catch(fail('finance'));
    void api.wardenDashboard().then(setHostel).catch(fail('hostel'));
    void api.librarianDashboard().then(setLibrary).catch(fail('library'));
  }, []);

  const loaded: Record<TabKey, boolean> = {
    operations: ops !== null, finance: finance !== null, hostel: hostel !== null, library: library !== null,
  };

  return (
    <PortalShell
      expectedSlug="super-admin"
      topbar={{
        title: 'School Dashboards',
        desc: 'Every school-wide aggregation the school portals show, read from the same endpoints.',
      }}
    >
      <div role="tablist" aria-label="School dashboards" style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`panel-${t.key}`}
            onClick={() => selectTab(t.key)}
            className={cx('btn', tab === t.key ? 'btn-accent' : 'btn-soft', 'btn-sm')}
          >
            <span aria-hidden="true" style={{ marginRight: 6 }}>{t.icon}</span>
            {t.label}
            {errors[t.key] && <span aria-hidden="true" style={{ marginLeft: 6 }}>⚠</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {errors[tab] && <EmptyState title="Couldn't load this dashboard" sub={errors[tab]!} />}
        {!errors[tab] && !loaded[tab] && <Card><SkeletonRows rows={6} /></Card>}
        {!errors[tab] && loaded[tab] && (
          <>
            {tab === 'operations' && <Operations data={ops!} />}
            {tab === 'finance' && <Finance data={finance!} />}
            {tab === 'hostel' && <Hostel data={hostel!} />}
            {tab === 'library' && <Library data={library!} />}
          </>
        )}
      </div>
    </PortalShell>
  );
}

const grid = (cols: number): React.CSSProperties => ({
  display: 'grid', gridTemplateColumns: `repeat(${cols},1fr)`, gap: 14, marginBottom: 18,
});

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card pad={false}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--hairline)' }}>
        <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>{title}</strong>
      </div>
      {children}
    </Card>
  );
}

const dateOnly = (d: string) => new Date(d).toLocaleDateString('en-IN');

/** Formats an amount that is already in rupees, matching rupees()'s output. */
const inRupees = (amount: number) =>
  '₹' + (Number(amount) || 0).toLocaleString('en-IN', {
    minimumFractionDigits: (Number(amount) || 0) % 1 !== 0 ? 2 : 0,
    maximumFractionDigits: 2,
  });

function Operations({ data }: { data: AdminDashboardDto }) {
  const pipelineTotal = data.admissionsPipeline
    .filter((s) => s.stage !== 'ENROLLED' && s.stage !== 'LOST')
    .reduce((sum, s) => sum + s.count, 0);

  return (
    <>
      <div className="card-grid" style={grid(4)}>
        <StatCard label="Total Students" value={data.totalStudents} delta="active enrolments" deltaDir="flat" />
        <StatCard label="Open Tickets" value={data.openTickets} delta="awaiting response" deltaDir={data.openTickets > 0 ? 'down' : 'flat'} />
        <StatCard label="Announcements" value={data.announcementsCount} delta="total published" deltaDir="flat" />
        <StatCard label="Admissions Pipeline" value={pipelineTotal} delta="active leads" deltaDir="flat" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16 }}>
        <Panel title="Open Tickets">
          {data.recentTickets.length === 0 ? (
            <EmptyState title="No open tickets" sub="Raised tickets will appear here." />
          ) : (
            <table className="data-table data-table-cards">
              <thead><tr><th>Subject</th><th>Raised by</th><th>Status</th><th>Raised</th></tr></thead>
              <tbody>
                {data.recentTickets.map((t) => (
                  <tr key={t._id}>
                    <td className="cell-primary" style={{ fontWeight: 600 }} data-label="Subject">{t.subject}</td>
                    <td data-label="Raised by">{t.raisedByProfileId?.displayName ?? '—'}</td>
                    <td data-label="Status"><Pill tone={t.status === 'OPEN' ? 'amber' : 'green'}>{t.status}</Pill></td>
                    <td style={{ color: 'var(--text-faint)' }} data-label="Raised">{dateOnly(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Admissions Pipeline">
          {data.admissionsPipeline.length === 0 ? (
            <EmptyState title="No leads" sub="Admission leads will appear here." />
          ) : (
            <div style={{ padding: '8px 18px 14px' }}>
              {data.admissionsPipeline.map((s) => (
                <div key={s.stage} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--hairline)' }}>
                  <span style={{ fontSize: 13 }}>{s.stage}</span>
                  <strong style={{ fontSize: 13 }}>{s.count}</strong>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div style={{ marginTop: 16 }}>
        <Panel title="Recent Students">
          {data.recentStudents.length === 0 ? (
            <EmptyState title="No students yet" sub="Newly admitted students will appear here." />
          ) : (
            <table className="data-table data-table-cards">
              <thead><tr><th>Name</th><th>Admission No</th><th>Added</th></tr></thead>
              <tbody>
                {data.recentStudents.map((s) => (
                  <tr key={s._id}>
                    <td className="cell-primary" style={{ fontWeight: 600 }} data-label="Name">{`${s.firstName} ${s.lastName ?? ''}`.trim()}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }} data-label="Admission No">{s.admissionNo}</td>
                    <td style={{ color: 'var(--text-faint)' }} data-label="Added">{dateOnly(s.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </>
  );
}

function Finance({ data }: { data: FinanceDashboardDto }) {
  return (
    <>
      <div className="card-grid" style={grid(4)}>
        <StatCard label="Pending Amount" value={rupees(data.pendingAmountPaise)}
          delta={`${data.pendingInvoices.length} unpaid invoice(s)`} deltaDir={data.pendingAmountPaise > 0 ? 'down' : 'flat'} />
        <StatCard label="Collected" value={rupees(data.collectedAmountPaise)} delta={`${data.collectionRate}% collection rate`} deltaDir="up" />
        {/* totalBilled comes from the API already converted to rupees, unlike
            the *Paise fields beside it — so it must not go through rupees(). */}
        <StatCard label="Total Billed" value={inRupees(data.totalBilled)} delta="raised to date" deltaDir="flat" />
        <StatCard label="Invoices" value={data.invoiceCount} delta="total raised" deltaDir="flat" />
      </div>

      <Panel title="Recent Invoices">
        {data.recentInvoices.length === 0 ? (
          <EmptyState title="No invoices" sub="Raised invoices will appear here." />
        ) : (
          <table className="data-table data-table-cards">
            <thead><tr><th>Invoice</th><th>Student</th><th>Status</th><th>Due</th><th>Amount</th></tr></thead>
            <tbody>
              {data.recentInvoices.map((inv) => (
                <tr key={inv._id}>
                  <td className="cell-primary" style={{ fontWeight: 600 }} data-label="Invoice">{inv.invoiceNo}</td>
                  <td data-label="Student">
                    <div>{inv.studentName}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-faint)', fontFamily: 'monospace' }}>{inv.admissionNo}</div>
                  </td>
                  <td data-label="Status"><Pill tone={inv.status === 'PAID' ? 'green' : inv.dueAmount > 0 ? 'amber' : 'gray'}>{inv.status}</Pill></td>
                  <td style={{ color: 'var(--text-faint)' }} data-label="Due">{dateOnly(inv.dueOn)}</td>
                  <td data-label="Amount">{rupees(inv.totalAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}

function Hostel({ data }: { data: WardenDashboardDto }) {
  return (
    <>
      <div className="card-grid" style={grid(4)}>
        <StatCard label="Hostel Students" value={data.hostelStudents} delta={`${data.occupiedRooms} rooms occupied`} deltaDir="flat" />
        <StatCard label="Occupancy" value={`${data.occupancyRate}%`} delta={`${data.vacantBeds} of ${data.totalCapacity} beds free`} deltaDir="flat" />
        <StatCard label="Maintenance" value={data.maintenanceRooms} delta={`${data.maintenanceRequests} request(s)`} deltaDir={data.maintenanceRooms > 0 ? 'down' : 'flat'} />
        <StatCard label="Pending Leave" value={data.pendingLeaveCount} delta={`${data.openInquiries} open inquiry(ies)`} deltaDir="flat" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Panel title="Recent Allocations">
          {data.recentAllocations.length === 0 ? (
            <EmptyState title="No allocations" sub="Room allocations will appear here." />
          ) : (
            <table className="data-table data-table-cards">
              <thead><tr><th>Student</th><th>Room</th><th>Allotted</th></tr></thead>
              <tbody>
                {data.recentAllocations.map((a) => (
                  <tr key={a.allocationId}>
                    <td className="cell-primary" style={{ fontWeight: 600 }} data-label="Student">{a.studentName}</td>
                    <td data-label="Room">{a.block} · {a.roomNo}</td>
                    <td style={{ color: 'var(--text-faint)' }} data-label="Allotted">{dateOnly(a.allottedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Leave Requests">
          {data.leaveRequests.length === 0 ? (
            <EmptyState title="No leave requests" sub="Hostel leave applications will appear here." />
          ) : (
            <table className="data-table data-table-cards">
              <thead><tr><th>Student</th><th>Dates</th><th>Status</th></tr></thead>
              <tbody>
                {data.leaveRequests.map((l) => (
                  <tr key={l.id}>
                    <td className="cell-primary" style={{ fontWeight: 600 }} data-label="Student">{l.studentName}</td>
                    <td data-label="Dates">{dateOnly(l.fromDate)} → {dateOnly(l.toDate)}</td>
                    <td data-label="Status"><Pill tone={l.status === 'APPROVED' ? 'green' : l.status === 'REJECTED' ? 'red' : 'amber'}>{l.status}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </>
  );
}

function Library({ data }: { data: LibrarianDashboardDto }) {
  return (
    <>
      <div className="card-grid" style={grid(4)}>
        <StatCard label="Titles" value={data.totalBooks} delta={`${data.totalCopies} copies`} deltaDir="flat" />
        <StatCard label="Issued" value={data.issuedBooks} delta={`${data.booksIssuedToday} today`} deltaDir="flat" />
        <StatCard label="Available" value={data.availableBooks} delta={`${data.booksReturnedToday} returned today`} deltaDir="flat" />
        <StatCard label="Overdue" value={data.overdueBooks} delta="past due date" deltaDir={data.overdueBooks > 0 ? 'down' : 'flat'} />
      </div>

      <Panel title="Recent Lending">
        {data.recentIssueHistory.length === 0 ? (
          <EmptyState title="No lending activity" sub="Issued books will appear here." />
        ) : (
          <table className="data-table data-table-cards">
            <thead><tr><th>Book</th><th>Borrower</th><th>Issued</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>
              {data.recentIssueHistory.map((i) => (
                <tr key={i.issueId}>
                  <td className="cell-primary" style={{ fontWeight: 600 }} data-label="Book">
                    <div>{i.book}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>{i.author}</div>
                  </td>
                  <td data-label="Borrower">{i.borrower}</td>
                  <td style={{ color: 'var(--text-faint)' }} data-label="Issued">{dateOnly(i.issuedAt)}</td>
                  <td style={{ color: 'var(--text-faint)' }} data-label="Due">{dateOnly(i.dueDate)}</td>
                  <td data-label="Status"><Pill tone={i.status === 'RETURNED' ? 'green' : 'amber'}>{i.status}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
