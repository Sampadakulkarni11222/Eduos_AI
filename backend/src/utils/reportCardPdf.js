import PDFDocument from 'pdfkit';
import { env } from '../config/env.js';
import { DEFAULT_GRADING_SCALE } from './grading.js';

const INK = '#2B2520';
const MUTED = '#7C7160';
const RULE = '#E2D7BF';
const ACCENT = '#591620';

const money = (n) => (n === null || n === undefined ? '—' : String(n));

/**
 * Streams a report card PDF to `res`, drawn entirely with pdfkit primitives
 * (no template assets), matching the approach used by the ID card and receipt
 * renderers.
 */
export function renderReportCardPdf(res, card) {
  const doc = new PDFDocument({ size: 'A4', margin: 46 });
  doc.pipe(res);

  const pageWidth = doc.page.width - 92;
  let y = 46;

  // ── Header ──
  doc.rect(46, y, pageWidth, 64).fill(ACCENT);
  doc.fillColor('#F4E7D2').font('Helvetica-Bold').fontSize(17)
    .text(env.SCHOOL_NAME, 62, y + 14, { width: pageWidth - 32 });
  doc.font('Helvetica').fontSize(10).fillColor('#E6D2BC')
    .text('Report Card', 62, y + 37);
  doc.fontSize(9).text(card.exam ?? '', 62, y + 37, { width: pageWidth - 32, align: 'right' });
  y += 84;

  // ── Student identity ──
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(card.student?.name ?? '—', 46, y);
  doc.font('Helvetica').fontSize(10).fillColor(MUTED)
    .text(`Class ${card.student?.class ?? '—'}`, 46, y + 18);
  doc.fontSize(8).fillColor(MUTED).text(
    `Generated ${new Date(card.generatedAt ?? Date.now()).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`,
    46, y + 4, { width: pageWidth, align: 'right' }
  );
  y += 44;

  // ── Marks table ──
  const cols = [
    { key: 'subject', label: 'Subject', w: 0.30, align: 'left' },
    { key: 'exam', label: 'Exam', w: 0.22, align: 'left' },
    { key: 'marks', label: 'Marks', w: 0.16, align: 'right' },
    { key: 'percentage', label: '%', w: 0.14, align: 'right' },
    { key: 'grade', label: 'Grade', w: 0.18, align: 'right' },
  ];

  doc.rect(46, y, pageWidth, 22).fill('#FBF6EC');
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8);
  let x = 46;
  for (const c of cols) {
    const w = pageWidth * c.w;
    doc.text(c.label.toUpperCase(), x + 8, y + 7, { width: w - 16, align: c.align });
    x += w;
  }
  y += 22;

  doc.font('Helvetica').fontSize(9.5);
  for (const s of card.subjects ?? []) {
    if (y > doc.page.height - 150) { doc.addPage(); y = 46; }
    doc.moveTo(46, y).lineTo(46 + pageWidth, y).strokeColor(RULE).lineWidth(0.5).stroke();

    x = 46;
    const cells = {
      subject: s.subject ?? '—',
      exam: s.exam ?? '—',
      marks: s.marks === null || s.marks === undefined ? '—' : `${s.marks} / ${s.maxMarks}`,
      percentage: s.percentage === null ? '—' : `${s.percentage}%`,
      grade: s.grade ?? '—',
    };
    for (const c of cols) {
      const w = pageWidth * c.w;
      doc.fillColor(c.key === 'subject' ? INK : MUTED)
        .font(c.key === 'subject' || c.key === 'grade' ? 'Helvetica-Bold' : 'Helvetica')
        .text(cells[c.key], x + 8, y + 8, { width: w - 16, align: c.align });
      x += w;
    }
    y += 26;
  }
  doc.moveTo(46, y).lineTo(46 + pageWidth, y).strokeColor(RULE).lineWidth(0.5).stroke();
  y += 18;

  // ── Summary ──
  const sm = card.summary ?? {};
  if (y > doc.page.height - 190) { doc.addPage(); y = 46; }

  doc.rect(46, y, pageWidth, 74).fill('#FBF6EC');
  const stats = [
    ['Total', sm.totalMaxMarks ? `${sm.totalMarks} / ${sm.totalMaxMarks}` : '—'],
    ['Percentage', sm.percentage === null || sm.percentage === undefined ? '—' : `${sm.percentage}%`],
    ['Grade', sm.grade?.label ?? '—'],
    ['GPA', money(sm.gpa)],
  ];
  const cw = pageWidth / stats.length;
  stats.forEach(([label, value], i) => {
    const cx = 46 + cw * i;
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(label.toUpperCase(), cx + 10, y + 16, { width: cw - 20 });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(16).text(value, cx + 10, y + 32, { width: cw - 20 });
  });
  y += 88;

  if (sm.grade?.descriptor) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(9.5)
      .text(`Overall: ${sm.grade.descriptor}`, 46, y);
    y += 16;
  }
  if (sm.passed === false && sm.failedSubjects?.length) {
    doc.fillColor('#A8322E').font('Helvetica-Bold').fontSize(9.5)
      .text(`Needs attention: ${sm.failedSubjects.join(', ')}`, 46, y);
    y += 16;
  }
  if (sm.subjectsMarked !== undefined && sm.subjectsMarked < sm.subjectsTotal) {
    doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(8.5)
      .text(`Interim result — ${sm.subjectsMarked} of ${sm.subjectsTotal} subjects published.`, 46, y);
    y += 16;
  }

  // ── Grading scale key + footer ──
  y += 8;
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text('GRADING SCALE', 46, y);
  y += 12;
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(
    DEFAULT_GRADING_SCALE.map((b) => `${b.label} ${b.min}–${Math.ceil(b.max)}`).join('   ·   '),
    46, y, { width: pageWidth }
  );

  doc.fontSize(7.5).fillColor(MUTED).text(
    'Computer-generated report card. Contact the school office for any correction.',
    46, doc.page.height - 62, { width: pageWidth, align: 'center' }
  );

  doc.end();
}
