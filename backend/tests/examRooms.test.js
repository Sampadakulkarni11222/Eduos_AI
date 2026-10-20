import { describe, it, expect, beforeEach } from 'vitest';
import { inSchool, OAK } from './support/mcpSchool.js';
import { seedFamilySchool, ymdIn } from './support/familySchool.js';
import { Facility } from '../src/models/facility.model.js';
import { ExamSubject, Exam } from '../src/models/exam.model.js';
import { ExamSitting, RoomShift, SectionRoomChange } from '../src/models/examRoom.model.js';
import { MessageOutbox } from '../src/models/messaging.model.js';
import { StaffAbsence } from '../src/models/staffLeave.model.js';
import { TimetableSlot } from '../src/models/timetableSlot.model.js';
import * as halls from '../src/modules/examRooms/examHalls.service.js';
import * as rooms from '../src/modules/examRooms/rooms.service.js';
import { campusMoment } from '../src/modules/campus/moment.service.js';
import { liveDetail } from '../src/modules/campus/live-detail.service.js';
import { getTimetable } from '../src/modules/timetable/timetable.controller.js';
import { instantOf } from '../src/modules/campus/day-plan.js';

/**
 * Part 8: exam halls, Rooms & Classes and room shifts.
 *
 * Fixture (familySchool): today, 6 A P1 English (TEACHER) 09:00–09:45, P2 Maths (T2)
 * 09:45–10:30; 6 B P1 Science (T3), P2 Maths (T2). 6 A: Rahul (PARENT's), Priya
 * (the STUDENT), Aman (PARENT2's); 6 B: Riya (PARENT's). Rooms are added here.
 */
let s; let R;
const oak = (fn) => inSchool(OAK, fn);
const today = ymdIn(0);
const tomorrow = ymdIn(1);
const who = (k) => s.people[k].actor;
const A = () => who('ADMIN');
const P = () => who('PRINCIPAL');

beforeEach(async () => {
  s = await seedFamilySchool();
  R = await oak(async () => {
    const mk = (code, name, kind, capacity, sectionId = null) => Facility.create({ code, name, kind, capacity, sectionId });
    return {
      home6A: await mk('C-6A', 'Room 6A', 'CLASSROOM', 40, s.sectionA._id),
      home6B: await mk('C-6B', 'Room 6B', 'CLASSROOM', 40, s.sectionB._id),
      hall: await mk('AUD', 'Auditorium', 'AUDITORIUM', 120),
      small: await mk('S-1', 'Small room', 'CLASSROOM', 2),
      lab: await mk('SCI', 'Science Lab', 'LAB', 30),
      r204: await mk('R204', 'Room 204', 'CLASSROOM', 36),
    };
  });
});

const paper = (over = {}) => ({ subjectOfferingIds: [String(s.offerings.mathsA._id)], kind: 'TERM', date: tomorrow, startTime: '11:00', endTime: '12:00', venues: [{ facilityId: String(R.hall._id), invigilatorProfileIds: [who('T4').profileId] }], ...over });
const create = (actor, over) => oak(() => halls.createSitting(actor, paper(over)));

