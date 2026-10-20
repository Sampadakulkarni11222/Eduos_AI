import { ExamSitting, SectionRoomChange } from '../models/examRoom.model.js';
import { Facility } from '../models/facility.model.js';
import { Section, SubjectOffering } from '../models/academics.model.js';
import { Enrollment, Student, StudentGuardian } from '../models/student.model.js';
import * as halls from '../modules/examRooms/examHalls.service.js';
import * as rooms from '../modules/examRooms/rooms.service.js';
import { loadDay, todayYmd, addDays, TEACHING_KINDS } from '../modules/examRooms/occupancy.js';
import { dowOfYmd } from '../modules/campus/day-plan.js';

/**
 * Sample data for exam halls, Rooms & Classes and room shifts (part 8, fictional):
 *   - the starting home-room allocation of every class as its room history;
 *   - next week's Mathematics and Science papers for the demo student's and the
 *     demo parent's classes, in the auditorium and the classes' rooms, seated by
 *     roll number with free invigilators (the demo teacher among them where free);
 *   - a class test the demo teacher scheduled in a free room;
 *   - a room shift applied today for the demo student's class (painting), and a
 *     teacher's request waiting for the administrator.
 * Written through the services the screens use, so every clash check applies.
 */
const nextWeekday = (from, dow) => { let d = addDays(from, 1); while (dowOfYmd(d) !== dow) d = addDays(d, 1); return d; };

