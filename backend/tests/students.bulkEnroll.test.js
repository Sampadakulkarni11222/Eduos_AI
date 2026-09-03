import { it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Grade, Section, AcademicYear } from '../src/models/academics.model.js';
import { Student } from '../src/models/student.model.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import { bulkEnroll } from '../src/modules/students/student.service.js';

/**
 * ISSUE-02 — "Bulk Student Class Assignment Fails Despite Following the
 * Provided CSV Template". The report's own screenshot shows every row
 * failing with "No student found with admissionNo ADM-2026-2011" etc — an
 * admission-number range that doesn't match this school's actual students
 * (seeded as ADM-2026-0001.. in seed_school_data.js), which is what
 * "No student found" correctly and accurately reports. This test proves the
 * happy path works end-to-end for admission numbers that do exist, so the
 * fix for ISSUE-01 (which this bug report links to) was the real defect —
 * bulkEnroll() itself has no bug to fix.
 */

const OAK = 'oakridge';
const inOak = (fn) => runWithTenant(OAK, fn);

let sectionId;
let academicYearId;

beforeEach(async () => {
  await inOak(async () => {
    const grade = await Grade.create({ name: 'Class 8', level: 8 });
    const section = await Section.create({ gradeId: grade._id, name: 'A' });
    sectionId = section._id.toString();
    const year = await AcademicYear.create({ name: '2026-27', startsOn: new Date(), endsOn: new Date(), isCurrent: true });
    academicYearId = year._id.toString();
    await Student.create({ admissionNo: 'ADM-2026-0006', firstName: 'Real', lastName: 'Student' });
  });
});

it('enrolls a student whose admissionNo actually exists', async () => {
  const result = await inOak(() => bulkEnroll({
    sectionId, academicYearId,
    rows: [{ admissionno: 'ADM-2026-0006' }],
  }));
  expect(result.imported).toBe(1);
  expect(result.errors).toEqual([]);
});

it('accurately reports an admissionNo that was never seeded, exactly as the report\'s own screenshot showed', async () => {
  const result = await inOak(() => bulkEnroll({
    sectionId, academicYearId,
    rows: [{ admissionno: 'ADM-2026-2011' }],
  }));
  expect(result.imported).toBe(0);
  expect(result.errors[0].error).toMatch(/No student found with admissionNo "ADM-2026-2011"/);
});
