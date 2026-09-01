import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { Role } from '../src/models/role.model.js';
import { Grade, Section, Subject, SubjectOffering } from '../src/models/academics.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { AgentAction } from '../src/models/agentAction.model.js';
import { Announcement } from '../src/models/announcement.model.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { getTool, toolsAvailableTo } from '../src/modules/ai/agent/tools.js';
import { checkAuthorization, assertSchoolContext, confirmAction } from '../src/modules/ai/agent/orchestrator.js';
import { runWithTenant, runAcrossSchools } from '../src/tenancy/tenantContext.js';
import '../src/models/profile.model.js';

/**
 * The agent's authorization, which is deliberately the application's own.
 *
 * checkAuthorization() reads the same permission map middleware/permission.js
 * reads, and every tool declares a key from the same catalog — so the bot can
 * never be a softer path to the same data than the REST API is. What is tested
 * here is that this holds for the bulk-reach tools specifically, for every
 * role, on both the proposal and the confirmation turn.
 */

const OAK = 'oakridge';
const inOak = (fn) => runWithTenant(OAK, fn);

const ROLES = ['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL', 'TEACHER', 'STUDENT', 'PARENT', 'FINANCE', 'LIBRARIAN', 'WARDEN'];
const grantsFor = (roleKey) => SYSTEM_ROLES.find((r) => r.key === roleKey).grants;
const permsOf = (roleKey) => buildPermissionMap({ permissions: grantsFor(roleKey) });

const teacherId = new mongoose.Types.ObjectId();
const actorFor = (roleKey, profileId) => ({
  roleKey,
  profileId: profileId?.toString() ?? new mongoose.Types.ObjectId().toString(),
  permissions: permsOf(roleKey),
});

/** Mirrors the orchestrator's token hashing so a proposal can be seeded directly. */
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

/** Runs the agent's own gate for a tool, reporting allow or the refusal code. */
const gate = (roleKey, toolName, profileId) => {
  const tool = getTool(toolName);
  try {
    checkAuthorization(actorFor(roleKey, profileId), tool);
    return 'ALLOW';
  } catch (err) {
    return err.code ?? `DENY_${err.statusCode}`;
  }
};

/** The bulk-reach and bulk-write tools this task is about. */
const BULK_TOOLS = ['create_announcement', 'mark_attendance', 'generate_homework', 'record_fee_payment'];

let ownSection;
let ownSubject;

beforeEach(async () => {
  for (const r of SYSTEM_ROLES) {
    await Role.create({ key: r.key, name: r.name, isSystem: true, permissions: r.grants });
  }
  await inOak(async () => {
    const grade = await Grade.create({ name: 'Class 6', level: 6 });
    ownSection = await Section.create({ gradeId: grade._id, name: 'A', classTeacherId: teacherId });
    ownSubject = await Subject.create({ name: 'Mathematics' });
    await SubjectOffering.create({
      sectionId: ownSection._id, subjectId: ownSubject._id, teacherId,
      termId: new mongoose.Types.ObjectId(),
    });
  });
});

describe('1, 2 & 10. the agent uses the application permission map', () => {
  it('every tool names a permission from the existing catalog', () => {
    const catalogKeys = new Set(SYSTEM_ROLES.flatMap((r) => r.grants.map((g) => g.key)));
    for (const name of BULK_TOOLS) {
      expect(catalogKeys.has(getTool(name).permission), name).toBe(true);
    }
  });

  it('refuses with the same 403 the REST API gives', () => {
    expect(gate('STUDENT', 'create_announcement')).toBe('AGENT_FORBIDDEN');
  });

  it('offers a role only the tools it holds the permission for', () => {
    const studentTools = toolsAvailableTo(actorFor('STUDENT')).map((t) => t.name);
    expect(studentTools).not.toContain('create_announcement');
    expect(studentTools).not.toContain('mark_attendance');
    expect(studentTools).not.toContain('record_fee_payment');
  });
});

