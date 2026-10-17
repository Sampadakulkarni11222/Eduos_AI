import PDFDocument from 'pdfkit';

/**
 * PDFs for leadership papers (pdfkit, built-in Helvetica; money reads "INR"
 * because the built-in fonts have no rupee glyph). Board packs carry a
 * "Confidential: board papers" footer and the version; certificates carry the
 * serial number and a verification code the office can check.
 */

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const inr = (paise) => (paise === null || paise === undefined ? '—' : `INR ${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);
const words = (s) => String(s ?? '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

function kit(doc) {
  const width = doc.page.width - 80;
  const heading = (text) => {
    if (doc.y > doc.page.height - 140) doc.addPage();
    doc.moveDown(0.7).font('Helvetica-Bold').fontSize(12.5).fillColor('#1f2a44').text(text, 40).moveDown(0.25);
    doc.font('Helvetica').fontSize(9.5).fillColor('#222');
  };
  const para = (text, opts = {}) => { if (doc.y > doc.page.height - 70) doc.addPage(); doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size ?? 9.5).fillColor(opts.muted ? '#666' : '#222').text(String(text ?? ''), 40, doc.y, { width }); };
  const table = (head, rows, fractions) => {
    const cols = fractions.map((f) => f * width);
    const line = (cells, bold) => {
      if (doc.y > doc.page.height - 60) doc.addPage();
      const y = doc.y; let x = 40; let h = 0;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor('#222');
      cells.forEach((c, i) => { doc.text(String(c ?? ''), x, y, { width: cols[i] - 6 }); h = Math.max(h, doc.y - y); x += cols[i]; });
      doc.y = y + h + 3; doc.x = 40;
    };
    line(head, true);
    for (const r of rows) line(r, false);
  };
  return { width, heading, para, table };
}

export function renderBoardPackPdf(stream, view) {
  const p = view.pack;
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: `Board pack ${p.meeting.refNo}${view.version ? ` v${view.version}` : ''}` } });
  doc.pipe(stream);
  const { heading, para, table } = kit(doc);

  doc.font('Helvetica-Bold').fontSize(18).fillColor('#1f2a44').text('Board pack');
  doc.font('Helvetica').fontSize(11).fillColor('#333').text(`${p.meeting.title} (${p.meeting.refNo})`);
  para(`${p.meeting.scheduledAt ? `Meeting on ${fmtDate(p.meeting.scheduledAt)}` : 'Date to be confirmed'} · ${words(p.meeting.mode)}${p.meeting.location ? ` · ${p.meeting.location}` : ''} · quorum ${p.meeting.quorum ?? 'not set'}`);
  para(view.mode === 'FROZEN' ? `Version ${view.version}, frozen ${fmtDate(view.frozenAt)} by ${view.frozenBy ?? 'the secretariat'}.` : `Live preview built ${fmtDate(p.builtAt)}; not yet frozen for circulation.`, { muted: true });

  heading('Agenda');
  if (!p.meeting.agenda.length) para('No agenda items yet.', { muted: true });
  for (const a of p.meeting.agenda) para(`${a.order}. ${a.title}${a.presenter ? ` (${a.presenter})` : ''}${a.decisionNeeded ? ' [decision]' : ''}${a.papers.length ? ` · papers: ${a.papers.map((x) => x.name).join(', ')}` : ''}`);
  const conflicts = p.meeting.members.flatMap((m) => m.conflicts.map((c) => `${m.name}: item ${c.agendaOrder}, ${c.declaration}`));
  if (conflicts.length) { heading('Declared conflicts of interest'); conflicts.forEach((c) => para(c)); }

  heading('Previous meeting');
  if (!p.previous?.available) para(p.previous?.reason ?? 'Not available.', { muted: true });
  else {
    para(`${p.previous.title} (${p.previous.refNo}), held ${fmtDate(p.previous.heldOn)}. Minutes: ${words(p.previous.minutesStatus)}.`);
    if (p.previous.minutesNote) para(p.previous.minutesNote, { muted: true });
    if (p.previous.minutes) para(p.previous.minutes);
    if (p.previous.resolutions.length) table(['Resolution', 'Text', 'Votes (for/against/abstain)', 'Outcome'], p.previous.resolutions.map((r) => [r.number, r.text, `${r.votesFor}/${r.votesAgainst}/${r.abstentions}`, words(r.outcome)]), [0.16, 0.52, 0.18, 0.14]);
  }

  heading('Action register (open)');
  if (!p.actions?.available || !p.actions.items.length) para(p.actions?.reason ?? 'No open actions.', { muted: true });
  else table(['Action', 'Meeting', 'Owner', 'Due', ''], p.actions.items.map((a) => [a.title, a.meeting, a.ownerName ?? 'Unassigned', fmtDate(a.dueOn), a.overdue ? 'OVERDUE' : '']), [0.38, 0.24, 0.16, 0.12, 0.1]);

  heading('Finance (this financial year)');
  if (!p.finance?.available) para(p.finance.reason, { muted: true });
  else {
    para(`${p.finance.period?.label ?? ''}${p.finance.comparison ? `, compared with ${p.finance.comparison.label}` : ''}.`, { muted: true });
    table(['Measure', 'This year', 'Last year', 'Change'], p.finance.metrics.map((m) => [m.label, m.text, m.comparisonText ?? '—', m.changePct === null ? '—' : `${m.changePct > 0 ? '+' : ''}${m.changePct}%`]), [0.4, 0.22, 0.22, 0.16]);
    para(p.finance.note, { muted: true, size: 8 });
  }

  heading('Budget');
  if (!p.budget?.available) para(p.budget.reason, { muted: true });
  else {
    para(`${p.budget.name} (${p.budget.fiscalYear}), ${words(p.budget.status)}. ${p.budget.yearElapsedPct}% of the year has passed.`);
    table(['Line', 'Planned', 'Committed', 'Spent', 'Used'], p.budget.lines.map((l) => [`${l.code} ${l.head}`, inr(l.plannedPaise), inr(l.committedPaise), inr(l.actualPaise), l.utilisationPct === null ? '—' : `${l.utilisationPct}%`]), [0.36, 0.17, 0.17, 0.17, 0.13]);
    table(['Total', inr(p.budget.totals.planned), inr(p.budget.totals.committed), inr(p.budget.totals.actual), ''], [], [0.36, 0.17, 0.17, 0.17, 0.13]);
    const py = p.budget.previousYear;
    if (py) {
      para(`Last year (${py.fiscalYear}): planned ${inr(py.planned)}, spent ${inr(py.actual)}.`, { bold: true });
      if (py.overruns.length) table(['Line over budget', 'Planned', 'Spent', 'Over', 'Explanation'], py.overruns.map((o) => [`${o.code} ${o.head}`, inr(o.plannedPaise), inr(o.actualPaise), o.overPct === null ? '—' : `${o.overPct}%`, o.explanation ?? 'None recorded']), [0.26, 0.15, 0.15, 0.1, 0.34]);
    }
  }

  heading('Compliance exceptions');
  if (!p.compliance?.available) para(p.compliance.reason, { muted: true });
  else {
    if (!p.compliance.overdue.length) para('Nothing overdue.');
    else table(['Overdue item', 'Kind', 'Date'], p.compliance.overdue.map((i) => [i.title, words(i.kind), fmtDate(i.date)]), [0.6, 0.2, 0.2]);
    if (p.compliance.dueIn30Days.length) { para('Due in the next 30 days:', { bold: true }); table(['Item', 'Kind', 'Date'], p.compliance.dueIn30Days.map((i) => [i.title, words(i.kind), fmtDate(i.date)]), [0.6, 0.2, 0.2]); }
  }

  heading('Decisions waiting for the board');
  if (!p.decisions?.available) para(p.decisions.reason, { muted: true });
  else if (!p.decisions.items.length) para('None.');
  else table(['Request', 'Title', 'Amount', 'Due'], p.decisions.items.map((d) => [d.refNo, d.title, d.amountPaise ? inr(d.amountPaise) : '—', fmtDate(d.dueAt)]), [0.18, 0.5, 0.17, 0.15]);

  if (p.enrolment?.available) { heading('Enrolment'); para(`${p.enrolment.studentsOnRoll} students on roll.`); }

  if (p.questions?.length) {
    heading('Questions members may wish to ask');
    p.questions.forEach((q, i) => { para(`${i + 1}. ${q.question}`, { bold: true }); para(`   Based on: ${q.basis}`, { muted: true, size: 8.5 }); });
    para(p.questionsNote, { muted: true, size: 8 });
  }

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(7.5).fillColor('#888').text(`Confidential: board papers · ${p.meeting.refNo}${view.version ? ` v${view.version}` : ' (live preview)'} · page ${i + 1} of ${range.count}`, 40, doc.page.height - 30, { width: doc.page.width - 80, align: 'center', lineBreak: false });
  }
  doc.end();
}

/** A certificate from the student record, laid out the way school offices issue them. */
export function renderCertificatePdf(stream, c) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `${c.title} ${c.serialNo}` } });
  doc.pipe(stream);
  const width = doc.page.width - 100;
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#1f2a44').text(c.school.name, { align: 'center', width });
  const sub = [c.school.address, c.school.affiliation].filter(Boolean).join(' · ');
  if (sub) doc.font('Helvetica').fontSize(9).fillColor('#444').text(sub, { align: 'center', width });
  doc.moveDown(0.8).font('Helvetica-Bold').fontSize(14).fillColor('#111').text(c.title.toUpperCase(), { align: 'center', width, underline: true });
  doc.moveDown(0.4).font('Helvetica').fontSize(9).fillColor('#333').text(`Serial no. ${c.serialNo}`, 50, doc.y, { continued: true }).text(`Admission no. ${c.admissionNo ?? '—'}`, { align: 'right' });
  doc.moveDown(0.8);
  if (c.body) { doc.font('Helvetica').fontSize(11).fillColor('#111').text(c.body, 50, doc.y, { width, align: 'justify', lineGap: 4 }); doc.moveDown(0.8); }
  if (c.rows?.length) {
    doc.font('Helvetica').fontSize(9.5).fillColor('#111');
    c.rows.forEach(([label, value], i) => {
      if (doc.y > doc.page.height - 140) doc.addPage();
      const y = doc.y;
      doc.text(`${i + 1}.`, 50, y, { width: 22 });
      doc.text(label, 72, y, { width: width * 0.48 });
      const h1 = doc.y;
      doc.font('Helvetica-Bold').text(String(value ?? '—'), 72 + width * 0.5, y, { width: width * 0.46 });
      doc.font('Helvetica');
      doc.y = Math.max(h1, doc.y) + 4;
    });
  }
  doc.moveDown(2);
  const y = Math.min(doc.y, doc.page.height - 150);
  doc.font('Helvetica').fontSize(9.5).text(`Date of issue: ${fmtDate(c.issuedAt)}`, 50, y);
  doc.text('Prepared by (office)', 50, y + 50, { width: 160 });
  doc.text('Checked by', 230, y + 50, { width: 140 });
  doc.text('Principal (signature and seal)', 390, y + 50, { width: 160 });
  doc.font('Helvetica').fontSize(7.5).fillColor('#666').text(`Generated from the school's records by EduOS. Verification code ${c.verificationCode}: the school office can confirm this certificate against its register of issued certificates. Not valid without the principal's signature and the school seal.`, 50, doc.page.height - 70, { width, align: 'center' });
  doc.end();
}
