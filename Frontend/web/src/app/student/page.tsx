'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PortalShell } from '@/components/shell';
import { AskEduOS } from '@/components/ask-eduos';
import { Card, EmptyState, SkeletonRows, StatCard } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { AnnouncementDto, StudentListItem } from '@/lib/types';

export default function StudentDashboard() {
  const { me } = useAuth();
  const router = useRouter();
  const first = me?.profile?.displayName?.split(' ')[0];
  const [student, setStudent] = useState<StudentListItem | null>(null);
  const [announcements, setAnnouncements] = useState<AnnouncementDto[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.students().then((r) => setStudent(r.items[0] ?? null)),
      api.announcements().then(setAnnouncements),
    ]).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <PortalShell expectedSlug="student" topbar={{ title: 'Student Portal', desc: 'Welcome back to Cavalier Academy', actions: <AskEduOS /> }}>
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
            <StatCard label="Announcements" value={announcements ? announcements.length : '0'} delta="total" deltaDir="flat" />
            <StatCard label="My Class" value={student.enrollment?.class ?? '—'} />
            <StatCard label="Roll Number" value={student.enrollment?.rollNo ?? '—'} />
            <StatCard label="Admission No." value={student.admissionNo} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>My Academics</strong>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button className="btn btn-soft btn-block" onClick={() => router.push('/student/timetable')}>View Timetable</button>
                <button className="btn btn-soft btn-block" onClick={() => router.push('/student/assignments')}>My Assignments</button>
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
              {announcements === null && <SkeletonRows rows={2} />}
              {announcements?.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--text-2b)' }}>No announcements yet.</p>}
              {announcements?.slice(0, 3).map((a) => (
                <div key={a.id} style={{ padding: '8px 0', borderTop: '1px solid var(--hairline)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-1)' }}>{a.title}</div>
                    <span style={{ fontSize: 11.5, color: 'var(--text-faint)', marginLeft: 8, flexShrink: 0 }}>
                      {new Date(a.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-2b)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.content}</div>
                </div>
              ))}
            </Card>
          </div>
        </>
      )}
    </PortalShell>
  );
}

function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
function today() { return new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
