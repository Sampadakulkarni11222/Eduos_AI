import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Book } from '../src/models/library.model.js';
import { Grade, Subject, AcademicYear } from '../src/models/academics.model.js';
import { Account } from '../src/models/account.model.js';
import { Profile } from '../src/models/profile.model.js';
import { Role } from '../src/models/role.model.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import * as library from '../src/modules/library/library.service.js';

/**
 * Library notes, question papers, and the categorisation the digital library
 * is browsed by.
 *
 * All three are the same catalogue rather than three document systems: a note
 * and a question paper are library *resources*, so they inherit the search,
 * the filters, the pagination and the `library.read` / `library.manage` pair
 * that the book catalogue already has. What is tested here is that they behave
 * as their own shelves without disturbing the books beside them.
 */

const SCHOOL = 'oakridge';
const inSchool = (fn) => runWithTenant(SCHOOL, fn);

let grade;
let subject;
let year;
let librarian;

beforeEach(async () => {
  for (const r of SYSTEM_ROLES) {
    await Role.create({ key: r.key, name: r.name, isSystem: true, permissions: r.grants });
  }

  await inSchool(async () => {
    grade = await Grade.create({ name: 'Class 10', level: 10 });
    subject = await Subject.create({ name: 'Physics', code: 'PHY' });
    year = await AcademicYear.create({ name: '2026-27', startsOn: new Date(), endsOn: new Date() });

    const account = await Account.create({ phoneE164: '+919810000099' });
    librarian = await Profile.create({
      accountId: account._id,
      roleId: (await Role.findOne({ key: 'LIBRARIAN' }))._id,
      displayName: 'Lata Librarian',
      tenantId: SCHOOL,
      tenantName: SCHOOL,
    });
  });
});

const actor = () => ({ roleKey: 'LIBRARIAN', profileId: String(librarian._id), permissions: {} });

/**
 * listBooks answers with a bare array unless the caller paginates (see
 * utils/paginate.js), so the tests read through this rather than assuming one
 * of the two shapes.
 */
const rows = (res) => (Array.isArray(res) ? res : res.items);

const addNote = (over = {}) => inSchool(() => library.createBook({
  title: 'Newton laws — chapter summary',
  author: 'Lata Librarian',
  resourceKind: 'NOTE',
  body: 'F = ma, and the two that follow from it.',
  subjectId: subject._id,
  gradeId: grade._id,
  academicYearId: year._id,
  language: 'English',
  ...over,
}, actor()));

const addPaper = (over = {}) => inSchool(() => library.createBook({
  title: 'Physics midterm 2026',
  author: 'Examinations office',
  resourceKind: 'QUESTION_PAPER',
  resourceUrl: '/uploads/physics-midterm-2026.pdf',
  subjectId: subject._id,
  gradeId: grade._id,
  academicYearId: year._id,
  examType: 'Midterm',
  language: 'English',
  ...over,
}, actor()));

const addBook = () => inSchool(() => library.createBook({
  title: 'Concepts of Physics',
  author: 'H C Verma',
  isbn: 'ISBN-PHY-1',
  totalCopies: 3,
}, actor()));

