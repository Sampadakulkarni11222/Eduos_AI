/**
 * Marks-grid helpers for the teacher's exams page.
 *
 * The grade is derived, never typed: the server recomputes it from the CBSE
 * 10-point scale (backend/src/utils/grading.js) on every save, so a grade a
 * teacher typed was silently discarded. The same bands are mirrored here so the
 * grid shows the grade the server will store, live, as marks are keyed in.
 */

export const ABSENCE_CODES = ['AB', 'ML'] as const;
export type AbsenceCode = (typeof ABSENCE_CODES)[number];

/** Same bands as backend/src/utils/grading.js DEFAULT_GRADING_SCALE. */
const SCALE: Array<{ min: number; label: string }> = [
  { min: 91, label: 'A1' },
  { min: 81, label: 'A2' },
  { min: 71, label: 'B1' },
  { min: 61, label: 'B2' },
  { min: 51, label: 'C1' },
  { min: 41, label: 'C2' },
  { min: 33, label: 'D' },
  { min: 0, label: 'E' },
];

export const ABSENCE_LABEL: Record<AbsenceCode, string> = { AB: 'Absent', ML: 'Medical leave' };

/** What a marks cell holds: a score, an absence code, nothing, or something invalid. */
export type ParsedMark =
  | { kind: 'empty' }
  | { kind: 'score'; marks: number }
  | { kind: 'absence'; code: AbsenceCode }
  | { kind: 'invalid'; reason: string };

export function parseMarkInput(raw: string, maxMarks: number): ParsedMark {
  const v = raw.trim();
  if (v === '') return { kind: 'empty' };
  const upper = v.toUpperCase();
  if ((ABSENCE_CODES as readonly string[]).includes(upper)) return { kind: 'absence', code: upper as AbsenceCode };
  if (!/^\d+(\.\d+)?$/.test(v)) return { kind: 'invalid', reason: 'Use a number, AB (absent) or ML (medical leave)' };
  const n = Number(v);
  if (n < 0 || n > maxMarks) return { kind: 'invalid', reason: `Between 0 and ${maxMarks}` };
  return { kind: 'score', marks: n };
}

/** The grade the server will store for this cell, or '' when there is none yet. */
export function derivedGrade(raw: string, maxMarks: number): string {
  const p = parseMarkInput(raw, maxMarks);
  if (p.kind === 'absence') return p.code;
  if (p.kind !== 'score' || !maxMarks) return '';
  const pct = Number(((p.marks / maxMarks) * 100).toFixed(2));
  const band = SCALE.find((b) => pct >= b.min) ?? SCALE[SCALE.length - 1];
  return band.label;
}

/** The value a stored row shows in its marks cell. */
export function cellValue(row: { marks: number | null; absence?: string | null }): string {
  if (row.absence) return row.absence;
  return row.marks != null ? String(row.marks) : '';
}

/**
 * The entries a save sends: every row whose cell changed from what is stored
 * (published rows are locked and never sent). An emptied cell is sent as
 * `marks: null`, which clears a draft back to "not entered" -- it used to be
 * dropped, so a mistyped draft mark could never be removed.
 */
export function buildEntries(
  rows: Array<{ enrollmentId: string; marks: number | null; absence?: string | null; remarks: string | null; status: string }>,
  draft: Record<string, { marks: string; remarks: string }>,
  maxMarks: number,
): { entries: Array<{ enrollmentId: string; marks: number | null; absence: AbsenceCode | null; remarks?: string }>; invalid: string[] } {
  const entries: Array<{ enrollmentId: string; marks: number | null; absence: AbsenceCode | null; remarks?: string }> = [];
  const invalid: string[] = [];
  for (const r of rows) {
    if (r.status === 'PUBLISHED') continue;
    const d = draft[r.enrollmentId];
    if (!d) continue;
    const unchanged = d.marks.trim().toUpperCase() === cellValue(r).toUpperCase() && (d.remarks || '') === (r.remarks ?? '');
    if (unchanged) continue;
    const p = parseMarkInput(d.marks, maxMarks);
    if (p.kind === 'invalid') { invalid.push(r.enrollmentId); continue; }
    entries.push({
      enrollmentId: r.enrollmentId,
      marks: p.kind === 'score' ? p.marks : null,
      absence: p.kind === 'absence' ? p.code : null,
      remarks: d.remarks || undefined,
    });
  }
  return { entries, invalid };
}
