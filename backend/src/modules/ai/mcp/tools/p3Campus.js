import { campusMoment, momentFromQuery, shiftOfSection } from '../../../campus/moment.service.js';
import * as creds from '../../../staff/credentials.service.js';
import { ownStudentIds } from '../../../safety/shared.js';
import { Enrollment } from '../../../../models/student.model.js';
import { AppError } from '../../../../utils/AppError.js';
import { ok } from '../protocol.js';
import { RISK } from './_shared.js';

/**
 * Campus World, shifts and teacher profiles, through the assistant. Read-only:
 *
 *   get_campus_moment          "what's happening on campus at 1:30 pm on Friday?" — the day plan
 *                              (holiday or open, each shift's bell, where each class is, buses);
 *                              staff may name any date and time, families get now, with numbers
 *                              for their own child's class only (as on the map).
 *   get_section_shift          "which shift is 7B in?" — the class's shift and its bell schedule.
 *   get_teacher_qualifications "Ms Rao's qualifications" — staff see a colleague's record; parents
 *                              and students only what that teacher agreed to show families, and
 *                              only for their own child's teachers.
 *
 * Every tool calls the service the screens call, with the caller's own actor.
 */

const FAMILY = new Set(['PARENT', 'STUDENT', 'ALUMNUS']);
const text = (max, description) => ({ type: 'string', maxLength: max, ...(description && { description }) });
const closed = (properties, required = []) => ({ type: 'object', properties, ...(required.length && { required }), additionalProperties: false });
const HM = '^([01]\\d|2[0-3]):[0-5]\\d$';
const DATE = '^\\d{4}-\\d{2}-\\d{2}$';

async function ownSections(actor) {
  const out = new Set();
  if (actor.roleKey !== 'PARENT' && actor.roleKey !== 'STUDENT') return out;
  const kids = await ownStudentIds(actor);
  if (kids.length) for (const e of await Enrollment.find({ studentId: { $in: kids }, status: 'ACTIVE' }).select('sectionId').lean()) out.add(String(e.sectionId));
  return out;
}

