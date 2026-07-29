import PDFDocument from 'pdfkit';
import { env } from '../config/env.js';

function money(paise) {
  const amount = (paise ?? 0) / 100;
  return 'Rs. ' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDateTime(d) {
  return d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
}

/**
 * Streams a real payment receipt PDF to `res`, built entirely with pdfkit
 * primitives — no template asset, matching the idCardPdf.js precedent.
 */
export function renderReceiptPdf(res, payment) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);

  doc.font('Helvetica-Bold').fontSize(20).fillColor('#1a1a1a').text(env.SCHOOL_NAME, 50, 50);
  doc.font('Helvetica').fontSize(10).fillColor('#666').text('Payment Receipt', 50, 76);

  doc.font('Helvetica-Bold').fontSize(16).fillColor('#2E6B4F').text(payment.receiptNo, 350, 50, { width: 195, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#2E6B4F').text(payment.status, 350, 74, { width: 195, align: 'right' });

  doc.moveTo(50, 105).lineTo(545, 105).strokeColor('#e5e5e5').stroke();

  let y = 130;
  const rows = [
    ['Student', payment.studentName ?? '—'],
    ['Class', payment.class ?? '—'],
    ['Invoice No.', payment.invoiceNo ?? '—'],
    ['Transaction ID', payment.receiptNo ?? '—'],
    ['Payment Date', fmtDateTime(payment.createdAt)],
    ['Payment Method', payment.mode ?? '—'],
  ];
  for (const [label, value] of rows) {
    doc.font('Helvetica').fontSize(9).fillColor('#8a8a8a').text(label.toUpperCase(), 50, y);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#222').text(String(value), 220, y - 1, { width: 275, align: 'right' });
    y += 24;
  }

  y += 16;
  doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e5e5').stroke();
  y += 20;

  doc.font('Helvetica-Bold').fontSize(14).fillColor('#222').text('Amount Paid', 50, y);
  doc.font('Helvetica-Bold').fontSize(22).fillColor('#2E6B4F').text(money(payment.amountPaise), 300, y - 4, { width: 195, align: 'right' });

  doc.font('Helvetica-Oblique').fontSize(8).fillColor('#999')
    .text('This is a system-generated receipt and does not require a signature.', 50, 760, { width: 495, align: 'center' });

  doc.end();
}
