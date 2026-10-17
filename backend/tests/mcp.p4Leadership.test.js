import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'eduos-mcp-leadership-'));
process.env.UPLOAD_DIR = UPLOAD_DIR;

const { MCP_TOOLS, mcpToolsFor, confirmableOn, validateMcpRegistry } = await import('../src/modules/ai/mcp/registry.js');
const { leadershipTools } = await import('../src/modules/ai/mcp/tools/p4Leadership.js');
const { isDecidingToolName } = await import('../src/modules/ai/mcp/decisions.js');
const { resetMcpClient } = await import('../src/modules/ai/mcp/client.js');
const { BoardMeeting } = await import('../src/models/governance.model.js');
const { BoardPack } = await import('../src/models/boardPack.model.js');
const { DocumentType, DocumentRequest } = await import('../src/models/documentRequest.model.js');
const { IssuedCertificate } = await import('../src/models/issuedCertificate.model.js');
const governance = await import('../src/modules/governance/governance.service.js');
const { inSchool, mcp, seedSchool, seedPerson, actorForRole, OAK } = await import('./support/mcpSchool.js');

/**
 * Leadership tools for the assistant (tools/p4Leadership.js): principal,
 * administrator and trustee reads; every write a draft the same person
 * confirms; the certificate on the website only; scope from the permission map.
 */
const NAMES = Object.keys(leadershipTools);
let s;
let trustee;
const inOak = (fn) => inSchool(OAK, fn);
const DAY = 86_400_000;

beforeEach(async () => {
  s = await seedSchool();
  trustee = await seedPerson({ roleKey: 'TRUSTEE', roleId: s.roleIds.TRUSTEE, displayName: 'Mrs Trustee' });
});
afterAll(async () => { await resetMcpClient(); rmSync(UPLOAD_DIR, { recursive: true, force: true }); });

describe('the leadership tools keep the contract', () => {
  it('are registered, closed, never deciding, writes confirmed, the certificate web-only', () => {
    expect(NAMES).toHaveLength(15);
    for (const n of NAMES) {
      expect(MCP_TOOLS[n], n).toBeTruthy();
      expect(MCP_TOOLS[n].inputSchema.additionalProperties, n).toBe(false);
      expect(isDecidingToolName(n), n).toBe(false);
      if (MCP_TOOLS[n].operation !== 'GET') expect(MCP_TOOLS[n].confirm, n).toBe(true);
    }
    expect(validateMcpRegistry()).toEqual([]);
    expect(confirmableOn(MCP_TOOLS.generate_certificate, 'WHATSAPP')).toBe(false);
    expect(confirmableOn(MCP_TOOLS.respond_to_board_meeting, 'WHATSAPP')).toBe(true);
  });

  it('are offered by role from the permission map', () => {
    const visible = (role) => mcpToolsFor(actorForRole(role)).map((t) => t.name).filter((n) => NAMES.includes(n)).sort();
    const principal = visible('PRINCIPAL');
    expect(principal).toEqual(expect.arrayContaining(['get_school_attendance_overview', 'get_teacher_workload', 'get_board_pack', 'schedule_board_meeting', 'freeze_board_pack']));
    expect(principal).not.toContain('generate_certificate'); // the office issues certificates
    const admin = visible('ADMIN');
    expect(admin).toEqual(expect.arrayContaining(['generate_certificate', 'get_certificate_clearance', 'list_certificate_requests', 'check_certificate_code', 'list_issued_certificates']));
    expect(visible('TRUSTEE').sort()).toEqual(['declare_meeting_conflict', 'get_board_pack', 'list_board_actions', 'mark_board_action_done', 'respond_to_board_meeting']);
    for (const role of ['TEACHER', 'PARENT', 'STUDENT']) {
      expect(visible(role).filter((n) => !['get_board_pack', 'list_board_actions', 'respond_to_board_meeting', 'declare_meeting_conflict', 'mark_board_action_done'].includes(n)), role).toEqual([]);
    }
    expect(visible('PARENT')).toEqual([]);
    expect(visible('STUDENT')).toEqual([]);
  });
});

