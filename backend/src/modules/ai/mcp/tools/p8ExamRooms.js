import { AppError } from '../../../../utils/AppError.js';
import { ok, action } from '../protocol.js';
import { RISK } from './_shared.js';
import * as halls from '../../../examRooms/examHalls.service.js';
import * as rooms from '../../../examRooms/rooms.service.js';
import { whenToYmd, clockToHm } from '../../../examRooms/when.js';

/**
 * Part 8: exam halls, Rooms & Classes and room shifts through the assistant.
 *
 *   get_exam_hall              GET     "where is the class 10 maths exam?" (families: their own seat only)
 *   list_exam_timetable        GET     the exam timetable (staff: their classes / the school; families: their own)
 *   get_my_exam_timetable      GET     a student's or parent's own exam timetable with room and seat
 *   list_my_invigilation_duties GET    "my invigilation duties"
 *   create_class_test          CREATE  a teacher schedules a class test in a free room (exam office: any paper)
 *   change_exam_hall           UPDATE  "change the exam hall for class 9 science to the auditorium" (re-seats, tells everyone)
 *   update_exam_hall_status    UPDATE  delay, postpone, cancel, start or finish a paper (tells everyone)
 *   get_section_room           GET     "which room is 7B in today?"
 *   list_rooms_and_classes     GET     each class's home room against its strength, rooms and occupants
 *   list_free_rooms            GET     rooms free at a time (or for a class's periods) that fit
 *   list_room_shifts           GET     room shift requests and applied moves
 *   create_room_shift          CREATE  "move 7B to the science lab for period 3 tomorrow because of painting"
 *                                      (administrator/principal: applied; teacher: a request, or applied under self-shift)
 *   assign_home_room           UPDATE  "assign room 204 to 8A"
 *
 * Every tool calls the service the screens call, with the caller's own actor,
 * so the same scope rules hold (families: own child only). Writes are drafts
 * the same person confirms; the ones that move other people are confirmed on
 * the website (affectsOthers). Deciding a teacher's request stays on the
 * Rooms & Classes screen.
 */

const FAMILY = new Set(['PARENT', 'STUDENT', 'ALUMNUS']);
const text = (max, description) => ({ type: 'string', maxLength: max, ...(description && { description }) });
const closed = (properties, required = []) => ({ type: 'object', properties, ...(required.length && { required }), additionalProperties: false });
const ask = (message) => new AppError(message, 400, [], 'AGENT_NEEDS_INPUT');
const day = (v) => (v ? whenToYmd(v) ?? (() => { throw ask(`I could not read the date "${v}". Say "today", "tomorrow", a weekday or a date like 2026-10-26.`); })() : null);
const clock = (v, label) => (v ? clockToHm(v) ?? (() => { throw ask(`I could not read the ${label} "${v}". Say a time like 9:30 or 2 pm.`); })() : null);
const PERIODS = { type: 'array', maxItems: 10, items: { type: 'integer', minimum: 1, maximum: 20 }, description: 'Periods, e.g. [3]. Leave out for the whole day.' };
const WHEN = text(40, 'The day: "today", "tomorrow", a weekday, or YYYY-MM-DD');
const EXAM_GRANTS = [['exams.schedule'], ['exams.manage', 'ALL']];

const examLine = (x) => `${x.dateLabel} ${x.startsAt}–${x.endsAt} · ${x.title} · ${x.classes.map((c) => c.className).join(', ')} · ${x.venues.map((v) => `${v.room} (${v.seated})`).join(', ') || 'room not set'}${x.status !== 'SCHEDULED' ? ` · ${x.status.toLowerCase().replace('_', ' ')}` : ''}`;

/** The one paper a request names, or a question back. */
async function onePaper(ctx, args) {
  const found = await halls.findSittings(ctx.actor, { className: args.className ?? null, subject: args.subject ?? null, exam: args.exam ?? null, date: day(args.date) });
  if (!found.length) throw new AppError(`I found no ${args.className ? `class ${args.className} ` : ''}${args.subject ?? ''} paper on the exam timetable${args.date ? ` on ${args.date}` : ' from today on'}.`.replace(/\s+/g, ' '), 404, [], 'NOT_FOUND');
  if (found.length > 1) throw ask(`Which paper? ${found.slice(0, 6).map((x, i) => `${i + 1}. ${examLine(x)}`).join('; ')}. Say the class, subject or date.`);
  return found[0];
}

