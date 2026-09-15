'use client';
import { useEffect, useMemo, useState } from 'react';
import { PortalShell } from '@/components/shell';
import {
  Button, Card, DateRangeFilter, EmptyState, FilterBar, Pill, SearchInput, Select,
  SkeletonRows, matchesSearch, rupees, withinDateRange, useToast,
} from '@/components/ui';
import { api } from '@/lib/api';
import type { BookDto, BookFacetsDto, BookIssueDto, BookRequestDto, RequestStatus } from '@/lib/types';

type ResourceFilter = '' | 'PHYSICAL' | 'DIGITAL';

const RESOURCE_OPTIONS = [
  { value: 'PHYSICAL', label: 'Physical books' },
  { value: 'DIGITAL', label: 'Digital resources' },
];

const REQUEST_TONE: Record<RequestStatus, 'amber' | 'green' | 'red' | 'gray'> = {
  PENDING: 'amber',
  APPROVED: 'green',
  REJECTED: 'red',
  CANCELLED: 'gray',
};

/** How far ahead "Due soon" looks. */
const DUE_SOON_DAYS = 7;

/**
 * An active loan whose due date falls between today and a week out.
 *
 * Anything already past its date is OVERDUE and belongs under that option
 * instead, so the window starts at today rather than at the epoch.
 */
function isDueSoon(issue: BookIssueDto): boolean {
  if (issue.status !== 'ACTIVE' || !issue.dueAt) return false;
  const due = new Date(issue.dueAt);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const limit = new Date(today);
  limit.setDate(limit.getDate() + DUE_SOON_DAYS);
  limit.setHours(23, 59, 59, 999);
  return due >= today && due <= limit;
}

/**
 * The student's library: what they currently have out, and the catalogue.
 *
 * Both halves filter on fields that exist on the records themselves — the
 * borrowing list on due date and resource type, the catalogue on category,
 * author and resource type. Nothing is invented to fill a filter: the pickers
 * are populated from the catalogue's own distinct values, so an option is only
 * offered when something is behind it.
 *
 * Which loans appear is decided by the server, not here: a student's
 * `library.read` is OWN-scoped and the lending endpoint narrows to their own
 * records, so this page cannot show someone else's borrowing whatever it asks
 * for.
 */
