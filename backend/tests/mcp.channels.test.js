import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { Role } from '../src/models/role.model.js';
import { Account } from '../src/models/account.model.js';
import { Profile } from '../src/models/profile.model.js';
import { Student, Enrollment } from '../src/models/student.model.js';
import { Grade, Section, AcademicYear } from '../src/models/academics.model.js';
import { AttendanceRecord } from '../src/models/attendanceRecord.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import { runAgentSafely, confirmAction } from '../src/modules/ai/agent/orchestrator.js';
import { converse, resolveActorByPhone, runInActorScope } from '../src/modules/whatsapp/whatsapp.agent.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';

/**
 * One AI agent, one MCP layer, two channels.
 *
 * The claim this file exists to hold: the website assistant and the WhatsApp
 * bot are two ways into the same thing. Asked the same question by the same
 * person, they must reach the same tool, apply the same authorization, and
 * return the same facts — differing only in how the answer is written out and
 * how the confirmation is collected.
 *
 * Run with the deterministic rule router (no model), because what is being
 * asserted is the routing *architecture*, not a model's choices.
 */

const OAK = 'oakridge';
const inOak = (fn) => runWithTenant(OAK, fn);

const permsOf = (roleKey) =>
  buildPermissionMap({ permissions: SYSTEM_ROLES.find((r) => r.key === roleKey).grants });

let section;
let enrollment;
let adminActor;

async function seedWhatsappUser({ roleKey, phone }) {
  const role = await Role.findOne({ key: roleKey });
  const account = await Account.create({ phoneE164: phone, status: 'ACTIVE' });
  const profile = await Profile.create({
    accountId: account._id,
    roleId: role._id,
    displayName: `${roleKey} User`,
    status: 'ACTIVE',
    tenantId: OAK,
    tenantName: 'Oakridge Academy',
  });
  return { account, profile };
}

beforeEach(async () => {
  for (const r of SYSTEM_ROLES) {
    await Role.create({ key: r.key, name: r.name, isSystem: true, permissions: r.grants });
  }

  await inOak(async () => {
    const year = await AcademicYear.create({
      name: '2026-27', startsOn: new Date('2026-04-01'), endsOn: new Date('2027-03-31'), isCurrent: true,
    });
    const grade = await Grade.create({ name: 'Class 6', level: 6 });
    section = await Section.create({ gradeId: grade._id, name: 'A' });
    const student = await Student.create({ admissionNo: 'OAK-1', firstName: 'Rahul', lastName: 'Sharma' });
    enrollment = await Enrollment.create({
      studentId: student._id, sectionId: section._id, academicYearId: year._id, status: 'ACTIVE', rollNo: 1,
    });
    await AttendanceRecord.create({
      enrollmentId: enrollment._id,
      sectionId: section._id,
      date: new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())),
      periodNo: null,
      status: 'ABSENT',
    });
  });

  adminActor = {
    roleKey: 'ADMIN',
    profileId: String(new mongoose.Types.ObjectId()),
    permissions: permsOf('ADMIN'),
    tenantId: OAK,
  };
});

afterAll(async () => {
  await resetMcpClient();
});

const askWeb = (actor, message) => inOak(() => runAgentSafely({ message, actor, source: 'WEB' }));

/* ── Website ──────────────────────────────────────────────── */

describe('the website assistant reads through MCP', () => {
  it('answers "who is absent today" from the register, via MCP', async () => {
    const res = await askWeb(adminActor, 'who is absent today?');
    expect(res.via).toBe('MCP');
    expect(res.reply).toMatch(/1 student\(s\) absent/i);
  });

  it('finds a student, via MCP', async () => {
    const res = await askWeb(adminActor, 'find student Rahul');
    expect(res.via).toBe('MCP');
    expect(res.tool).toBe('search_students');
    expect(res.reply).toMatch(/Rahul Sharma/);
  });

  it('answers a pending-fee question, via MCP', async () => {
    const res = await askWeb(adminActor, 'which students have pending fees?');
    expect(res.via).toBe('MCP');
    expect(res.tool).toBe('get_pending_fees');
    expect(res.reply.length).toBeGreaterThan(0);
  });

  it('answers two questions in one message with two tools', async () => {
    const res = await askWeb(adminActor, 'who is absent today and what is the fee collection?');
    expect(res.via).toBe('MCP');
    expect(res.tools.length).toBeGreaterThan(1);
    expect(res.tools).toContain('get_fee_statistics');
  });

  it('grounds the answer in what the tools returned', async () => {
    // The register holds exactly one absence. Whatever the wording, the number
    // in the reply is the number in the database.
    const res = await askWeb(adminActor, 'how many students are absent today?');
    expect(res.reply).toMatch(/\b1\b/);
    expect(res.reply).not.toMatch(/\b(2|3|4|5)\b\s+student\(s\) absent/);
  });

  it('records the read in the audit trail', async () => {
    await askWeb(adminActor, 'find student Rahul');
    const entry = await inOak(() => AuditLog.findOne({ action: 'agent.search_students' }).lean());
    expect(entry).not.toBeNull();
    expect(entry.channel).toBe('WEB');
    expect(entry.after.via).toBe('MCP');
  });
});

