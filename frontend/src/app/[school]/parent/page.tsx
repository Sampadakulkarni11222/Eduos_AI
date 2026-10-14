'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PortalShell } from '@/components/shell';

import { Card, EmptyState, Pill, SkeletonRows, StatCard } from '@/components/ui';
import { ExpandableText } from '@/components/expandable-text';
import { api } from '@/lib/api';
import { useSchoolHref } from '@/lib/school-path';
import { useAuth } from '@/lib/auth';
import { rupees } from '@/components/ui';
import type { CalendarEventDto, ParentDashboardDto, StudentListItem } from '@/lib/types';
import { PulseBoard } from '@/components/ops/pulse-board';
import { formatDate, formatDayMonth, formatTime12, greeting, greetingName, humanizeLabel } from '../student/_lib/format';

/**
 * The dashboard payload with the per-child tags the API now returns, so the
 * tiles follow the child selected in the chips. Optional, so an older API
 * (without them) still renders, falling back to the family-wide figures.
 */
type ChildTags = { enrollmentId?: string | null; sectionId?: string | null; pendingFeesPaise?: number; pendingAssignments?: number };
type ParentDashboard = Omit<ParentDashboardDto, 'linkedChildren' | 'upcomingExams' | 'recentResults'> & {
  linkedChildren: Array<ParentDashboardDto['linkedChildren'][number] & ChildTags>;
  upcomingExams: Array<ParentDashboardDto['upcomingExams'][number] & { sectionId?: string | null }>;
  recentResults: Array<ParentDashboardDto['recentResults'][number] & { studentId?: string | null }>;
};

