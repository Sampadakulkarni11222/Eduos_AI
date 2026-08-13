'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PortalShell } from '@/components/shell';

import { Button, Card, EmptyState, Pill, SkeletonRows, StatCard } from '@/components/ui';
import { api } from '@/lib/api';
import type { LibrarianDashboardDto } from '@/lib/types';

export default function LibrarianDashboard() {
  const router = useRouter();
  // One scoped call instead of /library/books + /library/issued. The counts are
  // now real aggregates: the page previously summed copies over one *page* of
  // the catalogue, so a school with more titles than the page size undercounted
  // its own library.
  const [data, setData] = useState<LibrarianDashboardDto | null>(null);

  useEffect(() => {
    api.librarianDashboard().then(setData).catch(() => setData(null));
  }, []);

  const issues = data?.recentIssueHistory ?? null;
  const returns = data?.recentReturnHistory ?? null;

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

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1.2fr', gap: 16 }}>
        <Card pad={false}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Recent Issue Records</strong>
            <Button variant="soft" small onClick={() => router.push('/librarian/books')}>Manage Lending</Button>
          </div>
          <div style={{ padding: issues === null ? 20 : 0 }}>
            {issues === null && <SkeletonRows rows={3} />}
            {issues !== null && issues.length === 0 && (
              <EmptyState title="No active issues" sub="No books are currently checked out." />
            )}
            {issues?.slice(0, 5).map((item, i) => (
              <div key={item.issueId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderTop: i ? '1px solid var(--hairline)' : 'none' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-1)' }}>{item.book}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-2b)' }}>
                    Borrower: {item.borrower} · Due: {new Date(item.dueDate).toLocaleDateString('en-IN')}
                  </div>
                </div>
                <Pill tone={item.status === 'OVERDUE' ? 'red' : 'amber'}>{item.status.toLowerCase()}</Pill>
              </div>
            ))}
          </div>
        </Card>

        <Card pad={false}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)' }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Returned Today</strong>
          </div>
          <div style={{ padding: returns === null ? 20 : 0 }}>
            {returns === null && <SkeletonRows rows={3} />}
            {returns !== null && returns.length === 0 && (
              <EmptyState title="Nothing returned yet" sub="Returns logged today will appear here." />
            )}
            {returns?.slice(0, 5).map((item, i) => (
              <div key={item.issueId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderTop: i ? '1px solid var(--hairline)' : 'none' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{item.book}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{item.borrower}</div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 500 }}>
                  {item.fine > 0 ? `₹${item.fine} fine` : 'no fine'}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </PortalShell>
  );
}
