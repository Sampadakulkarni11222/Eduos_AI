'use client';
import { useEffect, useMemo, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { TimetableCalendar } from '@/components/timetable/timetable-calendar';
import { Card, EmptyState, SkeletonRows, StatCard } from '@/components/ui';
import { api } from '@/lib/api';
import type { SectionDto, TimetableSlotDto } from '@/lib/types';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface MySlot extends TimetableSlotDto {
  className: string;
}

/** Occurrences of each weekday (1=Mon…7=Sun) within a given calendar month. */
function weekdayOccurrencesInMonth(year: number, monthIndex: number): Record<number, number> {
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const jsDay = new Date(year, monthIndex, d).getDay(); // 0=Sun..6=Sat
    counts[jsDay === 0 ? 7 : jsDay]++;
  }
  return counts;
}

export default function TeacherTimetable() {
  const [sections, setSections] = useState<SectionDto[] | null>(null);
  const [slots, setSlots] = useState<MySlot[] | null>(null);
  const [err, setErr] = useState(false);
  const [dayFilter, setDayFilter] = useState('');
  const [periodFilter, setPeriodFilter] = useState('');
  const [timeFilter, setTimeFilter] = useState('');

  useEffect(() => {
    api.mySections().then(async (secs) => {
      setSections(secs);
      const perSection = await Promise.all(
        secs.map((s) => api.timetable(s.id).then((tt) => tt.slots.map((slot) => ({ ...slot, className: `${s.gradeName} ${s.name}` }))).catch(() => [])),
      );
      setSlots(perSection.flat().filter((s) => !s.isBreak));
    }).catch(() => { setSections(null); setSlots(null); setErr(true); });
  }, []);

  const summary = useMemo(() => {
    if (!slots) return null;
    const now = new Date();
    const todayDow = now.getDay() === 0 ? 7 : now.getDay();
    const monthOccurrences = weekdayOccurrencesInMonth(now.getFullYear(), now.getMonth());
    return {
      today: slots.filter((s) => s.dayOfWeek === todayDow).length,
      thisWeek: slots.length,
      thisMonth: slots.reduce((sum, s) => sum + (monthOccurrences[s.dayOfWeek] ?? 0), 0),
    };
  }, [slots]);

  const periodOptions = useMemo(
    () => Array.from(new Set((slots ?? []).map((s) => s.periodNo))).sort((a, b) => a - b),
    [slots],
  );
  const timeOptions = useMemo(
    () => Array.from(new Set((slots ?? []).map((s) => `${s.startTime}-${s.endTime}`))).sort(),
    [slots],
  );

  const filtered = (slots ?? [])
    .filter((s) => !dayFilter || s.dayOfWeek === Number(dayFilter))
    .filter((s) => !periodFilter || s.periodNo === Number(periodFilter))
    .filter((s) => !timeFilter || `${s.startTime}-${s.endTime}` === timeFilter)
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.periodNo - b.periodNo);

  const filtering = !!(dayFilter || periodFilter || timeFilter);

  return (
    <PortalShell expectedSlug="teacher" topbar={{ title: 'Timetable', desc: 'Weekly schedule for your sections.' }}>
      {slots === null && !err && <Card><SkeletonRows rows={4} /></Card>}
      {err && <EmptyState title="Couldn't load timetable" sub="Check your connection and reload the page." />}

      {slots && slots.length > 0 && (
        <>
          <div className="card-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: 18 }}>
            <StatCard label="Today" value={summary!.today} />
            <StatCard label="This Week" value={summary!.thisWeek} />
            <StatCard label="This Month" value={summary!.thisMonth} />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16, alignItems: 'center' }}>
            <select className="input" value={dayFilter} onChange={(e) => setDayFilter(e.target.value)} aria-label="Filter by day" style={{ maxWidth: 160, flex: '1 1 140px' }}>
              <option value="">All Days</option>
              {DAYS.map((name, i) => <option key={i} value={i + 1}>{name}</option>)}
            </select>
            <select className="input" value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)} aria-label="Filter by class/period" style={{ maxWidth: 160, flex: '1 1 140px' }}>
              <option value="">All Periods</option>
              {periodOptions.map((p) => <option key={p} value={p}>P{p}</option>)}
            </select>
            <select className="input" value={timeFilter} onChange={(e) => setTimeFilter(e.target.value)} aria-label="Filter by time" style={{ maxWidth: 180, flex: '1 1 160px' }}>
              <option value="">All Times</option>
              {timeOptions.map((t) => <option key={t} value={t}>{t.replace('-', ' – ')}</option>)}
            </select>
            {filtering && (
              <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                {filtered.length} match{filtered.length !== 1 ? 'es' : ''}
              </span>
            )}
          </div>

          {slots.length === 0 && !err && <EmptyState title="No classes yet" sub="Your periods appear here once the timetable is built." />}
          {slots.length > 0 && filtered.length === 0 && <EmptyState title="No match" sub="No periods match these filters." />}

          {filtered.length > 0 && (
            <Card pad={false} style={{ marginBottom: 24 }}>
              <table className="data-table data-table-cards">
                <thead><tr><th>Day</th><th>Period</th><th>Time</th><th>Subject</th><th>Class</th></tr></thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr key={s.id}>
                      <td data-label="Day">{DAYS[s.dayOfWeek - 1] ?? `Day ${s.dayOfWeek}`}</td>
                      <td data-label="Period">P{s.periodNo}</td>
                      <td data-label="Time">{s.startTime} - {s.endTime}</td>
                      <td className="cell-primary" data-label="Subject">{s.subject ?? '—'}</td>
                      <td data-label="Class">{s.className}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}

      <TimetableCalendar scopeLabel="Your weekly periods" />
    </PortalShell>
  );
}
