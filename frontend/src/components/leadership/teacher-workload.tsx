'use client';
import { useState } from 'react';
import { EmptyState } from '@/components/ui';
import { DataNote, Loadable, SectionCard, useLoad } from '@/components/ops/kit';
import { leadershipApi, type Workload } from '@/lib/leadership-api';

/**
 * Teaching load per teacher from the timetable: periods a week and per day,
 * classes, subjects, class-teacher duty, cover taken in the last 30 days and
 * leave this year. Teachers above the cap are flagged in words, not colour only.
 */
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FLAG_WORDS: Record<string, string> = { CLASH: 'Timetable clash', OVER_CAP: 'Over the cap', NO_PERIODS: 'No periods', HEAVY_DAY: '7+ periods in a day', MANY_COVERS: 'Many covers' };

export function TeacherWorkloadView() {
  const [cap, setCap] = useState(30);
  const [q, setQ] = useState('');
  const state = useLoad(() => leadershipApi.workload(cap), [cap]);
  return (
    <div className="ops-stack">
      <Loadable state={state}>{(d: Workload) => {
        const rows = d.teachers.filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()) || t.subjects.some((s) => s.toLowerCase().includes(q.toLowerCase())));
        const max = Math.max(d.cap, ...d.teachers.map((t) => t.periodsPerWeek), 1);
        return (
          <>
            <div className="lead-tiles">
              <div className="lead-tile"><div className="lead-tile-value">{d.summary.averagePeriods ?? '—'}</div><div className="lead-tile-label">Average periods a week</div><div className="lead-tile-sub">{d.summary.teachers} teachers</div></div>
              <div className="lead-tile"><div className="lead-tile-value" style={d.summary.overCap ? { color: 'var(--red)' } : undefined}>{d.summary.overCap}</div><div className="lead-tile-label">Over {d.cap} a week</div></div>
              <div className="lead-tile"><div className="lead-tile-value" style={d.summary.withClashes ? { color: 'var(--red)' } : undefined}>{d.summary.withClashes ?? 0}</div><div className="lead-tile-label">With timetable clashes</div><div className="lead-tile-sub">two classes at the same time</div></div>
              <div className="lead-tile"><div className="lead-tile-value">{d.summary.withoutPeriods}</div><div className="lead-tile-label">With no periods</div></div>
              <div className="lead-tile"><div className="lead-tile-value" style={d.summary.periodsWithoutTeacher ? { color: '#C9821B' } : undefined}>{d.summary.periodsWithoutTeacher}</div><div className="lead-tile-label">Periods with no teacher</div></div>
            </div>
            <div className="lead-filters">
              <label className="lead-filter"><span>Search</span><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Teacher or subject" aria-label="Search teachers" /></label>
              <label className="lead-filter"><span>Cap a week</span>
                <select className="input" value={cap} onChange={(e) => setCap(Number(e.target.value))} aria-label="Periods a week cap">
                  {[24, 26, 28, 30, 32, 34, 36].map((c) => <option key={c} value={c}>{c} periods</option>)}
                </select>
              </label>
            </div>
            <SectionCard title="Teachers" sub="Busiest first. The bar shows periods a week against the cap (the line).">
              {!rows.length ? <EmptyState title="No teachers" sub={q ? 'No teacher matches that search.' : 'Teachers appear once they have accounts.'} /> : (
                <div className="table-scroll">
                  <table className="data-table data-table-cards">
                    <thead><tr><th>Teacher</th><th>Periods a week</th><th>By day</th><th>Classes and subjects</th><th style={{ textAlign: 'right' }}>Cover (30 days)</th><th style={{ textAlign: 'right' }}>Leave this year</th></tr></thead>
                    <tbody>{rows.map((t) => (
                      <tr key={t.profileId}>
                        <td className="cell-primary" data-label="Teacher">
                          {t.name}
                          {t.classTeacherOf.length > 0 && <div className="ops-row-sub">Class teacher · {t.classTeacherOf.join(', ')}</div>}
                          {(t.clashCount ?? 0) > 0 && <div className="ops-row-sub" style={{ color: 'var(--red)' }}>{t.clashCount} clash{t.clashCount === 1 ? '' : 'es'}, e.g. {t.clashes![0].day} {t.clashes![0].at}: {t.clashes![0].classes.join(' and ')}</div>}
                          {t.flags.length > 0 && <div className="lead-flags">{t.flags.map((f) => <span key={f} className={`lead-flag lead-flag-${f.toLowerCase()}`}>{FLAG_WORDS[f] ?? f}</span>)}</div>}
                        </td>
                        <td data-label="Periods a week">
                          <div className="lead-bar" aria-label={`${t.periodsPerWeek} periods a week, cap ${d.cap}`}>
                            <div className={`lead-bar-fill${t.periodsPerWeek > d.cap ? ' over' : ''}`} style={{ width: `${(t.periodsPerWeek / max) * 100}%` }} />
                            <div className="lead-bar-cap" style={{ left: `${(d.cap / max) * 100}%` }} />
                          </div>
                          <b>{t.periodsPerWeek}</b>
                        </td>
                        <td data-label="By day" className="lead-days">{t.perDay.map((n, i) => <span key={DAYS[i]} title={`${DAYS[i]}: ${n}`} className={n >= 7 ? 'heavy' : ''}>{DAYS[i][0]}{n}</span>)}</td>
                        <td data-label="Classes and subjects" style={{ fontSize: 12.5 }}>
                          <div>{t.subjects.join(', ') || '—'}</div>
                          <div className="ops-row-sub">{t.classes.length ? `${t.classes.length} classes: ${t.classes.join(', ')}` : 'No classes'}</div>
                        </td>
                        <td data-label="Cover (30 days)" style={{ textAlign: 'right' }}>{t.coversLast30Days}</td>
                        <td data-label="Leave this year" style={{ textAlign: 'right' }}>{t.leaveDaysThisYear}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </SectionCard>
            <DataNote>{d.basis}</DataNote>
          </>
        );
      }}</Loadable>
    </div>
  );
}
