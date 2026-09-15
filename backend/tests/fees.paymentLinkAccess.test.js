import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { MCP_TOOLS, mcpToolsFor } from '../src/modules/ai/mcp/registry.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { seedSchool, mcp, OAK } from './support/mcpSchool.js';

/**
 * The assistant's payment path, and what it refuses.
 *
 * A STUDENT or PARENT holds `fees.pay` at OWN scope. They pay on the web
 * through `payOnline()`, which is deliberately NOT an MCP capability — see the
 * recorded reasons in mcp.capabilityCoverage.test.js. What the assistant
 * offers instead is `get_payment_link`: the same intent, safely, by handing
 * back the gateway's own checkout URL for an invoice the caller may actually
 * pay.
 *
 * Because that is the operation standing in for a web payment, it is held to
 * the access rules a payment needs. Every refusal below is decided before any
 * gateway call, inside `listInvoices()` at the caller's own scope, so these
 * assertions are about authorization rather than about the payment provider.
 *
 * The fixture: Rahul (OAK-1) owes ₹8,000 on INV-1001 and PARENT is his
 * father; Aman (OAK-3) owes ₹5,000 on INV-1002; Priya (OAK-2) is the signed-in
 * STUDENT and owes nothing; Riverside is a second school with INV-9001.
 */

let school;
beforeEach(async () => {
  school = await seedSchool();
});
afterAll(async () => {
  await resetMcpClient();
});

/** A refusal, or a success that disclosed nothing it should not have. */
const refused = (res) => res.success === false;

describe('the payment capability a family can reach', () => {
  it('is a read, and the ledger write stays with finance', () => {
    expect(MCP_TOOLS.get_payment_link.operation).toBe('GET');
    expect(MCP_TOOLS.get_payment_link.permission).toBe('fees.pay');
    // record_payment is the counter-payment ledger write. A family holds
    // fees.pay at OWN and must still never reach it.
    expect(MCP_TOOLS.record_payment.minScope).toBe('ALL');
    for (const role of ['STUDENT', 'PARENT']) {
      const names = mcpToolsFor(school.people[role].actor).map((t) => t.name);
      expect(names, `${role}`).toContain('get_payment_link');
      expect(names, `${role} can reach the finance ledger write`).not.toContain('record_payment');
    }
  });

  it('is offered to a parent for their own child', async () => {
    const res = await mcp(OAK, school.people.PARENT.actor, 'get_payment_link', {});
    // The gateway may be unconfigured in this environment; what must never
    // happen is a refusal on ownership grounds for the parent's own invoice.
    if (res.success) {
      expect(JSON.stringify(res.data)).toMatch(/INV-1001/);
      expect(JSON.stringify(res.data)).not.toMatch(/INV-1002|INV-9001/);
    } else {
      expect(['PAYMENTS_DISABLED', 'PAYMENT_FAILED']).toContain(res.error?.code);
    }
  });

  it('refuses another child\'s invoice to a parent', async () => {
    // Aman's invoice, handed to Rahul's father as a well-formed id — which is
    // exactly what a model could put in an argument.
    const res = await mcp(OAK, school.people.PARENT.actor, 'get_payment_link', {
      invoiceId: String(school.inv2._id),
    });
    expect(refused(res), 'a parent was given another child\'s payment link').toBe(true);
    expect(JSON.stringify(res)).not.toMatch(/INV-1002/);
    expect(JSON.stringify(res)).not.toMatch(/Aman/);
  });

  it('refuses a classmate\'s invoice to a student', async () => {
    const res = await mcp(OAK, school.people.STUDENT.actor, 'get_payment_link', {
      invoiceId: String(school.inv1._id),
    });
    expect(refused(res), 'a student was given a classmate\'s payment link').toBe(true);
    expect(JSON.stringify(res)).not.toMatch(/INV-1001/);
    expect(JSON.stringify(res)).not.toMatch(/Rahul/);
  });

  it('refuses an invoice from another school', async () => {
    const res = await mcp(OAK, school.people.PARENT.actor, 'get_payment_link', {
      invoiceId: String(school.river.invoice._id),
    });
    expect(refused(res)).toBe(true);
    expect(JSON.stringify(res)).not.toMatch(/INV-9001|Riverside/);
  });

  it('never accepts an identity argument that would change whose bill it is', async () => {
    // The identity-shaped names are stripped by the server before the tool
    // sees them, and the schema is closed, so neither route exists.
    const props = Object.keys(MCP_TOOLS.get_payment_link.inputSchema?.properties ?? {});
    expect(props).not.toContain('studentId');
    expect(props).not.toContain('profileId');
    expect(props).not.toContain('scope');
    expect(MCP_TOOLS.get_payment_link.inputSchema.additionalProperties).toBe(false);

    const res = await mcp(OAK, school.people.STUDENT.actor, 'get_payment_link', {
      studentId: String(school.rahul.student._id),
      scope: 'ALL',
    });
    // Whatever it returns, it cannot be Rahul's bill.
    expect(JSON.stringify(res)).not.toMatch(/INV-1001|Rahul/);
  });
});
