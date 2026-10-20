import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { seedRoles, seedPerson, inSchool, OAK, RIVER } from './support/mcpSchool.js';
import * as approvals from '../src/modules/approvals/approval.service.js';
import * as correspondence from '../src/modules/administration/correspondence.service.js';
import * as facilities from '../src/modules/administration/facility.service.js';
import * as events from '../src/modules/administration/events.service.js';
import * as verification from '../src/modules/administration/verification.service.js';
import * as compliance from '../src/modules/compliance/compliance.service.js';
import * as safeguarding from '../src/modules/compliance/safeguarding.service.js';
import * as governance from '../src/modules/governance/governance.service.js';
import * as institution from '../src/modules/institution/institution.service.js';
import * as org from '../src/modules/institution/org.service.js';
import { Student, Enrollment } from '../src/models/student.model.js';
import { Grade, Section } from '../src/models/academics.model.js';
import { CalendarEvent } from '../src/models/calendarEvent.model.js';
import { SafeguardingCase } from '../src/models/compliance.model.js';
import { Notification } from '../src/models/notification.model.js';
import { MessageOutbox } from '../src/models/messaging.model.js';
import { BoardMeeting } from '../src/models/governance.model.js';

/**
 * End-to-end administration scenarios, run against the real services, models,
 * tenancy plugin and approval engine (see docs/erp-operations/AUDIT.md).
 */

let roles;
let P;
const inOak = (fn) => inSchool(OAK, fn);
const approveAll = async (reqId) => {
  // Walk every stage with whoever holds its role.
  for (let i = 0; i < 5; i++) {
    const r = await inOak(() => approvals.getRequest(P.PRINCIPAL.actor, 'ALL', reqId));
    if (r.status !== 'PENDING') return r;
    const who = { PRINCIPAL: P.PRINCIPAL, FINANCE: P.FINANCE, TRUSTEE: P.TRUSTEE, ADMIN: P.ADMIN }[r.currentApproverRole];
    await inOak(() => approvals.decide(who.actor, reqId, { action: 'APPROVE', comment: 'ok' }));
  }
  return inOak(() => approvals.getRequest(P.PRINCIPAL.actor, 'ALL', reqId));
};

beforeEach(async () => {
  roles = await seedRoles();
  P = {};
  for (const key of ['ADMIN', 'PRINCIPAL', 'FINANCE', 'HR', 'COMPLIANCE', 'TEACHER', 'TRUSTEE', 'PARENT']) {
    P[key] = await seedPerson({ roleKey: key, roleId: roles[key], displayName: `${key} person` });
  }
  P.RIVER_ADMIN = await seedPerson({ roleKey: 'ADMIN', roleId: roles.ADMIN, tenantId: RIVER });
});

