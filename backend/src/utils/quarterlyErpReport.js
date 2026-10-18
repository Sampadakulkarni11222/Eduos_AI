import PDFDocument from 'pdfkit';

const money = (paise) => `Rs. ${((Number(paise) || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const label = (key) => String(key).replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function scalarRows(value, prefix = '', rows = []) {
  if (value === null || value === undefined) return rows;
  if (Array.isArray(value)) {
    value.forEach((item, index) => scalarRows(item, `${prefix}${prefix ? '.' : ''}${index + 1}`, rows));
  } else if (typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => scalarRows(item, `${prefix}${prefix ? '.' : ''}${key}`, rows));
  } else {
    rows.push([prefix || 'value', String(value)]);
  }
  return rows;
}

function addPageHeader(doc, title, generatedAt) {
  doc.font('Helvetica-Bold').fontSize(19).fillColor('#24120f').text('EduOS AI — Quarterly ERP Report', 50, 48);
  doc.font('Helvetica').fontSize(9).fillColor('#6b625b').text(`${title}  |  Generated ${new Date(generatedAt).toLocaleString('en-IN')}`, 50, 75);
  doc.moveTo(50, 94).lineTo(545, 94).strokeColor('#e5ddd3').stroke();
}

function ensureSpace(doc, y, needed = 32) {
  if (y + needed < 755) return y;
  doc.addPage();
  addPageHeader(doc, 'Continued', new Date());
  return 116;
}

/** Streams a concise, printable executive PDF while the companion CSV retains
 * every scalar returned from each segment dashboard. */
export function renderQuarterlyErpPdf(res, report) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);
  addPageHeader(doc, 'All segments', report.generatedAt);
  let y = 120;

  const finance = report.finance ?? {};
  const financeRows = [
    ['Invoices', finance.invoiceCount], ['Collection rate', `${finance.collectionRate ?? 0}%`],
    ['Billed', money(finance.billedPaise)], ['Collected', money(finance.collectedPaise)],
    ['Outstanding', money(finance.outstandingPaise)], ['Overdue / leakage risk', money(finance.overduePaise)],
    ['Recorded costs', money(finance.totalExpensePaise)], ['Net position', money(finance.netPositionPaise)],
  ];
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#24120f').text('Finance summary', 50, y); y += 27;
  for (const [name, value] of financeRows) {
    doc.font('Helvetica').fontSize(10).fillColor('#5f5750').text(name, 55, y);
    doc.font('Helvetica-Bold').fillColor('#24120f').text(String(value ?? '—'), 340, y, { width: 195, align: 'right' });
    y += 20;
  }

  for (const [name, data] of [['Operations', report.operations], ['Hostel', report.hostel], ['Library', report.library]]) {
    y = ensureSpace(doc, y, 70);
    y += 10;
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#24120f').text(`${name} summary`, 50, y); y += 24;
    const rows = scalarRows(data).slice(0, 18);
    if (!rows.length) {
      doc.font('Helvetica').fontSize(10).fillColor('#6b625b').text('No segment data available.', 55, y); y += 20;
    }
    for (const [metric, value] of rows) {
      y = ensureSpace(doc, y);
      doc.font('Helvetica').fontSize(9).fillColor('#5f5750').text(label(metric), 55, y, { width: 300 });
      doc.font('Helvetica-Bold').fillColor('#24120f').text(value, 360, y, { width: 175, align: 'right' });
      y += 17;
    }
  }
  doc.font('Helvetica-Oblique').fontSize(8).fillColor('#8c837b').text('System-generated, access-controlled quarterly ERP report.', 50, 775, { width: 495, align: 'center' });
  doc.end();
}

/** CSV opens directly in Excel without a new spreadsheet dependency. */
export function quarterlyErpCsv(report) {
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = [['Segment', 'Metric', 'Value']];
  for (const [segment, data] of Object.entries(report)) {
    if (segment === 'generatedAt') continue;
    for (const [metric, value] of scalarRows(data)) lines.push([segment, metric, value]);
  }
  return `\uFEFF${lines.map((row) => row.map(escape).join(',')).join('\r\n')}`;
}
