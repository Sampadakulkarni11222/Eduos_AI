import PDFDocument from 'pdfkit';
import { env } from '../../config/env.js';

const INK = '#2B2520';
const MUTED = '#7C7160';
const RULE = '#E2D7BF';
const ACCENT = '#591620';

/**
 * Streams a published term report card (a version snapshot) as an A4 PDF,
 * drawn with pdfkit primitives like the existing report card, receipt and ID
 * card renderers. Only built-in fonts are used, so no currency glyph is needed.
 */
export function renderTermCardPdf(res, v) {
  const card = v.card ?? {};
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(res);
  const left = 40; const width = doc.page.width - 80;
  let y = 40;

  doc.rect(left, y, width, 60).fill(ACCENT);
  doc.fillColor('#F4E7D2').font('Helvetica-Bold').fontSize(16).text(env.SCHOOL_NAME, left + 14, y + 12, { width: width - 28 });
  doc.font('Helvetica').fontSize(10).fillColor('#E6D2BC').text(`Report card · ${card.termName ?? card.termKey ?? ''}`, left + 14, y + 36);
  doc.fontSize(9).text(`Version ${v.version}${v.supersededAt ? ' (superseded)' : ''}`, left + 14, y + 36, { width: width - 28, align: 'right' });
  y += 76;

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(card.studentName ?? '—', left, y);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED)
    .text(`Class ${card.className ?? '—'}${card.rollNo ? ` · Roll ${card.rollNo}` : ''}${card.admissionNo ? ` · Adm. ${card.admissionNo}` : ''}`, left, y + 17)
    .text(`Published ${new Date(v.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}`, left, y + 4, { width, align: 'right' });
  y += 38;
  if (v.correctionNote) { doc.fillColor(ACCENT).fontSize(8.5).text(`Corrected: ${v.correctionNote}`, left, y, { width }); y += 14; }

  // Scholastic table
  const comps = card.components ?? [];
  const subjW = 130; const tailW = 3 * 46; const compW = comps.length ? (width - subjW - tailW) / comps.length : 0;
  const header = ['Subject', ...comps.map((c) => `${c.label} (${c.maxMarks})`), 'Total', '%', 'Grade'];
  const widths = [subjW, ...comps.map(() => compW), 46, 46, 46];
  const row = (cells, bold = false, shade = false) => {
    const h = 20;
    if (shade) doc.rect(left, y, width, h).fill('#F6F0E4');
    let x = left;
    doc.fillColor(INK).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    cells.forEach((c, i) => { doc.text(String(c ?? '—'), x + 4, y + 6, { width: widths[i] - 8, align: i === 0 ? 'left' : 'center', lineBreak: false, ellipsis: true }); x += widths[i]; });
    y += h;
    doc.moveTo(left, y).lineTo(left + width, y).strokeColor(RULE).lineWidth(0.5).stroke();
  };
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text('Scholastic areas', left, y); y += 14;
  row(header, true, true);
  for (const s of card.scholastic ?? []) {
    row([s.subject, ...comps.map((c) => {
      const cell = s.components?.[c.key];
      if (!cell) return '—';
      if (cell.status === 'ABSENT') return cell.absence ?? 'AB';
      return cell.value === null ? 'pending' : cell.value;
    }), `${s.total}/${s.maxMarks}`, s.percentage ?? '—', s.grade ?? '—']);
  }
  if (card.summary) row(['Overall', ...comps.map(() => ''), `${card.summary.total}/${card.summary.maxMarks}`, card.summary.percentage ?? '—', card.summary.grade ?? '—'], true, true);
  y += 14;

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text('Co-scholastic areas (A/B/C)', left, y); y += 14;
  for (const a of card.coScholasticAreas ?? []) {
    doc.font('Helvetica').fontSize(9).fillColor(INK).text(a.label, left, y).text(card.coScholastic?.[a.key] ?? '—', left, y, { width, align: 'right' });
    y += 14;
  }
  doc.text(card.disciplineLabel ?? 'Discipline', left, y).text(card.discipline ?? '—', left, y, { width, align: 'right' });
  y += 22;

  const att = card.attendance;
  doc.font('Helvetica-Bold').fontSize(10).text('Attendance', left, y); y += 14;
  doc.font('Helvetica').fontSize(9).text(att?.workingDays ? `${att.present} of ${att.workingDays} working days (${att.percentage}%)` : 'No register marks for this term.', left, y); y += 22;

  doc.font('Helvetica-Bold').fontSize(10).text('Class teacher\'s remarks', left, y); y += 14;
  doc.font('Helvetica').fontSize(9).text(card.classTeacherRemarks ?? '—', left, y, { width }); y = doc.y + 14;
  doc.font('Helvetica-Bold').fontSize(10).text('Result', left, y); y += 14;
  doc.font('Helvetica').fontSize(9).text(card.resultLine ?? '—', left, y, { width }); y = doc.y + 40;

  doc.moveTo(left, y).lineTo(left + 150, y).strokeColor(MUTED).stroke();
  doc.moveTo(left + width - 150, y).lineTo(left + width, y).stroke();
  doc.fontSize(8).fillColor(MUTED).text('Class teacher', left, y + 4).text('Principal', left + width - 150, y + 4, { width: 150, align: 'right' });
  doc.end();
}
