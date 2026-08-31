import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Announcement } from '../src/models/announcement.model.js';
import { Grade, Section, Subject, SubjectOffering } from '../src/models/academics.model.js';
import { Role } from '../src/models/role.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { create as createAnnouncement, list as listAnnouncements } from '../src/modules/announcements/announcement.service.js';
import { Student, Enrollment } from '../src/models/student.model.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { getTool } from '../src/modules/ai/agent/tools.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';

/**
 * Who an announcement can reach.
 *
 * The defect these cover: the audience resolved to "everyone" *before* the
 * actor's scope was checked, so a teacher who asked for all classes — or who
 * left the audience empty, which both the composer and the agent did by
 * default — addressed the whole school. The agent shared the bug through its
 * own door, defaulting the audience to `{ all: true }`.
 */

const OAK = 'oakridge';
const NVMP = 'nvmp';

let oakGrade;
let ownSection;      // the teacher's own class
let otherSection;    // a colleague's class, same school
let ownSubject;
let otherSubject;
let nvmpSection;     // another school entirely
const teacherId = new mongoose.Types.ObjectId();

const teacher = { profileId: teacherId.toString(), roleKey: 'TEACHER' };
const admin = { profileId: new mongoose.Types.ObjectId().toString(), roleKey: 'ADMIN' };

const inOak = (fn) => runWithTenant(OAK, fn);
const inNvmp = (fn) => runWithTenant(NVMP, fn);

/** Publishes as a given actor/scope, reporting allow or deny like the API would. */
const post = async (actor, scope, audience, school = OAK) => {
  try {
    const doc = await runWithTenant(school, () =>
      createAnnouncement(actor, scope, { title: 'Notice', content: 'Body', audience }));
    return { ok: true, audience: doc.audience, tenantId: doc.tenantId };
  } catch (err) {
    return { ok: false, status: err.statusCode, message: err.message };
  }
};

beforeEach(async () => {
  for (const r of SYSTEM_ROLES) {
    await Role.create({ key: r.key, name: r.name, isSystem: true, permissions: r.grants });
  }

  await inOak(async () => {
    oakGrade = await Grade.create({ name: 'Class 6', level: 6 });
    ownSection = await Section.create({ gradeId: oakGrade._id, name: 'A', classTeacherId: teacherId });
    otherSection = await Section.create({ gradeId: oakGrade._id, name: 'B', classTeacherId: new mongoose.Types.ObjectId() });
    ownSubject = await Subject.create({ name: 'Mathematics' });
    otherSubject = await Subject.create({ name: 'History' });
    await SubjectOffering.create({
      sectionId: ownSection._id, subjectId: ownSubject._id, teacherId,
      termId: new mongoose.Types.ObjectId(),
    });
  });

  await inNvmp(async () => {
    const g = await Grade.create({ name: 'Class 6', level: 6 });
    nvmpSection = await Section.create({ gradeId: g._id, name: 'A' });
  });
});

describe('a teacher reaches only what they teach', () => {
  it('cannot address the whole school by asking for it', async () => {
    const res = await post(teacher, 'OWN', { all: true });
    expect(res).toMatchObject({ ok: false, status: 403 });
    expect(res.message).toMatch(/only announce to classes or subjects you teach/i);
  });

  it('does not silently address the whole school when no audience is chosen', async () => {
    // This is the case the composer and the agent both produced by default.
    const res = await post(teacher, 'OWN', undefined);
    expect(res.ok).toBe(true);
    expect(res.audience.all).toBe(false);
    expect(res.audience.sectionIds.map(String)).toEqual([ownSection._id.toString()]);
  });

  it('reaches its own section', async () => {
    const res = await post(teacher, 'OWN', { sectionIds: [ownSection._id.toString()] });
    expect(res.ok).toBe(true);
    expect(res.audience.sectionIds.map(String)).toEqual([ownSection._id.toString()]);
  });

  it('is refused a colleague’s section in the same school', async () => {
    expect(await post(teacher, 'OWN', { sectionIds: [otherSection._id.toString()] }))
      .toMatchObject({ ok: false, status: 403 });
  });

  it('reaches a subject it teaches, but not one it does not', async () => {
    expect((await post(teacher, 'OWN', { subjectIds: [ownSubject._id.toString()] })).ok).toBe(true);
    expect(await post(teacher, 'OWN', { subjectIds: [otherSubject._id.toString()] }))
      .toMatchObject({ ok: false, status: 403 });
  });

  it('is refused a whole grade, which is wider than its own section', async () => {
    expect(await post(teacher, 'OWN', { gradeIds: [oakGrade._id.toString()] }))
      .toMatchObject({ ok: false, status: 403 });
  });

  it('cannot smuggle its own section in alongside one it does not teach', async () => {
    const res = await post(teacher, 'OWN', {
      sectionIds: [ownSection._id.toString(), otherSection._id.toString()],
    });
    expect(res).toMatchObject({ ok: false, status: 403 });
  });

  it('may address students and parents, but not staff', async () => {
    const own = [ownSection._id.toString()];
    expect((await post(teacher, 'OWN', { sectionIds: own, roleKeys: ['STUDENT', 'PARENT'] })).ok).toBe(true);

    const staff = await post(teacher, 'OWN', { sectionIds: own, roleKeys: ['TEACHER'] });
    expect(staff).toMatchObject({ ok: false, status: 403 });
    expect(staff.message).toMatch(/not allowed to announce to/i);
  });

  it('cannot post at all when it teaches nothing', async () => {
    const stranger = { profileId: new mongoose.Types.ObjectId().toString(), roleKey: 'TEACHER' };
    expect(await post(stranger, 'OWN', undefined)).toMatchObject({ ok: false, status: 403 });
  });
});

