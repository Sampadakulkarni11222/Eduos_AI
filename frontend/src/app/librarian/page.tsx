'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, Pill, SkeletonRows, StatCard, rupees, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { LibrarianDashboardDto } from '@/lib/types';

function getDueStatus(dueDateStr: string, status: string): { label: string; tone: 'red' | 'amber' | 'green' | 'gray'; isOverdue: boolean; daysOverdue: number } {
  if (status === 'RETURNED') return { label: 'Returned', tone: 'green', isOverdue: false, daysOverdue: 0 };
  if (!dueDateStr) return { label: 'Active', tone: 'amber', isOverdue: false, daysOverdue: 0 };
  const due = new Date(dueDateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const diffMs = due.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) {
    const daysOverdue = Math.abs(diffDays);
    return { label: `${daysOverdue} day${daysOverdue > 1 ? 's' : ''} overdue`, tone: 'red', isOverdue: true, daysOverdue };
  }
  if (diffDays === 0) return { label: 'Due today', tone: 'amber', isOverdue: false, daysOverdue: 0 };
  if (diffDays <= 7) return { label: `Due in ${diffDays} day${diffDays > 1 ? 's' : ''}`, tone: 'amber', isOverdue: false, daysOverdue: 0 };
  return { label: `Due ${due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`, tone: 'gray', isOverdue: false, daysOverdue: 0 };
}

