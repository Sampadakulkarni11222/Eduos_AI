'use client';
import { useEffect, useMemo, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Avatar, Button, Card, EmptyState, Pill, SkeletonRows } from '@/components/ui';
import { api } from '@/lib/api';
import type { StudentListItem, StudentOverviewDto } from '@/lib/types';

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ─── student detail modal ───────────────────────────────────── */
function StudentDetailModal({ studentId, onClose }: { studentId: string; onClose: () => void }) {
  const [data, setData] = useState<StudentOverviewDto | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    setData(null);
    setErr(false);
    api.studentOverview(studentId).then(setData).catch(() => setErr(true));
  }, [studentId]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.45)', display: 'flex',
        alignItems: 'flex-start', justifyContent: 'center', padding: 24, overflowY: 'auto',
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 640, margin: '2vh 0' }}>
        <Card style={{ padding: 0 }}>
          {!data && !err && <div style={{ padding: 24 }}><SkeletonRows rows={6} /></div>}
          {err && (
            <div style={{ padding: 24 }}>
              <EmptyState title="Couldn't load this student" sub="Reload to try again." />
              <Button variant="soft" onClick={onClose} style={{ marginTop: 12 }}>Close</Button>
            </div>
          )}
          {data && (
            <>
              {/* header */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '20px 24px', borderBottom: '1px solid var(--hairline)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Avatar name={data.name} />
                  <div>
                    <div style={{ fontFamily: 'Newsreader, serif', fontSize: 18, fontWeight: 700 }}>{data.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>
                      {data.enrollment?.class ?? 'Unassigned'} · Roll {data.enrollment?.rollNo ?? '—'} · {data.admissionNo}
                    </div>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-faint)', lineHeight: 1 }}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 22 }}>
                {/* personal info */}
                <section>
                  <h4 style={sectionTitle}>Personal Info</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
                    <InfoField label="Date of Birth" value={fmtDate(data.dob)} />
                    <InfoField label="Gender" value={data.gender ?? '—'} />
                    <InfoField label="Address" value={data.address ?? '—'} />
                  </div>
                </section>

                {/* guardians */}
                <section>
                  <h4 style={sectionTitle}>Parent / Guardian Contacts</h4>
                  {data.guardians.length === 0 && <p style={emptyText}>No guardian on file.</p>}
                  {data.guardians.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {data.guardians.map((g, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                          <span>
                            <strong style={{ fontSize: 13.5 }}>{g.name}</strong>{' '}
                            <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>({g.relation.charAt(0) + g.relation.slice(1).toLowerCase()})</span>
                          </span>
                          {g.phone ? (
                            <a href={`tel:${g.phone}`} style={{ fontSize: 13, color: 'var(--accent, #7A1F2B)', textDecoration: 'none' }}>{g.phone}</a>
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--text-faint)', fontStyle: 'italic' }}>No phone on file</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* medical */}
                <section>
                  <h4 style={sectionTitle}>Medical Record</h4>
                  {!data.medical && (
                    <p style={emptyText}>Not available — either no record is on file, or (for subject teachers) only this section's class teacher can view medical info.</p>
                  )}
                  {data.medical && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
                        <InfoField label="Blood Group" value={data.medical.bloodGroup ?? '—'} />
                        <InfoField label="Height" value={data.medical.heightCm ? `${data.medical.heightCm} cm` : '—'} />
                        <InfoField label="Weight" value={data.medical.weightKg ? `${data.medical.weightKg} kg` : '—'} />
                      </div>
                      <InfoField label="Allergies" value={data.medical.allergies.length ? data.medical.allergies.join(', ') : 'None recorded'} />
                      <InfoField label="Medications" value={data.medical.medications.length ? data.medical.medications.join(', ') : 'None recorded'} />
                      {data.medical.emergencyContact && (
                        <InfoField
                          label="Emergency Contact"
                          value={`${data.medical.emergencyContact.name} (${data.medical.emergencyContact.relation}) · ${data.medical.emergencyContact.phone}`}
                        />
                      )}
                      {data.medical.history && <InfoField label="History" value={data.medical.history} />}
                    </div>
                  )}
                </section>

                {/* attendance */}
                <section>
                  <h4 style={sectionTitle}>Attendance (This Month)</h4>
                  {!data.attendance || data.attendance.workingDays === 0 ? (
                    <p style={emptyText}>No attendance marked yet this month.</p>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 26, fontWeight: 700, fontFamily: 'Newsreader, serif' }}>{data.attendance.pctPresent}%</span>
                      <span style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>
                        Present {data.attendance.PRESENT} · Absent {data.attendance.ABSENT} · Late {data.attendance.LATE} · Excused {data.attendance.EXCUSED} · Half-day {data.attendance.HALF_DAY}
                      </span>
                    </div>
                  )}
                </section>

                {/* exam performance */}
                <section>
                  <h4 style={sectionTitle}>Exam Marks</h4>
                  {(!data.performance || data.performance.results.length === 0) && (
                    <p style={emptyText}>No published exam results yet.</p>
                  )}
                  {data.performance && data.performance.results.length > 0 && (
                    <table className="data-table data-table-cards">
                      <thead><tr><th>Exam</th><th>Subject</th><th>Marks</th><th>%</th></tr></thead>
                      <tbody>
                        {data.performance.results.map((r, i) => (
                          <tr key={i}>
                            <td data-label="Exam">{r.exam}</td>
                            <td data-label="Subject">{r.subject}</td>
                            <td data-label="Marks">{r.marks ?? '—'} / {r.maxMarks}</td>
                            <td data-label="%">{r.pct != null ? `${r.pct}%` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>

                {/* assignments */}
                <section>
                  <h4 style={sectionTitle}>Assignments</h4>
                  {data.assignments.length === 0 && <p style={emptyText}>No assignments yet.</p>}
                  {data.assignments.length > 0 && (
                    <table className="data-table data-table-cards">
                      <thead><tr><th>Title</th><th>Subject</th><th>Due</th><th>Status</th><th>Marks</th></tr></thead>
                      <tbody>
                        {data.assignments.map((a) => (
                          <tr key={a.id}>
                            <td className="cell-primary" data-label="Title">{a.title}</td>
                            <td data-label="Subject">{a.subject}</td>
                            <td data-label="Due">{fmtDate(a.dueAt)}</td>
                            <td data-label="Status">
                              <Pill tone={a.status === 'GRADED' ? 'green' : a.status === 'PENDING' ? 'amber' : 'blue'}>{a.status}</Pill>
                            </td>
                            <td data-label="Marks">{a.marks != null ? `${a.marks}${a.maxMarks ? ` / ${a.maxMarks}` : ''}` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

const sectionTitle: React.CSSProperties = {
  fontFamily: 'Newsreader, serif', fontSize: 14.5, fontWeight: 700, margin: '0 0 10px',
};
const emptyText: React.CSSProperties = { fontSize: 13, color: 'var(--text-faint)', fontStyle: 'italic', margin: 0 };

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13.5 }}>{value}</div>
    </div>
  );
}

/* ─── main page ──────────────────────────────────────────────── */
export default function MyClassesPage() {
  const [students, setStudents] = useState<StudentListItem[] | null>(null);
  const [err, setErr] = useState(false);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [viewingId, setViewingId] = useState<string | null>(null);

  useEffect(() => { api.students().then((r) => setStudents(r.items)).catch(() => { setErr(true); setStudents([]); }); }, []);

  // Group by class label — scope already limits to sections this teacher teaches.
  const byClass = useMemo(() => {
    return (students ?? []).reduce<Record<string, StudentListItem[]>>((acc, s) => {
      const k = s.enrollment?.class ?? 'Unassigned';
      (acc[k] ??= []).push(s); return acc;
    }, {});
  }, [students]);

  const query = search.trim().toLowerCase();
  // A class matches on its own name (show every student) or on any student's name within it (show just those students).
  const visibleClasses = Object.entries(byClass)
    .map<[string, StudentListItem[]]>(([cls, list]) => {
      if (!query) return [cls, list];
      if (cls.toLowerCase().includes(query)) return [cls, list];
      return [cls, list.filter((s) => s.name.toLowerCase().includes(query))];
    })
    .filter(([, list]) => list.length > 0);

  // While search is active, force every matching class open so results aren't hidden behind a collapsed card.
  const searching = !!query;
  const isOpen = (cls: string) => searching || !collapsed.has(cls);

  const toggleClass = (cls: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cls)) next.delete(cls); else next.add(cls);
      return next;
    });
  };

  const allOpen = visibleClasses.every(([cls]) => isOpen(cls));
  const toggleAll = () => {
    if (allOpen) {
      setCollapsed(new Set(visibleClasses.map(([cls]) => cls)));
    } else {
      setCollapsed(new Set());
    }
  };

  return (
    <PortalShell expectedSlug="teacher" topbar={{ title: 'My Classes', desc: 'Sections you teach or class-teach.' }}>
      {students === null && !err && <Card><SkeletonRows rows={5} /></Card>}
      {err && <EmptyState title="Couldn't load classes" sub="Reload to try again." />}
      {students && students.length === 0 && <EmptyState title="No students assigned" sub="You'll see your sections here once classes are linked to you." />}

      {students && students.length > 0 && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16, alignItems: 'center' }}>
            <input
              className="input"
              placeholder="Search division or student name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ maxWidth: 320, width: '100%', flex: '1 1 220px' }}
            />
            {visibleClasses.length > 0 && (
              <Button variant="soft" small onClick={toggleAll} disabled={searching} style={{ marginLeft: 'auto' }}>
                {allOpen ? 'Collapse All' : 'Expand All'}
              </Button>
            )}
          </div>

          {visibleClasses.length === 0 && (
            <EmptyState title="No match" sub="No classes or students match your search." />
          )}

          {visibleClasses.map(([cls, list]) => {
            const open = isOpen(cls);
            return (
              <Card key={cls} style={{ marginBottom: 14 }} pad={false}>
                <button
                  onClick={() => toggleClass(cls)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                    padding: '16px 18px', textAlign: 'left',
                  }}
                  aria-expanded={open}
                >
                  <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>
                    {cls} <span style={{ fontSize: 13, color: 'var(--text-faint)', fontFamily: 'inherit' }}>· {list.length} students</span>
                  </strong>
                  <span
                    style={{
                      display: 'inline-block', transition: 'transform 0.15s ease',
                      transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
                      fontSize: 14, color: 'var(--text-faint)',
                    }}
                  >
                    ▸
                  </span>
                </button>
                {open && (
                  <div style={{ padding: '0 18px 16px' }}>
                    <table className="data-table data-table-cards">
                      <thead><tr><th>Student</th><th>Roll</th><th>Admission No.</th><th></th></tr></thead>
                      <tbody>
                        {list.map((s) => (
                          <tr key={s.id} onClick={() => setViewingId(s.id)} style={{ cursor: 'pointer' }}>
                            <td data-label="Student"><span className="row-flex"><Avatar name={s.name} /><span className="cell-primary">{s.name}</span></span></td>
                            <td data-label="Roll">{s.enrollment?.rollNo ?? '—'}</td>
                            <td style={{ color: 'var(--text-faint)' }} data-label="Admission No.">{s.admissionNo}</td>
                            <td data-label="">
                              <Button
                                variant="soft"
                                small
                                onClick={(e) => { e.stopPropagation(); setViewingId(s.id); }}
                                style={{ fontSize: 12, padding: '4px 12px' }}
                              >
                                View More
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            );
          })}
        </>
      )}

      {viewingId && <StudentDetailModal studentId={viewingId} onClose={() => setViewingId(null)} />}
    </PortalShell>
  );
}
