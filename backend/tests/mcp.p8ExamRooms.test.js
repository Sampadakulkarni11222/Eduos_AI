import { describe, it, expect, beforeEach } from 'vitest';
import { inSchool, OAK, mcp, proposeAndConfirm, actorForRole } from './support/mcpSchool.js';
import { seedFamilySchool, ymdIn } from './support/familySchool.js';
import { Facility } from '../src/models/facility.model.js';
import { ExamSitting, RoomShift } from '../src/models/examRoom.model.js';
import { MessageOutbox } from '../src/models/messaging.model.js';
import { mcpToolsFor, getMcpTool } from '../src/modules/ai/mcp/registry.js';
import { parseIntent } from '../src/modules/ai/agent/intent.js';
import { p8ExamRoomsTools } from '../src/modules/ai/mcp/tools/p8ExamRooms.js';
import * as halls from '../src/modules/examRooms/examHalls.service.js';

/**
 * Part 8 through the assistant: the owner's sentences reach the right tool
 * with the right words; reads keep families to their own room and seat;
 * writes are drafts the same person confirms on the website (they move other
 * people), and a teacher's room shift becomes a request while the
 * administrator's is applied.
 */
let s; let R;
const oak = (fn) => inSchool(OAK, fn);
const today = ymdIn(0);
const who = (k) => s.people[k].actor;

beforeEach(async () => {
  s = await seedFamilySchool();
  R = await oak(async () => ({
    home6A: await Facility.create({ code: 'C-6A', name: 'Room 6A', kind: 'CLASSROOM', capacity: 40, sectionId: s.sectionA._id }),
    home6B: await Facility.create({ code: 'C-6B', name: 'Room 6B', kind: 'CLASSROOM', capacity: 40, sectionId: s.sectionB._id }),
    hall: await Facility.create({ code: 'AUD', name: 'Auditorium', kind: 'AUDITORIUM', capacity: 120 }),
    lab: await Facility.create({ code: 'SCI', name: 'Science Lab', kind: 'LAB', capacity: 30 }),
    r204: await Facility.create({ code: 'R204', name: 'Room 204', kind: 'CLASSROOM', capacity: 36 }),
  }));
});

const paper = () => oak(() => halls.createSitting(who('ADMIN'), { subjectOfferingIds: [String(s.offerings.mathsA._id)], kind: 'TERM', date: ymdIn(1), startTime: '11:00', endTime: '12:00', venues: [{ facilityId: String(R.hall._id), invigilatorProfileIds: [who('T4').profileId] }] }));

describe('the owner\'s sentences', () => {
  const cases = [
    ['PRINCIPAL', 'where is the class 10 maths exam?', 'get_exam_hall', { className: '10', subject: 'maths' }],
    ['TEACHER', 'my invigilation duties', 'list_my_invigilation_duties', {}],
    ['TEACHER', 'which room is 7B in today?', 'get_section_room', { className: '7B', date: 'today' }],
    ['TEACHER', 'move 7B to the science lab for period 3 tomorrow because of painting', 'create_room_shift', { className: '7B', toRoom: 'science lab', periods: [3], date: 'tomorrow', reason: 'painting' }],
    ['ADMIN', 'assign room 204 to 8A', 'assign_home_room', { className: '8A', room: 'room 204' }],
    ['PRINCIPAL', 'change the exam hall for class 9 science to the auditorium', 'change_exam_hall', { className: '9', subject: 'science', toRoom: 'auditorium' }],
    ['STUDENT', 'show my exam timetable', 'get_my_exam_timetable', {}],
    ['PARENT', 'show my exam timetable', 'get_my_exam_timetable', {}],
    ['ADMIN', 'delay the class 10 maths exam by 30 minutes', 'update_exam_hall_status', { change: 'DELAY', delayMinutes: 30 }],
  ];
  for (const [role, text, tool, args] of cases) {
    it(`${role}: "${text}"`, () => {
      const step = parseIntent(text, actorForRole(role));
      expect(step?.tool).toBe(tool);
      expect(step.args).toMatchObject(args);
    });
  }

  it('leaves hostel rooms and the exam calendar to their own tools', () => {
    expect(parseIntent('which room is Rahul in', actorForRole('WARDEN'))?.tool).not.toMatch(/section_room|exam_hall/);
    expect(parseIntent('show exam results', actorForRole('PRINCIPAL'))?.tool).not.toMatch(/exam_hall|exam_timetable/);
  });

  it('shows each role only the tools its screens allow', () => {
    const names = (role) => new Set(mcpToolsFor(actorForRole(role)).map((t) => t.name));
    expect(names('PARENT').has('get_my_exam_timetable')).toBe(true);
    for (const t of ['assign_home_room', 'change_exam_hall', 'create_room_shift', 'list_my_invigilation_duties', 'create_class_test']) expect(names('PARENT').has(t)).toBe(false);
    expect(names('TEACHER').has('assign_home_room')).toBe(false);
    expect(names('TEACHER').has('create_room_shift')).toBe(true);
    expect(names('ADMIN').has('assign_home_room')).toBe(true);
    // Writes are confirmed, and those that move other people only on the website.
    for (const [name, t] of Object.entries(p8ExamRoomsTools)) if (t.operation !== 'GET') expect(Boolean(t.confirm), name).toBe(true);
    for (const n of ['change_exam_hall', 'update_exam_hall_status', 'create_room_shift', 'assign_home_room']) expect(getMcpTool(n).affectsOthers).toBe(true);
  });
});