describe('Scenario: a circular is received, answered with principal approval, dispatched and acknowledged', () => {
  it('runs end to end and refuses shortcuts', async () => {
    const letter = await inOak(() => correspondence.register(P.ADMIN.actor, {
      direction: 'INWARD', counterpartyType: 'BOARD', counterpartyName: 'CBSE Regional Office', subject: 'Submission of safety audit',
      summary: 'Schools are directed to submit the safety audit report by 15/11/2026. Principals must ensure compliance.',
      theirReference: 'CBSE/RO/2026/123', ownerProfileId: P.ADMIN.actor.profileId,
    }));
    expect(letter.refNo).toMatch(/^INW\/\d{4}\/0001$/);
    const hints = await inOak(() => correspondence.suggest(P.ADMIN.actor, 'ALL', letter.id));
    expect(hints.deadlines.map((d) => d.date)).toContain('2026-11-15');
    expect(hints.actions.length).toBeGreaterThan(0);

    await inOak(() => correspondence.verifySource(P.ADMIN.actor, 'ALL', letter.id, { method: 'Official email domain' }));
    await inOak(() => correspondence.transition(P.ADMIN.actor, 'ALL', letter.id, { to: 'ACKNOWLEDGED' }));
    // Cannot dispatch before approval.
    await expect(inOak(() => correspondence.dispatch(P.ADMIN.actor, 'ALL', letter.id, { channel: 'EMAIL' }))).rejects.toMatchObject({ code: 'NOT_APPROVED' });
    await inOak(() => correspondence.saveDraft(P.ADMIN.actor, 'ALL', letter.id, { body: 'Respected Sir, the audit report is enclosed.' }));
    const sent = await inOak(() => correspondence.submitForApproval(P.ADMIN.actor, 'ALL', letter.id));
    expect(sent.status).toBe('AWAITING_APPROVAL');
    // Editing while with the approver is refused.
    await expect(inOak(() => correspondence.saveDraft(P.ADMIN.actor, 'ALL', letter.id, { body: 'x' }))).rejects.toMatchObject({ code: 'IN_APPROVAL' });

    await approveAll(sent.approvalRequestId);
    const approved = await inOak(() => correspondence.get(P.ADMIN.actor, 'ALL', letter.id));
    expect(approved.status).toBe('APPROVED');

    await inOak(() => correspondence.dispatch(P.ADMIN.actor, 'ALL', letter.id, { channel: 'EMAIL', trackingNo: 'MSG-1' }));
    await expect(inOak(() => correspondence.close(P.ADMIN.actor, 'ALL', letter.id, { resolution: 'Done' }))).rejects.toMatchObject({ code: 'NO_ACKNOWLEDGEMENT' });
    await inOak(() => correspondence.recordAcknowledgement(P.ADMIN.actor, 'ALL', letter.id, { acknowledgement: 'Receipt email from CBSE RO' }));
    const closed = await inOak(() => correspondence.close(P.ADMIN.actor, 'ALL', letter.id, { resolution: 'Audit report submitted and acknowledged' }));
    expect(closed.status).toBe('CLOSED');
    expect(closed.history.map((h) => h.action)).toEqual(expect.arrayContaining(['REGISTERED', 'SOURCE_VERIFIED', 'AWAITING_APPROVAL', 'APPROVED', 'DISPATCHED', 'CLOSED']));
  });

  it('restricted letters are hidden from staff who are not party to them; other schools see nothing', async () => {
    const secret = await inOak(() => correspondence.register(P.PRINCIPAL.actor, {
      direction: 'INWARD', counterpartyType: 'TRUSTEE', counterpartyName: 'Chairman', subject: 'Confidential staffing matter', confidentiality: 'RESTRICTED',
    }));
    const adminView = await inOak(() => correspondence.list(P.ADMIN.actor, 'ALL', {}));
    expect(adminView.items.map((x) => x.id)).not.toContain(secret.id);
    await expect(inOak(() => correspondence.get(P.ADMIN.actor, 'ALL', secret.id))).rejects.toMatchObject({ statusCode: 404 });
    const principalView = await inOak(() => correspondence.list(P.PRINCIPAL.actor, 'ALL', {}));
    expect(principalView.items.map((x) => x.id)).toContain(secret.id);
    await expect(inSchool(RIVER, () => correspondence.get(P.RIVER_ADMIN.actor, 'ALL', secret.id))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('due reminders are sent once per item per day', async () => {
    await inOak(() => correspondence.register(P.ADMIN.actor, { direction: 'INWARD', counterpartyType: 'DISTRICT_OFFICE', counterpartyName: 'DEO', subject: 'Data request', dueOn: new Date(Date.now() + 86_400_000).toISOString() }));
    const first = await inOak(() => correspondence.sendDueReminders(P.ADMIN.actor));
    const second = await inOak(() => correspondence.sendDueReminders(P.ADMIN.actor));
    expect(first.itemsDue).toBe(1);
    expect(first.notified).toBe(1);
    expect(second.notified).toBe(0);
  });
});

describe('Scenario: a regulatory return is generated, reviewed, approved and submitted with evidence', () => {
  it('cannot be marked submitted without an acknowledgement, nor reviewed by its preparer', async () => {
    await inOak(async () => {
      await institution.updateProfile(P.ADMIN.actor, { campuses: [{ code: 'MAIN', name: 'Main', district: 'Pune', state: 'Maharashtra', udiseCode: '27250000000' }] });
      const g = await Grade.create({ name: 'Class 1', level: 1 });
      const s = await Section.create({ gradeId: g._id, name: 'A' });
      for (const [i, gender] of ['M', 'F', null].entries()) {
        const st = await Student.create({ admissionNo: `R-${i}`, firstName: `S${i}`, gender });
        await Enrollment.create({ studentId: st._id, sectionId: s._id, academicYearId: new mongoose.Types.ObjectId(), status: 'ACTIVE' });
      }
    });
    const ret = await inOak(() => compliance.createReturn(P.ADMIN.actor, { template: 'UDISE_PLUS_PROFILE', period: '2026-27', dueOn: '2026-12-31' }));
    expect(ret.data.totalEnrolment).toBe(3);
    expect(ret.data.enrolment[0]).toMatchObject({ grade: 'Class 1', boys: 1, girls: 1, unknown: 1 });
    expect(ret.warnings).toBe(1);
    expect(ret.errors).toBe(0);
    await inOak(() => compliance.sendReturnForReview(P.ADMIN.actor, ret.id, { reviewerProfileId: P.COMPLIANCE.actor.profileId }));
    await expect(inOak(() => compliance.reviewReturn(P.ADMIN.actor, ret.id, { decision: 'REQUEST_APPROVAL' }))).rejects.toMatchObject({ code: 'SELF_REVIEW' });
    const reviewed = await inOak(() => compliance.reviewReturn(P.COMPLIANCE.actor, ret.id, { decision: 'REQUEST_APPROVAL' }));
    await expect(inOak(() => compliance.recordSubmission(P.ADMIN.actor, ret.id, { method: 'PORTAL_MANUAL', acknowledgementNo: 'X' }))).rejects.toMatchObject({ code: 'NOT_APPROVED' });
    await approveAll(reviewed.approvalRequestId);
    await expect(inOak(() => compliance.recordSubmission(P.ADMIN.actor, ret.id, { method: 'PORTAL_MANUAL' }))).rejects.toMatchObject({ code: 'EVIDENCE_REQUIRED' });
    const submitted = await inOak(() => compliance.recordSubmission(P.ADMIN.actor, ret.id, { method: 'PORTAL_MANUAL', acknowledgementNo: 'UDISE-ACK-778' }));
    expect(submitted.status).toBe('SUBMITTED');
    const rejected = await inOak(() => compliance.recordOutcome(P.ADMIN.actor, ret.id, { outcome: 'REJECTED', response: 'Teacher count mismatch' }));
    expect(rejected.status).toBe('RESUBMISSION_REQUIRED');
    const reopened = await inOak(() => compliance.reopenForResubmission(P.ADMIN.actor, ret.id));
    expect(reopened.status).toBe('DRAFT');
  });

  it('a return with validation errors needs explicit acknowledgement to go for review', async () => {
    const ret = await inOak(() => compliance.createReturn(P.ADMIN.actor, { template: 'UDISE_PLUS_PROFILE', period: '2026-27' }));
    expect(ret.errors).toBeGreaterThan(0);
    await expect(inOak(() => compliance.sendReturnForReview(P.ADMIN.actor, ret.id, {}))).rejects.toMatchObject({ code: 'RETURN_HAS_ERRORS' });
  });
});

describe('Scenario: staff/driver verification with principal final decision', () => {
  it('pending is never cleared; expired licence blocks allocation', async () => {
    const c = await inOak(() => verification.initiate(P.HR.actor, { subjectType: 'DRIVER', subjectName: 'Ravi Kumar', driver: { licenceNo: 'MH12', licenceValidTo: new Date(Date.now() + 365 * 86_400_000).toISOString(), heavyVehicleExperienceYears: 7 } }));
    expect((await inOak(() => verification.clearanceFor({ subjectName: 'Ravi Kumar', subjectType: 'DRIVER' }))).cleared).toBe(false);
    await expect(inOak(() => verification.recordCheck(P.HR.actor, c.id, c.checks[0]._id, { status: 'CLEAR', reference: 'x' }))).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
    await inOak(() => verification.recordConsent(P.HR.actor, c.id, { evidenceUrl: '/uploads/consent.pdf' }));
    await expect(inOak(() => verification.hrReview(P.HR.actor, c.id, { recommendation: 'CLEAR', note: 'ok' }))).rejects.toMatchObject({ code: 'CHECKS_INCOMPLETE' });
    for (const check of c.checks) {
      await inOak(() => verification.recordCheck(P.HR.actor, c.id, check._id, { status: 'CLEAR', reference: `REF-${check.type}`, expiresOn: check.type === 'POLICE' ? new Date(Date.now() + 200 * 86_400_000).toISOString() : undefined }));
    }
    await inOak(() => verification.hrReview(P.HR.actor, c.id, { recommendation: 'CLEAR', note: 'All checks clear' }));
    // HR cannot decide, and HR's role does not hold verification.decide anyway.
    expect(P.HR.actor.permissions['verification.decide']).toBeUndefined();
    const decided = await inOak(() => verification.decide(P.PRINCIPAL.actor, c.id, { decision: 'CLEARED' }));
    expect(decided.status).toBe('CLEARED');
    expect(new Date(decided.recheckDueOn).getTime()).toBeLessThan(Date.now() + 201 * 86_400_000);
    expect((await inOak(() => verification.clearanceFor({ subjectName: 'Ravi Kumar', subjectType: 'DRIVER' }))).cleared).toBe(true);

    // A teacher sees status only, never evidence.
    const teacherView = await inOak(() => verification.get({ ...P.TEACHER.actor, permissions: { 'verification.read': 'ALL' } }, c.id));
    expect(teacherView.checks).toBeUndefined();
    expect(teacherView.status).toBe('CLEARED');

    // Lapse: move the re-check date into the past.
    await inOak(() => mongoose.model('VerificationCase').updateOne({ _id: c.id }, { $set: { recheckDueOn: new Date(Date.now() - 86_400_000) } }));
    const after = await inOak(() => verification.clearanceFor({ subjectName: 'Ravi Kumar', subjectType: 'DRIVER' }));
    expect(after.cleared).toBe(false);
    expect((await inOak(() => verification.get(P.HR.actor, c.id))).status).toBe('EXPIRED');
  });
});

describe('Safeguarding', () => {
  it('is visible only to the reporter (status) and designated officers; officer alert carries no detail', async () => {
    const r = await inOak(() => safeguarding.report(P.TEACHER.actor, { category: 'CHILD_PROTECTION', urgency: 'URGENT', description: 'Student X disclosed something serious.' }));
    expect(r.guidance).toMatch(/Special Juvenile Police Unit/);
    expect(r.officersNotified).toBe(1);
    const stored = await inOak(() => SafeguardingCase.findById(r.id).lean());
    expect(stored.descriptionEnc).not.toContain('Student X');
    const mine = await inOak(() => safeguarding.mine(P.TEACHER.actor));
    expect(mine[0]).toEqual(expect.objectContaining({ refNo: r.refNo, status: 'REPORTED' }));
    expect(mine[0].description).toBeUndefined();
    const notes = await inOak(() => Notification.find({}).lean());
    expect(notes.every((n) => !/disclosed|CHILD_PROTECTION/i.test(`${n.title} ${n.body}`))).toBe(true);
    expect(notes.every((n) => String(n.recipientProfileId) === P.COMPLIANCE.actor.profileId)).toBe(true);
    // The principal role does not hold safeguarding.manage by default.
    expect(P.PRINCIPAL.actor.permissions['safeguarding.manage']).toBeUndefined();
    expect(P.ADMIN.actor.permissions['safeguarding.manage']).toBeUndefined();
    const opened = await inOak(() => safeguarding.get(P.COMPLIANCE.actor, r.id));
    expect(opened.description).toBe('Student X disclosed something serious.');
    expect(opened.statutoryReportPending).toBe(true);
    await expect(inOak(() => safeguarding.update(P.COMPLIANCE.actor, r.id, { status: 'CLOSED', closeReason: 'x' }))).rejects.toMatchObject({ code: 'STATUTORY_REPORT_MISSING' });
    await inOak(() => safeguarding.update(P.COMPLIANCE.actor, r.id, { statutoryReport: { required: true, authority: 'SJPU', reportedAt: new Date().toISOString(), reference: 'FIR-1' } }));
    const closed = await inOak(() => safeguarding.update(P.COMPLIANCE.actor, r.id, { status: 'CLOSED', closeReason: 'Referred and supported' }));
    expect(closed.status).toBe('CLOSED');
  });
});

describe('Scenario: an event goes from proposal to approval, booking, calendar and close-out', () => {
  it('books the venue only when approved, and records outcome', async () => {
    await inOak(() => facilities.createSampleCampus({ institutionType: 'SCHOOL' }));
    const hall = (await inOak(() => facilities.listFacilities(P.ADMIN.actor, { kind: 'AUDITORIUM' })))[0];
    const start = new Date(Date.now() + 10 * 86_400_000);
    const ev = await inOak(() => events.proposeEvent(P.TEACHER.actor, {
      title: 'Science Fest', kind: 'FEST', startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 4 * 3600_000).toISOString(),
      facilityId: hall.id, expectedAttendance: 500, budgetLines: [{ head: 'Decor', amountPaise: 2_000_000 }],
    }));
    expect(ev.conflicts.join(' ')).toMatch(/holds 400/);
    const sub = await inOak(() => events.submitEvent(P.TEACHER.actor, ev.id));
    const req = await inOak(() => approvals.getRequest(P.PRINCIPAL.actor, 'ALL', sub.approvalRequestId));
    expect(req.stages.map((s) => s.approverRole)).toEqual(['FINANCE', 'PRINCIPAL']);
    await approveAll(sub.approvalRequestId);
    const approved = await inOak(() => events.getEvent(P.TEACHER.actor, ev.id));
    expect(approved.status).toBe('APPROVED');
    const bookings = await inOak(() => facilities.listBookings(P.ADMIN.actor, { facilityId: hall.id }));
    expect(bookings[0].status).toBe('CONFIRMED');
    expect(await inOak(() => CalendarEvent.countDocuments({ title: 'Science Fest' }))).toBe(1);
    // A clashing booking is refused.
    await expect(inOak(() => facilities.requestBooking(P.TEACHER.actor, { facilityId: hall.id, title: 'Rehearsal', startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3600_000).toISOString() })))
      .rejects.toMatchObject({ code: 'BOOKING_CONFLICT' });
    await inOak(() => events.moveEvent(P.TEACHER.actor, ev.id, { to: 'LIVE' }));
    const done = await inOak(() => events.completeEvent(P.TEACHER.actor, ev.id, { summary: 'Great turnout', attendance: 380, actualSpendPaise: 1_800_000 }));
    expect(done.status).toBe('COMPLETED');
    expect(done.budgetVariancePaise).toBe(-200_000);
  });

  it('a hazardous work order takes a room out of use until resolved', async () => {
    await inOak(() => facilities.createSampleCampus({}));
    const lab = (await inOak(() => facilities.listFacilities(P.ADMIN.actor, { kind: 'LAB' })))[0];
    const wo = await inOak(() => facilities.reportIssue(P.TEACHER.actor, { facilityId: lab.id, title: 'Exposed wiring', category: 'ELECTRICAL', priority: 'URGENT' }));
    expect(wo.slaHours).toBe(4);
    await inOak(() => facilities.updateWorkOrder(P.ADMIN.actor, wo.id, { closesFacility: true, assigneeProfileId: P.ADMIN.actor.profileId }));
    expect((await inOak(() => facilities.listFacilities(P.ADMIN.actor, { kind: 'LAB' })))[0].status).toBe('UNDER_MAINTENANCE');
    await expect(inOak(() => facilities.requestBooking(P.TEACHER.actor, { facilityId: lab.id, title: 'Practical', startsAt: new Date(Date.now() + 86_400_000).toISOString(), endsAt: new Date(Date.now() + 90_000_000).toISOString() })))
      .rejects.toMatchObject({ code: 'FACILITY_UNAVAILABLE' });
    await inOak(() => facilities.updateWorkOrder(P.ADMIN.actor, wo.id, { status: 'RESOLVED', resolution: 'Rewired' }));
    expect((await inOak(() => facilities.listFacilities(P.ADMIN.actor, { kind: 'LAB' })))[0].status).toBe('ACTIVE');
  });

  it('restricted spaces are masked for non-managers', async () => {
    await inOak(() => facilities.createSampleCampus({}));
    const asTeacher = await inOak(() => facilities.listFacilities(P.TEACHER.actor, { kind: 'SERVER_ROOM' }));
    expect(asTeacher[0].name).toBe('Restricted area');
    const asAdmin = await inOak(() => facilities.listFacilities(P.ADMIN.actor, { kind: 'SERVER_ROOM' }));
    expect(asAdmin[0].name).toBe('Server Room');
  });
});

describe('Scenario: a trustee meeting produces agenda, notifications, minutes, resolutions and tracked actions', () => {
  it('runs with quorum and chair-approved minutes', async () => {
    const m = await inOak(() => governance.create(P.PRINCIPAL.actor, {
      body: 'TRUST_BOARD', title: 'Q3 Board Meeting', quorum: 2,
      memberProfileIds: [P.TRUSTEE.actor.profileId, P.PRINCIPAL.actor.profileId],
      memberRoles: { [P.TRUSTEE.actor.profileId]: 'CHAIR' },
      proposedSlots: [new Date(Date.now() + 5 * 86_400_000).toISOString(), new Date(Date.now() + 6 * 86_400_000).toISOString()],
    }));
    // A trustee sees only meetings they are a member of.
    expect((await inOak(() => governance.list(P.TRUSTEE.actor, 'OWN', {}))).map((x) => x.id)).toEqual([m.id]);
    expect(await inOak(() => governance.list(P.HR.actor, 'OWN', {}))).toHaveLength(0);
    await inOak(() => governance.markAvailability(P.TRUSTEE.actor, 'OWN', m.id, { slotIndexes: [1] }));
    await inOak(() => governance.schedule(P.PRINCIPAL.actor, 'ALL', m.id, { slotIndex: 1 }));
    expect(await inOak(() => MessageOutbox.countDocuments({ relatedEntityId: m.id, templateKey: 'MEETING_SCHEDULED' }))).toBe(1);
    await inOak(() => governance.setAgenda(P.PRINCIPAL.actor, 'ALL', m.id, { items: [{ title: 'Approve annual budget', decisionNeeded: true }] }));
    await inOak(() => governance.setAgenda(P.PRINCIPAL.actor, 'ALL', m.id, { status: 'CIRCULATED' }));
    // Minutes are recorded only after the meeting has happened: move it into the past.
    await expect(inOak(() => governance.record(P.PRINCIPAL.actor, 'ALL', m.id, { minutes: 'too early' }))).rejects.toMatchObject({ code: 'MEETING_NOT_HELD' });
    await inOak(() => BoardMeeting.updateOne({ _id: m.id }, { $set: { scheduledAt: new Date(Date.now() - 2 * 3_600_000) } }));
    const full = await inOak(() => governance.get(P.PRINCIPAL.actor, 'ALL', m.id));
    const [trustee, principal] = full.members;
    await expect(inOak(() => governance.record(P.PRINCIPAL.actor, 'ALL', m.id, { attendance: [{ memberId: trustee._id, attended: true }], resolutions: [{ text: 'Budget approved', votesFor: 1 }] })))
      .rejects.toMatchObject({ code: 'NO_QUORUM' });
    await inOak(() => governance.record(P.PRINCIPAL.actor, 'ALL', m.id, {
      attendance: [{ memberId: trustee._id, attended: true }, { memberId: principal._id, attended: true }],
      minutes: 'Board met and approved the budget.',
      resolutions: [{ text: 'The budget for 2026-27 is approved.', votesFor: 2, votesAgainst: 0 }],
      actions: [{ title: 'Publish approved budget', ownerProfileId: P.PRINCIPAL.actor.profileId, dueOn: new Date(Date.now() + 86_400_000).toISOString() }],
    }));
    await expect(inOak(() => governance.approveMinutes(P.HR.actor, 'ALL', m.id))).rejects.toMatchObject({ statusCode: 403 });
    const approved = await inOak(() => governance.approveMinutes(P.TRUSTEE.actor, 'OWN', m.id));
    expect(approved.minutes.status).toBe('APPROVED');
    expect(approved.quorumMet).toBe(true);
    await expect(inOak(() => governance.record(P.PRINCIPAL.actor, 'ALL', m.id, { minutes: 'rewrite' }))).rejects.toMatchObject({ code: 'MINUTES_LOCKED' });
    const actions = await inOak(() => governance.openActions(P.PRINCIPAL.actor, 'ALL'));
    expect(actions).toHaveLength(1);
  });
});

describe('Policies and notices', () => {
  it('a policy version is approved, supersedes the old one, and is acknowledged by its audience', async () => {
    const p = await inOak(() => compliance.createPolicy(P.COMPLIANCE.actor, { code: 'CP-01', title: 'Child Protection Policy', category: 'SAFEGUARDING', audienceRoles: ['TEACHER'], requiresAcknowledgement: true, body: 'v1 text' }));
    const sub = await inOak(() => compliance.submitPolicy(P.COMPLIANCE.actor, p.id, {}));
    await approveAll(sub.pendingVersion.approvalRequestId);
    const mine = await inOak(() => compliance.myPolicies(P.TEACHER.actor));
    expect(mine).toEqual([expect.objectContaining({ code: 'CP-01', version: 1, acknowledged: false })]);
    await inOak(() => compliance.acknowledgePolicy(P.TEACHER.actor, p.id));
    expect((await inOak(() => compliance.myPolicies(P.TEACHER.actor)))[0].acknowledged).toBe(true);
    // A parent is not in the audience.
    await expect(inOak(() => compliance.acknowledgePolicy(P.PARENT.actor, p.id))).rejects.toMatchObject({ statusCode: 404 });
    await inOak(() => compliance.draftPolicyVersion(P.COMPLIANCE.actor, p.id, { body: 'v2 text' }));
    const sub2 = await inOak(() => compliance.submitPolicy(P.COMPLIANCE.actor, p.id, {}));
    await approveAll(sub2.pendingVersion.approvalRequestId);
    const v2 = await inOak(() => compliance.getPolicy(p.id));
    expect(v2.currentVersion).toBe(2);
    expect(v2.versions.find((v) => v.version === 1).status).toBe('SUPERSEDED');
    expect((await inOak(() => compliance.myPolicies(P.TEACHER.actor)))[0].acknowledged).toBe(false);
  });

  it('a district notice changes nothing until verified and decided, with a rationale', async () => {
    const n = await inOak(() => compliance.createNotice(P.ADMIN.actor, { source: 'DISTRICT_COLLECTOR', jurisdiction: 'Pune', title: 'Schools closed due to heavy rain' }));
    await expect(inOak(() => compliance.decideNotice(P.COMPLIANCE.actor, n.id, { applicability: 'APPLICABLE', rationale: 'Our district' }))).rejects.toMatchObject({ code: 'UNVERIFIED_NOTICE' });
    await inOak(() => compliance.decideNotice(P.COMPLIANCE.actor, n.id, { authenticity: 'VERIFIED', authenticityNote: 'On collector website' }));
    const d = await inOak(() => compliance.decideNotice(P.COMPLIANCE.actor, n.id, { applicability: 'APPLICABLE', rationale: 'Campus is in Pune district', actions: [{ title: 'Announce closure', ownerProfileId: P.ADMIN.actor.profileId }] }));
    expect(d.status).toBe('APPLICABLE');
    const done = await inOak(() => compliance.decideNotice(P.COMPLIANCE.actor, n.id, { actions: [{ title: 'Announce closure', done: true }] }));
    expect(done.status).toBe('ACTIONED');
  });

  it('a watched source creates an unverified notice only when the page changes, and records failures', async () => {
    let html = '<html><body>Notice A</body></html>';
    compliance.setNoticeFetcherForTests(async () => html);
    const src = await inOak(() => compliance.addNoticeSource({ name: 'Collector notices', url: 'https://example.gov.in/notices', source: 'DISTRICT_COLLECTOR' }));
    const first = await inOak(() => compliance.checkNoticeSource(P.COMPLIANCE.actor, src.id));
    expect(first.notice).toBeNull();
    html = '<html><body>Notice A, Notice B</body></html>';
    const second = await inOak(() => compliance.checkNoticeSource(P.COMPLIANCE.actor, src.id));
    expect(second.source.lastStatus).toBe('CHANGED');
    expect(second.notice).toMatchObject({ authenticity: 'UNVERIFIED', status: 'NEW', receivedVia: 'SOURCE_CHECK' });
    compliance.setNoticeFetcherForTests(async () => { throw new Error('HTTP 503'); });
    const third = await inOak(() => compliance.checkNoticeSource(P.COMPLIANCE.actor, src.id));
    expect(third.source.lastStatus).toBe('FAILED');
  });

  it('the obligation catalogue loads for review, never as applicable', async () => {
    const r = await inOak(() => compliance.seedCatalogue(P.COMPLIANCE.actor, 'COLLEGE'));
    expect(r.added).toBeGreaterThan(3);
    const all = await inOak(() => compliance.listObligations());
    expect(all.every((o) => o.applicability === 'UNDER_REVIEW')).toBe(true);
    expect(all.map((o) => o.code)).toContain('ANTI-RAGGING-COMMITTEE');
    expect(all.map((o) => o.code)).not.toContain('UDISE-PLUS');
  });
});

describe('Organization structure', () => {
  it('is generated from staff records, validates cycles and shows vacancies and unplaced staff', async () => {
    const chart = await inOak(() => org.bootstrap('SCHOOL'));
    expect(chart.stats.unplaced).toBe(0);
    const principal = chart.positions.find((p) => p.roleKey === 'PRINCIPAL');
    expect(principal.holders.map((h) => h.name)).toEqual(['PRINCIPAL person']);
    const trustee = chart.positions.find((p) => p.roleKey === 'TRUSTEE');
    expect(principal.reportsToPositionId).toBe(trustee.id);
    await expect(inOak(() => org.updatePosition(trustee.id, { reportsToPositionId: principal.id }))).rejects.toMatchObject({ code: 'ORG_CYCLE' });
    // A new teacher shows up as unplaced until appointed.
    await seedPerson({ roleKey: 'TEACHER', roleId: roles.TEACHER, displayName: 'New Teacher' });
    const after = await inOak(() => org.chart());
    expect(after.unplaced.map((u) => u.name)).toEqual(['New Teacher']);
    expect(JSON.stringify(after)).not.toMatch(/salary|phone|bank/i);
  });

  it('institution type switches terminology and completeness lists what is missing', async () => {
    const school = await inOak(() => institution.getProfile());
    expect(school.terminology.grade).toBe('Class');
    const college = await inOak(() => institution.updateProfile(P.PRINCIPAL.actor, { institutionType: 'COLLEGE', terminology: { section: 'Division' } }));
    expect(college.terminology).toMatchObject({ grade: 'Programme', term: 'Semester', section: 'Division' });
    expect(college.completeness.missing).toContain('AISHE code on a campus');
  });
});

describe('driver clearance on transport routes', () => {
  it('shows transport managers whether each named driver is cleared, and shows families nothing', async () => {
    const { TransportRoute } = await import('../src/models/transport.model.js');
    const transport = await import('../src/modules/transport/transport.service.js');
    await inSchool(OAK, () => TransportRoute.create([
      { name: 'Route A', driverName: 'Ramesh Kumar', status: 'ACTIVE' },
      { name: 'Route B', status: 'ACTIVE' },
    ]));
    const admin = { roleKey: 'ADMIN', profileId: '000000000000000000000001', permissions: { 'transport.manage': 'ALL' } };
    const routes = await inSchool(OAK, () => transport.listRoutes(admin));
    expect(routes.find((r) => r.name === 'Route A').driverClearance).toMatchObject({ status: 'NO_RECORD' });
    expect(routes.find((r) => r.name === 'Route B').driverClearance).toMatchObject({ status: 'NO_DRIVER' });

    const parent = { roleKey: 'PARENT', profileId: '000000000000000000000002', permissions: { 'transport.read': 'OWN' } };
    const forFamily = await inSchool(OAK, () => transport.listRoutes(parent));
    expect(forFamily.every((r) => r.driverClearance === undefined)).toBe(true);
    // The assistant's tools call it with no actor and get no clearance either.
    expect((await inSchool(OAK, () => transport.listRoutes())).every((r) => r.driverClearance === undefined)).toBe(true);
  });
});
