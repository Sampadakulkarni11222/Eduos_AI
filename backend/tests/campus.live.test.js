import { describe, it, expect, beforeEach } from 'vitest';
import { seedSchool, inSchool, OAK } from './support/mcpSchool.js';
import { Subject, SubjectOffering, Term } from '../src/models/academics.model.js';
import { Facility } from '../src/models/facility.model.js';
import { TimetableSlot } from '../src/models/timetableSlot.model.js';
import { Exam, ExamSubject } from '../src/models/exam.model.js';
import { AttendanceRecord } from '../src/models/attendanceRecord.model.js';
import * as campus from '../src/modules/campus/campus.service.js';
import * as syllabus from '../src/modules/syllabus/syllabus.service.js';
import { startOfDayUtc } from '../src/modules/ops/common.js';

/**
 * The campus map's live layer: a classroom shows the register's headcount, the
 * lesson and module being taught and any exam, to staff only; a register that
 * has not been taken says so instead of showing zero.
 */

let school;
let room;
let maths;
// A fixed mid-morning on a weekday, so the class in the fixture is "now" whenever the test runs.
const NOW = new Date('2026-10-14T05:00:00Z'); // Wednesday 10:30 in India
const inOak = (fn) => inSchool(OAK, fn);

beforeEach(async () => {
  school = await seedSchool();
  await inOak(async () => {
    const term = await Term.create({ academicYearId: school.year._id, name: 'Term 1', startsOn: new Date('2026-04-01'), endsOn: new Date('2026-12-31') });
    const subject = await Subject.create({ name: 'Mathematics' });
    maths = await SubjectOffering.create({ sectionId: school.sectionA._id, subjectId: subject._id, termId: term._id, teacherId: school.people.TEACHER.profile._id });
    const campusNode = await Facility.create({ code: 'MAIN', name: 'Campus', kind: 'CAMPUS', layout: { x: 0, z: 0, w: 100, d: 100, h: 0 } });
    const block = await Facility.create({ code: 'BLK', name: 'Main Block', kind: 'BUILDING', parentId: campusNode._id, layout: { x: 0, z: 0, w: 40, d: 20, h: 4 } });
    const floor = await Facility.create({ code: 'BLK-F0', name: 'Ground', kind: 'FLOOR', parentId: block._id, floorNo: 0, layout: { x: 0, z: 0, w: 40, d: 20, h: 4 } });
    room = await Facility.create({ code: 'G01', name: 'Room G01', kind: 'CLASSROOM', parentId: floor._id, floorNo: 0, capacity: 40, sectionId: school.sectionA._id, department: 'Academics', layout: { x: 0, z: 0, w: 10, d: 10, h: 3 } });
    await Facility.create({ code: 'LIB', name: 'Reading Room', kind: 'LIBRARY', parentId: floor._id, floorNo: 0, layout: { x: 12, z: 0, w: 10, d: 10, h: 3 } });
    await TimetableSlot.create({ sectionId: school.sectionA._id, dayOfWeek: 3, periodNo: 2, startTime: '10:15', endTime: '11:00', subjectOfferingId: maths._id });
    // The fixture's register is for the day the test runs; move it to the fixed day.
    await AttendanceRecord.updateMany({}, { $set: { date: startOfDayUtc(NOW) } });
  });
  await inOak(() => syllabus.createModule(school.people.TEACHER.actor, { subjectOfferingId: String(maths._id), title: 'Fractions', plannedStart: '2026-10-05', plannedEnd: '2026-10-25', topics: ['Equivalent fractions', 'Adding fractions'] }));
});

const roomOf = (map) => map.facilities.find((f) => f.code === 'G01');

