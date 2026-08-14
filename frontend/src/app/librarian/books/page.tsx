'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, SkeletonRows, Pill, rupees, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { BookDto, BookIssueDto, BookReservationDto, StudentListItem } from '@/lib/types';

export default function LibrarianBooks() {
  const [books, setBooks] = useState<BookDto[] | null>(null);
  const [issued, setIssued] = useState<BookIssueDto[] | null>(null);
  const [overdue, setOverdue] = useState<BookIssueDto[] | null>(null);
  const [reservations, setReservations] = useState<BookReservationDto[] | null>(null);
  const [students, setStudents] = useState<StudentListItem[] | null>(null);
  const [activeTab, setActiveTab] = useState<'books' | 'issued' | 'overdue' | 'reservations'>('books');
  const [searchQuery, setSearchQuery] = useState('');
  const [busyReminders, setBusyReminders] = useState(false);
  const toast = useToast();

  // Modals state
  const [showBookModal, setShowBookModal] = useState(false);
  const [newBook, setNewBook] = useState({ title: '', author: '', isbn: '', category: 'GENERAL', totalCopies: 1 });

  const [showIssueModal, setShowIssueModal] = useState(false);
  const [issueForm, setIssueForm] = useState({ studentId: '', bookId: '', dueAt: '' });

  const loadBooks = () => {
    api.listBooks(searchQuery).then(setBooks).catch(() => setBooks([]));
  };

  const loadIssues = () => {
    api.listIssued().then(setIssued).catch(() => setIssued([]));
  };

  const loadOverdue = () => {
    api.listOverdueIssues().then(setOverdue).catch(() => setOverdue([]));
  };

  useEffect(() => {
    loadBooks();
  }, [searchQuery]);

  useEffect(() => {
    loadIssues();
    loadOverdue();
    api.students().then((r) => setStudents(r.items)).catch(() => setStudents([]));
  }, []);

  const handleCreateBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBook.title || !newBook.author) return;
    try {
      await api.createBook(newBook);
      setShowBookModal(false);
      setNewBook({ title: '', author: '', isbn: '', category: 'GENERAL', totalCopies: 1 });
      toast('Book added to the catalog.');
      loadBooks();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not create the book.', 'error');
    }
  };

  const handleIssueBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!issueForm.studentId || !issueForm.bookId || !issueForm.dueAt) return;
    try {
      const dueIso = new Date(issueForm.dueAt).toISOString();
      await api.issueBook({ ...issueForm, dueAt: dueIso });
      setShowIssueModal(false);
      setIssueForm({ studentId: '', bookId: '', dueAt: '' });
      toast('Book issued.');
      loadIssues();
      loadOverdue();
      loadBooks();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not issue the book. Check copy availability.', 'error');
    }
  };

  const handleReturnBook = async (issueId: string) => {
    if (!confirm('Are you sure you want to return this book?')) return;
    try {
      const res = await api.returnBook(issueId);
      toast(`Book returned. ${res.finePaise > 0 ? `Late fine: ${rupees(res.finePaise)}` : 'No fine.'}`);
      loadIssues();
      loadOverdue();
      loadBooks();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not return the book.', 'error');
    }
  };

  const handleSendReminders = async () => {
    setBusyReminders(true);
    try {
      const res = await api.processLibraryReminders();
      toast(`Sent ${res.remindersSent} reminder(s) to students & parents.`, 'success');
      loadOverdue();
      loadIssues();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not dispatch overdue reminders.', 'error');
    } finally {
      setBusyReminders(false);
    }
  };

  const loadReservations = () => {
    api.listBookReservations().then(setReservations).catch(() => setReservations([]));
  };

  useEffect(() => {
    loadReservations();
  }, []);

  const handleCancelReservationLibrarian = async (id: string) => {
    if (!confirm('Cancel this reservation?')) return;
    try {
      await api.cancelBookReservation(id);
      toast('Reservation cancelled.');
      loadReservations();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not cancel reservation.', 'error');
    }
  };
  return (
    <PortalShell expectedSlug="librarian" topbar={{ title: 'Catalog & Lending', desc: 'Manage library catalog, reservation queue, and student check-out records.' }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        <button className={`chip-tab ${activeTab === 'books' ? 'active' : ''}`} onClick={() => setActiveTab('books')}>Catalog</button>
        <button className={`chip-tab ${activeTab === 'issued' ? 'active' : ''}`} onClick={() => setActiveTab('issued')}>Issued Books</button>
        <button className={`chip-tab ${activeTab === 'reservations' ? 'active' : ''}`} onClick={() => { setActiveTab('reservations'); loadReservations(); }}>
          Reservations Queue {reservations && reservations.filter(r => r.status === 'PENDING' || r.status === 'READY').length > 0 ? `(${reservations.filter(r => r.status === 'PENDING' || r.status === 'READY').length})` : ''}
        </button>
        <button className={`chip-tab ${activeTab === 'overdue' ? 'active' : ''}`} onClick={() => { setActiveTab('overdue'); loadOverdue(); }}>
          Overdue Reminders {overdue && overdue.length > 0 ? `(${overdue.length})` : ''}
        </button>
      </div>

      {activeTab === 'books' && (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 16, alignItems: 'center', justifyContent: 'space-between' }}>
            <input className="input" style={{ maxWidth: 300 }} placeholder="Search title or author..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            <Button onClick={() => setShowBookModal(true)}>Add Book</Button>
          </div>

          <Card pad={false}>
            {books === null && <div style={{ padding: 20 }}><SkeletonRows rows={4} /></div>}
            {books !== null && books.length === 0 && (
              <EmptyState title="No books found" sub="Refine your search or add a new book to the library." />
            )}
            {books && books.length > 0 && (
              <table className="data-table data-table-cards">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Author</th>
                    <th>ISBN</th>
                    <th>Category</th>
                    <th>Availability</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {books.map((b) => (
                    <tr key={b.id}>
                      <td className="cell-primary" data-label="Title">{b.title}</td>
                      <td data-label="Author">{b.author}</td>
                      <td style={{ fontFamily: 'monospace' }} data-label="ISBN">{b.isbn ?? 'ΓÇö'}</td>
                      <td data-label="Category"><Pill tone="gray">{b.category}</Pill></td>
                      <td data-label="Availability">
                        <strong>{b.availableCopies}</strong> / {b.totalCopies} available
                      </td>
                      <td data-label="Action">
                        <Button variant="soft" small disabled={b.availableCopies < 1} onClick={() => {
                          setIssueForm({ ...issueForm, bookId: b.id });
                          setShowIssueModal(true);
                        }}>Issue</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}

      {activeTab === 'issued' && (
        <Card pad={false}>
          {issued === null && <div style={{ padding: 20 }}><SkeletonRows rows={4} /></div>}
          {issued !== null && issued.length === 0 && (
            <EmptyState title="No issued books" sub="Active checked out books will appear here." />
          )}
          {issued && issued.length > 0 && (
            <table className="data-table data-table-cards">
              <thead>
                <tr>
                  <th>Book Title</th>
                  <th>Student Name</th>
                  <th>Issued Date</th>
                  <th>Due Date</th>
                  <th>Returned</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {issued.map((i) => (
                  <tr key={i.id}>
                    <td className="cell-primary" data-label="Book Title">{i.bookTitle}</td>
                    <td data-label="Student Name">{i.studentName}</td>
                    <td data-label="Issued Date">{new Date(i.issuedAt).toLocaleDateString('en-IN')}</td>
                    <td data-label="Due Date">{new Date(i.dueAt).toLocaleDateString('en-IN')}</td>
                    <td data-label="Returned">{i.returnedAt ? new Date(i.returnedAt).toLocaleDateString('en-IN') : 'ΓÇö'}</td>
                    <td data-label="Status">
                      <Pill tone={i.status === 'RETURNED' ? 'green' : i.status === 'OVERDUE' ? 'red' : 'amber'}>
                        {i.status}
                      </Pill>
                    </td>
                    <td data-label="Action">
                      {!i.returnedAt && (
                        <Button variant="ghost" small onClick={() => handleReturnBook(i.id)}>Return</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {activeTab === 'overdue' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
              Overdue items auto-trigger in-app notifications to students & parents (with a 24-hr anti-duplicate window).
            </div>
            <Button onClick={handleSendReminders} disabled={busyReminders}>
              {busyReminders ? 'SendingΓÇª' : 'ΓÜí Dispatch Overdue Reminders'}
            </Button>
          </div>

          <Card pad={false}>
            {overdue === null && <div style={{ padding: 20 }}><SkeletonRows rows={4} /></div>}
            {overdue !== null && overdue.length === 0 && (
              <EmptyState icon="Γ£ö" title="No overdue books" sub="All borrowed books are returned or within their due date!" />
            )}
            {overdue && overdue.length > 0 && (
              <table className="data-table data-table-cards">
                <thead>
                  <tr>
                    <th>Book Title</th>
                    <th>Borrower Student</th>
                    <th>Due Date</th>
                    <th>Overdue Time</th>
                    <th>Est. Fine (Γé╣5/day)</th>
                    <th>Last Reminder</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {overdue.map((i) => (
                    <tr key={i.id}>
                      <td className="cell-primary" data-label="Book Title">{i.bookTitle}</td>
                      <td data-label="Borrower Student">{i.studentName}</td>
                      <td data-label="Due Date">{new Date(i.dueAt).toLocaleDateString('en-IN')}</td>
                      <td data-label="Overdue Time">
                        <Pill tone="red">
                          {i.daysOverdue ? `${i.daysOverdue} day(s) overdue` : 'Overdue'}
                        </Pill>
                      </td>
                      <td data-label="Est. Fine">{rupees((i.daysOverdue ?? 1) * 500)}</td>
                      <td data-label="Last Reminder" style={{ fontSize: 12, color: 'var(--text-2)' }}>
                        {i.lastReminderSentAt
                          ? `${new Date(i.lastReminderSentAt).toLocaleDateString('en-IN')} (${i.reminderCount} sent)`
                          : 'Not sent yet'}
                      </td>
                      <td data-label="Action">
                        <Button variant="ghost" small onClick={() => handleReturnBook(i.id)}>Return Book</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}

      {activeTab === 'reservations' && (
        <Card pad={false}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)' }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Library Book Reservations Queue</strong>
          </div>
          {reservations === null && <div style={{ padding: 20 }}><SkeletonRows rows={4} /></div>}
          {reservations !== null && reservations.length === 0 && (
            <EmptyState title="No active reservations" sub="When students reserve unavailable books, they will appear here in FIFO queue order." />
          )}
          {reservations && reservations.length > 0 && (
            <table className="data-table data-table-cards">
              <thead>
                <tr>
                  <th>Queue #</th>
                  <th>Book Title</th>
                  <th>Student</th>
                  <th>Status</th>
                  <th>Reserved At</th>
                  <th>Expires</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {reservations.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Queue #">
                      <strong style={{ fontSize: 15, color: r.status === 'READY' ? '#10B981' : 'var(--text-1)' }}>
                        {r.status === 'READY' ? 'READY (1st)' : `#${r.queuePosition}`}
                      </strong>
                    </td>
                    <td className="cell-primary" data-label="Book Title">
                      <div style={{ fontWeight: 600 }}>{r.bookTitle}</div>
                      {r.bookAuthor && <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{r.bookAuthor}</div>}
                    </td>
                    <td data-label="Student">{r.studentName}</td>
                    <td data-label="Status">
                      <Pill tone={r.status === 'READY' ? 'green' : r.status === 'PENDING' ? 'amber' : r.status === 'FULFILLED' ? 'blue' : 'gray'}>
                        {r.status}
                      </Pill>
                    </td>
                    <td data-label="Reserved At">{new Date(r.reservedAt).toLocaleDateString('en-IN')}</td>
                    <td data-label="Expires">{r.expiresAt ? new Date(r.expiresAt).toLocaleString('en-IN') : 'ΓÇö'}</td>
                    <td data-label="Action">
                      {(r.status === 'PENDING' || r.status === 'READY') && (
                        <Button
                          variant="ghost"
                          small
                          style={{ color: '#DC2626' }}
                          onClick={() => handleCancelReservationLibrarian(r.id)}
                        >
                          Cancel
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {/* Add Book Modal */}
      {showBookModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Add Book to Catalog</div>
              <button className="modal-close" onClick={() => setShowBookModal(false)}>├ù</button>
            </div>
            <form onSubmit={handleCreateBook}>
              <div className="field-label">Book Title *</div>
              <input className="field-input" required value={newBook.title} onChange={(e) => setNewBook({ ...newBook, title: e.target.value })} placeholder="e.g. Introduction to Algorithms" />

              <div className="field-label">Author Name *</div>
              <input className="field-input" required value={newBook.author} onChange={(e) => setNewBook({ ...newBook, author: e.target.value })} placeholder="e.g. Thomas H. Cormen" />

              <div className="field-label">ISBN</div>
              <input className="field-input" value={newBook.isbn} onChange={(e) => setNewBook({ ...newBook, isbn: e.target.value })} placeholder="e.g. 9780262033848" />

              <div className="field-label">Category</div>
              <select className="field-input" value={newBook.category} onChange={(e) => setNewBook({ ...newBook, category: e.target.value })}>
                <option value="GENERAL">General</option>
                <option value="FICTION">Fiction</option>
                <option value="NON_FICTION">Non Fiction</option>
                <option value="TEXTBOOK">Textbook</option>
                <option value="REFERENCE">Reference</option>
              </select>

              <div className="field-label">Total Copies</div>
              <input className="field-input" type="number" required value={newBook.totalCopies} onChange={(e) => setNewBook({ ...newBook, totalCopies: Number(e.target.value) })} />

              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <Button type="submit">Add Book</Button>
                <Button variant="ghost" type="button" onClick={() => setShowBookModal(false)}>Cancel</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Issue Book Modal */}
      {showIssueModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Issue Book</div>
              <button className="modal-close" onClick={() => setShowIssueModal(false)}>├ù</button>
            </div>
            <form onSubmit={handleIssueBook}>
              <div className="field-label">Select Student *</div>
              <select className="field-input" required value={issueForm.studentId} onChange={(e) => setIssueForm({ ...issueForm, studentId: e.target.value })}>
                <option value="">-- Choose Student --</option>
                {students?.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.enrollment?.class ?? 'No Class'})</option>
                ))}
              </select>

              <div className="field-label">Select Book *</div>
              <select className="field-input" required value={issueForm.bookId} onChange={(e) => setIssueForm({ ...issueForm, bookId: e.target.value })}>
                <option value="">-- Choose Book --</option>
                {books?.map((b) => (
                  <option key={b.id} value={b.id} disabled={b.availableCopies < 1}>{b.title} ({b.availableCopies} left)</option>
                ))}
              </select>

              <div className="field-label">Due Date *</div>
              <input className="field-input" type="date" required value={issueForm.dueAt} onChange={(e) => setIssueForm({ ...issueForm, dueAt: e.target.value })} />

              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <Button type="submit">Issue Book</Button>
                <Button variant="ghost" type="button" onClick={() => setShowIssueModal(false)}>Cancel</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PortalShell>
  );
}
