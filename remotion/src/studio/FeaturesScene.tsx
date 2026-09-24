import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { BRAND, ROLE_THEME } from '../config';
import { BODY, DISPLAY } from '../fonts';
import { Parchment } from '../components/Brand';
import { useBeatDuration } from '../components/duration';
import { Bars, Donut, Rows, Trend, ramp } from './ui';

/**
 * 31.2–51.1s — the modules, as cards. Four are introduced one at a time with
 * a small drawn illustration each, then all ten settle into a grid.
 *
 * Every card names a module EduOS actually ships (portals.ts / the module
 * folders under backend/src/modules).
 */
type Feature = {
  icon: string;
  title: string;
  desc: string;
  accent: string;
  mini: (t: number) => React.ReactNode;
};

const FEATURES: Feature[] = [
  {
    icon: '◉',
    title: 'Student Management',
    desc: 'Profiles, academics, attendance and records in one place.',
    accent: ROLE_THEME.admin.accent,
    mini: (t) => <Rows t={t} dense rows={[{ left: 'Diya Sharma', sub: 'Class 5 A · ADM-2026-0001', right: 'active', tone: BRAND.green }, { left: 'Kabir Sharma', sub: 'Class 5 A · ADM-2026-0002', right: 'active', tone: BRAND.green }]} />,
  },
  {
    icon: '☱',
    title: 'Attendance',
    desc: 'Mark and track attendance across classes, day by day.',
    accent: BRAND.green,
    mini: (t) => <Bars t={t} accent={BRAND.green} height={92} data={[{ label: 'M', value: 92 }, { label: 'T', value: 95 }, { label: 'W', value: 89 }, { label: 'T', value: 94 }, { label: 'F', value: 96 }]} />,
  },
  {
    icon: '▥',
    title: 'Timetable',
    desc: 'Plan and publish class schedules for every section.',
    accent: ROLE_THEME.teacher.accent,
    mini: (t) => <Rows t={t} dense rows={[{ left: 'Mathematics', sub: 'Period 1 · 08:30', right: '8 A' }, { left: 'Science', sub: 'Period 2 · 09:15', right: '8 A' }]} />,
  },
  {
    icon: '✎',
    title: 'Assignments & Exams',
    desc: 'Create, collect and grade academic assessments.',
    accent: ROLE_THEME.student.accent,
    mini: (t) => <Rows t={t} dense rows={[{ left: 'Chapter 2 Worksheet', sub: 'due 30 Sept', right: 'graded', tone: BRAND.green }, { left: 'Unit Test 1', sub: 'Science · 5 Nov', right: 'upcoming', tone: BRAND.amber }]} />,
  },
  {
    icon: '₹',
    title: 'Fees & Finance',
    desc: 'Invoices, online payments, receipts and collection health.',
    accent: ROLE_THEME.admin.accent,
    mini: (t) => <Trend t={t} accent={ROLE_THEME.admin.accent} points={[40, 55, 62, 78, 96]} width={250} height={84} />,
  },
  {
    icon: '▦',
    title: 'Hostel Management',
    desc: 'Rooms, allocations and day-to-day hostel operations.',
    accent: ROLE_THEME.warden.accent,
    mini: (t) => <Donut pct={78} t={t} accent={ROLE_THEME.warden.accent} size={92} caption="Beds occupied" />,
  },
  {
    icon: '▢',
    title: 'Library',
    desc: 'Catalogue, lending, returns and student access.',
    accent: ROLE_THEME.librarian.accent,
    mini: (t) => <Rows t={t} dense rows={[{ left: 'The Alchemist', sub: 'issued · due 6 Oct', right: 'out', tone: ROLE_THEME.librarian.accent }, { left: 'Wings of Fire', sub: 'available', right: 'in', tone: BRAND.green }]} />,
  },
  {
    icon: '◌',
    title: 'Admissions CRM',
    desc: 'Capture and track prospective families through the pipeline.',
    accent: ROLE_THEME.principal.accent,
    mini: (t) => <Rows t={t} dense rows={[{ left: 'New enquiries', right: '14', tone: BRAND.blue }, { left: 'Tour scheduled', right: '6', tone: BRAND.amber }]} />,
  },
  {
    icon: '▤',
    title: 'Calendar & Events',
    desc: 'Keep the whole school on one schedule.',
    accent: ROLE_THEME.parent.accent,
    mini: (t) => <Rows t={t} dense rows={[{ left: 'Annual Sports Day', sub: 'Mon, 5 Oct', right: 'event', tone: BRAND.green }, { left: 'Diwali Break', sub: '8–12 Nov', right: 'holiday', tone: BRAND.amber }]} />,
  },
  {
    icon: '◍',
    title: 'Communication',
    desc: 'Announcements, queries and notifications across every role.',
    accent: ROLE_THEME.superAdmin.accent,
    mini: (t) => <Rows t={t} dense rows={[{ left: 'Announcement posted', sub: 'to the whole school', right: 'sent', tone: BRAND.green }, { left: 'Parent query', sub: 'awaiting reply', right: 'open', tone: BRAND.blue }]} />,
  },
];

