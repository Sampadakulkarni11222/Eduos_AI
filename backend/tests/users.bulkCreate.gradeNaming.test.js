import { describe, it, expect, beforeEach } from 'vitest';
import { Grade, Section } from '../src/models/academics.model.js';
import { AcademicYear } from '../src/models/academics.model.js';
import { Student } from '../src/models/student.model.js';
import { Role } from '../src/models/role.model.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import { bulkCreateUsers } from '../src/modules/users/user.service.js';

/**
 * ISSUE-01 — bulk user rows classified a STUDENT into a class by matching
 * "gradeName + sectionName" verbatim against Grade.name ("Class 5"). The
 * bulk-create template's own sample row used "Grade 5", which never matches
 * "Class 5" — every student row with a section failed with "No section found"
 * even though the section unquestionably existed. bulkCreateUsers() must
 * accept the common "Grade"/"Class"/"Std" spellings interchangeably.
 */

const OAK = 'oakridge';
const inOak = (fn) => runWithTenant(OAK, fn);

let sectionId;

beforeEach(async () => {
  await inOak(async () => {
    const grade = await Grade.create({ name: 'Class 5', level: 5 });
    const section = await Section.create({ gradeId: grade._id, name: 'A' });
    sectionId = section._id.toString();
    await AcademicYear.create({ name: '2026-27', startsOn: new Date(), endsOn: new Date(), isCurrent: true });
    await Role.create({ key: 'STUDENT', name: 'Student', permissions: [] });
  });
});

const row = (overrides = {}) => ({
  rolekey: 'STUDENT',
  displayname: 'Test Student',
  phone: '+919555000111',
  admissionno: `ADM-TEST-${Math.random().toString(36).slice(2, 8)}`,
  sectionname: 'A',
  ...overrides,
});

it('matches a "Grade 5" CSV value against a Grade named "Class 5"', async () => {
  const r = row({ gradename: 'Grade 5' });
  const result = await inOak(() => bulkCreateUsers([r]));
  expect(result.errors).toEqual([]);
  expect(result.imported).toBe(1);

  const student = await inOak(() => Student.findOne({ admissionNo: r.admissionno }));
  expect(student).not.toBeNull();
});

it('still matches the exact "Class 5" spelling', async () => {
  const result = await inOak(() => bulkCreateUsers([row({ gradename: 'Class 5' })]));
  expect(result.imported).toBe(1);
  expect(result.errors).toEqual([]);
});

it('reports the known grade names when nothing matches', async () => {
  const result = await inOak(() => bulkCreateUsers([row({ gradename: 'Grade 11' })]));
  expect(result.imported).toBe(0);
  expect(result.errors[0].error).toMatch(/Known grades: Class 5/);
});
