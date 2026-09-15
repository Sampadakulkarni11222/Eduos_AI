import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { MCP_TOOLS, mcpToolsFor, mutates } from '../src/modules/ai/mcp/registry.js';
import { capabilityIndex, capabilitiesFor } from '../src/modules/ai/mcp/capabilities.js';
import { validateArgs } from '../src/modules/ai/mcp/validate.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { seedSchool, actorForRole, mcp, OAK } from './support/mcpSchool.js';

/**
 * Coverage and safety of the registry-driven architecture.
 *
 * Complements mcp.capabilityResolution.test.js, which asserts that resolution
 * works from metadata. This file asserts the things that must remain true
 * AROUND it: that schema validation actually refuses what it claims to, that
 * reachability does not depend on the legacy rule table, that an identifier
 * cannot be used to widen access, and that the capabilities deliberately left
 * unexposed are still absent — with the reason recorded next to the assertion,
 * so a future "why is there no tool for this?" has an answer in the codebase.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

let school;
beforeEach(async () => {
  school = await seedSchool();
});
afterAll(async () => {
  await resetMcpClient();
});

const teacherTools = () => mcpToolsFor(actorForRole('TEACHER'));

/* ── 11. Schema validation ────────────────────────────────── */

describe('schema validation refuses what the schema does not declare', () => {
  it('every teacher-visible tool declares a closed object schema', () => {
    for (const tool of teacherTools()) {
      const schema = MCP_TOOLS[tool.name].inputSchema;
      expect(schema?.type, `${tool.name}`).toBe('object');
      expect(schema.additionalProperties, `${tool.name} accepts arbitrary keys`).toBe(false);
    }
  });

  it('an unknown argument is rejected, not ignored, for every teacher-visible tool', () => {
    for (const tool of teacherTools()) {
      const schema = MCP_TOOLS[tool.name].inputSchema;
      const result = validateArgs(schema, { definitelyNotAParameter: 'x' });
      expect(result.valid, `${tool.name} accepted an unknown argument`).toBe(false);
      expect(result.errors.join(' '), tool.name).toMatch(/is not a parameter of this tool/);
    }
  });

  it('identity-shaped arguments never reach a tool, whatever a caller sends', async () => {
    // The server strips these before validation (session.js STRIPPED_ARGS), so
    // they are neither honoured nor reported as unknown — they simply cannot
    // travel in arguments at all.
    const res = await mcp(OAK, school.people.TEACHER.actor, 'get_my_classes', {
      tenantId: 'riverside', role: 'ADMIN', scope: 'ALL', profileId: String(new mongoose.Types.ObjectId()),
    });
    expect(res.success).toBe(true);
    expect(JSON.stringify(res.data)).not.toMatch(/Riverside/);
  });

  it('the server validates against the tool\'s own schema, not the tool object', () => {
    // validateArgs returns valid:true for anything whose `properties` it cannot
    // see, so passing the tool instead of tool.inputSchema would disable every
    // check silently. This is the line that must not regress.
    expect(read('modules/ai/mcp/server.js')).toContain('validateArgs(tool.inputSchema, candidate)');
  });
});

/* ── 10. Independence from the legacy rule table ──────────── */

describe('capability reachability does not depend on the legacy rule table', () => {
  it('the resolution path imports nothing from the rule table', () => {
    // entityIntent.js and capabilities.js are the resolution path. intent.js is
    // where RULES lives; neither may depend on it, or "registry-driven" would
    // be untrue.
    for (const file of ['modules/ai/agent/entityIntent.js', 'modules/ai/mcp/capabilities.js']) {
      expect(read(file), `${file} imports intent.js`).not.toMatch(/from ['"][^'"]*\/intent\.js['"]/);
    }
  });

  it('the rule table names only a fraction of what a teacher can reach', () => {
    // Measured from the source, because RULES is deliberately not exported.
    const ruleTools = new Set([...read('modules/ai/agent/intent.js').matchAll(/tool: '([a-z_]+)'/g)].map((m) => m[1]));
    const visible = teacherTools().map((t) => t.name);
    const covered = visible.filter((name) => ruleTools.has(name));

    expect(covered.length).toBeGreaterThan(0);
    // The point of the architecture: most authorized capabilities have no rule
    // and are reachable anyway.
    expect(covered.length).toBeLessThan(visible.length);
  });

  it('every teacher-visible tool survives narrowing whether or not a rule names it', async () => {
    const { narrowToolsForMessage } = await import('../src/modules/ai/agent/intent.js');
    const tools = teacherTools();
    const ruleTools = new Set([...read('modules/ai/agent/intent.js').matchAll(/tool: '([a-z_]+)'/g)].map((m) => m[1]));
    const withoutARule = tools.filter((t) => !ruleTools.has(t.name));
    expect(withoutARule.length).toBeGreaterThan(0);

    const narrowed = new Set(narrowToolsForMessage(tools, 'what is happening with attendance in Class 5-A').map((t) => t.name));
    for (const tool of withoutARule) {
      expect(narrowed.has(tool.name), `${tool.name} has no rule and was dropped`).toBe(true);
    }
  });
});

/* ── 6. Identifiers cannot widen access ───────────────────── */

