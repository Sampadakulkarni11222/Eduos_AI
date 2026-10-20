import { describe, it, expect, beforeEach } from 'vitest';
import { seedSchool, seedPerson, inSchool, OAK, RIVER, todayKey } from './support/mcpSchool.js';
import { Facility } from '../src/models/facility.model.js';
import { Subject, SubjectOffering, Term } from '../src/models/academics.model.js';
import { TimetableSlot } from '../src/models/timetableSlot.model.js';
import { AttendanceRecord } from '../src/models/attendanceRecord.model.js';
import { Enrollment, Student, StudentGuardian } from '../src/models/student.model.js';
import { CoverAssignment } from '../src/models/staffLeave.model.js';
import { liveDetail, myView } from '../src/modules/campus/live-detail.service.js';
import { istDay } from '../src/modules/ptm/relations.js';
import { pinClock } from './support/clock.js';

// Built around "today": runs on a school day (next Wednesday morning IST), not on whatever day CI runs.
pinClock();

/**
 * The live detail behind the 3D campus, and each reader's own campus view,
 * are scoped on the server:
 *   - a parent gets their own child's class (teacher name and subject, period,
 *     strength and present count, their child's own status) and nothing about
 *     another class or any other child;
 *   - a teacher gets the named present list only for sections they teach;
 *   - the principal (attendance.read ALL) gets every class's list.
 */
let s;
let roomA;
let roomB;
let teacher2;
const inOak = (fn) => inSchool(OAK, fn);
const NOW = () => new Date();
const dowNow = () => { const d = new Date(Date.now() + 330 * 60_000).getUTCDay(); return d === 0 ? 7 : d; };

beforeEach(async () => {
  s = await seedSchool();
  teacher2 = await seedPerson({ roleKey: 'TEACHER', roleId: s.roleIds.TEACHER, displayName: 'Ms Second Teacher' });
  await inOak(async () => {
    const term = await Term.create({ academicYearId: s.year._id, name: 'Term 1', startsOn: new Date('2026-04-01'), endsOn: new Date('2027-03-31') });
    const maths = await Subject.create({ name: 'Mathematics' });
    const sci = await Subject.create({ name: 'Science' });
    const offA = await SubjectOffering.create({ sectionId: s.sectionA._id, subjectId: maths._id, termId: term._id, teacherId: s.people.TEACHER.profile._id });
    const offB = await SubjectOffering.create({ sectionId: s.sectionB._id, subjectId: sci._id, termId: term._id, teacherId: teacher2.profile._id });
    // One period that spans the whole day, so "now" is always inside it.
    await TimetableSlot.create({ sectionId: s.sectionA._id, dayOfWeek: dowNow(), periodNo: 1, startTime: '00:00', endTime: '23:59', subjectOfferingId: offA._id });
    await TimetableSlot.create({ sectionId: s.sectionB._id, dayOfWeek: dowNow(), periodNo: 1, startTime: '00:00', endTime: '23:59', subjectOfferingId: offB._id });
    roomA = await Facility.create({ code: 'G01', name: 'Room G01', kind: 'CLASSROOM', sectionId: s.sectionA._id, capacity: 40 });
    roomB = await Facility.create({ code: 'G02', name: 'Room G02', kind: 'CLASSROOM', sectionId: s.sectionB._id, capacity: 40 });
    await AttendanceRecord.create({ enrollmentId: s.riya.enrollment._id, date: todayKey(), periodNo: null, status: 'LATE' });
  });
});

const as = (who, fn) => inOak(() => fn(who.actor ?? s.people[who].actor));
const live = (who, kind, id) => as(who, (a) => liveDetail(a, { kind, id: id ? String(id) : null, now: NOW() }));
const mine = (who, opts = {}) => as(who, (a) => myView(a, { ...opts, now: NOW() }));
const section = (out, key) => out.sections.find((x) => x.key === key);