export const campusTools = {
  get_campus_moment: {
    module: 'Campus', operation: 'GET', risk: RISK.LOW, resultShape: 'DETAIL',
    description: "What is happening on campus at a moment: whether the school is open (holiday, weekly off, vacation, closure, exam-only day), each shift's bell (arrival, assembly, period N of M and minutes left, break, lunch, dispersal, clubs), which classes are in which rooms or out on the ground or in the canteen, buses arriving/parked/departing, and when the school next opens. Staff may give any date (YYYY-MM-DD) and time (HH:MM, school time); parents and students get now, with numbers for their own child's class only. Read-only; nobody is located.",
    inputSchema: closed({
      date: { type: 'string', pattern: DATE, description: 'A date, e.g. "2026-10-16". Staff only; default today.' },
      time: { type: 'string', pattern: HM, description: 'A school time, e.g. "13:30". Staff only; default now.' },
    }),
    permission: 'campus.map.read',
    service: 'campus/moment.service.campusMoment()',
    async run(ctx, args) {
      const family = FAMILY.has(ctx.actor.roleKey);
      const at = family ? null : momentFromQuery({ date: args.date ?? null, at: args.time ?? null });
      if (!family && (args.date || args.time) && !at) throw new AppError('That date is too far from today (within 120 days, please).', 400);
      const m = await campusMoment({ at: at ?? new Date(), viewer: { family, ownSectionIds: await ownSections(ctx.actor) } });
      const classes = m.sections.filter((s) => s.activity).map((s) => ({ class: s.className, shift: s.shift?.name ?? null, doing: s.activity.toLowerCase(), where: s.place, subject: s.subject, teacher: s.teacher, students: s.students }));
      return ok({
        date: m.date, time: m.time, day: m.day, banner: m.banner.text, detail: m.banner.sub, nextOpen: m.nextOpen?.label ?? null,
        shifts: m.shifts.map((s) => ({ shift: s.name, now: s.label })), classes, buses: m.buses.label, onCampus: m.totals?.onCampus ?? null,
        ...(family ? { note: 'Shown for your own child\'s class; other classes are not shared.' } : {}),
      }, { speak: `${m.date} ${m.time}: ${m.banner.text}${m.banner.sub ? ` (${m.banner.sub})` : ''}.${classes.length ? ` ${classes.length} class${classes.length === 1 ? '' : 'es'} on campus.` : ''}` });
    },
  },

  get_section_shift: {
    // Filed with the classes: it answers a question about one class.
    module: 'Academics', operation: 'GET', risk: RISK.LOW, resultShape: 'DETAIL',
    description: 'Which shift a class is in (e.g. "7B", "Class 7 B"), with that shift\'s days and bell schedule (arrival, assembly, periods, breaks, lunch, dispersal). Parents and students may ask about their own child\'s class. Read-only.',
    inputSchema: closed({ className: text(40, 'The class, e.g. "7B" or "Class 7 B"') }, ['className']),
    permission: 'timetable.read',
    service: 'campus/moment.service.shiftOfSection()',
    async run(ctx, args) {
      const out = await shiftOfSection(args.className);
      if (!out) throw new AppError(`I could not find the class "${args.className}".`, 404, [], 'NOT_FOUND');
      if (FAMILY.has(ctx.actor.roleKey) && !(await ownSections(ctx.actor)).has(out.sectionId)) {
        throw new AppError('You can ask about your own child\'s class only.', 403, [], 'FORBIDDEN');
      }
      const bells = (out.shift?.bells ?? []).map((b) => `${b.start}-${b.end} ${b.kind === 'PERIOD' ? `period ${b.periodNo}` : (b.label ?? b.kind.toLowerCase())}`);
      return ok({ class: out.className, shift: out.shift ? { name: out.shift.name, code: out.shift.code, days: out.shift.daysOfWeek, bells } : null, note: out.note }, {
        speak: out.shift ? `${out.className} is in the ${out.shift.name} (${bells[0]?.split(' ')[0] ?? ''} onwards).` : `${out.className} is not assigned to a shift.`,
      });
    },
  },

  get_teacher_qualifications: {
    module: 'Staff profiles', operation: 'GET', risk: RISK.LOW, resultShape: 'DETAIL',
    description: "A teacher's professional profile: qualifications (degree, institution, year), subjects and specialisations, years of experience, certifications (e.g. CTET) and short bio. Staff see a colleague's record; parents and students see only what the teacher has agreed to show families, and only for teachers of their own child's class. Read-only.",
    inputSchema: closed({ teacherName: text(80, 'The teacher, e.g. "Sunita Rao"') }, ['teacherName']),
    permission: 'campus.map.read',
    service: 'staff/credentials.service.read()',
    async run(ctx, args) {
      const name = String(args.teacherName ?? '').replace(/^\s*(?:mr|mrs|ms|miss|dr|sir|madam)\.?\s+/i, '');
      const found = await creds.byName(ctx.actor, name);
      if (!found.profile) return ok({ matches: found.matches, note: found.note }, { speak: found.note });
      const p = found.profile;
      const parts = [
        p.qualifications?.length ? `qualifications: ${p.qualifications.map((q) => [q.degree, q.institution, q.year].filter(Boolean).join(', ')).join('; ')}` : null,
        p.experienceYears !== undefined && p.experienceYears !== null ? `${p.experienceYears} years' experience` : null,
        p.certifications?.length ? `certifications: ${p.certifications.map((c) => c.name).join(', ')}` : null,
      ].filter(Boolean);
      const familyNote = FAMILY.has(ctx.actor.roleKey) ? ' Only what the teacher chose to share with families is shown.' : '';
      const view = { name: p.name, qualifications: p.qualifications ?? null, subjects: p.subjects ?? null, specialisations: p.specialisations ?? null, experienceYears: p.experienceYears ?? null, certifications: p.certifications ?? null, bio: p.bio ?? null, teaches: p.teaches ?? null };
      return ok(view, { speak: parts.length ? `${p.name}: ${parts.join('; ')}.${familyNote}` : `${p.name} has not shared a professional profile${FAMILY.has(ctx.actor.roleKey) ? ' with families' : ' yet'}.` });
    },
  },
};
