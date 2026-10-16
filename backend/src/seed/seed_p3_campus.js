import { Section, Subject, SubjectOffering } from '../models/academics.model.js';
import { TimetableSlot } from '../models/timetableSlot.model.js';
import { CalendarEvent } from '../models/calendarEvent.model.js';
import { Facility } from '../models/facility.model.js';
import { SchoolShift } from '../models/schoolShift.model.js';
import { StaffCredential } from '../models/staffCredential.model.js';
import { Enrollment } from '../models/student.model.js';

/**
 * Campus World sample data (all fictional): two shifts with their own bell
 * schedules (a primary morning shift ending after period 5 and a secondary
 * day shift with clubs after school), every period of every class given its
 * room, a games period per class on the playground, calendar days that close
 * the school or make it exam-only in the coming weeks, and teachers'
 * professional profiles (some shared with families, most not).
 */

const DAY = 86_400_000;
/** The school's local date n days from now, as the calendar stores a date-only day (UTC midnight). */
const localDay = (n) => {
  const t = new Date(Date.now() + 330 * 60_000 + n * DAY);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
};
/** The first weekday (Mon–Fri) on or after n days from now. */
const weekdayFrom = (n) => { let d = localDay(n); while ([0, 6].includes(d.getUTCDay())) d = new Date(d.getTime() + DAY); return d; };

const PRIMARY_BELLS = [
  { kind: 'ARRIVAL', label: 'Arrival', start: '07:45', end: '08:05' },
  { kind: 'ASSEMBLY', label: 'Morning assembly', start: '08:05', end: '08:25' },
  { kind: 'PERIOD', periodNo: 1, start: '08:30', end: '09:15' },
  { kind: 'PERIOD', periodNo: 2, start: '09:15', end: '10:00' },
  { kind: 'BREAK', label: 'Short break', start: '10:00', end: '10:15' },
  { kind: 'PERIOD', periodNo: 3, start: '10:15', end: '11:00' },
  { kind: 'PERIOD', periodNo: 4, start: '11:00', end: '11:45' },
  { kind: 'LUNCH', label: 'Lunch', start: '11:45', end: '12:30' },
  { kind: 'PERIOD', periodNo: 5, start: '12:30', end: '13:15' },
  { kind: 'DISPERSAL', label: 'Home time (primary buses)', start: '13:15', end: '13:35' },
];
const SECONDARY_BELLS = [
  { kind: 'ARRIVAL', label: 'Arrival', start: '08:00', end: '08:25' },
  { kind: 'PERIOD', periodNo: 1, start: '08:30', end: '09:15' },
  { kind: 'PERIOD', periodNo: 2, start: '09:15', end: '10:00' },
  { kind: 'BREAK', label: 'Short break', start: '10:00', end: '10:15' },
  { kind: 'PERIOD', periodNo: 3, start: '10:15', end: '11:00' },
  { kind: 'PERIOD', periodNo: 4, start: '11:00', end: '11:45' },
  { kind: 'LUNCH', label: 'Lunch', start: '11:45', end: '12:30' },
  { kind: 'PERIOD', periodNo: 5, start: '12:30', end: '13:15' },
  { kind: 'PERIOD', periodNo: 6, start: '13:15', end: '14:00' },
  { kind: 'BREAK', label: 'Afternoon break', start: '14:00', end: '14:15' },
  { kind: 'PERIOD', periodNo: 7, start: '14:15', end: '15:00' },
  { kind: 'PERIOD', periodNo: 8, start: '15:00', end: '15:45' },
  { kind: 'DISPERSAL', label: 'Home time (buses)', start: '15:45', end: '16:05' },
  { kind: 'CLUBS', label: 'After-school clubs', start: '16:15', end: '17:15' },
];