describe('room live details', () => {
  it('gives staff the period, teacher, counts and last update for a class in session', async () => {
    const out = await live('PRINCIPAL', 'room', roomA._id);
    expect(out.refreshSeconds).toBe(15);
    expect(out.live.period).toMatchObject({ subject: 'Mathematics', teacher: 'TEACHER user', periodNo: 1, startTime: '00:00', endTime: '23:59', coveringFor: null });
    expect(out.live.period.endsAt).toBeTruthy();
    expect(out.live.className).toBe('Class 6 A');
    expect(out.live.attendance).toMatchObject({ marked: true, strength: 3, present: 1, absent: 1 });
    expect(out.live.attendance.lastUpdatedAt).toBeTruthy();
  });

  it('says who is covering when a substitute is confirmed for the period', async () => {
    await inOak(() => CoverAssignment.create({ date: istDay(NOW()), sectionId: s.sectionA._id, periodNo: 1, startTime: '00:00', endTime: '23:59', absentProfileId: s.people.TEACHER.profile._id, substituteProfileId: teacher2.profile._id }));
    const out = await live('PRINCIPAL', 'room', roomA._id);
    expect(out.live.period).toMatchObject({ teacher: 'Ms Second Teacher', coveringFor: 'TEACHER user' });
  });
});

describe('the present list', () => {
  it('is given to the principal for any class, with admission numbers and status', async () => {
    const out = await live('PRINCIPAL', 'class', s.sectionB._id);
    const roster = section(out, 'roster');
    expect(roster.type).toBe('roster');
    expect(roster.items).toEqual([expect.objectContaining({ name: 'Riya Kapoor', initial: 'R', admissionNo: 'OAK-9', status: 'LATE' })]);
  });

  it('is given to a teacher only for the sections they teach', async () => {
    const own = await live('TEACHER', 'class', s.sectionA._id);
    expect(section(own, 'roster').items.map((r) => r.name)).toEqual(['Rahul Sharma', 'Priya Verma', 'Aman Gupta']);
    const other = await live('TEACHER', 'class', s.sectionB._id);
    expect(section(other, 'roster').type).toBe('note');
    expect(JSON.stringify(other)).not.toContain('Riya');
  });

  it('is given to a substitute confirmed for this period, and not before', async () => {
    const before = await live(teacher2, 'class', s.sectionA._id);
    expect(section(before, 'roster').type).toBe('note');
    await inOak(() => CoverAssignment.create({ date: istDay(NOW()), sectionId: s.sectionA._id, periodNo: 1, startTime: '00:00', endTime: '23:59', absentProfileId: s.people.TEACHER.profile._id, substituteProfileId: teacher2.profile._id, status: 'CONFIRMED' }));
    const after = await live(teacher2, 'class', s.sectionA._id);
    expect(section(after, 'roster').type).toBe('roster');
  });
});

