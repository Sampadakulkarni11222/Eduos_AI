'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Avatar, Button, Card, EmptyState, Input, Pill, SkeletonRows, useToast } from '@/components/ui';
import { BulkUploadModal } from '@/components/bulk-upload-modal';
import { api } from '@/lib/api';
import type { UserDto, SectionDto } from '@/lib/types';

export default function UsersPage() {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<UserDto[] | null>(null);
  const [sections, setSections] = useState<SectionDto[]>([]);
  const [err, setErr] = useState(false);
  const deb = useRef<ReturnType<typeof setTimeout>>();

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

  const load = useCallback(async (q: string) => {
    setItems(null);
    setErr(false);
    try {
      const r = await api.listUsers(q || undefined);
      setItems(r);
    } catch {
      setErr(true);
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load('');
    api.mySections()
      .then((secs) => {
        setSections(secs);
        if (secs[0]) setSectionId(secs[0].id);
      })
      .catch(() => {});
  }, [load]);

  const onSearch = (q: string) => {
    setSearch(q);
    clearTimeout(deb.current);
    deb.current = setTimeout(() => void load(q.trim()), 300);
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
      await load(search);
    } catch (err: any) {
      toast(err.message || 'Could not create the user.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <PortalShell expectedSlug="admin" topbar={{ title: 'User Management', desc: 'Phone-rooted accounts linked to one or more role profiles.' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ maxWidth: 320, width: '100%', flex: '1 1 220px' }}>
          <Input type="search" value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search by name..." aria-label="Search" />
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
          onImported={(r) => { toast(`Created ${r.imported} of ${r.imported + r.failed} users.`, r.failed > 0 ? 'error' : 'success'); void load(search); }}
        />
      )}

      <Card pad={false}>
        {items === null && !err && <div style={{ padding: 20 }}><SkeletonRows rows={6} /></div>}
        {err && <EmptyState title="Couldn't load users" sub="The server didn't respond. Reload to try again." />}
        {items !== null && !err && items.length === 0 && (
          <EmptyState title={search ? 'No matches' : 'No users yet'} sub={search ? `Nothing matches "${search}".` : 'Users appear here once records are created.'} />
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
      </Card>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Create User Profile</div>
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
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
