'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PortalShell } from '@/components/shell';
import { Card, EmptyState, Pill, SkeletonRows, StatCard, rupees } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { ParentDashboardDto, StudentListItem } from '@/lib/types';

export default function ParentDashboard() {
  const { me } = useAuth();
  const router = useRouter();
  const first = me?.profile?.displayName?.split(' ')[0];
  const [kids, setKids] = useState<StudentListItem[] | null>(null);
  const [activeKid, setActiveKid] = useState(0);
  const [data, setData] = useState<ParentDashboardDto | null>(null);
  const [err, setErr] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<ParentDashboardDto['announcements'][number] | null>(null);

  useEffect(() => {
    api.students().then((r) => setKids(r.items)).catch(() => { setErr(true); setKids(null); });
  }, []);

  useEffect(() => {
    api.parentDashboard().then(setData).catch(() => setData(null));
  }, []);

  const kid = kids?.[activeKid];
  const kidStats = data?.linkedChildren.find((c) => c.studentId === kid?.id);
  const announcements = data?.announcements ?? null;
  const upcomingEvents = data?.upcomingEvents ?? [];
  const kidTimetable = data?.timetable.filter((t) => t.sectionId === kid?.enrollment?.sectionId) ?? [];

  return (
    <PortalShell expectedSlug="parent" topbar={{ title: 'My Children', desc: "Your family's school life in one place" }}>
      {kids === null && !err && <Card><SkeletonRows rows={3} /></Card>}
      {err && <EmptyState title="Couldn't load your children" sub="Check your connection and reload the page." />}
      {kids && kids.length === 0 && <EmptyState title="No children linked yet" sub="Ask the school office to link your wards to this phone number." />}

      {kids && kids.length > 0 && (
        <>
          {/* Child Selector for Multi-child Parents */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14,
            marginBottom: 16, padding: '10px 14px', background: 'var(--panel-bg)',
            border: '1px solid var(--hairline)', borderRadius: 10, flexWrap: 'wrap',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', color: 'var(--text-faint)' }}>
                ACTIVE CHILD:
              </span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {kids.map((k, i) => (
                  <button
                    key={k.id}
                    onClick={() => setActiveKid(i)}
                    className="chip-tab"
                    style={{
                      background: i === activeKid ? 'var(--accent)' : '#fff',
                      color: i === activeKid ? 'var(--on-accent)' : 'var(--text-1)',
                      borderColor: i === activeKid ? 'var(--accent)' : 'var(--input-border)',
                      fontWeight: 600,
                      padding: '5px 12px',
                    }}
                  >
                    {k.name} ({k.enrollment?.class ?? 'Grade'})
                  </button>
                ))}
              </div>
            </div>

            {kids.length > 1 && (
              <select
                value={activeKid}
                onChange={(e) => setActiveKid(Number(e.target.value))}
                style={{
                  padding: '5px 10px', borderRadius: 8, border: '1px solid var(--input-border)',
                  fontSize: 12.5, fontFamily: 'inherit', background: '#fff', color: 'var(--text-1)', cursor: 'pointer',
                }}
                aria-label="Select active child"
              >
                {kids.map((k, i) => (
                  <option key={k.id} value={i}>
                    {k.name} — Class {k.enrollment?.class ?? '—'}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Welcome Card */}
          <div className="card card-pad" style={{ background: 'var(--accent)', color: 'var(--on-accent)', marginBottom: 16 }}>
            <div style={{ fontFamily: 'Newsreader, serif', fontSize: 23, fontWeight: 600 }}>{greeting()}, {first ?? 'there'}!</div>
            <div style={{ fontSize: 13, opacity: 0.85, marginTop: 3 }}>
              Here's how {kid?.name} ({kid?.enrollment?.class}) is doing today · {today()}
            </div>
          </div>

          {/* Top Responsive KPI Grid (No Cutoffs) */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 12,
              marginBottom: 18,
            }}
          >
            <StatCard
              label="Attendance"
              value={kidStats ? `${kidStats.attendance.percentage}%` : '—'}
              delta={kidStats ? (kidStats.attendance.total > 0 ? `${kidStats.attendance.present}/${kidStats.attendance.total} days` : 'No records yet') : 'No records yet'}
              deltaDir={kidStats && kidStats.attendance.total > 0 && kidStats.attendance.percentage < 75 ? 'down' : 'flat'}
            />
            <StatCard
              label="Fees Pending"
              value={data ? rupees(data.pendingFeesPaise) : '—'}
              delta={data && data.pendingFeesPaise > 0 ? 'pay from Payments' : 'all settled'}
              deltaDir={data && data.pendingFeesPaise > 0 ? 'down' : 'flat'}
            />
            <StatCard label="Upcoming Exams" value={data ? data.upcomingExams.length : '—'} delta="scheduled" deltaDir="flat" />
            <StatCard label="Announcements" value={announcements ? announcements.length : '—'} delta="recent notices" deltaDir="flat" />
          </div>

          {/* Middle Row: Timetable & Class Info */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Today's Timetable</strong>
                <button onClick={() => router.push('/parent/timetable')} style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                  Full timetable →
                </button>
              </div>
              {kidTimetable.length === 0 ? (
                <p style={{ fontSize: 12.5, color: 'var(--text-2b)' }}>No classes scheduled for today.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
                  {kidTimetable.map((t, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: idx < kidTimetable.length - 1 ? '1px solid var(--hairline)' : 'none' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{t.subject}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>Period {t.periodNo}</div>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-2)', textAlign: 'right' }}>
                        <div>{t.startTime}</div>
                        <div style={{ color: 'var(--text-faint)' }}>to {t.endTime}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17, display: 'block', marginBottom: 12 }}>Class Information</strong>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '0.05em', marginBottom: 4 }}>CLASS TEACHER</div>
                  {kidStats?.classTeacher ? (
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{kidStats.classTeacher.name}</div>
                      {(kidStats.classTeacher.email || kidStats.classTeacher.phone) && (
                        <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
                          {kidStats.classTeacher.email} {kidStats.classTeacher.email && kidStats.classTeacher.phone ? '·' : ''} {kidStats.classTeacher.phone}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12.5, color: 'var(--text-faint)', fontStyle: 'italic' }}>
                      No class teacher assigned for this section yet.
                    </div>
                  )}
                </div>

                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '0.05em', marginBottom: 4 }}>CLASS REPRESENTATIVE</div>
                  {kidStats?.classRepresentative ? (
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{kidStats.classRepresentative.name}</div>
                  ) : (
                    <div style={{ fontSize: 12.5, color: 'var(--text-faint)', fontStyle: 'italic' }}>
                      No class representative selected yet.
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </div>

          {/* Bottom Row: Upcoming Events (Actual Events Display) & Announcements */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Upcoming Events Card */}
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Upcoming Events</strong>
                <button
                  onClick={() => router.push('/parent/calendar')}
                  style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                  View calendar →
                </button>
              </div>

              {upcomingEvents.length === 0 ? (
                <p style={{ fontSize: 12.5, color: 'var(--text-2b)' }}>No upcoming school events scheduled.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {upcomingEvents.slice(0, 3).map((ev, i) => (
                    <div key={i} style={{ padding: '8px 0', borderTop: i ? '1px solid var(--hairline)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{ev.title}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>
                          {new Date(ev.startsAt).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                          {ev.location ? ` · ${ev.location}` : ''}
                        </div>
                      </div>
                      <Pill tone={ev.type === 'HOLIDAY' ? 'amber' : ev.type === 'EXAM' ? 'red' : 'blue'}>
                        {ev.type?.toLowerCase()}
                      </Pill>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Announcements Card with Multi-line Preview & Modal */}
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Announcements</strong>
                <button
                  onClick={() => router.push('/parent/announcements')}
                  style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                  View all →
                </button>
              </div>
              {announcements === null && <SkeletonRows rows={2} />}
              {announcements?.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--text-2b)' }}>No announcements yet.</p>}
              {announcements?.slice(0, 3).map((a, i) => (
                <div
                  key={a._id}
                  onClick={() => setSelectedAnnouncement(a)}
                  style={{
                    padding: '8px 8px', margin: '2px -8px', borderRadius: 8,
                    borderTop: i === 0 ? 'none' : '1px solid var(--hairline)',
                    cursor: 'pointer', transition: 'background 0.2s ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--panel-bg)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{a.title}</div>
                    <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600, paddingLeft: 8, flexShrink: 0 }}>Read →</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>
                    {new Date(a.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-2b)', marginTop: 3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {a.content}
                  </div>
                </div>
              ))}
            </Card>
          </div>

          {/* Announcement Modal Dialog */}
          {selectedAnnouncement && (
            <div className="modal-overlay" onClick={() => setSelectedAnnouncement(null)}>
              <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 500 }}>
                <div className="modal-header">
                  <h3 className="modal-title">{selectedAnnouncement.title}</h3>
                  <button className="modal-close" onClick={() => setSelectedAnnouncement(null)}>×</button>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 14 }}>
                  Published on {new Date(selectedAnnouncement.publishedAt).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </div>
                <div style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: '50vh', overflowY: 'auto', paddingRight: 6 }}>
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
