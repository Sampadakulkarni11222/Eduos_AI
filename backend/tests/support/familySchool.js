import { seedSchool, seedPerson, inSchool, OAK } from './mcpSchool.js';
import { StudentGuardian } from '../../src/models/student.model.js';
import { Subject, SubjectOffering, Term } from '../../src/models/academics.model.js';
import { TimetableSlot } from '../../src/models/timetableSlot.model.js';

/**
 * The shared fixture for the PTM, review-call, conversation, staff-cover and
 * report-card suites, built on the MCP school (seedSchool):
 *
 *   Class 6 A: class teacher TEACHER (English); T2 teaches Maths
 *   Class 6 B: class teacher T3 (Science); T2 teaches Maths
 *   T4: a teacher with no classes (a free substitute)
 *   PARENT: father of Rahul (6 A) and of Riya (6 B): two children in two classes
 *   PARENT2: guardian of Aman (6 A)
 *   PARENT3: a parent with no child here (unrelated)
 *   HR: approves staff leave
 *
 * Timetable on `dow` (default today's weekday): 6 A P1 English 09:00–09:45,
 * P2 Maths 09:45–10:30; 6 B P1 Science 09:00–09:45, P2 Maths 09:45–10:30.
 *
 * Not a test file: vitest runs it only when imported.
 */
export const todayDow = () => { const d = new Date().getDay(); return d === 0 ? 7 : d; };

export async function seedFamilySchool({ dow = todayDow() } = {}) {
  const s = await seedSchool();
  const { roleIds } = s;
  const people = s.people;
  people.T2 = await seedPerson({ roleKey: 'TEACHER', roleId: roleIds.TEACHER, displayName: 'Maths teacher' });
  people.T3 = await seedPerson({ roleKey: 'TEACHER', roleId: roleIds.TEACHER, displayName: 'Science teacher (6 B)' });
  people.T4 = await seedPerson({ roleKey: 'TEACHER', roleId: roleIds.TEACHER, displayName: 'Free teacher' });
  people.PARENT2 = await seedPerson({ roleKey: 'PARENT', roleId: roleIds.PARENT, displayName: 'Aman\'s mother' });
  people.PARENT3 = await seedPerson({ roleKey: 'PARENT', roleId: roleIds.PARENT, displayName: 'Unrelated parent' });
  people.HR = await seedPerson({ roleKey: 'HR', roleId: roleIds.HR, displayName: 'HR officer' });
  const extra = await inSchool(OAK, async () => {
    s.sectionB.classTeacherId = people.T3.profile._id;
    await s.sectionB.save();
    await StudentGuardian.create({ studentId: s.riya.student._id, guardianProfileId: people.PARENT.profile._id, relation: 'FATHER' });
    await StudentGuardian.create({ studentId: s.aman.student._id, guardianProfileId: people.PARENT2.profile._id, relation: 'MOTHER', isPrimary: true });
    const term = await Term.create({ academicYearId: s.year._id, name: 'Term 1', startsOn: new Date('2026-04-01'), endsOn: new Date('2026-12-31') });
    const [english, maths, science] = await Subject.create([{ name: 'English' }, { name: 'Mathematics' }, { name: 'Science' }]);
    const off = async (sectionId, subjectId, teacherId) => SubjectOffering.create({ sectionId, subjectId, termId: term._id, teacherId });
    const engA = await off(s.sectionA._id, english._id, people.TEACHER.profile._id);
    const mathsA = await off(s.sectionA._id, maths._id, people.T2.profile._id);
    const sciB = await off(s.sectionB._id, science._id, people.T3.profile._id);
    const mathsB = await off(s.sectionB._id, maths._id, people.T2.profile._id);
    const slot = (sectionId, periodNo, offering, startTime, endTime) => TimetableSlot.create({ sectionId, dayOfWeek: dow, periodNo, startTime, endTime, subjectOfferingId: offering._id, room: `R-${periodNo}` });
    await slot(s.sectionA._id, 1, engA, '09:00', '09:45');
    await slot(s.sectionA._id, 2, mathsA, '09:45', '10:30');
    await slot(s.sectionB._id, 1, sciB, '09:00', '09:45');
    await slot(s.sectionB._id, 2, mathsB, '09:45', '10:30');
    return { term, subjects: { english, maths, science }, offerings: { engA, mathsA, sciB, mathsB } };
  });
  return { ...s, ...extra, dow };
}

/** YYYY-MM-DD of a day `n` days from today in India time. */
export const ymdIn = (n = 0) => new Date(Date.now() + 330 * 60_000 + n * 86_400_000).toISOString().slice(0, 10);
