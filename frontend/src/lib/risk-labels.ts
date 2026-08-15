/**
 * Presentation labels for the risk engine's raw output.
 *
 * The backend field names are the contract and are left untouched — these maps
 * only decide what a human reads. `featureLabel` falls back to a readable
 * rewrite of any key that isn't listed, so a new signal added server-side
 * degrades to "Some New Metric" rather than leaking `some_new_metric`.
 */

/** Risk categories, as produced by risk.service.js `type`. */
export const RISK_CATEGORY_LABEL: Record<string, string> = {
  ATTENDANCE: 'Attendance',
  ACADEMIC_DECLINE: 'Academic',
  FEE_DEFAULT: 'Fee default',
  DROPOUT: 'Dropout',
};

/** Longer form for detail views, where there is room to be precise. */
export const RISK_CATEGORY_LONG: Record<string, string> = {
  ATTENDANCE: 'Attendance risk',
  ACADEMIC_DECLINE: 'Academic decline',
  FEE_DEFAULT: 'Fee default',
  DROPOUT: 'Dropout risk',
};

export const RISK_LEVEL_TONE: Record<string, 'red' | 'amber' | 'gray'> = {
  HIGH: 'red', MEDIUM: 'amber', LOW: 'gray',
};

/** `topFeatures[].feature` keys emitted by the scoring rules. */
const FEATURE_LABEL: Record<string, string> = {
  attendance_pct_30d: '30-Day Attendance',
  avg_marks_pct: 'Average Marks',
  overdue_invoice_count: 'Overdue Invoices',
};

/** Unit suffix for a feature's value, so "72" reads as "72%". */
const FEATURE_UNIT: Record<string, string> = {
  attendance_pct_30d: '%',
  avg_marks_pct: '%',
};

export function featureLabel(key: string): string {
  if (FEATURE_LABEL[key]) return FEATURE_LABEL[key];
  // Unknown key: strip the snake_case and title-case what's left.
  return key
    .replace(/_/g, ' ')
    .replace(/\bpct\b/gi, '%')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function featureValue(key: string, value: string | number): string {
  return `${value}${FEATURE_UNIT[key] ?? ''}`;
}

/**
 * Collapses a flat list of section names into one line per grade.
 *
 * A teacher covering ten sections previously rendered as "A, B, A, B, A, B…"
 * — the section names repeat across grades, so the list carried no
 * information. Grouping restores it: "Grade 5 — A, B · Grade 6 — A, B".
 * Sections whose grade is unknown are grouped under "Unassigned".
 */
export function groupSectionsByGrade(
  sections: Array<{ gradeName?: string | null; sectionName?: string | null }>,
): Array<{ grade: string; sections: string[] }> {
  const byGrade = new Map<string, Set<string>>();
  for (const s of sections) {
    const grade = (s.gradeName || '').trim() || 'Unassigned';
    const name = (s.sectionName || '').trim();
    if (!name) continue;
    if (!byGrade.has(grade)) byGrade.set(grade, new Set());
    byGrade.get(grade)!.add(name);
  }
  return [...byGrade.entries()]
    .map(([grade, names]) => ({ grade, sections: [...names].sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => a.grade.localeCompare(b.grade, undefined, { numeric: true }));
}

/** "Grade 5 — A, B · Grade 6 — A" for compact cells. */
export function formatGradeSections(groups: Array<{ grade: string; sections: string[] }>): string {
  return groups.map((g) => `${g.grade} — ${g.sections.join(', ')}`).join(' · ');
}