describe('the website assistant writes only after confirmation', () => {
  it('proposes an attendance change rather than making it', async () => {
    const res = await askWeb(adminActor, `mark attendance for section ${section._id}`);
    // The rules cannot supply entries, so this asks for detail rather than
    // proposing a half-formed write. Either way nothing is written.
    expect(await inOak(() => AttendanceRecord.countDocuments({ status: 'PRESENT' }))).toBe(0);
    expect(res.reply.length).toBeGreaterThan(0);
  });

  it('carries a confirmation through to the database', async () => {
    // Driven at the MCP layer, because the rule parser cannot express a full
    // attendance payload from a sentence -- but the confirm path is the one the
    // website's /ai/agent/confirm endpoint uses.
    const { openSession, closeSession } = await import('../src/modules/ai/mcp/session.js');
    const { executeToolCall } = await import('../src/modules/ai/mcp/server.js');

    const proposal = await inOak(async () => {
      const sid = openSession({ actor: adminActor, channel: 'WEB' });
      try {
        return await executeToolCall({
          sessionId: sid,
          name: 'mark_attendance',
          args: { sectionId: String(section._id), entries: [{ enrollmentId: String(enrollment._id), status: 'PRESENT' }] },
        });
      } finally {
        closeSession(sid);
      }
    });
    expect(proposal.action.status).toBe('confirmation_required');

    const done = await inOak(() => confirmAction({
      confirmToken: proposal.action.confirmationToken,
      actor: adminActor,
      accept: true,
      source: 'WEB',
    }));
    expect(done.executed).toBe(true);
    expect(await inOak(() => AttendanceRecord.countDocuments({ status: 'PRESENT' }))).toBe(1);
  });

  it('writes nothing when the confirmation is declined', async () => {
    const { openSession, closeSession } = await import('../src/modules/ai/mcp/session.js');
    const { executeToolCall } = await import('../src/modules/ai/mcp/server.js');

    const proposal = await inOak(async () => {
      const sid = openSession({ actor: adminActor, channel: 'WEB' });
      try {
        return await executeToolCall({
          sessionId: sid, name: 'create_student',
          args: { admissionNo: 'OAK-DECLINED', firstName: 'Nope' },
        });
      } finally {
        closeSession(sid);
      }
    });

    const res = await inOak(() => confirmAction({
      confirmToken: proposal.action.confirmationToken, actor: adminActor, accept: false, source: 'WEB',
    }));
    expect(res.executed).toBe(false);
    expect(await inOak(() => Student.countDocuments({ admissionNo: 'OAK-DECLINED' }))).toBe(0);
  });
});

/* ── WhatsApp ─────────────────────────────────────────────── */

