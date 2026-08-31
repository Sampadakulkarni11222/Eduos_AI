'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PortalShell } from '@/components/shell';

import { Card, EmptyState, Pill, SkeletonRows, StatCard, clickable } from '@/components/ui';
import { api } from '@/lib/api';
import { useSchoolHref } from '@/lib/school-path';
import { useAuth } from '@/lib/auth';
import type { TeacherDashboardDto } from '@/lib/types';

export default function TeacherDashboard() {
  // Links are written school-less; this adds the school in the URL.
  const link = useSchoolHref();
  const { me } = useAuth();
  const router = useRouter();
  const name = me?.profile?.displayName;
  const [data, setData] = useState<TeacherDashboardDto | null>(null);
  const [err, setErr] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<TeacherDashboardDto['recentAnnouncements'][number] | null>(null);

  useEffect(() => {
    api.teacherDashboard().then(setData).catch(() => setErr(true));
  }, []);

  const slots = data?.todayTimetable.filter((s) => s.subject !== 'Break') ?? [];

  return (
    <PortalShell expectedSlug="teacher" topbar={{ title: 'My Dashboard', desc: 'Your teaching day at a glance' }}>
      <div className="card card-pad" style={{ background: 'var(--accent)', color: 'var(--on-accent)', marginBottom: 18 }}>
        <div style={{ fontFamily: 'Newsreader, serif', fontSize: 24, fontWeight: 600 }}>{greeting()}, {name ?? 'there'}!</div>
        <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>
          {today()} · {data ? (slots.length > 0 ? `${slots.length} class${slots.length === 1 ? '' : 'es'} today` : 'No classes scheduled today') : 'Loading your day…'}
        </div>
      </div>

      {err && <EmptyState title="Couldn't load your dashboard" sub="The server didn't respond. Reload the page to try again." />}

      {!err && (
        <>
          <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 14 }}>
            <StatCard label="Today's Classes" value={data ? slots.length : '—'} />
            <StatCard label="Total Classes" value={data ? data.totalOfferings : '—'} delta="subjects you teach" deltaDir="flat" />
            <StatCard label="Total Sections" value={data ? data.assignedClasses.length : '—'} delta={data ? `${data.totalStudents} students` : undefined} deltaDir="flat" />
            <StatCard label="Upcoming Exams" value={data ? data.upcomingExams.length : '—'} delta="in your subjects" deltaDir="flat" />
          </div>
          <div className="card-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: 18 }}>
            <StatCard label="Pending Assignments" value={data ? data.pendingAssignmentEvaluations : '—'} delta={data && data.pendingAssignmentEvaluations > 0 ? 'submissions to review' : 'all graded'} deltaDir={data && data.pendingAssignmentEvaluations > 0 ? 'down' : 'flat'} />
            <StatCard label="Course Materials" value={data ? data.courseMaterialsCount : '—'} delta="uploaded by you" deltaDir="flat" />
            <div className="stat-card">
              <div className="stat-label">Attendance Today</div>
              {data === null && <div style={{ marginTop: 8 }}><SkeletonRows rows={1} /></div>}
              {data !== null && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  <Pill tone="green">{data.attendanceSummary.PRESENT ?? 0} present</Pill>
                  <Pill tone="red">{data.attendanceSummary.ABSENT ?? 0} absent</Pill>
                  <Pill tone="amber">{data.attendanceSummary.LATE ?? 0} late</Pill>
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16 }}>
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Today&apos;s Classes</strong>
                <button onClick={() => router.push(link('/teacher/timetable'))} style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
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
                  <button onClick={() => router.push(link('/teacher/assignments'))} style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
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
                  <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Recent Notifications</strong>
                  <button onClick={() => router.push(link('/teacher/announcements'))} style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                    View all →
                  </button>
                </div>
                {data === null && <SkeletonRows rows={2} />}
                {data?.recentAnnouncements.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--text-2b)' }}>No announcements yet.</p>}
                {data?.recentAnnouncements.slice(0, 3).map((a, i) => (
                  <div
                    key={a._id}
                    {...clickable(() => setSelectedAnnouncement(a), { label: `Open announcement: ${a.title}` })}
                    style={{
                      padding: '8px 8px',
                      margin: '2px -8px',
                      borderRadius: 8,
                      borderTop: i === 0 ? 'none' : '1px solid var(--hairline)',
                      cursor: 'pointer',
                      transition: 'background 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--panel-bg)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{a.title}</div>
                      <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600, opacity: 0.8, paddingLeft: 8 }}>Read →</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>
                      {new Date(a.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </div>
                  </div>
                ))}
              </Card>
            </div>
          </div>

          {selectedAnnouncement && (
            // Backdrop dismissal is a mouse convenience; ModalA11yBridge supplies
            // Escape-to-close and a focus trap, and a backdrop must not be a tab stop.
            // eslint-disable-next-line jsx-a11y/no-static-element-interactions
            <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && (() => setSelectedAnnouncement(null))()}>
              <div className="modal" style={{ width: '100%', maxWidth: 500 }}>
                <div className="modal-header">
                  <h3 className="modal-title">{selectedAnnouncement.title}</h3>
                  <button className="modal-close" aria-label="Close dialog" title="Close" onClick={() => setSelectedAnnouncement(null)}>×</button>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 14 }}>
                  Published on {new Date(selectedAnnouncement.publishedAt).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </div>
                <div style={{ 
                  fontSize: 14, 
                  color: 'var(--text-2)', 
                  lineHeight: 1.6, 
                  whiteSpace: 'pre-wrap', 
                  maxHeight: '50vh', 
                  overflowY: 'auto',
                  paddingRight: 6
                }}>
                  {selectedAnnouncement.content}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
                  <button className="btn btn-soft" onClick={() => setSelectedAnnouncement(null)}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </PortalShell>
  );
}
function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
function today() { return new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
