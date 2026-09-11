import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { MCP_TOOLS, mcpToolsFor } from '../src/modules/ai/mcp/registry.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { speakOf } from '../src/modules/ai/agent/response.js';
import { seedSchool, mcp, readToolArgs, OAK } from './support/mcpSchool.js';

/**
 * Every read tool, run for real, for every role that can see it.
 *
 * The earlier suites exercised a handful of tools; this one runs all of them.
 * It is the test that found the tools whose schemas or result handling did not
 * match their services — a roster that always reported zero rows, ticket and
 * transport lists that read out "undefined", an at-risk filter that matched
 * nothing. What it asserts is the contract a model depends on:
 *
 *   - the tool either answers, or refuses in a way a person can act on
 *     (not found, needs more detail) — it never crashes;
 *   - what it says out loud contains no "undefined", "NaN" or "[object Object]".
 */

/** Arguments a read tool needs to have something real to find in the fixture (shared with the exposure suite). */
const argsFor = readToolArgs;

/** Refusals that are legitimate answers — things a person can act on. */
const ACCEPTABLE_REFUSALS = new Set(['NOT_FOUND', 'NEEDS_INPUT', 'INVALID_INPUT', 'FORBIDDEN', 'FORBIDDEN_SCOPE', 'CONFLICT']);

let school;
beforeEach(async () => {
  school = await seedSchool();
});
afterAll(async () => {
  await resetMcpClient();
});

const READ_TOOLS = Object.entries(MCP_TOOLS).filter(([, t]) => t.operation === 'GET').map(([n]) => n);

describe('every read tool keeps its contract', () => {
  const ROLES_WITH_PEOPLE = ['ADMIN', 'PRINCIPAL', 'FINANCE', 'TEACHER', 'LIBRARIAN', 'WARDEN', 'PARENT', 'STUDENT'];

  it.each(ROLES_WITH_PEOPLE)('as %s', async (roleKey) => {
    const actor = school.people[roleKey].actor;
    const visible = mcpToolsFor(actor).map((t) => t.name).filter((n) => READ_TOOLS.includes(n));
    const problems = [];

    for (const name of visible) {
      const res = await mcp(OAK, actor, name, argsFor(name, school));
      if (!res.success) {
        if (!ACCEPTABLE_REFUSALS.has(res.error?.code)) problems.push(`${name}: ${res.error?.code} — ${res.error?.message}`);
        continue;
      }
      const said = speakOf(res, 'en');
      if (/undefined|NaN|\[object Object\]/.test(said)) problems.push(`${name}: says "${said}"`);
      expect(() => JSON.stringify(res.data)).not.toThrow();
    }

    expect(problems).toEqual([]);
    expect(visible.length).toBeGreaterThan(0);
  }, 120_000);

  it('covers every read tool with at least one role', () => {
    const covered = new Set(
      ['ADMIN', 'PRINCIPAL', 'FINANCE', 'TEACHER', 'LIBRARIAN', 'WARDEN', 'PARENT', 'STUDENT']
        .flatMap((k) => mcpToolsFor(school.people[k].actor).map((t) => t.name)),
    );
    const uncovered = READ_TOOLS.filter((n) => !covered.has(n));
    expect(uncovered).toEqual([]);
  });

  it('answers the questions the fixture was built to answer, with the fixture\'s numbers', async () => {
    const admin = school.people.ADMIN.actor;

    const fees = await mcp(OAK, admin, 'get_pending_fees', {});
    expect(fees.data.invoiceCount).toBe(2);
    expect(fees.data.totalOutstandingPaise).toBe(1300000);
    expect(fees.data.overduePaise).toBe(800000);

    const rahulsFees = await mcp(OAK, admin, 'get_pending_fees', { search: 'Rahul' });
    expect(rahulsFees.data.invoices.map((i) => i.invoiceNo)).toEqual(['INV-1001']);
    // Totals follow the filter rather than reporting the whole school.
    expect(rahulsFees.data.totalOutstandingPaise).toBe(800000);
    expect(rahulsFees.data.totalsCover).toBe('MATCHED_INVOICES');

    const roster = await mcp(OAK, admin, 'get_attendance_roster', { sectionId: String(school.sectionA._id) });
    expect(roster.data.count).toBe(3);
    expect(roster.data.marked).toBe(2);

    const atRisk = await mcp(OAK, admin, 'get_at_risk_students', { attendanceBelowPct: 75 });
    // Rahul: one day recorded, absent → 0%. Priya: present → 100%. Aman: none.
    expect(atRisk.data.students.map((s) => s.studentName)).toEqual(['Rahul Sharma']);
    expect(atRisk.data.students[0].attendancePct).toBe(0);

    const overview = await mcp(OAK, admin, 'get_student_overview', { admissionNo: 'OAK-1' });
    expect(Object.keys(overview.data).sort()).toEqual(['admissionNo', 'attendance', 'included', 'name', 'performance', 'profile', 'studentId']);
    expect(JSON.stringify(overview.data)).not.toMatch(/phone|email|photoUrl/i);
  });
});

describe('the catalog every role sees is documented accurately', () => {
  it('gives every system role a non-empty, permission-derived catalog', () => {
    for (const { key } of SYSTEM_ROLES) {
      if (!school.people[key]) continue;
      expect(mcpToolsFor(school.people[key].actor).length, key).toBeGreaterThan(0);
    }
  });
});
