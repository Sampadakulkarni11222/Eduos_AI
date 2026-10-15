import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { MCP_TOOLS, mutates, confirmableOn, mcpToolsFor } from '../src/modules/ai/mcp/registry.js';
import { platformPeopleTools } from '../src/modules/ai/mcp/tools/platformPeople.js';
import { platformGapTools } from '../src/modules/ai/mcp/tools/platformGaps.js';
import { isDecidingToolName } from '../src/modules/ai/mcp/decisions.js';
import { validateArgs } from '../src/modules/ai/mcp/validate.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { AgentAction } from '../src/models/agentAction.model.js';
import { School } from '../src/models/school.model.js';
import { StudentGuardian } from '../src/models/student.model.js';
import { PtmBooking } from '../src/models/ptm.model.js';
import { ConversationThread, ConversationMessage } from '../src/models/conversation.model.js';
import { ClubMembership, ClubSession } from '../src/models/club.model.js';
import { TermReportCard } from '../src/models/reportCard.model.js';
import { EcoActivity } from '../src/models/sustainability.model.js';
import { SocialOutbox } from '../src/models/social.model.js';
import { DigestPreference } from '../src/models/digest.model.js';
import { BookCopy } from '../src/models/bookCopy.model.js';
import { DocumentRequest } from '../src/models/documentRequest.model.js';
import { ReviewCase } from '../src/models/ptm.model.js';
import { Subject, SubjectOffering, Term } from '../src/models/academics.model.js';
import { Assignment } from '../src/models/assignment.model.js';
import * as ptm from '../src/modules/ptm/ptm.service.js';
import * as clubs from '../src/modules/clubs/clubs.service.js';
import * as clubSessions from '../src/modules/clubs/sessions.service.js';
import * as reportcards from '../src/modules/reportcards/reportcards.service.js';
import * as green from '../src/modules/sustainability/sustainability.service.js';
import * as library from '../src/modules/library/library.service.js';
import * as copies from '../src/modules/library/library.copies.js';
import * as docTypes from '../src/modules/documentRequests/documentType.service.js';
import * as showcase from '../src/modules/showcase/showcase.service.js';
import { seedSchool, seedPerson, mcp, proposeAndConfirm, inSchool, OAK } from './support/mcpSchool.js';

/**
 * The people-facing platform tools (tools/platformPeople.js) and the older-
 * module gap tools (tools/platformGaps.js), through the real MCP server.
 *
 * For the whole set: the contract every tool keeps (closed schema, a write is
 * confirmed and summarised, nothing decides by name, the weighty ones are
 * website-only, a caller without the permission is refused before anything is
 * proposed). Then each module's flows with real records: draft first, nothing
 * changes until the same person says yes, another person's "yes" does nothing,
 * a parent acts only for their own child, a teacher only for their own class.
 */

const MINE = { ...platformPeopleTools, ...platformGapTools };
const NAMES = Object.keys(MINE);
const WRITES = NAMES.filter((n) => mutates(MCP_TOOLS[n]));

let school;
beforeEach(async () => {
  school = await seedSchool();
});
afterAll(async () => {
  await resetMcpClient();
});

const oak = (fn) => inSchool(OAK, fn);
const days = (n) => new Date(Date.now() + n * 86_400_000);
const istYmd = (d) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const actions = () => oak(() => AgentAction.countDocuments({}));
const without = (actor, key) => {
  const { [key]: _gone, ...rest } = actor.permissions;
  return { ...actor, permissions: rest };
};
async function enableFeatures(features) {
  await School.updateOne({ slug: OAK }, { $set: { slug: OAK, name: 'Oakridge Academy', ...Object.fromEntries(Object.entries(features).map(([k, v]) => [`features.${k}`, v])) } }, { upsert: true });
}

/* ── The contract, for every tool in the two files ───────── */

