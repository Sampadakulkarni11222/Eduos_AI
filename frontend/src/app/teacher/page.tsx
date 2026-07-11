'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PortalShell } from '@/components/shell';
import { AskEduOS } from '@/components/ask-eduos';
import { Card, EmptyState, SkeletonRows, StatCard } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { TeacherDashboardDto } from '@/lib/types';

export default function TeacherDashboard() {
  const { me } = useAuth();
  const router = useRouter();
  const name = me?.profile?.displayName;
  const [data, setData] = useState<TeacherDashboardDto | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    api.teacherDashboard().then(setData).catch(() => setErr(true));
  }, []);

  const slots = data?.todayTimetable.filter((s) => s.subject !== 'Break') ?? [];

  return (
    <PortalShell expectedSlug="teacher" topbar={{ title: 'My Dashboard', desc: 'Your teaching day at a glance', actions: <AskEduOS label="Teacher Copilot" /> }}>
      <div className="card card-pad" style={{ background: 'var(--accent)', color: 'var(--on-accent)', marginBottom: 18 }}>
        <div style={{ fontFamily: 'Newsreader, serif', fontSize: 24, fontWeight: 600 }}>{greeting()}, {name ?? 'there'}!</div>
        <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>
          {today()} · {data ? (slots.length > 0 ? `${slots.length} class${slots.length === 1 ? '' : 'es'} today` : 'No classes scheduled today') : 'Loading your day…'}
        </div>
      </div>

      {err && <EmptyState title="Couldn't load your dashboard" sub="The server didn't respond. Reload the page to try again." />}

      {!err && (
        <>
          <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 18 }}>
            <StatCard label="Today's Classes" value={data ? slots.length : '—'} />
            <StatCard label="My Sections" value={data ? data.assignedClasses.length : '—'} delta={data ? `${data.totalStudents} students` : undefined} deltaDir="flat" />
            <StatCard label="Awaiting Grading" value={data ? data.pendingAssignmentEvaluations : '—'} delta={data && data.pendingAssignmentEvaluations > 0 ? 'submissions to review' : 'all graded'} deltaDir={data && data.pendingAssignmentEvaluations > 0 ? 'down' : 'flat'} />
            <StatCard label="Upcoming Exams" value={data ? data.upcomingExams.length : '—'} delta="in your subjects" deltaDir="flat" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16 }}>
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Today's Classes</strong>
                <button onClick={() => router.push('/teacher/timetable')} style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                  Full timetable →
                </button>
              </div>
              <div style={{ marginTop: 12 }}>
                {data === null && <SkeletonRows rows={3} />}
                {data !== null && slots.length === 0 && (
                  <p style={{ fontSize: 13, color: 'var(--text-2b)' }}>No classes scheduled for today.</p>
                )}
                {slots.map((sl, i) => (
                  <div key={`${sl.periodNo}-${sl.section}`} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 0', borderTop: i ? '1px solid var(--hairline)' : 'none' }}>
                    <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13, color: 'var(--text-2)', width: 46 }}>{sl.startTime}</span>
                    <span style={{ width: 3, height: 30, borderRadius: 3, background: 'var(--accent)', flexShrink: 0 }} />
                    <span style={{ flex: 1 }}>
                      <span style={{ display: 'block', fontWeight: 600, fontSize: 13.5, color: 'var(--text-1)' }}>{sl.subject}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Period {sl.periodNo}{sl.section ? ` · ${sl.section}` : ''}</span>
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Card>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Grading Queue</strong>
                  <button onClick={() => router.push('/teacher/assignments')} style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                    Open assignments →
                  </button>
                </div>
                {data === null && <SkeletonRows rows={1} />}
                {data !== null && (
                  <p style={{ fontSize: 13, color: 'var(--text-2b)', marginTop: 8 }}>
                    {data.pendingAssignmentEvaluations > 0
                      ? `${data.pendingAssignmentEvaluations} submission${data.pendingAssignmentEvaluations > 1 ? 's are' : ' is'} waiting for your review.`
                      : 'Nothing to grade right now — all caught up.'}
                  </p>
                )}
              </Card>

              <Card>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Announcements</strong>
                  <button onClick={() => router.push('/teacher/announcements')} style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                    View all →
                  </button>
                </div>
                {data === null && <SkeletonRows rows={2} />}
                {data?.recentAnnouncements.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--text-2b)' }}>No announcements yet.</p>}
                {data?.recentAnnouncements.slice(0, 3).map((a) => (
                  <div key={a._id} style={{ padding: '8px 0', borderTop: '1px solid var(--hairline)' }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{a.title}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>
                      {new Date(a.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </div>
                  </div>
                ))}
              </Card>
            </div>
          </div>
        </>
      )}
    </PortalShell>
  );
}
function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
function today() { return new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