export async function seedP8ExamRooms({ section, attempt, who }) {
  const { ADMIN, PRINCIPAL, TEACHER, STUDENT, PARENT } = who;
  await section('Exam halls and room shifts', ExamSitting, async () => {
    const notes = [];
    // Room history: the starting allocation.
    const homes = await Facility.find({ sectionId: { $ne: null } }).select('_id sectionId').lean();
    if (!(await SectionRoomChange.exists({}))) {
      await SectionRoomChange.insertMany(homes.map((h) => ({ sectionId: h.sectionId, facilityId: h._id, reason: 'Allocation for the year (sample)', via: 'ASSIGN', changedByProfileId: ADMIN.actor.profileId, changedByName: ADMIN.actor.displayName, at: new Date(`${todayYmd().slice(0, 4)}-04-01T04:00:00Z`) })));
    }
    notes.push(`${homes.length} home rooms`);

    // Whose classes: the demo student's and the demo parent's children's.
    const kidIds = [];
    if (STUDENT) { const st = await Student.findOne({ profileId: STUDENT.actor.profileId }).select('_id').lean(); if (st) kidIds.push(st._id); }
    if (PARENT) for (const l of await StudentGuardian.find({ guardianProfileId: PARENT.actor.profileId }).select('studentId').lean()) kidIds.push(l.studentId);
    const kidSections = (await Enrollment.find({ studentId: { $in: kidIds }, status: 'ACTIVE' }).select('sectionId').lean()).map((e) => String(e.sectionId));
    const sections = await Section.find({}).populate('gradeId', 'name level').lean();
    const grades = [...new Set(sections.filter((s) => kidSections.includes(String(s._id))).map((s) => String(s.gradeId?._id)))].slice(0, 2);
    const facilities = await Facility.find({ kind: { $in: TEACHING_KINDS }, restricted: { $ne: true }, status: 'ACTIVE' }).lean();
    const hall = facilities.find((f) => f.kind === 'AUDITORIUM') ?? facilities.find((f) => f.kind === 'LECTURE_HALL') ?? null;
    const monday = nextWeekday(todayYmd(), 1);
    const used = new Set();
    let papers = 0;
    for (const [g, gradeId] of grades.entries()) {
      const secs = sections.filter((s) => String(s.gradeId?._id) === gradeId);
      for (const [k, subject] of [/math/i, /science/i].entries()) {
        const date = addDays(monday, g * 2 + k);
        const offerings = await SubjectOffering.find({ sectionId: { $in: secs.map((s) => s._id) } }).populate('subjectId', 'name').lean();
        // One paper per class: the first matching subject in each section.
        const mine = offerings.filter((o) => subject.test(o.subjectId?.name ?? '')).filter((o, i, all) => all.findIndex((x) => String(x.sectionId) === String(o.sectionId)) === i);
        if (!mine.length) continue;
        const strength = await Enrollment.countDocuments({ sectionId: { $in: mine.map((o) => o.sectionId) }, status: 'ACTIVE' });
        const homeRooms = mine.map((o) => facilities.find((f) => String(f.sectionId) === String(o.sectionId))).filter(Boolean);
        const venueRooms = [...(hall ? [hall] : []), ...homeRooms.filter((f) => String(f._id) !== String(hall?._id))];
        // More classrooms until every candidate has a seat (rooms without a recorded size count as 40).
        for (const f of facilities) {
          if (venueRooms.reduce((n, x) => n + (x.capacity ?? 40), 0) >= strength) break;
          if (f.kind === 'CLASSROOM' && !venueRooms.some((x) => String(x._id) === String(f._id))) venueRooms.push(f);
        }
        if (!venueRooms.length) continue;
        // Seats: each room's own capacity, or (where none is recorded) enough for the class.
        const per = 40;
        const startTime = '10:15';
        const endTime = '11:45';
        const options = await halls.invigilatorOptions(PRINCIPAL.actor, { date, startTime, endTime, sectionIds: mine.map((o) => String(o.sectionId)) }).catch(() => []);
        const free = options.filter((o) => o.free && !used.has(`${date}|${o.id}`));
        const pick = () => {
          const i = free.findIndex((o) => o.id === TEACHER?.actor.profileId);
          const [o] = free.splice(i >= 0 ? i : 0, 1);
          if (o) used.add(`${date}|${o.id}`);
          return o ? [o.id] : [];
        };
        const venues = venueRooms.map((f) => ({ facilityId: String(f._id), capacity: f.capacity ?? per, invigilatorProfileIds: pick() }));
        const label = mine[0].subjectId?.name ?? 'Paper';
        const out = await attempt(`${label} paper ${date}`, () => halls.createSitting(PRINCIPAL.actor, {
          kind: 'TERM', title: `Unit Test 2 · ${label} (sample)`, subjectOfferingIds: mine.map((o) => String(o._id)), date, startTime, endTime, venues,
          seatingMode: mine.length > 1 ? 'ALTERNATE' : 'ROLL', notes: 'Sample paper: rooms, seating and invigilators are fictional.',
        }));
        if (out) papers += 1;
      }
    }
    notes.push(`${papers} papers next week`);

    // The demo teacher's class test in a free room.
    if (TEACHER) {
      const off = await SubjectOffering.findOne({ teacherId: TEACHER.actor.profileId }).populate('subjectId', 'name').lean();
      if (off) {
        const date = addDays(monday, 4);
        let done = null;
        for (const [startTime, endTime] of [['13:15', '13:55'], ['14:15', '14:55'], ['12:30', '13:10'], ['15:00', '15:40']]) {
          // eslint-disable-next-line no-await-in-loop -- first free time wins
          done = await halls.createSitting(TEACHER.actor, { kind: 'CLASS_TEST', title: `${off.subjectId?.name ?? 'Class'} class test (sample)`, subjectOfferingIds: [String(off._id)], date, startTime, endTime }).catch(() => null);
          if (done) break;
        }
        if (done) notes.push('a class test');
      }
    }

    // Today's room shift for the demo student's class, and a teacher's request waiting.
    const today = todayYmd();
    const day = await loadDay(today);
    const target = kidSections[0] ?? null;
    const lesson = target ? day.lessons.filter((l) => l.sectionId === target).sort((a, b) => a.start - b.start)[2] ?? day.lessons.find((l) => l.sectionId === target) : null;
    if (lesson) {
      const lab = facilities.find((f) => f.kind === 'LAB') ?? facilities.find((f) => String(f._id) !== lesson.facilityId);
      const body = { sectionId: target, toFacilityId: String(lab._id), date: today, periods: [lesson.periodNo], reason: 'Painting in the home room (sample)' };
      const check = await rooms.checkShift(ADMIN.actor, body).catch(() => null);
      const to = check && !check.conflicts.length ? lab._id : check?.suggestions?.[0]?.id;
      if (to) { const s = await attempt('room shift today', () => rooms.createShift(ADMIN.actor, { ...body, toFacilityId: String(to) })); if (s) notes.push(`shift ${s.refNo} today`); }
    }
    if (TEACHER) {
      for (let i = 1; i <= 6; i++) {
        const d = addDays(today, i);
        // eslint-disable-next-line no-await-in-loop -- a few days at most
        const dd = await loadDay(d);
        const l = dd.lessons.find((x) => x.teacherId === TEACHER.actor.profileId);
        if (!l) continue;
        // eslint-disable-next-line no-await-in-loop
        const free = await rooms.freeRooms(ADMIN.actor, { date: d, sectionId: l.sectionId, periods: [l.periodNo] }).catch(() => null);
        if (!free?.rooms?.length) continue;
        // eslint-disable-next-line no-await-in-loop
        const r = await attempt('teacher request', () => rooms.createShift(TEACHER.actor, { sectionId: l.sectionId, toFacilityId: free.rooms[0].id, date: d, periods: [l.periodNo], reason: 'Projector needed for a video lesson (sample)' }));
        if (r) { notes.push(`a ${r.status.toLowerCase()} teacher request`); break; }
      }
    }
    return notes.join(', ');
  });
}
