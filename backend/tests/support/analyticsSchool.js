import { seedRoles, seedPerson, inSchool, OAK } from './mcpSchool.js';
import { School } from '../../src/models/school.model.js';
import { Student, Enrollment } from '../../src/models/student.model.js';
import { Grade, Section, AcademicYear } from '../../src/models/academics.model.js';

/**
 * A small dated school for the analytics and quarterly-report suites: two
 * academic years, two sections (the teacher leads 6 A only), and every staff
 * role that holds the workspace. Dates are fixed so periods are exact; `stamp`
 * back-dates a record's timestamps (Mongoose would otherwise set them to now).
 */
export const NOW = new Date('2026-10-14T06:00:00.000Z');

export const stamp = (Model, id, fields) => Model.collection.updateOne({ _id: id }, { $set: fields });

/** Local midnight in India (UTC+5:30) of a date, plus optional hours. */
export const ist = (ymd, hours = 12) => new Date(new Date(`${ymd}T00:00:00.000Z`).getTime() - 330 * 60_000 + hours * 3600_000);

export async function seedAnalyticsSchool() {
  const roleIds = await seedRoles();
  const people = {};
  for (const key of ['ADMIN', 'PRINCIPAL', 'FINANCE', 'TEACHER', 'HR', 'MARKETING', 'COMPLIANCE', 'TRUSTEE', 'LIBRARIAN']) {
    // eslint-disable-next-line no-await-in-loop
    people[key] = await seedPerson({ roleKey: key, roleId: roleIds[key], displayName: `${key[0]}${key.slice(1).toLowerCase()} One` });
  }
  await School.create({ slug: OAK, name: 'Oakridge Academy', status: 'ACTIVE' });
  const data = await inSchool(OAK, async () => {
    const lastYear = await AcademicYear.create({ name: '2025-26', startsOn: new Date('2025-04-01'), endsOn: new Date('2026-03-31') });
    const year = await AcademicYear.create({ name: '2026-27', startsOn: new Date('2026-04-01'), endsOn: new Date('2027-03-31'), isCurrent: true });
    const grade = await Grade.create({ name: 'Class 6', level: 6 });
    const sectionA = await Section.create({ gradeId: grade._id, name: 'A', classTeacherId: people.TEACHER.profile._id });
    const sectionB = await Section.create({ gradeId: grade._id, name: 'B' });
    let roll = 0;
    const enrol = async (admissionNo, section, ay, status = 'ACTIVE') => {
      roll += 1;
      const student = await Student.create({ admissionNo, firstName: admissionNo });
      const enrollment = await Enrollment.create({ studentId: student._id, sectionId: section._id, academicYearId: ay._id, status, rollNo: roll });
      return { student, enrollment };
    };
    return { lastYear, year, grade, sectionA, sectionB, enrol };
  });
  return { roleIds, people, ...data };
}