describe('a School Admin reaches its own school and no further', () => {
  it('may address the whole school', async () => {
    const res = await post(admin, 'ALL', { all: true });
    expect(res.ok).toBe(true);
    expect(res.audience.all).toBe(true);
    expect(res.tenantId).toBe(OAK);
  });

  it('may address any class in its own school', async () => {
    expect((await post(admin, 'ALL', { sectionIds: [otherSection._id.toString()] })).ok).toBe(true);
    expect((await post(admin, 'ALL', { gradeIds: [oakGrade._id.toString()] })).ok).toBe(true);
  });

  it('is refused another school’s section, even with a valid id', async () => {
    const res = await post(admin, 'ALL', { sectionIds: [nvmpSection._id.toString()] });
    expect(res).toMatchObject({ ok: false, status: 403 });
    expect(res.message).toMatch(/do not belong to this school/i);
  });

  it('may narrow by role', async () => {
    const res = await post(admin, 'ALL', { sectionIds: [ownSection._id.toString()], roleKeys: ['parent'] });
    expect(res.ok).toBe(true);
    expect(res.audience.roleKeys).toEqual(['PARENT']);
  });

  it('is refused a role that does not exist', async () => {
    expect(await post(admin, 'ALL', { sectionIds: [ownSection._id.toString()], roleKeys: ['GOVERNOR'] }))
      .toMatchObject({ ok: false, status: 400 });
  });

  it('cannot post with no school in context', async () => {
    // A platform administrator acting across schools has no audience to address.
    let err;
    try {
      await createAnnouncement(admin, 'ALL', { title: 'X', content: 'Y', audience: { all: true } });
    } catch (e) { err = e; }
    expect(err?.statusCode).toBe(400);
    expect(err?.code).toBe('SCHOOL_REQUIRED');
  });
});

describe('an announcement stays inside its school', () => {
  it('is only visible to the school that posted it', async () => {
    await post(admin, 'ALL', { all: true }, OAK);
    expect(await inOak(() => Announcement.countDocuments())).toBe(1);
    expect(await inNvmp(() => Announcement.countDocuments())).toBe(0);
  });
});

