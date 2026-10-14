import PDFDocument from 'pdfkit';
import { valueText, changeText } from './quarterly.service.js';

/**
 * The quarterly report as a PDF (pdfkit, built-in Helvetica; amounts read
 * "INR" because the built-in fonts have no rupee glyph). Draws only what the
 * reader may see: the caller passes a report already filtered by present().
 */
const fmtDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

export function renderQuarterlyPdf(stream, report) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Quarterly report ${report.quarterKey} v${report.version}` } });
  doc.pipe(stream);
  const f = report.figures;
  const width = doc.page.width - 80;

  const heading = (text) => {
    if (doc.y > doc.page.height - 120) doc.addPage();
    doc.moveDown(0.6).font('Helvetica-Bold').fontSize(13).fillColor('#1f2a44').text(text).moveDown(0.2);
    doc.font('Helvetica').fontSize(9).fillColor('#222');
  };
  const cols = [0.36, 0.17, 0.17, 0.1, 0.12, 0.08].map((c) => c * width);
  const row = (cells, { bold = false } = {}) => {
    if (doc.y > doc.page.height - 60) doc.addPage();
    const y = doc.y;
    let x = 40;
    let h = 0;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
    cells.forEach((c, i) => {
      doc.text(String(c ?? ''), x, y, { width: cols[i] - 4 });
      h = Math.max(h, doc.y - y);
      x += cols[i];
    });
    doc.y = y + h + 3;
    doc.x = 40;
  };
  const metricTable = (list) => {
    row(['Measure', 'This quarter', 'Prior quarter', 'Change', 'Same qtr last year', 'Change'], { bold: true });
    for (const m of list) {
      row([m.label, valueText(m.value, m.unit, m.currency), valueText(m.priorQuarter?.value, m.unit, m.currency), changeText(m.priorQuarter?.change), valueText(m.lastYear?.value, m.unit, m.currency), changeText(m.lastYear?.change)]);
      if (m.note) doc.fontSize(7.5).fillColor('#666').text(`   ${m.note}`, { width }).fillColor('#222');
    }
  };

  doc.font('Helvetica-Bold').fontSize(18).fillColor('#1f2a44').text('Quarterly decision report');
  doc.font('Helvetica').fontSize(10).fillColor('#333')
    .text(`${f.quarter.label} · version ${report.version}${report.trigger === 'MANUAL' ? ' (regenerated)' : ''}`)
    .text(`Figures frozen at ${f.cutoff} (${f.timezone}). Money in ${f.currency}. Compared with ${f.comparisons.priorQuarter.from} to ${f.comparisons.priorQuarter.to} and ${f.comparisons.lastYear.from} to ${f.comparisons.lastYear.to}.`)
    .text('All figures are computed from the school\'s records by fixed definitions; "not available" means the records do not cover that period. "Not comparable" means the comparison value is missing or zero.', { width });

  if (f.summary?.length) { heading('Summary'); metricTable(f.summary); }
  for (const s of f.sections ?? []) { heading(s.label); metricTable(s.metrics); }

  if (f.budget) {
    heading(`Budget variance (${f.budget.fiscalYear})`);
    if (!f.budget.available) doc.text('No approved budget for this financial year.');
    else {
      row(['Line', 'Planned', 'Committed', 'Actual', 'Variance', ''], { bold: true });
      for (const l of f.budget.lines) row([`${l.code} ${l.head}`, valueText(l.plannedPaise, 'paise', f.budget.currency), valueText(l.committedPaise, 'paise', f.budget.currency), valueText(l.actualPaise, 'paise', f.budget.currency), valueText(l.variancePaise, 'paise', f.budget.currency), '']);
      doc.fontSize(7.5).fillColor('#666').text(f.budget.basis, { width }).fillColor('#222');
    }
  }
  if (f.renewals) {
    heading('Renewals and due items (next 90 days)');
    doc.text(`${f.renewals.totals.count} open item(s), ${f.renewals.totals.overdue} overdue; forecast ${valueText(f.renewals.totals.forecastPaise, 'paise', f.renewals.currency)}${f.renewals.totals.otherCurrencyItems ? ` (plus ${f.renewals.totals.otherCurrencyItems} in another currency, not added)` : ''}.`, { width });
    row(['Item', 'Department', 'Due', 'Owner', 'Amount', ''], { bold: true });
    for (const i of f.renewals.items.slice(0, 40)) row([`${i.title}${i.overdue ? ' (overdue)' : ''}`, i.department, fmtDate(i.dueAt), i.owner, i.amountPaise === null || i.amountPaise === undefined ? '—' : valueText(i.amountPaise, 'paise', i.currency), '']);
  }
  if (f.achievements) {
    heading('Achievements published');
    if (!f.achievements.length) doc.text('None published this quarter.');
    for (const a of f.achievements) doc.text(`• ${a.title} (${fmtDate(a.at)})`, { width });
  }
  if (f.decisions) {
    heading('Decisions and actions');
    if (!f.decisions.approvals.length && !f.decisions.actions.length) doc.text('Nothing is waiting.');
    for (const a of f.decisions.approvals) doc.text(`• ${a.count} ${String(a.category).toLowerCase().replace(/_/g, ' ')} approval(s) waiting${a.oldestDue ? `, oldest due ${fmtDate(a.oldestDue)}` : ''}`, { width });
    for (const a of f.decisions.actions) doc.text(`• ${a.title}: owner ${a.owner}, review by ${fmtDate(a.reviewBy)}`, { width });
  }
  if (f.missing?.length) {
    heading('Missing or incomplete data');
    for (const m of f.missing) doc.text(`• ${m.label}: ${m.note ?? 'not available'}`, { width });
  }
  doc.end();
}
