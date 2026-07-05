'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { AskEduOS } from '@/components/ask-eduos';
import { Card, EmptyState, SkeletonRows, StatCard } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { AnnouncementDto, AssignmentDto, SectionDto, TimetableDto } from '@/lib/types';

export default function TeacherDashboard() {
  const { me } = useAuth();
  const name = me?.profile?.displayName;
  const [sections, setSections] = useState<SectionDto[] | null>(null);
  const [todaySlots, setTodaySlots] = useState<TimetableDto['slots']>([]);
  const [assignments, setAssignments] = useState<AssignmentDto[] | null>(null);
  const [announcements, setAnnouncements] = useState<AnnouncementDto[] | null>(null);
  const [loadingTt, setLoadingTt] = useState(false);

  useEffect(() => {
    api.myOfferings().then(() => {}).catch(() => {});
    api.assignments().then(setAssignments).catch(() => setAssignments([]));
    api.announcements().then(setAnnouncements).catch(() => setAnnouncements([]));
    api.mySections().then((s) => {
      setSections(s);
      if (!s[0]) return;
      const todayDow = new Date().getDay() || 7; // 1=Mon…7=Sun
      setLoadingTt(true);
      api.timetable(s[0].id)
        .then((tt) => setTodaySlots(tt.slots.filter((sl) => sl.dayOfWeek === todayDow && !sl.isBreak).sort((a, b) => a.periodNo - b.periodNo)))
        .catch(() => setTodaySlots([]))
        .finally(() => setLoadingTt(false));
    }).catch(() => setSections([]));
  }, []);

  const unreadAnnouncements = announcements?.length ?? 0;
  const pendingAssignments = assignments?.length ?? 0;

  return (
    <PortalShell expectedSlug="teacher" topbar={{ title: 'My Dashboard', desc: 'Your teaching day at a glance', actions: <AskEduOS label="Teacher Copilot" /> }}>
      <div className="card card-pad" style={{ background: 'var(--accent)', color: 'var(--on-accent)', marginBottom: 18 }}>
        <div style={{ fontFamily: 'Newsreader, serif', fontSize: 24, fontWeight: 600 }}>{greeting()}, {name ?? 'there'}!</div>
        <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>{today()} · {todaySlots.length > 0 ? `${todaySlots.length} class${todaySlots.length === 1 ? '' : 'es'} today` : 'No classes scheduled today'}</div>
      </div>

      <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 18 }}>
        <StatCard label="Today's Classes" value={loadingTt ? '…' : todaySlots.length} />
        <StatCard label="My Sections" value={sections ? sections.length : '—'} delta="active" deltaDir="flat" />
        <StatCard label="Assignments" value={assignments ? pendingAssignments : '—'} delta="total" deltaDir="flat" />
        <StatCard label="Announcements" value={announcements ? unreadAnnouncements : '—'} delta="published" deltaDir="flat" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16 }}>
        <Card>
          <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Today's Classes</strong>
          <div style={{ marginTop: 12 }}>
            {loadingTt && <SkeletonRows rows={3} />}
            {!loadingTt && todaySlots.length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--text-2b)' }}>No classes scheduled for today.</p>
            )}
            {todaySlots.map((sl, i) => (
              <div key={sl.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 0', borderTop: i ? '1px solid var(--hairline)' : 'none' }}>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13, color: 'var(--text-2)', width: 46 }}>{sl.startTime}</span>
                <span style={{ width: 3, height: 30, borderRadius: 3, background: 'var(--accent)', flexShrink: 0 }} />
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: 13.5, color: 'var(--text-1)' }}>{sl.subject}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Period {sl.periodNo}</span>
                </span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Recent Assignments</strong>
          {assignments === null && <SkeletonRows rows={3} />}
          {assignments?.length === 0 && (
            <p style={{ fontSize: 12.5, color: 'var(--text-2b)', marginTop: 10 }}>No assignments yet. Create one from the Assignments page.</p>
          )}
          {assignments && assignments.length > 0 && (
            <div style={{ marginTop: 10 }}>
              {assignments.slice(0, 4).map((a, i) => (
                <div key={a.id} style={{ padding: '9px 0', borderTop: i ? '1px solid var(--hairline)' : 'none' }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{a.title}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{a.subject} · Due {fmtDue(a.dueAt)}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </PortalShell>
  );
}
function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
function today() { return new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
function fmtDue(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
