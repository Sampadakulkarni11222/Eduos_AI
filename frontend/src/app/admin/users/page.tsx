'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Avatar, Button, Card, EmptyState, Input, Pill, SkeletonRows, useToast } from '@/components/ui';
import { BulkUploadModal } from '@/components/bulk-upload-modal';
import { Pagination } from '@/components/pagination';
import { api } from '@/lib/api';
import type { UserDto, SectionDto, RoleKey } from '@/lib/types';

const ROLE_KEYS: RoleKey[] = ['OWNER', 'ADMIN', 'PRINCIPAL', 'TEACHER', 'PARENT', 'STUDENT', 'FINANCE', 'LIBRARIAN', 'WARDEN'];
const PAGE_SIZES = [10, 25, 50, 100];

export default function UsersPage() {
  const [search, setSearch] = useState('');
  /** Debounced copy of `search` — this is what actually goes to the server. */
  const [appliedSearch, setAppliedSearch] = useState('');
  const [items, setItems] = useState<UserDto[] | null>(null);
  const [sections, setSections] = useState<SectionDto[]>([]);
  /** All sections in the school — the class filter must reach every class, not just the ones this admin teaches. */
  const [allSections, setAllSections] = useState<SectionDto[]>([]);
  const [err, setErr] = useState(false);
  const deb = useRef<ReturnType<typeof setTimeout>>();

  // Filters + paging (all applied server-side)
  const [roleFilter, setRoleFilter] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [busyList, setBusyList] = useState(false);

  // Create User Modal states
  const [showModal, setShowModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [roleKey, setRoleKey] = useState<'STUDENT' | 'TEACHER'>('STUDENT');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [admissionNo, setAdmissionNo] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  /**
   * Search, role and class all narrow the query on the server, so the filters
   * apply to the whole dataset rather than to whichever page is on screen.
   */
  const load = useCallback(async () => {
    setItems(null);
    setErr(false);
    setBusyList(true);
    try {
      const r = await api.listUsersPage({
        search: appliedSearch || undefined,
        roleKey: roleFilter || undefined,
        sectionId: classFilter || undefined,
        page,
        pageSize,
      });
      setItems(r.items);
      setTotal(r.total);
      setTotalPages(r.totalPages);
      if (r.page !== page) setPage(r.page);
    } catch {
      setErr(true);
      setItems([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      setBusyList(false);
    }
  }, [appliedSearch, roleFilter, classFilter, page, pageSize]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    api.mySections()
      .then((secs) => {
        setSections(secs);
        if (secs[0]) setSectionId(secs[0].id);
      })
      .catch(() => {});
    api.allSections().then(setAllSections).catch(() => setAllSections([]));
  }, []);

  const onSearch = (q: string) => {
    setSearch(q);
    clearTimeout(deb.current);
    deb.current = setTimeout(() => {
      setPage(1);                 // a new search always restarts at page 1
      setAppliedSearch(q.trim());
    }, 300);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName || !phone) return;
    setBusy(true);
    try {
      await api.createUser({
        roleKey,
        displayName,
        phone,
        email: email || undefined,
        password: password || undefined,
        admissionNo: roleKey === 'STUDENT' ? admissionNo || undefined : undefined,
        sectionId: roleKey === 'STUDENT' ? sectionId || undefined : undefined,
      });
      setShowModal(false);
      // Reset form
      setDisplayName('');
      setPhone('');
      setEmail('');
      setPassword('');
      setAdmissionNo('');
      if (sections[0]) setSectionId(sections[0].id);
      await load();
    } catch (err: any) {
      toast(err.message || 'Could not create the user.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <PortalShell expectedSlug="admin" topbar={{ title: 'User Management', desc: 'Phone-rooted accounts linked to one or more role profiles.' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', flex: '1 1 420px' }}>
          <div style={{ maxWidth: 280, width: '100%', flex: '1 1 200px' }}>
            <Input type="search" value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search by name, phone or email..." aria-label="Search" />
          </div>
          <select
            className="field-input"
            style={{ marginBottom: 0, width: 'auto', minWidth: 150 }}
            value={roleFilter}
            onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
            aria-label="Filter by role"
          >
            <option value="">All roles</option>
            {ROLE_KEYS.map((r) => <option key={r} value={r}>{r.charAt(0) + r.slice(1).toLowerCase()}</option>)}
          </select>
          <select
            className="field-input"
            style={{ marginBottom: 0, width: 'auto', minWidth: 170 }}
            value={classFilter}
            onChange={(e) => { setClassFilter(e.target.value); setPage(1); }}
            aria-label="Filter by class"
            disabled={allSections.length === 0}
          >
            <option value="">All classes</option>
            {allSections.map((s) => (
              <option key={s.id} value={s.id}>{s.gradeName ? `${s.gradeName} – ${s.name}` : s.name}</option>
            ))}
          </select>
          {(roleFilter || classFilter || search) && (
            <Button
              variant="soft"
              small
              onClick={() => {
                setRoleFilter(''); setClassFilter('');
                setSearch(''); setAppliedSearch('');
                setPage(1);
              }}
            >
              Clear
            </Button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="soft" onClick={() => setShowBulkModal(true)}>Bulk Upload</Button>
          <Button onClick={() => setShowModal(true)}>Add User</Button>
        </div>
      </div>

      {showBulkModal && (
        <BulkUploadModal
          title="Bulk create users"
          description="Upload a CSV to create many users at once. Student rows may include gradeName + sectionName to assign a class immediately."
          templateHeaders={['roleKey', 'displayName', 'phone', 'email', 'password', 'admissionNo', 'gradeName', 'sectionName']}
          templateSampleRow={['STUDENT', 'Diya Tharian', '+919555000111', 'diya@example.com', '', 'CA-2026-005', 'Grade 5', 'A']}
          onSubmit={(file) => api.bulkCreateUsers(file)}
          onClose={() => setShowBulkModal(false)}
          onImported={(r) => { toast(`Created ${r.imported} of ${r.imported + r.failed} users.`, r.failed > 0 ? 'error' : 'success'); void load(); }}
        />
      )}

      <Card pad={false}>
        {items === null && !err && <div style={{ padding: 20 }}><SkeletonRows rows={6} /></div>}
        {err && <EmptyState title="Couldn't load users" sub="The server didn't respond. Reload to try again." />}
        {items !== null && !err && items.length === 0 && (
          appliedSearch || roleFilter || classFilter
            ? <EmptyState title="No matches" sub="No users match the current search and filters." />
            : <EmptyState title="No users yet" sub="Users appear here once records are created." />
        )}
        {items && items.length > 0 && (
          <table className="data-table data-table-cards">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Phone / Email</th>
                <th>Class Details</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id}>
                  <td data-label="Name">
                    <span className="row-flex">
                      <Avatar name={u.displayName} />
                      <span className="cell-primary">{u.displayName}</span>
                    </span>
                  </td>
                  <td data-label="Role">
                    <Pill tone={u.roleKey === 'ADMIN' ? 'red' : u.roleKey === 'TEACHER' ? 'blue' : u.roleKey === 'STUDENT' ? 'green' : 'gray'}>
                      {u.roleKey}
                    </Pill>
                  </td>
                  <td data-label="Phone / Email">
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{u.phone}</div>
                    {u.email && <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{u.email}</div>}
                  </td>
                  <td data-label="Class Details">
                    {u.roleKey === 'STUDENT' && u.studentDetails ? (
                      <div>
                        <div style={{ fontWeight: 600 }}>{u.studentDetails.class || 'No Class'}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                          Adm: {u.studentDetails.admissionNo} {u.studentDetails.rollNo ? `· Roll: ${u.studentDetails.rollNo}` : ''}
                        </div>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-faint)' }}>—</span>
                    )}
                  </td>
                  <td data-label="Status">
                    <Pill tone="green">Active</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {items && items.length > 0 && (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            totalPages={totalPages}
            pageSizes={PAGE_SIZES}
            busy={busyList}
            label="users"
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          />
        )}
      </Card>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Create User Profile</div>
              <button className="modal-close" aria-label="Close dialog" title="Close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="field-label">Select Role *</div>
              <select className="field-input" value={roleKey} onChange={(e) => setRoleKey(e.target.value as any)}>
                <option value="STUDENT">Student</option>
                <option value="TEACHER">Teacher</option>
              </select>

              <div className="field-label">Full Name *</div>
              <input className="field-input" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Diya Tharian" />

              <div className="field-label">Phone (E.164 format) *</div>
              <input className="field-input" required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. +919555000111" />

              <div className="field-label">Email (Optional)</div>
              <input className="field-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e.g. diya@example.com" />

              <div className="field-label">Password (Optional)</div>
              <input className="field-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Minimum 6 characters" />

              {roleKey === 'STUDENT' && (
                <>
                  <div className="field-label">Admission Number (Optional)</div>
                  <input className="field-input" value={admissionNo} onChange={(e) => setAdmissionNo(e.target.value)} placeholder="e.g. CA-2026-005" />

                  <div className="field-label">Assign Class / Section (Optional)</div>
                  <select className="field-input" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
                    <option value="">-- Choose Class --</option>
                    {sections.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.gradeName ? `${s.gradeName} – ${s.name}` : s.name}
                      </option>
                    ))}
                  </select>
                </>
              )}

              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create User'}</Button>
                <Button variant="ghost" type="button" onClick={() => setShowModal(false)}>Cancel</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PortalShell>
  );
}