describe('the agent obeys the same rules', () => {
  const tool = getTool('create_announcement');

  it('still requires the announcements.publish permission', () => {
    expect(tool.permission).toBe('announcements.publish');
    expect(tool.mutates).toBe(true);
  });

  it('no longer defaults a teacher’s announcement to the whole school', async () => {
    const result = await runWithTenant(OAK, () =>
      tool.execute(teacher, 'OWN', { title: 'From the agent', content: 'Body' }));
    expect(result.data.audience.all).toBe(false);
    expect(result.data.audience.sectionIds.map(String)).toEqual([ownSection._id.toString()]);
  });

  it('refuses a teacher asking it for the whole school', async () => {
    await expect(
      runWithTenant(OAK, () => tool.execute(teacher, 'OWN', { title: 'X', audience: { all: true } })),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('refuses a teacher asking it for a class they do not teach', async () => {
    await expect(
      runWithTenant(OAK, () => tool.execute(teacher, 'OWN', {
        title: 'X', audience: { sectionIds: [otherSection._id.toString()] },
      })),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('still lets an admin address the school', async () => {
    const result = await runWithTenant(OAK, () =>
      tool.execute(admin, 'ALL', { title: 'From the agent', content: 'Body' }));
    expect(result.data.audience.all).toBe(true);
  });

  it('describes the real audience in the confirmation it asks for', () => {
    const asTeacher = { ...teacher, permissions: { 'announcements.publish': 'OWN' } };
    const asAdmin = { ...admin, permissions: { 'announcements.publish': 'ALL' } };

    expect(tool.summarise({ title: 'X' }, asTeacher)).toMatch(/classes you teach/i);
    expect(tool.summarise({ title: 'X' }, asAdmin)).toMatch(/whole school/i);
    expect(tool.summarise({ title: 'X', audience: { sectionIds: ['a'] } }, asTeacher))
      .toMatch(/classes you selected/i);
  });
});

describe('bulk and agent announcements stay auditable', () => {
  it('records an agent announcement in the audit log', async () => {
    // The orchestrator writes this; the shape is what an auditor reads back.
    await inOak(() => AuditLog.create({
      actorProfileId: teacherId,
      action: 'agent.create_announcement',
      entityType: 'AgentAction',
      after: { request: { title: 'From the agent' }, status: 'EXECUTED' },
      channel: 'WEB',
    }));

    const entries = await inOak(() => AuditLog.find({ action: 'agent.create_announcement' }).lean());
    expect(entries).toHaveLength(1);
    expect(entries[0].after.request.title).toBe('From the agent');
    expect(entries[0].tenantId).toBe(OAK);
  });
});

/**
 * Targeting has to govern reading as well as sending. An announcement
 * addressed to 6-A used to be listed for the whole school, so the audience
 * decided its label and nothing else.
 */
describe('a reader sees only the announcements addressed to them', () => {
  const permsFor = (roleKey) => buildPermissionMap({
    permissions: SYSTEM_ROLES.find((r) => r.key === roleKey).grants,
  });

  /** An actor shaped the way authenticate() builds it. */
  const reader = (roleKey, profileId) => ({
    roleKey, profileId: profileId?.toString() ?? new mongoose.Types.ObjectId().toString(),
    permissions: permsFor(roleKey),
  });

  let ownStudent;   // enrolled in the teacher's section (6-A)
  let otherStudent; // enrolled in the colleague's section (6-B)

  /** Enrols a new student in a section and returns their login profile id. */
  const enrol = async (sectionId, admissionNo) => {
    const profileId = new mongoose.Types.ObjectId();
    const student = await Student.create({ admissionNo, firstName: admissionNo, profileId });
    await Enrollment.create({
      studentId: student._id, sectionId,
      academicYearId: new mongoose.Types.ObjectId(), status: 'ACTIVE',
    });
    return profileId;
  };

  const titlesFor = (actor) => inOak(async () =>
    (await listAnnouncements(actor)).map((a) => a.title).sort());

  beforeEach(async () => {
    await inOak(async () => {
      ownStudent = await enrol(ownSection._id, 'IN-6A');
      otherStudent = await enrol(otherSection._id, 'IN-6B');

      await createAnnouncement(admin, 'ALL',
        { title: 'Whole school', content: 'x', audience: { all: true } });
      await createAnnouncement(teacher, 'OWN',
        { title: 'For 6-A', content: 'x', audience: { sectionIds: [ownSection._id.toString()] } });
      await createAnnouncement(admin, 'ALL',
        { title: 'Staff only', content: 'x', audience: { roleKeys: ['TEACHER'] } });
    });
  });

  it('shows a student the school-wide notice and their own class, not another class', async () => {
    expect(await titlesFor(reader('STUDENT', ownStudent))).toEqual(['For 6-A', 'Whole school']);
  });

  it('does not show a classmate in another section the 6-A notice', async () => {
    expect(await titlesFor(reader('STUDENT', otherStudent))).toEqual(['Whole school']);
  });

  it('withholds a role-targeted notice from a role it was not addressed to', async () => {
    const titles = await titlesFor(reader('STUDENT', ownStudent));
    expect(titles).not.toContain('Staff only');
  });

  it('delivers a role-targeted notice to the role it names', async () => {
    expect(await titlesFor(reader('TEACHER', teacherId))).toContain('Staff only');
  });

  it("shows a parent their child's class notice", async () => {
    const parentProfileId = new mongoose.Types.ObjectId();
    await inOak(async () => {
      const student = await Student.findOne({ admissionNo: 'IN-6A' });
      const { StudentGuardian } = await import('../src/models/student.model.js');
      await StudentGuardian.create({
        studentId: student._id, guardianProfileId: parentProfileId, relation: 'FATHER',
      });
    });
    expect(await titlesFor(reader('PARENT', parentProfileId))).toEqual(['For 6-A', 'Whole school']);
  });

  it('shows an admin everything, because they run school communications', async () => {
    expect(await titlesFor(reader('ADMIN'))).toEqual(['For 6-A', 'Staff only', 'Whole school']);
  });

  it('shows a teacher the notice they sent themselves', async () => {
    expect(await titlesFor(reader('TEACHER', teacherId))).toContain('For 6-A');
  });

  it('never leaks another school’s announcements', async () => {
    await runWithTenant(NVMP, () => createAnnouncement(
      { ...admin, permissions: permsFor('ADMIN') }, 'ALL',
      { title: 'NVMP only', content: 'x', audience: { all: true } },
    ));
    expect(await titlesFor(reader('ADMIN'))).not.toContain('NVMP only');
  });

  it('a role with no class of its own still sees the school-wide notice', async () => {
    expect(await titlesFor(reader('LIBRARIAN'))).toEqual(['Whole school']);
  });
});