export default function ParentDashboard() {
  // Links are written school-less; this adds the school in the URL.
  const link = useSchoolHref();
  const { me } = useAuth();
  const router = useRouter();
  // "Parent of Diya" is a placeholder, not a name: greet without one rather
  // than "Good afternoon, Parent!".
  const first = greetingName(me?.profile?.displayName);
  const [kids, setKids] = useState<StudentListItem[] | null>(null);
  const [activeKid, setActiveKid] = useState(0);
  const [data, setData] = useState<ParentDashboard | null>(null);
  const [err, setErr] = useState(false);

  const [events, setEvents] = useState<CalendarEventDto[] | null>(null);

  useEffect(() => { api.students().then((r) => setKids(r.items)).catch(() => { setErr(true); setKids([]); }); }, []);
  useEffect(() => { api.parentDashboard().then((d) => setData(d as ParentDashboard)).catch(() => setData(null)); }, []);

  // Real events from the same calendar endpoint the Calendar page uses —
  // parents hold calendar.read, so this needs no new permission.
  useEffect(() => {
    const from = new Date();
    const to = new Date(); to.setMonth(to.getMonth() + 3);
    api.calendar(from.toISOString(), to.toISOString())
      .then(setEvents)
      .catch(() => setEvents([]));
  }, []);

  const kid = kids?.[activeKid];
  const kidStats = data?.linkedChildren.find((c) => c.studentId === kid?.id);
  const announcements = data?.announcements ?? null;
  const kidTimetable = data?.timetable.filter((t) => t.sectionId === kid?.enrollment?.sectionId) ?? [];
  // Per-child figures where the API tags them; family-wide otherwise.
  const kidSectionId = kidStats?.sectionId ?? kid?.enrollment?.sectionId ?? null;
  const kidExams = data
    ? data.upcomingExams.filter((e) => !e.sectionId || !kidSectionId || e.sectionId === kidSectionId)
    : null;
  const kidPendingPaise = kidStats?.pendingFeesPaise ?? data?.pendingFeesPaise ?? null;
  const kidHomework = kidStats?.pendingAssignments ?? null;

  // The endpoint returns a window that can include today's earlier entries;
  // only events that have not finished are "upcoming".
  const now = Date.now();
  const upcomingEvents = (events ?? [])
    .filter((e) => new Date(e.endsAt || e.startsAt).getTime() >= now)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  // Latest published result for the Performance tile — real data from the
  // dashboard payload, not a recomputed or invented figure.
  const latestResult = data?.recentResults?.find((r) => !r.studentId || r.studentId === kid?.id) ?? null;
  const latestResultPct = latestResult && latestResult.maxMarks
    ? Math.round((latestResult.marks / latestResult.maxMarks) * 100)
    : null;

  return (
    <PortalShell expectedSlug="parent" topbar={{ title: 'My Children', desc: "Your family's school life in one place" }}>
      {/* The interactive board: briefing, departments, campus, charts and live activity. */}
      <PulseBoard />

      {kids === null && !err && <Card><SkeletonRows rows={3} /></Card>}
      {err && <EmptyState title="Couldn't load your children" sub="Check your connection and reload the page." />}
      {kids && kids.length === 0 && <EmptyState title="No children linked yet" sub="Ask the school office to link your wards to this phone number." />}

      {kids && kids.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: 'var(--text-faint)' }}>VIEWING</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {kids.map((k, i) => (
                <button key={k.id} onClick={() => setActiveKid(i)}
                  className="chip-tab" style={{
                    background: i === activeKid ? 'var(--accent)' : 'var(--card-bg)',
                    color: i === activeKid ? 'var(--on-accent)' : 'var(--text-2)',
                    borderColor: i === activeKid ? 'var(--accent)' : 'var(--input-border)',
                  }}>
                  {k.name.split(' ')[0]} · {k.enrollment?.class ?? '—'}
                </button>
              ))}
            </div>
          </div>

          <div className="card card-pad" style={{ background: 'var(--accent)', color: 'var(--on-accent)', marginBottom: 16 }}>
            <div style={{ fontFamily: 'Newsreader, serif', fontSize: 23, fontWeight: 600 }}>{greeting()}{first ? `, ${first}` : ''}!</div>
            <div style={{ fontSize: 13, opacity: 0.85, marginTop: 3 }}>
              Here&apos;s how {kid?.name} ({kid?.enrollment?.class}) is doing today · {today()}
            </div>
          </div>

          {/* Five tiles: Performance was added alongside the existing four, not
              in place of any of them. Below 1100px this collapses to 2 columns
              and then to 1, per the shared .card-grid rules. */}
          <div className="card-grid" style={{ gridTemplateColumns: 'repeat(5,1fr)', marginBottom: 18 }}>
            <StatCard
              label="Attendance"
              value={kidStats ? `${kidStats.attendance.percentage}%` : '—'}
              delta={kidStats ? `${kidStats.attendance.present}/${kidStats.attendance.total} days` : 'no records yet'}
              deltaDir={kidStats && kidStats.attendance.percentage < 75 ? 'down' : 'flat'}
              href={link('/parent/attendance')}
              hint="View the monthly attendance breakdown"
            />
            <StatCard
              label="Performance"
              value={latestResultPct != null ? `${latestResultPct}%` : '—'}
              delta={latestResult ? `${latestResult.subject} · ${latestResult.examName}` : 'no published results yet'}
              deltaDir={latestResultPct != null && latestResultPct < 50 ? 'down' : latestResultPct != null && latestResultPct >= 75 ? 'up' : 'flat'}
              href={link('/parent/performance')}
              hint="View the full marks breakdown and report card"
            />
            <StatCard
              label="Fees Pending"
              value={kidPendingPaise != null ? rupees(kidPendingPaise) : '—'}
              delta={kidPendingPaise != null && kidPendingPaise > 0 ? 'pay from Payments' : 'all settled'}
              deltaDir={kidPendingPaise != null && kidPendingPaise > 0 ? 'down' : 'flat'}
              href={link('/parent/payments')}
              hint="View invoices and pay outstanding fees"
            />
            <StatCard
              label="Upcoming Exams"
              value={kidExams ? kidExams.length : '—'}
              delta={kidExams && kidExams[0] ? `next: ${kidExams[0].subject} · ${formatDayMonth(kidExams[0].examDate)}` : 'none scheduled'}
              deltaDir="flat"
            />
            {kidHomework != null ? (
              <StatCard
                label="Homework Due"
                value={kidHomework}
                delta={kidHomework > 0 ? 'not yet handed in' : 'all handed in'}
                deltaDir={kidHomework > 0 ? 'down' : 'flat'}
                href={link('/parent/assignments')}
                hint="View assignments and due dates"
              />
            ) : (
              <StatCard label="Announcements" value={announcements ? announcements.length : '—'} delta="recent notices" deltaDir="flat" />
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <Card>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17, display: 'block', marginBottom: 12 }}>Today&apos;s Timetable</strong>
              {kidTimetable.length === 0 ? (
                <p style={{ fontSize: 12.5, color: 'var(--text-2b)' }}>No classes scheduled for today.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {kidTimetable.map((t, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: idx < kidTimetable.length - 1 ? '1px solid var(--hairline)' : 'none' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{t.subject}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>Period {t.periodNo}</div>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-2)', textAlign: 'right' }}>
                        <div>{formatTime12(t.startTime)}</div>
                        <div style={{ color: 'var(--text-faint)' }}>to {formatTime12(t.endTime)}</div>
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
                    <div style={{ fontSize: 13, color: 'var(--text-2b)' }}>Not assigned</div>
                  )}
                </div>
                
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '0.05em', marginBottom: 4 }}>CLASS REPRESENTATIVE</div>
                  {kidStats?.classRepresentative ? (
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{kidStats.classRepresentative.name}</div>
                  ) : (
                    <div style={{ fontSize: 13, color: 'var(--text-2b)' }}>Not assigned</div>
                  )}
                </div>
              </div>
            </Card>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Upcoming Events</strong>
                <button
                  onClick={() => router.push(link('/parent/calendar'))}
                  style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                  View Calendar →
                </button>
              </div>

              {events === null && <SkeletonRows rows={2} />}

              {events !== null && upcomingEvents.length === 0 && (
                <div style={{ padding: '14px 4px' }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)', marginBottom: 3 }}>
                    No upcoming events
                  </div>
                  <p style={{ fontSize: 12.5, color: 'var(--text-2b)', lineHeight: 1.5 }}>
                    Holidays, exams and school events appear here once the school schedules them.
                  </p>
                </div>
              )}

              {upcomingEvents.slice(0, 4).map((e, idx) => (
                <div
                  key={e.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '9px 0', borderTop: idx ? '1px solid var(--hairline)' : 'none',
                  }}
                >
                  <div style={{ width: 42, textAlign: 'center', flexShrink: 0 }}>
                    <div style={{ fontFamily: 'Newsreader, serif', fontSize: 18, fontWeight: 600, color: 'var(--text-1b)', lineHeight: 1 }}>
                      {new Date(e.startsAt).getDate()}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-faint)', textTransform: 'uppercase', marginTop: 2 }}>
                      {new Date(e.startsAt).toLocaleDateString('en-IN', { month: 'short' })}
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-1)' }}>{e.title}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{fmtEventWhen(e)}</div>
                  </div>
                  <Pill tone={EVENT_TONE[e.type] ?? 'gray'}>{humanizeLabel(e.type)}</Pill>
                </div>
              ))}

              {upcomingEvents.length > 4 && (
                <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 8 }}>
                  +{upcomingEvents.length - 4} more in the calendar
                </div>
              )}
            </Card>
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Announcements</strong>
                <button
                  onClick={() => router.push(link('/parent/announcements'))}
                  style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                  View all →
                </button>
              </div>
              {announcements === null && <SkeletonRows rows={2} />}
              {announcements?.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--text-2b)' }}>No announcements yet.</p>}
              {announcements?.slice(0, 3).map((a) => (
                <div key={a._id} style={{ padding: '8px 0', borderTop: '1px solid var(--hairline)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-1)' }}>{a.title}</div>
                    <span style={{ fontSize: 11.5, color: 'var(--text-faint)', marginLeft: 8, flexShrink: 0 }}>
                      {formatDate(a.publishedAt)}
                    </span>
                  </div>
                  {/* Was clipped to a single nowrap line, so a long notice was
                      unreadable here; it now expands in place. */}
                  <ExpandableText text={a.content} clampLines={2} style={{ fontSize: 12, marginTop: 2 }} />
                </div>
              ))}
            </Card>
          </div>
        </>
      )}
    </PortalShell>
  );
}
/** Same tones the Calendar page uses, so an event reads identically in both places. */
const EVENT_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'maroon' | 'gray'> = {
  HOLIDAY: 'amber', EXAM: 'maroon', PTM: 'blue', SPORTS: 'green', EVENT: 'gray',
};

/** "Tomorrow", "Mon, 18 Aug 2026", or a range when the event spans several days. */
function fmtEventWhen(e: CalendarEventDto): string {
  const start = new Date(e.startsAt);
  const end = e.endsAt ? new Date(e.endsAt) : null;
  const fmt = (d: Date) => `${d.toLocaleDateString('en-IN', { weekday: 'short' })}, ${formatDate(d)}`;

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(start) - startOfDay(new Date())) / 86_400_000);

  const spansDays = end && startOfDay(end) > startOfDay(start);
  if (spansDays) {
    return `${fmt(start)} – ${fmt(end!)}`;
  }
  if (dayDiff === 0) return 'Today';
  if (dayDiff === 1) return 'Tomorrow';
  return fmt(start);
}

function today() { return `${new Date().toLocaleDateString('en-IN', { weekday: 'long' })}, ${formatDate(new Date())}`; }
