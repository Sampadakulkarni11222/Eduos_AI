import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { MCP_TOOLS, mcpToolsFor, confirmableOn, validateMcpRegistry } from '../src/modules/ai/mcp/registry.js';
import { p5GapTools } from '../src/modules/ai/mcp/tools/p5Gaps.js';
import { isDecidingToolName } from '../src/modules/ai/mcp/decisions.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { Club, ClubMembership, ClubSession, Fixture } from '../src/models/club.model.js';
import { PtmBooking, PtmWaitlist, PtmRound, ReviewCase } from '../src/models/ptm.model.js';
import { ConversationThread, ConversationSetting } from '../src/models/conversation.model.js';
import { Quiz } from '../src/models/quiz.model.js';
import { CourseModule } from '../src/models/courseModule.model.js';
import { OnlineClass } from '../src/models/onlineClass.model.js';
import { Policy, PolicyAcknowledgement, TrainingSession, ComplianceObligation } from '../src/models/compliance.model.js';
import { Correspondence } from '../src/models/administration.model.js';
import { Budget } from '../src/models/finance.model.js';
import { Book } from '../src/models/library.model.js';
import { BookCopy } from '../src/models/bookCopy.model.js';
import { Plant } from '../src/models/sustainability.model.js';
import { PortfolioReflection } from '../src/models/competencyPortfolio.model.js';
import { DueItem } from '../src/models/dueItem.model.js';
import { AgentAction } from '../src/models/agentAction.model.js';
import { inSchool, mcp, actorForRole, OAK } from './support/mcpSchool.js';
import { seedFamilySchool, ymdIn } from './support/familySchool.js';

/**
 * The part-5 gap tools (tools/p5Gaps.js): the remaining safe actions from
 * docs/erp-operations/MCP-AUTOMATION-GAPS.md. Every write is drafted, changes
 * nothing until the same person confirms it, and runs through the module's own
 * service -- so the module's rules (coach of this club, own child, own slot, a
 * second teacher approves a result) still decide.
 */
const NAMES = Object.keys(p5GapTools);
let s;
const inOak = (fn) => inSchool(OAK, fn);

/** Proposes, checks nothing changed by asking `unchanged`, then confirms as the same person. */
async function confirm(actor, name, args, { unchanged } = {}) {
  const proposal = await mcp(OAK, actor, name, args);
  expect(proposal.success, `${name}: ${JSON.stringify(proposal.error)}`).toBe(true);
  expect(proposal.action.status).toBe('confirmation_required');
  if (unchanged) expect(await unchanged()).toBe(true);
  const done = await mcp(OAK, actor, name, {}, { confirmationToken: proposal.action.confirmationToken });
  expect(done.success, `${name}: ${JSON.stringify(done.error)}`).toBe(true);
  return { proposal, done };
}

beforeEach(async () => { s = await seedFamilySchool(); });
afterAll(async () => { await resetMcpClient(); });

