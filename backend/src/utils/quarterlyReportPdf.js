import PDFDocument from 'pdfkit';
import { env } from '../config/env.js';

function money(paise) {
  const amount = (paise ?? 0) / 100;
  return 'Rs. ' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

/**
 * Streams a professional Quarterly Financial Analysis Report PDF using pure pdfkit primitives.
 */
export function renderQuarterlyFinancialReportPdf(res, report) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(res);

  // Header
  doc.rect(40, 40, 515, 60).fill('#1A2A3A');
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#FFFFFF').text(env.SCHOOL_NAME, 55, 52);
  doc.font('Helvetica').fontSize(11).fillColor('#A0B2C6').text(
    `Quarterly Financial Report — ${report.quarter} (${report.year})`,
    55,
    74
  );

  let y = 115;

  // Period & Metadata
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#333333').text('REPORTING PERIOD:', 40, y);
  doc.font('Helvetica').fontSize(10).fillColor('#666666').text(
    `${fmtDate(report.periodStart)} to ${fmtDate(report.periodEnd)}`,
    160,
    y
  );
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#333333').text('GENERATED ON:', 350, y);
  doc.font('Helvetica').fontSize(10).fillColor('#666666').text(fmtDate(report.createdAt || new Date()), 450, y);

  y += 24;
  doc.moveTo(40, y).lineTo(555, y).strokeColor('#E0E0E0').stroke();
  y += 14;

  // Executive Summary Box
  if (report.executiveSummary) {
    doc.rect(40, y, 515, 45).fill('#F8F9FA');
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#1A2A3A').text('EXECUTIVE SUMMARY', 50, y + 8);
    doc.font('Helvetica').fontSize(8.5).fillColor('#444444').text(report.executiveSummary, 50, y + 22, {
      width: 495,
      height: 25,
      ellipsis: true,
    });
    y += 55;
  }

  // Key Financial KPIs Table
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#1A2A3A').text('KEY FINANCIAL METRICS', 40, y);
  y += 16;

  const m = report.metrics || {};
  const kpis = [
    ['Total Billed Target', money(m.totalBilledPaise), 'Total Collections', money(m.totalCollectedPaise)],
    ['Collection Efficiency', `${m.collectionRatePct || 0}%`, 'Operating Expenses', money(m.totalExpensesPaise)],
    ['Net Operating Margin', money(m.netOperatingMarginPaise), 'Opening Receivables', money(m.openingReceivablesPaise)],
    ['Closing Receivables', money(m.closingReceivablesPaise), 'Concessions / Waivers', money(m.totalConcessionsPaise)],
    ['Refunds Issued', money(m.totalRefundsPaise), 'Unreconciled Payments', money(m.unreconciledPaymentsPaise)],
    ['Potential Leakage', money(m.potentialLeakagePaise), 'Confirmed Leakage', money(m.confirmedLeakagePaise)],
  ];

  for (const row of kpis) {
    doc.rect(40, y, 255, 20).fill('#FAFAFA');
    doc.rect(300, y, 255, 20).fill('#FAFAFA');
    doc.font('Helvetica').fontSize(8.5).fillColor('#555555').text(row[0], 48, y + 5);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#111111').text(row[1], 190, y + 5, { width: 100, align: 'right' });
    doc.font('Helvetica').fontSize(8.5).fillColor('#555555').text(row[2], 308, y + 5);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#111111').text(row[3], 450, y + 5, { width: 100, align: 'right' });
    y += 22;
  }

  y += 12;

  // Receivables Ageing Schedule
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#1A2A3A').text('RECEIVABLES AGEING ANALYSIS', 40, y);
  y += 16;

  const b = report.ageingBuckets || {};
  const ageingRows = [
    ['Current (0 - 30 days)', money(b.currentPaise), '#2E6B4F'],
    ['31 - 60 days overdue', money(b.thirtyToSixtyPaise), '#D97706'],
    ['61 - 90 days overdue', money(b.sixtyToNinetyPaise), '#DC2626'],
    ['90+ days severely overdue', money(b.aboveNinetyPaise), '#7F1D1D'],
  ];

  let x = 40;
  for (const [label, val, color] of ageingRows) {
    doc.rect(x, y, 122, 40).fill('#F3F4F6');
    doc.font('Helvetica-Bold').fontSize(8).fillColor(color).text(label, x + 6, y + 8, { width: 110 });
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111111').text(val, x + 6, y + 24, { width: 110 });
    x += 131;
  }
  y += 50;

  // Segment-wise Breakdown Table
  if (report.segmentPerformance && report.segmentPerformance.length > 0) {
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1A2A3A').text('SEGMENT PERFORMANCE BREAKDOWN', 40, y);
    y += 16;

    doc.rect(40, y, 515, 18).fill('#E5E7EB');
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#374151');
    doc.text('SEGMENT / CLASS', 48, y + 4);
    doc.text('BILLED', 240, y + 4, { width: 90, align: 'right' });
    doc.text('COLLECTED', 345, y + 4, { width: 90, align: 'right' });
    doc.text('OUTSTANDING', 455, y + 4, { width: 90, align: 'right' });
    y += 20;

    for (const seg of report.segmentPerformance.slice(0, 10)) {
      doc.font('Helvetica').fontSize(8.5).fillColor('#1F2937');
      doc.text(seg.segmentName, 48, y + 3, { width: 180 });
      doc.text(money(seg.billedPaise), 240, y + 3, { width: 90, align: 'right' });
      doc.font('Helvetica-Bold').fillColor('#059669').text(money(seg.collectedPaise), 345, y + 3, { width: 90, align: 'right' });
      doc.font('Helvetica-Bold').fillColor('#D97706').text(money(seg.pendingPaise), 455, y + 3, { width: 90, align: 'right' });
      y += 18;
      if (y > 750) break; // stay within single page cleanly
    }
  }

  // Footer
  doc.fontSize(8).fillColor('#9CA3AF').text(
    'Confidential Financial Document · Generated by EduOS AI ERP · All Rights Reserved',
    40,
    785,
    { align: 'center', width: 515 }
  );

  doc.end();
}