describe('through the real MCP server', () => {
  it('the principal reads school attendance and workload; a teacher is refused', async () => {
    const a = await mcp(OAK, s.people.PRINCIPAL.actor, 'get_school_attendance_overview', {});
    expect(a.success, JSON.stringify(a.error)).toBe(true);
    expect(a.data.today.notMarked.map((r) => r.class)).toContain('Class 6 B');
    expect(a.speak).toMatch(/register/);
    const w = await mcp(OAK, s.people.PRINCIPAL.actor, 'get_teacher_workload', {});
    expect(w.success, JSON.stringify(w.error)).toBe(true);
    const t = await mcp(OAK, s.people.TEACHER.actor, 'get_school_attendance_overview', {});
    expect(t.success).toBe(false);
  });

  it('the principal schedules a board meeting only after confirming, and the trustee declares a conflict and reads the pack', async () => {
    const P = s.people.PRINCIPAL.actor;
    const ymd = new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10);
    const proposal = await mcp(OAK, P, 'schedule_board_meeting', { title: 'Quarterly board meeting', date: ymd, time: '11:00', memberNames: ['Mrs Trustee', 'PRINCIPAL user'] });
    expect(proposal.success, JSON.stringify(proposal.error)).toBe(true);
    expect(proposal.action.status).toBe('confirmation_required');
    expect(proposal.action.summary).toMatch(/Quarterly board meeting.*Mrs Trustee/);
    expect(await inOak(() => BoardMeeting.countDocuments())).toBe(0);
    const done = await mcp(OAK, P, 'schedule_board_meeting', {}, { confirmationToken: proposal.action.confirmationToken });
    expect(done.success, JSON.stringify(done.error)).toBe(true);
    expect(await inOak(() => BoardMeeting.countDocuments())).toBe(1);

    const ag = await mcp(OAK, P, 'set_board_agenda', { meeting: 'Quarterly board meeting', items: [{ title: 'Accounts', decisionNeeded: true }, { title: 'Transport contract' }], circulate: true });
    expect(ag.success, JSON.stringify(ag.error)).toBe(true);
    const agDone = await mcp(OAK, P, 'set_board_agenda', {}, { confirmationToken: ag.action.confirmationToken });
    expect(agDone.success, JSON.stringify(agDone.error)).toBe(true);
    expect((await inOak(() => BoardMeeting.findOne().lean())).agendaStatus).toBe('CIRCULATED');

    const c = await mcp(OAK, trustee.actor, 'declare_meeting_conflict', { agendaItem: 2, declaration: 'A relative runs the bus company.' }, { channel: 'WHATSAPP' });
    expect(c.success, JSON.stringify(c.error)).toBe(true);
    const cDone = await mcp(OAK, trustee.actor, 'declare_meeting_conflict', {}, { channel: 'WHATSAPP', confirmationToken: c.action.confirmationToken });
    expect(cDone.success, JSON.stringify(cDone.error)).toBe(true);
    const m = await inOak(() => BoardMeeting.findOne().lean());
    expect(m.members.find((x) => x.name === 'Mrs Trustee').conflicts[0]).toMatchObject({ agendaOrder: 2 });

    const fr = await mcp(OAK, P, 'freeze_board_pack', {});
    const frDone = await mcp(OAK, P, 'freeze_board_pack', {}, { confirmationToken: fr.action.confirmationToken });
    expect(frDone.success, JSON.stringify(frDone.error)).toBe(true);
    const pack = await mcp(OAK, trustee.actor, 'get_board_pack', {});
    expect(pack.success, JSON.stringify(pack.error)).toBe(true);
    expect(pack.data.version).toBe(1);
    expect(pack.data.meeting.agenda).toHaveLength(2);
    expect((await inOak(() => BoardPack.findOne().lean())).reads.map((r) => r.name)).toEqual(['Mrs Trustee']);
    // A trustee cannot freeze or schedule.
    expect((await mcp(OAK, trustee.actor, 'freeze_board_pack', {})).success).toBe(false);
    expect((await mcp(OAK, trustee.actor, 'schedule_board_meeting', { title: 'x', date: ymd, time: '10:00' })).success).toBe(false);
  });

  it('only the owner or the secretariat marks a board action done', async () => {
    const P = s.people.PRINCIPAL.actor;
    const m = await inOak(async () => {
      const mm = await governance.create(P, { body: 'TRUST_BOARD', title: 'Board', memberProfileIds: [trustee.actor.profileId, P.profileId], scheduledAt: new Date(Date.now() + DAY).toISOString() });
      await BoardMeeting.updateOne({ _id: mm.id }, { $set: { scheduledAt: new Date(Date.now() - DAY) } });
      await governance.record(P, 'ALL', mm.id, { actions: [{ title: 'Get three quotes for furniture', ownerProfileId: P.profileId }] });
      return mm;
    });
    expect(m.id).toBeTruthy();
    const byTrustee = await mcp(OAK, trustee.actor, 'mark_board_action_done', { action: 'Get three quotes for furniture' });
    expect(byTrustee.success).toBe(false);
    const p = await mcp(OAK, P, 'mark_board_action_done', { action: 'three quotes' });
    expect(p.success, JSON.stringify(p.error)).toBe(true);
    const d = await mcp(OAK, P, 'mark_board_action_done', {}, { confirmationToken: p.action.confirmationToken });
    expect(d.success, JSON.stringify(d.error)).toBe(true);
    expect((await inOak(() => BoardMeeting.findById(m.id).lean())).actions[0].status).toBe('DONE');
  });

  it('the office checks dues and generates a certificate only with a reason when dues are open, on the website', async () => {
    const A = s.people.ADMIN.actor;
    await inOak(async () => {
      const type = await DocumentType.create({ name: 'Transfer Certificate', nameKey: 'transfer-certificate', allowedFileTypes: ['pdf'] });
      await DocumentRequest.create({ studentId: s.rahul.student._id, enrollmentId: s.rahul.enrollment._id, documentTypeId: type._id, documentTypeName: 'Transfer Certificate', purpose: 'Relocation', status: 'APPROVED', studentName: 'Rahul Sharma', admissionNo: 'OAK-1' });
    });
    const cl = await mcp(OAK, A, 'get_certificate_clearance', { studentName: 'Rahul' });
    expect(cl.success, JSON.stringify(cl.error)).toBe(true);
    expect(cl.data.clear).toBe(false);
    const noReason = await mcp(OAK, A, 'generate_certificate', { studentName: 'Rahul' });
    expect(noReason.success).toBe(false);
    expect(JSON.stringify(noReason.error)).toMatch(/Dues are open/);
    const phone = await mcp(OAK, A, 'generate_certificate', { studentName: 'Rahul', overrideReason: 'Trust waived the dues for the transfer.' }, { channel: 'WHATSAPP' });
    expect(phone.success).toBe(false);
    const proposal = await mcp(OAK, A, 'generate_certificate', { studentName: 'Rahul', overrideReason: 'Trust waived the dues for the transfer.', reasonForLeaving: "Parent's transfer" });
    expect(proposal.success, JSON.stringify(proposal.error)).toBe(true);
    expect(proposal.action.summary).toMatch(/dues are open; issuing anyway because: Trust waived/);
    expect(await inOak(() => IssuedCertificate.countDocuments())).toBe(0);
    const done = await mcp(OAK, A, 'generate_certificate', {}, { confirmationToken: proposal.action.confirmationToken });
    expect(done.success, JSON.stringify(done.error)).toBe(true);
    expect(done.data.serialNo).toMatch(/^TC\//);
    const check = await mcp(OAK, A, 'check_certificate_code', { code: done.data.verificationCode });
    expect(check.data.valid).toBe(true);
    // The trustee and the principal cannot generate certificates.
    expect((await mcp(OAK, trustee.actor, 'generate_certificate', { studentName: 'Rahul' })).success).toBe(false);
    expect((await mcp(OAK, s.people.PRINCIPAL.actor, 'list_issued_certificates', {})).success).toBe(false);
  });
});
