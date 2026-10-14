import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { seedRoles, seedPerson, inSchool, OAK } from './support/mcpSchool.js';
import * as community from '../src/modules/community/community.service.js';
import { CommunityPost, CommunityReport, MediaConsent, MentorshipRequest } from '../src/models/community.model.js';
import { Notification } from '../src/models/notification.model.js';
import { Student, StudentGuardian, Enrollment } from '../src/models/student.model.js';
import { Grade, Section } from '../src/models/academics.model.js';

/**
 * Regression tests for the newsroom / circles / mentoring audit: every
 * safeguarding and security finding has a test that reproduces it and shows
 * the fix holds.
 */

let roles;
let P;
let child;
const inOak = (fn) => inSchool(OAK, fn);
const img = (over = {}) => ({ url: '/uploads/photo.jpg', altText: 'Children at the science fair', metadataStripped: true, noIdentifiableStudents: true, ...over });

beforeEach(async () => {
  roles = await seedRoles();
  P = {};
  for (const key of ['ADMIN', 'PRINCIPAL', 'MARKETING', 'TEACHER', 'PARENT', 'STUDENT', 'ALUMNUS', 'COMPLIANCE']) {
    P[key] = await seedPerson({ roleKey: key, roleId: roles[key], displayName: `${key} person` });
  }
  P.PARENT2 = await seedPerson({ roleKey: 'PARENT', roleId: roles.PARENT, displayName: 'Other parent' });
  P.STUDENT2 = await seedPerson({ roleKey: 'STUDENT', roleId: roles.STUDENT, displayName: 'Other student' });
  await inOak(async () => {
    const g = await Grade.create({ name: 'Class 8', level: 8 });
    const s = await Section.create({ gradeId: g._id, name: 'A', classTeacherId: P.TEACHER.profile._id });
    child = await Student.create({ admissionNo: 'C-1', firstName: 'Meera', lastName: 'K', profileId: P.STUDENT.profile._id });
    await StudentGuardian.create({ studentId: child._id, guardianProfileId: P.PARENT.profile._id, relation: 'MOTHER' });
    await Enrollment.create({ studentId: child._id, sectionId: s._id, academicYearId: new mongoose.Types.ObjectId(), status: 'ACTIVE' });
  });
});

async function verifiedAlumnusMentor() {
  const mp = await inOak(() => community.upsertMentorProfile(P.ALUMNUS.actor, { headline: 'Engineer', topics: ['engineering'] }));
  await inOak(() => community.verifyMentor(P.PRINCIPAL.actor, mp.id));
  return mp;
}

