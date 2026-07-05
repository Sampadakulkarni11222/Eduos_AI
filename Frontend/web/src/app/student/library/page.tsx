'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows, Pill, rupees } from '@/components/ui';
import { api } from '@/lib/api';
import type { BookDto, BookIssueDto } from '@/lib/types';

export default function StudentLibrary() {
  const [issued, setIssued] = useState<BookIssueDto[] | null>(null);
  const [books, setBooks] = useState<BookDto[] | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.listIssued().then(setIssued),
      api.listBooks().then(setBooks),
    ]).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    api.listBooks(e.target.value).then(setBooks).catch(() => setBooks([]));
  };

  return (
    <PortalShell expectedSlug="student" topbar={{ title: 'My Library Accounts', desc: 'Manage your active issues, returns and track book due dates.' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16 }}>
        <Card pad={false}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)' }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>My Checked Out Books</strong>
          </div>
          {loading && <div style={{ padding: 20 }}><SkeletonRows rows={3} /></div>}
          {!loading && issued && issued.length === 0 && (
            <EmptyState title="No active checkouts" sub="Borrow books from the librarian to see checkout info." />
          )}
          {!loading && issued && issued.length > 0 && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Due Date</th>
                  <th>Fine</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {issued.map((i) => (
                  <tr key={i.id}>
                    <td className="cell-primary">{i.bookTitle}</td>
                    <td>{new Date(i.dueAt).toLocaleDateString('en-IN')}</td>
                    <td>{i.finePaise > 0 ? rupees(i.finePaise) : '—'}</td>
                    <td>
                      <Pill tone={i.status === 'RETURNED' ? 'green' : i.status === 'OVERDUE' ? 'red' : 'amber'}>
                        {i.status}
                      </Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card pad={false}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)' }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Catalog Search</strong>
            <input className="input" style={{ width: '100%', marginTop: 10 }} placeholder="Search library catalog..." value={searchQuery} onChange={handleSearch} />
          </div>
          <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
            {loading && <div style={{ padding: 20 }}><SkeletonRows rows={3} /></div>}
            {!loading && books && books.length === 0 && (
              <EmptyState title="No books matched" sub="Try searching for a different title." />
            )}
            {!loading && books && books.length > 0 && (
              <table className="data-table">
                <tbody>
                  {books.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--text-1)' }}>{b.title}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{b.author}</div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <Pill tone={b.availableCopies > 0 ? 'green' : 'red'}>
                          {b.availableCopies > 0 ? 'Available' : 'Out'}
                        </Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>
    </PortalShell>
  );
}