describe('reads', () => {
  it('a parent gets their own children\'s rooms and seats only', async () => {
    await paper();
    const out = await mcp(OAK, who('PARENT'), 'get_my_exam_timetable', {});
    expect(out.success).toBe(true);
    expect(out.speak).toMatch(/Rahul Sharma: .* Auditorium, seat AUD-01/);
    expect(JSON.stringify(out)).not.toMatch(/Priya|Aman|AUD-02|Free teacher/);
    const staff = await mcp(OAK, who('PRINCIPAL'), 'get_exam_hall', { className: '6A', subject: 'maths' });
    expect(staff.speak).toMatch(/Auditorium \(3 seated; invigilators: Free teacher\)/);
    const duties = await mcp(OAK, who('T4'), 'list_my_invigilation_duties', {});
    expect(duties.speak).toMatch(/You invigilate 1 paper: .* in Auditorium/);
  });

  it('"which room is 6A in today": families for their own class only', async () => {
    const own = await mcp(OAK, who('PARENT2'), 'get_section_room', { className: '6A' });
    expect(own.speak).toMatch(/Class 6 A .* Home room Room 6A/);
    const other = await mcp(OAK, who('PARENT3'), 'get_section_room', { className: '6A' });
    expect(other.success).toBe(false);
  });
});

describe('writes are drafts the same person confirms', () => {
  it('the administrator moves a class: draft, nothing until confirmed, then applied and everyone told', async () => {
    const args = { className: '6A', toRoom: 'science lab', date: today, periods: [1], reason: 'painting' };
    const first = await mcp(OAK, who('ADMIN'), 'create_room_shift', args);
    expect(first.action.status).toBe('confirmation_required');
    expect(first.action.summary).toMatch(/^Move Class 6 A to Science Lab on .* period 1 \(painting\)\. The class teacher/);
    expect(await oak(() => RoomShift.countDocuments())).toBe(0);
    const done = await mcp(OAK, who('ADMIN'), 'create_room_shift', {}, { confirmationToken: first.action.confirmationToken });
    expect(done.action.type).toBe('room_shift_applied');
    expect(await oak(() => MessageOutbox.countDocuments({ templateKey: 'ROOM_SHIFTED' }))).toBeGreaterThan(0);
  });

  it('a teacher\'s move is a request; a busy room is refused with free rooms; WhatsApp cannot confirm it', async () => {
    const { proposal, done } = await proposeAndConfirm(OAK, who('T2'), 'create_room_shift', { className: '6A', toRoom: 'Room 204', date: today, periods: [2], reason: 'projector' });
    expect(proposal.action.summary).toMatch(/^Ask the administrator or principal to move Class 6 A to Room 204/);
    expect(done.action.type).toBe('room_shift_requested');
    expect((await oak(() => RoomShift.findOne({}).lean())).status).toBe('REQUESTED');
    // 6 B is in its own room at P1; moving 6 A there is refused with suggestions.
    const busy = await mcp(OAK, who('ADMIN'), 'create_room_shift', { className: '6A', toRoom: 'Room 6B', date: today, periods: [1], reason: 'painting' });
    expect(busy.success).toBe(false);
    expect(busy.error.message).toMatch(/Room 6B is not free: .*Class 6 B Science.*Free rooms that fit Class 6 A \(3\): /);
    const wa = await mcp(OAK, who('ADMIN'), 'create_room_shift', { className: '6A', toRoom: 'Room 204', date: today, periods: [1], reason: 'painting' }, { channel: 'WHATSAPP' });
    expect(wa.error.details.reason).toBe('CONFIRM_ON_WEB');
  });

  it('change the exam hall: re-seated, families and invigilators told, banner set', async () => {
    const p = await paper();
    const { proposal, done } = await proposeAndConfirm(OAK, who('PRINCIPAL'), 'change_exam_hall', { className: '6A', subject: 'maths', toRoom: 'science lab', reason: 'hall needed' });
    expect(proposal.action.summary).toMatch(/from Auditorium to Science Lab; 3 candidates re-seated \(hall needed\)\. The students, their parents and the invigilators are told/);
    expect(done.speak).toMatch(/Told 1 students, 2 parents and 1 invigilators/);
    const row = await oak(() => ExamSitting.findById(p.id).lean());
    expect(row.banner).toMatch(/Science Lab/);
    expect(await oak(() => MessageOutbox.countDocuments({ templateKey: 'EXAM_CHANGED' }))).toBeGreaterThan(0);
  });

  it('assign a home room; a taken room asks first', async () => {
    const { done } = await proposeAndConfirm(OAK, who('ADMIN'), 'assign_home_room', { className: '6A', room: '204' });
    expect(done.action.type).toBe('home_room_assigned');
    expect(String((await oak(() => Facility.findById(R.r204._id).lean())).sectionId)).toBe(String(s.sectionA._id));
    const taken = await mcp(OAK, who('ADMIN'), 'assign_home_room', { className: '6B', room: '204' });
    expect(taken.error.message).toMatch(/Room 204 is the home room of Class 6 A/);
  });

  it('a teacher schedules a class test in words', async () => {
    const { proposal, done } = await proposeAndConfirm(OAK, who('TEACHER'), 'create_class_test', { className: '6A', subject: 'english', date: 'tomorrow', startTime: '11', endTime: '11:40', room: '204' });
    expect(proposal.action.summary).toMatch(/Schedule Class test · English for Class 6 A on .*, 11:00–11:40, in Room 204 \(3 pupils seated by roll number; invigilator: TEACHER user\)/);
    expect(done.action.type).toBe('class_test_scheduled');
  });
});
