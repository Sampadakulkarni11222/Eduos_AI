'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows, Pill, rupees } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { BookDto, BookIssueDto, StudentListItem } from '@/lib/types';
import { formatDate, humanizeLabel } from '../../student/_lib/format';

/**
 * Why a list could not be loaded, in words a parent can act on. A failed
 * request used to be swallowed into an empty list, so a 403 read as "No books
 * matched — try a different title".
 */
function loadError(e: unknown): string {
  if (e instanceof ApiError && e.status === 403) return 'Your account does not have access to the library yet. Please contact the school office.';
  if (e instanceof ApiError && e.message) return e.message;
  return 'Check your connection and try again.';
}

/** An in-card message: no second border inside the card. */
function Note({ title, sub, tone = 'muted' }: { title: string; sub: string; tone?: 'muted' | 'error' }) {
  return (
    <div role={tone === 'error' ? 'alert' : undefined} style={{ padding: '18px 20px' }}>
      <div style={{ fontWeight: 600, fontSize: 13.5, color: tone === 'error' ? 'var(--red)' : 'var(--text-1)', marginBottom: 3 }}>{title}</div>
      <p style={{ fontSize: 12.5, color: 'var(--text-2b)', lineHeight: 1.5 }}>{sub}</p>
    </div>
  );
}

export default function ParentLibrary() {
  const [kids, setKids] = useState<StudentListItem[] | null>(null);
  const [active, setActive] = useState(0);
  const [issued, setIssued] = useState<BookIssueDto[] | null>(null);
  const [books, setBooks] = useState<BookDto[] | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [issuedError, setIssuedError] = useState<string | null>(null);
  const [booksError, setBooksError] = useState<string | null>(null);

  const loadBooks = (q?: string) => {
    setBooksError(null);
    api.listBooks(q ?? '')
      .then(setBooks)
      .catch((e) => { setBooks([]); setBooksError(loadError(e)); });
  };

  useEffect(() => {
    api.students().then((r) => setKids(r.items)).catch(() => setKids([]));
    loadBooks();
  }, []);

  const kid = kids?.[active];

  useEffect(() => {
    if (!kid) { setIssued(null); return; }
    setLoading(true);
    setIssuedError(null);
    api.listIssued(kid.id)
      .then(setIssued)
      .catch((e) => { setIssued([]); setIssuedError(loadError(e)); })
      .finally(() => setLoading(false));
  // Intentionally narrower than the rule wants: this effect reads only the
  // enrollment id, so widening the dependency to the whole `kid` object would
  // refetch on unrelated changes to the selected child.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kid?.id]);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    loadBooks(e.target.value);
  };

  return (
    <PortalShell expectedSlug="parent" topbar={{ title: 'Library', desc: 'Books checked out and catalog search.' }}>
      {kids && kids.length > 1 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {kids.map((k, i) => (
            <button key={k.id} onClick={() => setActive(i)} className="chip-tab"
              style={{ background: i === active ? 'var(--accent)' : 'var(--card-bg)', color: i === active ? 'var(--on-accent)' : 'var(--text-2)', borderColor: i === active ? 'var(--accent)' : 'var(--input-border)' }}>
              {k.name.split(' ')[0]}
            </button>
          ))}
        </div>
      )}

      {kids === null && <Card><SkeletonRows rows={4} /></Card>}
      {kids?.length === 0 && <EmptyState title="No children linked" sub="Ask the office to link your children." />}

      {kid && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16 }}>
          <Card pad={false}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)' }}>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Checked Out Books</strong>
            </div>
            {loading && <div style={{ padding: 20 }}><SkeletonRows rows={3} /></div>}
            {!loading && issuedError && (
              <Note tone="error" title={`Couldn't load ${kid.name.split(' ')[0]}'s books`} sub={issuedError} />
            )}
            {!loading && !issuedError && issued && issued.length === 0 && (
              <Note title="No active checkouts" sub="Books issued by the librarian will appear here." />
            )}
            {!loading && !issuedError && issued && issued.length > 0 && (
              <table className="data-table data-table-cards">
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
                      <td className="cell-primary" data-label="Title">{i.bookTitle}</td>
                      <td data-label="Due Date">{formatDate(i.dueAt)}</td>
                      <td data-label="Fine">{i.finePaise > 0 ? rupees(i.finePaise) : '—'}</td>
                      <td data-label="Status">
                        <Pill tone={i.status === 'RETURNED' ? 'green' : i.status === 'OVERDUE' ? 'red' : 'amber'}>
                          {humanizeLabel(i.status)}
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
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Library Catalog</strong>
              <input className="input" style={{ width: '100%', marginTop: 10 }} placeholder="Search catalog..." value={searchQuery} onChange={handleSearch} />
            </div>
            <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
              {books === null && <div style={{ padding: 20 }}><SkeletonRows rows={3} /></div>}
              {booksError && <Note tone="error" title="Couldn't load the catalog" sub={booksError} />}
              {!booksError && books && books.length === 0 && (
                searchQuery
                  ? <Note title="No books matched" sub="Try searching for a different title." />
                  : <Note title="The catalog is empty" sub="Books appear here once the librarian adds them." />
              )}
              {!booksError && books && books.length > 0 && (
                <table className="data-table data-table-cards">
                  <tbody>
                    {books.map((b) => (
                      <tr key={b.id}>
                        <td data-label="Title">
                          <div style={{ fontWeight: 600, color: 'var(--text-1)' }}>{b.title}</div>
                          <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{b.author}</div>
                        </td>
                        <td style={{ textAlign: 'right' }} data-label="Availability">
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
      )}
    </PortalShell>
  );
}
