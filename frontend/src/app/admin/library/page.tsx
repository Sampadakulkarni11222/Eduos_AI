'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, SkeletonRows, Pill, rupees, useToast } from '@/components/ui';
import { BulkUploadModal } from '@/components/bulk-upload-modal';
import { api, ApiError } from '@/lib/api';
import type { BookDto, BookIssueDto, StudentListItem } from '@/lib/types';

export default function AdminLibrary() {
  const [books, setBooks] = useState<BookDto[] | null>(null);
  const [issued, setIssued] = useState<BookIssueDto[] | null>(null);
  const [students, setStudents] = useState<StudentListItem[] | null>(null);
  const [activeTab, setActiveTab] = useState<'books' | 'issued'>('books');
  const [searchQuery, setSearchQuery] = useState('');
  const toast = useToast();

  // Modals state
  const [showBookModal, setShowBookModal] = useState(false);
  const [newBook, setNewBook] = useState({ title: '', author: '', isbn: '', category: 'GENERAL', totalCopies: 1 });

  const [showIssueModal, setShowIssueModal] = useState(false);
  const [issueForm, setIssueForm] = useState({ studentId: '', bookId: '', dueAt: '' });

  const [showBulkBooks, setShowBulkBooks] = useState(false);
  const [showBulkIssues, setShowBulkIssues] = useState(false);

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
      // DueAt needs to be ISO format
      const dueIso = new Date(issueForm.dueAt).toISOString();
      await api.issueBook({ ...issueForm, dueAt: dueIso });
      setShowIssueModal(false);
      setIssueForm({ studentId: '', bookId: '', dueAt: '' });
      toast('Book issued.');
      loadIssues();
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
      loadBooks();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not return the book.', 'error');
    }
  };

  return (
    <PortalShell expectedSlug="admin" topbar={{ title: 'Library Management', desc: 'Catalog books, track issue records, and compute fines.' }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        <button className={`chip-tab ${activeTab === 'books' ? 'active' : ''}`} onClick={() => setActiveTab('books')}>Catalog</button>
        <button className={`chip-tab ${activeTab === 'issued' ? 'active' : ''}`} onClick={() => setActiveTab('issued')}>Issued Books</button>
      </div>

      {activeTab === 'books' && (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 16, alignItems: 'center', justifyContent: 'space-between' }}>
            <input className="input" style={{ maxWidth: 300 }} placeholder="Search title or author..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="soft" onClick={() => setShowBulkBooks(true)}>Bulk Upload</Button>
              <Button onClick={() => setShowBookModal(true)}>Add Book</Button>
            </div>
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
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <Button variant="soft" onClick={() => setShowBulkIssues(true)}>Bulk Upload</Button>
          </div>
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
                    <td data-label="Returned">{i.returnedAt ? new Date(i.returnedAt).toLocaleDateString('en-IN') : '—'}</td>
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
        </>
      )}

      {/* Add Book Modal */}
      {showBookModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">Add Book to Catalog</div>
              <button className="modal-close" aria-label="Close dialog" title="Close" onClick={() => setShowBookModal(false)}>×</button>
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
              <button className="modal-close" aria-label="Close dialog" title="Close" onClick={() => setShowIssueModal(false)}>×</button>
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

      {showBulkBooks && (
        <BulkUploadModal
          title="Bulk upload books"
          description="Upload a CSV to add many books to the catalog at once."
          templateHeaders={['title', 'author', 'isbn', 'category', 'totalCopies']}
          templateSampleRow={['Introduction to Algorithms', 'Thomas H. Cormen', '9780262033848', 'TEXTBOOK', '3']}
          onSubmit={(file) => api.bulkCreateBooks(file)}
          onClose={() => setShowBulkBooks(false)}
          onImported={(r) => { toast(`Added ${r.imported} of ${r.imported + r.failed} books.`, r.failed > 0 ? 'error' : 'success'); loadBooks(); }}
        />
      )}

      {showBulkIssues && (
        <BulkUploadModal
          title="Bulk issue books"
          description="Upload a CSV to issue many books at once. Books are matched by ISBN."
          templateHeaders={['admissionNo', 'isbn', 'dueAt']}
          templateSampleRow={['ADM-2026-0010', '9780262033848', '2026-08-15']}
          onSubmit={(file) => api.bulkIssueBooks(file)}
          onClose={() => setShowBulkIssues(false)}
          onImported={(r) => { toast(`Issued ${r.imported} of ${r.imported + r.failed} books.`, r.failed > 0 ? 'error' : 'success'); loadIssues(); loadBooks(); }}
        />
      )}
    </PortalShell>
  );
}
