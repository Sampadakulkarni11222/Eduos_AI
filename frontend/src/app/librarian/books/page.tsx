'use client';
import { useEffect, useMemo, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, SkeletonRows, Pill, rupees, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { BookDto, BookIssueDto, StudentListItem } from '@/lib/types';

function getDueStatus(dueAtStr: string, status: string): { label: string; tone: 'green' | 'red' | 'amber' | 'gray'; isOverdue: boolean; daysOverdue: number } {
  if (status === 'RETURNED') return { label: 'Returned', tone: 'green', isOverdue: false, daysOverdue: 0 };
  if (!dueAtStr) return { label: 'Active', tone: 'amber', isOverdue: false, daysOverdue: 0 };
  const due = new Date(dueAtStr);
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

export default function LibrarianBooks() {
  const [books, setBooks] = useState<BookDto[] | null>(null);
  const [issued, setIssued] = useState<BookIssueDto[] | null>(null);
  const [students, setStudents] = useState<StudentListItem[] | null>(null);
  const [activeTab, setActiveTab] = useState<'books' | 'issued'>('books');
  const [searchQuery, setSearchQuery] = useState('');

  // Issued tab search & filter
  const [issuedSearch, setIssuedSearch] = useState('');
  const [issuedFilter, setIssuedFilter] = useState<'ALL' | 'OVERDUE' | 'ACTIVE' | 'RETURNED'>('ALL');
  const [copiedId, setCopiedId] = useState<string | null>(null);

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

  useEffect(() => {
    loadBooks();
  }, [searchQuery]);

  useEffect(() => {
    loadIssues();
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
      toast('Book issued successfully.');
      loadIssues();
      loadBooks();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not issue the book. Check copy availability.', 'error');
    }
  };

  const handleReturnBook = async (issueId: string) => {
    try {
      const res = await api.returnBook(issueId);
      toast(`Book returned. ${res.finePaise > 0 ? `Late fine: ${rupees(res.finePaise)}` : 'No fine.'}`);
      loadIssues();
      loadBooks();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not return the book.', 'error');
    }
  };

  const handleRemindBook = async (issueId: string, studentName: string, bookTitle: string, dueAt: string) => {
    const due = new Date(dueAt).toLocaleDateString('en-IN');
    const msg = `Dear ${studentName}, please return the library book "${bookTitle}" (due on ${due}). Fines may accumulate. — Oakridge Library`;
    try {
      await navigator.clipboard.writeText(msg);
      setCopiedId(issueId);
      toast('Reminder message copied to clipboard!');
      setTimeout(() => setCopiedId(null), 2500);
    } catch {
      toast('Could not copy reminder message.', 'error');
    }
  };

  // Process & filter issued books: calculate due status, search by borrower or title, filter, and sort worst overdue first
  const processedIssued = useMemo(() => {
    if (!issued) return null;

    let list = issued.map((i) => {
      const dueInfo = getDueStatus(i.dueAt, i.status);
      const cleanTitle = (i.bookTitle && i.bookTitle !== 'CPP' && i.bookTitle !== 'Unknown') ? i.bookTitle : 'Untitled Book';
      const cleanStudent = (i.studentName && i.studentName !== 'Unknown') ? i.studentName : 'Student';
      return {
        ...i,
        cleanTitle,
        cleanStudent,
        dueInfo,
      };
    });

    if (issuedFilter === 'OVERDUE') {
      list = list.filter((i) => i.status === 'OVERDUE' || i.dueInfo.isOverdue);
    } else if (issuedFilter === 'ACTIVE') {
      list = list.filter((i) => i.status === 'ACTIVE' && !i.dueInfo.isOverdue && !i.returnedAt);
    } else if (issuedFilter === 'RETURNED') {
      list = list.filter((i) => i.status === 'RETURNED' || Boolean(i.returnedAt));
    }

    if (issuedSearch.trim()) {
      const q = issuedSearch.trim().toLowerCase();
      list = list.filter((i) =>
        i.cleanStudent.toLowerCase().includes(q) || i.cleanTitle.toLowerCase().includes(q)
      );
    }

    // Sort: worst overdue first, then active due soonest, then returned
    return list.sort((a, b) => {
      if (a.dueInfo.isOverdue && b.dueInfo.isOverdue) {
        return b.dueInfo.daysOverdue - a.dueInfo.daysOverdue;
      }
      if (a.dueInfo.isOverdue) return -1;
      if (b.dueInfo.isOverdue) return 1;
      if (a.status !== 'RETURNED' && b.status === 'RETURNED') return -1;
      if (a.status === 'RETURNED' && b.status !== 'RETURNED') return 1;
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    });
  }, [issued, issuedSearch, issuedFilter]);

  return (
    <PortalShell expectedSlug="librarian" topbar={{ title: 'Catalog & Lending', desc: 'Manage library catalog and student check-out records.' }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        <button className={`chip-tab ${activeTab === 'books' ? 'active' : ''}`} onClick={() => setActiveTab('books')}>Catalog</button>
        <button className={`chip-tab ${activeTab === 'issued' ? 'active' : ''}`} onClick={() => setActiveTab('issued')}>Issued Books</button>
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
                      <td style={{ fontFamily: 'monospace' }} data-label="ISBN">{b.isbn ?? '—'}</td>
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
        <>
          {/* Search & Filter Bar */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 320 }}>
              <svg style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', opacity: 0.4, pointerEvents: 'none' }}
                width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                className="input"
                style={{ paddingLeft: 30 }}
                placeholder="Search borrower or title…"
                value={issuedSearch}
                onChange={(e) => setIssuedSearch(e.target.value)}
              />
            </div>
            <select
              className="field-input"
              style={{ width: 'auto', minWidth: 140 }}
              value={issuedFilter}
              onChange={(e) => setIssuedFilter(e.target.value as any)}
              aria-label="Filter status"
            >
              <option value="ALL">All Statuses</option>
              <option value="OVERDUE">Overdue Only</option>
              <option value="ACTIVE">Active (On Time)</option>
              <option value="RETURNED">Returned</option>
            </select>
          </div>

          <Card pad={false}>
            {processedIssued === null && <div style={{ padding: 20 }}><SkeletonRows rows={4} /></div>}
            {processedIssued !== null && processedIssued.length === 0 && (
              <EmptyState title="No matching records" sub="No lending records match your criteria." />
            )}
            {processedIssued && processedIssued.length > 0 && (
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
                  {processedIssued.map((i) => (
                    <tr key={i.id}>
                      <td className="cell-primary" data-label="Book Title">{i.cleanTitle}</td>
                      <td data-label="Student Name">{i.cleanStudent}</td>
                      <td data-label="Issued Date">{new Date(i.issuedAt).toLocaleDateString('en-IN')}</td>
                      <td data-label="Due Date">{new Date(i.dueAt).toLocaleDateString('en-IN')}</td>
                      <td data-label="Returned">{i.returnedAt ? new Date(i.returnedAt).toLocaleDateString('en-IN') : '—'}</td>
                      <td data-label="Status">
                        <Pill tone={i.dueInfo.tone}>
                          {i.dueInfo.label}
                        </Pill>
                      </td>
                      <td data-label="Action">
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          {!i.returnedAt && (
                            <>
                              <Button variant="ghost" small onClick={() => handleReturnBook(i.id)}>Return</Button>
                              <Button
                                variant="ghost"
                                small
                                onClick={() => handleRemindBook(i.id, i.cleanStudent, i.cleanTitle, i.dueAt)}
                                style={{ fontSize: 11.5 }}
                                title="Copy return reminder message"
                              >
                                {copiedId === i.id ? '✓ Copied' : 'Remind'}
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}

      {/* Add Book Modal */}
      {showBookModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Add Book to Catalog</div>
              <button className="modal-close" onClick={() => setShowBookModal(false)}>×</button>
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
              <button className="modal-close" onClick={() => setShowIssueModal(false)}>×</button>
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
