import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Role } from '../src/models/role.model.js';
import { Announcement } from '../src/models/announcement.model.js';
import { AgentAction } from '../src/models/agentAction.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { resetAgentThrottle } from '../src/modules/ai/agent/throttle.js';
import { startApi } from './support/mcpHttp.js';
import { seedSchool, inSchool, OAK, RIVER } from './support/mcpSchool.js';

/**
 * Confirmation of a high-risk action, through the endpoints people use.
 *
 *   person asks → agent plans → MCP proposes (confirmation_required)
 *   → person confirms → MCP re-authorizes → claims atomically → executes
 *   → audits → result
 *
 * The action is a school-wide announcement (risk HIGH, seen by everyone). It
 * used to be a fee payment; recording money is no longer something the
 * assistant does at all (mcp/decisions.js). Every unsafe case is checked in
 * the database: no announcement appears, and the proposal is left in a state
 * that says what happened to it.
 */

let api;
let school;

beforeAll(async () => {
  api = await startApi();
});
afterAll(async () => {
  await api.close();
  await resetMcpClient();
});
beforeEach(async () => {
  resetAgentThrottle();
  school = await seedSchool();
});

const PAY = 'Post an announcement: Sports day moves to Friday';
const TITLE = 'Sports day moves to Friday';
const payments = () => inSchool(OAK, () => Announcement.countDocuments({ title: TITLE }));
const actionRow = (id) => inSchool(OAK, () => AgentAction.findById(id).lean());
const auditWith = (status) => inSchool(OAK, () => AuditLog.findOne({ action: 'agent.create_announcement', 'after.status': status }).lean());

async function propose() {
  const res = await api.ask(school.people.ADMIN, PAY);
  expect(res.status).toBe(200);
  expect(res.action).toMatchObject({ tool: 'create_announcement', risk: 'HIGH', expiresInMinutes: 10 });
  expect(res.action.summary).toContain(TITLE);
  expect(await payments()).toBe(0);
  expect((await actionRow(res.action.id)).status).toBe('PENDING');
  expect((await auditWith('CONFIRMATION_REQUIRED')).after.confirmed).toBe(false);
  return res.action;
}

describe('confirming a high-risk action over HTTP', () => {
  it('VALID — proposed, confirmed, re-authorized, executed once and audited', async () => {
    const action = await propose();
    const done = await api.confirm(school.people.ADMIN, action.confirmToken);
    expect(done.status).toBe(200);
    expect(done.executed).toBe(true);
    expect(done.via).toBe('MCP');
    expect(await payments()).toBe(1);
    expect((await actionRow(action.id)).status).toBe('EXECUTED');
    const audit = await auditWith('EXECUTED');
    expect(audit.after.confirmed).toBe(true);
    expect(String(audit.entityId)).toBe(action.id);
    expect(String(audit.actorProfileId)).toBe(school.people.ADMIN.actor.profileId);
  });

  it('EXPIRED — refused with 410, nothing written, and the proposal is closed as expired', async () => {
    const action = await propose();
    await inSchool(OAK, () => AgentAction.updateOne({ _id: action.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } }));
    const res = await api.confirm(school.people.ADMIN, action.confirmToken);
    expect(res.status).toBe(410);
    expect(res.body.success).toBe(false);
    expect(await payments()).toBe(0);
    expect((await actionRow(action.id)).status).toBe('EXPIRED');
  });

  it('REUSED — the second confirmation is refused and the payment exists once', async () => {
    const action = await propose();
    expect((await api.confirm(school.people.ADMIN, action.confirmToken)).status).toBe(200);
    const again = await api.confirm(school.people.ADMIN, action.confirmToken);
    expect(again.status).toBe(409);
    expect(again.body.success).toBe(false);
    expect(await payments()).toBe(1);
  });

  it('ANOTHER USER — a token presented by someone else is refused and stays its owner\'s to answer', async () => {
    const action = await propose();
    const res = await api.confirm(school.people.PRINCIPAL, action.confirmToken);
    expect(res.status).toBe(403);
    expect(await payments()).toBe(0);
    expect((await actionRow(action.id)).status).toBe('PENDING');
  });

  it('ANOTHER SCHOOL — a token presented from another school finds nothing there, and writes nothing anywhere', async () => {
    const action = await propose();
    const res = await api.confirm(school.people.RIVER_ADMIN, action.confirmToken);
    expect([403, 404]).toContain(res.status);
    expect(res.body.success).toBe(false);
    expect(await payments()).toBe(0);
    expect(await inSchool(RIVER, () => Announcement.countDocuments({ title: TITLE }))).toBe(0);
    expect((await actionRow(action.id)).status).toBe('PENDING');
  });

  it('PERMISSION REMOVED — revoked between the proposal and the yes, so the yes is refused', async () => {
    const action = await propose();
    await Role.updateOne({ key: 'ADMIN' }, { $pull: { permissions: { key: 'announcements.publish' } } });
    expect(buildPermissionMap(await Role.findOne({ key: 'ADMIN' }))['announcements.publish']).toBeUndefined();

    const res = await api.confirm(school.people.ADMIN, action.confirmToken);
    expect(res.status).toBe(403);
    expect(await payments()).toBe(0);
    expect((await actionRow(action.id)).status).not.toBe('EXECUTED');
    expect(await auditWith('FORBIDDEN')).not.toBeNull();
  });

  it('SIMULTANEOUS — two confirmations at once: exactly one runs', async () => {
    const action = await propose();
    const results = await Promise.all([
      api.confirm(school.people.ADMIN, action.confirmToken),
      api.confirm(school.people.ADMIN, action.confirmToken),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await payments()).toBe(1);
    expect((await actionRow(action.id)).status).toBe('EXECUTED');
  });

  it('DECLINED — a "no" closes the proposal and nothing is written', async () => {
    const action = await propose();
    const res = await api.confirm(school.people.ADMIN, action.confirmToken, false);
    expect(res.status).toBe(200);
    expect(res.executed).toBe(false);
    expect(await payments()).toBe(0);
    expect((await actionRow(action.id)).status).toBe('REJECTED');
    // And a "yes" after the "no" does not revive it.
    expect((await api.confirm(school.people.ADMIN, action.confirmToken)).status).toBe(409);
  });
});

describe('the same action over WhatsApp', () => {
  it('a high-risk change is not proposed over WhatsApp: the person is sent to the website', async () => {
    const admin = school.people.ADMIN;
    const proposal = await api.whatsapp(admin, PAY);
    expect(proposal.reply).toMatch(/EduOS website/);
    expect(await inSchool(OAK, () => AgentAction.countDocuments({}))).toBe(0);
    const yes = await api.whatsapp(admin, 'YES');
    expect(yes.reply).not.toMatch(/posted|published/i);
    expect(await payments()).toBe(0);
  });

  it('a WhatsApp YES does not confirm what was proposed on the website', async () => {
    const action = await propose();
    const yes = await api.whatsapp(school.people.ADMIN, 'YES');
    expect(yes.reply).not.toMatch(/posted|published/i);
    expect(await payments()).toBe(0);
    expect((await actionRow(action.id)).status).toBe('PENDING');
  });
});