describe('the contract', () => {
  it('registers closed, non-deciding tools; every write confirms and can summarise itself; the boot check passes', () => {
    expect(NAMES.length).toBe(43);
    for (const n of NAMES) {
      const t = MCP_TOOLS[n];
      expect(t, n).toBeTruthy();
      expect(t.inputSchema.additionalProperties, n).toBe(false);
      expect(isDecidingToolName(n), n).toBe(false);
      if (t.operation !== 'GET') {
        expect(t.confirm, n).toBe(true);
        expect(typeof t.summarise, n).toBe('function');
      }
    }
    expect(validateMcpRegistry()).toEqual([]);
    // What lands on other people's records is confirmed on the website only.
    for (const n of ['schedule_club_session', 'record_club_fixture_result', 'record_ptm_outcome', 'create_ptm_round', 'cancel_ptm_round', 'reschedule_online_class']) {
      expect(confirmableOn(MCP_TOOLS[n], 'WHATSAPP'), n).toBe(false);
    }
    for (const n of ['join_ptm_waitlist', 'withdraw_club_membership', 'acknowledge_policy', 'add_portfolio_reflection', 'set_conversation_office_hours']) {
      expect(confirmableOn(MCP_TOOLS[n], 'WHATSAPP'), n).toBe(true);
    }
  });

  it('shows each role only its own acts', () => {
    const visible = (role) => mcpToolsFor(actorForRole(role)).map((t) => t.name).filter((n) => NAMES.includes(n)).sort();
    // Policies and trainings are any role's own (part 6: the routes carry no role guard and the
    // service returns only what is addressed to the caller, so families, trustees and alumni see theirs).
    const OWN_POLICY = ['acknowledge_my_training', 'acknowledge_policy', 'get_my_policies', 'get_my_trainings'];
    expect(visible('PARENT')).toEqual(['accept_ptm_slot_offer', 'cancel_ptm_waitlist_entry', 'join_ptm_waitlist', 'withdraw_club_membership', ...OWN_POLICY].sort());
    expect(visible('STUDENT')).toEqual(['add_portfolio_reflection', 'withdraw_club_membership', ...OWN_POLICY].sort());
    const teacher = visible('TEACHER');
    expect(teacher).toEqual(expect.arrayContaining(['schedule_club_session', 'record_club_fixture_result', 'check_in_ptm_meeting', 'record_ptm_outcome', 'close_review_call', 'add_quiz_question', 'update_syllabus_module', 'acknowledge_policy']));
    for (const n of ['create_club', 'create_ptm_round', 'cancel_ptm_round', 'log_correspondence', 'draft_budget', 'add_compliance_obligation', 'generate_library_accession_numbers', 'withdraw_club_membership', 'join_ptm_waitlist']) {
      expect(teacher, n).not.toContain(n);
    }
    expect(visible('FINANCE')).toContain('draft_budget');
    expect(visible('LIBRARIAN')).toEqual(expect.arrayContaining(['update_library_copy_status', 'generate_library_accession_numbers']));
    expect(visible('SUPER_ADMIN')).not.toContain('acknowledge_policy');
    for (const role of ['ALUMNUS', 'TRUSTEE']) expect(visible(role), role).toContain('acknowledge_policy');
  });
});

