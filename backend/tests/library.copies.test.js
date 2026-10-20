import { describe, it, expect, beforeEach } from 'vitest';
import { seedSchool, inSchool, OAK, RIVER } from './support/mcpSchool.js';
import { Book, BookIssue } from '../src/models/library.model.js';
import { BookCopy } from '../src/models/bookCopy.model.js';
import * as copies from '../src/modules/library/library.copies.js';

/**
 * Accession numbers per copy (one series per school), label data for printing,
 * and scan-to-issue / scan-to-return with the text a keyboard-wedge scanner types.
 */
const inOak = (fn) => inSchool(OAK, fn);

beforeEach(async () => { await seedSchool(); });

describe('accession numbers and labels', () => {
  it('numbers every copy in one running series per school and grows the catalogue when copies are added', async () => {
    const [a, b] = await inOak(() => Book.create([
      { title: 'Wings of Fire', author: 'A. P. J. Abdul Kalam', totalCopies: 2, availableCopies: 2 },
      { title: 'Malgudi Days', author: 'R. K. Narayan', totalCopies: 1, availableCopies: 1 },
    ]));
    const first = await inOak(() => copies.generateCopies({ bookId: String(a._id) }));
    expect(first.created.map((c) => c.accessionNo)).toEqual(['ACC-000001', 'ACC-000002']);
    const second = await inOak(() => copies.generateCopies({ bookId: String(b._id), count: 2, prefix: 'ref' }));
    expect(second.created.map((c) => c.accessionNo)).toEqual(['REF-000003', 'REF-000004']);
    expect(second.addedToCatalogue).toBe(1);
    expect(await inOak(() => Book.findById(b._id).lean())).toMatchObject({ totalCopies: 2, availableCopies: 2 });
    expect((await inOak(() => copies.generateCopies({ bookId: String(a._id) }))).created).toHaveLength(0);
    // Riverside's series starts again at 1.
    const rb = await inSchool(RIVER, () => Book.create({ title: 'Godan', author: 'Premchand', totalCopies: 1, availableCopies: 1 }));
    expect((await inSchool(RIVER, () => copies.generateCopies({ bookId: String(rb._id) }))).created[0].accessionNo).toBe('ACC-000001');
    const sheet = await inOak(() => copies.labels({}, { tenantName: 'Oakridge Academy' }));
    expect(sheet.labels).toHaveLength(4);
    expect(sheet.labels[0]).toMatchObject({ accessionNo: 'ACC-000001', barcode: 'ACC-000001', title: 'Wings of Fire' });
    await inOak(() => copies.markLabelsPrinted({ ids: sheet.labels.slice(0, 2).map((l) => l.id) }));
    expect((await inOak(() => copies.labels({}, null))).labels).toHaveLength(2);
    await expect(inOak(() => copies.generateCopies({ bookId: String(a._id), prefix: 'A1' }))).rejects.toMatchObject({ code: 'BAD_PREFIX' });
  });
});

describe('scan to issue and return', () => {
  it('issues the scanned copy to the scanned student, refuses a second issue, and returns it with the same scan', async () => {
    const book = await inOak(() => Book.create({ title: 'The Jungle Book', author: 'Rudyard Kipling', totalCopies: 1, availableCopies: 1 }));
    const [copy] = (await inOak(() => copies.generateCopies({ bookId: String(book._id) }))).created;
    // Scanners add whitespace and may type lower case.
    const looked = await inOak(() => copies.scan(` ${copy.accessionNo.toLowerCase()}\n`));
    expect(looked).toMatchObject({ status: 'AVAILABLE', title: 'The Jungle Book', loan: null });
    await expect(inOak(() => copies.scan('DROP TABLE'))).rejects.toMatchObject({ code: 'BAD_CODE' });
    await expect(inOak(() => copies.scanIssue({ code: copy.accessionNo, student: 'NOPE-1' }))).rejects.toMatchObject({ code: 'STUDENT_NOT_FOUND' });
    expect((await inOak(() => BookCopy.findById(copy.id).lean())).status).toBe('AVAILABLE');
    const out = await inOak(() => copies.scanIssue({ code: copy.accessionNo, student: 'OAK-2' }));
    expect(out.issue).toMatchObject({ studentName: 'Priya Verma', status: 'ACTIVE' });
    expect(await inOak(() => Book.findById(book._id).lean())).toMatchObject({ availableCopies: 0 });
    await expect(inOak(() => copies.scanIssue({ code: copy.accessionNo, student: 'OAK-1' }))).rejects.toMatchObject({ code: 'COPY_NOT_AVAILABLE' });
    const onLoan = await inOak(() => copies.scan(copy.accessionNo));
    expect(onLoan.loan).toMatchObject({ borrowerName: 'Priya Verma' });
    const back = await inOak(() => copies.scanReturn({ code: copy.accessionNo }));
    expect(back.issue.status).toBe('RETURNED');
    expect(await inOak(() => Book.findById(book._id).lean())).toMatchObject({ availableCopies: 1 });
    await expect(inOak(() => copies.scanReturn({ code: copy.accessionNo }))).rejects.toMatchObject({ code: 'COPY_NOT_ISSUED' });
    expect(await inOak(() => BookIssue.countDocuments({}))).toBe(1);
    // Another school cannot scan Oakridge's copy.
    await expect(inSchool(RIVER, () => copies.scan(copy.accessionNo))).rejects.toMatchObject({ code: 'COPY_NOT_FOUND' });
  });

  it('a lost copy leaves the shelf count, and one on loan cannot be marked lost', async () => {
    const book = await inOak(() => Book.create({ title: 'Panchatantra', author: 'Vishnu Sharma', totalCopies: 2, availableCopies: 2 }));
    const [c1, c2] = (await inOak(() => copies.generateCopies({ bookId: String(book._id) }))).created;
    await inOak(() => copies.updateCopy(c1.id, { status: 'LOST' }));
    expect(await inOak(() => Book.findById(book._id).lean())).toMatchObject({ availableCopies: 1 });
    await inOak(() => copies.scanIssue({ code: c2.accessionNo, student: 'OAK-3' }));
    await expect(inOak(() => copies.updateCopy(c2.id, { status: 'LOST' }))).rejects.toMatchObject({ code: 'COPY_ON_LOAN' });
  });
});
