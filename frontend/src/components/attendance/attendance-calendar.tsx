'use client';
import { useEffect, useMemo, useState } from 'react';
import { Button, Card, EmptyState, SkeletonRows, StatCard, subjectColor } from '../ui';
import { api } from '@/lib/api';
import type { StudentListItem, TimetableDto, CalendarEventDto, LeaveApplicationDto, AttendanceTrendPointDto, SubjectAttendanceDto } from '@/lib/types';
import { addMonths, formatMonthLabel, isToday, startOfMonth, endOfMonth, toDow, toISODate } from '@/lib/timetable-dates';
import { AttendanceMonthGrid } from './attendance-month-grid';
import { AttendanceTrendChart } from './attendance-trend-chart';
import { ApplyLeaveModal } from './apply-leave-modal';
import { LeaveStatusList } from './leave-status-list';
import { ATTENDANCE_LEGEND, type DayInfo } from './attendance-status';

interface MonthSummary {
  PRESENT: number; ABSENT: number; LATE: number; EXCUSED: number; HALF_DAY: number;
  workingDays: number; pctPresent: number;
}

export function AttendanceCalendar() {
  const [student, setStudent] = useState<StudentListItem | null>(null);
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [tt, setTt] = useState<TimetableDto | null>(null);
  const [days, setDays] = useState<{ date: string; status: string }[]>([]);
  const [holidays, setHolidays] = useState<CalendarEventDto[]>([]);
  const [summary, setSummary] = useState<MonthSummary | null>(null);
  const [trend, setTrend] = useState<AttendanceTrendPointDto[]>([]);
  const [subjectAttendance, setSubjectAttendance] = useState<SubjectAttendanceDto | null>(null);
  const [leaveApps, setLeaveApps] = useState<LeaveApplicationDto[] | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showApplyLeave, setShowApplyLeave] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.students().then((r) => setStudent(r.items[0] ?? null)).catch(() => setStudent(null));
  }, []);

  const enrollmentId = student?.enrollment?.id ?? null;
  const sectionId = student?.enrollment?.sectionId ?? null;

  useEffect(() => {
    if (sectionId) api.timetable(sectionId).then(setTt).catch(() => setTt(null));
  }, [sectionId]);

  const loadLeave = () => {
    api.myLeaveApplications().then(setLeaveApps).catch(() => setLeaveApps([]));
  };
  useEffect(loadLeave, []);

  useEffect(() => {
    if (!enrollmentId) { setLoading(false); return; }
    setLoading(true);
    const month = `${anchorDate.getFullYear()}-${String(anchorDate.getMonth() + 1).padStart(2, '0')}`;
    const from = toISODate(startOfMonth(anchorDate));
    const to = toISODate(endOfMonth(anchorDate));

    Promise.allSettled([
      api.attendanceCalendar(enrollmentId, month).then((r) => setDays(r.days)).catch(() => setDays([])),
      api.calendar(from, to).then((events) => setHolidays(events.filter((e) => e.type === 'HOLIDAY'))).catch(() => setHolidays([])),
      api.attendanceSummary(enrollmentId, month).then(setSummary).catch(() => setSummary(null)),
      api.attendanceTrend(enrollmentId, 6).then(setTrend).catch(() => setTrend([])),
      api.attendanceSubjectWise(enrollmentId, month).then(setSubjectAttendance).catch(() => setSubjectAttendance(null)),
    ]).finally(() => setLoading(false));
  }, [enrollmentId, anchorDate]);

  // Subjects scheduled per weekday (1=Mon..7=Sun), derived from the timetable — no real
  // per-period attendance capture exists, so "subject-wise" is a display convenience.
  const subjectsByDow = useMemo(() => {
    const map = new Map<number, string[]>();
    if (!tt) return map;
    for (const slot of tt.slots) {
      if (slot.isBreak || !slot.subject) continue;
      const list = map.get(slot.dayOfWeek) ?? [];
      if (!list.includes(slot.subject)) list.push(slot.subject);
      map.set(slot.dayOfWeek, list);
    }
    return map;
  }, [tt]);

  const nonSchoolDows = useMemo(() => {
    const scheduled = new Set(subjectsByDow.keys());
    const all = new Set([1, 2, 3, 4, 5, 6, 7]);
    for (const d of scheduled) all.delete(d);
    return all;
  }, [subjectsByDow]);

  const allSubjects = useMemo(() => {
    const set = new Set<string>();
    subjectsByDow.forEach((list) => list.forEach((s) => set.add(s)));
    return Array.from(set).sort();
  }, [subjectsByDow]);

  const dayInfoByDate = useMemo(() => {
    const map = new Map<string, DayInfo>();
    const holidayDates = new Set<string>();
    for (const h of holidays) {
      let cursor = new Date(h.startsAt);
      const end = new Date(h.endsAt);
      cursor.setHours(0, 0, 0, 0);
      while (cursor <= end) {
        holidayDates.add(toISODate(cursor));
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
      }
    }
    const statusByDate = new Map(days.map((d) => [d.date, d.status]));

    // Build info for every day in the visible month grid range (cheap — ~42 days)
    const gridStart = new Date(anchorDate.getFullYear(), anchorDate.getMonth() - 1, 20);
    const gridEnd = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 2, 10);
    for (let d = new Date(gridStart); d <= gridEnd; d.setDate(d.getDate() + 1)) {
      const key = toISODate(d);
      const dow = toDow(d);
      map.set(key, {
        status: statusByDate.get(key) as DayInfo['status'],
        isHoliday: holidayDates.has(key),
        isNonSchoolDay: nonSchoolDows.has(dow),
        subjects: subjectsByDow.get(dow) ?? [],
      });
    }
    return map;
  }, [days, holidays, nonSchoolDows, subjectsByDow, anchorDate]);

  // Per-subject attendance now comes from the server, which groups real
  // attendance records by subject offering. It used to be derived here by
  // replaying each day's overall status onto every subject on that day's
  // timetable — which, for a subject taught daily, just restated the overall
  // percentage, so every subject showed the same number and looked hardcoded.
  const subjectBreakdown = subjectAttendance?.subjects ?? [];

  const selectedDayInfo = selectedDate ? dayInfoByDate.get(toISODate(selectedDate)) : null;

  if (!loading && !student) {
    return <EmptyState title="No student record linked" sub="Contact the administration office to link your student profile." />;
  }

  return (
    <>
      {/* Month navigation */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 19 }}>{formatMonthLabel(anchorDate)}</strong>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button variant="ghost" small onClick={() => setAnchorDate((d) => addMonths(d, -1))}>‹ Prev</Button>
          <Button variant="soft" small onClick={() => setAnchorDate(new Date())}>Today</Button>
          <Button variant="ghost" small onClick={() => setAnchorDate((d) => addMonths(d, 1))}>Next ›</Button>
          <Button small onClick={() => setShowApplyLeave(true)}>Apply Leave</Button>
        </div>
      </div>

      {loading && <Card><SkeletonRows rows={5} /></Card>}

      {!loading && student && (
        <>
          {/* Stat cards */}
          <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 16 }}>
            <StatCard
              label="Attendance %"
              value={summary ? `${summary.pctPresent}%` : '—'}
              deltaDir={summary && summary.pctPresent < 75 ? 'down' : 'flat'}
            />
            <StatCard label="Present" value={summary ? summary.PRESENT + summary.LATE : '—'} />
            <StatCard label="Absent" value={summary ? summary.ABSENT : '—'} deltaDir={summary && summary.ABSENT > 3 ? 'down' : 'flat'} />
            <StatCard label="Leave" value={summary ? summary.EXCUSED + summary.HALF_DAY : '—'} />
          </div>

          {summary && summary.pctPresent < 75 && (
            <div style={{ marginBottom: 16, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 13, color: '#b91c1c' }}>
              Attendance is below 75% this month. Please ensure regular attendance to avoid academic disruption.
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginBottom: 16 }}>
            {/* Calendar card */}
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Calendar</strong>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {ATTENDANCE_LEGEND.map((l) => (
                    <span key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-2b)' }}>
                      <span style={{ width: 9, height: 9, borderRadius: 3, background: l.bg, border: `1px solid ${l.text}` }} />
                      {l.label}
                    </span>
                  ))}
                </div>
              </div>

              {allSubjects.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                  <button
                    className={`chip-tab ${selectedSubject === null ? 'active' : ''}`}
                    onClick={() => setSelectedSubject(null)}
                  >
                    All subjects
                  </button>
                  {allSubjects.map((s) => (
                    <button
                      key={s}
                      className={`chip-tab ${selectedSubject === s ? 'active' : ''}`}
                      onClick={() => setSelectedSubject(selectedSubject === s ? null : s)}
                      style={selectedSubject === s ? { background: subjectColor(s).dot, borderColor: subjectColor(s).dot } : undefined}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              <AttendanceMonthGrid
                anchorDate={anchorDate}
                dayInfoByDate={dayInfoByDate}
                selectedSubject={selectedSubject}
                onDayClick={setSelectedDate}
              />
            </Card>

            {/* Trend + leave */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Card>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Attendance Trend</strong>
                <div style={{ marginTop: 10 }}>
                  <AttendanceTrendChart points={trend} />
                </div>
              </Card>

              <Card>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Leave Applications</strong>
                  <Button small variant="soft" onClick={() => setShowApplyLeave(true)}>+ Apply</Button>
                </div>
                {leaveApps === null ? <SkeletonRows rows={2} /> : <LeaveStatusList applications={leaveApps} />}
              </Card>
            </div>
          </div>

          {/* Subject-wise breakdown */}
          {subjectBreakdown.length > 0 && (
            <Card>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Subject-wise Attendance</strong>
              <p style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2, marginBottom: 12 }}>
                {subjectAttendance?.basis === 'PERIOD'
                  ? 'From per-period attendance records.'
                  : subjectAttendance?.basis === 'MIXED'
                    ? 'Subjects marked “approx.” have no per-period record yet — for those, the day’s overall status is applied to every subject timetabled that day.'
                    : 'Approximate: attendance here is recorded once per day, not per period, so each day’s status is applied to every subject timetabled that day.'}
              </p>
              <div className="card-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
                {subjectBreakdown.map(({ subject, present, absent, leave, totalSessions, pctPresent, derived }) => {
                  const color = subjectColor(subject);
                  return (
                    <div key={subject} style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid var(--hairline)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color.dot }} />
                        <span style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--text-1)' }}>{subject}</span>
                      </div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)' }}>
                        {pctPresent !== null ? `${pctPresent}%` : '—'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                        {present}P · {absent}A · {leave}L
                        {/* Marked rather than silently blended, so an exact figure is
                            never mistaken for an inferred one. */}
                        {derived && totalSessions > 0 && <span title="Derived from day-level attendance"> · approx.</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </>
      )}

      {/* Day detail modal */}
      {selectedDate && (
        <div className="modal-overlay" onClick={() => setSelectedDate(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                {selectedDate.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
                {isToday(selectedDate) ? ' (Today)' : ''}
              </div>
              <button className="modal-close" onClick={() => setSelectedDate(null)}>×</button>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 12 }}>
              Status: <strong style={{ color: 'var(--text-1)' }}>
                {selectedDayInfo?.isHoliday ? 'Holiday' : selectedDayInfo?.status ? selectedDayInfo.status.replace('_', ' ') : selectedDayInfo?.isNonSchoolDay ? 'Non-school day' : 'No record'}
              </strong>
            </div>
            {selectedDayInfo && selectedDayInfo.subjects.length > 0 && (
              <>
                <div className="field-label">Subjects scheduled that day</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {selectedDayInfo.subjects.map((s) => {
                    const color = subjectColor(s);
                    return (
                      <span key={s} style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 20, background: color.bg, color: color.text }}>
                        {s}
                      </span>
                    );
                  })}
                </div>
              </>
            )}
            <div style={{ marginTop: 16 }}>
              <Button variant="ghost" type="button" onClick={() => setSelectedDate(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}

      {showApplyLeave && (
        <ApplyLeaveModal
          onClose={() => setShowApplyLeave(false)}
          onApplied={() => { setShowApplyLeave(false); loadLeave(); }}
        />
      )}
    </>
  );
}