describe('a note is a catalogue resource, not a second system', () => {
  it('is created with its categorisation and its uploader', async () => {
    const note = await addNote();

    expect(note.resourceKind).toBe('NOTE');
    expect(note.subject).toBe('Physics');
    expect(note.grade).toBe('Class 10');
    expect(note.language).toBe('English');
    expect(note.uploadedBy).toBe('Lata Librarian');
    expect(note.uploadedAt).toBeTruthy();
  });

  it('is never lendable — it has no shelf copies', async () => {
    const note = await addNote();
    expect(note.totalCopies).toBe(0);
    expect(note.availableCopies).toBe(0);
  });

  it('is refused when it has neither a file nor any text', async () => {
    await expect(addNote({ body: '   ', resourceUrl: null }))
      .rejects.toMatchObject({ code: 'RESOURCE_EMPTY', statusCode: 400 });
    expect(await inSchool(() => Book.countDocuments())).toBe(0);
  });

  it('is found by searching its body, not only its title', async () => {
    await addNote();
    const found = await inSchool(() => library.listBooks({ resourceKind: 'NOTE', search: 'F = ma' }));
    expect(rows(found)).toHaveLength(1);
  });

  it('can be edited and removed through the existing catalogue calls', async () => {
    const note = await addNote();
    const edited = await inSchool(() => library.updateBook(note.id, { title: 'Newton laws — revised' }));
    expect(edited.title).toBe('Newton laws — revised');

    await inSchool(() => library.deleteBook(note.id));
    const left = await inSchool(() => library.listBooks({ resourceKind: 'NOTE' }));
    expect(rows(left)).toHaveLength(0);
  });
});

describe('question papers are filed by class, subject, year and exam', () => {
  it('carries every filing field back on the DTO', async () => {
    const paper = await addPaper();
    expect(paper.resourceKind).toBe('QUESTION_PAPER');
    expect(paper.examType).toBe('Midterm');
    expect(paper.academicYear).toBe('2026-27');
    expect(paper.resourceUrl).toBe('/uploads/physics-midterm-2026.pdf');
  });

  it('filters by exam type, and by the year it belongs to', async () => {
    await addPaper();
    await addPaper({ title: 'Physics final 2026', examType: 'Final' });

    const midterms = await inSchool(() =>
      library.listBooks({ resourceKind: 'QUESTION_PAPER', examType: 'Midterm' }));
    expect(rows(midterms).map((p) => p.title)).toEqual(['Physics midterm 2026']);

    const thisYear = await inSchool(() =>
      library.listBooks({ resourceKind: 'QUESTION_PAPER', academicYearId: year._id.toString() }));
    expect(rows(thisYear)).toHaveLength(2);
  });

  it('is refused without a file to open', async () => {
    await expect(addPaper({ resourceUrl: null }))
      .rejects.toMatchObject({ code: 'RESOURCE_EMPTY' });
  });
});

describe('the shelves do not spill into one another', () => {
  it('the book catalogue excludes notes and papers', async () => {
    await addBook();
    await addNote();
    await addPaper();

    const books = await inSchool(() => library.listBooks({ resourceKind: 'BOOK' }));
    expect(rows(books).map((b) => b.title)).toEqual(['Concepts of Physics']);
  });

  it('a row written before resourceKind existed still reads as a book', async () => {
    await inSchool(() => Book.collection.insertOne({
      title: 'An old accession',
      author: 'Anon',
      totalCopies: 1,
      availableCopies: 1,
      deletedAt: null,
      tenantId: SCHOOL,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const books = await inSchool(() => library.listBooks({ resourceKind: 'BOOK' }));
    expect(rows(books).map((b) => b.title)).toContain('An old accession');
    expect(rows(books)[0].resourceKind).toBe('BOOK');
  });

  it('an unfiltered list still returns everything, as it always did', async () => {
    await addBook();
    await addNote();
    const all = await inSchool(() => library.listBooks({}));
    expect(rows(all)).toHaveLength(2);
  });

  it('refuses a kind it does not know', async () => {
    await expect(addNote({ resourceKind: 'SCROLL' }))
      .rejects.toMatchObject({ code: 'INVALID_RESOURCE_KIND' });
  });
});

describe('the filter pickers offer only values that exist', () => {
  it('lists the languages and exam types actually in the catalogue', async () => {
    await addNote();
    await addPaper();
    await addPaper({ title: 'Physics final 2026', examType: 'Final', language: 'Marathi' });

    const facets = await inSchool(() => library.listBookFacets());
    expect(facets.languages).toEqual(['English', 'Marathi']);
    expect(facets.examTypes).toEqual(['Final', 'Midterm']);
  });
});
