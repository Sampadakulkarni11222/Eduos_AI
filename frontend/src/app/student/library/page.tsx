'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, SkeletonRows, Pill, Button, rupees } from '@/components/ui';
import { api } from '@/lib/api';
import type { BookDto, BookIssueDto, BookReservationDto } from '@/lib/types';

export default function StudentLibrary() {
  const [issued, setIssued] = useState<BookIssueDto[] | null>(null);
  const [books, setBooks] = useState<BookDto[] | null>(null);
  const [reservations, setReservations] = useState<BookReservationDto[] | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadData = () => {
    Promise.all([
      api.listIssued().then(setIssued),
      api.listBooks().then(setBooks),
      api.listMyBookReservations().then(setReservations),
    ]).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    api.listBooks(e.target.value).then(setBooks).catch(() => setBooks([]));
  };

  const handleReserve = async (bookId: string) => {
    setActioningId(bookId);
    setMsg(null);
    try {
      const res = await api.createBookReservation(bookId);
      setMsg({ type: 'success', text: `Reserved "${res.bookTitle}"! You are #${res.queuePosition} in line.` });
      loadData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err?.message || 'Failed to place reservation' });
    } finally {
      setActioningId(null);
    }
  };

  const handleCancelReservation = async (reservationId: string) => {
    setActioningId(reservationId);
    setMsg(null);
    try {
      await api.cancelBookReservation(reservationId);
      setMsg({ type: 'success', text: 'Reservation cancelled successfully.' });
      loadData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err?.message || 'Failed to cancel reservation' });
    } finally {
      setActioningId(null);
    }
  };

  const overdueCount = (issued ?? []).filter((i) => i.status === 'OVERDUE' || (i.daysOverdue ?? 0) > 0).length;

  const reservationTone = (status: string) => {
    switch (status) {
      case 'READY': return 'green';
      case 'PENDING': return 'amber';
      case 'FULFILLED': return 'blue';
      case 'CANCELLED': return 'gray';
      case 'EXPIRED': return 'red';
      default: return 'gray';
    }
  };

  return (
    <PortalShell expectedSlug="student" topbar={{ title: 'My Library Accounts', desc: 'Manage checkouts, reserve books, and track due dates.' }}>
      {overdueCount > 0 && (
        <div style={{ padding: '12px 16px', borderRadius: 8, background: '#FDF2F2', border: '1px solid #F87171', color: '#991B1B', fontSize: 13, marginBottom: 16 }}>
          ⚠️ <strong>Overdue Notice:</strong> You have {overdueCount} overdue library book(s). Please return them promptly to the library to avoid additional fines.
        </div>
      )}

      {msg && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: msg.type === 'success' ? '#ECFDF5' : '#FDF2F2', border: `1px solid ${msg.type === 'success' ? '#6EE7B7' : '#F87171'}`, color: msg.type === 'success' ? '#065F46' : '#991B1B', fontSize: 13, marginBottom: 16 }}>
          {msg.text}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16, marginBottom: 16 }}>
        <Card pad={false}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)' }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>My Checked Out Books</strong>
          </div>
          {loading && <div style={{ padding: 20 }}><SkeletonRows rows={3} /></div>}
          {!loading && issued && issued.length === 0 && (
            <EmptyState title="No active checkouts" sub="Borrow books from the librarian to see checkout info." />
          )}
          {!loading && issued && issued.length > 0 && (
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
                    <td data-label="Due Date">{new Date(i.dueAt).toLocaleDateString('en-IN')}</td>
                    <td data-label="Fine">{i.finePaise > 0 ? rupees(i.finePaise) : '—'}</td>
                    <td data-label="Status">
                      <Pill tone={i.status === 'RETURNED' ? 'green' : i.status === 'OVERDUE' || (i.daysOverdue ?? 0) > 0 ? 'red' : 'amber'}>
                        {i.status === 'RETURNED' ? 'Returned' : i.daysOverdue && i.daysOverdue > 0 ? `${i.daysOverdue}d overdue` : i.status}
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
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Catalog Search & Reserve</strong>
            <input className="input" style={{ width: '100%', marginTop: 10 }} placeholder="Search library catalog..." value={searchQuery} onChange={handleSearch} />
          </div>
          <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
            {loading && <div style={{ padding: 20 }}><SkeletonRows rows={3} /></div>}
            {!loading && books && books.length === 0 && (
              <EmptyState title="No books matched" sub="Try searching for a different title." />
            )}
            {!loading && books && books.length > 0 && (
              <table className="data-table data-table-cards">
                <tbody>
                  {books.map((b) => (
                    <tr key={b.id}>
                      <td data-label="Book">
                        <div style={{ fontWeight: 600, color: 'var(--text-1)' }}>{b.title}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{b.author}</div>
                      </td>
                      <td style={{ textAlign: 'right' }} data-label="Availability / Reserve">
                        {b.availableCopies > 0 ? (
                          <Pill tone="green">Available</Pill>
                        ) : (
                          <Button
                            variant="ghost"
                            small
                            disabled={actioningId === b.id}
                            onClick={() => handleReserve(b.id)}
                          >
                            {actioningId === b.id ? 'Reserving…' : '🔖 Reserve Book'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>

      <Card pad={false}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)' }}>
          <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>My Book Reservations</strong>
        </div>
        {loading && <div style={{ padding: 20 }}><SkeletonRows rows={3} /></div>}
        {!loading && reservations && reservations.length === 0 && (
          <EmptyState title="No reservations" sub="When you reserve an unavailable book, it will appear here." />
        )}
        {!loading && reservations && reservations.length > 0 && (
          <table className="data-table data-table-cards">
            <thead>
              <tr>
                <th>Book Title</th>
                <th>Queue Position</th>
                <th>Status</th>
                <th>Reserved Date</th>
                <th>Expires</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {reservations.map((r) => (
                <tr key={r.id}>
                  <td className="cell-primary" data-label="Book Title">
                    <div style={{ fontWeight: 600 }}>{r.bookTitle}</div>
                    {r.bookAuthor && <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{r.bookAuthor}</div>}
                  </td>
                  <td data-label="Queue Position">
                    {r.status === 'READY' ? (
                      <span style={{ fontWeight: 700, color: '#10B981' }}>Ready to collect!</span>
                    ) : r.status === 'PENDING' ? (
                      <span style={{ fontWeight: 600 }}>#{r.queuePosition} in line</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td data-label="Status">
                    <Pill tone={reservationTone(r.status)}>
                      {r.status}
                    </Pill>
                  </td>
                  <td data-label="Reserved Date">{new Date(r.reservedAt).toLocaleDateString('en-IN')}</td>
                  <td data-label="Expires">
                    {r.expiresAt ? new Date(r.expiresAt).toLocaleString('en-IN') : '—'}
                  </td>
                  <td data-label="Action">
                    {(r.status === 'PENDING' || r.status === 'READY') && (
                      <Button
                        variant="ghost"
                        small
                        style={{ color: '#DC2626' }}
                        disabled={actioningId === r.id}
                        onClick={() => handleCancelReservation(r.id)}
                      >
                        {actioningId === r.id ? 'Cancelling…' : 'Cancel'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </PortalShell>
  );
}
