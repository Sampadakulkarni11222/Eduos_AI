import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { BRAND, ROLE_THEME } from '../config';
import { BODY } from '../fonts';
import { Parchment } from '../components/Brand';
import { useBeatDuration } from '../components/duration';
import { APP_H, APP_W, AppWindow, Bars, Card, CardTitle, Cursor, Donut, NavItem, Rows, Stage, StatTile, Trend, ramp } from './ui';

/**
 * 7.4–27.3s — the hero. A redrawn EduOS admin console: the shell builds, the
 * statistics count up, the charts draw, the lists slide in, a pointer moves
 * and clicks, and the camera pushes into the two areas that matter.
 *
 * The module names are the product's own (portals.ts). The figures are sample
 * data for a demonstration school — nothing here is measured from anything.
 */
const NAV: NavItem[] = [
  { icon: '◫', label: 'Dashboard' },
  { icon: '◉', label: 'User Management' },
  { icon: '☱', label: 'Attendance' },
  { icon: '▥', label: 'Timetable Builder' },
  { icon: '✎', label: 'Assignments' },
  { icon: '₹', label: 'Payments & Fees' },
  { icon: '◌', label: 'Admission CRM' },
  { icon: '▢', label: 'Library Books' },
  { icon: '▤', label: 'Calendar & Events' },
  { icon: '◍', label: 'Announcements' },
];

const WEEK = [
  { label: 'Mon', value: 92 },
  { label: 'Tue', value: 95 },
  { label: 'Wed', value: 89 },
  { label: 'Thu', value: 94 },
  { label: 'Fri', value: 96 },
];

const TIMETABLE = [
  { left: 'Mathematics', sub: 'Period 1 · Class 8 A', right: '08:30' },
  { left: 'Science', sub: 'Period 2 · Class 8 A', right: '09:15' },
  { left: 'English', sub: 'Period 3 · Class 8 B', right: '10:15' },
  { left: 'Social Science', sub: 'Period 4 · Class 9 A', right: '11:00' },
];

const NOTICES = [
  { left: 'Annual Sports Day', sub: 'Published to the whole school', right: '5 Oct', tone: BRAND.green },
  { left: 'Parent–Teacher Meeting', sub: 'Classes 5 to 8', right: '25 Sept', tone: BRAND.blue },
  { left: 'Half-yearly timetable', sub: 'Exams & Academics', right: '18 Sept', tone: BRAND.amber },
];

const ACTIVITY = [
  { left: 'Attendance marked', sub: 'Class 8 A · 42 present', right: 'now' },
  { left: 'Fee receipt issued', sub: 'INV-2026-0148 · ₹45,000', right: '12 min' },
  { left: 'Assignment graded', sub: 'Chapter 2 Worksheet', right: '1 hr' },
];

export const DashboardScene: React.FC = () => {
  const frame = useCurrentFrame();
  const D = useBeatDuration();
  const p = frame / Math.max(1, D - 1);

  const build = ramp(p, 0, 0.22);
  const stats = ramp(p, 0.1, 0.34);
  const charts = ramp(p, 0.22, 0.54);
  const lists = ramp(p, 0.32, 0.66);
  const cursor = ramp(p, 0.58, 0.82);

  const theme = ROLE_THEME.admin;

  return (
    <AbsoluteFill>
      <Parchment />
      <Stage
        progress={p}
        keys={[
          { at: 0, x: APP_W / 2, y: APP_H / 2, z: 0.96 },
          { at: 0.34, x: APP_W / 2, y: APP_H / 2, z: 1.0 },
          // into the statistics row
          { at: 0.5, x: 860, y: 300, z: 1.28 },
          // across to the charts
          { at: 0.72, x: 900, y: 520, z: 1.26 },
          { at: 1, x: APP_W / 2, y: APP_H / 2 + 20, z: 1.02 },
        ]}
      >
        <AppWindow
          accent={theme.accent}
          onAccent={theme.onAccent}
          portal="Admin Console"
          nav={NAV}
          active={0}
          title="Dashboard"
          sub="School operations at a glance"
          build={build}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 14 }}>
            <StatTile label="Total Students" value={1248} t={ramp(stats, 0, 0.55)} sub="active enrolments" accent={theme.accent} />
            <StatTile label="Teaching Staff" value={86} t={ramp(stats, 0.1, 0.65)} sub="across 12 departments" accent={theme.accent} />
            <StatTile label="Attendance Today" value={94} suffix="%" t={ramp(stats, 0.2, 0.75)} sub="1,173 present" accent={BRAND.green} />
            <StatTile label="Fees Collected" value={184} prefix="₹" suffix="L" t={ramp(stats, 0.3, 0.85)} sub="78% of billed" accent={theme.accent} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 0.75fr 1.4fr', gap: 14, marginBottom: 14 }}>
            <Card t={ramp(charts, 0, 0.4)}>
              <CardTitle right="Attendance ↗">Attendance this week</CardTitle>
              <Bars data={WEEK} t={ramp(charts, 0.15, 1)} accent={BRAND.green} />
            </Card>
            <Card t={ramp(charts, 0.1, 0.5)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <Donut pct={94} t={ramp(charts, 0.25, 1)} accent={BRAND.green} caption="Present today" />
            </Card>
            <Card t={ramp(charts, 0.2, 0.6)}>
              <CardTitle right="Fee health →">Fee collection</CardTitle>
              <Trend points={[42, 58, 51, 74, 88, 96, 120]} t={ramp(charts, 0.35, 1)} accent={theme.accent} width={430} height={112} />
            </Card>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            <Card t={ramp(lists, 0, 0.45)}>
              <CardTitle right="Timetable →">Today&apos;s classes</CardTitle>
              <Rows rows={TIMETABLE} t={ramp(lists, 0.12, 1)} dense />
            </Card>
            <Card t={ramp(lists, 0.1, 0.55)}>
              <CardTitle right="View all">Notices</CardTitle>
              <Rows rows={NOTICES} t={ramp(lists, 0.22, 1)} dense />
            </Card>
            <Card t={ramp(lists, 0.2, 0.65)}>
              <CardTitle right="Audit log →">Recent activity</CardTitle>
              <Rows rows={ACTIVITY} t={ramp(lists, 0.32, 1)} dense />
            </Card>
          </div>
        </AppWindow>

        {cursor > 0 && cursor < 1 && <Cursor from={[1180, 640]} to={[690, 330]} t={cursor} clickAt={0.78} />}
      </Stage>

      <div
        style={{
          position: 'absolute',
          left: 76,
          bottom: 54,
          opacity: ramp(p, 0.05, 0.16) * (1 - ramp(p, 0.36, 0.46)),
          fontFamily: BODY,
          fontWeight: 800,
          fontSize: 17,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          color: BRAND.gold,
        }}
      >
        The EduOS dashboard
      </div>
    </AbsoluteFill>
  );
};