const FeatureCard: React.FC<{ f: Feature; t: number; big?: boolean; mini?: number }> = ({ f, t, big, mini = 1 }) => (
  <div
    style={{
      background: BRAND.card,
      border: `1px solid ${BRAND.cardBorder}`,
      borderRadius: big ? 22 : 18,
      padding: big ? '34px 36px' : '22px 24px',
      boxShadow: big ? '0 40px 80px -36px rgba(58,34,41,.5)' : '0 22px 46px -30px rgba(58,34,41,.42)',
      opacity: t,
      transform: `translateY(${(1 - t) * 34}px) scale(${0.97 + t * 0.03})`,
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: big ? 16 : 12 }}>
      <div
        style={{
          width: big ? 62 : 44,
          height: big ? 62 : 44,
          borderRadius: big ? 16 : 12,
          background: `linear-gradient(150deg, ${BRAND.cream1}, ${BRAND.cream2})`,
          color: f.accent,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: big ? 28 : 20,
          transform: `scale(${0.8 + t * 0.2})`,
        }}
      >
        {f.icon}
      </div>
      <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: big ? 38 : 23, lineHeight: 1.1, color: f.accent }}>{f.title}</div>
    </div>
    <div style={{ fontFamily: BODY, fontWeight: 500, fontSize: big ? 23 : 15, lineHeight: 1.45, color: BRAND.text2, marginBottom: big ? 24 : 14 }}>
      {f.desc}
    </div>
    <div style={{ marginTop: 'auto', background: BRAND.panel, borderRadius: 12, padding: big ? 18 : 12, border: `1px solid ${BRAND.hairline}` }}>
      {f.mini(mini)}
    </div>
  </div>
);

export const FeaturesScene: React.FC = () => {
  const frame = useCurrentFrame();
  const D = useBeatDuration();
  const p = frame / Math.max(1, D - 1);

  // Four cards introduced one at a time, then the full grid.
  const SPOT_END = 0.52;
  const spotlight = 1 - ramp(p, SPOT_END - 0.04, SPOT_END + 0.04);
  const gridIn = ramp(p, SPOT_END, SPOT_END + 0.12);

  const slot = SPOT_END / 4;
  const spotIndex = Math.min(3, Math.floor(p / slot));
  const local = (p - spotIndex * slot) / slot;

  return (
    <AbsoluteFill>
      <Parchment />

      {/* one at a time */}
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: spotlight }}>
        <div style={{ width: 860, height: 412 }}>
          <FeatureCard f={FEATURES[spotIndex]} t={ramp(local, 0.02, 0.32)} big mini={ramp(local, 0.2, 0.9)} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 30 }}>
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              style={{
                width: i === spotIndex ? 30 : 9,
                height: 9,
                borderRadius: 999,
                background: i === spotIndex ? BRAND.gold : BRAND.hairline,
              }}
            />
          ))}
        </div>
      </AbsoluteFill>

      {/* the whole set */}
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: '70px 90px', opacity: gridIn }}>
        <div
          style={{
            fontFamily: DISPLAY,
            fontWeight: 600,
            fontSize: 46,
            color: BRAND.maroon,
            marginBottom: 26,
            opacity: ramp(p, SPOT_END + 0.02, SPOT_END + 0.14),
          }}
        >
          Everything your school needs
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gridTemplateRows: 'repeat(2, 1fr)', gap: 18, width: '100%', height: 620 }}>
          {FEATURES.map((f, i) => {
            const t = ramp(p, SPOT_END + 0.06 + i * 0.022, SPOT_END + 0.2 + i * 0.022);
            return <FeatureCard key={f.title} f={f} t={t} mini={ramp(p, SPOT_END + 0.14 + i * 0.02, SPOT_END + 0.42 + i * 0.02)} />;
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