describe('the platform people and gap tools keep the MCP contract', () => {
  it('are all registered, and there are 62 of them (47 people + 15 gaps)', () => {
    expect(Object.keys(platformPeopleTools)).toHaveLength(47);
    expect(Object.keys(platformGapTools)).toHaveLength(15);
    for (const n of NAMES) expect(MCP_TOOLS[n], n).toBeTruthy();
  });

  it('declare a closed schema that refuses unknown arguments', () => {
    for (const n of NAMES) {
      const schema = MCP_TOOLS[n].inputSchema;
      expect(schema.additionalProperties, n).toBe(false);
      expect(validateArgs(schema, { notAParameter: 1 }).valid, n).toBe(false);
    }
  });

  it('confirm and summarise every write; no read asks for confirmation', () => {
    for (const n of NAMES) {
      const t = MCP_TOOLS[n];
      if (mutates(t)) {
        expect(t.confirm, `${n} writes without confirmation`).toBe(true);
        expect(typeof t.summarise, n).toBe('function');
      } else expect(Boolean(t.confirm), n).toBe(false);
    }
  });

  it('none is named as a decision, and the weighty ones are confirmed on the website only', () => {
    for (const n of NAMES) expect(isDecidingToolName(n), n).toBe(false);
    for (const n of ['send_social_post', 'verify_eco_activity', 'mark_club_attendance', 'save_term_report_remarks', 'lend_copy_by_accession']) {
      expect(confirmableOn(MCP_TOOLS[n], 'WHATSAPP'), n).toBe(false);
      expect(confirmableOn(MCP_TOOLS[n], 'WEB'), n).toBe(true);
    }
    // A parent's own low-impact filings can be confirmed on WhatsApp.
    for (const n of ['reserve_ptm_slot', 'send_conversation_message', 'join_club', 'request_certificate']) {
      expect(confirmableOn(MCP_TOOLS[n], 'WHATSAPP'), n).toBe(true);
    }
  });

  it('take no identity or scope argument', () => {
    const IDENTITY = ['actorProfileId', 'userId', 'profileId', 'roleKey', 'role', 'tenantId', 'scope', 'permissions', 'parentProfileId', 'staffProfileId', 'teacherProfileId'];
    for (const n of NAMES) {
      const props = Object.keys(MCP_TOOLS[n].inputSchema?.properties ?? {});
      expect(props.filter((p) => IDENTITY.includes(p)), n).toEqual([]);
    }
  });

  it('refuse a caller without the permission before anything is proposed, for every tool', async () => {
    const admin = school.people.ADMIN.actor;
    for (const n of NAMES) {
      const res = await mcp(OAK, without(admin, MCP_TOOLS[n].permission), n, {});
      expect(res.error?.code, n).toBe('FORBIDDEN');
    }
    expect(await actions()).toBe(0);
  }, 120_000);

  it('show students and parents no staff-only capability', () => {
    const parent = mcpToolsFor(school.people.PARENT.actor).map((t) => t.name);
    const student = mcpToolsFor(school.people.STUDENT.actor).map((t) => t.name);
    for (const n of ['draft_social_post', 'send_social_post', 'verify_eco_activity', 'log_waste', 'mark_club_attendance', 'save_term_report_remarks', 'lend_copy_by_accession', 'list_online_applications', 'draft_showcase_entry', 'open_review_call']) {
      expect(parent, n).not.toContain(n);
      expect(student, n).not.toContain(n);
    }
    expect(parent).toEqual(expect.arrayContaining(['reserve_ptm_slot', 'send_conversation_message', 'consent_to_club_join', 'get_my_term_report_cards', 'request_certificate']));
  });
});

/* ── PTM ──────────────────────────────────────────────────── */

async function ptmRound() {
  const start = istYmd(days(3));
  return oak(() => ptm.createRound(school.people.ADMIN.actor, 'ALL', {
    title: 'Term 1 PTM', startsOn: start, endsOn: start, slotMinutes: 10, bufferMinutes: 0, sectionIds: [String(school.sectionA._id)],
  }));
}