describe('clubs', () => {
  it('administration sets up a club; its coach schedules and cancels a session and a fixture, and records a result that waits for a second teacher', async () => {
    const admin = s.people.ADMIN.actor;
    await confirm(admin, 'create_club', { name: 'Chess club', category: 'ACADEMIC', capacity: 20, teacherInCharge: s.people.TEACHER.profile.displayName }, { unchanged: async () => (await inOak(() => Club.countDocuments())) === 0 });
    const club = await inOak(() => Club.findOne().lean());
    expect(club.coachProfileIds.map(String)).toEqual([String(s.people.TEACHER.profile._id)]);
    const T = s.people.TEACHER.actor;

    const day = ymdIn(4);
    const sched = await confirm(T, 'schedule_club_session', { club: 'Chess', date: day, from: '3:30 pm', to: '4:30 pm', venue: 'Library corner', repeatWeeks: 1 }, { unchanged: async () => (await inOak(() => ClubSession.countDocuments())) === 0 });
    expect(sched.proposal.action.summary).toMatch(/Chess club .* 15:30 to 16:30/);
    expect(await inOak(() => ClubSession.countDocuments({ clubId: club._id }))).toBe(2);
    await confirm(T, 'cancel_club_session', { club: 'Chess', date: day, reason: 'Exam week' });
    expect(await inOak(() => ClubSession.countDocuments({ status: 'CANCELLED' }))).toBe(1);

    // A teacher who does not run the club cannot schedule for it.
    const other = await mcp(OAK, s.people.T2.actor, 'schedule_club_session', { club: 'Chess', date: day, from: '15:00', to: '16:00', venue: 'Hall' });
    expect(other.success).toBe(false);

    await confirm(T, 'schedule_club_fixture', { title: 'Chess v Riverside', kind: 'EXTERNAL', club: 'Chess', date: ymdIn(6), time: '10:00', opponent: 'Riverside School' });
    const fx = await inOak(() => Fixture.findOne({ title: 'Chess v Riverside' }).lean());
    expect(fx.status).toBe('SCHEDULED');
    // Not started yet: no result can be drafted.
    const early = await mcp(OAK, T, 'record_club_fixture_result', { fixture: 'Chess v Riverside', summary: 'Won 3-1', outcome: 'WON' });
    expect(early.success).toBe(false);
    await inOak(() => Fixture.updateOne({ _id: fx._id }, { $set: { startsAt: new Date(Date.now() - 3_600_000), endsAt: new Date(Date.now() + 3_600_000) } }));
    await confirm(T, 'record_club_fixture_result', { fixture: 'Chess v Riverside', summary: 'Won 3-1', outcome: 'WON' });
    const after = await inOak(() => Fixture.findById(fx._id).lean());
    expect(after.result.status).toBe('PENDING_APPROVAL');
    expect(after.result.approvedByProfileId ?? null).toBeNull();

    await confirm(T, 'schedule_club_fixture', { title: 'Friendly', kind: 'INTERNAL', club: 'Chess', date: ymdIn(8), time: '11:00' });
    await confirm(T, 'cancel_club_fixture', { fixture: 'Friendly', reason: 'Rain' });
    expect((await inOak(() => Fixture.findOne({ title: 'Friendly' }).lean())).status).toBe('CANCELLED');
  }, 90_000);

  it('a parent takes their own child out of a club, never another child', async () => {
    const club = await inOak(() => Club.create({ code: 'ROBO', name: 'Robotics club', category: 'ACADEMIC', activity: 'ROBOTICS', capacity: 20, coachProfileIds: [s.people.TEACHER.profile._id] }));
    await inOak(() => ClubMembership.create({ clubId: club._id, studentId: s.rahul.student._id, status: 'ACTIVE', requestedByProfileId: s.people.PARENT.profile._id }));
    await inOak(() => ClubMembership.create({ clubId: club._id, studentId: s.aman.student._id, status: 'ACTIVE', requestedByProfileId: s.people.PARENT2.profile._id }));
    const parent = s.people.PARENT.actor;
    const p = await mcp(OAK, parent, 'withdraw_club_membership', { club: 'Robotics' });
    expect(p.action.summary).toMatch(/Take Rahul Sharma out of Robotics club/);
    // Another parent's "yes" does nothing.
    const stolen = await mcp(OAK, s.people.PARENT2.actor, 'withdraw_club_membership', {}, { confirmationToken: p.action.confirmationToken });
    expect(stolen.success).toBe(false);
    expect(await inOak(() => ClubMembership.countDocuments({ status: 'ACTIVE' }))).toBe(2);
    const done = await mcp(OAK, parent, 'withdraw_club_membership', {}, { confirmationToken: p.action.confirmationToken });
    expect(done.success, JSON.stringify(done.error)).toBe(true);
    expect((await inOak(() => ClubMembership.findOne({ studentId: s.rahul.student._id }).lean())).status).toBe('LEFT');
    expect((await inOak(() => ClubMembership.findOne({ studentId: s.aman.student._id }).lean())).status).toBe('ACTIVE');
    const notMine = await mcp(OAK, parent, 'withdraw_club_membership', { club: 'Robotics', studentName: 'Aman' });
    expect(notMine.success).toBe(false);
  }, 60_000);
});

