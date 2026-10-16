import { describe, it, expect, beforeEach } from 'vitest';
import { seedSchool, seedPerson, inSchool, OAK, mcp } from './support/mcpSchool.js';
import { Subject, SubjectOffering, Term } from '../src/models/academics.model.js';
import { Facility } from '../src/models/facility.model.js';
import { TimetableSlot } from '../src/models/timetableSlot.model.js';
import { CalendarEvent } from '../src/models/calendarEvent.model.js';
import { Exam, ExamSubject } from '../src/models/exam.model.js';
import { AttendanceRecord } from '../src/models/attendanceRecord.model.js';
import * as campus from '../src/modules/campus/campus.service.js';
import { campusMoment, momentFromQuery } from '../src/modules/campus/moment.service.js';
import * as shifts from '../src/modules/shifts/shifts.service.js';
import * as creds from '../src/modules/staff/credentials.service.js';
import { startOfDayUtc } from '../src/modules/ops/common.js';

/**
 * Campus World at a chosen date and time: the day plan (calendar, shifts,
 * bells, timetable) decides who is where; outside school hours, on holidays
 * and on weekly offs the campus is empty; shifts carry their own bells and
 * never put two shifts' classes in one room at once; and teachers' profiles
 * reach families only as far as each teacher has agreed.
 */

let school;
let maths; let games; let science;
const inOak = (fn) => inSchool(OAK, fn);
const WED = (hm) => new Date(`2026-10-14T${hm}:00+05:30`); // a Wednesday
const ids = {};

const PERIODS = [['08:30', '09:15'], ['09:15', '10:00'], ['10:15', '11:00'], ['11:00', '11:45'], ['12:30', '13:15'], ['13:15', '14:00']];

beforeEach(async () => {
  school = await seedSchool();
  await inOak(async () => {
    const term = await Term.create({ academicYearId: school.year._id, name: 'Term 1', startsOn: new Date('2026-04-01'), endsOn: new Date('2026-12-31') });
    const [m, g, s] = await Subject.create([{ name: 'Mathematics' }, { name: 'Physical Education' }, { name: 'Science' }]);
    maths = await SubjectOffering.create({ sectionId: school.sectionA._id, subjectId: m._id, termId: term._id, teacherId: school.people.TEACHER.profile._id });
    games = await SubjectOffering.create({ sectionId: school.sectionA._id, subjectId: g._id, termId: term._id, teacherId: school.people.TEACHER.profile._id });
    science = await SubjectOffering.create({ sectionId: school.sectionB._id, subjectId: s._id, termId: term._id, teacherId: null });
    const campusNode = await Facility.create({ code: 'MAIN', name: 'Campus', kind: 'CAMPUS', layout: { x: 0, z: 0, w: 100, d: 100, h: 0 } });
    const block = await Facility.create({ code: 'BLK', name: 'Main Block', kind: 'BUILDING', parentId: campusNode._id, layout: { x: 0, z: 0, w: 40, d: 20, h: 4 } });
    const floor = await Facility.create({ code: 'BLK-F0', name: 'Ground', kind: 'FLOOR', parentId: block._id, floorNo: 0, layout: { x: 0, z: 0, w: 40, d: 20, h: 4 } });
    ids.g01 = String((await Facility.create({ code: 'G01', name: 'Room G01', kind: 'CLASSROOM', parentId: floor._id, floorNo: 0, capacity: 40, sectionId: school.sectionA._id, layout: { x: 0, z: 0, w: 10, d: 10, h: 3 } }))._id);
    ids.g02 = String((await Facility.create({ code: 'G02', name: 'Room G02', kind: 'CLASSROOM', parentId: floor._id, floorNo: 0, capacity: 40, sectionId: school.sectionB._id, layout: { x: 12, z: 0, w: 10, d: 10, h: 3 } }))._id);
    ids.canteen = String((await Facility.create({ code: 'CAN', name: 'Canteen Hall', kind: 'CANTEEN', parentId: floor._id, floorNo: 0, layout: { x: 24, z: 0, w: 10, d: 10, h: 3 } }))._id);
    ids.ground = String((await Facility.create({ code: 'GRD', name: 'Playground', kind: 'GROUND', parentId: campusNode._id, layout: { x: 0, z: 40, w: 40, d: 20, h: 0 } }))._id);
    ids.gate = String((await Facility.create({ code: 'GATE', name: 'Main Gate', kind: 'GATE', parentId: campusNode._id, layout: { x: 0, z: -45, w: 10, d: 3, h: 3 } }))._id);
    ids.bay = String((await Facility.create({ code: 'BUS', name: 'Bus Bay', kind: 'TRANSPORT_BAY', parentId: campusNode._id, layout: { x: -40, z: 0, w: 10, d: 30, h: 0 } }))._id);
    const slots = [];
    for (const day of [1, 2, 3, 4, 5, 6]) {
      PERIODS.forEach(([start, end], i) => {
        // 6 A: games in period 4; 6 B: science throughout.
        slots.push({ sectionId: school.sectionA._id, dayOfWeek: day, periodNo: i + 1, startTime: start, endTime: end, subjectOfferingId: i === 3 ? games._id : maths._id });
        slots.push({ sectionId: school.sectionB._id, dayOfWeek: day, periodNo: i + 1, startTime: start, endTime: end, subjectOfferingId: science._id });
      });
    }
    await TimetableSlot.insertMany(slots);
    await AttendanceRecord.deleteMany({});
  });
});