describe('a parent', () => {
  it('sees their child\'s class with counts only, and their own child\'s status', async () => {
    const view = await mine('PARENT');
    expect(view.children).toEqual([{ studentId: String(s.rahul.student._id), name: 'Rahul Sharma', className: 'Class 6 A' }]);
    expect(view.focus).toMatchObject({ className: 'Class 6 A', facilityId: String(roomA._id) });
    expect(view.teacher).toMatchObject({ name: 'TEACHER user', subject: 'Mathematics' });
    expect(view.classCounts).toMatchObject({ strength: 3, present: 1, marked: true });
    expect(view.child).toMatchObject({ name: 'Rahul Sharma', today: 'ABSENT' });
    const text = JSON.stringify(view);
    for (const other of ['Priya', 'Aman', 'Riya', 'OAK-2', 'OAK-3']) expect(text).not.toContain(other);
  });

  it('cannot get another class\'s details or another child', async () => {
    await expect(live('PARENT', 'class', s.sectionB._id)).rejects.toMatchObject({ statusCode: 403 });
    const roomOther = await live('PARENT', 'room', roomB._id);
    expect(roomOther.live).toBeNull();
    expect(JSON.stringify(roomOther)).not.toMatch(/Riya|Science|Ms Second Teacher/);
    await expect(mine('PARENT', { studentId: String(s.riya.student._id) })).rejects.toMatchObject({ statusCode: 403 });
    await expect(live('PARENT', 'teacher', teacher2.profile._id)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('gets no names from their own class either: no roster, no absent or late counts', async () => {
    const out = await live('PARENT', 'class', s.sectionA._id);
    expect(section(out, 'roster')).toBeUndefined();
    const labels = section(out, 'attendance').items.map((i) => i.label);
    expect(labels).toEqual(['on roll', 'present']);
    expect(Object.keys(out.live.attendance).sort()).toEqual(['lastUpdatedAt', 'marked', 'present', 'source', 'strength']);
    const text = JSON.stringify(out);
    for (const other of ['Priya', 'Aman', 'OAK-2']) expect(text).not.toContain(other);
    expect(out.live.period).toMatchObject({ subject: 'Mathematics', teacher: 'TEACHER user' });
  });

  it('switches between their own children', async () => {
    await inOak(async () => {
      const kid = await Student.create({ admissionNo: 'OAK-5', firstName: 'Meera', lastName: 'Sharma' });
      await Enrollment.create({ studentId: kid._id, sectionId: s.sectionB._id, academicYearId: s.year._id, status: 'ACTIVE', rollNo: 2 });
      await StudentGuardian.create({ studentId: kid._id, guardianProfileId: s.people.PARENT.profile._id, relation: 'FATHER' });
      const view = await myView(s.people.PARENT.actor, { studentId: String(kid._id), now: NOW() });
      expect(view.children.map((c) => c.name).sort()).toEqual(['Meera Sharma', 'Rahul Sharma']);
      expect(view.focus.className).toBe('Class 6 B');
      expect(view.teacher.name).toBe('Ms Second Teacher');
      expect(JSON.stringify(view)).not.toContain('Riya');
    });
  });
});

describe('a student and a teacher', () => {
  it('gives a student their own class and own status only', async () => {
    const view = await mine('STUDENT');
    expect(view.children).toBeUndefined();
    expect(view.child).toMatchObject({ name: 'Priya Verma', today: 'PRESENT' });
    expect(view.focus.className).toBe('Class 6 A');
    expect(JSON.stringify(view)).not.toMatch(/Rahul|Aman|Riya/);
    await expect(live('STUDENT', 'class', s.sectionB._id)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('gives a teacher their current class with counts', async () => {
    const view = await mine('TEACHER');
    expect(view.role).toBe('TEACHER');
    expect(view.current).toMatchObject({ className: 'Class 6 A', subject: 'Mathematics', strength: 3, present: 1, facilityId: String(roomA._id) });
  });

  it('gives other staff their departments', async () => {
    const view = await mine('FINANCE');
    expect(view).toMatchObject({ role: 'STAFF', departments: ['FINANCE'] });
  });
});

describe('other kinds and isolation', () => {
  it('rejects an unknown kind and another school\'s ids', async () => {
    await expect(live('PRINCIPAL', 'spaceship', null)).rejects.toMatchObject({ statusCode: 400 });
    const riverRoom = await inSchool(RIVER, () => Facility.create({ code: 'R1', name: 'River Room', kind: 'CLASSROOM' }));
    await expect(live('PRINCIPAL', 'room', riverRoom._id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(live('PRINCIPAL', 'teacher', s.people.RIVER_ADMIN.profile._id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('shows a teacher\'s day to staff, and refuses lab, gate and zone details to families', async () => {
    const t = await live('PRINCIPAL', 'teacher', teacher2.profile._id);
    expect(section(t, 'now').rows[0].value).toMatch(/Science · Class 6 B/);
    for (const kind of ['lab', 'gate', 'zone']) {
      // eslint-disable-next-line no-await-in-loop
      await expect(live('PARENT', kind, roomA._id)).rejects.toMatchObject({ statusCode: 403 });
    }
  });

  it('shows a department to staff', async () => {
    const out = await live('PRINCIPAL', 'department', 'ACADEMICS');
    expect(out.title).toBeTruthy();
    expect(section(out, 'rooms').items.length).toBeGreaterThan(0);
  });
});