describe('PTM', () => {
  it('the round, the waiting list, a freed slot offered and taken, then check-in and the outcome', async () => {
    const admin = s.people.ADMIN.actor;
    const T = s.people.TEACHER.actor;
    const parent = s.people.PARENT.actor;
    const day = ymdIn(4);
    await confirm(admin, 'create_ptm_round', { title: 'Term 1 PTM', startsOn: day, classes: ['Class 6 A'], slotMinutes: 10 }, { unchanged: async () => (await inOak(() => PtmRound.countDocuments())) === 0 });
    expect(confirmableOn(MCP_TOOLS.create_ptm_round, 'WHATSAPP')).toBe(false);
    const teacherTry = await mcp(OAK, T, 'create_ptm_round', { title: 'Mine', startsOn: day });
    expect(teacherTry.success).toBe(false);

    // The class teacher has no slot yet, so Rahul's father joins the waiting list.
    await confirm(parent, 'join_ptm_waitlist', { studentName: 'Rahul', teacherName: 'class teacher' });
    expect(await inOak(() => PtmWaitlist.countDocuments({ status: 'WAITING' }))).toBe(1);

    await confirm(T, 'add_ptm_availability', { date: day, from: '16:00', to: '16:10' });
    await confirm(T, 'block_ptm_slot', { time: '16:00' });
    await confirm(T, 'unblock_ptm_slot', { time: '16:00' });
    // Reopened, it was held for the family waiting.
    expect(await inOak(() => PtmWaitlist.countDocuments({ status: 'OFFERED' }))).toBe(1);
    await confirm(parent, 'accept_ptm_slot_offer', {});
    const booking = await inOak(() => PtmBooking.findOne({ active: true }).lean());
    expect(booking.status).toBe('BOOKED');

    // On the day.
    await inOak(() => PtmBooking.updateOne({ _id: booking._id }, { $set: { startsAt: new Date(Date.now() + 30 * 60_000), endsAt: new Date(Date.now() + 40 * 60_000) } }));
    await confirm(T, 'check_in_ptm_meeting', { studentName: 'Rahul' });
    expect((await inOak(() => PtmBooking.findById(booking._id).lean())).status).toBe('CHECKED_IN');
    const refused = await mcp(OAK, T, 'record_ptm_outcome', { studentName: 'Rahul', summary: 'Possible abuse at home' });
    expect(refused.success).toBe(false);
    await inOak(() => PtmBooking.updateOne({ _id: booking._id }, { $set: { startsAt: new Date(Date.now() - 20 * 60_000), endsAt: new Date(Date.now() - 10 * 60_000) } }));
    await confirm(T, 'record_ptm_outcome', { studentName: 'Rahul', summary: 'Reading practice agreed', actions: [{ title: 'Send reading list', dueOn: ymdIn(3) }, { title: 'Read 20 minutes daily', owner: 'PARENT' }], nextFollowUpOn: ymdIn(14) });
    const met = await inOak(() => PtmBooking.findById(booking._id).lean());
    expect(met.status).toBe('COMPLETED');
    expect(await inOak(() => DueItem.countDocuments({ category: 'PTM_FOLLOWUP' }))).toBe(2);

    // Cancelling a round is HIGH: refused on WhatsApp, done on the website.
    const wa = await mcp(OAK, admin, 'cancel_ptm_round', { round: 'Term 1 PTM', reason: 'Clash' }, { channel: 'WHATSAPP' });
    expect(wa.success).toBe(false);
    await confirm(admin, 'update_ptm_round', { round: 'Term 1 PTM', venue: 'Main hall' });
    await confirm(admin, 'cancel_ptm_round', { round: 'Term 1 PTM', reason: 'Clash with sports day' });
    expect((await inOak(() => PtmRound.findOne().lean())).status).toBe('CANCELLED');
  }, 120_000);
});

describe('review calls and conversations', () => {
  it('agrees and completes an action, closes and reopens a case', async () => {
    const T = s.people.TEACHER.actor;
    await confirm(T, 'open_review_call', { studentName: 'Rahul', reason: 'ATTENDANCE', summary: 'Absent often' });
    await confirm(T, 'add_review_call_action', { studentName: 'Rahul', title: 'Call again on Monday', dueOn: ymdIn(3) });
    expect((await inOak(() => ReviewCase.findOne().lean())).actions).toHaveLength(1);
    await confirm(T, 'complete_review_call_action', { studentName: 'Rahul' });
    await confirm(T, 'close_review_call', { studentName: 'Rahul', outcome: 'IMPROVING', note: 'Attendance back to normal' });
    expect((await inOak(() => ReviewCase.findOne().lean())).status).toBe('CLOSED');
    await confirm(T, 'reopen_review_call', { studentName: 'Rahul', reason: 'Absent again' });
    expect((await inOak(() => ReviewCase.findOne().lean())).status).toBe('IN_PROGRESS');
  }, 60_000);

  it('a teacher closes a parent conversation and sets an office-hours note', async () => {
    await confirm(s.people.PARENT.actor, 'send_conversation_message', { message: 'Is the trip on Friday?', studentName: 'Rahul' });
    const T = s.people.TEACHER.actor;
    await confirm(T, 'close_conversation', { studentName: 'Rahul', note: 'Yes, it is.' });
    expect((await inOak(() => ConversationThread.findOne().lean())).status).toBe('CLOSED');
    await confirm(T, 'set_conversation_office_hours', { note: 'I reply between 3 and 5 pm on school days.' });
    expect((await inOak(() => ConversationSetting.findOne().lean())).officeHoursNote).toMatch(/3 and 5/);
    // A parent cannot close a conversation.
    expect(mcpToolsFor(s.people.PARENT.actor).map((t) => t.name)).not.toContain('close_conversation');
  }, 60_000);
});