const moment = (at, viewer = { family: false, ownSectionIds: new Set() }) => inOak(() => campusMoment({ at, now: at, viewer }));
const crowdAt = (m, id) => m.crowd.find((c) => c.facilityId === id) ?? null;

describe('the day plan without shifts (bells read off the timetable)', () => {
  it('puts each class in its room during a period, with the banner counting down', async () => {
    const m = await moment(WED('10:48'));
    expect(m.day).toMatchObject({ kind: 'SCHOOL_DAY', open: true });
    expect(m.banner).toMatchObject({ text: 'Period 3 of 6, 12 min left', motion: true });
    expect(crowdAt(m, ids.g01)).toMatchObject({ students: 3, teachers: 1, activity: 'CLASS' });
    expect(crowdAt(m, ids.g02)).toMatchObject({ students: 1, activity: 'CLASS' });
    expect(m.sections.find((s) => s.className === 'Class 6 A')).toMatchObject({ subject: 'Mathematics', place: 'Room G01', periodNo: 3, headcountFrom: 'STRENGTH' });
  });

  it('sends a games period to the ground, lunch to the canteen and the break outside', async () => {
    const games4 = await moment(WED('11:20'));
    expect(crowdAt(games4, ids.ground)).toMatchObject({ students: 3, activity: 'SPORTS' });
    expect(crowdAt(games4, ids.g01)).toBeNull();
    const lunch = await moment(WED('12:00'));
    expect(lunch.banner.text).toMatch(/^Lunch, \d+ min left$/);
    expect(crowdAt(lunch, ids.canteen)).toMatchObject({ activity: 'LUNCH' });
    expect(crowdAt(lunch, ids.canteen).students + crowdAt(lunch, ids.ground).students).toBe(4);
    const arrival = await moment(WED('08:15'));
    expect(arrival.walkers).toBe('BUSY');
    expect(crowdAt(arrival, ids.gate).students + crowdAt(arrival, ids.bay).students).toBe(4);
  });

  it('is empty after hours and before opening, and says when it opens', async () => {
    const night = await moment(WED('20:00'));
    expect(night.crowd).toEqual([]);
    expect(night.walkers).toBe('NONE');
    expect(night.banner).toMatchObject({ text: 'School closed: opens tomorrow, 8:05 am', motion: false });
    const early = await moment(WED('06:00'));
    expect(early.banner.text).toBe('School closed: opens 8:05 am');
    expect(early.sections.every((s) => !s.activity)).toBe(true);
  });

  it('is empty on Sunday and on a calendar holiday, which it names', async () => {
    const sunday = await moment(new Date('2026-10-18T10:30:00+05:30'));
    expect(sunday.day).toMatchObject({ kind: 'WEEKLY_OFF', open: false });
    expect(sunday.banner).toMatchObject({ text: 'Weekly off: Sunday', sub: 'Opens tomorrow, 8:05 am', motion: false });
    expect(sunday.crowd).toEqual([]);
    await inOak(() => CalendarEvent.create({ title: 'Diwali', type: 'HOLIDAY', startsAt: new Date('2026-10-14'), endsAt: new Date('2026-10-14') }));
    const holiday = await moment(WED('10:48'));
    expect(holiday.banner).toMatchObject({ text: 'Holiday: Diwali', motion: false });
    expect(holiday.crowd).toEqual([]);
  });

  it('on an exam-only day only the classes sitting a paper come in', async () => {
    await inOak(async () => {
      await CalendarEvent.create({ title: 'Unit Test 3', type: 'EXAM_ONLY', startsAt: new Date('2026-10-14'), endsAt: new Date('2026-10-14') });
      const exam = await Exam.create({ termId: (await Term.findOne({}))._id, name: 'UT3', startsOn: new Date('2026-10-14'), endsOn: new Date('2026-10-14') });
      await ExamSubject.create({ examId: exam._id, subjectOfferingId: maths._id, examDate: new Date('2026-10-14T00:00:00Z') });
    });
    const m = await moment(WED('09:00'));
    expect(m.day.kind).toBe('EXAM_ONLY');
    expect(crowdAt(m, ids.g01)).toMatchObject({ activity: 'EXAM', students: 3 });
    expect(crowdAt(m, ids.g02)).toBeNull();
  });

  it("uses today's register once taken, and class strength before it", async () => {
    const at = WED('10:48');
    await inOak(async () => {
      const ens = await (await import('../src/models/student.model.js')).Enrollment.find({ sectionId: school.sectionA._id }).lean();
      await AttendanceRecord.create(ens.map((e, i) => ({ enrollmentId: e._id, date: startOfDayUtc(at), periodNo: null, status: i === 0 ? 'ABSENT' : 'PRESENT', source: 'WEB' })));
    });
    const m = await moment(at);
    expect(crowdAt(m, ids.g01).students).toBe(2);
    expect(m.sections.find((s) => s.className === 'Class 6 A').headcountFrom).toBe('REGISTER');
  });

  it('families see anonymous groups, with numbers only for their own class and no teacher names', async () => {
    const own = new Set([String(school.sectionA._id)]);
    const m = await moment(WED('10:48'), { family: true, ownSectionIds: own });
    expect(crowdAt(m, ids.g01).students).toBe(3);
    expect(crowdAt(m, ids.g02).students).toBeNull();
    expect(m.sections.map((s) => s.className)).toEqual(['Class 6 A']);
    expect(JSON.stringify(m)).not.toContain('TEACHER user');
    expect(m.totals).toBeNull();
  });
});

