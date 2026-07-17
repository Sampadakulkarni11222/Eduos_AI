'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PortalShell } from '@/components/shell';

import { Button, Card, EmptyState, Pill, SkeletonRows, StatCard } from '@/components/ui';
import { api } from '@/lib/api';
import type { BookDto, BookIssueDto } from '@/lib/types';

export default function LibrarianDashboard() {
  const router = useRouter();
  const [books, setBooks] = useState<BookDto[] | null>(null);
  const [issued, setIssued] = useState<BookIssueDto[] | null>(null);

  useEffect(() => {
    api.listBooks().then(setBooks).catch(() => setBooks([]));
    api.listIssued().then(setIssued).catch(() => setIssued([]));
  }, []);

  const totalBooks = books ? books.reduce((acc, b) => acc + b.totalCopies, 0) : 0;
  const activeIssues = issued ? issued.filter((i) => i.status === 'ACTIVE' || i.status === 'OVERDUE') : [];
  const overdueIssues = issued ? issued.filter((i) => i.status === 'OVERDUE') : [];

  return (
    <PortalShell
      expectedSlug="librarian"
      topbar={{
        title: 'Library Overview',
        desc: 'Lending catalog & student activity tracking.',
      }}
    >
      <div className="card-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: 18 }}>
        <StatCard label="Total Catalog Books" value={books ? totalBooks : '—'} delta={books ? `${books.length} unique titles` : undefined} deltaDir="flat" />
        <StatCard label="Active Book Issues" value={issued ? activeIssues.length : '—'} delta={issued ? 'in circulation' : undefined} deltaDir="flat" />
        <StatCard
          label="Overdue Returns"
          value={issued ? overdueIssues.length : '—'}
          delta={issued ? 'fines accumulating' : undefined}
          deltaDir={overdueIssues.length > 0 ? 'down' : 'flat'}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1.2fr', gap: 16 }}>
        <Card pad={false}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Recent Issue Records</strong>
            <Button variant="soft" small onClick={() => router.push('/librarian/books')}>Manage Lending</Button>
          </div>
          <div style={{ padding: issued === null ? 20 : 0 }}>
            {issued === null && <SkeletonRows rows={3} />}
            {issued !== null && activeIssues.length === 0 && (
              <EmptyState title="No active issues" sub="No books are currently checked out." />
            )}
            {activeIssues.slice(0, 5).map((item, i) => (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderTop: i ? '1px solid var(--hairline)' : 'none' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-1)' }}>{item.bookTitle}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-2b)' }}>
                    Borrower: {item.studentName} · Due: {new Date(item.dueAt).toLocaleDateString('en-IN')}
                  </div>
                </div>
                <Pill tone={item.status === 'OVERDUE' ? 'red' : 'amber'}>{item.status.toLowerCase()}</Pill>
              </div>
            ))}
          </div>
        </Card>

        <Card pad={false}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)' }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Quick Catalog Sneak-peek</strong>
          </div>
          <div style={{ padding: books === null ? 20 : 0 }}>
            {books === null && <SkeletonRows rows={3} />}
            {books !== null && books.length === 0 && (
              <EmptyState title="Catalog empty" sub="Add books to get started." />
            )}
            {books?.slice(0, 5).map((book, i) => (
              <div key={book.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderTop: i ? '1px solid var(--hairline)' : 'none' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{book.title}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{book.author}</div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 500 }}>
                  {book.availableCopies} / {book.totalCopies} left
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </PortalShell>
  );
}
