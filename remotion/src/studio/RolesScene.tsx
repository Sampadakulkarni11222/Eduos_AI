import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { slide } from '@remotion/transitions/slide';
import { BRAND, ROLE_THEME, RoleKey } from '../config';
import { BODY, DISPLAY } from '../fonts';
import { Parchment, LogoMark } from '../components/Brand';
import { BeatDuration, useBeatDuration } from '../components/duration';
import { Bars, Card, CardTitle, Donut, Rows, StatTile, Trend, ramp } from './ui';

/**
 * 51.1–68.5s — one simplified panel per role, in that portal's own colour.
 * Each panel shows the handful of things that portal opens on, named the way
 * EduOS names them; the figures are sample data.
 */
type RolePanel = {
  role: RoleKey;
  headline: string;
  stats: { label: string; value: number; prefix?: string; suffix?: string; sub?: string }[];
  widget: (t: number, accent: string) => React.ReactNode;
  list: { title: string; rows: { left: string; sub?: string; right?: string; tone?: string }[] };
};

const PANELS: RolePanel[] = [
  {
    role: 'admin',
    headline: 'School overview, users, academics and finance',
    stats: [
      { label: 'Students', value: 1248, sub: 'active enrolments' },
      { label: 'Staff', value: 86, sub: 'teaching and admin' },
      { label: 'Collected', value: 184, prefix: '₹', suffix: 'L', sub: '78% of billed' },
    ],
    widget: (t, accent) => <Trend points={[40, 52, 61, 74, 88, 96]} t={t} accent={accent} width={380} height={104} />,
    list: {
      title: 'Needs attention',
      rows: [
        { left: 'Open support tickets', right: '7', tone: BRAND.amber },
        { left: 'Admission enquiries', right: '14', tone: BRAND.blue },
        { left: 'Announcements published', right: '3', tone: BRAND.green },
      ],
    },
  },
  {
    role: 'teacher',
    headline: "Today's classes, attendance, assignments and progress",
    stats: [
      { label: "Today's Classes", value: 4, sub: 'across 3 sections' },
      { label: 'To Grade', value: 18, sub: 'submissions' },
      { label: 'Attendance', value: 94, suffix: '%', sub: 'marked today' },
    ],
    widget: (t, accent) => <Bars data={[{ label: 'Mon', value: 92 }, { label: 'Tue', value: 95 }, { label: 'Wed', value: 90 }, { label: 'Thu', value: 94 }, { label: 'Fri', value: 97 }]} t={t} accent={accent} height={104} />,
    list: {
      title: "Today's timetable",
      rows: [
        { left: 'Mathematics', sub: 'Period 1 · Class 8 A', right: '08:30' },
        { left: 'Mathematics', sub: 'Period 3 · Class 9 B', right: '10:15' },
        { left: 'Exams & Performance', sub: 'Unit Test 1 · marks due', right: '5 Nov', tone: BRAND.amber },
      ],
    },
  },
  {
    role: 'student',
    headline: 'Timetable, assignments, results and study help',
    stats: [
      { label: 'Attendance', value: 96, suffix: '%', sub: 'this month' },
      { label: 'Due this week', value: 3, sub: 'assignments' },
      { label: 'Average', value: 84, suffix: '%', sub: 'last assessment' },
    ],
    widget: (t, accent) => <Donut pct={96} t={t} accent={accent} size={120} caption="Attendance" />,
    list: {
      title: 'My assignments',
      rows: [
        { left: 'Chapter 2 Worksheet', sub: 'Mathematics · due 30 Sept', right: 'submit', tone: BRAND.amber },
        { left: 'Science practical', sub: 'due 2 Oct', right: 'open', tone: BRAND.blue },
        { left: 'Chapter 1 Assignment', sub: 'graded 18/20', right: 'done', tone: BRAND.green },
      ],
    },
  },
  {
    role: 'parent',
    headline: "Your child's attendance, fees, progress and notices",
    stats: [
      { label: 'Attendance', value: 96, suffix: '%', sub: 'this month' },
      { label: 'Fees Pending', value: 45000, prefix: '₹', sub: '1 open invoice' },
      { label: 'Notices', value: 2, sub: 'this week' },
    ],
    widget: (t, accent) => <Trend points={[72, 78, 81, 84, 88]} t={t} accent={accent} width={380} height={104} />,
    list: {
      title: 'This week',
      rows: [
        { left: 'Parent–Teacher Meeting', sub: 'Fri, 25 Sept', right: 'event', tone: BRAND.blue },
        { left: 'Fee due', sub: 'INV-2026-0001 · 15 Oct', right: 'pay', tone: BRAND.amber },
        { left: 'Maths unit test', sub: 'result published', right: '18/20', tone: BRAND.green },
      ],
    },
  },
  {
    role: 'warden',
    headline: 'Rooms, allocations and hostel welfare',
    stats: [
      { label: 'Rooms', value: 200, sub: '640 beds' },
      { label: 'Occupied', value: 78, suffix: '%', sub: '499 residents' },
      { label: 'Requests', value: 4, sub: 'maintenance' },
    ],
    widget: (t, accent) => <Donut pct={78} t={t} accent={accent} size={120} caption="Beds occupied" />,
    list: {
      title: 'Hostel activity',
      rows: [
        { left: 'Room allocation', sub: 'Block A · 3 students', right: 'done', tone: BRAND.green },
        { left: 'Leave approval', sub: 'weekend pass', right: 'pending', tone: BRAND.amber },
        { left: 'Medical lookup', sub: 'emergency contact', right: 'viewed' },
      ],
    },
  },
  {
    role: 'librarian',
    headline: 'Catalogue, lending and student access',
    stats: [
      { label: 'Catalogue', value: 4820, sub: 'copies' },
      { label: 'On loan', value: 312, sub: 'in circulation' },
      { label: 'Overdue', value: 9, sub: 'to follow up' },
    ],
    widget: (t, accent) => <Bars data={[{ label: 'Mon', value: 38 }, { label: 'Tue', value: 44 }, { label: 'Wed', value: 31 }, { label: 'Thu', value: 49 }, { label: 'Fri', value: 41 }]} t={t} accent={accent} height={104} />,
    list: {
      title: 'Lending desk',
      rows: [
        { left: 'The Alchemist', sub: 'issued · due 6 Oct', right: 'out', tone: ROLE_THEME.librarian.accent },
        { left: 'Book request', sub: 'Class 9 · awaiting approval', right: 'new', tone: BRAND.blue },
        { left: 'Returned today', sub: '11 copies', right: 'in', tone: BRAND.green },
      ],
    },
  },
  {
    role: 'principal',
    headline: 'School intelligence, risk and fee health',
    stats: [
      { label: 'Attendance', value: 94, suffix: '%', sub: 'school-wide' },
      { label: 'Flagged', value: 39, sub: 'signals to review' },
      { label: 'Collection', value: 78, suffix: '%', sub: 'of billed fees' },
    ],
    widget: (t, accent) => <Trend points={[62, 70, 68, 79, 88, 94]} t={t} accent={accent} width={380} height={104} />,
    list: {
      title: 'Needs attention first',
      rows: [
        { left: 'Attendance below threshold', sub: 'Class 7 B · 2 students', right: 'high', tone: BRAND.red },
        { left: 'Fee follow-up', sub: '12 families', right: 'medium', tone: BRAND.amber },
        { left: 'Teacher workload', sub: 'balanced', right: 'clear', tone: BRAND.green },
      ],
    },
  },
];