describe('the campus map follows the chosen time, not the clock', () => {
  const g01 = (map) => map.facilities.find((f) => f.code === 'G01');
  it('shows different scenes for different time slots of the same day', async () => {
    const p = school.people.PRINCIPAL.actor;
    const now = WED('07:00');
    const morning = await inOak(() => campus.campusMap(p, { now, at: '10:30' }));
    const lunch = await inOak(() => campus.campusMap(p, { now, at: '12:00' }));
    const night = await inOak(() => campus.campusMap(p, { now, at: '21:00' }));
    expect(g01(morning).lesson).toMatchObject({ subject: 'Mathematics', periodNo: 3 });
    expect(morning.moment.banner.text).toMatch(/^Period 3 of 6/);
    expect(g01(lunch).lesson).toBeUndefined();
    expect(lunch.moment.banner.text).toMatch(/^Lunch/);
    expect(g01(night).lesson).toBeUndefined();
    expect(g01(night).live).toMatchObject({ inSession: false });
    expect(night.kpis.classesNow).toBe(0);
  });

  it('lets staff pick another date: a holiday shows no lessons and says why', async () => {
    await inOak(() => CalendarEvent.create({ title: 'Dussehra', type: 'HOLIDAY', startsAt: new Date('2026-10-20'), endsAt: new Date('2026-10-20') }));
    const map = await inOak(() => campus.campusMap(school.people.PRINCIPAL.actor, { now: WED('09:00'), date: '2026-10-20', at: '10:30' }));
    expect(map.preview).toBe(true);
    expect(map.moment).toMatchObject({ date: '2026-10-20', day: { kind: 'HOLIDAY', title: 'Dussehra' } });
    expect(map.kpis.classesNow).toBe(0);
    expect(momentFromQuery({ date: '2031-01-01', now: WED('09:00') })).toBeNull();
  });
});

