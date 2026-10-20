import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import { env } from '../config/env.js';
import { amountInWords, fmtDateIST } from '../modules/finance-ops/format.js';

/**
 * Fee receipt PDF.
 *
 * pdfkit's built-in fonts (Helvetica & co.) are WinAnsi-encoded and have no
 * ₹ glyph — writing "₹" with them prints a blank or a wrong character. So a
 * Unicode TrueType font that does carry U+20B9 is used when one is available
 * (RECEIPT_FONT_PATH, or a common system location); without one the amount
 * reads "INR", which is unambiguous, rather than a broken symbol.
 */

const FONT_CANDIDATES = [
  process.env.RECEIPT_FONT_PATH,
  '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
  '/usr/share/fonts/noto/NotoSans-Regular.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans.ttf',
  '/Library/Fonts/Arial Unicode.ttf',
  'C:\\Windows\\Fonts\\arial.ttf',
  'C:\\Windows\\Fonts\\Nirmala.ttf',
].filter(Boolean);

const BOLD_FOR = {
  'NotoSans-Regular.ttf': 'NotoSans-Bold.ttf',
  'DejaVuSans.ttf': 'DejaVuSans-Bold.ttf',
  'arial.ttf': 'arialbd.ttf',
  'Nirmala.ttf': 'NirmalaB.ttf',
};

let resolvedFonts;
/** `{ regular, bold }` paths of a ₹-capable font, or null. Resolved once. */
export function rupeeFont() {
  if (resolvedFonts !== undefined) return resolvedFonts;
  resolvedFonts = null;
  for (const path of FONT_CANDIDATES) {
    try {
      if (!fs.existsSync(path)) continue;
      const base = path.split(/[\\/]/).pop();
      const boldPath = BOLD_FOR[base] ? path.slice(0, path.length - base.length) + BOLD_FOR[base] : null;
      resolvedFonts = { regular: path, bold: boldPath && fs.existsSync(boldPath) ? boldPath : path };
      break;
    } catch { /* try the next one */ }
  }
  return resolvedFonts;
}

export function money(paise, { rupeeGlyph = false } = {}) {
  const amount = (paise ?? 0) / 100;
  const text = amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return rupeeGlyph ? `₹${text}` : `INR ${text}`;
}

const MODE_LABEL = {
  CASH: 'Cash', CHEQUE: 'Cheque', DD: 'Demand draft', BANK: 'Bank transfer', UPI: 'UPI', GATEWAY: 'Online (payment gateway)',
};

/** What the reference row is called for each mode. */
const REF_LABEL = {
  CHEQUE: 'Cheque No.', DD: 'DD No.', BANK: 'UTR / Reference', UPI: 'UPI UTR', GATEWAY: 'Gateway Transaction ID',
};

/**
 * The receipt's content, separate from drawing it, so what a receipt says can
 * be checked without parsing a PDF.
 */
export function receiptContent(payment, { rupeeGlyph = false } = {}) {
  const m = (p) => money(p, { rupeeGlyph });
  const details = [
    ['Student', payment.studentName ?? '—'],
    ['Admission No.', payment.admissionNo ?? '—'],
    ['Class', payment.class ?? '—'],
    ['Academic Year', payment.academicYear ?? '—'],
    ['Invoice No.', payment.invoiceNo ?? '—'],
    ['Payment Date', fmtDateIST(payment.paidOn ?? payment.createdAt)],
    ['Payment Method', MODE_LABEL[payment.mode] ?? payment.mode ?? '—'],
  ];
  if (payment.mode !== 'CASH') {
    details.push([REF_LABEL[payment.mode] ?? 'Transaction Ref.', payment.transactionRef ?? '—']);
    if (payment.instrument?.bankName) details.push(['Bank', payment.instrument.bankName]);
  }
  if (payment.counterfoilNo) details.push(['Counterfoil No.', payment.counterfoilNo]);

  const heads = (payment.feeHeads ?? []).map((h) => [
    h.description,
    m((h.amountPaise ?? 0) - (h.concessionPaise ?? 0)),
  ]);

  const totals = [
    ['Amount Paid', m(payment.amountPaise)],
    ...(payment.refundedPaise ? [['Refunded', m(payment.refundedPaise)]] : []),
    ...(payment.invoiceTotalPaise !== null && payment.invoiceTotalPaise !== undefined
      ? [['Invoice Total', m(payment.invoiceTotalPaise)], ['Balance Due', m(payment.balanceDuePaise ?? 0)]]
      : []),
  ];

  // A person took cash or an instrument across a counter: the receipt is
  // signed by them. Only a gateway payment, which no person received, is
  // system-generated.
  const footer = payment.mode === 'GATEWAY'
    ? 'This is a system-generated receipt for an online payment.'
    : null;

  return {
    receiptNo: payment.receiptNo ?? '—',
    status: payment.status ?? 'SUCCESS',
    details,
    heads,
    totals,
    amountInWords: amountInWords(payment.amountPaise),
    receivedBy: payment.mode === 'GATEWAY' ? null : (payment.receivedBy ?? '—'),
    footer,
  };
}

