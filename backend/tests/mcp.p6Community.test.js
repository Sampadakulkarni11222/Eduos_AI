import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { MCP_TOOLS, mcpToolsFor, confirmableOn, validateMcpRegistry } from '../src/modules/ai/mcp/registry.js';
import { tools as communityTools } from '../src/modules/ai/mcp/tools/p6/community.js';
import { isDecidingToolName } from '../src/modules/ai/mcp/decisions.js';
import { STRIPPED_ARGS } from '../src/modules/ai/mcp/session.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { Club, ClubMembership, ClubEquipment, EquipmentIssue, House, HouseMembership, Fixture } from '../src/models/club.model.js';
import { ShowcaseEdition, ShowcaseEntry } from '../src/models/showcase.model.js';
import { SustainabilityZone, SanitationDuty, SanitationCheck } from '../src/models/sustainability.model.js';
import { CommunityPost, CommunityComment, MediaConsent } from '../src/models/community.model.js';
import { AlumniProfile, AlumniEvent } from '../src/models/alumni.model.js';
import { School } from '../src/models/school.model.js';
import { inSchool, mcp, actorForRole, OAK } from './support/mcpSchool.js';
import { seedFamilySchool } from './support/familySchool.js';

/**
 * Part-6 coverage, community area (tools/p6/community.js): clubs, houses,
 * fixtures and kit; the showcase; sustainability; newsroom, circles, consent
 * and mentoring; alumni administration; social status reads. Every write is a
 * draft that changes nothing until the same person confirms it; decisions are
 * approver-confirmed on the website; the services' own rules (coach of this
 * club, a second person decides, consent, staff-only publishing) still decide.
 */
const NAMES = Object.keys(communityTools);
let s;
const inOak = (fn) => inSchool(OAK, fn);

async function confirm(actor, name, args, { unchanged, channel = 'WEB' } = {}) {
  const proposal = await mcp(OAK, actor, name, args, { channel });
  expect(proposal.success, `${name}: ${JSON.stringify(proposal.error)}`).toBe(true);
  expect(proposal.action.status).toBe('confirmation_required');
  if (unchanged) expect(await unchanged()).toBe(true);
  const done = await mcp(OAK, actor, name, {}, { channel, confirmationToken: proposal.action.confirmationToken });
  expect(done.success, `${name}: ${JSON.stringify(done.error)}`).toBe(true);
  return { proposal, done };
}

beforeEach(async () => { s = await seedFamilySchool(); });
afterAll(async () => { await resetMcpClient(); });