describe('WhatsApp reaches the same MCP layer', () => {
  it('resolves the sender to an EduOS actor and answers from the ERP', async () => {
    await seedWhatsappUser({ roleKey: 'ADMIN', phone: '+919999700001' });
    const resolved = await resolveActorByPhone('919999700001');
    expect(resolved.actor.roleKey).toBe('ADMIN');

    const turn = await runInActorScope(resolved, () =>
      converse({ actor: resolved.actor, text: 'who is absent today?' }));

    expect(turn.tool).toBe('who_is_absent_today');
    expect(turn.reply).toMatch(/1 student\(s\) absent/i);
  });

  it('gives the same answer as the website for the same question', async () => {
    await seedWhatsappUser({ roleKey: 'ADMIN', phone: '+919999700002' });
    const resolved = await resolveActorByPhone('919999700002');

    const viaWhatsapp = await runInActorScope(resolved, () =>
      converse({ actor: resolved.actor, text: 'find student Rahul' }));
    const viaWeb = await askWeb(resolved.actor, 'find student Rahul');

    expect(viaWhatsapp.tool).toBe(viaWeb.tool);
    expect(viaWhatsapp.reply).toBe(viaWeb.reply);
  });

  it('applies the same authorization to a student on WhatsApp as on the web', async () => {
    await seedWhatsappUser({ roleKey: 'STUDENT', phone: '+919999700003' });
    const resolved = await resolveActorByPhone('919999700003');

    const turn = await runInActorScope(resolved, () =>
      converse({ actor: resolved.actor, text: 'who is absent today?' }));

    // A student holds attendance.read at OWN, so the school-wide read is not
    // theirs to make. They get their own record, or a refusal -- never the
    // school's register.
    expect(turn.reply).not.toMatch(/1 student\(s\) absent today/i);
  });

  it('records the WhatsApp channel on the audit entry', async () => {
    await seedWhatsappUser({ roleKey: 'ADMIN', phone: '+919999700004' });
    const resolved = await resolveActorByPhone('919999700004');
    await runInActorScope(resolved, () => converse({ actor: resolved.actor, text: 'find student Rahul' }));

    const entry = await inOak(() => AuditLog.findOne({ action: 'agent.search_students' }).lean());
    expect(entry.channel).toBe('WHATSAPP');
  });

  it('builds the arrival briefing through MCP', async () => {
    await seedWhatsappUser({ roleKey: 'ADMIN', phone: '+919999700005' });
    const resolved = await resolveActorByPhone('919999700005');

    const turn = await runInActorScope(resolved, () => converse({ actor: resolved.actor, text: 'Hi' }));
    expect(turn.briefing).toBe(true);

    // Every line in a briefing is a real tool call, so each one is audited like
    // any other read.
    const audited = await inOak(() => AuditLog.countDocuments({ channel: 'WHATSAPP' }));
    expect(audited).toBeGreaterThan(0);
  });

  it('asks for a plain yes before writing, and honours the no', async () => {
    const { profile } = await seedWhatsappUser({ roleKey: 'ADMIN', phone: '+919999700006' });
    const resolved = await resolveActorByPhone('919999700006');

    const { openSession, closeSession } = await import('../src/modules/ai/mcp/session.js');
    const { executeToolCall } = await import('../src/modules/ai/mcp/server.js');

    await runInActorScope(resolved, async () => {
      const sid = openSession({ actor: resolved.actor, channel: 'WHATSAPP' });
      try {
        const proposal = await executeToolCall({
          sessionId: sid, name: 'create_student',
          args: { admissionNo: 'OAK-WA', firstName: 'Whatsapp' },
        });
        expect(proposal.action.status).toBe('confirmation_required');
      } finally {
        closeSession(sid);
      }
    });

    // Nothing yet.
    expect(await inOak(() => Student.countDocuments({ admissionNo: 'OAK-WA' }))).toBe(0);

    // A bare "no" on WhatsApp resolves the outstanding proposal.
    const declined = await runInActorScope(resolved, () =>
      converse({ actor: resolved.actor, text: 'no' }));
    expect(declined.reply.length).toBeGreaterThan(0);
    expect(await inOak(() => Student.countDocuments({ admissionNo: 'OAK-WA' }))).toBe(0);

    const { AgentAction } = await import('../src/models/agentAction.model.js');
    const stillPending = await inOak(() =>
      AgentAction.countDocuments({ actorProfileId: profile._id, status: 'PENDING' }));
    expect(stillPending).toBe(0);
  });

  it('performs the write when the answer is yes', async () => {
    const resolvedSeed = await seedWhatsappUser({ roleKey: 'ADMIN', phone: '+919999700007' });
    const resolved = await resolveActorByPhone('919999700007');

    const { openSession, closeSession } = await import('../src/modules/ai/mcp/session.js');
    const { executeToolCall } = await import('../src/modules/ai/mcp/server.js');

    await runInActorScope(resolved, async () => {
      const sid = openSession({ actor: resolved.actor, channel: 'WHATSAPP' });
      try {
        await executeToolCall({
          sessionId: sid, name: 'create_student',
          args: { admissionNo: 'OAK-WA-YES', firstName: 'Confirmed' },
        });
      } finally {
        closeSession(sid);
      }
    });

    const accepted = await runInActorScope(resolved, () =>
      converse({ actor: resolved.actor, text: 'yes' }));
    expect(accepted.executed).toBe(true);
    expect(await inOak(() => Student.countDocuments({ admissionNo: 'OAK-WA-YES' }))).toBe(1);
    expect(String(resolvedSeed.profile._id)).toBe(resolved.actor.profileId);
  });
});