describe('7. unauthorized bulk actions are rejected, role by role', () => {
  const EXPECTED = {
    create_announcement: ['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL', 'TEACHER'],
    mark_attendance: ['SUPER_ADMIN', 'ADMIN', 'TEACHER'],
    generate_homework: ['SUPER_ADMIN', 'ADMIN', 'TEACHER'],
    // FINANCE holds fees.pay as of the permission fix; recording a payment is
    // the role's day job.
    record_fee_payment: ['SUPER_ADMIN', 'ADMIN', 'FINANCE'],
  };

  it.each(BULK_TOOLS)('%s admits exactly the roles holding its permission', (toolName) => {
    const allowed = ROLES.filter((r) => gate(r, toolName) === 'ALLOW');
    expect(allowed.sort()).toEqual([...EXPECTED[toolName]].sort());
  });

  it('a family role reaches no bulk tool at all', () => {
    for (const roleKey of ['STUDENT', 'PARENT']) {
      for (const toolName of BULK_TOOLS) {
        expect(gate(roleKey, toolName), `${roleKey}/${toolName}`).not.toBe('ALLOW');
      }
    }
  });

  it('an OWN grant cannot run a tool that demands school-wide scope', () => {
    // record_fee_payment is minScope ALL; a parent holds fees.pay at OWN.
    expect(permsOf('PARENT')['fees.pay']).toBe('OWN');
    expect(gate('PARENT', 'record_fee_payment')).toBe('AGENT_FORBIDDEN_SCOPE');
    // A teacher holds attendance.read, but at OWN, so the school-wide snapshot
    // is refused on scope rather than on the permission being absent.
    expect(permsOf('TEACHER')['attendance.read']).toBe('OWN');
    expect(gate('TEACHER', 'who_is_absent_today')).toBe('AGENT_FORBIDDEN_SCOPE');
    // A librarian holds it at no scope at all.
    expect(gate('LIBRARIAN', 'who_is_absent_today')).toBe('AGENT_FORBIDDEN');
  });
});