describe('the contract', () => {
  it('registers closed, non-deciding tools; writes confirm and summarise; approver tools are HIGH, web-only and need a stated decision', () => {
    expect(NAMES.length).toBe(105);
    for (const n of NAMES) {
      const t = MCP_TOOLS[n];
      expect(t, n).toBeTruthy();
      expect(t.inputSchema.additionalProperties, n).toBe(false);
      expect(isDecidingToolName(n), n).toBe(false);
      for (const k of Object.keys(t.inputSchema.properties ?? {})) expect(STRIPPED_ARGS.has(k), `${n}.${k}`).toBe(false);
      if (t.operation !== 'GET') {
        expect(t.confirm, n).toBe(true);
        expect(typeof t.summarise, n).toBe('function');
        expect(() => t.summarise({}, actorForRole('ADMIN'), null), n).not.toThrow();
      }
      if (t.approverDecision) {
        expect(t.risk, n).toBe('HIGH');
        expect(t.affectsOthers, n).toBe(true);
        expect(t.inputSchema.required, n).toContain('decision');
        expect(t.inputSchema.properties.decision.default, n).toBeUndefined();
        expect(confirmableOn(t, 'WHATSAPP'), n).toBe(false);
      }
    }
    expect(NAMES.filter((n) => communityTools[n].approverDecision).sort()).toEqual([
      'moderate_alumni_post', 'moderate_newsroom_comment', 'moderate_newsroom_post', 'record_circle_join_decision', 'record_club_join_decision',
      'record_fixture_result_decision', 'record_mentoring_request_decision', 'record_showcase_entry_review', 'resolve_community_report',
    ]);
    expect(validateMcpRegistry()).toEqual([]);
    // A person's own low-impact act stays confirmable on WhatsApp.
    for (const n of ['set_child_media_consent', 'join_or_leave_circle', 'react_to_newsroom_post', 'draft_newsroom_post', 'request_mentoring']) {
      expect(confirmableOn(MCP_TOOLS[n], 'WHATSAPP'), n).toBe(true);
    }
  });

  it('shows families no publishing, moderation or administration tools', () => {
    const visible = (role) => mcpToolsFor(actorForRole(role)).map((t) => t.name).filter((n) => NAMES.includes(n));
    const staffOnly = ['list_social_accounts', 'get_social_post', 'list_newsroom_social_statuses', 'release_showcase_edition', 'record_showcase_entry_review', 'list_community_reports', 'resolve_community_report', 'record_media_consent_form', 'move_to_alumni', 'record_club_join_decision', 'add_sustainability_zone'];
    for (const role of ['PARENT', 'STUDENT', 'ALUMNUS']) {
      const v = visible(role);
      for (const n of staffOnly) expect(v, `${role} ${n}`).not.toContain(n);
    }
    expect(visible('PARENT')).toContain('set_child_media_consent');
    expect(visible('TEACHER')).not.toContain('set_child_media_consent');
    expect(visible('HR')).toEqual(expect.arrayContaining(['move_to_alumni', 'list_alumni_records', 'list_alumni_event_rsvps']));
  });
});

