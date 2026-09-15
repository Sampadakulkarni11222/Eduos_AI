import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Role } from '../src/models/role.model.js';
import { Payment } from '../src/models/fee.model.js';
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
 * The action is a fee payment (risk HIGH, money moves). Every unsafe case is
 * checked in the database: no payment row appears, and the proposal is left in
 * a state that says what happened to it.
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

const PAY = 'Record a payment of ₹5,000 against invoice INV-1001 in cash';
const payments = () => inSchool(OAK, () => Payment.countDocuments({ invoiceId: school.inv1._id }));
const actionRow = (id) => inSchool(OAK, () => AgentAction.findById(id).lean());
const auditWith = (status) => inSchool(OAK, () => AuditLog.findOne({ action: 'agent.record_payment', 'after.status': status }).lean());

async function propose() {
  const res = await api.ask(school.people.FINANCE, PAY);
  expect(res.status).toBe(200);
  expect(res.action).toMatchObject({
    tool: 'record_payment', risk: 'HIGH', summary: 'Record a ₹5,000 CASH payment against invoice INV-1001', expiresInMinutes: 10,
  });
  expect(await payments()).toBe(0);
  expect((await actionRow(res.action.id)).status).toBe('PENDING');
  expect((await auditWith('CONFIRMATION_REQUIRED')).after.confirmed).toBe(false);
  return res.action;
}

describe('confirming a high-risk action over HTTP', () => {
  it('VALID — proposed, confirmed, re-authorized, executed once and audited', async () => {
    const action = await propose();
    const done = await api.confirm(school.people.FINANCE, action.confirmToken);
    expect(done.status).toBe(200);
    expect(done.executed).toBe(true);
    expect(done.via).toBe('MCP');
    expect(done.reply).toMatch(/Recorded ₹5,000 against invoice INV-1001\. It is pending admin approval\./);
    expect(await payments()).toBe(1);
    expect((await actionRow(action.id)).status).toBe('EXECUTED');
    const audit = await auditWith('EXECUTED');
    expect(audit.after.confirmed).toBe(true);
    expect(String(audit.entityId)).toBe(action.id);
    expect(String(audit.actorProfileId)).toBe(school.people.FINANCE.actor.profileId);
  });

  it('EXPIRED — refused with 410, nothing written, and the proposal is closed as expired', async () => {
    const action = await propose();
    await inSchool(OAK, () => AgentAction.updateOne({ _id: action.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } }));
    const res = await api.confirm(school.people.FINANCE, action.confirmToken);
    expect(res.status).toBe(410);
    expect(res.body.success).toBe(false);
    expect(await payments()).toBe(0);
    expect((await actionRow(action.id)).status).toBe('EXPIRED');
  });

  it('REUSED — the second confirmation is refused and the payment exists once', async () => {
    const action = await propose();
    expect((await api.confirm(school.people.FINANCE, action.confirmToken)).status).toBe(200);
    const again = await api.confirm(school.people.FINANCE, action.confirmToken);
    expect(again.status).toBe(409);
    expect(again.body.success).toBe(false);
    expect(await payments()).toBe(1);
  });

  it('ANOTHER USER — a token presented by someone else is refused and stays its owner\'s to answer', async () => {
    const action = await propose();
    const res = await api.confirm(school.people.ADMIN, action.confirmToken);
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
    expect(await inSchool(RIVER, () => Payment.countDocuments())).toBe(0);
    expect((await actionRow(action.id)).status).toBe('PENDING');
  });

  it('PERMISSION REMOVED — revoked between the proposal and the yes, so the yes is refused', async () => {
    const action = await propose();
    await Role.updateOne({ key: 'FINANCE' }, { $pull: { permissions: { key: 'fees.pay' } } });
    expect(buildPermissionMap(await Role.findOne({ key: 'FINANCE' }))['fees.pay']).toBeUndefined();

    const res = await api.confirm(school.people.FINANCE, action.confirmToken);
    expect(res.status).toBe(403);
    expect(await payments()).toBe(0);
    expect((await actionRow(action.id)).status).not.toBe('EXECUTED');
    expect(await auditWith('FORBIDDEN')).not.toBeNull();
  });

  it('SIMULTANEOUS — two confirmations at once: exactly one runs', async () => {
    const action = await propose();
    const results = await Promise.all([
      api.confirm(school.people.FINANCE, action.confirmToken),
      api.confirm(school.people.FINANCE, action.confirmToken),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await payments()).toBe(1);
    expect((await actionRow(action.id)).status).toBe('EXECUTED');
  });

  it('DECLINED — a "no" closes the proposal and nothing is written', async () => {
    const action = await propose();
    const res = await api.confirm(school.people.FINANCE, action.confirmToken, false);
    expect(res.status).toBe(200);
    expect(res.executed).toBe(false);
    expect(await payments()).toBe(0);
    expect((await actionRow(action.id)).status).toBe('REJECTED');
    // And a "yes" after the "no" does not revive it.
    expect((await api.confirm(school.people.FINANCE, action.confirmToken)).status).toBe(409);
  });
});

describe('confirming the same action over WhatsApp', () => {
  it('a YES runs it once; a second YES finds nothing to run', async () => {
    const finance = school.people.FINANCE;
    const proposal = await api.whatsapp(finance, PAY);
    expect(proposal.reply).toMatch(/Record a ₹5,000 CASH payment against invoice INV-1001/);
    expect(await payments()).toBe(0);

    const yes = await api.whatsapp(finance, 'YES');
    expect(yes.reply).toMatch(/pending admin approval/);
    expect(await payments()).toBe(1);

    const again = await api.whatsapp(finance, 'YES');
    expect(again.reply).not.toMatch(/Recorded|pending admin approval/);
    expect(await payments()).toBe(1);
  });
});
