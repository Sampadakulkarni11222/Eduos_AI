'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PortalShell } from '@/components/shell';
import { AskEduOS } from '@/components/ask-eduos';
import { Card, EmptyState, SkeletonRows, StatCard, rupees } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { StudentDashboardDto, StudentListItem } from '@/lib/types';

export default function StudentDashboard() {
  const { me } = useAuth();
  const router = useRouter();
  const first = me?.profile?.displayName?.split(' ')[0];
  const [student, setStudent] = useState<StudentListItem | null>(null);
  const [data, setData] = useState<StudentDashboardDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([
      api.students().then((r) => setStudent(r.items[0] ?? null)),
      api.studentDashboard().then(setData),
    ]).finally(() => setLoading(false));
  }, []);

  const slots = data?.todayTimetable.filter((s) => s.subject !== 'Break') ?? [];

  return (
    <PortalShell expectedSlug="student" topbar={{ title: 'Student Portal', desc: 'Your school day at a glance', actions: <AskEduOS /> }}>
      {loading && <Card><SkeletonRows rows={4} /></Card>}
      {!loading && !student && (
        <EmptyState title="No student record linked" sub="Contact the administration office to link your student profile." />
      )}

      {student && (
        <>
          <div className="card card-pad" style={{ background: 'var(--accent)', color: 'var(--on-accent)', marginBottom: 16 }}>
            <div style={{ fontFamily: 'Newsreader, serif', fontSize: 23, fontWeight: 600 }}>{greeting()}, {first ?? 'there'}!</div>
            <div style={{ fontSize: 13, opacity: 0.85, marginTop: 3 }}>
              Class: {student.enrollment?.class ?? '—'} · Roll No: {student.enrollment?.rollNo ?? '—'} · {today()}
            </div>
          </div>

          <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 18 }}>
            <StatCard
              label="Attendance"
              value={data ? `${data.attendancePercentage}%` : '—'}
              delta={data ? `${data.presentDays}/${data.totalDays} days` : undefined}
              deltaDir={data && data.attendancePercentage < 75 ? 'down' : 'flat'}
            />
            <StatCard
              label="Pending Assignments"
              value={data ? data.pendingAssignments : '—'}
              delta={data && data.pendingAssignments > 0 ? 'to submit' : 'all done'}
              deltaDir={data && data.pendingAssignments > 0 ? 'down' : 'flat'}
            />
            <StatCard label="Upcoming Exams" value={data ? data.examSchedule.length : '—'} delta="scheduled" deltaDir="flat" />
            <StatCard
              label="Fees Pending"
              value={data ? rupees(Math.round(data.feeStatus.pendingFees * 100)) : '—'}
              delta={data ? `${data.feeStatus.pendingInvoices} open invoice(s)` : undefined}
              deltaDir="flat"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Today's Classes</strong>
                <button onClick={() => router.push('/student/timetable')} style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                  Full timetable →
                </button>
              </div>
              {data === null && <SkeletonRows rows={3} />}
              {data !== null && slots.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--text-2b)' }}>No classes scheduled today.</p>}
              {slots.map((sl, i) => (
                <div key={sl.periodNo} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderTop: i ? '1px solid var(--hairline)' : 'none' }}>
                  <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12.5, color: 'var(--text-2)', width: 44 }}>{sl.startTime}</span>
                  <span style={{ width: 3, height: 26, borderRadius: 3, background: 'var(--accent)', flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{sl.subject}</span>
                </div>
              ))}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
                <button className="btn btn-soft btn-block" onClick={() => router.push('/student/assignments')}>
                  My Assignments{data && data.pendingAssignments > 0 ? ` (${data.pendingAssignments} pending)` : ''}
                </button>
                <button className="btn btn-soft btn-block" onClick={() => router.push('/student/performance')}>My Performance</button>
              </div>
            </Card>

            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Recent Announcements</strong>
                <button
                  onClick={() => router.push('/student/announcements')}
                  style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                  View all →
                </button>
              </div>
              {data === null && <SkeletonRows rows={2} />}
              {data?.recentAnnouncements.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--text-2b)' }}>No announcements yet.</p>}
              {data?.recentAnnouncements.slice(0, 4).map((a) => (
                <div key={a._id} style={{ padding: '8px 0', borderTop: '1px solid var(--hairline)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-1)' }}>{a.title}</div>
                    <span style={{ fontSize: 11.5, color: 'var(--text-faint)', marginLeft: 8, flexShrink: 0 }}>
                      {new Date(a.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-2b)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.content}</div>
                </div>
              ))}

              {data && data.examSchedule.length > 0 && (
                <>
                  <div style={{ fontWeight: 700, fontSize: 13.5, marginTop: 14, marginBottom: 6, color: 'var(--text-1)' }}>Upcoming exams</div>
                  {data.examSchedule.slice(0, 3).map((e, i) => (
                    <div key={i} style={{ fontSize: 12.5, color: 'var(--text-2b)', padding: '4px 0' }}>
                      {e.examName} — {e.subject} · {new Date(e.examDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </div>
                  ))}
                </>
              )}
            </Card>
          </div>
        </>
      )}
    </PortalShell>
  );
}

function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
function today() { return new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