describe('clubs', () => {
  it('a coach decides a join request on the website only; another teacher cannot; roles, kit and portfolio follow the club rules', async () => {
    const T = s.people.TEACHER.actor;
    const club = await inOak(() => Club.create({ code: 'CHESS', name: 'Chess club', category: 'ACADEMIC', capacity: 10, coachProfileIds: [s.people.TEACHER.profile._id] }));
    await inOak(() => ClubMembership.create({ clubId: club._id, studentId: s.rahul.student._id, status: 'AWAITING_APPROVAL', isOpen: true, requestedByProfileId: s.people.PARENT.profile._id, requestedByRole: 'PARENT', consent: { required: true, givenAt: new Date(), givenByProfileId: s.people.PARENT.profile._id } }));

    const queue = await mcp(OAK, T, 'list_club_join_requests');
    expect(queue.success, JSON.stringify(queue.error)).toBe(true);
    expect(queue.data.items.map((r) => r.student)).toEqual(['Rahul Sharma']);

    const wa = await mcp(OAK, T, 'record_club_join_decision', { studentName: 'Rahul', decision: 'APPROVE' }, { channel: 'WHATSAPP' });
    expect(wa.error?.details?.reason).toBe('CONFIRM_ON_WEB');
    const other = await mcp(OAK, s.people.T2.actor, 'record_club_join_decision', { studentName: 'Rahul', decision: 'APPROVE' });
    expect(other.success).toBe(false);

    await confirm(T, 'record_club_join_decision', { club: 'Chess', studentName: 'Rahul', decision: 'APPROVE' }, { unchanged: async () => (await inOak(() => ClubMembership.findOne().lean())).status === 'AWAITING_APPROVAL' });
    expect((await inOak(() => ClubMembership.findOne().lean())).status).toBe('ACTIVE');

    await confirm(T, 'set_club_member_role', { club: 'Chess', studentName: 'Rahul', clubRole: 'CAPTAIN' });
    expect((await inOak(() => ClubMembership.findOne().lean())).role).toBe('CAPTAIN');

    await confirm(T, 'add_club_equipment', { name: 'Chess set', quantity: 4, club: 'Chess' });
    await confirm(T, 'lend_club_equipment', { item: 'Chess set', studentName: 'Rahul', quantity: 1 });
    expect((await inOak(() => ClubEquipment.findOne().lean())).availableQty).toBe(3);
    await confirm(T, 'return_club_equipment', { item: 'Chess set' });
    expect((await inOak(() => EquipmentIssue.findOne().lean())).status).toBe('RETURNED');

    // A parent reads their own child's portfolio, never another child's.
    const mine = await mcp(OAK, s.people.PARENT.actor, 'get_club_portfolio', { studentName: 'Rahul Sharma' });
    expect(mine.success, JSON.stringify(mine.error)).toBe(true);
    expect(mine.data.clubs.map((c) => c.name)).toEqual(['Chess club']);
    const notMine = await mcp(OAK, s.people.PARENT.actor, 'get_club_portfolio', { admissionNo: 'OAK-3' });
    expect(notMine.success).toBe(false);

    await confirm(T, 'remove_club_member', { club: 'Chess', studentName: 'Rahul', reason: 'Moved to the debate team' });
    expect((await inOak(() => ClubMembership.findOne().lean())).status).toBe('LEFT');
  }, 90_000);

  it('administration sets up a house; a result is decided by someone other than its recorder', async () => {
    const admin = s.people.ADMIN.actor;
    await confirm(admin, 'create_house', { name: 'Blue house', colour: '#1E88E5', masters: [s.people.T2.profile.displayName] });
    await confirm(admin, 'assign_students_to_house', { house: 'Blue', students: ['OAK-1'] });
    expect(await inOak(() => HouseMembership.countDocuments())).toBe(1);
    const teacherHouse = await mcp(OAK, s.people.TEACHER.actor, 'create_house', { name: 'Red house' });
    expect(teacherHouse.success).toBe(false);
    expect(await inOak(() => House.countDocuments())).toBe(1);

    const club = await inOak(() => Club.create({ code: 'FOOT', name: 'Football team', category: 'SPORTS', capacity: 20, coachProfileIds: [s.people.TEACHER.profile._id] }));
    await inOak(() => Fixture.create({ refNo: 'FIX-0001', kind: 'EXTERNAL', title: 'Cup final', clubId: club._id, startsAt: new Date(Date.now() - 86_400_000), status: 'COMPLETED', result: { summary: 'Won 2-1', outcome: 'WON', status: 'PENDING_APPROVAL', recordedByProfileId: s.people.TEACHER.profile._id, recordedAt: new Date() } }));
    const own = await mcp(OAK, s.people.TEACHER.actor, 'record_fixture_result_decision', { fixture: 'Cup final', decision: 'APPROVE' });
    expect(own.success).toBe(false);
    await confirm(admin, 'record_fixture_result_decision', { fixture: 'Cup final', decision: 'APPROVE' });
    expect((await inOak(() => Fixture.findOne().lean())).result.status).toBe('APPROVED');
    const fx = await mcp(OAK, s.people.PARENT.actor, 'list_club_fixtures');
    expect(fx.success, JSON.stringify(fx.error)).toBe(true);
  }, 90_000);
});

describe('showcase', () => {
  it('a second publisher reviews, then the edition is released with consent checked again; families cannot publish', async () => {
    const admin = s.people.ADMIN.actor;
    await confirm(admin, 'create_showcase_edition', { title: 'Term 1 achievers' });
    const ed = await inOak(() => ShowcaseEdition.findOne().lean());
    await inOak(() => ShowcaseEntry.create({ editionId: ed._id, kind: 'ACHIEVEMENT', category: 'SPORTS', studentId: s.rahul.student._id, title: 'District chess gold', createdByProfileId: s.people.PRINCIPAL.profile._id }));
    await inOak(() => ShowcaseEntry.create({ editionId: ed._id, kind: 'ACHIEVEMENT', category: 'ARTS', studentId: s.aman.student._id, title: 'Painting prize', createdByProfileId: s.people.PRINCIPAL.profile._id }));
    await inOak(() => MediaConsent.create({ studentId: s.rahul.student._id, level: 'INTERNAL', grantedByProfileId: s.people.PARENT.profile._id, grantedByRole: 'PARENT' }));

    const self = await mcp(OAK, s.people.PRINCIPAL.actor, 'record_showcase_entry_review', { entry: 'Rahul', decision: 'APPROVE' });
    expect(self.success).toBe(false);
    await confirm(admin, 'record_showcase_entry_review', { entry: 'Rahul', decision: 'APPROVE' });
    await confirm(admin, 'record_showcase_entry_review', { entry: 'Aman', decision: 'APPROVE' });
    const wa = await mcp(OAK, admin, 'release_showcase_edition', {}, { channel: 'WHATSAPP' });
    expect(wa.error?.details?.reason).toBe('CONFIRM_ON_WEB');
    await confirm(admin, 'release_showcase_edition', { edition: 'Term 1' });
    const statuses = await inOak(() => ShowcaseEntry.find().sort({ title: 1 }).lean());
    expect(statuses.map((e) => e.status)).toEqual(['PUBLISHED', 'EXCLUDED']); // Aman has no consent

    const parent = await mcp(OAK, s.people.PARENT.actor, 'list_showcase_editions');
    expect(parent.success).toBe(false);
    const settings = await mcp(OAK, s.people.PARENT.actor, 'get_showcase_settings');
    expect(settings.data.rankCutoff).toBe(3);
  }, 90_000);
});

