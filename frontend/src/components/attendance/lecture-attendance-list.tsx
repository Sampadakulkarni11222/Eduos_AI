'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { LectureAttendanceDto, AttStatus } from '@/lib/types';
import { Card, DateRangeFilter, FilterBar, SearchInput, Select, SkeletonRows, matchesSearch } from '../ui';

/**
 * How each lecture outcome is presented.
 *
 * The word is the primary signal and the colour is secondary, everywhere.
 * Colour alone excludes anyone with a colour vision deficiency and disappears
 * entirely in a printed or high-contrast rendering — an absence has to be
 * legible as the word "Absent", not as a shade of red. The glyph is a third,
 * redundant channel for the same reason.
 *
 * These are the same greens, reds and ambers the calendar and its legend use
 * (see attendance-status.ts), so one status never means two things on the same
 * screen.
 */
const OUTCOME: Record<AttStatus, { text: string; bg: string; fg: string; glyph: string }> = {
  PRESENT:  { text: 'Present',       bg: '#E3EFE6', fg: 'var(--green)', glyph: '✓' },
  LATE:     { text: 'Present (late)', bg: '#E3EFE6', fg: 'var(--green)', glyph: '✓' },
  ABSENT:   { text: 'Absent',        bg: '#F6E1DF', fg: 'var(--red)',   glyph: '✕' },
  EXCUSED:  { text: 'Leave',         bg: '#F7ECD4', fg: 'var(--amber)', glyph: '•' },
  HALF_DAY: { text: 'Half day',      bg: '#F7ECD4', fg: 'var(--amber)', glyph: '◑' },
};

export function AttendanceStatusTag({ status }: { status: AttStatus }) {
  const o = OUTCOME[status] ?? OUTCOME.ABSENT;
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: o.bg, color: o.fg, border: `1px solid ${o.fg}33`,
        borderRadius: 20, padding: '3px 11px', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden="true">{o.glyph}</span>
      {o.text}
    </span>
  );
}

function fmtDay(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  // Built from the parts rather than parsed, so a YYYY-MM-DD string is not
  // read as UTC midnight and rendered as the previous day west of Greenwich.
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Lecture-by-lecture attendance.
 *
 * Only rows the school actually captured per period appear here — see
 * getLectureAttendance on the server. When a school marks attendance once a
 * day there are no lectures to show, and the panel says so rather than
 * fabricating one row per timetabled period from a single daily mark.
 */
export function LectureAttendanceList({ enrollmentId, month }: { enrollmentId: string | null; month: string }) {
  const [data, setData] = useState<LectureAttendanceDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState({ from: '', to: '' });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!enrollmentId) { setData(null); return; }
    setLoading(true);
    const query = range.from || range.to
      ? { from: range.from || undefined, to: range.to || undefined }
      : { month };
    let stale = false;
    api.attendanceLectures(enrollmentId, query)
      .then((r) => { if (!stale) setData(r); })
      .catch(() => { if (!stale) setData(null); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [enrollmentId, month, range.from, range.to]);

  const subjects = useMemo(
    () => [...new Set((data?.lectures ?? []).map((l) => l.subject).filter(Boolean) as string[])].sort(),
    [data],
  );
  const [subject, setSubject] = useState('');

  const rows = useMemo(() => (data?.lectures ?? []).filter((l) => {
    if (subject && l.subject !== subject) return false;
    if (status && l.status !== status) return false;
    return matchesSearch(search, [l.subject, l.teacher, l.room, OUTCOME[l.status]?.text, fmtDay(l.date)]);
  }), [data, subject, status, search]);

  return (
    <Card pad={false} style={{ marginTop: 16 }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--hairline)' }}>
        <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Lecture-wise attendance</strong>
        <p style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>
          Every class period your school recorded attendance for, marked Present or Absent.
        </p>
      </div>

      <div style={{ padding: '14px 20px 0' }}>
        <FilterBar>
          <SearchInput
            label="Search"
            value={search}
            onChange={setSearch}
            placeholder="Subject, teacher, room, status…"
          />
          <Select
            label="Subject"
            value={subject}
            placeholder="All subjects"
            onChange={setSubject}
            options={subjects.map((s) => ({ value: s, label: s }))}
          />
          <Select
            label="Outcome"
            value={status}
            placeholder="All outcomes"
            onChange={setStatus}
            options={[
              { value: 'PRESENT', label: 'Present' },
              { value: 'ABSENT', label: 'Absent' },
              { value: 'LATE', label: 'Present (late)' },
              { value: 'EXCUSED', label: 'Leave' },
              { value: 'HALF_DAY', label: 'Half day' },
            ]}
          />
          <DateRangeFilter label="Date" from={range.from} to={range.to} onChange={setRange} />
        </FilterBar>
      </div>

      {loading && <div style={{ padding: 20 }}><SkeletonRows rows={3} /></div>}

      {!loading && (!data || data.lectures.length === 0) && (
        <p style={{ fontSize: 12.5, color: 'var(--text-2b)', padding: '4px 20px 20px' }}>
          No per-lecture attendance has been recorded for this period. Your school currently marks
          attendance once a day — that is shown in the calendar above.
        </p>
      )}

      {!loading && data && data.lectures.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', padding: '0 20px 12px', fontSize: 12.5, color: 'var(--text-2)' }}>
            <span><strong style={{ color: 'var(--text-1)' }}>{data.totalLectures}</strong> lectures</span>
            <span style={{ color: 'var(--green)' }}><strong>{data.counts.PRESENT + data.counts.LATE}</strong> Present</span>
            <span style={{ color: 'var(--red)' }}><strong>{data.counts.ABSENT}</strong> Absent</span>
            {data.pctPresent != null && <span><strong style={{ color: 'var(--text-1)' }}>{data.pctPresent}%</strong> attended</span>}
          </div>

          {rows.length === 0 ? (
            <p style={{ fontSize: 12.5, color: 'var(--text-2b)', padding: '4px 20px 20px' }}>
              No lectures match these filters.
            </p>
          ) : (
            <table className="data-table data-table-cards">
              <thead>
                <tr><th>Date</th><th>Lecture</th><th>Subject</th><th>Time</th><th>Attendance</th></tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id}>
                    <td data-label="Date">{fmtDay(l.date)}</td>
                    <td className="cell-primary" data-label="Lecture">Period {l.periodNo}</td>
                    <td data-label="Subject">
                      {l.subject ?? '—'}
                      {l.teacher && <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{l.teacher}</div>}
                    </td>
                    <td data-label="Time">
                      {l.startTime ? `${l.startTime}${l.endTime ? `–${l.endTime}` : ''}` : '—'}
                      {l.room && <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{l.room}</div>}
                    </td>
                    <td data-label="Attendance"><AttendanceStatusTag status={l.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </Card>
  );
}