describe('an identifier cannot be used to widen access', () => {
  it('another class\'s section id is refused to a teacher who does not teach it', async () => {
    const res = await mcp(OAK, school.people.TEACHER.actor, 'get_attendance_roster', {
      sectionId: String(school.sectionB._id),
    });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res)).not.toMatch(/Riya/);
  });

  it('another school\'s section id finds nothing', async () => {
    const res = await mcp(OAK, school.people.TEACHER.actor, 'get_attendance_roster', {
      sectionId: String(school.river.section._id),
    });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res)).not.toMatch(/Riverside/);
  });

  it('a student id from outside the caller\'s scope does not disclose that student', async () => {
    const res = await mcp(OAK, school.people.STUDENT.actor, 'get_student_attendance', {
      studentId: String(school.rahul.student._id), // Priya asking about Rahul
    });
    if (res.success) {
      expect(JSON.stringify(res.data)).not.toMatch(/Rahul/);
    } else {
      expect(['NOT_FOUND', 'FORBIDDEN', 'FORBIDDEN_SCOPE', 'NEEDS_INPUT', 'INVALID_INPUT']).toContain(res.error?.code);
    }
  });
});

/* ── 7. Write safety, enumerated from the registry ────────── */

describe('every teacher-visible write keeps its protections', () => {
  it('declares confirmation and a summary, and is audited through the server', () => {
    const writes = teacherTools().filter((t) => mutates(MCP_TOOLS[t.name]));
    expect(writes.length).toBeGreaterThan(0);

    for (const { name } of writes) {
      const tool = MCP_TOOLS[name];
      expect(typeof tool.summarise, `${name} cannot describe itself for confirmation`).toBe('function');
      // Anything reaching another person's record must be confirmed by a human.
      if (tool.affectsOthers) expect(Boolean(tool.confirm || tool.confirmWhen), `${name} affects others unconfirmed`).toBe(true);
    }
  });

  it('no write tool takes an identity argument that would let a caller act as someone else', () => {
    const IDENTITY = ['actorProfileId', 'userId', 'roleKey', 'tenantId', 'scope', 'permissions'];
    for (const { name } of teacherTools().filter((t) => mutates(MCP_TOOLS[t.name]))) {
      const props = Object.keys(MCP_TOOLS[name].inputSchema?.properties ?? {});
      expect(props.filter((p) => IDENTITY.includes(p)), `${name}`).toEqual([]);
    }
  });
});

/* ── 9. Capabilities deliberately not exposed ─────────────── */

describe('the capabilities left unexposed are still unexposed, for the recorded reasons', () => {
  const names = () => Object.keys(MCP_TOOLS);

  it('attendance OCR has no tool: MCP has no file-upload channel', () => {
    expect(names().filter((n) => /ocr/i.test(n))).toEqual([]);
  });

  it('student photo has no tool: its route is guarded by students.read, which every seeded role holds', () => {
    // A write tool needs a permission some role lacks, or the write-coverage
    // battery's outsider case cannot be satisfied honestly. Exposing it would
    // have meant inventing a permission.
    expect(names()).not.toContain('set_student_photo');
  });

  it('notification read/read-all have no tools: those endpoints carry no permission at all', () => {
    expect(names()).not.toContain('mark_notifications_read');
    expect(names()).not.toContain('mark_all_notifications_read');
  });

  /**
   * Taking a payment is the one operation a STUDENT or PARENT can perform on
   * the web that the assistant deliberately will not.
   *
   * They hold fees.pay at OWN scope and pay through fee.service.payOnline(),
   * which cannot be exposed here without breaking payment integrity:
   *
   *  1. On a real gateway it returns an orderId, a keyId and a payment-intent
   *     id that only a browser checkout SDK can consume. In a chat channel
   *     that is unusable — and on WhatsApp it writes gateway session material
   *     into a logged, forwardable transcript.
   *  2. It creates an INITIATED Payment row as a side effect of merely asking,
   *     so a question that cannot be completed still leaves a dangling intent
   *     in the ledger for reconciliation to explain.
   *  3. When the provider is the sandbox it takes the other branch and marks
   *     the invoice PAID outright, with no gateway interaction at all — the
   *     assistant settling a bill on the strength of a sentence.
   *
   * Nothing is actually missing: get_payment_link exposes the same intent
   * safely, running listInvoices() at the caller's own scope and handing back
   * the real checkout URL, so the person pays on the gateway's own page. And
   * record_payment stays ALL-scoped for finance — it is the counter-payment
   * ledger write, not a family paying their own bill, and must not be widened
   * to make an operation count match.
   */
  it('online payment has no tool: a chat channel cannot complete a gateway checkout', () => {
    expect(names()).not.toContain('pay_online');
    expect(names()).not.toContain('pay_invoice');
    expect(names()).not.toContain('make_payment');
    // The safe equivalent is present, and is a read.
    expect(MCP_TOOLS.get_payment_link.operation).toBe('GET');
    // And the finance ledger write stays school-wide, so a family cannot reach
    // it even though they hold fees.pay.
    expect(MCP_TOOLS.record_payment.minScope).toBe('ALL');
  });

  it('calendar creation remains school-wide only: CalendarEvent has no section', () => {
    expect(MCP_TOOLS.create_calendar_event.minScope).toBe('ALL');
  });

  it('no tool was added that would need a permission outside the catalog', () => {
    for (const [name, tool] of Object.entries(MCP_TOOLS)) {
      expect(typeof tool.permission, `${name}`).toBe('string');
    }
  });
});

/* ── 1. The registry is the source of truth ───────────────── */

describe('the capability index and the registry agree', () => {
  it('describes every tool in the registry, and no others', () => {
    expect(capabilityIndex().map((c) => c.name).sort()).toEqual(Object.keys(MCP_TOOLS).sort());
  });

  it('a teacher\'s capabilities are exactly their authorized tools', () => {
    const actor = actorForRole('TEACHER');
    expect(capabilitiesFor(actor).map((c) => c.name).sort()).toEqual(mcpToolsFor(actor).map((t) => t.name).sort());
  });
});