describe('PTM through the assistant', () => {
  it('a teacher opens their own slots, a parent books for their own child, and only on their own "yes"', async () => {
    const round = await ptmRound();
    const avail = await proposeAndConfirm(OAK, school.people.TEACHER.actor, 'add_ptm_availability', { date: round.startsOn, from: '16:00', to: '16:30' });
    expect(avail.proposal.action.summary).toMatch(/16:00 to 16:30/);
    expect(avail.done.success, JSON.stringify(avail.done.error)).toBe(true);

    const parent = school.people.PARENT.actor;
    const slots = await mcp(OAK, parent, 'get_ptm_slots', {});
    expect(slots.success, JSON.stringify(slots.error)).toBe(true);
    expect(slots.data.children[0].child).toBe('Rahul Sharma');

    const proposal = await mcp(OAK, parent, 'reserve_ptm_slot', { teacherName: 'class teacher', time: '16:10' });
    expect(proposal.action?.status, JSON.stringify(proposal.error)).toBe('confirmation_required');
    expect(proposal.action.summary).toMatch(/Rahul Sharma with .* 16:10/);
    expect(await oak(() => PtmBooking.countDocuments({}))).toBe(0);

    // Another parent's "yes" does nothing.
    const other = await seedPerson({ roleKey: 'PARENT', roleId: school.roleIds.PARENT, displayName: 'Other parent' });
    const stolen = await mcp(OAK, other.actor, 'reserve_ptm_slot', {}, { confirmationToken: proposal.action.confirmationToken });
    expect(stolen.success).toBe(false);
    expect(await oak(() => PtmBooking.countDocuments({}))).toBe(0);

    const done = await mcp(OAK, parent, 'reserve_ptm_slot', {}, { confirmationToken: proposal.action.confirmationToken });
    expect(done.success, JSON.stringify(done.error)).toBe(true);
    expect(await oak(() => PtmBooking.countDocuments({ active: true }))).toBe(1);

    const mine = await mcp(OAK, parent, 'list_my_ptm_bookings', {});
    expect(mine.data.bookings).toHaveLength(1);
    const teacherSees = await mcp(OAK, school.people.TEACHER.actor, 'list_my_ptm_bookings', {});
    expect(teacherSees.data.bookings[0].child).toBe('Rahul Sharma');

    const moved = await proposeAndConfirm(OAK, parent, 'reschedule_ptm_booking', { time: '16:20' });
    expect(moved.done.success, JSON.stringify(moved.done.error)).toBe(true);
    const cancelled = await proposeAndConfirm(OAK, parent, 'cancel_ptm_booking', {});
    expect(cancelled.done.success, JSON.stringify(cancelled.done.error)).toBe(true);
    expect(await oak(() => PtmBooking.countDocuments({ active: true }))).toBe(0);
  }, 60_000);

  it('a parent cannot book for a child who is not theirs', async () => {
    const round = await ptmRound();
    await proposeAndConfirm(OAK, school.people.TEACHER.actor, 'add_ptm_availability', { date: round.startsOn, from: '16:00', to: '16:30' });
    const res = await mcp(OAK, school.people.PARENT.actor, 'reserve_ptm_slot', { studentName: 'Priya Verma' });
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('FORBIDDEN');
    expect(await oak(() => AgentAction.countDocuments({ tool: 'reserve_ptm_slot' }))).toBe(0);
  }, 60_000);
});

/* ── Conversations ────────────────────────────────────────── */

describe('parent–teacher conversations', () => {
  it('a parent messages the class teacher; the teacher sees it unread and reads it', async () => {
    const parent = school.people.PARENT.actor;
    const p = await mcp(OAK, parent, 'send_conversation_message', { message: 'Rahul was unwell yesterday. Call me on 9876543210.' });
    expect(p.action?.status, JSON.stringify(p.error)).toBe('confirmation_required');
    expect(p.action.summary).toMatch(/about Rahul Sharma/);
    expect(await oak(() => ConversationThread.countDocuments({}))).toBe(0);
    const done = await mcp(OAK, parent, 'send_conversation_message', {}, { confirmationToken: p.action.confirmationToken });
    expect(done.success, JSON.stringify(done.error)).toBe(true);
    const msg = await oak(() => ConversationMessage.findOne({}).lean());
    expect(msg.body).not.toMatch(/9876543210/);

    const teacher = school.people.TEACHER.actor;
    const unread = await mcp(OAK, teacher, 'list_conversations', { unreadOnly: true });
    expect(unread.data.unread).toBe(1);
    const read = await mcp(OAK, teacher, 'read_conversation', { studentName: 'Rahul' });
    expect(read.data.messages[0].text).toMatch(/unwell/);
    expect((await mcp(OAK, teacher, 'list_conversations', { unreadOnly: true })).data.unread).toBe(0);
  }, 60_000);

  it('a parent cannot message about another child', async () => {
    const res = await mcp(OAK, school.people.PARENT.actor, 'send_conversation_message', { message: 'Hello', studentName: 'Riya Kapoor' });
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('FORBIDDEN');
  });
});

/* ── Report cards ─────────────────────────────────────────── */