describe('sustainability', () => {
  it('a manager adds a zone and a duty; its owner records a check with a photo; a teacher cannot add zones and families cannot read registers', async () => {
    const admin = s.people.ADMIN.actor;
    await confirm(admin, 'add_sustainability_zone', { name: 'Block A toilets', kind: 'TOILET_BLOCK' });
    await confirm(admin, 'add_sanitation_duty', { kind: 'TOILET_CLEANING', title: 'Block A cleaning', zone: 'Block A', owner: s.people.TEACHER.profile.displayName });
    expect(await inOak(() => SanitationDuty.countDocuments())).toBe(1);
    const noPhoto = await mcp(OAK, s.people.TEACHER.actor, 'record_sanitation_check', { duty: 'Block A', allDone: true });
    expect(noPhoto.success).toBe(false);
    await confirm(s.people.TEACHER.actor, 'record_sanitation_check', { duty: 'Block A', allDone: true, photoUrl: '/uploads/check.jpg' });
    expect(await inOak(() => SanitationCheck.countDocuments({ allOk: true }))).toBe(1);
    const checks = await mcp(OAK, admin, 'list_sanitation_checks', { duty: 'Block A' });
    expect(checks.data.items).toHaveLength(1);

    const teacherZone = await mcp(OAK, s.people.TEACHER.actor, 'add_sustainability_zone', { name: 'Garden' });
    expect(teacherZone.success).toBe(false);
    expect(await inOak(() => SustainabilityZone.countDocuments())).toBe(1);
    const parentRead = await mcp(OAK, s.people.PARENT.actor, 'list_sustainability_zones');
    expect(parentRead.success).toBe(false);
    const pack = await mcp(OAK, admin, 'get_evidence_pack', { pack: 'shvr' });
    expect(pack.success, JSON.stringify(pack.error)).toBe(true);
  }, 90_000);
});

