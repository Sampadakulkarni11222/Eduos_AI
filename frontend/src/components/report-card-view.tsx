'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { DocumentDto, ReportCardDto } from '@/lib/types';
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
 *
 * Laid out as a document rather than as another dashboard panel — a masthead
 * naming the school record, the student and the exam; a ruled summary band;
 * then the marks table. It is the one screen in the portal a family is likely
 * to print or forward, so it should read as the thing it represents.
 */
export function ReportCardView({
  enrollmentId,
  customDocuments = [],
}: {
  enrollmentId?: string;
  /**
   * Report-card documents the school published for this student, if any.
   *
   * A school that issues its own designed report card uploads it as a
   * document; the generated card is then not the whole story, and saying so
   * matters more than the layout does. The name is flagged in the top-right
   * corner and opens the actual file. Callers that pass nothing (the parent
   * portal) get exactly the previous behaviour.
   */
  customDocuments?: DocumentDto[];
}) {
  const [card, setCard] = useState<ReportCardDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
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

  async function openCustom(doc: DocumentDto) {
    setOpeningId(doc.id);
    try {
      await api.openDocumentFile(doc.id);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not open that document.', 'error');
    } finally {
      setOpeningId(null);
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
    <Card pad={false} className="report-card-doc">
      {/* Masthead. The custom-document flag sits top-right, where a document's
          reference or seal conventionally goes. */}
      <div
        style={{
          display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start',
          justifyContent: 'space-between', padding: '20px 24px 16px',
          borderBottom: '2px solid var(--accent)',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10.5, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>
            Report card
          </div>
          <div style={{ fontFamily: 'Newsreader, serif', fontSize: 23, fontWeight: 600, color: 'var(--text-1b)', marginTop: 2, overflowWrap: 'anywhere' }}>
            {card.student.name}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 3 }}>
            {card.student.class} · {card.exam}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, textAlign: 'right' }}>
          {customDocuments.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <span style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>
                School-issued document
              </span>
              {customDocuments.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => void openCustom(doc)}
                  disabled={openingId === doc.id}
                  style={{
                    background: 'var(--field-bg, #fff)', border: '1px solid var(--accent)',
                    color: 'var(--accent)', borderRadius: 8, padding: '5px 11px',
                    fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
                    maxWidth: 260, overflowWrap: 'anywhere', textAlign: 'right',
                  }}
                >
                  🗎 {openingId === doc.id ? 'Opening…' : doc.title}
                </button>
              ))}
            </div>
          )}
          <Button variant="soft" small onClick={() => void download()} disabled={busy}>
            {busy ? 'Preparing…' : 'Download PDF'}
          </Button>
          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            Generated {new Date(card.generatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        </div>
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
        <div style={{ padding: '10px 24px', borderTop: '1px solid var(--hairline)', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
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