describe('3 & 4. a teacher bulk action stays inside the classes they teach', () => {
  const teacher = () => actorFor('TEACHER', teacherId);

  it('announces to its own section when no audience is named', async () => {
    const tool = getTool('create_announcement');
    const result = await inOak(() =>
      tool.execute(teacher(), 'OWN', { title: 'Test', content: 'Body' }));
    expect(result.data.audience.all).toBe(false);
    expect(result.data.audience.sectionIds.map(String)).toEqual([ownSection._id.toString()]);
  });

  it('is refused an audience of the whole school', async () => {
    const tool = getTool('create_announcement');
    await expect(
      inOak(() => tool.execute(teacher(), 'OWN', { title: 'X', content: 'Y', audience: { all: true } })),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('is refused a section it does not teach', async () => {
    const otherSection = await inOak(() => Section.create({
      gradeId: ownSection.gradeId, name: 'B', classTeacherId: new mongoose.Types.ObjectId(),
    }));
    const tool = getTool('create_announcement');
    await expect(
      inOak(() => tool.execute(teacher(), 'OWN', {
        title: 'X', content: 'Y', audience: { sectionIds: [otherSection._id.toString()] },
      })),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('cannot mark attendance for a section it does not teach', async () => {
    const otherSection = await inOak(() => Section.create({
      gradeId: ownSection.gradeId, name: 'C', classTeacherId: new mongoose.Types.ObjectId(),
    }));
    const tool = getTool('mark_attendance');
    await expect(
      inOak(() => tool.execute(teacher(), 'OWN', {
        sectionId: otherSection._id.toString(), date: '2026-03-10',
        entries: [{ enrollmentId: new mongoose.Types.ObjectId().toString(), status: 'PRESENT' }],
      })),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('5 & 6. a bulk write has to name one school', () => {
  it.each(BULK_TOOLS)('%s is refused with no school in context', (toolName) => {
    // A platform-level Super Admin runs with no acting school; a bulk write in
    // that state is not confined by the tenant filter.
    expect(() => assertSchoolContext(getTool(toolName)))
      .toThrowError(expect.objectContaining({ code: 'AGENT_SCHOOL_REQUIRED' }));
  });

  it('the same write is allowed once a school is chosen', () => {
    for (const toolName of BULK_TOOLS) {
      expect(() => inOak(() => assertSchoolContext(getTool(toolName)))).not.toThrow();
    }
  });

  it('reads are left alone, because reading across schools is the platform view', () => {
    expect(() => assertSchoolContext(getTool('who_is_absent_today'))).not.toThrow();
    expect(() => assertSchoolContext(getTool('get_attendance'))).not.toThrow();
  });

  it('a school admin announcing reaches its own school and no other', async () => {
    const tool = getTool('create_announcement');
    const created = await inOak(() =>
      tool.execute(actorFor('ADMIN'), 'ALL', { title: 'School wide', content: 'Body' }));
    expect(created.data.tenantId).toBe(OAK);
    expect(await runWithTenant('nvmp', () => Announcement.countDocuments())).toBe(0);
  });
});

describe('8 & 9. confirmation and audit', () => {
  it('every bulk tool is a write, so it is proposed and confirmed, never run outright', () => {
    for (const name of BULK_TOOLS) {
      expect(getTool(name).mutates, name).toBe(true);
    }
  });

  it('the bulk-reach tools declare that they affect other people', () => {
    for (const name of ['create_announcement', 'mark_attendance', 'generate_homework']) {
      expect(getTool(name).affectsOthers, name).toBe(true);
    }
  });

  it('the confirmation names the real audience, not a generic phrase', () => {
    const tool = getTool('create_announcement');
    const teacherSummary = tool.summarise({ title: 'Sports day' }, actorFor('TEACHER', teacherId));
    const adminSummary = tool.summarise({ title: 'Sports day' }, actorFor('ADMIN'));
    expect(teacherSummary).toMatch(/classes you teach/i);
    expect(adminSummary).toMatch(/whole school/i);
  });

  it('an executed bulk action writes an audit entry naming the tool and actor', async () => {
    const actor = actorFor('ADMIN');
    const pending = await inOak(() => AgentAction.create({
      actorProfileId: actor.profileId,
      tool: 'create_announcement',
      args: { title: 'Holiday notice', content: 'School closed Friday' },
      summary: 'Post the announcement to the whole school',
      source: 'WEB',
      tokenHash: hashToken('tok-bulk-1'),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    }));

    await inOak(() => confirmAction({ confirmToken: 'tok-bulk-1', actor, source: 'WEB' }));

    const entry = await inOak(() => AuditLog.findOne({ action: 'agent.create_announcement' }).lean());
    expect(entry).not.toBeNull();
    expect(String(entry.actorProfileId)).toBe(actor.profileId);
    expect(entry.after.status).toBe('EXECUTED');
    expect(entry.after.request.title).toBe('Holiday notice');
    expect(String((await inOak(() => AgentAction.findById(pending._id).lean())).status)).toBe('EXECUTED');
  });

  it('a refused bulk action is audited too, and changes nothing', async () => {
    const actor = actorFor('TEACHER', teacherId);
    await inOak(() => AgentAction.create({
      actorProfileId: actor.profileId,
      tool: 'create_announcement',
      args: { title: 'Everyone', content: 'Body', audience: { all: true } },
      summary: 'Post the announcement to the classes you teach',
      source: 'WEB',
      tokenHash: hashToken('tok-bulk-2'),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    }));

    await expect(
      inOak(() => confirmAction({ confirmToken: 'tok-bulk-2', actor, source: 'WEB' })),
    ).rejects.toMatchObject({ statusCode: 403 });

    const entry = await inOak(() => AuditLog.findOne({ 'after.status': 'FAILED' }).lean());
    expect(entry.action).toBe('agent.create_announcement');
    expect(await inOak(() => Announcement.countDocuments())).toBe(0);
  });
});