describe('term report cards', () => {
  it('the class teacher drafts a remark (nothing saved) and saves remarks on confirmation', async () => {
    const teacher = school.people.TEACHER.actor;
    const tpl = await oak(() => reportcards.ensureDefaultTemplate());
    await oak(() => reportcards.generate(teacher, 'OWN', { sectionId: String(school.sectionA._id), templateId: String(tpl._id), termKey: 'TERM_1' }));

    const draft = await mcp(OAK, teacher, 'get_term_report_remark_draft', { studentName: 'Rahul Sharma' });
    expect(draft.success, JSON.stringify(draft.error)).toBe(true);
    expect(draft.data.saved).toBe(false);
    expect(await oak(() => TermReportCard.countDocuments({ classTeacherRemarks: { $ne: null } }))).toBe(0);

    const saved = await proposeAndConfirm(OAK, teacher, 'save_term_report_remarks', { studentName: 'Rahul Sharma', remarks: 'A steady, cheerful term.' });
    expect(saved.done.success, JSON.stringify(saved.done.error)).toBe(true);
    const card = await oak(() => TermReportCard.findOne({ studentId: school.rahul.student._id }).lean());
    expect(card.classTeacherRemarks).toBe('A steady, cheerful term.');

    // Riya is in a class this teacher does not teach.
    const refused = await mcp(OAK, teacher, 'save_term_report_remarks', { studentName: 'Riya Kapoor', remarks: 'x' });
    expect(refused.success).toBe(false);
    // Families see published cards only; none is published yet.
    const family = await mcp(OAK, school.people.PARENT.actor, 'get_my_term_report_cards', {});
    expect(family.success, JSON.stringify(family.error)).toBe(true);
    expect(family.data.count).toBe(0);
  }, 60_000);
});

/* ── Clubs ────────────────────────────────────────────────── */

describe('clubs', () => {
  it('a parent asks to join for their child; consent only for their own child; the coach takes the register', async () => {
    const teacher = school.people.TEACHER.actor;
    const club = await oak(() => clubs.createClub(school.people.ADMIN.actor, 'ALL', { name: 'Chess Club', category: 'ACADEMIC', capacity: 20, coachProfileIds: [teacher.profileId] }));
    const parent = school.people.PARENT.actor;
    const joined = await proposeAndConfirm(OAK, parent, 'join_club', { club: 'Chess' });
    expect(joined.proposal.action.summary).toMatch(/Rahul Sharma to join Chess Club/);
    expect(joined.done.success, JSON.stringify(joined.done.error)).toBe(true);

    // Priya (a minor) asks herself: it waits for a parent's consent. Rahul's
    // father is not her parent, so nothing is waiting on him.
    const asked = await proposeAndConfirm(OAK, school.people.STUDENT.actor, 'join_club', { club: 'Chess Club' });
    expect(asked.done.data.status).toBe('AWAITING_CONSENT');
    const notMine = await mcp(OAK, parent, 'consent_to_club_join', { club: 'Chess' });
    expect(notMine.success).toBe(false);
    expect(notMine.error.code).toBe('NOT_FOUND');
    // Once he is her guardian, he can.
    await oak(() => StudentGuardian.create({ studentId: school.priya.student._id, guardianProfileId: parent.profileId, relation: 'FATHER' }));
    const consent = await proposeAndConfirm(OAK, parent, 'consent_to_club_join', { club: 'Chess', studentName: 'Priya' });
    expect(consent.done.success, JSON.stringify(consent.done.error)).toBe(true);
    expect((await oak(() => ClubMembership.findOne({ studentId: school.priya.student._id }).lean())).status).toBe('AWAITING_APPROVAL');

    // The coach approves Rahul on the screen, then registers a session through the assistant.
    const m = await oak(() => ClubMembership.findOne({ studentId: school.rahul.student._id }).lean());
    await oak(() => clubs.decideJoin(teacher, 'OWN', String(m._id), { decision: 'APPROVE' }));
    await oak(() => clubSessions.createSessions(teacher, 'OWN', club.id, { date: istYmd(new Date()), from: '00:00', to: '23:59', venueText: 'Library' }));
    const reg = await proposeAndConfirm(OAK, teacher, 'mark_club_attendance', { club: 'Chess', absent: ['Rahul'] });
    expect(reg.proposal.action.summary).toMatch(/absent: Rahul Sharma/);
    expect(reg.done.success, JSON.stringify(reg.done.error)).toBe(true);
    const s = await oak(() => ClubSession.findOne({}).lean());
    expect(s.attendance[0].status).toBe('ABSENT');
  }, 60_000);
});

