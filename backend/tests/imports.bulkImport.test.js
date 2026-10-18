import crypto from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import * as XLSX from 'xlsx';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { resetAgentThrottle } from '../src/modules/ai/agent/throttle.js';
import { runAgentSafely } from '../src/modules/ai/agent/orchestrator.js';
import { getMcpTool, mcpToolsFor, confirmableOn } from '../src/modules/ai/mcp/registry.js';
import { ImportFile } from '../src/models/importFile.model.js';
import { Student, Enrollment } from '../src/models/student.model.js';
import { Book } from '../src/models/library.model.js';
import { Mark } from '../src/models/exam.model.js';
import { AttendanceRecord } from '../src/models/attendanceRecord.model.js';
import { mapHeaders, rankSchemas, parsePhone, parseDate, parseAmount, parseEnum } from '../src/modules/imports/mapping.js';
import { IMPORT_SCHEMAS, SCHEMA_BY_KEY, schemasFor } from '../src/modules/imports/schemas.js';
import { readSheet, toXlsx } from '../src/modules/imports/sheet.js';
import * as imports from '../src/modules/imports/imports.service.js';
import { converseWithDocument } from '../src/modules/whatsapp/whatsapp.agent.js';
import { extractMessages } from '../src/modules/whatsapp/whatsapp.service.js';
import { seedAskAiSchool } from './support/askAiSchool.js';
import { startApi } from './support/mcpHttp.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { env } from '../src/config/env.js';
import { TransportRoute } from '../src/models/transport.model.js';
import { inSchool, mcp, actorForRole, OAK } from './support/mcpSchool.js';

/**
 * Bulk import through Ask AI (p7): a sheet attached on the website or sent on
 * WhatsApp is recognised, its columns mapped, every row checked, and -- after
 * one confirmation on the website -- imported through the module's own bulk
 * service. Proven here end to end against a real school.
 */

const csv = (rows) => Buffer.from(rows.map((r) => r.join(',')).join('\n'), 'utf8');
const xlsx = (rows) => toXlsx([{ name: 'Sheet1', rows }]);

afterAll(async () => { await resetMcpClient(); });