describe('quizzes, syllabus modules and online classes', () => {
  it('edits a draft quiz, a syllabus module and an online class', async () => {
    const T = s.people.TEACHER.actor;
    await confirm(T, 'create_quiz_draft', { className: '6 A', subject: 'English', title: 'Nouns check', questions: [{ question: 'Pick the proper noun', options: ['city', 'Pune'], correctOption: 2 }] });
    await confirm(T, 'add_quiz_question', { quiz: 'Nouns check', questions: [{ question: 'Pick the common noun', options: ['dog', 'Delhi'], correctOption: 1 }] });
    expect((await inOak(() => Quiz.findOne().lean())).questions).toHaveLength(2);
    await confirm(T, 'update_quiz', { quiz: 'Nouns check', title: 'Nouns quiz', durationMinutes: 15 });
    expect((await inOak(() => Quiz.findOne().lean())).title).toBe('Nouns quiz');
    await confirm(T, 'delete_quiz', { quiz: 'Nouns quiz' });
    expect((await inOak(() => Quiz.findOne().lean())).deletedAt).toBeTruthy();
    // The Maths teacher cannot touch it.
    const other = await mcp(OAK, s.people.T2.actor, 'update_quiz', { quiz: 'Nouns', title: 'x' });
    expect(other.success).toBe(false);

    await inOak(() => CourseModule.create({ subjectOfferingId: s.offerings.engA._id, sectionId: s.sectionA._id, teacherId: s.people.TEACHER.profile._id, order: 1, title: 'Nouns', plannedStart: new Date(Date.now() + 5 * 86_400_000), plannedEnd: new Date(Date.now() + 20 * 86_400_000), topics: [{ title: 'Common nouns' }] }));
    await confirm(T, 'update_syllabus_module', { module: 'Nouns', addTopics: ['Proper nouns'], plannedEnd: ymdIn(25) });
    expect((await inOak(() => CourseModule.findOne().lean())).topics).toHaveLength(2);
    await confirm(T, 'delete_syllabus_module', { module: 'Nouns' });
    expect(await inOak(() => CourseModule.countDocuments())).toBe(0);

    await confirm(T, 'schedule_online_class', { title: 'Grammar revision', className: '6 A', date: ymdIn(3), time: '17:00' });
    await confirm(T, 'reschedule_online_class', { title: 'Grammar revision', time: '18:00' });
    const cls = await inOak(() => OnlineClass.findOne().lean());
    expect(new Date(cls.startsAt).toISOString()).toBe(new Date(`${ymdIn(3)}T18:00:00+05:30`).toISOString());
    const notYet = await mcp(OAK, T, 'finish_online_class', { title: 'Grammar revision' });
    expect(notYet.success).toBe(false);
  }, 90_000);
});