/* ── Sustainability ───────────────────────────────────────── */

describe('sustainability', () => {
  it('a teacher logs an activity, cannot verify it themselves, and a verifier verifies it on the website only', async () => {
    const teacher = school.people.TEACHER.actor;
    await oak(() => green.createTeam(school.people.ADMIN.actor, { kind: 'CLASS', name: 'Class 6 A', sectionId: String(school.sectionA._id) }));
    const logged = await proposeAndConfirm(OAK, teacher, 'log_eco_activity', { team: 'Class 6 A', title: 'Campus clean-up', category: 'CLEANUP', participants: 30 });
    expect(logged.done.success, JSON.stringify(logged.done.error)).toBe(true);

    const self = await mcp(OAK, teacher, 'verify_eco_activity', { activity: 'Campus clean-up', decision: 'VERIFY', evidenceSeen: true });
    expect(self.success).toBe(false);

    const admin = school.people.ADMIN.actor;
    const onWa = await mcp(OAK, admin, 'verify_eco_activity', { activity: 'Campus clean-up', decision: 'VERIFY', evidenceSeen: true }, { channel: 'WHATSAPP' });
    expect(onWa.error?.details?.reason).toBe('CONFIRM_ON_WEB');
    const verified = await proposeAndConfirm(OAK, admin, 'verify_eco_activity', { activity: 'Campus clean-up', decision: 'VERIFY', evidenceSeen: true, points: 5 });
    expect(verified.done.success, JSON.stringify(verified.done.error)).toBe(true);
    expect((await oak(() => EcoActivity.findOne({}).lean())).status).toBe('VERIFIED');

    const board = await mcp(OAK, school.people.STUDENT.actor, 'get_eco_points', {});
    expect(board.data.schoolPoints).toBe(5);
  }, 60_000);

  it('waste and meter readings are school-wide registers', async () => {
    expect((await mcp(OAK, school.people.TEACHER.actor, 'log_waste', { stream: 'DRY', weightKg: 4 })).error.code).toBe('FORBIDDEN_SCOPE');
    const w = await proposeAndConfirm(OAK, school.people.ADMIN.actor, 'log_waste', { stream: 'DRY', weightKg: 4 });
    expect(w.done.success, JSON.stringify(w.done.error)).toBe(true);
    const m = await proposeAndConfirm(OAK, school.people.ADMIN.actor, 'log_meter_reading', { kind: 'WATER', period: '2026-09', quantity: 120 });
    expect(m.done.success, JSON.stringify(m.done.error)).toBe(true);
  }, 60_000);
});

/* ── Social, digest, drafts, showcase ─────────────────────── */

describe('social publishing stays simulated and needs a person on the website', () => {
  it('is refused while the school has it switched off', async () => {
    const res = await mcp(OAK, school.people.ADMIN.actor, 'draft_social_post', { text: 'Annual day!', networks: ['FACEBOOK'], noIdentifiableStudents: true });
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('FORBIDDEN');
    expect(await actions()).toBe(0);
  });

  it('drafts, then sends only on confirmation, recording SIMULATED', async () => {
    await enableFeatures({ socialPublishing: true });
    const admin = school.people.ADMIN.actor;
    const untagged = await mcp(OAK, admin, 'draft_social_post', { text: 'Annual day!', networks: ['FACEBOOK'] });
    expect(untagged.error.code).toBe('NEEDS_INPUT');
    const draft = await proposeAndConfirm(OAK, admin, 'draft_social_post', { text: 'Annual day!', networks: ['FACEBOOK', 'X'], noIdentifiableStudents: true });
    expect(draft.done.success, JSON.stringify(draft.done.error)).toBe(true);
    expect(await oak(() => SocialOutbox.countDocuments({ status: 'QUEUED' }))).toBe(2);

    const sendWa = await mcp(OAK, admin, 'send_social_post', {}, { channel: 'WHATSAPP' });
    expect(sendWa.error?.details?.reason).toBe('CONFIRM_ON_WEB');
    const p = await mcp(OAK, admin, 'send_social_post', {});
    expect(p.action.status).toBe('confirmation_required');
    expect(await oak(() => SocialOutbox.countDocuments({ status: 'SIMULATED' }))).toBe(0);
    const sent = await mcp(OAK, admin, 'send_social_post', {}, { confirmationToken: p.action.confirmationToken });
    expect(sent.success, JSON.stringify(sent.error)).toBe(true);
    expect(await oak(() => SocialOutbox.countDocuments({ status: 'SIMULATED' }))).toBe(2);
    expect(sent.speak).toMatch(/Simulated/);
  }, 60_000);
});

