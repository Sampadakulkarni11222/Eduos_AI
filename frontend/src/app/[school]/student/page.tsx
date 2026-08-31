'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PortalShell } from '@/components/shell';

import { Button, Card, EmptyState, SkeletonRows, StatCard, clickable, rupees, subjectColor } from '@/components/ui';
import { api } from '@/lib/api';
import { useSchoolHref } from '@/lib/school-path';
import { useAuth } from '@/lib/auth';
import type { StudentDashboardDto, StudentListItem } from '@/lib/types';

export default function StudentDashboard() {
  // Links are written school-less; this adds the school in the URL.
  const link = useSchoolHref();
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
    <PortalShell expectedSlug="student" topbar={{ title: 'Student Portal', desc: 'Your school day at a glance' }}>
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

          <div className="card-grid" style={{ gridTemplateColumns: 'repeat(5,1fr)', marginBottom: data && data.monthlyAttendance.percentage < 75 ? 12 : 18 }}>
            <StatCard
              label="Monthly Attendance"
              value={data ? `${data.monthlyAttendance.percentage}%` : '—'}
              delta={data ? `${data.monthlyAttendance.presentDays}/${data.monthlyAttendance.totalDays} days` : undefined}
              deltaDir={data && data.monthlyAttendance.percentage < 75 ? 'down' : 'flat'}
            />
            <StatCard
              label="Today's Attendance"
              value={<span style={{ color: attendanceStatusColor(data?.todayAttendanceStatus) }}>{data ? attendanceStatusLabel(data.todayAttendanceStatus) : '—'}</span>}
            />
            <StatCard
              label="Pending Assignments"
              value={data ? data.pendingAssignments : '—'}
              delta={data && data.pendingAssignments > 0 ? 'to submit' : 'all done'}
              deltaDir={data && data.pendingAssignments > 0 ? 'down' : 'flat'}
            />
            <StatCard label="Upcoming Exams" value={data ? data.examSchedule.length : '—'} delta="scheduled" deltaDir="flat" />
            <div {...clickable(() => router.push(link('/student/payments')), { label: 'View fees and payments' })} style={{ cursor: 'pointer' }}>
              <StatCard
                label="Fees Pending"
                value={data ? rupees(Math.round(data.feeStatus.pendingFees * 100)) : '—'}
                delta={data ? `${data.feeStatus.pendingInvoices} open invoice(s)` : undefined}
                deltaDir="flat"
              />
            </div>
          </div>

          {data && data.monthlyAttendance.percentage < 75 && (
            <div style={{ marginBottom: 18, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 13, color: '#b91c1c', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span>Your attendance this month is {data.monthlyAttendance.percentage}%, below the 75% requirement.</span>
              <button onClick={() => router.push(link('/student/attendance'))} style={{ fontSize: 12.5, fontWeight: 700, color: '#b91c1c', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', flexShrink: 0 }}>
                View attendance →
              </button>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Today&apos;s Schedule</strong>
                <button onClick={() => router.push(link('/student/timetable'))} style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                  Full timetable →
                </button>
              </div>
              {data === null && <SkeletonRows rows={3} />}
              {data !== null && slots.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--text-2b)' }}>No classes scheduled today.</p>}
              {slots.map((sl, i) => {
                const color = subjectColor(sl.subject);
                return (
                  <div key={sl.periodNo} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderTop: i ? '1px solid var(--hairline)' : 'none' }}>
                    <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12.5, color: 'var(--text-2)', width: 44 }}>{sl.startTime}</span>
                    <span style={{ width: 3, height: 26, borderRadius: 3, background: color.dot, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{sl.subject}</div>
                      {sl.room && <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{sl.room}</div>}
                    </div>
                    {sl.liveClassLink && (
                      <Button small variant="soft" onClick={(e) => { e.stopPropagation(); window.open(sl.liveClassLink!, '_blank', 'noopener,noreferrer'); }}>
                        Live
                      </Button>
                    )}
                  </div>
                );
              })}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
                <button className="btn btn-soft btn-block" onClick={() => router.push(link('/student/assignments'))}>
                  My Assignments{data && data.pendingAssignments > 0 ? ` (${data.pendingAssignments} pending)` : ''}
                </button>
                <button className="btn btn-soft btn-block" onClick={() => router.push(link('/student/performance'))}>My Performance</button>
              </div>
            </Card>

            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Upcoming Classes</strong>
                <button onClick={() => router.push(link('/student/timetable'))} style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                  Full timetable →
                </button>
              </div>
              {data === null && <SkeletonRows rows={3} />}
              {data !== null && (data.upcomingClasses.filter((s) => s.subject !== 'Break').length === 0) && (
                <p style={{ fontSize: 12.5, color: 'var(--text-2b)' }}>No more classes today.</p>
              )}
              {data?.upcomingClasses.filter((s) => s.subject !== 'Break').slice(0, 4).map((sl, i) => {
                const color = subjectColor(sl.subject);
                return (
                  <div key={sl.periodNo} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderTop: i ? '1px solid var(--hairline)' : 'none' }}>
                    <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12.5, color: 'var(--text-2)', width: 44 }}>{sl.startTime}</span>
                    <span style={{ width: 3, height: 26, borderRadius: 3, background: color.dot, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{sl.subject}</div>
                      {sl.room && <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{sl.room}</div>}
                    </div>
                    {sl.liveClassLink && (
                      <Button small variant="soft" onClick={(e) => { e.stopPropagation(); window.open(sl.liveClassLink!, '_blank', 'noopener,noreferrer'); }}>
                        Live
                      </Button>
                    )}
                  </div>
                );
              })}
            </Card>
          </div>

          <div style={{ marginTop: 16 }}>
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Recent Announcements</strong>
                <button
                  onClick={() => router.push(link('/student/announcements'))}
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

function attendanceStatusLabel(status: string | undefined) {
  return ({
    PRESENT: 'Present', LATE: 'Present (Late)', ABSENT: 'Absent',
    EXCUSED: 'Leave', HALF_DAY: 'Half Day', HOLIDAY: 'Holiday', NOT_MARKED: 'Not marked yet',
  } as Record<string, string>)[status ?? ''] ?? '—';
}
function attendanceStatusColor(status: string | undefined) {
  if (status === 'PRESENT' || status === 'LATE') return 'var(--green)';
  if (status === 'ABSENT') return 'var(--red)';
  if (status === 'EXCUSED' || status === 'HALF_DAY') return 'var(--amber)';
  return 'var(--text-faint)';
}
