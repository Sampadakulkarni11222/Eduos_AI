import { describe, it, expect, beforeEach } from 'vitest';
import { seedSchool, inSchool, OAK, RIVER } from './support/mcpSchool.js';
import { Student, Enrollment } from '../src/models/student.model.js';
import { Announcement } from '../src/models/announcement.model.js';
import { Book } from '../src/models/library.model.js';
import * as search from '../src/modules/search/search.service.js';

/**
 * Universal search: each kind of record is searched only with the caller's
 * own permission and scope, the typed text is never a pattern, and every
 * query stays inside the caller's school.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);
const titles = (res, type) => (res.groups.find((g) => g.type === type)?.items ?? []).map((i) => i.title);

beforeEach(async () => {
  s = await seedSchool();
});

describe('students are found only within the caller\'s scope', () => {
  it('an administrator finds any student of the school, with the admission number', async () => {
    const r = await inOak(() => search.search(s.people.ADMIN.actor, 'ri'));
    expect(titles(r, 'students')).toContain('Riya Kapoor');
    const rahul = await inOak(() => search.search(s.people.ADMIN.actor, 'Rahul'));
    expect(titles(rahul, 'students')).toEqual(['Rahul Sharma']);
    expect(rahul.groups.find((g) => g.type === 'students').items[0].subtitle).toContain('OAK-1');
  });

  it('a teacher finds only students of the sections they teach', async () => {
    const t = s.people.TEACHER.actor;
    expect(titles(await inOak(() => search.search(t, 'Rahul')), 'students')).toEqual(['Rahul Sharma']);
    expect(titles(await inOak(() => search.search(t, 'Riya')), 'students')).toEqual([]);
  });

  it('a parent finds only their own child, without the admission number', async () => {
    const p = s.people.PARENT.actor;
    const r = await inOak(() => search.search(p, 'Rahul'));
    expect(titles(r, 'students')).toEqual(['Rahul Sharma']);
    expect(r.groups.find((g) => g.type === 'students').items[0].subtitle ?? '').not.toContain('OAK-1');
    expect(titles(await inOak(() => search.search(p, 'Priya')), 'students')).toEqual([]);
    expect(titles(await inOak(() => search.search(p, 'OAK')), 'students')).toEqual([]);
  });

  it('a student finds only themself', async () => {
    const st = s.people.STUDENT.actor;
    expect(titles(await inOak(() => search.search(st, 'Priya')), 'students')).toEqual(['Priya Verma']);
    expect(titles(await inOak(() => search.search(st, 'Rahul')), 'students')).toEqual([]);
  });
});

describe('people, classes and notices', () => {
  it('a parent finds their child\'s teachers and the principal, never other staff', async () => {
    const p = s.people.PARENT.actor;
    expect(titles(await inOak(() => search.search(p, 'TEACHER')), 'staff')).toEqual(['TEACHER user']);
    expect(titles(await inOak(() => search.search(p, 'PRINCIPAL')), 'staff')).toEqual(['PRINCIPAL user']);
    expect(titles(await inOak(() => search.search(p, 'FINANCE')), 'staff')).toEqual([]);
    // Staff find colleagues by name.
    expect(titles(await inOak(() => search.search(s.people.TEACHER.actor, 'FINANCE')), 'staff')).toEqual(['FINANCE user']);
  });

  it('a parent sees only their child\'s class; staff see every class', async () => {
    expect(titles(await inOak(() => search.search(s.people.PARENT.actor, 'Class 6')), 'classes')).toEqual(['Class 6 A']);
    expect(titles(await inOak(() => search.search(s.people.ADMIN.actor, 'Class 6')), 'classes')).toEqual(['Class 6 A', 'Class 6 B']);
  });

  it('notices follow their audience', async () => {
    await inOak(() => Announcement.create({ title: 'Sports day for 6 B', content: 'Only for 6 B', audience: { all: false, sectionIds: [s.sectionB._id] }, createdByProfileId: s.people.ADMIN.profile._id }));
    expect(titles(await inOak(() => search.search(s.people.PARENT.actor, 'Sports')), 'notices')).toEqual([]);
    expect(titles(await inOak(() => search.search(s.people.ADMIN.actor, 'Sports')), 'notices')).toEqual(['Sports day for 6 B']);
    expect(titles(await inOak(() => search.search(s.people.PARENT.actor, 'Bus route')), 'notices')).toEqual(['Bus route 4 changes from Monday']);
  });

  it('finds offline campaigns by name, code, channel or placement for marketing readers only', async () => {
    const { OfflineCampaign } = await import('../src/models/marketingGrowth.model.js');
    await inOak(() => OfflineCampaign.create({ name: 'Sector 21 posters', code: 'POSTER-S21', channelType: 'POSTER', placements: [{ location: 'Green Park market' }], startsOn: new Date(), endsOn: new Date() }));
    for (const q of ['Sector', 'poster', 'Green Park']) expect(titles(await inOak(() => search.search(s.people.ADMIN.actor, q)), 'campaigns')).toEqual(['Sector 21 posters']);
    expect(titles(await inOak(() => search.search(s.people.PARENT.actor, 'Sector')), 'campaigns')).toEqual([]);
  });

  it('a parent is offered no admissions, tasks or vehicles', async () => {
    const r = await inOak(() => search.search(s.people.PARENT.actor, 'Ra'));
    expect(r.groups.map((g) => g.type)).not.toEqual(expect.arrayContaining(['enquiries']));
    expect(r.groups.every((g) => ['students', 'staff', 'classes', 'notices', 'news', 'documents', 'books', 'tickets', 'clubs'].includes(g.type))).toBe(true);
  });
});

describe('the query is text, never a pattern', () => {
  it('escapes regular-expression characters', async () => {
    await inOak(async () => {
      const odd = await Student.create({ admissionNo: 'OAK-77', firstName: 'A.*b', lastName: '(Test)' });
      await Enrollment.create({ studentId: odd._id, sectionId: s.sectionA._id, academicYearId: s.year._id, status: 'ACTIVE', rollNo: 77 });
      await Book.create({ title: 'C++ (Primer) [3rd]', author: 'Lippman' });
    });
    const a = s.people.ADMIN.actor;
    expect(titles(await inOak(() => search.search(a, 'A.*')), 'students')).toEqual(['A.*b (Test)']);
    expect(titles(await inOak(() => search.search(a, '.*')), 'students')).toEqual([]);
    expect(titles(await inOak(() => search.search(a, '(Test')), 'students')).toEqual(['A.*b (Test)']);
    expect(titles(await inOak(() => search.search(a, 'C++ (Pri')), 'books')).toEqual(['C++ (Primer) [3rd]']);
    // Unbalanced or hostile input never throws.
    await expect(inOak(() => search.search(a, '[(?<=x)'))).resolves.toBeTruthy();
    await expect(inOak(() => search.search(a, '\\'.repeat(5)))).resolves.toBeTruthy();
  });

  it('needs at least two characters and plain text', async () => {
    await expect(inOak(() => search.search(s.people.ADMIN.actor, ' a '))).rejects.toMatchObject({ code: 'QUERY_TOO_SHORT' });
    await expect(inOak(() => search.search(s.people.ADMIN.actor, { $ne: 1 }))).rejects.toMatchObject({ code: 'BAD_QUERY' });
    expect(search.cleanQuery('x'.repeat(200))).toHaveLength(search.MAX_CHARS);
  });
});

describe('tenant isolation', () => {
  it('never returns another school\'s records', async () => {
    const oak = await inOak(() => search.search(s.people.ADMIN.actor, 'Rahul'));
    expect(titles(oak, 'students')).toEqual(['Rahul Sharma']);
    const river = await inSchool(RIVER, () => search.search(s.people.RIVER_ADMIN.actor, 'Rahul'));
    expect(titles(river, 'students')).toEqual(['Rahul Riverside']);
    expect(titles(river, 'notices')).toEqual([]);
  });
});