export default function StudentLibrary() {
  const [issued, setIssued] = useState<BookIssueDto[] | null>(null);
  const [requests, setRequests] = useState<BookRequestDto[]>([]);
  const [requesting, setRequesting] = useState<string | null>(null);
  const toast = useToast();
  const [books, setBooks] = useState<BookDto[] | null>(null);
  const [facets, setFacets] = useState<BookFacetsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [booksLoading, setBooksLoading] = useState(false);

  /**
   * The live status of this student's own request for a book, if any.
   *
   * Newest first, so a fresh request after a rejection supersedes the old one
   * — the same rule the server applies with its partial unique index.
   */
  function requestFor(bookId: string): BookRequestDto | null {
    return requests.find((r) => r.bookId === bookId) ?? null;
  }

  async function askFor(book: BookDto) {
    setRequesting(book.id);
    try {
      const created = await api.requestBook(book.id);
      // Prepended, so requestFor() finds this one ahead of any older row.
      setRequests((prev) => [created, ...prev]);
      toast(`Your request for "${book.title}" has been sent to the librarian.`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not send that request', 'error');
    } finally {
      setRequesting(null);
    }
  }

  // Catalogue filters — applied by the server.
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [author, setAuthor] = useState('');
  const [resourceType, setResourceType] = useState<ResourceFilter>('');
  const [availableOnly, setAvailableOnly] = useState('');

  // My-books filters — applied here, over a list that is already small.
  const [dueRange, setDueRange] = useState({ from: '', to: '' });
  const [issueStatus, setIssueStatus] = useState('');
  const [issueSearch, setIssueSearch] = useState('');

  useEffect(() => {
    Promise.allSettled([
      api.listIssued(),
      api.bookFacets(),
      api.myBookRequests(),
    ]).then(([iss, fac, reqs]) => {
      setIssued(iss.status === 'fulfilled' ? iss.value : []);
      setFacets(fac.status === 'fulfilled' ? fac.value : null);
      setRequests(reqs.status === 'fulfilled' ? reqs.value : []);
      setLoading(false);
    });
  }, []);

  // Debounced so typing in the catalogue box does not fire a request per
  // keystroke, while still feeling live.
  useEffect(() => {
    setBooksLoading(true);
    const handle = setTimeout(() => {
      api.listBooks({
        search: search || undefined,
        category: category || undefined,
        author: author || undefined,
        resourceType: resourceType || undefined,
        availability: availableOnly === 'AVAILABLE' ? 'AVAILABLE' : undefined,
      })
        .then(setBooks)
        .catch(() => setBooks([]))
        .finally(() => setBooksLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [search, category, author, resourceType, availableOnly]);

  const filteredIssues = useMemo(() => (issued ?? []).filter((i) => {
    // Filtered on the due date — this list is "books that are due", so that is
    // the date a range is about.
    if (!withinDateRange(i.dueAt, dueRange.from, dueRange.to)) return false;
    // "Due soon" is not a stored status: it is an active loan whose due date
    // is inside the next week, which is the thing a student actually scans
    // this list for. Everything else matches the stored status directly.
    if (issueStatus === 'DUE_SOON') {
      if (!isDueSoon(i)) return false;
    } else if (issueStatus && i.status !== issueStatus) return false;
    // Resource type and the date range work together, on the same list.
    if (resourceType === 'DIGITAL' && i.resourceType !== 'DIGITAL') return false;
    if (resourceType === 'PHYSICAL' && i.resourceType === 'DIGITAL') return false;
    return matchesSearch(issueSearch, [i.bookTitle, i.bookAuthor, i.category, i.status]);
  }), [issued, dueRange, issueStatus, issueSearch, resourceType]);

  const hasCatalogFilters = Boolean(search || category || author || resourceType || availableOnly);
  const hasIssueFilters = Boolean(dueRange.from || dueRange.to || issueStatus || issueSearch);

  return (
    <PortalShell
      expectedSlug="student"
      topbar={{ title: 'My Library', desc: 'Your borrowed books, due dates, and the school catalogue.' }}
    >
      <Card pad={false} style={{ marginBottom: 16 }}>
        <div style={{ padding: '16px 20px 0' }}>
          <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>My checked-out books</strong>
          <p style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2, marginBottom: 12 }}>
            Filter by due date to see what is coming back when.
          </p>
          <FilterBar
            actions={hasIssueFilters
              ? (
                <Button
                  variant="ghost"
                  small
                  onClick={() => { setDueRange({ from: '', to: '' }); setIssueStatus(''); setIssueSearch(''); }}
                >
                  Clear
                </Button>
              )
              : undefined}
          >
            <SearchInput
              label="Search my books"
              value={issueSearch}
              onChange={setIssueSearch}
              placeholder="Title, author, category…"
            />
            <Select
              label="Status"
              value={issueStatus}
              placeholder="All statuses"
              onChange={setIssueStatus}
              options={[
                { value: 'DUE_SOON', label: 'Due soon' },
                { value: 'OVERDUE', label: 'Overdue' },
                { value: 'RETURNED', label: 'Returned' },
              ]}
            />
            <DateRangeFilter label="Due date" from={dueRange.from} to={dueRange.to} onChange={setDueRange} />
          </FilterBar>
        </div>

        {loading && <div style={{ padding: 20 }}><SkeletonRows rows={3} /></div>}

        {!loading && issued && issued.length === 0 && (
          <EmptyState title="No books borrowed" sub="Books you borrow from the library will appear here with their due dates." />
        )}

        {!loading && issued && issued.length > 0 && filteredIssues.length === 0 && (
          <p style={{ fontSize: 12.5, color: 'var(--text-2b)', padding: '4px 20px 20px' }}>
            None of your books match these filters.
          </p>
        )}

        {!loading && filteredIssues.length > 0 && (
          <table className="data-table data-table-cards">
            <thead>
              <tr><th>Title</th><th>Type</th><th>Issued</th><th>Due date</th><th>Fine</th><th>Status</th></tr>
            </thead>
            <tbody>
              {filteredIssues.map((i) => (
                <tr key={i.id}>
                  <td className="cell-primary" data-label="Title">
                    {i.bookTitle}
                    {i.bookAuthor && <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{i.bookAuthor}</div>}
                  </td>
                  <td data-label="Type">
                    {i.resourceType === 'DIGITAL'
                      ? <Pill tone="blue">Digital</Pill>
                      : <Pill tone="gray">Physical</Pill>}
                  </td>
                  <td data-label="Issued">{i.issuedAt ? new Date(i.issuedAt).toLocaleDateString('en-IN') : '—'}</td>
                  <td data-label="Due date">{new Date(i.dueAt).toLocaleDateString('en-IN')}</td>
                  <td data-label="Fine">{i.finePaise > 0 ? rupees(i.finePaise) : '—'}</td>
                  <td data-label="Status">
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

      {/* What was asked for and what came back. Decided rows matter most:
          an approval shows up in the loans table above, but a rejection and
          its reason would otherwise be invisible. */}
      {!loading && requests.length > 0 && (
        <Card style={{ marginBottom: 16 }}>
          <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>My requests</strong>
          <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
            {requests.map((r) => (
              <div
                key={r.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 12, flexWrap: 'wrap',
                }}
              >
                <div>
                  <div style={{ fontSize: 13.5, color: 'var(--text-1)', fontWeight: 600 }}>{r.bookTitle}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>
                    Asked {new Date(r.requestedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    {r.decisionNote && <> · {r.decisionNote}</>}
                  </div>
                </div>
                <Pill tone={REQUEST_TONE[r.status]}>{r.status.toLowerCase()}</Pill>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card pad={false}>
        <div style={{ padding: '16px 20px 0' }}>
          <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Library catalogue</strong>
          <p style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2, marginBottom: 12 }}>
            Search across titles, authors, ISBNs, categories and publishers, or narrow with the filters.
          </p>
          <FilterBar
            actions={hasCatalogFilters
              ? (
                <Button
                  variant="ghost"
                  small
                  onClick={() => { setSearch(''); setCategory(''); setAuthor(''); setResourceType(''); setAvailableOnly(''); }}
                >
                  Clear
                </Button>
              )
              : undefined}
          >
            <SearchInput
              label="Search catalogue"
              value={search}
              onChange={setSearch}
              placeholder="Title, author, ISBN…"
            />
            <Select
              label="Resource type"
              value={resourceType}
              placeholder="All resources"
              onChange={(v) => setResourceType(v as ResourceFilter)}
              options={RESOURCE_OPTIONS}
            />
            <Select
              label="Category"
              value={category}
              placeholder="All categories"
              onChange={setCategory}
              options={(facets?.categories ?? []).map((c) => ({ value: c, label: c }))}
            />
            <Select
              label="Author"
              value={author}
              placeholder="All authors"
              onChange={setAuthor}
              options={(facets?.authors ?? []).map((a) => ({ value: a, label: a }))}
            />
            <Select
              label="Availability"
              value={availableOnly}
              placeholder="Any availability"
              onChange={setAvailableOnly}
              options={[{ value: 'AVAILABLE', label: 'Available now' }]}
            />
          </FilterBar>
        </div>

        {booksLoading && <div style={{ padding: 20 }}><SkeletonRows rows={3} /></div>}

        {!booksLoading && books && books.length === 0 && (
          <EmptyState title="No books matched" sub="Try a different search, or clear the filters." />
        )}

        {!booksLoading && books && books.length > 0 && (
          <table className="data-table data-table-cards">
            <thead>
              <tr><th>Title</th><th>Category</th><th>Type</th><th>Availability</th></tr>
            </thead>
            <tbody>
              {books.map((b) => (
                <tr key={b.id}>
                  <td className="cell-primary" data-label="Title">
                    {b.title}
                    <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
                      {b.author}{b.publishedYear ? ` · ${b.publishedYear}` : ''}
                    </div>
                  </td>
                  <td data-label="Category">{b.category || '—'}</td>
                  <td data-label="Type">
                    {b.resourceType === 'DIGITAL'
                      ? <Pill tone="blue">Digital</Pill>
                      : <Pill tone="gray">Physical</Pill>}
                  </td>
                  <td data-label="Availability">
                    {b.resourceType === 'DIGITAL' ? (
                      b.resourceUrl
                        ? <a href={b.resourceUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 12.5 }}>Open resource</a>
                        : <Pill tone="blue">Online</Pill>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Pill tone={b.availableCopies > 0 ? 'green' : 'red'}>
                          {b.availableCopies > 0 ? `${b.availableCopies} available` : 'All out'}
                        </Pill>
                        {(() => {
                          const mine = requestFor(b.id);
                          // A request already waiting or granted is shown as
                          // it stands; asking twice for the same book is
                          // refused by the server anyway.
                          if (mine && (mine.status === 'PENDING' || mine.status === 'APPROVED')) {
                            return <Pill tone={REQUEST_TONE[mine.status]}>{mine.status === 'PENDING' ? 'requested' : 'issued to you'}</Pill>;
                          }
                          return (
                            <Button
                              onClick={() => void askFor(b)}
                              disabled={requesting === b.id || b.availableCopies < 1}
                              title={b.availableCopies < 1 ? 'No copies are free at the moment' : undefined}
                            >
                              {requesting === b.id ? 'Asking…' : 'Request'}
                            </Button>
                          );
                        })()}
                      </div>
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
