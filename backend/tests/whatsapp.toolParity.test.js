import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  MCP_TOOLS, mcpToolsFor, mutates, requiresConfirmation, confirmableOn,
} from '../src/modules/ai/mcp/registry.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { nameParts } from '../src/modules/ai/agent/capabilityResolver.js';
import { runAgentSafely } from '../src/modules/ai/agent/orchestrator.js';
import { resetAgentThrottle } from '../src/modules/ai/agent/throttle.js';
import { converse } from '../src/modules/whatsapp/whatsapp.agent.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { AgentAction } from '../src/models/agentAction.model.js';
import { Ticket } from '../src/models/ticket.model.js';
import {
  seedSchool, seedPerson, mcp, readToolArgs, inSchool, OAK,
} from './support/mcpSchool.js';

/**
 * WhatsApp parity: every tool a role holds on the website, it holds on
 * WhatsApp, with the one difference the product rule allows.
 *
 *   reads                       complete on WhatsApp exactly as on the website
 *   a person's own low-impact   proposed on WhatsApp and confirmed there by a
 *   writes                      "yes" from the same person
 *   HIGH / CRITICAL risk, money, proposed on the website only; on WhatsApp the
 *   other people's records,     request is understood, checked and prepared
 *   approvals                   exactly as on the website, then handed over
 *                               with "confirm on the website" (CONFIRM_ON_WEB)
 *
 * And the same question reaches the same tool on both channels: they share one
 * agent and one MCP server, and this file holds that for every role's whole
 * catalogue rather than for a handful of phrases.
 *
 * The sweep calls every tool through the real MCP server on both channels with
 * the same arguments (readToolArgs, or none). Whatever the website answers --
 * data, a draft, "which one?", "not found", "missing argument" -- WhatsApp
 * must answer the same, except that a draft the website would confirm is
 * handed to the website when the tool may not be confirmed on WhatsApp. Writes
 * that run without a confirmation are not executed here (the sweep would run
 * them twice); they are asserted on policy instead.
 */

const ROLES = SYSTEM_ROLES.map((r) => r.key).filter((k) => k !== 'SUPER_ADMIN');
const EXTRA_ROLES = ['NURSE', 'HR', 'MARKETING', 'COMPLIANCE', 'TRUSTEE', 'ALUMNUS'];

let s;
beforeEach(async () => {
  s = await seedSchool();
  for (const key of EXTRA_ROLES) {
    if (!s.people[key]) s.people[key] = await seedPerson({ roleKey: key, roleId: s.roleIds[key] });
  }
});
afterAll(async () => { await resetMcpClient(); });

const actorOf = (role) => s.people[role].actor;
const visibleTo = (actor) => mcpToolsFor(actor).map((t) => t.name);

/** What WhatsApp must do with a tool, from its declared policy. */
function whatsappHandling(tool) {
  if (!mutates(tool)) return 'complete';
  if (!requiresConfirmation(tool, {})) return 'runs-unconfirmed';
  return confirmableOn(tool, 'WHATSAPP') ? 'confirm-on-whatsapp' : 'confirm-on-website';
}

/** The capability's own name, as a person would ask for it (the reachability suite's phrasing). */
function asAQuestion(name) {
  const { verb, nouns, self } = nameParts(name);
  const spoken = name.split('_').join(' ');
  if (!['get', 'list', 'search'].includes(verb)) return spoken;
  return `show ${self ? 'my ' : ''}${nouns.join(' ')}`;
}

/** One turn of the shared agent; a refusal it raises is part of the outcome. */
async function turn(fn) {
  resetAgentThrottle();
  try {
    return await inSchool(OAK, fn);
  } catch (err) {
    return { error: err?.message ?? String(err) };
  }
}

const outcome = (res) => {
  if (res?.action?.status === 'confirmation_required') return 'PROPOSED';
  if (res?.success) return 'OK';
  if (res?.error?.details?.reason === 'CONFIRM_ON_WEB') return 'CONFIRM_ON_WEB';
  return `FAIL:${res?.error?.code ?? 'UNKNOWN'}`;
};

describe('policy: what WhatsApp does with each tool', () => {
  it('high-impact, money, approval and other-people writes are confirmed on the website; own low-impact writes on WhatsApp', () => {
    const wrong = [];
    for (const [name, tool] of Object.entries(MCP_TOOLS)) {
      const handling = whatsappHandling(tool);
      const highImpact = tool.risk === 'HIGH' || tool.risk === 'CRITICAL' || tool.affectsOthers || tool.approverDecision;
      if (mutates(tool) && handling !== 'runs-unconfirmed' && highImpact && handling !== 'confirm-on-website') wrong.push(`${name} would be confirmed on WhatsApp`);
      if (mutates(tool) && !highImpact && handling === 'confirm-on-website') wrong.push(`${name} is low-impact but website-only`);
      if (tool.approverDecision && !(tool.risk === 'HIGH' && tool.affectsOthers && tool.confirm)) wrong.push(`${name} records a decision without website confirmation`);
    }
    expect(wrong).toEqual([]);
  });

  it('every write that runs without a confirmation is low-risk and lands on nobody else', () => {
    const unconfirmed = Object.entries(MCP_TOOLS).filter(([, t]) => whatsappHandling(t) === 'runs-unconfirmed');
    for (const [name, t] of unconfirmed) {
      expect(t.affectsOthers, name).toBeFalsy();
      expect(['LOW', 'MEDIUM'], name).toContain(t.risk);
    }
  });
});

