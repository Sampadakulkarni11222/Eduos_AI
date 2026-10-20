'use client';
import { useState } from 'react';
import { EmptyState, Field } from '@/components/ui';
import { presenceApi } from '@/lib/p2-api';
import { DataNote, Loadable, SectionCard, StatusPill, Tile, fmtDateTime, isoDay, useLoad } from './kit';

/**
 * Teacher presence: for each timetabled lesson today, whether the teacher
 * (or a substitute) checked in, and how: a tap on Class check-in, or a
 * camera observation of "teacher present" that a trained reviewer
 * confirmed. The timetable names the teacher; no camera identifies anyone.
 */
const STATUS: Record<string, [string, string]> = {
  PRESENT: ['COMPLETED', 'In class'],
  COVER_PRESENT: ['COMPLETED', 'Cover in class'],
  NOT_CHECKED_IN: ['PENDING', 'No check-in yet'],
  UPCOMING: ['DRAFT', 'Later today'],
};

export function PresenceView() {
  const [date, setDate] = useState(isoDay());
  const state = useLoad(() => presenceApi.board(date), [date]);
  const [period, setPeriod] = useState('');
  return (
    <div className="ops-stack">
      <div className="ops-inline"><Field label="Day"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field></div>
      <Loadable state={state}>{(d) => (
        <>
          <div className="kpi-grid">
            <Tile label="Lessons timetabled" value={d.counts.lessons} />
            <Tile label="Teacher in class" value={d.counts.present} tone="good" />
            <Tile label="No check-in yet" value={d.counts.notCheckedIn} tone={d.counts.notCheckedIn ? 'warn' : 'good'} />
            <Tile label="Confirmed from a reviewed camera observation" value={d.counts.viaCamera} />
          </div>
          {!d.rows.length ? <EmptyState title="Nothing timetabled" sub="No lessons are timetabled on this day." /> : (
            <SectionCard title="By period" actions={<select className="input" aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value)}><option value="">All periods</option>{[...new Set(d.rows.map((r) => r.periodNo))].map((p) => <option key={p} value={p}>Period {p}</option>)}</select>}>
              <ul className="ops-list">{d.rows.filter((r) => !period || String(r.periodNo) === period).map((r) => {
                const [tone, label] = STATUS[r.status] ?? ['DRAFT', r.status];
                return (
                  <li key={`${r.sectionId}-${r.periodNo}`} className="ops-row">
                    <div className="ops-row-main">
                      <div className="ops-row-title">P{r.periodNo} · {r.className} · {r.subject ?? 'Lesson'}</div>
                      <div className="ops-row-sub">{r.time}{r.room ? ` · ${r.room}` : ''} · {r.teacherName ?? 'No teacher assigned'}{r.checkIn ? ` · ${r.checkIn.source === 'CAMERA_REVIEWED' ? 'reviewer-confirmed observation' : 'checked in'} ${fmtDateTime(r.checkIn.at)}${r.checkIn.covering ? ` (cover: ${r.checkIn.name})` : ''}` : ''}</div>
                    </div>
                    <StatusPill status={tone} label={label} />
                  </li>
                );
              })}</ul>
            </SectionCard>
          )}
          <DataNote>{d.note}</DataNote>
        </>
      )}</Loadable>
    </div>
  );
}
