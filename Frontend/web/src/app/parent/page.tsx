'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PortalShell } from '@/components/shell';
import { AskEduOS } from '@/components/ask-eduos';
import { Card, EmptyState, Pill, SkeletonRows, StatCard } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { AnnouncementDto, StudentListItem } from '@/lib/types';

export default function ParentDashboard() {
  const { me } = useAuth();
  const router = useRouter();
  const first = me?.profile?.displayName?.split(' ')[0];
  const [kids, setKids] = useState<StudentListItem[] | null>(null);
  const [activeKid, setActiveKid] = useState(0);
  const [announcements, setAnnouncements] = useState<AnnouncementDto[] | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => { api.students().then((r) => setKids(r.items)).catch(() => { setErr(true); setKids([]); }); }, []);
  useEffect(() => { api.announcements().then(setAnnouncements).catch(() => setAnnouncements([])); }, []);
  const kid = kids?.[activeKid];

  return (
    <PortalShell expectedSlug="parent" topbar={{ title: 'My Children', desc: "Your family's school life in one place", actions: <AskEduOS /> }}>
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
                    background: i === activeKid ? 'var(--accent)' : '#fff',
                    color: i === activeKid ? 'var(--on-accent)' : 'var(--text-2)',
                    borderColor: i === activeKid ? 'var(--accent)' : 'var(--input-border)',
                  }}>
                  {k.name.split(' ')[0]} · {k.enrollment?.class ?? '—'}
                </button>
              ))}
            </div>
          </div>

          <div className="card card-pad" style={{ background: 'var(--accent)', color: 'var(--on-accent)', marginBottom: 16 }}>
            <div style={{ fontFamily: 'Newsreader, serif', fontSize: 23, fontWeight: 600 }}>{greeting()}, {first ?? 'there'}!</div>
            <div style={{ fontSize: 13, opacity: 0.85, marginTop: 3 }}>
              Here's how {kid?.name} ({kid?.enrollment?.class}) is doing today · {today()}
            </div>
          </div>

          <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 18 }}>
            <StatCard label="Announcements" value={announcements ? announcements.length : '—'} delta="published" deltaDir="flat" />
            <StatCard label="Subjects" value="—" delta="after timetable setup" deltaDir="flat" />
            <StatCard label="Pending Tasks" value="—" delta="after assignments setup" deltaDir="flat" />
            <StatCard label="New Notices" value={announcements ? String(announcements.slice(0, 99).length) : '—'} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Upcoming Events</strong>
                <button
                  onClick={() => router.push('/parent/calendar')}
                  style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                  View all →
                </button>
              </div>
              <p style={{ fontSize: 12.5, color: 'var(--text-2b)' }}>
                Open the Calendar to see school events and holidays.
              </p>
            </Card>
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
