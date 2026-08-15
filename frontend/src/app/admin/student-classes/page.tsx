'use client';
import { FormEvent, useEffect, useState, useCallback, useRef } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, EmptyState, Pill, SkeletonRows, Modal as Dialog } from '@/components/ui';
import { BulkUploadModal } from '@/components/bulk-upload-modal';
import { Pagination } from '@/components/pagination';
import { api } from '@/lib/api';
import type { StudentListItem, SectionDto } from '@/lib/types';

/* ─── simple toast ─────────────────────────────────────────── */
function Toast({ msg, ok }: { msg: string; ok: boolean }) {
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      background: ok ? '#1a7f4b' : '#b52a2a',
      color: '#fff', borderRadius: 10, padding: '12px 20px',
      fontSize: 14, fontWeight: 500, boxShadow: '0 4px 20px rgba(0,0,0,.25)',
      maxWidth: 340,
    }}>
      {msg}
    </div>
  );
}

/* ─── modal overlay ──────────────────────────────────────────── */
function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.45)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460 }}>
        {children}
      </div>
    </div>
  );
}

/* ─── assign section modal ───────────────────────────────────── */
function AssignSectionModal({
  student,
  onClose,
  onSuccess,
}: {
  student: StudentListItem;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const [sections, setSections] = useState<SectionDto[] | null>(null);
  const [years, setYears] = useState<{ id: string; name: string; isCurrent?: boolean }[]>([]);
  const [sectionId, setSectionId] = useState('');
  const [yearId, setYearId] = useState('');
  const [rollNo, setRollNo] = useState('');
  const [suggestedRollNo, setSuggestedRollNo] = useState<number | null>(null);
  const [fetchingRollNo, setFetchingRollNo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.allSections(), api.allAcademicYears()])
      .then(([secs, yrs]) => {
        setSections(secs);
        setYears(yrs);
        if (student.enrollment?.sectionId) {
          setSectionId(student.enrollment.sectionId);
        }
        if (student.enrollment?.academicYearId) {
          setYearId(student.enrollment.academicYearId);
        } else {
          const current = yrs.find((y) => y.isCurrent);
          if (current) setYearId(current.id);
        }
        if (student.enrollment?.rollNo != null) {
          setRollNo(String(student.enrollment.rollNo));
        }
      })
      .catch(() => { setSections([]); setYears([]); });
  }, [student]);

  // Auto-fetch next roll no whenever section + year are both chosen
  useEffect(() => {
    if (!sectionId || !yearId) {
      setSuggestedRollNo(null);
      return;
    }
    if (student.enrollment?.sectionId === sectionId && student.enrollment?.academicYearId === yearId && student.enrollment?.rollNo != null) {
      setSuggestedRollNo(student.enrollment.rollNo);
      setRollNo(String(student.enrollment.rollNo));
      return;
    }
    setFetchingRollNo(true);
    api.nextRollNo(sectionId, yearId)
      .then((r) => {
        setSuggestedRollNo(r.nextRollNo);
        setRollNo(String(r.nextRollNo));  // pre-fill the field
      })
      .catch(() => setSuggestedRollNo(null))
      .finally(() => setFetchingRollNo(false));
  }, [sectionId, yearId, student]);

  const submit = async () => {
    if (!sectionId) return setError('Please select a section.');
    if (!yearId) return setError('Please select an academic year.');
    setBusy(true);
    setError(null);
    try {
      await api.assignSection({
        studentId: student.id,
        sectionId,
        academicYearId: yearId,
        rollNo: rollNo.trim() || undefined,
      });
      onSuccess(`${student.name} assigned successfully!`);
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to assign section. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ padding: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <div style={{ fontFamily: 'Newsreader, serif', fontSize: 18, fontWeight: 700 }}>
            Assign Section
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-faint)', marginTop: 2 }}>
            Student: <strong>{student.name}</strong> · {student.admissionNo ?? '—'}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-faint)', lineHeight: 1 }}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {sections === null ? (
        <SkeletonRows rows={3} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Section dropdown */}
          <div>
            <div className="field-label">Section *</div>
            <select
              className="field-input"
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="">— select a section —</option>
              {sections.map((sec) => (
                <option key={sec.id} value={sec.id}>
                  {sec.gradeName ? `${sec.gradeName} – ${sec.name}` : sec.name}
                  {sec.classTeacher ? ` (${sec.classTeacher})` : ''}
                </option>
              ))}
            </select>
            {sections.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }}>
                No sections found. Please create sections first under Academic Setup.
              </p>
            )}
          </div>

          {/* Academic year dropdown */}
          <div>
            <div className="field-label">Academic Year *</div>
            <select
              className="field-input"
              value={yearId}
              onChange={(e) => setYearId(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="">— select a year —</option>
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}{y.isCurrent ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Roll number */}
          <div>
            <div className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Roll No (optional)
              {fetchingRollNo && (
                <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>fetching…</span>
              )}
              {suggestedRollNo !== null && !fetchingRollNo && (
                <span style={{ fontSize: 11, color: 'var(--green, #1a7f4b)', fontWeight: 500 }}>
                  ✓ Suggested: {suggestedRollNo}
                </span>
              )}
            </div>
            <input
              className="field-input"
              type="number"
              min="1"
              placeholder="e.g. 12"
              value={rollNo}
              onChange={(e) => setRollNo(e.target.value)}
              style={{ width: '100%' }}
            />
            {suggestedRollNo !== null && (
              <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 3 }}>
                Auto-filled with the next available roll no. You can change it.
              </p>
            )}
          </div>

          {error && (
            <p style={{ color: 'var(--red, #b52a2a)', fontSize: 13, margin: 0 }}>⚠ {error}</p>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <Button variant="soft" onClick={onClose} disabled={busy} style={{ flex: 1 }}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy || !sectionId || !yearId} style={{ flex: 1 }}>
              {busy ? 'Assigning…' : 'Assign Section'}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ─── bulk assign modal ──────────────────────────────────────── */
function BulkAssignModal({ onClose, onImported }: { onClose: () => void; onImported: (msg: string) => void }) {
  const [sections, setSections] = useState<SectionDto[] | null>(null);
  const [years, setYears] = useState<{ id: string; name: string; isCurrent?: boolean }[]>([]);
  const [sectionId, setSectionId] = useState('');
  const [yearId, setYearId] = useState('');

  useEffect(() => {
    Promise.all([api.allSections(), api.allAcademicYears()])
      .then(([secs, yrs]) => {
        setSections(secs);
        setYears(yrs);
        const current = yrs.find((y) => y.isCurrent);
        if (current) setYearId(current.id);
      })
      .catch(() => { setSections([]); setYears([]); });
  }, []);

  return (
    <BulkUploadModal
      title="Bulk assign students to a class"
      description="Upload a CSV of admission numbers (with an optional roll no) to enroll many students into the section and year selected below in one go."
      templateHeaders={['admissionNo', 'rollNo']}
      templateSampleRow={['ADM-2026-0010', '12']}
      canSubmit={!!sectionId && !!yearId}
      extraFields={
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div>
            <div className="field-label">Section *</div>
            <select className="field-input" value={sectionId} onChange={(e) => setSectionId(e.target.value)} style={{ width: '100%' }}>
              <option value="">— select —</option>
              {(sections ?? []).map((sec) => (
                <option key={sec.id} value={sec.id}>
                  {sec.gradeName ? `${sec.gradeName} – ${sec.name}` : sec.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="field-label">Academic Year *</div>
            <select className="field-input" value={yearId} onChange={(e) => setYearId(e.target.value)} style={{ width: '100%' }}>
              <option value="">— select —</option>
              {years.map((y) => (
                <option key={y.id} value={y.id}>{y.name}{y.isCurrent ? ' (current)' : ''}</option>
              ))}
            </select>
          </div>
        </div>
      }
      onSubmit={(file) => api.bulkAssignSection(file, sectionId, yearId)}
      onClose={onClose}
      onImported={(r) => onImported(`Assigned ${r.imported} student${r.imported === 1 ? '' : 's'} to the class.`)}
    />
  );
}

/* ─── main page ──────────────────────────────────────────────── */
const PAGE_SIZES = [10, 25, 50, 100];

export default function AdminStudentClasses() {
  const [students, setStudents] = useState<StudentListItem[] | null>(null);
  const [search, setSearch] = useState('');
  /** Search text actually sent to the server — debounced so typing doesn't fire a request per keystroke. */
  const [appliedSearch, setAppliedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [assignTarget, setAssignTarget] = useState<StudentListItem | null>(null);
  const [showBulkAssign, setShowBulkAssign] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string, ok = true) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, ok });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

  // The list is paginated on the server, so search runs there too — filtering
  // the current page in the browser would only ever search 25 of the students.
  const load = useCallback(() => {
    setRefreshing(true);
    api.studentsPage({ search: appliedSearch || undefined, page, pageSize })
      .then((r) => {
        setStudents(r.items);
        setTotal(r.total);
        setTotalPages(r.totalPages);
        // A page can disappear under you when a filter narrows the result set.
        if (r.page !== page) setPage(r.page);
      })
      .catch(() => { setStudents([]); setTotal(0); setTotalPages(1); })
      .finally(() => setRefreshing(false));
  }, [appliedSearch, page, pageSize]);

  useEffect(() => { load(); }, [load]);

  const onSearch = (q: string) => {
    setSearch(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setPage(1);          // a new search always starts at the first page
      setAppliedSearch(q.trim());
    }, 300);
  };

  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const rows = students ?? [];

  return (
    <PortalShell expectedSlug="admin" topbar={{
      title: 'Student Class Assignments',
      desc: 'View all students and their current class enrollments.',
      actions: (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="soft" onClick={load} disabled={refreshing}>
            {refreshing ? '↻ Refreshing…' : '↻ Refresh'}
          </Button>
          <Button variant="soft" onClick={() => setShowBulkAssign(true)}>⇧ Bulk assign</Button>
          <Button onClick={() => setShowAdd(true)}>+ Add Student</Button>
        </div>
      ),
    }}>
      {showAdd && (
        <AddStudentModal
          onClose={() => setShowAdd(false)}
          onDone={(msg) => { setShowAdd(false); showToast(msg, true); load(); }}
        />
      )}

      {showBulkAssign && (
        <BulkAssignModal
          onClose={() => setShowBulkAssign(false)}
          onImported={(msg) => { showToast(msg, true); load(); }}
        />
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14, alignItems: 'center' }}>
        <input
          className="input"
          type="search"
          placeholder="Search by name, admission no or class…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          aria-label="Search students"
          style={{ maxWidth: 320, width: '100%', flex: '1 1 200px' }}
        />
        {students && (
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
            {total} student{total !== 1 ? 's' : ''} {appliedSearch ? 'matched' : 'total'}
          </span>
        )}
      </div>

      {students === null && <Card><SkeletonRows rows={8} /></Card>}
      {students !== null && rows.length === 0 && (
        appliedSearch
          ? <EmptyState title="No match" sub={`No students match "${appliedSearch}".`} />
          : <EmptyState
              title="No students"
              sub="No students have been added to the system yet. Add one manually or enroll a lead from Admissions CRM."
            />
      )}

      {rows.length > 0 && (
        <Card pad={false}>
          <table className="data-table data-table-cards">
            <thead>
              <tr>
                <th>Student</th>
                <th>Roll No</th>
                <th>Class / Section</th>
                <th>Admission No</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className="cell-primary" data-label="Student">{s.name}</td>
                  <td style={{ color: 'var(--text-faint)' }} data-label="Roll No">{s.enrollment?.rollNo ?? '—'}</td>
                  <td data-label="Class / Section">
                    {s.enrollment?.class ?? (
                      <span style={{ color: 'var(--amber, #b08020)', fontSize: 12, fontWeight: 500 }}>
                        Awaiting class assignment
                      </span>
                    )}
                  </td>
                  <td style={{ color: 'var(--text-faint)', fontSize: 12 }} data-label="Admission No">{s.admissionNo ?? '—'}</td>
                  <td data-label="Status">
                    <Pill tone={s.enrollment ? 'green' : 'amber'}>
                      {s.enrollment ? 'enrolled' : 'admitted'}
                    </Pill>
                  </td>
                  <td data-label="Action">
                    <Button
                      variant="soft"
                      onClick={() => setAssignTarget(s)}
                      style={{ fontSize: 12, padding: '4px 12px' }}
                    >
                      {s.enrollment ? 'Reassign' : 'Assign'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            totalPages={totalPages}
            pageSizes={PAGE_SIZES}
            busy={refreshing}
            label="students"
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          />
        </Card>
      )}

      {/* Assign Section Modal */}
      {assignTarget && (
        <Modal onClose={() => setAssignTarget(null)}>
          <AssignSectionModal
            student={assignTarget}
            onClose={() => setAssignTarget(null)}
            onSuccess={(msg) => {
              showToast(msg, true);
              load();
            }}
          />
        </Modal>
      )}

      {/* Toast */}
      {toast && <Toast msg={toast.msg} ok={toast.ok} />}
    </PortalShell>
  );
}

/* ─── add student modal ──────────────────────────────────────────
   Same fields, validation and API call as before — it just no longer pushes
   the student list down the page while it is open. */
function AddStudentModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const [f, setF] = useState({ firstName: '', lastName: '', admissionNo: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.createStudent({ firstName: f.firstName, lastName: f.lastName || undefined, admissionNo: f.admissionNo });
      onDone(`${`${f.firstName} ${f.lastName}`.trim()} added successfully!`);
    } catch (ex: any) {
      setErr(ex?.message ?? 'Failed to add student. Check the admission number is unique.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Add Student Directly" onClose={busy ? () => {} : onClose}>
      <form onSubmit={submit}>
        <div>
          <div className="field-label">First Name *</div>
          <input className="field-input" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} required placeholder="e.g. Riya" />
        </div>
        <div>
          <div className="field-label">Last Name</div>
          <input className="field-input" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} placeholder="e.g. Sharma" />
        </div>
        <div>
          <div className="field-label">Admission No *</div>
          <input className="field-input" value={f.admissionNo} onChange={(e) => setF({ ...f, admissionNo: e.target.value })} required placeholder="e.g. ADM-2026-0010" />
        </div>
        {err && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 8 }}>⚠ {err}</p>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <Button variant="soft" type="button" onClick={onClose} disabled={busy} style={{ flex: 1 }}>Cancel</Button>
          <Button type="submit" disabled={busy} style={{ flex: 1 }}>{busy ? 'Adding…' : 'Add Student'}</Button>
        </div>
      </form>
    </Dialog>
  );
}
