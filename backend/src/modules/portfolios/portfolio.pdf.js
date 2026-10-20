import PDFDocument from 'pdfkit';
import { env } from '../../config/env.js';

const INK = '#2B2520';
const MUTED = '#7C7160';
const ACCENT = '#591620';
const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—');
// Built-in fonts are WinAnsi: keep text to characters they can draw.
// eslint-disable-next-line no-control-regex -- keep tabs and newlines, drop what WinAnsi cannot draw
const clean = (s) => String(s ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');

/**
 * A student's competency portfolio as an A4 PDF for the student and family:
 * each competency with its rubric level, the teacher's comment, the evidence
 * behind it and the student's reflections. Drawn from a portfolio the caller
 * was already allowed to see (portfolios.service portfolio()).
 */
export function renderPortfolioPdf(stream, p) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: clean(`Competency portfolio - ${p.student.name}`) } });
  doc.pipe(stream);
  const left = 40; const width = doc.page.width - 80;
  doc.rect(left, 40, width, 58).fill(ACCENT);
  doc.fillColor('#F4E7D2').font('Helvetica-Bold').fontSize(16).text(clean(env.SCHOOL_NAME), left + 14, 52, { width: width - 28 });
  doc.font('Helvetica').fontSize(10).fillColor('#E6D2BC').text(clean(`Competency portfolio - ${p.term}`), left + 14, 76);
  doc.y = 112;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(clean(p.student.name), left);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(clean(`${p.student.className ?? ''}${p.student.admissionNo ? ` - Adm. ${p.student.admissionNo}` : ''} - generated ${fmt(new Date())}`));
  doc.moveDown(0.4).fontSize(8.5).text('Levels: Developing, Proficient, Advanced. Evidence comes from school records and from teachers. There are no scores and no behaviour ratings.', { width });

  for (const c of p.competencies) {
    if (!c.rating && !c.evidence.length && !c.reflections.length) continue;
    if (doc.y > doc.page.height - 140) doc.addPage();
    doc.moveDown(0.8).font('Helvetica-Bold').fontSize(11.5).fillColor(ACCENT).text(clean(c.label), left, doc.y, { continued: Boolean(c.rating) });
    if (c.rating) doc.font('Helvetica').fillColor(INK).text(clean(`   ${c.rating.levelLabel} (${c.rating.term})`));
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(clean(c.description), { width });
    if (c.rating?.comment) doc.moveDown(0.2).fontSize(9).fillColor(INK).text(clean(`Teacher: "${c.rating.comment}" - ${c.rating.ratedByName ?? ''}`), { width });
    for (const e of c.evidence.slice(0, 12)) {
      if (doc.y > doc.page.height - 60) doc.addPage();
      doc.moveDown(0.15).fontSize(8.8).fillColor(INK).text(clean(`- ${e.title}`), { width, continued: true }).fillColor(MUTED).text(clean(`  ${e.detail ?? e.description ?? ''} (${fmt(e.on)})`));
    }
    if (c.evidence.length > 12) doc.fontSize(8).fillColor(MUTED).text(`  and ${c.evidence.length - 12} more`);
    for (const r of c.reflections.slice(0, 5)) doc.moveDown(0.15).fontSize(8.8).fillColor(INK).text(clean(`Reflection (${fmt(r.at)}): ${r.text}`), { width });
  }
  if (p.generalReflections.length) {
    if (doc.y > doc.page.height - 120) doc.addPage();
    doc.moveDown(0.8).font('Helvetica-Bold').fontSize(11.5).fillColor(ACCENT).text('My reflections');
    for (const r of p.generalReflections.slice(0, 10)) doc.moveDown(0.2).font('Helvetica').fontSize(9).fillColor(INK).text(clean(`${fmt(r.at)}: ${r.text}`), { width });
  }
  doc.end();
}