describe('digest, AI drafts and the showcase', () => {
  it('changes only the caller\'s own digest interests, on confirmation', async () => {
    const parent = school.people.PARENT.actor;
    const r = await proposeAndConfirm(OAK, parent, 'update_my_digest_interests', { interests: ['SCIENCE', 'SPORTS'] });
    expect(r.done.success, JSON.stringify(r.done.error)).toBe(true);
    const pref = await oak(() => DigestPreference.findOne({ profileId: parent.profileId }).lean());
    expect(pref.interests.sort()).toEqual(['SCIENCE', 'SPORTS']);
    expect((await mcp(OAK, parent, 'get_my_digest', {})).success).toBe(true);
  });

  it('drafts a letter without saving or sending anything, with contact numbers removed', async () => {
    const res = await mcp(OAK, school.people.TEACHER.actor, 'get_ai_draft', { kind: 'LETTER', recipient: 'Parents of Class 6 A', purpose: 'The trip is on Friday. Call 9876543210 with questions.' });
    expect(res.success, JSON.stringify(res.error)).toBe(true);
    expect(res.data.saved).toBe(false);
    expect(res.data.draft).not.toMatch(/9876543210/);
    expect(await actions()).toBe(0);
  });

  it('a publisher drafts a showcase entry; families only read the published showcase', async () => {
    await oak(() => showcase.createEdition(school.people.ADMIN.actor, { title: 'October achievers' }));
    const d = await proposeAndConfirm(OAK, school.people.ADMIN.actor, 'draft_showcase_entry', { studentName: 'Rahul Sharma', title: 'Gold, district chess', category: 'OLYMPIAD' });
    expect(d.done.success, JSON.stringify(d.done.error)).toBe(true);
    expect(d.done.data.status).toBe('DRAFT');
    const family = await mcp(OAK, school.people.PARENT.actor, 'get_showcase', {});
    expect(family.success).toBe(true);
    expect(family.data.count).toBe(0);
  }, 60_000);
});

/* ── Review calls ─────────────────────────────────────────── */

describe('review calls', () => {
  it('a teacher opens one for their own pupil, logs an attempt and schedules it; not for another class', async () => {
    const teacher = school.people.TEACHER.actor;
    const open = await proposeAndConfirm(OAK, teacher, 'open_review_call', { studentName: 'Rahul Sharma', reason: 'ATTENDANCE', summary: 'Absent often' });
    expect(open.done.success, JSON.stringify(open.done.error)).toBe(true);
    const attempt = await proposeAndConfirm(OAK, teacher, 'log_review_call_attempt', { studentName: 'Rahul', channel: 'PHONE', reached: false });
    expect(attempt.done.success, JSON.stringify(attempt.done.error)).toBe(true);
    const sched = await proposeAndConfirm(OAK, teacher, 'update_review_call_schedule', { studentName: 'Rahul', date: istYmd(days(2)), time: '11:00' });
    expect(sched.done.success, JSON.stringify(sched.done.error)).toBe(true);
    const list = await mcp(OAK, teacher, 'list_review_calls', {});
    expect(list.data.calls[0]).not.toHaveProperty('notes');
    expect((await oak(() => ReviewCase.findOne({}).lean())).status).toBe('SCHEDULED');

    const other = await mcp(OAK, teacher, 'open_review_call', { studentName: 'Riya Kapoor', reason: 'ATTENDANCE' });
    expect(other.success).toBe(false);
  }, 60_000);
});

/* ── Library copies ───────────────────────────────────────── */