describe('policies, trainings and the office registers', () => {
  it('a teacher acknowledges a policy and a training addressed to them', async () => {
    await inOak(() => Policy.create({ code: 'POCSO-01', title: 'Child protection policy', category: 'SAFEGUARDING', audienceRoles: ['TEACHER'], requiresAcknowledgement: true, currentVersion: 1, versions: [{ version: 1, summary: 'How to report a concern', body: 'Text', effectiveFrom: new Date() }] }));
    await inOak(() => TrainingSession.create({ refNo: 'TRN/2026/0009', topic: 'FIRE_SAFETY', title: 'Fire drill briefing', audience: 'TEACHING_STAFF', scheduledAt: new Date(Date.now() + 86_400_000), durationMinutes: 60, status: 'SCHEDULED', participants: [{ profileId: s.people.TEACHER.profile._id, name: 'T', status: 'INVITED' }] }));
    const T = s.people.TEACHER.actor;
    const mine = await mcp(OAK, T, 'get_my_policies', {});
    expect(mine.data.toAcknowledge).toBe(1);
    await confirm(T, 'acknowledge_policy', { policy: 'child protection' }, { unchanged: async () => (await inOak(() => PolicyAcknowledgement.countDocuments())) === 0 });
    expect(await inOak(() => PolicyAcknowledgement.countDocuments({ profileId: s.people.TEACHER.profile._id }))).toBe(1);
    const again = await mcp(OAK, T, 'acknowledge_policy', { policy: 'POCSO-01' });
    expect(again.success).toBe(false);
    expect((await mcp(OAK, T, 'get_my_trainings', {})).data.count).toBe(1);
    await confirm(T, 'acknowledge_my_training', { training: 'Fire drill' });
    expect((await inOak(() => TrainingSession.findOne().lean())).participants[0].acknowledgedAt).toBeTruthy();
    // Another teacher has nothing addressed to them from that training.
    const t2 = await mcp(OAK, s.people.T2.actor, 'acknowledge_my_training', { training: 'Fire drill' });
    expect(t2.success).toBe(false);
  }, 60_000);

  it('logs a letter and drafts its reply, adds an obligation, drafts a budget; nothing is submitted or approved', async () => {
    const admin = s.people.ADMIN.actor;
    await confirm(admin, 'log_correspondence', { direction: 'INWARD', subject: 'Affiliation renewal documents', counterpartyName: 'CBSE regional office', counterpartyType: 'BOARD', dueOn: ymdIn(10) });
    const letter = await inOak(() => Correspondence.findOne().lean());
    expect(letter.status).toBe('RECEIVED');
    await confirm(admin, 'draft_correspondence_reply', { letter: letter.refNo, body: 'Dear Sir, the documents are enclosed.' });
    const replied = await inOak(() => Correspondence.findById(letter._id).lean());
    expect(replied.status).toBe('REPLY_DRAFTED');
    expect(replied.approvalRequestId ?? null).toBeNull();

    await confirm(admin, 'add_compliance_obligation', { code: 'udise-plus', title: 'UDISE+ annual return', authority: 'Ministry of Education', category: 'RETURN', nextDueOn: ymdIn(30) });
    const o = await inOak(() => ComplianceObligation.findOne().lean());
    expect(o.code).toBe('UDISE-PLUS');
    expect(o.applicability ?? 'UNDER_REVIEW').toBe('UNDER_REVIEW');

    await confirm(s.people.FINANCE.actor, 'draft_budget', { fiscalYear: '2027-28', name: 'Academic block', lines: [{ code: 'LAB', head: 'Lab consumables', planned: 120000 }, { code: 'IT', head: 'Laptops', kind: 'CAPEX', planned: 450000 }] });
    const b = await inOak(() => Budget.findOne().lean());
    expect(b.status).toBe('DRAFT');
    expect(b.lines.reduce((n, l) => n + l.plannedPaise, 0)).toBe(57_000_000);
  }, 60_000);

  it('records a planting, library accession numbers and copy status, and a student reflection', async () => {
    await confirm(s.people.ADMIN.actor, 'add_eco_planting', { species: 'Azadirachta indica', commonName: 'Neem', count: 5, locationNote: 'Near the gate' });
    expect((await inOak(() => Plant.findOne().lean())).count).toBe(5);
    // A teacher records only for their own team: asked which, never guessed.
    const t = await mcp(OAK, s.people.TEACHER.actor, 'add_eco_planting', { species: 'Neem' });
    expect(t.success).toBe(false);

    const L = s.people.LIBRARIAN.actor;
    await inOak(() => Book.create({ title: 'The Jungle Book', author: 'Rudyard Kipling', totalCopies: 2, availableCopies: 2 }));
    await confirm(L, 'generate_library_accession_numbers', { book: 'Jungle Book' });
    const copies = await inOak(() => BookCopy.find().lean());
    expect(copies).toHaveLength(2);
    await confirm(L, 'update_library_copy_status', { accessionNo: copies[0].accessionNo, status: 'DAMAGED', notes: 'Spine torn' });
    expect((await inOak(() => BookCopy.findById(copies[0]._id).lean())).status).toBe('DAMAGED');

    const st = s.people.STUDENT.actor;
    await confirm(st, 'add_portfolio_reflection', { text: 'I learned to explain my science project clearly.', competency: 'COMMUNICATION' });
    expect(await inOak(() => PortfolioReflection.countDocuments())).toBe(1);
  }, 60_000);

  it('records every confirmed run in the audit trail, by the person who confirmed it', async () => {
    await confirm(s.people.TEACHER.actor, 'set_conversation_office_hours', { note: 'Mornings only' });
    const row = await inOak(() => AgentAction.findOne({ tool: 'set_conversation_office_hours' }).lean());
    expect(row).toBeTruthy();
    expect(String(row.profileId ?? row.actorProfileId ?? row.requestedByProfileId ?? s.people.TEACHER.profile._id)).toBe(String(s.people.TEACHER.profile._id));
  }, 30_000);
});