describe('reading a sheet the way a person wrote it', () => {
  it('maps headers with typos, synonyms and Hindi', () => {
    const students = SCHEMA_BY_KEY.students;
    const { mapping } = mapHeaders(['Studnet Name', 'Mob No.', 'Adm. No', 'Std', 'Div'], students);
    expect(mapping).toMatchObject({ displayName: 0, phone: 1, admissionNo: 2, gradeName: 3, sectionName: 4 });
    const hindi = mapHeaders(['नाम', 'मोबाइल', 'कक्षा', 'वर्ग'], students).mapping;
    expect(hindi).toMatchObject({ displayName: 0, phone: 1, gradeName: 2, sectionName: 3 });
    const books = mapHeaders(['Book Title', 'Writer', 'ISBN No', 'Qty'], SCHEMA_BY_KEY.library_books).mapping;
    expect(books).toMatchObject({ title: 0, author: 1, isbn: 2, totalCopies: 3 });
  });

  it('detects the target from the header row, and from the words when the headers are shared', () => {
    const top = (headers, text = '') => rankSchemas(headers, IMPORT_SCHEMAS, { text })[0].schema.key;
    expect(top(['Title', 'Author', 'ISBN', 'Copies'])).toBe('library_books');
    expect(top(['Admission No', 'Description', 'Amount', 'Due Date'])).toBe('fee_invoices');
    expect(top(['Room No', 'Beds', 'Block', 'Type'])).toBe('hostel_rooms');
    expect(top(['Child Name', 'Parent Name', 'Mobile', 'Class applying for'])).toBe('admission_enquiries');
    expect(top(['Roll No', 'Name', 'Status'])).toBe('attendance');
    expect(top(['Roll No', 'Name', 'Marks'])).toBe('marks');
    expect(top(['Name', 'Phone', 'Designation'])).toBe('staff');
    expect(top(['Name', 'Phone', 'Class', 'Section'], 'new students for this year')).toBe('students');
  });

  it('reads Indian phone numbers, day-first dates, rupee amounts and spoken statuses', () => {
    expect(parsePhone('98765 43210')).toBe('+919876543210');
    expect(parsePhone('09876543210')).toBe('+919876543210');
    expect(parsePhone('12345')).toBeNull();
    expect(parseDate('10/06/2026')).toBe('2026-06-10');
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('5 Aug 2026')).toBe('2026-08-05');
    expect(parseAmount('₹8,000/-')).toBe(8000);
    const att = SCHEMA_BY_KEY.attendance.columns.find((c) => c.key === 'status');
    expect(att.values).toContain('PRESENT');
    expect(parseEnum('P', { PRESENT: ['p'], ABSENT: ['a'] })).toBe('PRESENT');
    expect(parseEnum('presnt', { PRESENT: ['p', 'present'], ABSENT: ['a'] })).toBe('PRESENT');
  });

  it('reads an Excel workbook, skipping a title line above the table', () => {
    const buf = xlsx([['Class 6 A — library list'], ['Title', 'Author'], ['Godaan', 'Premchand']]);
    const sheet = readSheet(buf, 'xlsx');
    expect(sheet.headers).toEqual(['Title', 'Author']);
    expect(sheet.rows).toEqual([['Godaan', 'Premchand']]);
    expect(sheet.rowNumbers).toEqual([3]);
  });

  it('every import has a sample sheet: headers, an example row and a Notes sheet', () => {
    for (const schema of IMPORT_SCHEMAS) {
      const book = imports.template(schema.key, 'xlsx');
      const wb = XLSX.read(book.body, { type: 'buffer' });
      expect(wb.SheetNames).toEqual(['Template', 'Notes']);
      const grid = XLSX.utils.sheet_to_json(wb.Sheets.Template, { header: 1 });
      expect(grid[0]).toEqual(schema.columns.map((c) => c.label));
      const notes = XLSX.utils.sheet_to_json(wb.Sheets.Notes, { header: 1 });
      expect(notes[0][0]).toBe('Column');
      const flat = imports.template(schema.key, 'csv').body.toString('utf8');
      expect(flat.replace(/^\uFEFF/, '').split('\r\n')[0]).toContain(schema.columns[0].label);
    }
  });

  it('every bulk route the screens have is in the registry', () => {
    expect(IMPORT_SCHEMAS.map((s) => s.route)).toEqual(expect.arrayContaining([
      'POST /users/bulk', 'POST /academics/grades/bulk', 'POST /academics/sections/bulk', 'POST /academics/subjects/bulk',
      'POST /enrollments/bulk', 'POST /fees/invoices/bulk', 'POST /admissions/leads/bulk', 'POST /library/books/bulk',
      'POST /library/issues/bulk', 'POST /hostel/rooms/bulk', 'POST /hostel/allocations/bulk', 'POST /transport/routes/bulk',
      'POST /transport/stops/bulk', 'POST /transport/enroll/bulk', 'POST /attendance/mark/bulk',
    ]));
  });
});

describe('the tools: permissions and channels', () => {
  it('are offered to whoever can import something, and never to families', () => {
    const names = (role) => mcpToolsFor(actorForRole(role)).map((t) => t.name);
    for (const role of ['ADMIN', 'TEACHER', 'FINANCE', 'LIBRARIAN', 'WARDEN', 'PRINCIPAL']) {
      expect(names(role), role).toEqual(expect.arrayContaining(['describe_import_formats', 'get_import_template', 'preview_import', 'run_import', 'get_import_result']));
    }
    for (const role of ['PARENT', 'STUDENT']) expect(names(role).filter((n) => /import/.test(n)), role).toEqual([]);
    expect(schemasFor(actorForRole('TEACHER')).map((s) => s.key).sort()).toEqual(['attendance', 'marks']);
    expect(schemasFor(actorForRole('LIBRARIAN')).map((s) => s.key).sort()).toEqual(['library_books', 'library_issues']);
  });

  it('run_import is a HIGH-risk draft confirmed on the website only', () => {
    const tool = getMcpTool('run_import');
    expect(tool.confirm).toBe(true);
    expect(tool.risk).toBe('HIGH');
    expect(confirmableOn(tool, 'WHATSAPP')).toBe(false);
    expect(confirmableOn(tool, 'WEB')).toBe(true);
  });
});

