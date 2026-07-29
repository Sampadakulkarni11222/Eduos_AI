'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { ReportCardDto } from '@/lib/types';
import { Button, Card, EmptyState, Pill, SkeletonRows, useToast } from './ui';

const GRADE_TONE: Record<string, 'green' | 'blue' | 'amber' | 'red'> = {
  A1: 'green', A2: 'green', B1: 'blue', B2: 'blue',
  C1: 'amber', C2: 'amber', D: 'amber', E: 'red',
};

/**
 * Report card panel shared by the student and parent portals.
 *
 * `enrollmentId` is optional: parents and students omit it and the server
 * resolves their own record from the session, which keeps a child's id out
 * of the URL for the common case.
 */
export function ReportCardView({ enrollmentId }: { enrollmentId?: string }) {
  const [card, setCard] = useState<ReportCardDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let stale = false;
    setLoading(true);
    api
      .reportCard(enrollmentId)
      .then((r) => !stale && setCard(r))
      .catch(() => !stale && setCard(null))
      .finally(() => !stale && setLoading(false));
    return () => { stale = true; };
  }, [enrollmentId]);

  async function download() {
    setBusy(true);
    try {
      await api.downloadReportCardPdf(enrollmentId);
    } catch {
      toast('Could not generate the report card PDF. Please try again.', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Card><SkeletonRows rows={5} /></Card>;

  if (!card || !card.subjects.length) {
    return (
      <Card>
        <EmptyState
          icon="◉"
          title="No published results yet"
          sub="Your report card appears here once teachers publish marks for an exam."
        />
      </Card>
    );
  }

  const s = card.summary;
  const interim = s.subjectsMarked < s.subjectsTotal;

  return (
    <Card pad={false}>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center',
        justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--hairline)',
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--text-1)' }}>Report card</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 2 }}>
            {card.student.name} · {card.student.class} · {card.exam}
          </div>
        </div>
        <Button variant="soft" small onClick={() => void download()} disabled={busy}>
          {busy ? 'Preparing…' : 'Download PDF'}
        </Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: 'var(--hairline)' }}>
        {[
          ['Total', s.totalMaxMarks ? `${s.totalMarks} / ${s.totalMaxMarks}` : '—'],
          ['Percentage', s.percentage != null ? `${s.percentage}%` : '—'],
          ['Grade', s.grade?.label ?? '—'],
          ['GPA', s.gpa != null ? String(s.gpa) : '—'],
        ].map(([label, value]) => (
          <div key={label} style={{ background: 'var(--card-bg)', padding: '14px 16px' }}>
            <div style={{ fontSize: 11.5, color: 'var(--text-2b)', fontWeight: 600 }}>{label}</div>
            <div style={{ fontFamily: 'Newsreader, serif', fontSize: 22, fontWeight: 600, color: 'var(--text-1b)', marginTop: 3 }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {(interim || s.passed === false) && (
        <div style={{ padding: '10px 20px', borderTop: '1px solid var(--hairline)', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {interim && (
            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
              Interim result — {s.subjectsMarked} of {s.subjectsTotal} subjects published.
            </span>
          )}
          {s.passed === false && s.failedSubjects.length > 0 && (
            <span style={{ fontSize: 12, color: 'var(--red)', fontWeight: 600 }}>
              Needs attention: {s.failedSubjects.join(', ')}
            </span>
          )}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table className="data-table data-table-cards">
          <thead>
            <tr>
              <th>Subject</th><th>Exam</th><th>Marks</th><th>%</th><th>Grade</th>
            </tr>
          </thead>
          <tbody>
            {card.subjects.map((row, i) => (
              <tr key={`${row.subject}-${row.exam}-${i}`}>
                <td className="cell-primary" data-label="Subject">{row.subject}</td>
                <td data-label="Exam">{row.exam}</td>
                <td data-label="Marks">{row.marks == null ? '—' : `${row.marks} / ${row.maxMarks}`}</td>
                <td data-label="%">{row.percentage == null ? '—' : `${row.percentage}%`}</td>
                <td data-label="Grade">
                  {row.grade ? <Pill tone={GRADE_TONE[row.grade] ?? 'gray'}>{row.grade}</Pill> : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