const PROFILES = [
  { match: /Arjun Sharma/, show: ['qualifications', 'subjects', 'experience', 'certifications', 'bio'], q: [['M.Sc. Mathematics', 'Sample State University', 2010], ['B.Ed.', 'Sample College of Education', 2012]], subjects: ['Mathematics'], spec: ['Algebra', 'Olympiad coaching'], years: 13, certs: [['CTET (Paper II)', 'CBSE', 2013]], bio: 'Teaches maths through puzzles and real-life problems; runs the school maths club.' },
  { match: /Priya Patel/, show: ['qualifications', 'experience', 'bio'], q: [['M.Sc. Biology', 'Sample University', 2014], ['B.Ed.', 'Sample Institute of Education', 2015]], subjects: ['Science'], spec: ['Life science'], years: 9, certs: [['CTET (Paper II)', 'CBSE', 2016]], bio: 'Believes every lesson should end with a question the class wants to answer.' },
  { match: /Amit Joshi/, show: ['subjects', 'certifications'], q: [['M.A. English', 'Sample University', 2011]], subjects: ['English'], spec: ['Creative writing', 'Debate'], years: 12, certs: [['CTET (Paper II)', 'CBSE', 2012], ['Cambridge TKT', 'Sample Board', 2018]], bio: 'Coaches the debate team.' },
  { match: /Sunita Rao/, show: [], q: [['M.A. History', 'Sample University', 2006], ['B.Ed.', 'Sample College', 2007]], subjects: ['History', 'Social Science'], spec: ['Local history projects'], years: 18, certs: [], bio: 'Leads heritage walks for the senior classes.' },
  { match: /Rajesh Kumar/, show: ['experience'], q: [['M.A. Geography', 'Sample University', 2009]], subjects: ['Geography'], spec: ['Map work'], years: 14, certs: [['CTET (Paper II)', 'CBSE', 2010]], bio: null },
  { match: /Neha Singh/, show: ['qualifications', 'subjects', 'bio'], q: [['B.Tech. Computer Science', 'Sample Institute of Technology', 2015]], subjects: ['Computer Science'], spec: ['Programming', 'Robotics'], years: 7, certs: [['Sample Certified Educator', 'Sample Tech Foundation', 2021]], bio: 'Runs the robotics club on Thursdays.' },
  { match: /Meera Iyer/, show: [], q: [['M.Sc. Mathematics', 'Sample University', 2016]], subjects: ['Mathematics'], spec: ['Statistics'], years: 6, certs: [['CTET (Paper II)', 'CBSE', 2017]], bio: null },
];