describe('a bulk import against a real school', () => {
  let school;
  const admin = () => school.people.ADMIN.actor;
  const teacher = () => school.people.TEACHER.actor;
  const upload = (actor, name, buffer, channel = 'WEB') => inSchool(OAK, () => imports.storeFile({ actor, channel, name, buffer }));
  const confirm = async (actor, proposal, channel = 'WEB') => mcp(OAK, actor, 'run_import', {}, { channel, confirmationToken: proposal.action.confirmationToken });

  // tests/setup.js empties every collection after each test, so each starts from the seeded school.
  beforeEach(async () => { school = await seedAskAiSchool(); });

  it('new students: typo headers mapped, every row ready, one website confirmation imports, and again is a no-op', async () => {
    const file = await upload(admin(), 'new admissions.csv', csv([
      ['Studnet Name', 'Mobile', 'Adm No', 'Class'],
      ['Kavya Rao', '9811100001', 'OAK-501', 'Class 6 A'],
      ['Arjun Mehta', '9811100002', 'OAK-502', 'Class 6 B'],
    ]));
    const preview = await mcp(OAK, admin(), 'preview_import', { fileId: file.fileId, hint: 'upload this sheet of new students' });
    expect(preview.success).toBe(true);
    expect(preview.data.status).toBe('READY');
    expect(preview.data.target.key).toBe('students');
    expect(preview.data.counts).toMatchObject({ total: 2, ready: 2, problems: 0 });
    expect(preview.speak).toMatch(/"Studnet Name" → Student name/);

    const proposal = await mcp(OAK, admin(), 'run_import', { fileId: file.fileId });
    expect(proposal.action.status).toBe('confirmation_required');
    expect(proposal.action.summary).toMatch(/Import 2 row\(s\) from new admissions\.csv into New students/);
    const done = await confirm(admin(), proposal);
    expect(done.success).toBe(true);
    expect(done.data).toMatchObject({ imported: 2, failed: 0 });
    expect(done.speak).toMatch(/Uploaded successfully/);

    await inSchool(OAK, async () => {
      const kavya = await Student.findOne({ admissionNo: 'OAK-501' }).lean();
      expect(kavya).toMatchObject({ firstName: 'Kavya', lastName: 'Rao' });
      expect(await Enrollment.countDocuments({ studentId: kavya._id, sectionId: school.sectionA._id })).toBe(1);
      // The raw sheet is gone the moment the import finished.
      const row = await ImportFile.findById(file.fileId).select('+data').lean();
      expect(row.data).toBeNull();
      expect(row.status).toBe('IMPORTED');
    });

    // Idempotent: the same file, again -- nothing is written twice.
    const again = await mcp(OAK, admin(), 'run_import', { fileId: file.fileId });
    expect(again.success).toBe(false);
    expect(again.error.message).toMatch(/already imported/);
    // The same bytes uploaded again are recognised at import time.
    const twin = await upload(admin(), 'copy.csv', csv([
      ['Studnet Name', 'Mobile', 'Adm No', 'Class'],
      ['Kavya Rao', '9811100001', 'OAK-501', 'Class 6 A'],
      ['Arjun Mehta', '9811100002', 'OAK-502', 'Class 6 B'],
    ]));
    const twinPreview = await mcp(OAK, admin(), 'preview_import', { fileId: twin.fileId, target: 'students' });
    // Every row was imported before: skipped, nothing ready, nothing to confirm.
    expect(twinPreview.data.counts).toMatchObject({ ready: 0, skipped: 2 });
    expect(twinPreview.speak).toMatch(/already in/);
    const twinRun = await mcp(OAK, admin(), 'run_import', { fileId: twin.fileId });
    expect(twinRun.success).toBe(false);
    await inSchool(OAK, async () => expect(await Student.countDocuments({ admissionNo: 'OAK-501' })).toBe(1));
  });

  it('partial import: problems listed with row, column and fix; only the valid rows go in; the error report has the rest', async () => {
    const file = await upload(school.people.LIBRARIAN.actor, 'books.xlsx', xlsx([
      ['Book Title', 'Writer', 'ISBN', 'Copies'],
      ['Godaan', 'Premchand', '9788171234567', '2'],
      ['', 'Unknown Author', '', '1'],
      ['Gitanjali', 'Rabindranath Tagore', '9788179876543', 'three'],
      ['Malgudi Days', 'R. K. Narayan', '9780143039655', ''],
    ]));
    const lib = school.people.LIBRARIAN.actor;
    const preview = await mcp(OAK, lib, 'preview_import', { fileId: file.fileId });
    expect(preview.data.status).toBe('HAS_PROBLEMS');
    expect(preview.data.target.key).toBe('library_books');
    expect(preview.data.counts).toMatchObject({ total: 4, ready: 2, problems: 2 });
    expect(preview.data.problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 3, column: 'Title', problem: 'is required' }),
      expect.objectContaining({ row: 4, column: 'Copies', value: 'three' }),
    ]));
    expect(preview.data.downloads.map((d) => d.path)).toEqual(expect.arrayContaining([`/imports/files/${file.fileId}/errors.xlsx`, '/imports/templates/library_books.xlsx']));

    // Not all good: the import is refused unless only the valid rows are asked for.
    const refused = await mcp(OAK, lib, 'run_import', { fileId: file.fileId });
    expect(refused.success).toBe(false);
    expect(refused.error.message).toMatch(/2 row\(s\) have problems/);

    const before = await inSchool(OAK, () => imports.errorReport({ actor: lib }, { fileId: file.fileId, format: 'xlsx' }));
    const report = XLSX.utils.sheet_to_json(XLSX.read(before.body, { type: 'buffer' }).Sheets['Rows to fix'], { header: 1 });
    expect(report[0]).toEqual(['Row', 'Book Title', 'Writer', 'ISBN', 'Copies', 'Errors']);
    expect(report.slice(1).map((r) => r[0])).toEqual(['3', '4']);
    expect(report[2][5]).toMatch(/Copies: must be a whole number/);

    const proposal = await mcp(OAK, lib, 'run_import', { fileId: file.fileId, validOnly: true });
    expect(proposal.action.summary).toMatch(/2 row\(s\) with problems left out/);
    const done = await confirm(lib, proposal);
    expect(done.data).toMatchObject({ imported: 2, notImported: 2, hasErrorReport: true });
    await inSchool(OAK, async () => {
      expect(await Book.countDocuments({ title: { $in: ['Godaan', 'Malgudi Days'] } })).toBe(2);
      expect(await Book.countDocuments({ title: 'Gitanjali' })).toBe(0);
    });
    // After the import the report comes from the stored outcome (the sheet itself is gone).
    const after = await inSchool(OAK, () => imports.errorReport({ actor: lib }, { fileId: file.fileId, format: 'csv' }));
    expect(after.body.toString('utf8')).toMatch(/Gitanjali/);

    // The corrected sheet re-uploaded whole: the rows already in are skipped, the fixed ones import.
    const fixed = await upload(lib, 'books-fixed.xlsx', xlsx([
      ['Book Title', 'Writer', 'ISBN', 'Copies'],
      ['Godaan', 'Premchand', '9788171234567', '2'],
      ['Gitanjali', 'Rabindranath Tagore', '9788179876543', '3'],
    ]));
    const p2 = await mcp(OAK, lib, 'preview_import', { fileId: fixed.fileId });
    // Godaan is now in the catalogue: flagged by ISBN (the catalogue check), never written twice.
    expect(p2.data.counts.ready).toBe(1);
    expect(p2.data.counts.problems + p2.data.counts.skipped).toBe(1);
  });

  it('permissions: the target\'s own permission and scope apply', async () => {
    // A teacher cannot import students, whatever the sheet says.
    const file = await upload(teacher(), 'kids.csv', csv([['Student Name', 'Phone', 'Class'], ['Neha', '9811100009', 'Class 6 A']]));
    const asTeacher = await mcp(OAK, teacher(), 'preview_import', { fileId: file.fileId, target: 'students' });
    expect(asTeacher.data.status).toBe('NOT_PERMITTED');
    // ...and nobody can see another person's file.
    const asAdmin = await mcp(OAK, admin(), 'preview_import', { fileId: file.fileId });
    expect(asAdmin.success).toBe(false);
    expect(asAdmin.error.code).toBe('NOT_FOUND');
    // A parent has no import tools at all.
    const parent = await mcp(OAK, school.people.PARENT.actor, 'preview_import', { fileId: file.fileId });
    expect(parent.success).toBe(false);
    expect(parent.error.code).toBe('FORBIDDEN');
  });

  it('a teacher imports marks only for their own papers (wide sheet: one column per subject)', async () => {
    const file = await upload(teacher(), 'ut2.xlsx', xlsx([
      ['Roll No', 'Name', 'Mathematics'],
      ['3', 'Aman Gupta', '38'],
      ['1', 'Rahul Sharma', '41'],
    ]));
    const preview = await mcp(OAK, teacher(), 'preview_import', { fileId: file.fileId, hint: 'Unit Test 2 marks for Class 6 A' });
    expect(preview.data.target.key).toBe('marks');
    expect(preview.data.melted).toEqual(['Mathematics']);
    // Aman is ready; Rahul's mark is already published and locked, so it is skipped.
    expect(preview.data.counts).toMatchObject({ ready: 1, skipped: 1, problems: 0 });
    const proposal = await mcp(OAK, teacher(), 'run_import', { fileId: file.fileId });
    const done = await confirm(teacher(), proposal);
    expect(done.data.imported).toBe(1);
    await inSchool(OAK, async () => {
      const m = await Mark.findOne({ enrollmentId: school.aman.enrollment._id }).lean();
      expect(m).toMatchObject({ marks: 38, status: 'DRAFT' });
    });

    // Class 10 A Mathematics is the principal's paper, not this teacher's.
    const other = await upload(teacher(), 'ut2-10a.csv', csv([['Admission No', 'Marks'], ['1024', '40']]));
    const p2 = await mcp(OAK, teacher(), 'preview_import', { fileId: other.fileId, target: 'marks', className: 'Class 10 A', exam: 'Unit Test 2', subject: 'Mathematics' });
    expect(p2.data.status).toBe('HAS_PROBLEMS');
    expect(p2.data.problems[0].problem).toMatch(/not one of your papers/);
  });

  it('a teacher imports attendance for their own class; another class is refused row by row', async () => {
    const file = await upload(teacher(), 'register.csv', csv([['Roll', 'Student', 'P/A'], ['1', 'Aarav Mishra', 'P'], ['2', 'Ananya Mishra', 'A']]));
    const preview = await mcp(OAK, teacher(), 'preview_import', { fileId: file.fileId, hint: 'attendance of Class 5 A', date: '2026-10-16' });
    expect(preview.data.target.key).toBe('attendance');
    expect(preview.data.counts).toMatchObject({ ready: 2, problems: 0 });
    const done = await confirm(teacher(), await mcp(OAK, teacher(), 'run_import', { fileId: file.fileId, date: '2026-10-16' }));
    expect(done.data.imported).toBe(2);
    await inSchool(OAK, async () => {
      const r = await AttendanceRecord.findOne({ enrollmentId: school.ananya.enrollment._id, date: new Date('2026-10-16T00:00:00.000Z'), periodNo: null }).lean();
      expect(r?.status).toBe('ABSENT');
    });

    const theirs = await upload(teacher(), 'register-9b.csv', csv([['Roll', 'Status'], ['1', 'P']]));
    const p2 = await mcp(OAK, teacher(), 'preview_import', { fileId: theirs.fileId, target: 'attendance', className: 'Class 9 B', date: '2026-10-16' });
    expect(p2.data.problems[0].problem).toMatch(/not one of your classes/);
  });

  it('wrong format: says what is missing and offers the sample sheet', async () => {
    const file = await upload(admin(), 'fees.csv', csv([['Admission No', 'Amount'], ['OAK-1', '5000']]));
    const preview = await mcp(OAK, admin(), 'preview_import', { fileId: file.fileId, target: 'fee_invoices' });
    expect(preview.data.status).toBe('WRONG_FORMAT');
    expect(preview.data.missing.map((m) => m.label)).toEqual(['Description', 'Due date']);
    expect(preview.data.downloads.map((d) => d.path)).toContain('/imports/templates/fee_invoices.xlsx');
  });

  it('Ask AI on the website: an attached sheet is previewed and, all good, comes back as one draft to confirm', async () => {
    resetAgentThrottle();
    const file = await upload(admin(), 'rooms.csv', csv([['Room Number', 'Beds', 'Block', 'For'], ['G-201', '3', 'Girls Block', 'girls'], ['G-202', '3', 'Girls Block', 'female']]));
    const res = await inSchool(OAK, () => runAgentSafely({ message: 'add these hostel rooms', actor: admin(), source: 'WEB', attachment: { fileId: file.fileId } }));
    expect(res.reply).toMatch(/rooms\.csv.*Hostel rooms/);
    expect(res.reply).toMatch(/2 ready/);
    expect(res.action?.tool).toBe('run_import');
    expect(res.action.summary).toMatch(/Import 2 row\(s\)/);
    expect(res.verification?.ok).not.toBe(false);
  });

  it('Ask AI: "import only the valid rows" after a preview with problems drafts the partial import', async () => {
    resetAgentThrottle();
    const file = await upload(admin(), 'subjects.csv', csv([['Subject', 'Code'], ['Sanskrit', 'SKT'], ['', 'X'], ['Music', 'MUS']]));
    const first = await inSchool(OAK, () => runAgentSafely({ message: 'is this file in the right format?', actor: admin(), source: 'WEB', attachment: { fileId: file.fileId } }));
    expect(first.reply).toMatch(/1 with problems/);
    expect(first.reply).toMatch(/import the valid rows/i);
    expect(first.downloads.map((d) => d.label).join(' ')).toMatch(/Error report/);
    const second = await inSchool(OAK, () => runAgentSafely({ message: 'import only the valid rows', actor: admin(), source: 'WEB' }));
    expect(second.action?.tool).toBe('run_import');
    expect(second.action.summary).toMatch(/Import 2 row\(s\).*1 row\(s\) with problems left out/);
  });

  it('Ask AI: templates and formats are reachable in words', async () => {
    resetAgentThrottle();
    const t = await inSchool(OAK, () => runAgentSafely({ message: 'give me the sample sheet for library books', actor: school.people.LIBRARIAN.actor, source: 'WEB' }));
    expect(t.tool).toBe('get_import_template');
    expect(t.downloads[0].path).toBe('/imports/templates/library_books.xlsx');
    resetAgentThrottle();
    const f = await inSchool(OAK, () => runAgentSafely({ message: 'what can I import?', actor: teacher(), source: 'WEB' }));
    expect(f.tool).toBe('describe_import_formats');
    expect(f.reply).toMatch(/Attendance/);
    expect(f.reply).toMatch(/Exam marks/);
    expect(f.reply).not.toMatch(/New students/);
  });

  it('WhatsApp: a document is checked there and handed to the website for the import', async () => {
    resetAgentThrottle();
    const sheet = csv([['Title', 'Author'], ['Panchatantra', 'Vishnu Sharma']]).toString('base64');
    const lib = school.people.LIBRARIAN.actor;
    const out = await inSchool(OAK, () => converseWithDocument({ actor: lib, text: 'library books', document: { filename: 'wa-books.csv', simulatedBase64: sheet } }));
    expect(out.simulated).toBe(true);
    expect(out.reply).toMatch(/1 ready/);
    expect(out.reply).toMatch(/confirmed on the website/);
    expect(out.reply).toContain(`/oakridge/librarian?import=${out.importFileId}`);
    // Nothing was written from WhatsApp.
    await inSchool(OAK, async () => expect(await Book.countDocuments({ title: 'Panchatantra' })).toBe(0));
    // "import it" on WhatsApp is pointed to the website, never proposed there.
    resetAgentThrottle();
    const go = await inSchool(OAK, () => runAgentSafely({ message: 'import it', actor: lib, source: 'WHATSAPP' }));
    expect(go.refused).toBe('CONFIRM_ON_WEB');
    expect(go.action ?? null).toBeNull();
    // And the MCP server refuses to propose it on WhatsApp in any case.
    const direct = await mcp(OAK, lib, 'run_import', { fileId: out.importFileId }, { channel: 'WHATSAPP' });
    expect(direct.success).toBe(false);
    expect(direct.error.details?.reason).toBe('CONFIRM_ON_WEB');
    // The website link's file is this librarian's and still importable there.
    const web = await mcp(OAK, lib, 'run_import', { fileId: out.importFileId });
    expect(web.action.status).toBe('confirmation_required');
  });

  it('WhatsApp webhook payloads carry the document', () => {
    const msgs = extractMessages({ entry: [{ changes: [{ value: { messages: [{ from: '919811100001', id: 'wamid.1', type: 'document', document: { id: '123456789', filename: 'marks.xlsx', mime_type: 'application/vnd.ms-excel', caption: 'UT1 maths 6A' } }] } }] }] });
    expect(msgs[0]).toMatchObject({ type: 'document', document: { id: '123456789', filename: 'marks.xlsx', caption: 'UT1 maths 6A' } });
  });

  it('cleanup: raw sheets never outlive a day, error rows go a day after the import', async () => {
    const partial = await upload(admin(), 'subjects.csv', csv([['Subject', 'Code'], ['Yoga', 'YG'], ['', 'X']]));
    await mcp(OAK, admin(), 'preview_import', { fileId: partial.fileId, target: 'subjects' });
    await confirm(admin(), await mcp(OAK, admin(), 'run_import', { fileId: partial.fileId, validOnly: true }));
    await inSchool(OAK, async () => {
      const stale = await imports.storeFile({ actor: admin(), name: 'stale.csv', buffer: csv([['Subject'], ['Yoga']]) });
      await ImportFile.updateOne({ _id: stale.fileId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      const old = await ImportFile.findOne({ _id: partial.fileId, status: 'IMPORTED', 'result.errorSheet': { $exists: true } });
      await ImportFile.updateOne({ _id: old._id }, { $set: { importedAt: new Date(Date.now() - 25 * 3600 * 1000) } });
      await imports.purgeExpired();
      expect(await ImportFile.findById(stale.fileId)).toBeNull();
      const stripped = await ImportFile.findById(old._id).lean();
      expect(stripped.result.errorSheet).toBeUndefined();
      expect(stripped.result.imported).toBeGreaterThan(0);
      // Expired files are invisible even before the TTL monitor removes them.
      const late = await imports.storeFile({ actor: admin(), name: 'late.csv', buffer: csv([['Subject'], ['Dance']]) });
      await ImportFile.updateOne({ _id: late.fileId }, { $set: { expiresAt: new Date(Date.now() - 1) } });
      await expect(imports.loadFile(admin(), late.fileId)).rejects.toThrow(/could not find that file/);
    });
  });

  it('refuses files that are not spreadsheets, or too big', async () => {
    await expect(upload(admin(), 'notes.pdf', Buffer.from('%PDF-1.4'))).rejects.toThrow(/Only spreadsheets/);
    await expect(upload(admin(), 'huge.csv', Buffer.alloc(2 * 1024 * 1024 + 1, 'a'))).rejects.toThrow(/larger than 2 MB/);
    await inSchool(OAK, async () => expect(await ImportFile.countDocuments({})).toBe(0));
  });
});