describe('Mentoring safeguards', () => {
  it('only the people in a request (or a moderator) can complete or cancel it, and only from valid states', async () => {
    const mp = await verifiedAlumnusMentor();
    const req = await inOak(() => community.requestMentoring(P.STUDENT.actor, { mentorId: mp.id, topic: 'Choosing engineering' }));
    // An unrelated parent and teacher cannot touch it: they do not even learn it exists.
    await expect(inOak(() => community.respondMentoring(P.PARENT.actor, req.id, { action: 'CANCEL' }))).rejects.toMatchObject({ statusCode: 404 });
    await expect(inOak(() => community.respondMentoring(P.TEACHER.actor, req.id, { action: 'COMPLETE', feedback: 'x' }))).rejects.toMatchObject({ statusCode: 404 });
    // Completing before any session is a clear 409, not a crash.
    await expect(inOak(() => community.respondMentoring(P.STUDENT.actor, req.id, { action: 'COMPLETE', feedback: 'x' }))).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    expect((await inOak(() => MentorshipRequest.findById(req.id).lean())).status).toBe('REQUESTED');
    const cancelled = await inOak(() => community.respondMentoring(P.STUDENT.actor, req.id, { action: 'CANCEL' }));
    expect(cancelled.status).toBe('CANCELLED');
    await expect(inOak(() => community.respondMentoring(P.ALUMNUS.actor, req.id, { action: 'ACCEPT' }))).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('prevents duplicate open requests and repeated acceptance', async () => {
    const mp = await verifiedAlumnusMentor();
    const req = await inOak(() => community.requestMentoring(P.STUDENT.actor, { mentorId: mp.id, topic: 'Careers' }));
    await expect(inOak(() => community.requestMentoring(P.STUDENT.actor, { mentorId: mp.id, topic: 'Careers again' }))).rejects.toMatchObject({ code: 'DUPLICATE_REQUEST' });
    await inOak(() => community.respondMentoring(P.ALUMNUS.actor, req.id, { action: 'ACCEPT' }));
    await expect(inOak(() => community.respondMentoring(P.ALUMNUS.actor, req.id, { action: 'ACCEPT' }))).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('a supervised request cannot be scheduled one-to-one, whatever the case of the mode, and nothing is stored', async () => {
    const mp = await verifiedAlumnusMentor();
    const req = await inOak(() => community.requestMentoring(P.STUDENT.actor, { mentorId: mp.id, topic: 'Careers' }));
    // Not accepted yet: a mentor cannot schedule.
    await expect(inOak(() => community.respondMentoring(P.ALUMNUS.actor, req.id, { action: 'SCHEDULE', at: new Date(Date.now() + 86_400_000).toISOString(), mode: 'GROUP_ONLINE' }))).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    await inOak(() => community.respondMentoring(P.ALUMNUS.actor, req.id, { action: 'ACCEPT' }));
    await inOak(() => community.respondMentoring(P.PRINCIPAL.actor, req.id, { action: 'ASSIGN_SUPERVISOR' }));
    for (const mode of ['one_to_one', 'One_To_One', 'ONE_TO_ONE']) {
      // eslint-disable-next-line no-await-in-loop
      await expect(inOak(() => community.respondMentoring(P.ALUMNUS.actor, req.id, { action: 'SCHEDULE', at: new Date(Date.now() + 86_400_000).toISOString(), mode, link: 'https://zoom.us/j/private' }))).rejects.toMatchObject({ code: 'SUPERVISION_REQUIRED' });
    }
    const stored = await inOak(() => MentorshipRequest.findById(req.id).lean());
    expect(stored.sessions).toHaveLength(0);
    expect(stored.status).toBe('ACCEPTED');
    const ok = await inOak(() => community.respondMentoring(P.ALUMNUS.actor, req.id, { action: 'SCHEDULE', at: new Date(Date.now() + 86_400_000).toISOString(), mode: 'one_to_one_supervised' }));
    expect(ok.sessions.at(-1).mode).toBe('ONE_TO_ONE_SUPERVISED');
    const done = await inOak(() => community.respondMentoring(P.STUDENT.actor, req.id, { action: 'COMPLETE', feedback: 'Very helpful', rating: 5 }));
    expect(done.status).toBe('COMPLETED');
    expect(done.sessions.at(-1).feedback).toBe('Very helpful');
  });

  it('a supervisor is assigned only to supervised requests and is not silently replaced', async () => {
    const mp = await verifiedAlumnusMentor();
    const adultReq = await inOak(() => community.requestMentoring(P.PARENT.actor, { mentorId: mp.id, topic: 'Career change' }));
    expect(adultReq.supervised).toBe(false);
    await expect(inOak(() => community.respondMentoring(P.PRINCIPAL.actor, adultReq.id, { action: 'ASSIGN_SUPERVISOR' }))).rejects.toMatchObject({ code: 'NOT_SUPERVISED' });
    const req = await inOak(() => community.requestMentoring(P.STUDENT.actor, { mentorId: mp.id, topic: 'Careers' }));
    await inOak(() => community.respondMentoring(P.PRINCIPAL.actor, req.id, { action: 'ASSIGN_SUPERVISOR' }));
    await expect(inOak(() => community.respondMentoring(P.COMPLIANCE.actor, req.id, { action: 'ASSIGN_SUPERVISOR' }))).rejects.toMatchObject({ code: 'SUPERVISOR_ASSIGNED' });
    const replaced = await inOak(() => community.respondMentoring(P.COMPLIANCE.actor, req.id, { action: 'ASSIGN_SUPERVISOR', replace: true }));
    expect(String(replaced.supervisorProfileId)).toBe(P.COMPLIANCE.actor.profileId);
  });

  it('a student cannot pass contact details to a mentor, and edited mentor profiles need verifying again', async () => {
    const mp = await verifiedAlumnusMentor();
    await expect(inOak(() => community.requestMentoring(P.STUDENT.actor, { mentorId: mp.id, topic: 'Help', message: 'call me on +91 98765 43210' }))).rejects.toMatchObject({ code: 'CONTACT_DETAILS' });
    await inOak(() => community.upsertMentorProfile(P.ALUMNUS.actor, { headline: 'Now a crypto influencer', topics: ['engineering'] }));
    expect(await inOak(() => community.listMentors(P.STUDENT.actor))).toHaveLength(0);
  });
});

describe('Circles keep minors among students and staff', () => {
  it('alumni and parents cannot join a student circle or see its members; staff can invite them to one opened to adults', async () => {
    const club = await inOak(() => community.createCircle(P.TEACHER.actor, { name: 'Robotics Club', kind: 'CLUB', joinPolicy: 'OPEN' }));
    await inOak(() => community.joinCircle(P.STUDENT.actor, club.id));
    await expect(inOak(() => community.joinCircle(P.ALUMNUS.actor, club.id))).rejects.toMatchObject({ code: 'STUDENT_CIRCLE' });
    await expect(inOak(() => community.joinCircle(P.PARENT.actor, club.id))).rejects.toMatchObject({ code: 'STUDENT_CIRCLE' });
    expect((await inOak(() => community.listCircles(P.ALUMNUS.actor))).map((c) => c.id)).not.toContain(club.id);

    const careers = await inOak(() => community.createCircle(P.TEACHER.actor, { name: 'Careers talk', kind: 'CAREER', joinPolicy: 'OPEN', adultsWelcome: true }));
    await inOak(() => community.joinCircle(P.STUDENT.actor, careers.id));
    await expect(inOak(() => community.joinCircle(P.ALUMNUS.actor, careers.id))).rejects.toMatchObject({ code: 'INVITE_ONLY' });
    await inOak(() => community.manageMember(P.TEACHER.actor, careers.id, { profileId: P.ALUMNUS.actor.profileId, action: 'INVITE' }));
    const seen = (await inOak(() => community.listCircles(P.ALUMNUS.actor))).find((c) => c.id === careers.id);
    expect(seen.myStatus).toBe('ACTIVE');
    // The alumnus sees adults in the circle, never the children.
    expect(seen.members.map((m) => m.roleKey)).not.toContain('STUDENT');
    expect(seen.members.length).toBeGreaterThan(0);
  });

  it('a removed member cannot rejoin an open circle by themselves', async () => {
    const club = await inOak(() => community.createCircle(P.TEACHER.actor, { name: 'Chess', kind: 'CLUB', joinPolicy: 'OPEN' }));
    await inOak(() => community.joinCircle(P.STUDENT.actor, club.id));
    await inOak(() => community.manageMember(P.TEACHER.actor, club.id, { profileId: P.STUDENT.actor.profileId, action: 'REMOVE' }));
    await expect(inOak(() => community.joinCircle(P.STUDENT.actor, club.id))).rejects.toMatchObject({ code: 'REMOVED_FROM_CIRCLE' });
    // Leaving is the member's own choice, and they can come back.
    await inOak(() => community.joinCircle(P.STUDENT2.actor, club.id));
    await inOak(() => community.leaveCircle(P.STUDENT2.actor, club.id));
    expect((await inOak(() => community.joinCircle(P.STUDENT2.actor, club.id))).status).toBe('ACTIVE');
  });

  it('a circle moderator sees and reviews what they are asked to approve', async () => {
    const club = await inOak(() => community.createCircle(P.TEACHER.actor, { name: 'Robotics', kind: 'CLUB', joinPolicy: 'OPEN' }));
    await inOak(() => community.joinCircle(P.STUDENT.actor, club.id));
    const post = await inOak(() => community.createPost(P.STUDENT.actor, { body: 'Our robot', audience: 'CIRCLE', circleId: club.id, submit: true }));
    expect(post.status).toBe('PENDING_REVIEW');
    const seen = await inOak(() => community.getPost(P.TEACHER.actor, post.id));
    expect(seen.canModerate).toBe(true);
    expect((await inOak(() => community.feed(P.TEACHER.actor, { tab: 'review' }))).items.map((p) => p.id)).toContain(post.id);
    // Other members cannot see it before it is approved.
    await expect(inOak(() => community.getPost(P.STUDENT2.actor, post.id))).rejects.toMatchObject({ statusCode: 404 });
    // The review notice went to the circle's moderator, not to marketing.
    expect(await inOak(() => Notification.countDocuments({ recipientProfileId: P.MARKETING.actor.profileId }))).toBe(0);
  });
});

describe('Moderation', () => {
  it('cannot publish a draft; reinstating a removed post needs a reason', async () => {
    const draft = await inOak(() => community.createPost(P.STUDENT.actor, { body: 'Not ready yet', audience: 'INSTITUTION' }));
    await expect(inOak(() => community.moderatePost(P.PRINCIPAL.actor, draft.id, { decision: 'PUBLISH' }))).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    await expect(inOak(() => community.moderatePost(P.PRINCIPAL.actor, draft.id, { decision: 'ARCHIVE' }))).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    await inOak(() => community.submitPost(P.STUDENT.actor, draft.id));
    await inOak(() => community.moderatePost(P.PRINCIPAL.actor, draft.id, { decision: 'PUBLISH' }));
    await inOak(() => community.moderatePost(P.PRINCIPAL.actor, draft.id, { decision: 'TAKE_DOWN', note: 'Names a child' }));
    await expect(inOak(() => community.moderatePost(P.PRINCIPAL.actor, draft.id, { decision: 'PUBLISH' }))).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    const back = await inOak(() => community.moderatePost(P.PRINCIPAL.actor, draft.id, { decision: 'PUBLISH', note: 'Name removed' }));
    expect(back.status).toBe('PUBLISHED');
  });

  it('authors fix sent-back posts, edits to published posts go back to review, and authors can withdraw', async () => {
    const p = await inOak(() => community.createPost(P.STUDENT.actor, { body: 'First try', audience: 'INSTITUTION', submit: true }));
    await inOak(() => community.moderatePost(P.PRINCIPAL.actor, p.id, { decision: 'REJECT', note: 'Add a title' }));
    const fixed = await inOak(() => community.updatePost(P.STUDENT.actor, p.id, { title: 'Science fair', submit: true }));
    expect(fixed).toMatchObject({ title: 'Science fair', status: 'PENDING_REVIEW' });
    await inOak(() => community.moderatePost(P.PRINCIPAL.actor, p.id, { decision: 'PUBLISH' }));
    const edited = await inOak(() => community.updatePost(P.STUDENT.actor, p.id, { body: 'Something else entirely' }));
    expect(edited.status).toBe('PENDING_REVIEW');
    expect((await inOak(() => community.feed(P.PARENT.actor, {}))).items).toHaveLength(0);
    await expect(inOak(() => community.updatePost(P.STUDENT2.actor, p.id, { body: 'hijack' }))).rejects.toMatchObject({ statusCode: 404 });
    await inOak(() => community.withdrawPost(P.STUDENT.actor, p.id));
    expect((await inOak(() => community.feed(P.PRINCIPAL.actor, { tab: 'review' }))).items).toHaveLength(0);
  });

  it('adults\' comments where students read are held for a moderator; comment policies apply', async () => {
    const post = await inOak(() => community.createPost(P.PRINCIPAL.actor, { body: 'Sports day results', audience: 'INSTITUTION', submit: true }));
    expect((await inOak(() => community.comment(P.ALUMNUS.actor, post.id, { body: '<img src=x onerror=alert(1)> great' }))).status).toBe('PENDING');
    expect((await inOak(() => community.comment(P.PARENT.actor, post.id, { body: 'Well done' }))).status).toBe('PENDING');
    expect((await inOak(() => community.comment(P.TEACHER.actor, post.id, { body: 'Proud of you all' }))).status).toBe('VISIBLE');
    // A post only parents can read: a parent's comment appears at once.
    const parentsOnly = await inOak(() => community.createPost(P.PRINCIPAL.actor, { body: 'PTM on Friday', audience: 'ROLE', audienceRef: ['PARENT'], submit: true }));
    expect((await inOak(() => community.comment(P.PARENT.actor, parentsOnly.id, { body: 'Thanks' }))).status).toBe('VISIBLE');
    const staffOnly = await inOak(() => community.createPost(P.PRINCIPAL.actor, { body: 'Notice', audience: 'INSTITUTION', commentPolicy: 'STAFF_ONLY', submit: true }));
    await expect(inOak(() => community.comment(P.STUDENT.actor, staffOnly.id, { body: 'hi' }))).rejects.toMatchObject({ code: 'COMMENTS_STAFF_ONLY' });
    const moderated = await inOak(() => community.createPost(P.PRINCIPAL.actor, { body: 'Notice', audience: 'INSTITUTION', commentPolicy: 'PRE_MODERATED', submit: true }));
    expect((await inOak(() => community.comment(P.TEACHER.actor, moderated.id, { body: 'Noted' }))).status).toBe('PENDING');
    const off = await inOak(() => community.createPost(P.PRINCIPAL.actor, { body: 'Notice', audience: 'INSTITUTION', commentPolicy: 'OFF', submit: true }));
    await expect(inOak(() => community.comment(P.TEACHER.actor, off.id, { body: 'x' }))).rejects.toMatchObject({ code: 'COMMENTS_OFF' });
    // Authors edit and delete their own comments; an edit is moderated again.
    const c = await inOak(() => community.comment(P.TEACHER.actor, post.id, { body: 'Typo' }));
    expect((await inOak(() => community.editComment(P.ALUMNUS.actor, c.id, { body: 'x' })).catch((e) => e)).statusCode).toBe(404);
    await inOak(() => community.deleteComment(P.TEACHER.actor, c.id));
    expect((await inOak(() => community.getPost(P.STUDENT.actor, post.id))).comments.map((x) => x.id)).not.toContain(c.id);
  });
});

describe('Media', () => {
  it('rejects javascript: and other non-upload URLs, and always checks alt text, metadata and pictured students', async () => {
    await expect(inOak(() => community.createPost(P.PRINCIPAL.actor, { body: 'x', audience: 'PUBLIC', media: [img({ url: 'javascript:alert(document.cookie)' })] }))).rejects.toMatchObject({ code: 'MEDIA_URL_INVALID' });
    await expect(inOak(() => community.createPost(P.PRINCIPAL.actor, { body: 'x', audience: 'PUBLIC', media: [img({ url: 'http://evil.example/x.jpg' })] }))).rejects.toMatchObject({ code: 'MEDIA_URL_INVALID' });
    await expect(inOak(() => community.createPost(P.PRINCIPAL.actor, { body: 'x', audience: 'PUBLIC', submit: true, media: [img({ altText: '' })] }))).rejects.toMatchObject({ code: 'ALT_TEXT_REQUIRED' });
    await expect(inOak(() => community.createPost(P.PRINCIPAL.actor, { body: 'x', audience: 'PUBLIC', submit: true, media: [img({ metadataStripped: false })] }))).rejects.toMatchObject({ code: 'METADATA_NOT_STRIPPED' });
    // A photo with nobody tagged needs the explicit "no identifiable students" statement.
    await expect(inOak(() => community.createPost(P.STUDENT.actor, { body: 'x', audience: 'INSTITUTION', submit: true, media: [img({ noIdentifiableStudents: false })] }))).rejects.toMatchObject({ code: 'PICTURED_STUDENTS_UNCONFIRMED' });
    await expect(inOak(() => community.createPost(P.PRINCIPAL.actor, { body: 'x', audience: 'INSTITUTION', submit: true, media: [img({ studentIds: [String(new mongoose.Types.ObjectId())] })] }))).rejects.toMatchObject({ code: 'UNKNOWN_STUDENT' });
    const ok = await inOak(() => community.createPost(P.PRINCIPAL.actor, { body: 'x', audience: 'PUBLIC', submit: true, media: [img({ url: 'https://cdn.example.org/a.jpg' })] }));
    expect(ok.status).toBe('PUBLISHED');
  });

  it('a staff consent override keeps its evidence and checks the student exists', async () => {
    await expect(inOak(() => community.setConsent(P.PRINCIPAL.actor, { studentId: String(new mongoose.Types.ObjectId()), level: 'PUBLIC', evidence: 'Form 12' }))).rejects.toMatchObject({ statusCode: 404 });
    await inOak(() => community.setConsent(P.PRINCIPAL.actor, { studentId: String(child._id), level: 'INTERNAL', evidence: 'Signed form #12, 2026 intake', evidenceFileUrl: '/uploads/form-12.pdf' }));
    const row = await inOak(() => MediaConsent.findOne({ studentId: child._id, withdrawnAt: null }).lean());
    expect(row).toMatchObject({ evidence: 'Signed form #12, 2026 intake', evidenceFileUrl: '/uploads/form-12.pdf', level: 'INTERNAL' });
  });
});

describe('Reports', () => {
  async function photoPost() {
    await inOak(() => community.setConsent(P.PARENT.actor, { studentId: String(child._id), level: 'PUBLIC' }));
    return inOak(() => community.createPost(P.PRINCIPAL.actor, { body: 'Annual day', audience: 'PUBLIC', submit: true, media: [img({ studentIds: [String(child._id)], noIdentifiableStudents: false })] }));
  }

  it('a student cannot hide every photo on a post by reporting it; duplicates and missing targets are refused', async () => {
    const post = await photoPost();
    const r = await inOak(() => community.report(P.STUDENT2.actor, { targetType: 'POST', targetId: post.id, reason: 'CONSENT' }));
    expect(r.mediaHidden).toBe(false);
    expect((await inOak(() => community.getPost(P.PARENT2.actor, post.id))).media).toHaveLength(1);
    const again = await inOak(() => community.report(P.STUDENT2.actor, { targetType: 'POST', targetId: post.id, reason: 'CONSENT' }));
    expect(again.duplicate).toBe(true);
    expect(await inOak(() => CommunityReport.countDocuments({}))).toBe(1);
    await expect(inOak(() => community.report(P.STUDENT2.actor, { targetType: 'POST', targetId: String(new mongoose.Types.ObjectId()), reason: 'SPAM' }))).rejects.toMatchObject({ code: 'TARGET_NOT_FOUND' });
    // A post the reporter cannot see is "not found" too.
    const club = await inOak(() => community.createCircle(P.TEACHER.actor, { name: 'Staff only', kind: 'PROJECT', joinPolicy: 'INVITE' }));
    const hidden = await inOak(() => community.createPost(P.TEACHER.actor, { body: 'plans', audience: 'CIRCLE', circleId: club.id, submit: true }));
    await expect(inOak(() => community.report(P.STUDENT2.actor, { targetType: 'POST', targetId: hidden.id, reason: 'SPAM' }))).rejects.toMatchObject({ code: 'TARGET_NOT_FOUND' });
  });

  it('reports are rate-limited per person', async () => {
    const posts = [];
    for (let i = 0; i < community.REPORTS_PER_HOUR + 1; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      posts.push(await inOak(() => community.createPost(P.PRINCIPAL.actor, { body: `Post ${i}`, audience: 'INSTITUTION', submit: true })));
    }
    for (let i = 0; i < community.REPORTS_PER_HOUR; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await inOak(() => community.report(P.STUDENT2.actor, { targetType: 'POST', targetId: posts[i].id, reason: 'SPAM' }));
    }
    await expect(inOak(() => community.report(P.STUDENT2.actor, { targetType: 'POST', targetId: posts.at(-1).id, reason: 'SPAM' }))).rejects.toMatchObject({ statusCode: 429 });
  });

  it('a guardian\'s consent report holds the photos; moderators still see them; dismissing one report keeps the hold while another is open', async () => {
    const post = await photoPost();
    const r1 = await inOak(() => community.report(P.PARENT.actor, { targetType: 'POST', targetId: post.id, reason: 'CONSENT', detail: 'That is my daughter' }));
    expect(r1.mediaHidden).toBe(true);
    expect((await inOak(() => community.getPost(P.PARENT2.actor, post.id))).media).toHaveLength(0);
    const modView = await inOak(() => community.getPost(P.PRINCIPAL.actor, post.id));
    expect(modView.media).toHaveLength(1);
    expect(modView.media[0].hidden).toBe(true);
    // Safeguarding reports reach the compliance officer; nothing goes to marketing.
    expect(await inOak(() => Notification.countDocuments({ recipientProfileId: P.COMPLIANCE.actor.profileId, title: /report/i }))).toBe(1);
    const r2 = await inOak(() => community.report(P.TEACHER.actor, { targetType: 'POST', targetId: post.id, reason: 'CONSENT' }));
    await inOak(() => community.resolveReport(P.PRINCIPAL.actor, r1.id, { status: 'DISMISSED', resolution: 'Checked' }));
    expect((await inOak(() => community.getPost(P.PARENT2.actor, post.id))).media).toHaveLength(0);
    await inOak(() => community.resolveReport(P.PRINCIPAL.actor, r2.id, { status: 'DISMISSED', resolution: 'Checked' }));
    expect((await inOak(() => community.getPost(P.PARENT2.actor, post.id))).media).toHaveLength(1);
  });

  it('a report shows what it is about, and "actioned" takes the item down', async () => {
    const post = await inOak(() => community.createPost(P.PRINCIPAL.actor, { title: 'Results', body: 'Sports day', audience: 'INSTITUTION', submit: true }));
    const c = await inOak(() => community.comment(P.TEACHER.actor, post.id, { body: 'Mean remark' }));
    await inOak(() => community.report(P.STUDENT.actor, { targetType: 'COMMENT', targetId: c.id, reason: 'BULLYING' }));
    await inOak(() => community.report(P.STUDENT2.actor, { targetType: 'POST', targetId: post.id, reason: 'INAPPROPRIATE' }));
    await inOak(() => community.report(P.PARENT.actor, { targetType: 'POST', targetId: post.id, reason: 'INAPPROPRIATE' }));
    const list = await inOak(() => community.listReports(P.COMPLIANCE.actor));
    const onComment = list.find((r) => r.targetType === 'COMMENT');
    expect(onComment.target).toMatchObject({ exists: true, excerpt: 'Mean remark', postId: post.id });
    const onPost = list.find((r) => r.targetType === 'POST');
    expect(onPost.target).toMatchObject({ exists: true, title: 'Results', link: `/newsroom?post=${post.id}` });
    expect(onPost.openOnTarget).toBe(2);
    await inOak(() => community.resolveReport(P.PRINCIPAL.actor, onComment.id, { status: 'ACTIONED', resolution: 'Unkind' }));
    expect((await inOak(() => community.getPost(P.STUDENT.actor, post.id))).comments).toHaveLength(0);
    await inOak(() => community.resolveReport(P.PRINCIPAL.actor, onPost.id, { status: 'ACTIONED', resolution: 'Inappropriate' }));
    expect((await inOak(() => CommunityPost.findById(post.id).lean())).status).toBe('TAKEN_DOWN');
    // Both reports on the post are closed by the one action.
    expect(await inOak(() => community.listReports(P.PRINCIPAL.actor))).toHaveLength(0);
  });
});

describe('Feed rows, reactions and bookmarks', () => {
  it('reactions never lose updates under concurrency, and rows carry counts, not who reacted', async () => {
    const post = await inOak(() => community.createPost(P.PRINCIPAL.actor, { body: 'Well done!', audience: 'INSTITUTION', submit: true }));
    const people = [P.ADMIN, P.TEACHER, P.PARENT, P.PARENT2, P.STUDENT, P.STUDENT2, P.ALUMNUS];
    await Promise.all(people.map((x) => inOak(() => community.react(x.actor, post.id, { type: 'CLAP' }))));
    let row = (await inOak(() => community.feed(P.PRINCIPAL.actor, {}))).items[0];
    expect(row.reactions.CLAP).toBe(7);
    await Promise.all(people.map((x) => inOak(() => community.react(x.actor, post.id, { type: null }))));
    row = (await inOak(() => community.feed(P.PRINCIPAL.actor, {}))).items[0];
    expect(row.reactions.CLAP ?? 0).toBe(0);
    const stored = await inOak(() => CommunityPost.findById(post.id).lean());
    expect(stored.reactions).toHaveLength(0);
    // Switching type moves the count.
    await inOak(() => community.react(P.TEACHER.actor, post.id, { type: 'CLAP' }));
    const switched = await inOak(() => community.react(P.TEACHER.actor, post.id, { type: 'heart' }));
    expect(switched.reactions).toEqual({ HEART: 1 });
    expect(switched.myReaction).toBe('HEART');
    // Concurrent bookmarks from different people all stick.
    await Promise.all(people.map((x) => inOak(() => community.bookmark(x.actor, post.id))));
    expect((await inOak(() => CommunityPost.findById(post.id).lean())).bookmarks).toHaveLength(7);
    const feedRow = (await inOak(() => community.feed(P.TEACHER.actor, { pageSize: 500 })));
    expect(feedRow.pageSize).toBe(50);
    expect(feedRow.items[0]).not.toHaveProperty('bookmarks');
    expect(feedRow.items[0]).toMatchObject({ bookmarked: true, myReaction: 'HEART', commentCount: 0 });
  });

  it('cannot bookmark a post that is not published', async () => {
    const pending = await inOak(() => community.createPost(P.STUDENT.actor, { body: 'Pending', audience: 'INSTITUTION', submit: true }));
    await expect(inOak(() => community.bookmark(P.STUDENT.actor, pending.id))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('an event with no kind still seeds one draft highlight', async () => {
    const { InstitutionEvent } = await import('../src/models/administration.model.js');
    const ev = await inOak(() => InstitutionEvent.collection.insertOne({ tenantId: OAK, title: 'Assembly', status: 'COMPLETED', newsroomPostId: null, outcome: { summary: 'Good assembly' } }));
    const results = await Promise.allSettled([1, 2].map(() => inOak(() => community.draftFromEvent(P.TEACHER.actor, String(ev.insertedId)))));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'fulfilled').value.tags).toEqual([]);
    expect(await inOak(() => CommunityPost.countDocuments({ kind: 'EVENT_HIGHLIGHT' }))).toBe(1);
  });
});