const Panel: React.FC<{ p: RolePanel }> = ({ p }) => {
  const frame = useCurrentFrame();
  const D = useBeatDuration();
  const t = frame / Math.max(1, D - 1);
  const theme = ROLE_THEME[p.role];
  const head = ramp(t, 0.02, 0.24);
  const stats = ramp(t, 0.12, 0.5);
  const body = ramp(t, 0.24, 0.66);

  return (
    <AbsoluteFill>
      <Parchment />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: '0 120px' }}>
        <div
          style={{
            width: 1560,
            borderRadius: 24,
            overflow: 'hidden',
            border: `1px solid ${BRAND.hairline}`,
            boxShadow: '0 46px 100px -40px rgba(58,34,41,.5)',
            background: BRAND.parchment,
            opacity: ramp(t, 0, 0.16),
            transform: `scale(${0.985 + ramp(t, 0, 0.16) * 0.015})`,
          }}
        >
          {/* role header band */}
          <div
            style={{
              background: theme.accent,
              padding: '22px 30px',
              display: 'flex',
              alignItems: 'center',
              gap: 18,
              opacity: head,
            }}
          >
            <LogoMark size={40} />
            <div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 34, color: theme.onAccent, lineHeight: 1.05 }}>{theme.label}</div>
              <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 15, letterSpacing: '.05em', color: theme.onAccent, opacity: 0.72 }}>
                {theme.portal}
              </div>
            </div>
            <div style={{ marginLeft: 'auto', fontFamily: BODY, fontWeight: 600, fontSize: 18, color: theme.onAccent, opacity: 0.9 }}>{p.headline}</div>
          </div>

          <div style={{ padding: 26, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {p.stats.map((s, i) => (
              <StatTile
                key={s.label}
                label={s.label}
                value={s.value}
                prefix={s.prefix}
                suffix={s.suffix}
                sub={s.sub}
                accent={theme.accent}
                t={ramp(stats, i * 0.12, i * 0.12 + 0.55)}
              />
            ))}
          </div>

          <div style={{ padding: '0 26px 26px', display: 'grid', gridTemplateColumns: '1fr 1.15fr', gap: 16 }}>
            <Card t={ramp(body, 0, 0.45)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              {p.widget(ramp(body, 0.2, 1), theme.accent)}
            </Card>
            <Card t={ramp(body, 0.12, 0.55)}>
              <CardTitle>{p.list.title}</CardTitle>
              <Rows rows={p.list.rows} t={ramp(body, 0.3, 1)} dense />
            </Card>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const RolesScene: React.FC = () => {
  const D = useBeatDuration();
  const overlap = 12;
  const available = D + overlap * (PANELS.length - 1);
  const each = Math.floor(available / PANELS.length);
  const lengths = PANELS.map((_, i) => (i === PANELS.length - 1 ? available - each * (PANELS.length - 1) : each));

  return (
    <AbsoluteFill>
      <Parchment />
      <TransitionSeries>
        {PANELS.map((p, i) => (
          <React.Fragment key={p.role}>
            {i > 0 && (
              <TransitionSeries.Transition
                presentation={slide({ direction: 'from-right' })}
                timing={linearTiming({ durationInFrames: overlap })}
              />
            )}
            <TransitionSeries.Sequence durationInFrames={lengths[i]}>
              <BeatDuration frames={lengths[i]}>
                <Panel p={p} />
              </BeatDuration>
            </TransitionSeries.Sequence>
          </React.Fragment>
        ))}
      </TransitionSeries>
    </AbsoluteFill>
  );
};
