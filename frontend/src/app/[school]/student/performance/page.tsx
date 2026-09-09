'use client';
import { useEffect, useMemo, useState } from 'react';
import { PortalShell } from '@/components/shell';
import {
  Card, EmptyState, FilterBar, Pill, SearchInput, Select, SkeletonRows, StatCard, matchesSearch,
} from '@/components/ui';
import { ReportCardView } from '@/components/report-card-view';
import { api } from '@/lib/api';
import type { DocumentDto, PerformanceHistoryDto, PerformanceYearDto } from '@/lib/types';

const GRADE_TONE: Record<string, 'green' | 'blue' | 'amber' | 'red'> = {
  A1: 'green', A2: 'green', B1: 'blue', B2: 'blue',
  C1: 'amber', C2: 'amber', D: 'amber', E: 'red',
};

/**
 * Academic performance, by year and term.
 *
 * The page used to show one flat list of every published mark, with no way to
 * tell a Term 1 result from a Term 3 one or last year's from this year's — and
 * no way to look at a previous year at all. It is now Year → Term → results,
 * driven entirely by the terms and academic years the marks are actually filed
 * under on the server. Nothing here is computed to fill a gap: a year with
 * nothing published says so.
 */
export default function StudentPerformance() {
  const [history, setHistory] = useState<PerformanceHistoryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [yearId, setYearId] = useState('');
  const [termId, setTermId] = useState('');
  const [search, setSearch] = useState('');
  const [reportCards, setReportCards] = useState<DocumentDto[]>([]);

  useEffect(() => {
    let stale = false;
    api.performanceHistory()
      .then((h) => {
        if (stale) return;
        setHistory(h);
        // The current year opens by default; failing that, the most recent.
        const preferred = h.years.find((y) => y.isCurrent) ?? h.years[0];
        setYearId(preferred?.academicYearId ?? preferred?.enrollmentId ?? '');
      })
      .catch(() => { if (!stale) setHistory(null); })
      .finally(() => { if (!stale) setLoading(false); });

    // A school may also publish its own report-card document; if one exists it
    // is named on the report card below rather than replacing it.
    api.listDocuments(undefined, { type: 'REPORT_CARD' })
      .then((docs) => { if (!stale) setReportCards(docs); })
      .catch(() => { /* the generated card stands on its own */ });

    return () => { stale = true; };
  }, []);

  const years = useMemo(() => history?.years ?? [], [history]);
  const year: PerformanceYearDto | null = useMemo(
    () => years.find((y) => (y.academicYearId ?? y.enrollmentId) === yearId) ?? years[0] ?? null,
    [years, yearId],
  );

  // Terms reset when the year changes — a term id from one year means nothing
  // in another.
  useEffect(() => { setTermId(''); }, [yearId]);

  const termsWithResults = year?.terms ?? [];
  const activeTerm = termId ? termsWithResults.find((t) => t.termId === termId) ?? null : null;

  // "Overall" (no term selected) shows the whole year; a term narrows to it.
  const shownResults = activeTerm ? activeTerm.results : termsWithResults.flatMap((t) => t.results);
  const shownSummary = activeTerm ? activeTerm.summary : year?.summary ?? null;

  const filteredResults = useMemo(
    () => shownResults.filter((r) => matchesSearch(search, [r.subject, r.exam, r.termName, r.academicYearName])),
    [shownResults, search],
  );

  return (
    <PortalShell
      expectedSlug="student"
      topbar={{ title: 'Performance', desc: 'Your results by academic year and term, and your report card.' }}
    >
      {loading && <Card><SkeletonRows rows={4} /></Card>}

      {!loading && years.length === 0 && (
        <EmptyState
          title="No academic record yet"
          sub="Once you are enrolled and your teachers publish marks, your results appear here."
        />
      )}

      {!loading && year && (
        <>
          <FilterBar>
            <Select
              label="Academic year"
              value={yearId}
              onChange={setYearId}
              options={years.map((y) => ({
                value: y.academicYearId ?? y.enrollmentId,
                label: `${y.academicYearName}${y.isCurrent ? ' (current)' : ''}${y.class ? ` · ${y.class}` : ''}`,
              }))}
            />
            <Select
              label="Term"
              value={termId}
              placeholder="Overall (whole year)"
              onChange={setTermId}
              options={termsWithResults
                .filter((t) => t.termId)
                .map((t) => ({
                  value: t.termId!,
                  label: `${t.name}${t.results.length === 0 ? ' — no results' : ''}`,
                }))}
            />
            <SearchInput
              label="Search results"
              value={search}
              onChange={setSearch}
              placeholder="Subject or exam…"
            />
          </FilterBar>

          <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 14 }}>
            {year.academicYearName}
            {year.class ? ` · ${year.class}` : ''}
            {year.rollNo != null ? ` · Roll ${year.rollNo}` : ''}
            {activeTerm ? ` · ${activeTerm.name}` : ' · Overall'}
          </div>

          <div className="card-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 18 }}>
            <StatCard
              label="Percentage"
              value={shownSummary?.percentage != null ? `${shownSummary.percentage}%` : '—'}
            />
            <StatCard
              label="Grade"
              value={shownSummary?.grade?.label ?? '—'}
              delta={shownSummary?.grade?.descriptor ?? undefined}
            />
            <StatCard
              label="GPA"
              value={shownSummary?.gpa != null ? String(shownSummary.gpa) : '—'}
            />
            <StatCard
              label="Attendance"
              value={year.attendance?.pctPresent != null ? `${year.attendance.pctPresent}%` : '—'}
              delta={year.attendance ? `${year.attendance.workingDays} days recorded` : undefined}
              deltaDir={year.attendance && year.attendance.pctPresent < 75 ? 'down' : 'flat'}
            />
          </div>

          <div className="card-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: 18 }}>
            <StatCard
              label="Total marks"
              value={shownSummary?.totalMaxMarks ? `${shownSummary.totalMarks} / ${shownSummary.totalMaxMarks}` : '—'}
            />
            <StatCard
              label="Best subject"
              value={year.bestSubject?.subject ?? '—'}
              delta={year.bestSubject?.pct != null ? `${year.bestSubject.pct}%` : undefined}
              deltaDir="up"
            />
            <StatCard
              label="Needs support"
              value={year.needsSupport?.subject ?? '—'}
              delta={year.needsSupport?.pct != null ? `${year.needsSupport.pct}%` : undefined}
              deltaDir="down"
            />
          </div>

          {/* The term breakdown for the whole year, so progress across terms is
              visible without switching the picker back and forth. */}
          {!activeTerm && termsWithResults.length > 0 && (
            <Card pad={false} style={{ marginBottom: 18 }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--hairline)' }}>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Term by term</strong>
              </div>
              <table className="data-table data-table-cards">
                <thead>
                  <tr><th>Term</th><th>Subjects</th><th>Marks</th><th>Percentage</th><th>Grade</th></tr>
                </thead>
                <tbody>
                  {termsWithResults.map((t) => (
                    <tr key={t.termId ?? t.name}>
                      <td className="cell-primary" data-label="Term">{t.name}</td>
                      <td data-label="Subjects">{t.results.length || '—'}</td>
                      <td data-label="Marks">
                        {t.summary.totalMaxMarks ? `${t.summary.totalMarks} / ${t.summary.totalMaxMarks}` : 'No data available'}
                      </td>
                      <td data-label="Percentage" style={{ color: pctColor(t.summary.percentage), fontWeight: 600 }}>
                        {t.summary.percentage != null ? `${t.summary.percentage}%` : '—'}
                      </td>
                      <td data-label="Grade">
                        {t.summary.grade ? <Pill tone={GRADE_TONE[t.summary.grade.label] ?? 'gray'}>{t.summary.grade.label}</Pill> : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {/* The report card is generated for the enrollment in view, so
              switching year switches the card with it. */}
          <div style={{ marginBottom: 18 }}>
            <ReportCardView enrollmentId={year.enrollmentId} customDocuments={reportCards} />
          </div>

          <Card pad={false}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--hairline)' }}>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>
                Subject-wise marks{activeTerm ? ` — ${activeTerm.name}` : ''}
              </strong>
            </div>
            {filteredResults.length === 0 ? (
              <p style={{ fontSize: 12.5, color: 'var(--text-2b)', padding: '16px 20px' }}>
                {shownResults.length === 0
                  ? 'No data available for this selection.'
                  : 'No results match your search.'}
              </p>
            ) : (
              <table className="data-table data-table-cards">
                <thead>
                  <tr><th>Subject</th><th>Exam</th><th>Term</th><th>Date</th><th>Marks</th><th>%</th></tr>
                </thead>
                <tbody>
                  {filteredResults.map((r, i) => (
                    <tr key={`${r.subject}-${r.exam}-${i}`}>
                      <td className="cell-primary" data-label="Subject">{r.subject}</td>
                      <td data-label="Exam">{r.exam}</td>
                      <td data-label="Term">{r.termName ?? '—'}</td>
                      <td data-label="Date">{r.examDate ? fmtDate(r.examDate) : '—'}</td>
                      <td data-label="Marks">{r.marks ?? '—'} / {r.maxMarks}</td>
                      <td style={{ color: pctColor(r.pct), fontWeight: 600 }} data-label="%">
                        {r.pct != null ? `${r.pct}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </PortalShell>
  );
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function pctColor(p: number | null) {
  if (p == null) return 'var(--text-faint)';
  if (p >= 75) return 'var(--green)';
  if (p >= 50) return 'var(--amber)';
  return 'var(--red)';
}