async function familyExams(ctx, args) {
  const mine = await halls.myExams(ctx.actor, {});
  let kids = mine.children;
  if (args.studentName) {
    const want = String(args.studentName).toLowerCase();
    kids = kids.filter((c) => c.name?.toLowerCase().includes(want));
    if (!kids.length) throw new AppError(`${args.studentName} is not one of your children here.`, 403, [], 'FORBIDDEN');
  }
  if (args.subject) {
    const re = new RegExp(`\\b${String(args.subject).trim().slice(0, 4).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    kids = kids.map((c) => ({ ...c, exams: c.exams.filter((e) => re.test(e.subject ?? '') || re.test(e.title)) }));
  }
  return { ...mine, children: kids };
}

const familyLine = (e) => `${e.dateLabel} ${e.startTime}–${e.endTime} · ${e.title} · ${e.room ? `${e.room}, seat ${e.seatNo}` : `rooms: ${(e.rooms ?? []).join(', ') || 'not set yet'}`}${e.status !== 'SCHEDULED' ? ` · ${e.status.toLowerCase().replace('_', ' ')}` : ''}${e.banner ? ` · ${e.banner}` : ''}`;

function speakFamily(out) {
  const parts = out.children.map((c) => (c.exams.length ? `${c.name}: ${c.exams.map(familyLine).join('; ')}` : `${c.name}: no papers on the exam timetable yet`));
  return parts.join('. ') || 'No child is linked to your profile.';
}

export const p8ExamRoomsTools = {
  get_exam_hall: {
    module: 'Exam halls', operation: 'GET', risk: RISK.LOW, resultShape: 'DETAIL',
    description: 'Where and when a paper is sat: its exam hall or rooms, time (with any delay), status, seats used and invigilators. Use for "where is the class 10 maths exam?", "which room is the class 9 science paper in", "exam hall for 8A English". Parents and students get their own child\'s room and seat only. Read-only.',
    inputSchema: closed({ className: text(40, 'The class or grade, e.g. "10" or "10A"'), subject: text(60, 'The subject, e.g. "maths"'), exam: text(60, 'The exam, e.g. "Midterm"'), date: WHEN, studentName: text(80, 'A parent\'s child') }),
    permission: 'timetable.read',
    service: 'examRooms/examHalls.service.findSittings()',
    async run(ctx, args) {
      if (FAMILY.has(ctx.actor.roleKey)) {
        const out = await familyExams(ctx, args);
        return ok(out, { speak: speakFamily(out) });
      }
      const found = await halls.findSittings(ctx.actor, { className: args.className ?? null, subject: args.subject ?? null, exam: args.exam ?? null, date: day(args.date) });
      if (!found.length) return ok({ items: [] }, { speak: `I found no ${args.className ? `class ${args.className} ` : ''}${args.subject ?? ''} paper on the exam timetable from today on.`.replace(/\s+/g, ' ') });
      const items = found.map((x) => ({ title: x.title, classes: x.classes.map((c) => c.className), date: x.date, time: `${x.startsAt}–${x.endsAt}`, status: x.status, rooms: x.venues.map((v) => ({ room: v.room, seated: v.seated, capacity: v.capacity, invigilators: v.invigilators.map((i) => i.name) })), banner: x.banner }));
      return ok({ items }, {
        speak: found.slice(0, 5).map((x) => `${x.title} (${x.classes.map((c) => c.className).join(', ')}): ${x.dateLabel} ${x.startsAt}–${x.endsAt} in ${x.venues.map((v) => `${v.room} (${v.seated} seated; invigilators: ${v.invigilators.map((i) => i.name).join(', ') || 'none yet'})`).join(' and ')}${x.status !== 'SCHEDULED' ? `, ${x.status.toLowerCase().replace('_', ' ')}` : ''}${x.banner ? `. ${x.banner}` : ''}.`).join(' '),
      });
    },
  },

  list_exam_timetable: {
    module: 'Exam halls', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: 'The exam timetable: each paper\'s date, time, classes, exam rooms with seats used, invigilators and status. Staff see the papers of their classes (the exam office: the school); optionally from a date or for a class. Parents and students get their own exam timetable. Use for "show the exam timetable", "exam timetable for class 10", "exams next week". Read-only.',
    inputSchema: closed({ from: WHEN, className: text(40, 'A class, e.g. "10A"') }),
    permission: 'timetable.read',
    service: 'examRooms/examHalls.service.listSittings()',
    async run(ctx, args) {
      if (FAMILY.has(ctx.actor.roleKey)) {
        const out = await familyExams(ctx, {});
        return ok(out, { speak: speakFamily(out) });
      }
      const query = { from: day(args.from) ?? undefined };
      if (args.className) query.sectionId = String((await rooms.resolveSection(args.className))._id);
      const out = await halls.listSittings(ctx.actor, query);
      const upcoming = out.items.filter((x) => x.status !== 'FINISHED');
      if (!upcoming.length) return ok(out, { speak: 'No papers are on the exam timetable for that period.' });
      return ok({ from: out.from, to: out.to, items: upcoming }, {
        speak: `${upcoming.length} paper${upcoming.length === 1 ? '' : 's'}: ${upcoming.slice(0, 12).map(examLine).join('; ')}.`,
        view: { type: 'list.numbered', intro: `**Exam timetable** (${upcoming.length})`, items: upcoming.slice(0, 25).map((x) => ({ label: `${x.dateLabel} ${x.startsAt}–${x.endsAt} · ${x.title}`, detail: `${x.classes.map((c) => c.className).join(', ')} · ${x.venues.map((v) => v.room).join(', ')}` })) },
      });
    },
  },

  get_my_exam_timetable: {
    module: 'Exam halls', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    forRoles: ['PARENT', 'STUDENT'],
    description: 'A student\'s or parent\'s own exam timetable: each paper\'s date, time, room and the child\'s own seat number, with any change announced on the day. A parent with several children may name one. Use for "show my exam timetable", "my exams", "where do I sit for maths", "my child\'s exam schedule". Never shows another pupil\'s seat. Read-only.',
    inputSchema: closed({ studentName: text(80, 'A parent\'s child'), subject: text(60, 'Only this subject') }),
    permission: 'timetable.read',
    service: 'examRooms/examHalls.service.myExams()',
    async run(ctx, args) {
      const out = await familyExams(ctx, args);
      return ok(out, { speak: speakFamily(out) });
    },
  },

  list_my_invigilation_duties: {
    module: 'Exam halls', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: 'The caller\'s own invigilation duties: date, time, paper, room, classes, seats and who else invigilates there. Use for "my invigilation duties", "when am I invigilating", "my exam duty". Read-only.',
    inputSchema: closed({ from: WHEN }),
    permission: 'facilities.read',
    service: 'examRooms/examHalls.service.duties()',
    async run(ctx, args) {
      const out = await halls.duties(ctx.actor, { from: day(args.from) });
      if (!out.items.length) return ok(out, { speak: 'You have no invigilation duties on the exam timetable from today on.' });
      return ok(out, {
        speak: `You invigilate ${out.items.length} paper${out.items.length === 1 ? '' : 's'}: ${out.items.map((d) => `${d.dateLabel} ${d.startTime}–${d.endTime} ${d.title} in ${d.room} (${d.classes.join(', ')}, ${d.seated} seated${d.with.length ? `, with ${d.with.join(', ')}` : ''})`).join('; ')}.`,
        view: { type: 'list.numbered', intro: `**Your invigilation duties** (${out.items.length})`, items: out.items.map((d) => ({ label: `${d.dateLabel} ${d.startTime}–${d.endTime} · ${d.room}`, detail: `${d.title} · ${d.classes.join(', ')}` })) },
      });
    },
  },

  create_class_test: {
    module: 'Exam halls', operation: 'CREATE', risk: RISK.MEDIUM, confirm: true,
    description: 'Schedule a class test (a teacher, for a subject they teach, in a free room; they invigilate) or, for the exam office, any paper: class, subject, day, start and end time, and room (default: the class\'s home room if free). The room and invigilator are checked for clashes and the class is seated by roll number. Use for "schedule a maths class test for 7B tomorrow at 10 to 10:40 in room 204", "create class test". Needs confirmation.',
    inputSchema: closed({ className: text(40, 'The class, e.g. "7B"'), subject: text(60, 'The subject'), date: WHEN, startTime: text(10, 'Start, e.g. "10:00"'), endTime: text(10, 'End, e.g. "10:40"'), room: text(60, 'The room, e.g. "204"'), title: text(120, 'A title, e.g. "Fractions test"') }, ['className', 'subject']),
    permission: 'exams.schedule', anyOf: EXAM_GRANTS,
    service: 'examRooms/examHalls.service.createSitting()',
    async prepare(ctx, args) {
      const date = day(args.date);
      const startTime = clock(args.startTime, 'start time');
      if (!date || !startTime) throw ask('When? Say the day and time, e.g. "tomorrow 10:00 to 10:40".');
      const endTime = clock(args.endTime, 'end time') ?? `${String(Math.floor((Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3)) + 40) / 60)).padStart(2, '0')}:${String((Number(startTime.slice(3)) + 40) % 60).padStart(2, '0')}`;
      const body = { className: args.className, subject: args.subject, kind: 'CLASS_TEST', date, startTime, endTime, ...(args.title ? { title: args.title } : {}), ...(args.room ? { venues: [{ room: args.room }] } : {}) };
      const preview = await halls.createSitting(ctx.actor, body, { dryRun: true });
      return { body, preview };
    },
    summarise: (_a, _actor, p) => `Schedule ${p.preview.title} for ${p.preview.classes.map((c) => c.className).join(', ')} on ${p.preview.dateLabel}, ${p.preview.startsAt}–${p.preview.endsAt}, in ${p.preview.venues.map((v) => v.room).join(', ')} (${p.preview.candidates} pupils seated by roll number; invigilator: ${p.preview.venues.flatMap((v) => v.invigilators.map((i) => i.name)).join(', ') || 'none yet'}).`,
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const out = await halls.createSitting(ctx.actor, p.body);
      return action({ type: 'class_test_scheduled', id: out.id, data: out, speak: `Scheduled: ${out.title} on ${out.dateLabel}, ${out.startsAt}–${out.endsAt} in ${out.venues.map((v) => v.room).join(', ')}. It is on the exam timetable and on My exams for the class.` });
    },
  },

  change_exam_hall: {
    module: 'Exam halls', operation: 'UPDATE', risk: RISK.MEDIUM, confirm: true, affectsOthers: true,
    description: 'Move a paper to another exam hall or room (or replace one of its rooms): the room is checked for clashes, the candidates are re-seated, and the students, their parents and the invigilators are told, with a banner on the day. Use for "change the exam hall for class 9 science to the auditorium", "move the class 10 maths exam to room 204". Needs confirmation on the website.',
    inputSchema: closed({ className: text(40, 'The class or grade'), subject: text(60, 'The subject'), exam: text(60, 'The exam name'), date: WHEN, toRoom: text(60, 'The new room or hall, e.g. "auditorium"'), fromRoom: text(60, 'Only this one of its rooms'), reason: text(200, 'Why (told to families)') }, ['toRoom']),
    permission: 'exams.schedule', anyOf: EXAM_GRANTS,
    service: 'examRooms/examHalls.service.changeVenue()',
    async prepare(ctx, args) {
      const paper = await onePaper(ctx, args);
      const opts = { toRoom: args.toRoom, fromFacilityId: args.fromRoom ? String((await rooms.resolveFacility(args.fromRoom))._id) : null, reason: args.reason ?? null };
      const preview = await halls.changeVenue(ctx.actor, paper.id, opts, { dryRun: true });
      return { id: paper.id, opts, preview };
    },
    summarise: (_a, _actor, p) => `Move ${p.preview.title} (${p.preview.classes.map((c) => c.className).join(', ')}, ${p.preview.dateLabel} ${p.preview.startsAt}–${p.preview.endsAt}) from ${p.preview.from} to ${p.preview.to}; ${p.preview.candidates} candidates re-seated${p.opts.reason ? ` (${p.opts.reason})` : ''}. The students, their parents and the invigilators are told.`,
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const out = await halls.changeVenue(ctx.actor, p.id, p.opts);
      return action({ type: 'exam_hall_changed', id: out.id, data: out, speak: `Done: ${out.title} is now in ${out.venues.map((v) => v.room).join(' and ')}.${out.notified ? ` Told ${out.notified.students} students, ${out.notified.guardians} parents and ${out.notified.invigilators} invigilators.` : ''}` });
    },
  },

  update_exam_hall_status: {
    module: 'Exam halls', operation: 'UPDATE', risk: RISK.MEDIUM, confirm: true, affectsOthers: true,
    description: 'Change a paper on the day: delay it by some minutes, postpone it (optionally to a new date), cancel it, or mark it started or finished. Delays are checked for room and invigilator clashes; students, parents and invigilators are told. Use for "delay the class 10 maths exam by 30 minutes", "postpone the class 9 science paper to Monday because of rain". Needs confirmation on the website.',
    inputSchema: closed({
      className: text(40, 'The class or grade'), subject: text(60, 'The subject'), exam: text(60, 'The exam name'), date: WHEN,
      change: { type: 'string', enum: ['DELAY', 'POSTPONE', 'CANCEL', 'START', 'FINISH', 'RESUME'], description: 'What to do' },
      delayMinutes: { type: 'integer', minimum: 0, maximum: 600 }, newDate: WHEN, reason: text(200, 'Why (told to families)'),
    }, ['change']),
    permission: 'exams.schedule', anyOf: EXAM_GRANTS,
    service: 'examRooms/examHalls.service.setStatus()',
    async prepare(ctx, args) {
      const paper = await onePaper(ctx, args);
      if (args.change === 'DELAY' && !Number.isInteger(args.delayMinutes)) throw ask('By how many minutes?');
      if (['POSTPONE', 'CANCEL'].includes(args.change) && !args.reason) throw ask('What reason should the families be given?');
      return { id: paper.id, paper, newDate: day(args.newDate) };
    },
    summarise: (a, _actor, p) => {
      const what = { DELAY: `Delay by ${a.delayMinutes} minutes`, POSTPONE: `Postpone${p.newDate ? ` to ${p.newDate}` : ''}`, CANCEL: 'Cancel', START: 'Mark as started', FINISH: 'Mark as finished', RESUME: 'Put back on' }[a.change];
      return `${what}: ${p.paper.title} (${p.paper.classes.map((c) => c.className).join(', ')}, ${p.paper.dateLabel} ${p.paper.startsAt}–${p.paper.endsAt})${a.reason ? `, because ${a.reason}` : ''}.${['DELAY', 'POSTPONE', 'CANCEL', 'RESUME'].includes(a.change) ? ' Students, parents and invigilators are told.' : ''}`;
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const out = args.change === 'DELAY'
        ? await halls.delaySitting(ctx.actor, p.id, { minutes: args.delayMinutes, reason: args.reason })
        : await halls.setStatus(ctx.actor, p.id, { status: { POSTPONE: p.newDate ? 'SCHEDULED' : 'POSTPONED', CANCEL: 'CANCELLED', START: 'IN_PROGRESS', FINISH: 'FINISHED', RESUME: 'SCHEDULED' }[args.change], reason: args.reason, newDate: p.newDate });
      return action({ type: 'exam_status_changed', id: out.id, data: out, speak: `Done: ${out.title} is ${out.status.toLowerCase().replace('_', ' ')}${out.delayMinutes ? `, starting ${out.startsAt}` : ''}${out.date !== p.paper.date ? ` on ${out.dateLabel}` : ''}.` });
    },
  },

  get_section_room: {
    module: 'Room allocation', operation: 'GET', risk: RISK.LOW, resultShape: 'DETAIL',
    description: 'Which room a class is in on a day: each period with its room (a room shift shows the room it moved to and why), its home room, and any paper it sits. Use for "which room is 7B in today?", "where is class 8A now", "7B room tomorrow". Parents and students may ask about their own child\'s class. Read-only.',
    inputSchema: closed({ className: text(40, 'The class, e.g. "7B"'), date: WHEN }, ['className']),
    permission: 'timetable.read',
    service: 'examRooms/rooms.service.sectionRoomOn()',
    async run(ctx, args) {
      const out = await rooms.sectionRoomOn(ctx.actor, { className: args.className, date: day(args.date) });
      const where = out.now ? `Now (period ${out.now.periodNo}): ${out.now.room ?? 'room not set'}${out.now.moved ? ` (moved: ${out.now.moved.reason})` : ''}. ` : '';
      const moved = out.periods.filter((p) => p.moved);
      return ok(out, {
        speak: `${out.className} on ${rooms.shortDate(out.date)}: ${where}Home room ${out.homeRoom?.name ?? 'not set'}.${moved.length ? ` Moved: ${moved.map((p) => `period ${p.periodNo} in ${p.room} (${p.moved.reason})`).join('; ')}.` : out.periods.length ? ' No room changes.' : ' No lessons that day.'}${out.exams.length ? ` Exams: ${out.exams.map((e) => `${e.title} ${e.startTime}–${e.endTime} in ${e.rooms.join(', ')}`).join('; ')}.` : ''}`,
      });
    },
  },

  list_rooms_and_classes: {
    module: 'Room allocation', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: 'Rooms & Classes: each class\'s home room against its strength (over capacity flagged), classes without a room, free classrooms, each room\'s occupant, and today\'s room shifts. Use for "show rooms and classes", "home rooms", "which classes have no room", "free classrooms". Read-only.',
    inputSchema: closed({ date: WHEN }),
    permission: 'timetable.read',
    service: 'examRooms/rooms.service.roomsAndClasses()',
    async run(ctx, args) {
      const out = await rooms.roomsAndClasses(ctx.actor, { date: day(args.date) });
      const t = out.totals;
      return ok(out, {
        speak: `${t.classes} classes: ${out.sections.slice(0, 30).map((x) => `${x.className} in ${x.homeRoom?.name ?? 'no room'}${x.fits === false ? ` (over capacity: ${x.strength}/${x.homeRoom.capacity})` : ''}${x.shiftedToday.length ? ' (moved today)' : ''}`).join('; ')}.${FAMILY.has(ctx.actor.roleKey) ? '' : ` ${t.withoutRoom} without a room, ${t.overCapacity} over capacity, ${t.freeRooms} free classrooms, ${t.shiftedToday} shifts today${t.pendingRequests ? `, ${t.pendingRequests} requests waiting` : ''}.`}`,
      });
    },
  },

  list_free_rooms: {
    module: 'Room allocation', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: 'Rooms free on a day for a time window, or for a class\'s periods (big enough for the class): no lesson, paper, booking or maintenance then. Use for "free rooms for 7B period 3 tomorrow", "which rooms are free at 11 today", "empty classrooms now". Read-only.',
    inputSchema: closed({ date: WHEN, startTime: text(10, 'From, e.g. "11:00"'), endTime: text(10, 'To'), className: text(40, 'A class (its size and periods)'), periods: PERIODS, minCapacity: { type: 'integer', minimum: 1, maximum: 2000 } }),
    permission: 'timetable.read',
    service: 'examRooms/rooms.service.freeRooms()',
    async run(ctx, args) {
      const startTime = clock(args.startTime, 'start time');
      const endTime = clock(args.endTime, 'end time') ?? (startTime ? `${String(Math.min(23, Number(startTime.slice(0, 2)) + 1)).padStart(2, '0')}:${startTime.slice(3)}` : null);
      const out = await rooms.freeRooms(ctx.actor, { date: day(args.date), startTime, endTime, className: args.className ?? null, periods: args.periods ?? null, minCapacity: args.minCapacity ?? null });
      return ok(out, { speak: out.rooms.length ? `Free on ${rooms.shortDate(out.date)} (${out.windows.join(', ')}${out.minCapacity ? `, for ${out.minCapacity}` : ''}): ${out.rooms.slice(0, 12).map((r) => `${r.name}${r.capacity ? ` (${r.capacity} seats)` : ''}`).join(', ')}.` : `No room is free then${out.minCapacity ? ` for ${out.minCapacity}` : ''}.` });
    },
  },

  list_room_shifts: {
    module: 'Room allocation', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: 'Room shifts: classes moved to another room (temporary or permanent), with dates, periods, reason and status, including teachers\' requests waiting for the administrator or principal. Use for "show room shifts", "room changes this week", "pending room shift requests". Read-only.',
    inputSchema: closed({ status: { type: 'string', enum: ['REQUESTED', 'APPLIED', 'REJECTED', 'CANCELLED', 'ALL'] }, from: WHEN }),
    permission: 'timetable.read',
    service: 'examRooms/rooms.service.listShifts()',
    async run(ctx, args) {
      const rows = await rooms.listShifts(ctx.actor, { status: args.status ?? undefined, from: day(args.from) ?? undefined });
      if (!rows.length) return ok({ items: [] }, { speak: 'No room shifts.' });
      return ok({ items: rows }, { speak: `${rows.length} room shift${rows.length === 1 ? '' : 's'}: ${rows.slice(0, 10).map((r) => `${r.refNo} ${r.className} to ${r.to?.name ?? 'another room'} ${r.when} (${r.reason}) · ${r.status.toLowerCase()}`).join('; ')}.` });
    },
  },

  create_room_shift: {
    module: 'Room allocation', operation: 'CREATE', risk: RISK.MEDIUM, confirm: true, affectsOthers: true,
    description: 'Move a class to another room for some periods, a day, a date range, or permanently, with a reason. Checked against the timetable, exams, bookings and maintenance; a busy room is refused with free rooms that fit. The administrator or principal applies it; a teacher\'s request (their own class or the periods they teach) goes to them for approval, or is applied at once for one period when the school allows teachers to self-shift. The class teacher, subject teachers, students and parents are told. Use for "move 7B to the science lab for period 3 tomorrow because of painting", "shift 8A to room 204 from Monday to Friday", "move 6C to room 110 permanently". Needs confirmation on the website.',
    inputSchema: closed({
      className: text(40, 'The class, e.g. "7B"'), toRoom: text(60, 'The room, e.g. "science lab", "204"'), date: WHEN, endDate: WHEN, periods: PERIODS,
      kind: { type: 'string', enum: ['TEMPORARY', 'PERMANENT'] }, reason: text(200, 'Why, e.g. "painting"'),
    }, ['className', 'toRoom']),
    permission: 'facilities.request', anyOf: [['facilities.request'], ['facilities.manage', 'ALL'], ['timetable.manage', 'ALL']],
    service: 'examRooms/rooms.service.createShift()',
    async prepare(ctx, args) {
      if (!args.reason) throw ask(`Why is ${args.className} moving to ${args.toRoom}? (e.g. "painting")`);
      const body = { className: args.className, toRoom: args.toRoom, date: day(args.date) ?? undefined, endDate: day(args.endDate) ?? undefined, periods: args.periods ?? [], kind: args.kind ?? 'TEMPORARY', reason: args.reason };
      const check = await rooms.checkShift(ctx.actor, body);
      if (check.conflicts.length) {
        throw new AppError(`${check.to.name} is not free: ${check.conflicts.slice(0, 3).map((c) => `${c.periodNo ? `period ${c.periodNo}: ` : ''}${c.detail}`).join('; ')}.${check.suggestions.length ? ` Free rooms that fit ${check.className} (${check.strength}): ${check.suggestions.map((x) => x.name).join(', ')}.` : ''}`, 409, [], 'ROOM_CLASH');
      }
      const settings = await rooms.getSettings();
      const mode = check.canApply ? 'APPLY' : settings.teacherSelfShift && check.kind === 'TEMPORARY' && check.startDate === check.endDate && check.periods.length === 1 ? 'SELF' : 'REQUEST';
      return { body, check, mode };
    },
    summarise: (_a, _actor, p) => {
      const c = p.check;
      const what = `${c.className} to ${c.to.name} ${c.when} (${p.body.reason})${c.warnings.length ? `. Note: ${c.warnings.join(' ')}` : ''}`;
      if (p.mode === 'REQUEST') return `Ask the administrator or principal to move ${what}. Nothing changes until they approve it on Rooms & Classes.`;
      return `Move ${what}. The class teacher, ${c.periods.length ? 'the teachers of those periods' : 'subject teachers'}, students and parents are told.`;
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const out = await rooms.createShift(ctx.actor, p.body);
      return action({
        type: out.applied ? 'room_shift_applied' : 'room_shift_requested', id: out.id, data: out,
        speak: out.applied
          ? `Done (${out.refNo}): ${out.className} is in ${out.to?.name} ${out.when}.${out.notified ? ` Told ${out.notified.teachers} teachers, ${out.notified.students} students and ${out.notified.guardians} parents.` : ''}`
          : `Requested (${out.refNo}): ${out.className} to ${out.to?.name} ${out.when}. The administrator or principal decides on Rooms & Classes; you will be told.`,
      });
    },
  },

  assign_home_room: {
    module: 'Room allocation', operation: 'UPDATE', risk: RISK.MEDIUM, confirm: true, affectsOthers: true,
    description: 'Make a room a class\'s home room (kept in the room history; the timetable periods that named the old room follow). A room another class calls home is refused unless "move them out" is said. Administrator or principal. Use for "assign room 204 to 8A", "make the science lab 9B\'s home room", "give room 110 to 6C". Needs confirmation on the website.',
    inputSchema: closed({ className: text(40, 'The class, e.g. "8A"'), room: text(60, 'The room, e.g. "204"'), reason: text(200, 'Why'), displace: { type: 'boolean', description: 'Move the class that has it now out' } }, ['className', 'room']),
    permission: 'facilities.manage', minScope: 'ALL', anyOf: [['facilities.manage', 'ALL'], ['timetable.manage', 'ALL']],
    service: 'examRooms/rooms.service.assignHomeRoom()',
    async prepare(ctx, args) {
      if (!rooms.canManageRooms(ctx.actor)) throw new AppError('Only the administrator or principal can change a class\'s home room.', 403, [], 'FORBIDDEN');
      const section = await rooms.resolveSection(args.className);
      const room = await rooms.resolveFacility(args.room);
      const view = await rooms.roomsAndClasses(ctx.actor, {});
      const row = view.sections.find((x) => x.sectionId === String(section._id));
      const occ = view.rooms.find((r) => r.id === String(room._id))?.occupant ?? null;
      if (occ && occ.sectionId !== String(section._id) && !args.displace) throw ask(`${room.name} is the home room of ${occ.className}. Choose another room, or say "assign ${room.name} to ${row?.className ?? args.className} and move ${occ.className} out".`);
      return { section, room, row, occ };
    },
    summarise: (a, _actor, p) => `Make ${p.room.name} the home room of ${p.row?.className ?? a.className} (now ${p.row?.homeRoom?.name ?? 'none'}; ${p.row?.strength ?? '?'} pupils${p.room.capacity ? `, ${p.room.capacity} seats` : ''})${p.occ && a.displace ? `; ${p.occ.className} will have no home room` : ''}${a.reason ? ` (${a.reason})` : ''}.`,
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const out = await rooms.assignHomeRoom(ctx.actor, { sectionId: String(p.section._id), facilityId: String(p.room._id), reason: args.reason ?? null, displace: args.displace === true });
      return action({ type: 'home_room_assigned', id: out.sectionId, data: out, speak: `Done: ${out.to?.name} is now the home room of ${out.className}${out.from ? ` (was ${out.from.name})` : ''}.${out.fits === false ? ` Note: ${out.strength} pupils for ${out.to.capacity} seats.` : ''}${out.displaced ? ` ${out.displaced} has no home room now.` : ''}` });
    },
  },
};