export async function seedP3Campus({ section, attempt, who, teachers = [] }) {
  const { ADMIN } = who;

  // Every period has its room: the class's home room unless it is somewhere else (a lab).
  await section('Rooms on every period (Campus World)', null, async () => {
    const homes = await Facility.find({ sectionId: { $ne: null } }).select('sectionId code').lean();
    let n = 0;
    for (const h of homes) {
      // eslint-disable-next-line no-await-in-loop
      const r = await TimetableSlot.updateMany({ sectionId: h.sectionId, $or: [{ room: null }, { room: '' }] }, { $set: { room: h.code } });
      n += r.modifiedCount ?? 0;
    }
    return `${n} periods given their home room`;
  });

  // A games period a week for each class, on the playground (one per day and period, so the coach is never in two places).
  await section('Games periods (sample)', null, async () => {
    const pe = await Subject.findOne({ name: 'Physical Education' }) ?? await Subject.create({ name: 'Physical Education', code: 'PE' });
    if (await SubjectOffering.exists({ subjectId: pe._id })) return 'kept';
    const sections = await Section.find({}).sort({ _id: 1 }).lean();
    let n = 0;
    for (const [i, sec] of sections.entries()) {
      // eslint-disable-next-line no-await-in-loop
      const any = await SubjectOffering.findOne({ sectionId: sec._id }).select('termId').lean();
      if (!any) continue;
      // eslint-disable-next-line no-await-in-loop
      const off = await SubjectOffering.create({ sectionId: sec._id, subjectId: pe._id, termId: any.termId, teacherId: null });
      // eslint-disable-next-line no-await-in-loop
      const r = await TimetableSlot.updateOne({ sectionId: sec._id, dayOfWeek: (i % 5) + 1, periodNo: 3 + Math.floor(i / 5) }, { $set: { subjectOfferingId: off._id, room: 'GRD-1' } });
      n += r.modifiedCount ?? 0;
    }
    return `${n} games periods on the playground (visiting coach)`;
  });

  await section('Shifts and bell schedules', SchoolShift, async () => {
    const shifts = await import('../modules/shifts/shifts.service.js');
    const sections = await Section.find({}).populate('gradeId', 'name level').lean();
    const primary = sections.filter((s) => /\b5\b/.test(s.gradeId?.name ?? ''));
    const secondary = sections.filter((s) => !primary.includes(s));
    // The primary day ends after period 5.
    if (primary.length) await TimetableSlot.deleteMany({ sectionId: { $in: primary.map((s) => s._id) }, periodNo: { $gt: 5 } });
    const made = [];
    if (primary.length) made.push(await shifts.create(ADMIN.actor, { code: 'PRIMARY', name: 'Primary morning shift', color: '#2BA39A', daysOfWeek: [1, 2, 3, 4, 5, 6], bells: PRIMARY_BELLS, sectionIds: primary.map((s) => String(s._id)), note: 'Classes up to 5: assembly on the playground, home by 1:35 pm.' }));
    made.push(await shifts.create(ADMIN.actor, { code: 'SECONDARY', name: 'Secondary day shift', color: '#4F86E8', daysOfWeek: [1, 2, 3, 4, 5, 6], bells: SECONDARY_BELLS, sectionIds: secondary.map((s) => String(s._id)), note: 'Classes 6 and above: eight periods, clubs after school.' }));
    return made.map((s) => `${s.name}: ${s.sections.length} classes, ${s.startsAt}-${s.endsAt}`).join('; ');
  });

  await section('Calendar: holidays, closures and an exam-only day (sample)', null, async () => {
    if (await CalendarEvent.exists({ title: /\(sample\)$/, type: { $in: ['CLOSURE', 'EXAM_ONLY', 'VACATION'] } })) return 'kept';
    const holiday = weekdayFrom(5);
    const examDay = weekdayFrom(9);
    const closure = weekdayFrom(13);
    const y = localDay(0).getUTCFullYear();
    const winterStart = new Date(Date.UTC(y, 11, 24));
    await CalendarEvent.insertMany([
      { title: 'Dussehra holiday (sample)', description: 'School closed for the festival.', type: 'HOLIDAY', startsAt: holiday, endsAt: holiday, audience: { all: true } },
      { title: 'Unit Test 3: exam-only day (sample)', description: 'Only classes with a paper come in; no regular lessons.', type: 'EXAM_ONLY', startsAt: examDay, endsAt: examDay, audience: { all: true } },
      { title: 'Staff training day: school closed for students (sample)', description: 'No classes; staff training on campus.', type: 'CLOSURE', startsAt: closure, endsAt: closure, audience: { all: true } },
      { title: 'Inter-house football final (sample)', description: 'On the playground after school.', type: 'SPORTS', startsAt: weekdayFrom(3), endsAt: weekdayFrom(3), audience: { all: true } },
      { title: 'Winter vacation (sample)', description: 'School closed for the winter break.', type: 'VACATION', startsAt: winterStart, endsAt: new Date(winterStart.getTime() + 8 * DAY), audience: { all: true } },
    ]);
    return `holiday ${holiday.toISOString().slice(0, 10)}, exam-only day ${examDay.toISOString().slice(0, 10)}, closure ${closure.toISOString().slice(0, 10)}, winter vacation`;
  });

  await section("Teachers' professional profiles (sample)", StaffCredential, async () => {
    let n = 0; let shared = 0;
    for (const p of PROFILES) {
      const t = teachers.find((x) => p.match.test(x.displayName));
      if (!t) continue;
      // eslint-disable-next-line no-await-in-loop
      await attempt(`profile for ${t.displayName}`, () => StaffCredential.create({
        profileId: t._id,
        qualifications: p.q.map(([degree, institution, year]) => ({ degree, institution, year })),
        subjects: p.subjects, specialisations: p.spec, experienceYears: p.years,
        certifications: p.certs.map(([name, issuer, year]) => ({ name, issuer, year })),
        bio: p.bio,
        showToFamilies: Object.fromEntries(['qualifications', 'subjects', 'experience', 'certifications', 'bio'].map((k) => [k, p.show.includes(k)])),
      }));
      n += 1;
      if (p.show.length) shared += 1;
    }
    return `${n} profiles; ${shared} share some parts with families (consent on), the rest are staff-only`;
  });

  await section('Campus World check: students in every class', null, async () => {
    const sections = await Section.find({}).select('_id').lean();
    const counts = await Enrollment.aggregate([{ $match: { status: 'ACTIVE' } }, { $group: { _id: '$sectionId', n: { $sum: 1 } } }]);
    const withKids = new Set(counts.map((c) => String(c._id)));
    const empty = sections.filter((s) => !withKids.has(String(s._id))).length;
    const slots = await TimetableSlot.countDocuments({});
    return `${sections.length - empty}/${sections.length} classes have students; ${slots} timetabled periods`;
  });
}