describe('shifts', () => {
  const primary = (sectionIds, extra = {}) => ({
    code: 'PRI', name: 'Primary morning', daysOfWeek: [1, 2, 3, 4, 5, 6], sectionIds,
    bells: [
      { kind: 'ASSEMBLY', start: '07:30', end: '07:45' },
      { kind: 'PERIOD', periodNo: 1, start: '07:45', end: '08:25' },
      { kind: 'PERIOD', periodNo: 2, start: '08:25', end: '09:05' },
      { kind: 'BREAK', start: '09:05', end: '09:20' },
      { kind: 'PERIOD', periodNo: 3, start: '09:20', end: '10:00' },
      { kind: 'PERIOD', periodNo: 4, start: '10:00', end: '10:40' },
      { kind: 'PERIOD', periodNo: 5, start: '10:40', end: '11:20' },
      { kind: 'PERIOD', periodNo: 6, start: '11:20', end: '12:00' },
    ],
    ...extra,
  });
  const secondary = (sectionIds) => ({
    code: 'SEC', name: 'Secondary day', sectionIds,
    bells: PERIODS.map(([start, end], i) => ({ kind: 'PERIOD', periodNo: i + 1, start, end })).concat([{ kind: 'LUNCH', start: '11:45', end: '12:30' }]),
  });

  it('gives each class its shift\'s bells and retimes its timetable to them', async () => {
    const admin = school.people.ADMIN.actor;
    const made = await inOak(() => shifts.create(admin, primary([String(school.sectionB._id)])));
    expect(made).toMatchObject({ code: 'PRI', periods: 6, startsAt: '07:30', endsAt: '12:00', sections: [{ name: 'Class 6 B' }] });
    expect(made.retimedPeriods).toBe(36);
    const p3 = await inOak(() => TimetableSlot.findOne({ sectionId: school.sectionB._id, dayOfWeek: 3, periodNo: 3 }).lean());
    expect([p3.startTime, p3.endTime]).toEqual(['09:20', '10:00']);
    await inOak(() => shifts.create(admin, secondary([String(school.sectionA._id)])));
    // 13:00: the primary shift has gone home; the secondary is in period 5.
    const m = await moment(WED('13:00'));
    expect(m.shifts.map((s) => [s.code, s.phase])).toEqual([['PRI', 'AFTER'], ['SEC', 'PERIOD']]);
    expect(m.banner.text).toBe('Secondary day: Period 5 of 6, 15 min left');
    expect(crowdAt(m, ids.g02)).toBeNull();
    expect(crowdAt(m, ids.g01)).toMatchObject({ activity: 'CLASS' });
    // 07:35: primary in assembly on the ground, secondary not yet in.
    const early = await moment(WED('07:35'));
    expect(crowdAt(early, ids.ground)).toMatchObject({ activity: 'ASSEMBLY', students: 1 });
    expect(early.sections.find((s) => s.className === 'Class 6 A').activity).toBeNull();
    const listed = await inOak(() => shifts.list());
    expect(listed.shifts.map((s) => s.code)).toEqual(['PRI', 'SEC']);
    expect(listed.unassigned).toEqual([]);
  });

  it('refuses two shifts in one room at the same time, and a class in two shifts', async () => {
    const admin = school.people.ADMIN.actor;
    await inOak(() => shifts.create(admin, secondary([String(school.sectionA._id)])));
    // 6 B's period 2 is moved into 6 A's room; with the primary bells it overlaps 6 A's period 1 there.
    await inOak(() => TimetableSlot.updateMany({ sectionId: school.sectionB._id, periodNo: 2 }, { $set: { room: 'G01' } }));
    await expect(inOak(() => shifts.create(admin, primary([String(school.sectionB._id)])))).rejects.toMatchObject({ statusCode: 409, code: 'SHIFT_ROOM_CONFLICT' });
    await inOak(() => TimetableSlot.updateMany({ sectionId: school.sectionB._id }, { $set: { room: null } }));
    await expect(inOak(() => shifts.create(admin, primary([String(school.sectionA._id)])))).rejects.toMatchObject({ statusCode: 409, code: 'SECTION_IN_OTHER_SHIFT' });
    const moved = await inOak(() => shifts.create(admin, primary([String(school.sectionA._id)], { moveSections: true })));
    expect(moved.moved).toEqual(['Class 6 A']);
    await expect(inOak(() => shifts.create(admin, { code: 'X', name: 'Bad', bells: [{ kind: 'PERIOD', periodNo: 1, start: '09:00', end: '10:00' }, { kind: 'PERIOD', periodNo: 2, start: '09:30', end: '10:30' }] }))).rejects.toMatchObject({ code: 'BELLS_OVERLAP' });
  });
});