describe('library copies by accession number', () => {
  it('issues and takes back a copy on the librarian\'s confirmation', async () => {
    const lib = school.people.LIBRARIAN.actor;
    const book = await oak(() => library.createBook({ title: 'Wings of Fire', author: 'A. P. J. Abdul Kalam', totalCopies: 1 }, lib));
    const made = await oak(() => copies.generateCopies({ bookId: String(book._id ?? book.id) }));
    const acc = made.created[0].accessionNo;
    const found = await mcp(OAK, lib, 'find_library_copy', { accessionNo: acc });
    expect(found.data.status).toBe('AVAILABLE');
    const issued = await proposeAndConfirm(OAK, lib, 'lend_copy_by_accession', { accessionNo: acc, admissionNo: 'OAK-1' });
    expect(issued.done.success, JSON.stringify(issued.done.error)).toBe(true);
    expect((await oak(() => BookCopy.findOne({ accessionNo: acc }).lean())).status).toBe('ISSUED');
    const back = await proposeAndConfirm(OAK, lib, 'checkin_copy_by_accession', { accessionNo: acc });
    expect(back.done.success, JSON.stringify(back.done.error)).toBe(true);
    expect((await oak(() => BookCopy.findOne({ accessionNo: acc }).lean())).status).toBe('AVAILABLE');
  }, 60_000);
});

/* ── The older-module gap tools ───────────────────────────── */

describe('older-module gaps', () => {
  it('a parent requests a certificate for their own child and cancels it; staff cannot use the family route', async () => {
    await oak(() => docTypes.create(school.people.ADMIN.actor, { name: 'Bonafide certificate', isActive: true, requestEnabled: true }));
    const parent = school.people.PARENT.actor;
    const types = await mcp(OAK, parent, 'list_certificate_types', {});
    expect(types.data.types.map((t) => t.name)).toContain('Bonafide certificate');
    const r = await proposeAndConfirm(OAK, parent, 'request_certificate', { document: 'Bonafide', purpose: 'Passport application' });
    expect(r.done.success, JSON.stringify(r.done.error)).toBe(true);
    const req = await oak(() => DocumentRequest.findOne({}).lean());
    expect(String(req.studentId)).toBe(String(school.rahul.student._id));
    const c = await proposeAndConfirm(OAK, parent, 'cancel_certificate_request', {});
    expect(c.done.success, JSON.stringify(c.done.error)).toBe(true);
    expect((await mcp(OAK, school.people.TEACHER.actor, 'list_certificate_types', {})).success).toBe(false);
    expect((await mcp(OAK, parent, 'request_certificate', { document: 'Bonafide', purpose: 'x', studentName: 'Riya' })).success).toBe(false);
  }, 60_000);

  it('a teacher extends the due date of homework they set', async () => {
    const teacher = school.people.TEACHER;
    await oak(async () => {
      const term = await Term.create({ academicYearId: school.year._id, name: 'Term 1', startsOn: new Date('2026-04-01'), endsOn: new Date('2027-03-31') });
      const subject = await Subject.create({ name: 'Mathematics' });
      const off = await SubjectOffering.create({ sectionId: school.sectionA._id, subjectId: subject._id, termId: term._id, teacherId: teacher.profile._id });
      await Assignment.create({ subjectOfferingId: off._id, title: 'Fractions worksheet', dueAt: days(3) });
    });
    const due = istYmd(days(10));
    const r = await proposeAndConfirm(OAK, teacher.actor, 'update_assignment', { homework: 'Fractions', dueAt: due });
    expect(r.proposal.action.summary).toMatch(new RegExp(`due date to ${due}`));
    expect(r.done.success, JSON.stringify(r.done.error)).toBe(true);
    const a = await oak(() => Assignment.findOne({}).lean());
    expect(istYmd(a.dueAt)).toBe(due);
  }, 60_000);

  it('staff report a repair and draft a purchase request, each on confirmation', async () => {
    const t = school.people.TEACHER.actor;
    const wo = await proposeAndConfirm(OAK, t, 'report_repair', { title: 'Fan not working in 6 A', category: 'ELECTRICAL' });
    expect(wo.done.success, JSON.stringify(wo.done.error)).toBe(true);
    expect((await mcp(OAK, t, 'list_my_maintenance_reports', {})).data.count).toBe(1);
    const pr = await proposeAndConfirm(OAK, t, 'create_purchase_request', { title: 'Chart paper', items: [{ description: 'Chart paper', qty: 50, estUnitPrice: 10 }] });
    expect(pr.proposal.action.summary).toMatch(/₹500/);
    expect(pr.done.success, JSON.stringify(pr.done.error)).toBe(true);
    expect(pr.done.data.status).toBe('DRAFT');
  }, 60_000);
});