export default function LibrarianDashboard() {
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = useState<LibrarianDashboardDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'OVERDUE'>('ALL');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const reloadData = () => {
    setLoading(true);
    setErr(false);
    api.librarianDashboard()
      .then((res) => { setData(res); setErr(false); })
      .catch(() => { setData(null); setErr(true); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reloadData();
  }, []);

  const issues = data?.recentIssueHistory ?? null;
  const returns = data?.recentReturnHistory ?? null;

  // Process issues: calculate overdue info, filter by search & overdue-only, sort worst overdue first
  const processedIssues = useMemo(() => {
    if (!issues) return null;
    let list = issues.map((i) => {
      const dueInfo = getDueStatus(i.dueDate, i.status);
      const cleanBook = (i.book && i.book !== 'CPP' && i.book !== '--') ? i.book : 'Untitled Book';
      const cleanBorrower = (i.borrower && i.borrower !== '--') ? i.borrower : 'Student';
      return {
        ...i,
        book: cleanBook,
        borrower: cleanBorrower,
        dueInfo,
      };
    });

    if (filterStatus === 'OVERDUE') {
      list = list.filter((i) => i.status === 'OVERDUE' || i.dueInfo.isOverdue);
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((i) =>
        i.borrower.toLowerCase().includes(q) || i.book.toLowerCase().includes(q)
      );
    }

    // Sort: worst overdue first (highest daysOverdue first), then by status
    return list.sort((a, b) => {
      if (a.dueInfo.isOverdue && b.dueInfo.isOverdue) {
        return b.dueInfo.daysOverdue - a.dueInfo.daysOverdue;
      }
      if (a.dueInfo.isOverdue) return -1;
      if (b.dueInfo.isOverdue) return 1;
      return 0;
    });
  }, [issues, search, filterStatus]);

  const handleReturn = async (issueId: string) => {
    try {
      const res = await api.returnBook(issueId);
      toast(`Book returned. ${res.finePaise > 0 ? `Late fine: ${rupees(res.finePaise)}` : 'No fine.'}`);
      reloadData();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not return book.', 'error');
    }
  };

  const handleRemind = async (issueId: string, borrower: string, bookTitle: string, dueDate: string) => {
    const due = new Date(dueDate).toLocaleDateString('en-IN');
    const msg = `Dear ${borrower}, please return the library book "${bookTitle}" (due on ${due}). Fines may accumulate. — Oakridge Library`;
    try {
      await navigator.clipboard.writeText(msg);
      setCopiedId(issueId);
      toast('Reminder message copied to clipboard!');
      setTimeout(() => setCopiedId(null), 2500);
    } catch {
      toast('Could not copy reminder message.', 'error');
    }
  };

  return (
    <PortalShell
      expectedSlug="librarian"
      topbar={{
        title: 'Library Overview',
        desc: 'Lending catalog & student activity tracking.',
      }}
    >
      <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 18 }}>
        <StatCard label="Total Catalog Books" value={data ? data.totalCopies : '—'} delta={data ? `${data.totalBooks} unique titles` : undefined} deltaDir="flat" />
        <StatCard label="Active Book Issues" value={data ? data.issuedBooks : '—'} delta={data ? 'in circulation' : undefined} deltaDir="flat" />
        <StatCard
          label="Overdue Returns"
          value={data ? data.overdueBooks : '—'}
          delta={data ? 'fines accumulating' : undefined}
          deltaDir={data && data.overdueBooks > 0 ? 'down' : 'flat'}
        />
        <StatCard
          label="Today"
          value={data ? `${data.booksIssuedToday} out / ${data.booksReturnedToday} in` : '—'}
          delta="issued / returned today"
          deltaDir="flat"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16 }}>
        {/* Left Column: Recent Issues with Search, Filter & Inline Actions */}
        <Card pad={false}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Active Lending Records</strong>
            <Button variant="soft" small onClick={() => router.push('/librarian/books')}>Manage Catalog</Button>
          </div>

          {/* Search & Filter Toolbar */}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--hairline)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: '1 1 180px', minWidth: 140 }}>
              <svg style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', opacity: 0.4, pointerEvents: 'none' }}
                width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search borrower or title…"
                style={{ width: '100%', paddingLeft: 30, paddingRight: 10, paddingTop: 6, paddingBottom: 6, border: '1px solid var(--input-border)', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', background: '#fff', color: 'var(--text-1)' }}
                aria-label="Search borrower or book title"
              />
            </div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as 'ALL' | 'OVERDUE')}
              style={{ padding: '6px 10px', border: '1px solid var(--input-border)', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', background: '#fff', color: 'var(--text-1)', cursor: 'pointer' }}
              aria-label="Filter status"
            >
              <option value="ALL">All Active</option>
              <option value="OVERDUE">Overdue Only</option>
            </select>
          </div>

          <div style={{ padding: loading || (!loading && processedIssues?.length === 0) || err ? 20 : 0 }}>
            {loading && <SkeletonRows rows={3} />}
            {!loading && err && <EmptyState title="Couldn't load records" sub="The server didn't respond. Reload the page to try again." />}
            {!loading && !err && processedIssues?.length === 0 && (
              <EmptyState title="No matching issues" sub={filterStatus === 'OVERDUE' ? 'No overdue books found.' : 'No books currently checked out.'} />
            )}
            {!loading && !err && processedIssues?.map((item, i) => (
              <div key={item.issueId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderTop: i ? '1px solid var(--hairline)' : 'none' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.book}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-2b)', marginTop: 2 }}>
                    Borrower: <strong>{item.borrower}</strong>
                  </div>
                </div>

                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <Pill tone={item.dueInfo.tone}>{item.dueInfo.label}</Pill>
                </div>

                {/* Inline Action Buttons */}
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <Button variant="soft" small onClick={() => handleReturn(item.issueId)} style={{ fontSize: 11.5, padding: '4px 8px' }}>
                    Return
                  </Button>
                  <Button
                    variant="ghost"
                    small
                    onClick={() => handleRemind(item.issueId, item.borrower, item.book, item.dueDate)}
                    style={{ fontSize: 11.5, padding: '4px 8px' }}
                    title="Copy return reminder message"
                  >
                    {copiedId === item.issueId ? '✓ Copied' : 'Remind'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Right Column: Returned Today (Fixed Loading & Empty-State Padding) */}
        <Card pad={false}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--hairline)' }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Returned Today</strong>
          </div>
          <div style={{ padding: loading || (!loading && returns?.length === 0) || err ? 20 : 0 }}>
            {loading && <SkeletonRows rows={3} />}
            {!loading && err && <EmptyState title="Couldn't load returns" sub="The server didn't respond. Reload the page to try again." />}
            {!loading && !err && returns?.length === 0 && (
              <EmptyState title="Nothing returned today" sub="Returns logged today will appear here." />
            )}
            {!loading && !err && returns?.map((item, i) => (
              <div key={item.issueId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderTop: i ? '1px solid var(--hairline)' : 'none' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{(item.book && item.book !== 'CPP' && item.book !== '--') ? item.book : 'Untitled Book'}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>Borrower: {item.borrower || 'Student'}</div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 500 }}>
                  {item.fine > 0 ? <span style={{ color: 'var(--red)' }}>₹{item.fine} fine</span> : <span style={{ color: 'var(--green)' }}>no fine</span>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </PortalShell>
  );
}