describe("teachers' professional profiles", () => {
  const T = () => school.people.TEACHER;
  const body = {
    qualifications: [{ degree: 'M.Sc. Mathematics', institution: 'Sample University', year: 2012 }],
    subjects: ['Mathematics'], specialisations: ['Algebra'], experienceYears: 11,
    certifications: [{ name: 'CTET', issuer: 'CBSE', year: 2014 }], bio: 'Loves puzzles.',
  };

  it('stays hidden from families until the teacher turns each part on', async () => {
    await inOak(() => creds.updateMine(T().actor, body));
    const before = await inOak(() => creds.read(school.people.PARENT.actor, T().actor.profileId));
    expect(before).toMatchObject({ name: 'TEACHER user', shown: [], teaches: ['Mathematics', 'Physical Education'], classTeacher: true });
    expect(before.qualifications).toBeUndefined();
    await inOak(() => creds.updateMine(T().actor, { showToFamilies: { qualifications: true, certifications: true } }));
    const after = await inOak(() => creds.read(school.people.PARENT.actor, T().actor.profileId));
    expect(after.shown).toEqual(['qualifications', 'certifications']);
    expect(after.qualifications).toEqual([{ degree: 'M.Sc. Mathematics', institution: 'Sample University', year: 2012 }]);
    expect(after.bio).toBeUndefined();
    expect(after.experienceYears).toBeUndefined();
    const cards = await inOak(() => creds.teachersOf(school.people.PARENT.actor, {}));
    expect(cards.teachers).toEqual([expect.objectContaining({ name: 'TEACHER user', classTeacher: true, shown: ['qualifications', 'certifications'] })]);
  });

  it('appears in the "who is teaching now" panel and the live class page only as far as shared', async () => {
    const { liveDetail, myView } = await import('../src/modules/campus/live-detail.service.js');
    const now = WED('10:48');
    await inOak(() => creds.updateMine(T().actor, { ...body, showToFamilies: { experience: true } }));
    const page = await inOak(() => liveDetail(school.people.PARENT.actor, { kind: 'class', id: String(school.sectionA._id), now }));
    const about = page.sections.find((s) => s.key === 'credentials');
    expect(about).toMatchObject({ title: 'About TEACHER user', rows: [{ label: 'Experience', value: '11 years' }] });
    const mine = await inOak(() => myView(school.people.PARENT.actor, { now }));
    expect(mine.teacher.about).toMatchObject({ shown: ['experience'], experienceYears: 11 });
    expect(mine.teacher.about.bio).toBeUndefined();
    const staffPage = await inOak(() => liveDetail(school.people.PRINCIPAL.actor, { kind: 'teacher', id: T().actor.profileId, now }));
    expect(staffPage.sections[0]).toMatchObject({ key: 'credentials', title: 'Professional profile' });
    await inOak(() => creds.updateMine(T().actor, { showToFamilies: { experience: false } }));
    const hidden = await inOak(() => liveDetail(school.people.PARENT.actor, { kind: 'class', id: String(school.sectionA._id), now }));
    expect(hidden.sections.some((s) => s.key === 'credentials')).toBe(false);
  });

  it("families see only their own class's teachers; staff see a colleague's whole record", async () => {
    const other = await seedPerson({ roleKey: 'TEACHER', roleId: school.people.TEACHER.profile.roleId, displayName: 'Other teacher' });
    await inOak(() => creds.updateMine(other.actor, { ...body, showToFamilies: { bio: true } }));
    await expect(inOak(() => creds.read(school.people.PARENT.actor, other.actor.profileId))).rejects.toMatchObject({ statusCode: 403 });
    const colleague = await inOak(() => creds.read(school.people.PRINCIPAL.actor, other.actor.profileId));
    expect(colleague).toMatchObject({ experienceYears: 11, bio: 'Loves puzzles.', canEditConsent: false });
    expect(colleague.familiesSee.shown).toEqual(['bio']);
  });

  it('HR edits the content but never the consent; a teacher cannot edit a colleague', async () => {
    const hr = await seedPerson({ roleKey: 'HR', roleId: school.roleIds.HR });
    const saved = await inOak(() => creds.updateFor(hr.actor, T().actor.profileId, { experienceYears: 12, showToFamilies: { bio: true } }));
    expect(saved.experienceYears).toBe(12);
    expect(saved.showToFamilies.bio).toBe(false);
    const other = await seedPerson({ roleKey: 'TEACHER', roleId: school.people.TEACHER.profile.roleId, displayName: 'Other teacher' });
    await expect(inOak(() => creds.updateFor(other.actor, T().actor.profileId, { bio: 'x' }))).rejects.toMatchObject({ statusCode: 403 });
    await expect(inOak(() => creds.listStaff(T().actor))).rejects.toMatchObject({ statusCode: 403 });
    expect((await inOak(() => creds.listStaff(hr.actor))).some((r) => r.name === 'TEACHER user')).toBe(true);
    await expect(inOak(() => creds.mine(school.people.PARENT.actor))).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('assistant tools', () => {
  it("answers what's happening at a time, which shift a class is in, and a teacher's qualifications", async () => {
    const res = await mcp(OAK, school.people.PRINCIPAL.actor, 'get_campus_moment', { date: '2026-10-18', time: '10:30' });
    expect(res, JSON.stringify(res)).toMatchObject({ success: true });
    expect(res.data.banner).toBe('Weekly off: Sunday');
    await inOak(() => shifts.create(school.people.ADMIN.actor, { code: 'SEC', name: 'Secondary day', sectionIds: [String(school.sectionA._id)], bells: PERIODS.map(([start, end], i) => ({ kind: 'PERIOD', periodNo: i + 1, start, end })) }));
    const shift = await mcp(OAK, school.people.PRINCIPAL.actor, 'get_section_shift', { className: '6A' });
    expect(shift.data).toMatchObject({ class: 'Class 6 A', shift: { name: 'Secondary day', code: 'SEC' } });
    const notMine = await mcp(OAK, school.people.PARENT.actor, 'get_section_shift', { className: '6B' });
    expect(notMine.success).toBe(false);
    await inOak(() => creds.updateMine(school.people.TEACHER.actor, { experienceYears: 9, bio: 'Hidden bio', showToFamilies: { experience: true } }));
    const asParent = await mcp(OAK, school.people.PARENT.actor, 'get_teacher_qualifications', { teacherName: 'TEACHER user' });
    expect(asParent.data).toMatchObject({ name: 'TEACHER user', experienceYears: 9, bio: null });
    const asStaff = await mcp(OAK, school.people.PRINCIPAL.actor, 'get_teacher_qualifications', { teacherName: 'TEACHER user' });
    expect(asStaff.data).toMatchObject({ bio: 'Hidden bio' });
  });
});