describe('scheduling a paper', () => {
  it('seats every candidate by roll number within the room, and links an exam paper', async () => {
    const exam = await oak(() => Exam.create({ termId: s.term._id, name: 'Midterm', startsOn: new Date(), endsOn: new Date() }));
    const es = await oak(() => ExamSubject.create({ examId: exam._id, subjectOfferingId: s.offerings.mathsA._id }));
    const out = await create(P(), { subjectOfferingIds: undefined, examSubjectId: String(es._id) });
    expect(out.title).toBe('Midterm · Mathematics');
    expect(out.candidates).toBe(3);
    expect(out.venues[0].seats.map((x) => [x.seatNo, x.rollNo])).toEqual([['AUD-01', 1], ['AUD-02', 2], ['AUD-03', 3]]);
    expect(out.venues[0].invigilators.map((i) => i.name)).toEqual(['Free teacher']);
    // The exam paper's own date follows, so the existing exam-day features agree.
    expect((await oak(() => ExamSubject.findById(es._id).lean())).examDate.toISOString().slice(0, 10)).toBe(tomorrow);
  });

  it('refuses rooms too small for the candidates, and splits across rooms without overfilling any', async () => {
    await expect(create(A(), { venues: [{ facilityId: String(R.small._id) }] })).rejects.toMatchObject({ code: 'NOT_ENOUGH_SEATS' });
    const out = await create(A(), { venues: [{ facilityId: String(R.small._id) }, { facilityId: String(R.r204._id), capacity: 5 }] });
    expect(out.venues.map((v) => [v.room, v.seated, v.capacity])).toEqual([['Small room', 2, 2], ['Room 204', 1, 5]]);
    await expect(create(A(), { date: ymdIn(2), venues: [{ facilityId: String(R.small._id), capacity: 9 }] })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('moves a candidate to another room or seat by hand, swapping and respecting seats', async () => {
    const out = await create(A(), { venues: [{ facilityId: String(R.small._id) }, { facilityId: String(R.r204._id), capacity: 2 }] });
    const aman = out.venues[1].seats[0];
    // The small room is full: a move into it needs a swap.
    await expect(oak(() => halls.moveSeat(A(), out.id, { enrollmentId: aman.enrollmentId, toFacilityId: String(R.small._id) }))).rejects.toMatchObject({ code: 'ROOM_FULL' });
    const swapped = await oak(() => halls.moveSeat(A(), out.id, { enrollmentId: aman.enrollmentId, toFacilityId: String(R.small._id), seatNo: 'S-1-01' }));
    expect(swapped.venues[0].seats.find((x) => x.seatNo === 'S-1-01').name).toBe('Aman Gupta');
    expect(swapped.venues[1].seats.map((x) => x.name)).toEqual(['Rahul Sharma']);
    expect(swapped.venues.reduce((n, v) => n + v.seated, 0)).toBe(3);
  });
});

describe('room clashes', () => {
  it('a room cannot hold two papers at once', async () => {
    await create(A());
    await expect(create(A(), { subjectOfferingIds: [String(s.offerings.sciB._id)], startTime: '11:30', endTime: '12:30', venues: [{ facilityId: String(R.hall._id) }] })).rejects.toMatchObject({ code: 'ROOM_CLASH' });
    // Back to back is fine.
    await expect(create(A(), { subjectOfferingIds: [String(s.offerings.sciB._id)], startTime: '12:00', endTime: '13:00', venues: [{ facilityId: String(R.hall._id) }] })).resolves.toBeTruthy();
  });

  it('nor a paper and a timetabled class; the class sitting the paper frees its own room', async () => {
    // 6 B's paper in 6 A's home room during 6 A's English.
    await expect(create(A(), { subjectOfferingIds: [String(s.offerings.sciB._id)], date: today, startTime: '09:00', endTime: '09:45', venues: [{ facilityId: String(R.home6A._id) }] }))
      .rejects.toMatchObject({ code: 'ROOM_CLASH', errors: [expect.objectContaining({ kind: 'CLASS', detail: expect.stringMatching(/Class 6 A English, period 1/) })] });
    // 6 A's own paper in its own room at that time is no clash.
    await expect(create(A(), { date: today, startTime: '09:00', endTime: '09:45', venues: [{ facilityId: String(R.home6A._id) }] })).resolves.toBeTruthy();
  });

  it('nor a room out of use for maintenance', async () => {
    await oak(() => Facility.updateOne({ _id: R.r204._id }, { $set: { status: 'UNDER_MAINTENANCE' } }));
    await expect(create(A(), { venues: [{ facilityId: String(R.r204._id) }] })).rejects.toMatchObject({ code: 'ROOM_CLASH', errors: [expect.objectContaining({ kind: 'MAINTENANCE' })] });
  });
});

describe('invigilator clashes', () => {
  it('not while teaching another class, covering, invigilating elsewhere or absent', async () => {
    // T2 teaches 6 A Maths in P2: cannot invigilate 6 B then.
    await expect(create(A(), { subjectOfferingIds: [String(s.offerings.sciB._id)], date: today, startTime: '09:45', endTime: '10:30', venues: [{ facilityId: String(R.hall._id), invigilatorProfileIds: [who('T2').profileId] }] }))
      .rejects.toMatchObject({ code: 'INVIGILATOR_CLASH', errors: [expect.objectContaining({ kind: 'TEACHING' })] });
    // T3 teaches 6 B in P1, but 6 B is the class sitting the paper: free.
    await expect(create(A(), { subjectOfferingIds: [String(s.offerings.sciB._id)], date: today, startTime: '09:00', endTime: '09:45', venues: [{ facilityId: String(R.hall._id), invigilatorProfileIds: [who('T3').profileId] }] })).resolves.toBeTruthy();
    // Another paper at the same time for the same invigilator.
    await create(A(), { venues: [{ facilityId: String(R.lab._id), invigilatorProfileIds: [who('T4').profileId] }] });
    await expect(create(A(), { subjectOfferingIds: [String(s.offerings.engA._id)], kind: 'OTHER', venues: [{ facilityId: String(R.r204._id), invigilatorProfileIds: [who('T4').profileId] }] }))
      .rejects.toMatchObject({ code: 'INVIGILATOR_CLASH', errors: [expect.objectContaining({ kind: 'INVIGILATION' })] });
    // Absent that day.
    await oak(() => StaffAbsence.create({ profileId: who('HR').profileId, date: new Date(`${ymdIn(3)}T00:00:00Z`), reason: 'Unwell' }));
    await expect(create(A(), { date: ymdIn(3), venues: [{ facilityId: String(R.hall._id), invigilatorProfileIds: [who('HR').profileId] }] }))
      .rejects.toMatchObject({ code: 'INVIGILATOR_CLASH', errors: [expect.objectContaining({ kind: 'ABSENT' })] });
  });

  it('lists each teacher as free or busy with the reason, and builds a duty roster', async () => {
    const opts = await oak(() => halls.invigilatorOptions(A(), { date: today, startTime: '09:45', endTime: '10:30' }));
    expect(opts.find((o) => o.name === 'Maths teacher')).toMatchObject({ free: false, clashes: expect.arrayContaining([expect.stringMatching(/Teaches Class 6 A Mathematics in period 2/)]) });
    expect(opts.find((o) => o.name === 'Free teacher').free).toBe(true);
    await create(A());
    const mine = await oak(() => halls.duties(who('T4'), {}));
    expect(mine.items).toEqual([expect.objectContaining({ room: 'Auditorium', title: 'Exam · Mathematics', seated: 3 })]);
    await expect(oak(() => halls.duties(who('T4'), { profileId: who('T2').profileId }))).rejects.toMatchObject({ statusCode: 403 });
    const roster = await oak(() => halls.duties(A(), { all: true }));
    expect(roster.roster).toEqual([expect.objectContaining({ name: 'Free teacher', duties: 1, minutes: 60 })]);
  });
});

describe('teacher scope', () => {
  it('a teacher schedules a class test for a subject they teach, invigilated by themselves, in a free room', async () => {
    const t = who('TEACHER');
    const out = await oak(() => halls.createSitting(t, { subjectOfferingIds: [String(s.offerings.engA._id)], date: tomorrow, startTime: '11:00', endTime: '11:40', venues: [{ facilityId: String(R.r204._id) }] }));
    expect(out.kind).toBe('CLASS_TEST');
    expect(out.venues[0].invigilators.map((i) => i.id)).toEqual([t.profileId]);
    // Not a term paper, not a colleague's subject, not a colleague as invigilator.
    await expect(oak(() => halls.createSitting(t, { subjectOfferingIds: [String(s.offerings.engA._id)], kind: 'TERM', date: tomorrow, startTime: '12:00', endTime: '13:00', venues: [{ facilityId: String(R.r204._id) }] }))).rejects.toMatchObject({ statusCode: 403 });
    await expect(oak(() => halls.createSitting(t, { subjectOfferingIds: [String(s.offerings.mathsA._id)], date: tomorrow, startTime: '12:00', endTime: '13:00', venues: [{ facilityId: String(R.r204._id) }] }))).rejects.toMatchObject({ statusCode: 403 });
    await expect(oak(() => halls.createSitting(t, { subjectOfferingIds: [String(s.offerings.engA._id)], date: tomorrow, startTime: '12:00', endTime: '13:00', venues: [{ facilityId: String(R.r204._id), invigilatorProfileIds: [who('T4').profileId] }] }))).rejects.toMatchObject({ statusCode: 403 });
    // A colleague cannot change it; the exam office can.
    await expect(oak(() => halls.delaySitting(who('T2'), out.id, { minutes: 10 }))).rejects.toMatchObject({ statusCode: 403 });
    await expect(oak(() => halls.delaySitting(A(), out.id, { minutes: 10 }))).resolves.toMatchObject({ delayMinutes: 10 });
    // A teacher sees papers of their classes, not others'.
    await create(A(), { subjectOfferingIds: [String(s.offerings.sciB._id)], date: ymdIn(2) });
    const list = await oak(() => halls.listSittings(t, {}));
    expect(list.items.map((x) => x.classes[0].className)).toEqual(['Class 6 A']);
  });
});

describe('families: their own exam timetable only', () => {
  it('a parent sees each child\'s room and own seat, nobody else\'s', async () => {
    await create(A());
    await create(A(), { subjectOfferingIds: [String(s.offerings.sciB._id)], date: ymdIn(2), venues: [{ facilityId: String(R.lab._id) }] });
    const mine = await oak(() => halls.myExams(who('PARENT'), {}));
    const by = Object.fromEntries(mine.children.map((c) => [c.name, c]));
    expect(by['Rahul Sharma'].exams).toEqual([expect.objectContaining({ room: 'Auditorium', seatNo: 'AUD-01', startTime: '11:00' })]);
    expect(by['Riya Kapoor'].exams).toEqual([expect.objectContaining({ room: 'Science Lab', seatNo: 'SCI-01' })]);
    const text = JSON.stringify(mine);
    for (const other of ['Priya', 'Aman', 'AUD-02', 'AUD-03', 'Free teacher']) expect(text).not.toContain(other);
    const student = await oak(() => halls.myExams(who('STUDENT'), {}));
    expect(student.children).toEqual([expect.objectContaining({ name: 'Priya Verma', exams: [expect.objectContaining({ seatNo: 'AUD-02' })] })]);
    expect(JSON.stringify(student)).not.toContain('Rahul');
    await expect(oak(() => halls.myExams(who('PARENT3'), { studentId: String(s.rahul.student._id) }))).rejects.toMatchObject({ statusCode: 403 });
    await expect(oak(() => halls.listSittings(who('PARENT'), {}))).rejects.toMatchObject({ statusCode: 403 });
    const any = await oak(() => ExamSitting.findOne({}).lean());
    await expect(oak(() => halls.getSitting(who('PARENT'), String(any._id)))).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('changes on the day', () => {
  it('a room change re-seats, sets the banner and tells candidates, families and invigilators once', async () => {
    const out = await create(A());
    const moved = await oak(() => halls.changeVenue(P(), out.id, { toRoom: 'science lab', reason: 'Hall needed for assembly' }));
    expect(moved.venues.map((v) => [v.room, v.seated])).toEqual([['Science Lab', 3]]);
    expect(moved.banner).toMatch(/Moved from Auditorium to Science Lab \(Hall needed for assembly\)/);
    expect(moved.notified).toMatchObject({ students: 1, guardians: 2, invigilators: 1 });
    const rows = await oak(() => MessageOutbox.find({ templateKey: 'EXAM_CHANGED' }).lean());
    const to = new Set(rows.map((r) => String(r.recipientProfileId)));
    for (const k of ['STUDENT', 'PARENT', 'PARENT2', 'T4']) expect(to.has(who(k).profileId)).toBe(true);
    expect(to.has(who('PARENT3').profileId)).toBe(false);
    const family = await oak(() => halls.myExams(who('PARENT'), {}));
    expect(family.children.find((c) => c.name === 'Rahul Sharma').exams[0]).toMatchObject({ room: 'Science Lab', seatNo: 'SCI-01', banner: expect.stringMatching(/Science Lab/) });
  });

  it('a delay moves the window (checked again) and a postponement needs a reason', async () => {
    const out = await create(A());
    const later = await oak(() => halls.delaySitting(A(), out.id, { minutes: 30, reason: 'Paper packets late' }));
    expect([later.startsAt, later.endsAt]).toEqual(['11:30', '12:30']);
    await expect(oak(() => halls.setStatus(A(), out.id, { status: 'POSTPONED' }))).rejects.toMatchObject({ code: 'AGENT_NEEDS_INPUT' });
    const p = await oak(() => halls.setStatus(A(), out.id, { status: 'POSTPONED', reason: 'Heavy rain' }));
    expect(p.status).toBe('POSTPONED');
    const again = await oak(() => halls.setStatus(A(), out.id, { status: 'SCHEDULED', newDate: ymdIn(4), reason: 'New date' }));
    expect(again).toMatchObject({ status: 'SCHEDULED', date: ymdIn(4), delayMinutes: 0 });
  });

  it('exports the seating chart and the door list', async () => {
    const out = await create(A(), { venues: [{ facilityId: String(R.small._id) }, { facilityId: String(R.r204._id), capacity: 5 }] });
    const csv = await oak(() => halls.seatingCsv(A(), out.id));
    expect(csv.csv.split('\n')[1]).toMatch(/Small room,S-1-01,Class 6 A,1,Rahul Sharma,OAK-1/);
    const door = await oak(() => halls.doorList(A(), out.id));
    expect(door.rooms.map((r) => [r.room, r.groups[0].fromRoll, r.groups[0].toRoll])).toEqual([['Small room', 1, 2], ['Room 204', 3, 3]]);
  });
});

describe('Rooms & Classes', () => {
  it('assigns a home room with history; refuses a taken room unless displacing; only admin/principal', async () => {
    await expect(oak(() => rooms.assignHomeRoom(who('TEACHER'), { className: '6A', room: 'R204' }))).rejects.toMatchObject({ statusCode: 403 });
    const out = await oak(() => rooms.assignHomeRoom(A(), { className: '6A', room: '204', reason: 'Bigger room' }));
    expect(out).toMatchObject({ className: 'Class 6 A', from: { name: 'Room 6A' }, to: { name: 'Room 204' }, fits: true });
    await expect(oak(() => rooms.assignHomeRoom(A(), { className: '6B', room: 'R204' }))).rejects.toMatchObject({ code: 'ROOM_TAKEN' });
    await oak(() => rooms.assignHomeRoom(P(), { className: '6B', room: 'R204', displace: true, reason: 'Swap' }));
    const hist = await oak(() => rooms.sectionHistory(A(), String(s.sectionA._id)));
    expect(hist.items.map((h) => h.via)).toEqual(['DISPLACED', 'ASSIGN']);
    const view = await oak(() => rooms.roomsAndClasses(A(), {}));
    expect(view.sections.find((x) => x.className === 'Class 6 B').homeRoom.name).toBe('Room 204');
    expect(view.sections.find((x) => x.className === 'Class 6 A').homeRoom).toBeNull();
    expect(view.rooms.find((r) => r.name === 'Room 204').occupant.className).toBe('Class 6 B');
    // Families see their own class only.
    const fam = await oak(() => rooms.roomsAndClasses(who('PARENT2'), {}));
    expect(fam.sections.map((x) => x.className)).toEqual(['Class 6 A']);
    expect(fam.rooms).toEqual([]);
  });
});

describe('room shifts', () => {
  const shift = (actor, over = {}) => oak(() => rooms.createShift(actor, { className: '6A', toRoom: 'Science Lab', date: today, periods: [1], reason: 'Painting', ...over }));

  it('the admin applies at once; the timetable, campus map, live page and clash checks use the new room; everyone is told', async () => {
    const out = await shift(A());
    expect(out).toMatchObject({ status: 'APPLIED', applied: true, to: { name: 'Science Lab' }, when: expect.stringMatching(/period 1/) });
    expect(out.notified).toMatchObject({ students: 1, guardians: 2 });
    const msgs = await oak(() => MessageOutbox.find({ templateKey: 'ROOM_SHIFTED' }).lean());
    const to = new Set(msgs.map((m) => String(m.recipientProfileId)));
    // The class teacher and the teacher of the period moved; not the Maths teacher, whose period stays.
    for (const k of ['TEACHER', 'STUDENT', 'PARENT', 'PARENT2']) expect(to.has(who(k).profileId)).toBe(true);
    expect(to.has(who('T2').profileId)).toBe(false);
    // Where is 6 A today.
    const where = await oak(() => rooms.sectionRoomOn(who('PARENT2'), { className: '6A' }));
    expect(where.periods.map((p) => [p.periodNo, p.room, Boolean(p.moved)])).toEqual([[1, 'Science Lab', true], [2, 'Room 6A', false]]);
    await expect(oak(() => rooms.sectionRoomOn(who('PARENT3'), { className: '6A' }))).rejects.toMatchObject({ statusCode: 403 });
    // Timetable view: the effective room, the base slot unchanged.
    let body = null;
    await oak(() => getTimetable({ actor: A(), scope: 'ALL', query: { sectionId: String(s.sectionA._id) } }, { status: () => ({ json: (b) => { body = b; } }) }, (e) => { throw e; }));
    const p1 = body.data.slots.find((x) => x.periodNo === 1 && x.dayOfWeek === s.dow);
    expect(p1).toMatchObject({ room: 'R-1', effectiveRoom: 'Science Lab', roomShift: expect.objectContaining({ reason: 'Painting' }) });
    expect((await oak(() => TimetableSlot.findOne({ sectionId: s.sectionA._id, periodNo: 1 }).lean())).room).toBe('R-1');
    // Campus World at 09:10: 6 A is in the lab.
    const at = instantOf(today, 9 * 60 + 10);
    const m = await oak(() => campusMoment({ at, now: at, viewer: { family: false, ownSectionIds: new Set() } }));
    expect(m.sections.find((x) => x.className === 'Class 6 A')).toMatchObject({ place: 'Science Lab', movedTo: { room: 'Science Lab', reason: 'Painting' } });
    expect(m.crowd.find((c) => c.facilityId === String(R.lab._id)).labels[0]).toMatch(/Class 6 A \(moved here: Painting\)/);
    // The live room page: the lab shows the moved class.
    const live = await oak(() => liveDetail(A(), { kind: 'room', id: String(R.lab._id), now: at }));
    expect(live.sections.find((x) => x.key === 'movedIn').text).toMatch(/Class 6 A is in this room for period 1: Painting/);
    // An exam in the lab during that period now clashes with the moved class.
    await expect(create(A(), { subjectOfferingIds: [String(s.offerings.sciB._id)], date: today, startTime: '09:00', endTime: '09:45', venues: [{ facilityId: String(R.lab._id) }] }))
      .rejects.toMatchObject({ code: 'ROOM_CLASH', errors: [expect.objectContaining({ detail: expect.stringMatching(/moved here/) })] });
  });

  it('refuses a busy room and suggests free rooms that fit', async () => {
    await shift(A(), { className: '6B' });
    const err = await shift(A()).catch((e) => e);
    expect(err.code).toBe('ROOM_CLASH');
    expect(err.errors[0].suggestions.map((x) => x.name)).toEqual(expect.arrayContaining(['Room 204', 'Auditorium']));
    expect(err.errors[0].suggestions.map((x) => x.name)).not.toContain('Small room');
    const check = await oak(() => rooms.checkShift(A(), { className: '6A', toRoom: 'Room 204', date: today, periods: [1], reason: 'Painting' }));
    expect(check.conflicts).toEqual([]);
  });

  it('a teacher requests for their own class or periods; the admin decides; self-shift applies one free period', async () => {
    // T2 teaches 6 A Maths (P2), not English (P1).
    await expect(shift(who('T2'))).rejects.toMatchObject({ statusCode: 403 });
    const req = await shift(who('T2'), { periods: [2] });
    expect(req).toMatchObject({ status: 'REQUESTED', applied: false });
    expect(await oak(() => MessageOutbox.countDocuments({ templateKey: 'ROOM_SHIFTED' }))).toBe(0);
    await expect(oak(() => rooms.decideShift(who('TEACHER'), req.id, { action: 'APPROVE' }))).rejects.toMatchObject({ statusCode: 403 });
    const done = await oak(() => rooms.decideShift(P(), req.id, { action: 'APPROVE' }));
    expect(done.status).toBe('APPLIED');
    // Self-shift: off by default (a request), on: applied at once for one period.
    const r2 = await shift(who('TEACHER'), { toRoom: 'Room 204' });
    expect(r2.status).toBe('REQUESTED');
    await oak(() => rooms.cancelShift(who('TEACHER'), r2.id, { reason: 'Not needed' }));
    await oak(() => rooms.setSettings(A(), { teacherSelfShift: true }));
    const r3 = await shift(who('TEACHER'), { toRoom: 'Room 204' });
    expect(r3).toMatchObject({ status: 'APPLIED', selfApplied: true });
    // A whole day still waits for approval.
    const r4 = await shift(who('TEACHER'), { toRoom: 'Auditorium', periods: [] });
    expect(r4).toMatchObject({ status: 'REQUESTED', selfApplied: false });
    expect(await oak(() => RoomShift.countDocuments({ status: 'APPLIED' }))).toBe(2);
  });

  it('a permanent shift changes the home room, its history and the slots that named the old room', async () => {
    await oak(() => TimetableSlot.updateMany({ sectionId: s.sectionA._id }, { $set: { room: 'C-6A' } }));
    const out = await shift(A(), { periods: undefined, kind: 'PERMANENT', toRoom: 'Room 204', reason: 'Bigger class' });
    expect(out.status).toBe('APPLIED');
    expect(String((await oak(() => Facility.findById(R.r204._id).lean())).sectionId)).toBe(String(s.sectionA._id));
    expect((await oak(() => Facility.findById(R.home6A._id).lean())).sectionId).toBeNull();
    expect((await oak(() => TimetableSlot.find({ sectionId: s.sectionA._id }).lean())).map((x) => x.room)).toEqual(['R204', 'R204']);
    expect(await oak(() => SectionRoomChange.countDocuments({ sectionId: s.sectionA._id, via: 'SHIFT' }))).toBe(1);
  });
});

describe('Campus World and the live page during a paper', () => {
  it('the exam room shows the paper, seat count and invigilators to staff; families see counts only', async () => {
    await create(A(), { subjectOfferingIds: [String(s.offerings.sciB._id)], date: today });
    const at = instantOf(today, 11 * 60 + 15);
    const staff = await oak(() => campusMoment({ at, now: at, viewer: { family: false, ownSectionIds: new Set() } }));
    const hall = staff.crowd.find((c) => c.facilityId === String(R.hall._id));
    expect(hall).toMatchObject({ activity: 'EXAM', students: 1, teachers: 1 });
    expect(hall.labels[0]).toBe('Exam in progress: Class 6 B Science, 1 students, invigilators: Free teacher');
    expect(staff.sections.find((x) => x.className === 'Class 6 B')).toMatchObject({ activity: 'EXAM', place: 'Auditorium' });
    const fam = await oak(() => campusMoment({ at, now: at, viewer: { family: true, ownSectionIds: new Set([String(s.sectionA._id)]) } }));
    const famHall = fam.crowd.find((c) => c.facilityId === String(R.hall._id));
    expect(famHall).toMatchObject({ students: null, labels: [] });
    expect(JSON.stringify(fam)).not.toContain('Free teacher');
    const live = await oak(() => liveDetail(A(), { kind: 'room', id: String(R.hall._id), now: at }));
    const exam = live.sections.find((x) => x.key === 'exam');
    expect(exam.title).toBe('Exam in progress: Class 6 B Science');
    expect(exam.rows).toEqual(expect.arrayContaining([{ label: 'Invigilators', value: 'Free teacher' }, { label: 'Students seated', value: '1 of 120' }]));
    // A parent of a 6 B child sees the count for their own class, no invigilators.
    const parent = await oak(() => liveDetail(who('PARENT'), { kind: 'room', id: String(R.hall._id), now: at }));
    const pe = parent.sections.find((x) => x.key === 'exam');
    expect(pe.rows).toEqual(expect.arrayContaining([{ label: 'Your class here', value: '1 students' }]));
    expect(JSON.stringify(parent)).not.toContain('Free teacher');
    // PARENT2 (6 A only) sees nothing of 6 B's paper.
    const other = await oak(() => liveDetail(who('PARENT2'), { kind: 'room', id: String(R.hall._id), now: at }));
    expect(other.sections.find((x) => x.key === 'exam')).toBeUndefined();
  });
});