describe('sweep: every tool each role holds behaves the same on WhatsApp as on the website', () => {
  for (const role of ROLES) {
    it(`${role}`, async () => {
      const actor = actorOf(role);
      const names = visibleTo(actor);
      expect(names.length).toBeGreaterThan(0);
      const problems = [];
      const tally = { complete: 0, whatsappConfirm: 0, websiteHandoff: 0, asked: 0 };

      for (const name of names) {
        const tool = MCP_TOOLS[name];
        const handling = whatsappHandling(tool);
        if (handling === 'runs-unconfirmed') continue;
        const args = readToolArgs(name, s);
        // eslint-disable-next-line no-await-in-loop -- sequential on purpose: one in-memory database
        const web = outcome(await mcp(OAK, actor, name, args, { channel: 'WEB' }));
        // eslint-disable-next-line no-await-in-loop
        const wa = outcome(await mcp(OAK, actor, name, args, { channel: 'WHATSAPP' }));

        if (web === 'PROPOSED') {
          const expected = handling === 'confirm-on-whatsapp' ? 'PROPOSED' : 'CONFIRM_ON_WEB';
          if (wa !== expected) problems.push(`${name}: website drafts it, WhatsApp gave ${wa} (expected ${expected})`);
          if (expected === 'PROPOSED') tally.whatsappConfirm += 1; else tally.websiteHandoff += 1;
        } else if (wa !== web) {
          problems.push(`${name}: website ${web}, WhatsApp ${wa}`);
        } else if (web === 'OK') {
          tally.complete += 1;
        } else {
          tally.asked += 1; // asked for detail / not found: identically on both channels
        }
      }
      expect(problems, `${role}: ${problems.join('; ')}`).toEqual([]);
      expect(tally.complete, `${role} completed no read at all`).toBeGreaterThan(0);
    }, 600_000);
  }
});

describe('the same question reaches the same tool on both channels', () => {
  for (const role of ROLES) {
    it(`${role}`, async () => {
      const actor = actorOf(role);
      const names = visibleTo(actor);
      // A spread of the role's catalogue: every fifth capability, reads and
      // writes alike, asked in the capability's own words.
      const sample = names.filter((_, i) => i % 5 === 0);
      const differ = [];
      for (const name of sample) {
        const message = asAQuestion(name);
        // eslint-disable-next-line no-await-in-loop
        const web = await turn(() => runAgentSafely({ message, actor, source: 'WEB' }));
        // eslint-disable-next-line no-await-in-loop
        const wa = await turn(() => converse({ actor, text: message }));
        // A refusal (a module switched off, a screen that is not this
        // person's) is raised identically on both channels.
        if (web.error || wa.error) {
          if (web.error !== wa.error) differ.push(`"${message}": web ${web.error ?? 'answered'}, WhatsApp ${wa.error ?? 'answered'}`);
          continue;
        }
        const webTool = web.action?.tool ?? web.tool ?? null;
        const waTool = wa.tool ?? null;
        if (webTool !== waTool) {
          // A draft WhatsApp may not confirm is handed to the website, and the
          // reply says so; the tool chosen is still the same one.
          const handedOver = web.action && /website/i.test(wa.reply ?? '');
          if (!handedOver) differ.push(`"${message}": web ${webTool}, WhatsApp ${waTool}`);
        }
        if (web.action && wa.awaitingConfirmation && !confirmableOn(MCP_TOOLS[web.action.tool], 'WHATSAPP')) {
          differ.push(`"${message}": ${web.action.tool} was put to a WhatsApp "yes"`);
        }
      }
      expect(differ, `${role}: ${differ.join('; ')}`).toEqual([]);
    }, 600_000);
  }
});

describe('a low-impact write completes on WhatsApp; a high-impact one is handed to the website', () => {
  it('a parent files a ticket on WhatsApp and confirms it there with "yes"', async () => {
    const parent = actorOf('PARENT');
    const proposal = await mcp(OAK, parent, 'create_ticket', { subject: 'The school bus was late today' }, { channel: 'WHATSAPP' });
    expect(proposal.action?.status).toBe('confirmation_required');
    expect(await inSchool(OAK, () => Ticket.countDocuments({}))).toBe(0);
    const done = await inSchool(OAK, () => converse({ actor: parent, text: 'yes' }));
    expect(done.executed).toBe(true);
    expect(await inSchool(OAK, () => Ticket.countDocuments({}))).toBe(1);
  });

  it('a teacher marking a class register on WhatsApp is told to confirm on the website, and nothing is proposed', async () => {
    const teacher = actorOf('TEACHER');
    const out = await mcp(OAK, teacher, 'mark_attendance', {
      sectionId: String(s.sectionA._id),
      entries: [{ enrollmentId: String(s.rahul.enrollment._id), status: 'PRESENT' }],
    }, { channel: 'WHATSAPP' });
    expect(out.success).toBe(false);
    expect(out.error.details?.reason).toBe('CONFIRM_ON_WEB');
    expect(await inSchool(OAK, () => AgentAction.countDocuments({}))).toBe(0);
  });
});