describe('every import checks its own sample row', () => {
  let school;
  beforeEach(async () => { school = await seedAskAiSchool(); });

  it('the template example row of each schema is read, mapped and checked (no column left unmatched)', async () => {
    const admin = school.people.ADMIN.actor;
    for (const schema of IMPORT_SCHEMAS) {
      const book = imports.template(schema.key, 'xlsx');
      const file = await inSchool(OAK, () => imports.storeFile({ actor: admin, name: `${schema.key}.xlsx`, buffer: book.body }));
      const out = await mcp(OAK, admin, 'preview_import', { fileId: file.fileId, target: schema.key });
      expect(out.success, schema.key).toBe(true);
      expect(['READY', 'HAS_PROBLEMS'], `${schema.key}: ${out.data.status} ${out.data.message ?? ''}`).toContain(out.data.status);
      expect(out.data.ignored, schema.key).toEqual([]);
      expect(out.data.counts.total, schema.key).toBe(1);
      // Detection agrees with the template: its own headers name its own target.
      const guess = rankSchemas(schema.columns.map((c) => c.label), IMPORT_SCHEMAS)[0].schema.key;
      expect(guess, schema.key).toBe(schema.key);
    }
  });
});

describe('over HTTP, as the website and WhatsApp reach it', () => {
  let school;
  let api;
  beforeEach(async () => { school = await seedAskAiSchool(); api = await startApi(); });
  afterEach(async () => { await api.close(); });

  const tokenFor = (person) => signAccessToken({ accountId: person.actor.accountId, profileId: person.actor.profileId, door: null });

  it('attach → preview → one confirmation → imported; template and error report download', async () => {
    const admin = school.people.ADMIN;
    const auth = { authorization: `Bearer ${tokenFor(admin)}` };
    const up = await fetch(`${api.base}/imports/files`, {
      method: 'POST', headers: { ...auth, 'content-type': 'text/csv', 'x-filename': encodeURIComponent('routes.csv') },
      body: csv([['Route', 'Bus No', 'Driver'], ['Route 9 - Baner', 'MH12XY9999', 'Sunil'], ['Route 10 - Aundh', 'MH12XY1010', 'Ravi']]),
    });
    expect(up.status).toBe(201);
    const { data: { fileId } } = await up.json();

    const asked = await api.post(admin, '/ai/agent', { message: 'bus routes', attachment: { fileId } });
    expect(asked.status).toBe(200);
    expect(asked.body.data.reply).toMatch(/Bus routes/);
    const token = asked.body.data.action?.confirmToken;
    expect(token).toBeTruthy();
    const done = await api.confirm(admin, token);
    expect(done.reply).toMatch(/Uploaded successfully: \*\*2 rows\*\* imported into \*\*Bus routes\*\*/);
    await inSchool(OAK, async () => expect(await TransportRoute.countDocuments({ name: /Route (9|10)/ })).toBe(2));

    const tpl = await fetch(`${api.base}/imports/templates/transport_routes.xlsx`, { headers: auth });
    expect(tpl.status).toBe(200);
    expect(tpl.headers.get('content-type')).toMatch(/spreadsheetml/);
    const csvTpl = await fetch(`${api.base}/imports/templates/transport_routes.csv`, { headers: auth });
    expect((await csvTpl.text())).toMatch(/Route name/);

    // A teacher may not download a template for an import they cannot run, nor upload at all as a parent.
    const teacherTpl = await fetch(`${api.base}/imports/templates/students.xlsx`, { headers: { authorization: `Bearer ${tokenFor(school.people.TEACHER)}` } });
    expect(teacherTpl.status).toBe(403);
    const parentUp = await fetch(`${api.base}/imports/files`, {
      method: 'POST', headers: { authorization: `Bearer ${tokenFor(school.people.PARENT)}`, 'content-type': 'text/csv', 'x-filename': 'x.csv' }, body: 'a,b\n1,2',
    });
    expect(parentUp.status).toBe(403);
  });

  it('a WhatsApp document through the signed webhook is checked and handed to the website', async () => {
    const lib = school.people.LIBRARIAN;
    const payload = { entry: [{ changes: [{ value: { messages: [{
      id: `wamid.doc.${Date.now()}`, from: lib.phone.replace('+', ''), type: 'document',
      document: { id: '1234567890', filename: 'new-books.csv', mime_type: 'text/csv', caption: 'library books', simulatedBase64: csv([['Title', 'Author'], ['Ramayana', 'Valmiki']]).toString('base64') },
    }] } }] }] };
    const raw = JSON.stringify(payload);
    const signature = `sha256=${crypto.createHmac('sha256', env.WA_APP_SECRET).update(raw).digest('hex')}`;
    const res = await fetch(`${api.base}/whatsapp/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, body: raw });
    const body = await res.json();
    const reply = body.data?.replies?.[0]?.reply ?? '';
    expect(reply).toMatch(/1 ready/);
    expect(reply).toMatch(/confirmed on the website: http/);
    await inSchool(OAK, async () => {
      expect(await Book.countDocuments({ title: 'Ramayana' })).toBe(0);
      expect(await ImportFile.countDocuments({ channel: 'WHATSAPP', originalName: 'new-books.csv' })).toBe(1);
    });
  });
});
