import PDFDocument from 'pdfkit';

const INK = '#24120f';
const MUTED = '#786e65';
const WINE = '#671520';
const GOLD = '#bf8b2c';
const RULE = '#e9dfd2';
const PAPER = '#fcfaf6';

const money = (paise) => `Rs. ${((Number(paise) || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const count = (items) => Array.isArray(items) ? items.length : 0;
const total = (items, key = 'count') => (Array.isArray(items) ? items : []).reduce((sum, item) => sum + (Number(item?.[key]) || 0), 0);

/** A curated management-report contract. Dashboard responses include recent
 * records with internal IDs; management reports must contain readable KPIs,
 * never implementation details such as Mongo ObjectId buffers. */
function sections(report) {
  const finance = report.finance ?? {};
  const operations = report.operations ?? {};
  const hostel = report.hostel ?? {};
  const library = report.library ?? {};
  return [
    { name: 'Finance', rows: [
      ['Invoices raised', finance.invoiceCount ?? 0], ['Collection rate', `${finance.collectionRate ?? 0}%`],
      ['Total billed', money(finance.billedPaise)], ['Collections received', money(finance.collectedPaise)],
      ['Outstanding balance', money(finance.outstandingPaise)], ['Overdue / leakage risk', money(finance.overduePaise)],
      ['Recorded operating costs', money(finance.totalExpensePaise)], ['Net position', money(finance.netPositionPaise)],
    ] },
    { name: 'Operations', rows: [
      ['Active students', operations.totalStudents ?? 0], ['Open support tickets', operations.openTickets ?? 0],
      ['Published announcements', operations.announcementsCount ?? 0], ['Admissions in pipeline', total(operations.admissionsPipeline)],
      ['Recent admissions shown', count(operations.recentStudents)],
    ] },
    { name: 'Hostel', rows: [
      ['Resident students', hostel.hostelStudents ?? 0], ['Total bed capacity', hostel.totalCapacity ?? 0],
      ['Vacant beds', hostel.vacantBeds ?? 0], ['Occupancy rate', `${hostel.occupancyRate ?? 0}%`],
      ['Maintenance rooms', hostel.maintenanceRooms ?? 0], ['Open hostel tickets', count(hostel.openTickets)],
      ['Pending resident leave requests', hostel.pendingLeaveCount ?? 0],
    ] },
    { name: 'Library', rows: [
      ['Book titles', library.totalBooks ?? 0], ['Total copies', library.totalCopies ?? 0],
      ['Available copies', library.availableBooks ?? 0], ['Books currently issued', library.issuedBooks ?? 0],
      ['Overdue issues', library.overdueBooks ?? 0], ['Issued today', library.booksIssuedToday ?? 0],
      ['Returned today', library.booksReturnedToday ?? 0],
    ] },
  ];
}

function header(doc, report, continued = false) {
  doc.rect(0, 0, 595, 112).fill(WINE);
  doc.font('Helvetica-Bold').fontSize(21).fillColor('#ffffff')
    .text(continued ? 'Quarterly ERP Report — Continued' : 'EduOS AI', 50, 35);
  if (!continued) doc.font('Helvetica').fontSize(11).fillColor('#f2dca7').text('Quarterly management review', 50, 62);
  doc.font('Helvetica').fontSize(8.5).fillColor('#ffffff')
    .text(`Generated ${new Date(report.generatedAt).toLocaleString('en-IN')}`, 50, 87)
    .text('CONFIDENTIAL • SCHOOL ADMINISTRATION', 350, 87, { width: 195, align: 'right' });
}

function footer(doc, page) {
  // Keep footer inside PDFKit's bottom margin. Drawing at y=798 with a
  // 50-point margin makes PDFKit silently add a new blank page.
  doc.moveTo(50, 760).lineTo(545, 760).strokeColor(RULE).stroke();
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
    .text('System-generated, access-controlled management report.', 50, 770)
    .text(`Page ${page}`, 465, 770, { width: 80, align: 'right' });
}

function sectionTitle(doc, title, y) {
  doc.rect(50, y, 5, 24).fill(GOLD);
  doc.font('Helvetica-Bold').fontSize(14).fillColor(INK).text(`${title} overview`, 66, y + 4);
}

function drawRows(doc, rows, y) {
  for (let index = 0; index < rows.length; index += 1) {
    const [metric, value] = rows[index];
    if (index % 2 === 0) doc.rect(50, y - 4, 495, 22).fill(PAPER);
    doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(metric, 62, y);
    doc.font('Helvetica-Bold').fillColor(INK).text(String(value ?? '—'), 335, y, { width: 195, align: 'right' });
    y += 22;
  }
  return y;
}

function executiveCards(doc, report) {
  const finance = report.finance ?? {};
  const cards = [
    ['Collection rate', `${finance.collectionRate ?? 0}%`, '#2d6b4f'],
    ['Net position', money(finance.netPositionPaise), WINE],
    ['Leakage risk', money(finance.overduePaise), '#a22f2f'],
  ];
  let x = 50;
  for (const [title, value, color] of cards) {
    doc.roundedRect(x, 133, 157, 67, 7).fillAndStroke('#ffffff', RULE);
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(title, x + 12, 146);
    doc.font('Helvetica-Bold').fontSize(15).fillColor(color).text(value, x + 12, 165, { width: 133, ellipsis: true });
    x += 169;
  }
}

/** Streams a polished, printable executive PDF. */
export function renderQuarterlyErpPdf(res, report) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: 'Quarterly ERP Report', Author: 'EduOS AI' } });
  doc.pipe(res);
  let page = 1;
  header(doc, report);
  executiveCards(doc, report);
  let y = 228;
  for (const section of sections(report)) {
    const needed = 44 + section.rows.length * 22;
    if (y + needed > 750) {
      footer(doc, page);
      doc.addPage(); page += 1; header(doc, report, true); y = 137;
    }
    sectionTitle(doc, section.name, y); y += 36;
    y = drawRows(doc, section.rows, y) + 14;
  }
  footer(doc, page);
  doc.end();
}

/** CSV opens directly in Excel without a new spreadsheet dependency. */
export function quarterlyErpCsv(report) {
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = [['Segment', 'Metric', 'Value']];
  for (const section of sections(report)) for (const [metric, value] of section.rows) lines.push([section.name, metric, value]);
  return `\uFEFF${lines.map((row) => row.map(escape).join(',')).join('\r\n')}`;
}
