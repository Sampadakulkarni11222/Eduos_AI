'use client';
import Link from 'next/link';
import { useState } from 'react';
import { DateField, EmptyState } from '@/components/ui';
import { DashChart } from '@/components/ops/dash-charts';
import { DataNote, Loadable, SectionCard, useLoad } from '@/components/ops/kit';
import { leadershipApi, type AttendanceOverview } from '@/lib/leadership-api';
import { usePortalHref } from '@/lib/school-path';

/**
 * The principal's school-wide attendance: every class over a period, today's
 * registers not yet taken, the day-by-day figure and the students below the
 * attendance threshold (75% by default, the CBSE board-exam line). Figures
 * come from whole-day registers; a class with nothing marked shows "—", never 0%.
 */
const pct = (v: number | null) => (v === null ? '—' : `${v}%`);
const tone = (v: number | null, t: number) => (v === null ? 'var(--text-faint)' : v < t ? 'var(--red)' : v < t + 10 ? '#C9821B' : 'var(--green)');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Tile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="lead-tile">
      <div className="lead-tile-value" style={color ? { color } : undefined}>{value}</div>
      <div className="lead-tile-label">{label}</div>
      {sub && <div className="lead-tile-sub">{sub}</div>}
    </div>
  );
}

export function AttendanceOverviewView() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [threshold, setThreshold] = useState(75);
  const href = usePortalHref();
  const state = useLoad(() => leadershipApi.attendanceOverview({ from: from || undefined, to: to || undefined, threshold }), [from, to, threshold]);

  return (
    <div className="ops-stack">
      <div className="lead-filters">
        <div className="lead-filter"><span>From</span><DateField className="date-field-inline" value={from} onChange={setFrom} ariaLabel="From" /></div>
        <div className="lead-filter"><span>To</span><DateField className="date-field-inline" value={to} onChange={setTo} ariaLabel="To" /></div>
        <label className="lead-filter"><span>Threshold</span>
          <select className="input" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} aria-label="Attendance threshold">
            {[60, 65, 70, 75, 80, 85, 90].map((t) => <option key={t} value={t}>{t}%</option>)}
          </select>
        </label>
      </div>
      <Loadable state={state}>{(d: AttendanceOverview) => (
        <>
          <div className="lead-tiles">
            <Tile label={`Overall, ${d.period.from} to ${d.period.to}`} value={pct(d.overall.pctPresent)} color={tone(d.overall.pctPresent, d.threshold)} sub={`${plural(d.period.days, 'school day')} with registers`} />
            <Tile label="Registers not taken today" value={d.today.schoolDay ? String(d.today.notMarked.length) : '—'} sub={d.today.schoolDay ? `of ${d.today.registers} classes${d.today.partlyMarked.length ? ` · ${d.today.partlyMarked.length} partly marked` : ''}` : 'Not a school day'} color={d.today.schoolDay && d.today.notMarked.length ? 'var(--red)' : undefined} />
            <Tile label={`Students below ${d.threshold}%`} value={String(d.belowThresholdTotal)} sub="in this period" color={d.belowThresholdTotal ? 'var(--red)' : 'var(--green)'} />
            <Tile label={`Classes below ${d.threshold}%`} value={String(d.classes.filter((c) => c.belowThreshold).length)} sub={`of ${d.classes.length}`} />
          </div>

          {d.today.schoolDay && (d.today.notMarked.length > 0 || d.today.partlyMarked.length > 0) && (
            <SectionCard title={`Today's registers (${d.today.date})`} sub="Classes whose whole-day register is not taken yet. Class teachers are named so you can follow up.">
              <ul className="ops-list">
                {d.today.notMarked.map((r) => <li key={r.sectionId} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{r.class}</div><div className="ops-row-sub">{r.classTeacher ? `Class teacher: ${r.classTeacher}` : 'No class teacher assigned'} · {plural(r.students, 'student')}</div></div><span className="ops-flag-overdue">NOT TAKEN</span></li>)}
                {d.today.partlyMarked.map((r) => <li key={r.sectionId} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{r.class}</div><div className="ops-row-sub">{r.classTeacher ? `Class teacher: ${r.classTeacher}` : 'No class teacher assigned'} · {r.marked} of {r.students} marked</div></div><span className="lead-flag-partial">PARTLY</span></li>)}
              </ul>
            </SectionCard>
          )}

          {d.trend.length > 1 && (
            <DashChart c={{
              key: 'att-trend', title: 'School attendance by day', type: 'line', unit: 'percent', link: null, status: 'OK', emptyText: 'No registers in this period.',
              definition: 'Present, late and excused as a share of students marked, whole-day registers, for each day a register was taken.',
              points: d.trend.map((p) => ({ label: p.date.slice(5).split('-').reverse().join('/'), value: p.pctPresent, detail: `${p.absent} absent of ${p.marked} marked`, tone: p.pctPresent !== null && p.pctPresent < d.threshold ? 'bad' : 'neutral' })),
            }} />
          )}

          <SectionCard title="Classes" sub={`Attendance over the period; red is below ${d.threshold}%.`}>
            {!d.classes.length ? <EmptyState title="No classes" sub="Classes appear once sections have students." /> : (
              <div className="table-scroll">
                <table className="data-table data-table-cards">
                  <thead><tr><th>Class</th><th style={{ textAlign: 'right' }}>Students</th><th style={{ textAlign: 'right' }}>Attendance</th><th style={{ textAlign: 'right' }}>Absences</th><th style={{ textAlign: 'right' }}>Late</th></tr></thead>
                  <tbody>{d.classes.map((c) => (
                    <tr key={c.sectionId}>
                      <td className="cell-primary" data-label="Class">{c.class}</td>
                      <td data-label="Students" style={{ textAlign: 'right' }}>{c.students}</td>
                      <td data-label="Attendance" style={{ textAlign: 'right', fontWeight: 700, color: tone(c.pctPresent, d.threshold) }}>{pct(c.pctPresent)}</td>
                      <td data-label="Absences" style={{ textAlign: 'right' }}>{c.ABSENT}</td>
                      <td data-label="Late" style={{ textAlign: 'right' }}>{c.LATE}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </SectionCard>

          <SectionCard title={`Students below ${d.threshold}%`} sub={d.belowThresholdTotal > d.belowThreshold.length ? `The lowest ${d.belowThreshold.length} of ${d.belowThresholdTotal}.` : 'Lowest first. Open a student to see their record, or start a support plan from Performance & Risk.'}>
            {!d.belowThreshold.length ? <p className="ops-muted">Nobody is below {d.threshold}% in this period.</p> : (
              <div className="table-scroll">
                <table className="data-table data-table-cards">
                  <thead><tr><th>Student</th><th>Class</th><th style={{ textAlign: 'right' }}>Attendance</th><th style={{ textAlign: 'right' }}>Days marked</th><th style={{ textAlign: 'right' }}>Absent</th></tr></thead>
                  <tbody>{d.belowThreshold.map((x) => (
                    <tr key={x.enrollmentId}>
                      <td className="cell-primary" data-label="Student">{x.name}{x.admissionNo ? <span className="ops-muted"> · {x.admissionNo}</span> : null}</td>
                      <td data-label="Class">{x.class}</td>
                      <td data-label="Attendance" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--red)' }}>{x.pctPresent}%</td>
                      <td data-label="Days marked" style={{ textAlign: 'right' }}>{x.daysMarked}</td>
                      <td data-label="Absent" style={{ textAlign: 'right' }}>{x.absent}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            <p style={{ marginTop: 8 }}><Link href={href('/risk')} className="lead-link">Performance &amp; Risk →</Link></p>
          </SectionCard>
          <DataNote>{d.basis}</DataNote>
        </>
      )}</Loadable>
    </div>
  );
}