/** Streams the receipt PDF to `res`. */
export function renderReceiptPdf(res, payment) {
  const fonts = rupeeFont();
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  let regular = 'Helvetica';
  let bold = 'Helvetica-Bold';
  if (fonts) {
    try {
      doc.registerFont('Receipt', fonts.regular);
      doc.registerFont('Receipt-Bold', fonts.bold);
      regular = 'Receipt';
      bold = 'Receipt-Bold';
    } catch { /* fall back to Helvetica and "INR" */ }
  }
  const c = receiptContent(payment, { rupeeGlyph: regular === 'Receipt' });
  doc.pipe(res);

  doc.font(bold).fontSize(20).fillColor('#1a1a1a').text(env.SCHOOL_NAME, 50, 50, { width: 300 });
  doc.font(regular).fontSize(10).fillColor('#666').text('Fee Receipt', 50, 76);

  doc.font(bold).fontSize(14).fillColor('#2E6B4F').text(c.receiptNo, 330, 50, { width: 215, align: 'right' });
  doc.font(bold).fontSize(10).fillColor('#2E6B4F').text(c.status, 330, 72, { width: 215, align: 'right' });

  doc.moveTo(50, 100).lineTo(545, 100).strokeColor('#e5e5e5').stroke();

  let y = 114;
  for (const [label, value] of c.details) {
    doc.font(regular).fontSize(9).fillColor('#8a8a8a').text(label.toUpperCase(), 50, y);
    doc.font(bold).fontSize(10.5).fillColor('#222').text(String(value), 220, y - 1, { width: 325, align: 'right' });
    y += 20;
  }

  if (c.heads.length) {
    y += 8;
    doc.font(bold).fontSize(9).fillColor('#8a8a8a').text('FEE HEAD', 50, y);
    doc.text('AMOUNT', 395, y, { width: 150, align: 'right' });
    y += 14;
    doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e5e5').stroke();
    y += 6;
    for (const [desc, amt] of c.heads) {
      doc.font(regular).fontSize(10).fillColor('#222').text(desc, 50, y, { width: 340 });
      doc.text(amt, 395, y, { width: 150, align: 'right' });
      y += 18;
    }
  }

  y += 8;
  doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e5e5').stroke();
  y += 12;
  for (const [label, value] of c.totals) {
    const big = label === 'Amount Paid';
    doc.font(bold).fontSize(big ? 13 : 10.5).fillColor(big ? '#2E6B4F' : '#222').text(label, 50, y);
    doc.font(bold).fontSize(big ? 16 : 10.5).fillColor(big ? '#2E6B4F' : '#222').text(value, 300, y - (big ? 2 : 0), { width: 245, align: 'right' });
    y += big ? 26 : 18;
  }

  doc.font(regular).fontSize(10).fillColor('#222').text(c.amountInWords, 50, y + 4, { width: 495 });
  y += 40;

  if (c.receivedBy) {
    doc.font(regular).fontSize(10).fillColor('#222').text(`Received by: ${c.receivedBy}`, 50, y);
    doc.moveTo(380, y + 34).lineTo(545, y + 34).strokeColor('#999').stroke();
    doc.font(regular).fontSize(8.5).fillColor('#666').text('Cashier / authorised signatory', 380, y + 38, { width: 165, align: 'center' });
  }

  if (c.footer) {
    doc.font(regular).fontSize(8).fillColor('#999').text(c.footer, 50, 760, { width: 495, align: 'center' });
  }

  doc.end();
}