describe('newsroom and community', () => {
  it('a teacher drafts and submits; a moderator publishes; a parent comment waits for review; families never address the public', async () => {
    const T = s.people.TEACHER.actor;
    await confirm(T, 'draft_newsroom_post', { title: 'Science fair', body: 'Our science fair is on Friday.' });
    expect((await inOak(() => CommunityPost.findOne().lean())).status).toBe('DRAFT');
    await confirm(T, 'transition_newsroom_post', { step: 'SUBMIT', post: 'Science fair' });
    expect((await inOak(() => CommunityPost.findOne().lean())).status).toBe('PENDING_REVIEW');
    await confirm(s.people.ADMIN.actor, 'moderate_newsroom_post', { post: 'Science fair', decision: 'PUBLISH' });
    expect((await inOak(() => CommunityPost.findOne().lean())).status).toBe('PUBLISHED');

    const read = await mcp(OAK, s.people.PARENT.actor, 'get_newsroom_post', { post: 'Science fair' });
    expect(read.success, JSON.stringify(read.error)).toBe(true);
    await confirm(s.people.PARENT.actor, 'add_newsroom_comment', { post: 'Science fair', text: 'Looking forward to it!' });
    expect((await inOak(() => CommunityComment.findOne().lean())).status).toBe('PENDING');
    await confirm(s.people.ADMIN.actor, 'moderate_newsroom_comment', { comment: 'Looking forward', decision: 'APPROVE' });
    expect((await inOak(() => CommunityComment.findOne().lean())).status).toBe('VISIBLE');

    const pub = await mcp(OAK, s.people.STUDENT.actor, 'draft_newsroom_post', { body: 'Hello world', audience: 'PUBLIC' });
    expect(pub.success).toBe(false);
    expect(await inOak(() => CommunityPost.countDocuments())).toBe(1);
  }, 90_000);

  it("a parent sets their own child's media consent on WhatsApp; staff record a signed form on the website", async () => {
    await confirm(s.people.PARENT.actor, 'set_child_media_consent', { child: 'Riya', level: 'INTERNAL' }, { channel: 'WHATSAPP' });
    const row = await inOak(() => MediaConsent.findOne({ studentId: s.riya.student._id, withdrawnAt: null }).lean());
    expect(row.level).toBe('INTERNAL');
    const notMine = await mcp(OAK, s.people.PARENT.actor, 'set_child_media_consent', { child: 'Aman', level: 'PUBLIC' });
    expect(notMine.success).toBe(false);
    const wa = await mcp(OAK, s.people.ADMIN.actor, 'record_media_consent_form', { student: 'Aman', level: 'PUBLIC', evidence: 'Form 12' }, { channel: 'WHATSAPP' });
    expect(wa.error?.details?.reason).toBe('CONFIRM_ON_WEB');
    await confirm(s.people.ADMIN.actor, 'record_media_consent_form', { student: 'Aman', level: 'PUBLIC', evidence: 'Form 12' });
    expect((await inOak(() => MediaConsent.findOne({ studentId: s.aman.student._id }).lean())).evidence).toBe('Form 12');
  }, 60_000);
});

describe('alumni administration and social reads', () => {
  it('HR moves a student to alumni and plans a reunion; a teacher cannot', async () => {
    const hr = s.people.HR.actor;
    const refused = await mcp(OAK, s.people.TEACHER.actor, 'move_to_alumni', { admissionNo: 'OAK-3', reason: 'GRADUATED' });
    expect(refused.success).toBe(false);
    await confirm(hr, 'move_to_alumni', { admissionNo: 'OAK-3', reason: 'GRADUATED', batchYear: 2026 }, { unchanged: async () => (await inOak(() => AlumniProfile.countDocuments())) === 0 });
    const list = await mcp(OAK, hr, 'list_alumni_records');
    expect(list.data.items.map((a) => a.name)).toEqual(['Aman Gupta']);
    await confirm(hr, 'create_alumni_event', { title: 'Class of 2026 reunion', date: '2027-01-10', batchYear: 2026 });
    expect(await inOak(() => AlumniEvent.countDocuments())).toBe(1);
    const replies = await mcp(OAK, hr, 'list_alumni_event_rsvps');
    expect(replies.data.items).toHaveLength(1);
  }, 60_000);

  it('social reads are for staff who publish, behind the school switch', async () => {
    const off = await mcp(OAK, s.people.ADMIN.actor, 'list_social_accounts');
    expect(off.success).toBe(false);
    await School.updateOne({ slug: OAK }, { $set: { slug: OAK, name: 'Oakridge Academy', 'features.socialPublishing': true } }, { upsert: true });
    const on = await mcp(OAK, s.people.ADMIN.actor, 'list_social_accounts');
    expect(on.success, JSON.stringify(on.error)).toBe(true);
    const parent = await mcp(OAK, s.people.PARENT.actor, 'get_newsroom_social_options');
    expect(parent.data.available).toBe(false);
    const parentStatus = await mcp(OAK, s.people.PARENT.actor, 'list_newsroom_social_statuses');
    expect(parentStatus.success).toBe(false);
  }, 60_000);
});