describe('a classroom on the map', () => {
  it('shows the register\'s headcount, the lesson, the teacher and the module being taught', async () => {
    const map = await inOak(() => campus.campusMap(school.people.PRINCIPAL.actor, { now: NOW }));
    const g01 = roomOf(map);
    // Three students in 6 A; the register marks one present and one absent.
    expect(g01.live).toMatchObject({ class: 'Class 6 A', enrolled: 3, present: 1, absent: 1, registerTaken: true, attendancePct: 50 });
    expect(g01.lesson).toMatchObject({ class: 'Class 6 A', subject: 'Mathematics', teacher: 'TEACHER user', periodNo: 2, module: { title: 'Fractions', nextTopic: 'Equivalent fractions' } });
    expect(g01.now[0]).toMatchObject({ type: 'SCHEDULED_CLASS', until: '11:00' });
    expect(map.kpis).toMatchObject({ classesNow: 1, studentsPresent: 1, studentsMarked: 2, studentsEnrolled: 3 });
  });

  it('says the register has not been taken, rather than showing nobody present', async () => {
    await inOak(() => AttendanceRecord.deleteMany({}));
    const map = await inOak(() => campus.campusMap(school.people.PRINCIPAL.actor, { now: NOW }));
    expect(roomOf(map).live).toMatchObject({ enrolled: 3, present: null, registerTaken: false, attendancePct: null });
    expect(map.kpis.studentsPresent).toBeNull();
  });

  it('marks a class sitting an exam today', async () => {
    await inOak(async () => {
      const term = await Term.findOne({});
      const exam = await Exam.create({ termId: term._id, name: 'Midterm', startsOn: new Date('2026-10-12'), endsOn: new Date('2026-10-16') });
      await ExamSubject.create({ examId: exam._id, subjectOfferingId: maths._id, examDate: startOfDayUtc(NOW) });
    });
    const map = await inOak(() => campus.campusMap(school.people.PRINCIPAL.actor, { now: NOW }));
    expect(roomOf(map).now[0]).toMatchObject({ type: 'EXAM', label: 'Midterm · Mathematics' });
    expect(map.kpis.examsNow).toBe(1);
  });

  it('shows a class that is in the library as away from its own room', async () => {
    await inOak(() => TimetableSlot.updateMany({}, { $set: { room: 'LIB' } }));
    const map = await inOak(() => campus.campusMap(school.people.PRINCIPAL.actor, { now: NOW }));
    expect(roomOf(map).live).toMatchObject({ homeRoom: true, away: true, awayIn: 'Reading Room' });
    expect(roomOf(map).lesson).toBeUndefined();
    const lib = map.facilities.find((f) => f.code === 'LIB');
    expect(lib.lesson).toMatchObject({ class: 'Class 6 A', subject: 'Mathematics' });
    expect(lib.live).toMatchObject({ class: 'Class 6 A', present: 1, homeRoom: false });
  });

  it('gives the room panel the day\'s lessons with their modules and the class\'s week', async () => {
    const detail = await inOak(() => campus.facilityDetail(school.people.TEACHER.actor, String(room._id), { now: NOW }));
    expect(detail.scheduleToday[0]).toMatchObject({ subject: 'Mathematics', teacher: 'TEACHER user', isNow: true, module: { title: 'Fractions', pace: expect.any(String) } });
    expect(detail.classToday).toMatchObject({ class: 'Class 6 A', enrolled: 3, present: 1, absent: 1 });
    expect(detail.classToday.week).toEqual([{ date: startOfDayUtc(NOW), present: 1, marked: 2, pct: 50 }]);
  });

  it('keeps headcount, teachers and lessons from families', async () => {
    const map = await inOak(() => campus.campusMap(school.people.PARENT.actor, { now: NOW }));
    const g01 = roomOf(map);
    expect(g01.live).toBeUndefined();
    expect(g01.lesson).toBeUndefined();
    expect(map.kpis.studentsPresent).toBeUndefined();
    expect(map.departments.every((d) => d.metrics.length === 0 && d.head === null && d.staffCount === null)).toBe(true);
  });
});

describe('departments on the map', () => {
  it('places each department on its rooms and gives staff its live figures', async () => {
    const map = await inOak(() => campus.campusMap(school.people.PRINCIPAL.actor, { now: NOW }));
    const academics = map.departments.find((d) => d.code === 'ACADEMICS');
    expect(academics.facilityIds).toEqual([String(room._id)]);
    expect(academics.staffCount).toBe(1);
    expect(academics.metrics.map((m) => `${m.value} ${m.label}`)).toEqual(['1 classes right now', '1 of 2 students present today']);
    expect(map.departments.find((d) => d.code === 'LIBRARY').facilityIds).toHaveLength(1);
    // No hostel building and no hostel unit: the department is not shown.
    expect(map.departments.find((d) => d.code === 'HOSTEL')).toBeUndefined();
  });
});

describe('looking at another time of today', () => {
  it('lets staff preview a time, and ignores the request from families', async () => {
    // 05:00Z is 10:30 in India; at 14:00 nothing is timetabled in the fixture.
    const later = await inOak(() => campus.campusMap(school.people.PRINCIPAL.actor, { now: NOW, at: '14:00' }));
    expect(later).toMatchObject({ preview: true, localTime: '14:00' });
    expect(roomOf(later).lesson).toBeUndefined();
    // The headcount is still today's register.
    expect(roomOf(later).live).toMatchObject({ present: 1, homeRoom: true });
    const family = await inOak(() => campus.campusMap(school.people.PARENT.actor, { now: NOW, at: '14:00' }));
    expect(family).toMatchObject({ preview: false, localTime: '10:30' });
    expect((await inOak(() => campus.campusMap(school.people.PRINCIPAL.actor, { now: NOW, at: 'soon' }))).preview).toBe(false);
  });
});
