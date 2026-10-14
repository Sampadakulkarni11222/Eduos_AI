import { it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Grade, Section } from '../src/models/academics.model.js';
import { Student, Enrollment } from '../src/models/student.model.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import { list } from '../src/modules/students/student.service.js';

/**
 * Audit T-CLS-1: My Classes listed students 54, 59, 56, 53… and Class 9 B
 * before Class 5 A, because the list sorted by createdAt. The full
 * (unpaged) list is a roll call and comes in grade, section, roll order.
 */

const OAK = 'oakridge';
const inOak = (fn) => runWithTenant(OAK, fn);
const year = new mongoose.Types.ObjectId();

beforeEach(async () => {
  await inOak(async () => {
    const g9 = await Grade.create({ name: 'Class 9', level: 9 });
    const g5 = await Grade.create({ name: 'Class 5', level: 5 });
    const s9b = await Section.create({ gradeId: g9._id, name: 'B' });
    const s5b = await Section.create({ gradeId: g5._id, name: 'B' });
    const s5a = await Section.create({ gradeId: g5._id, name: 'A' });
    // Created deliberately out of order.
    const rows = [[s9b, 1, 'Nine'], [s5a, 54, 'Fiftyfour'], [s5b, 2, 'Bee'], [s5a, 59, 'Fiftynine'], [s5a, 3, 'Three']];
    for (const [i, [section, rollNo, name]] of rows.entries()) {
      const st = await Student.create({ admissionNo: `R-${i}`, firstName: name, lastName: 'X' });
      await Enrollment.create({ studentId: st._id, sectionId: section._id, academicYearId: year, status: 'ACTIVE', rollNo });
    }
    await Student.create({ admissionNo: 'R-none', firstName: 'Aaron', lastName: 'Unenrolled' });
  });
});

it('lists the whole school in grade, section, roll order', async () => {
  const items = await inOak(() => list({ roleKey: 'ADMIN', profileId: String(new mongoose.Types.ObjectId()) }, 'ALL', {}));
  expect(items.map((s) => `${s.enrollment?.class ?? '-'}#${s.enrollment?.rollNo ?? '-'}`)).toEqual([
    'Class 5 A#3', 'Class 5 A#54', 'Class 5 A#59', 'Class 5 B#2', 'Class 9 B#1', '-#-',
  ]);
});

it('the paged directory keeps its own order and shape', async () => {
  const page = await inOak(() => list({ roleKey: 'ADMIN', profileId: String(new mongoose.Types.ObjectId()) }, 'ALL', { page: 1, pageSize: 10 }));
  expect(page.total).toBe(6);
  expect(page.items).toHaveLength(6);
});
