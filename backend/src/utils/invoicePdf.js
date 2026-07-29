import PDFDocument from 'pdfkit';
import { env } from '../config/env.js';

const STATUS_COLOR = { PAID: '#2E6B4F', PARTIAL: '#946312', PENDING: '#7A7264', OVERDUE: '#A8322E', CANCELLED: '#7A7264' };

function money(paise) {
  const amount = (paise ?? 0) / 100;
  return 'Rs. ' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

/**
 * Streams a real fee invoice PDF (header, billed-to block, line items,
 * totals) to `res`, built entirely with pdfkit primitives — no template
 * asset, matching the idCardPdf.js precedent.
 */
export function renderInvoicePdf(res, invoice) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);

  doc.font('Helvetica-Bold').fontSize(20).fillColor('#1a1a1a').text(env.SCHOOL_NAME, 50, 50);
  doc.font('Helvetica').fontSize(10).fillColor('#666').text('Fee Invoice', 50, 76);

  doc.font('Helvetica-Bold').fontSize(16).fillColor('#1a1a1a').text(invoice.invoiceNo, 350, 50, { width: 195, align: 'right' });
  const statusColor = STATUS_COLOR[invoice.status] ?? '#7A7264';
  doc.font('Helvetica-Bold').fontSize(10).fillColor(statusColor).text(invoice.status, 350, 74, { width: 195, align: 'right' });

  doc.moveTo(50, 105).lineTo(545, 105).strokeColor('#e5e5e5').stroke();

  let y = 122;
  const infoRows = [
    ['Billed To', invoice.studentName ?? '—'],
    ['Class', invoice.class ?? '—'],
    ['Invoice Date', fmtDate(invoice.createdAt)],
    ['Due Date', fmtDate(invoice.dueOn)],
  ];
  for (const [label, value] of infoRows) {
    doc.font('Helvetica').fontSize(9).fillColor('#8a8a8a').text(label.toUpperCase(), 50, y);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#222').text(value, 200, y - 1);
    y += 22;
  }

  y += 12;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#8a8a8a');
  doc.text('DESCRIPTION', 50, y);
  doc.text('AMOUNT', 380, y, { width: 80, align: 'right' });
  doc.text('CONCESSION', 465, y, { width: 80, align: 'right' });
  y += 16;
  doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e5e5').stroke();
  y += 10;

  for (const line of invoice.lines ?? []) {
    doc.font('Helvetica').fontSize(10.5).fillColor('#222').text(line.description, 50, y, { width: 320 });
    doc.text(money(line.amountPaise), 380, y, { width: 80, align: 'right' });
    doc.text(line.concessionPaise ? money(line.concessionPaise) : '—', 465, y, { width: 80, align: 'right' });
    y += 20;
  }

  y += 8;
  doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e5e5').stroke();
  y += 14;

  const totals = [
    ['Total', invoice.totalPaise],
    ['Paid', invoice.paidPaise],
    ['Balance Due', invoice.totalPaise - invoice.paidPaise],
  ];
  for (const [label, paise] of totals) {
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#222').text(label, 350, y, { width: 110 });
    doc.text(money(paise), 465, y, { width: 80, align: 'right' });
    y += 20;
  }

  doc.font('Helvetica-Oblique').fontSize(8).fillColor('#999')
    .text('This is a system-generated invoice.', 50, 760, { width: 495, align: 'center' });

  doc.end();
}
