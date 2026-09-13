import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MCP_TOOLS, mcpToolsFor, mutates } from '../src/modules/ai/mcp/registry.js';
import { capabilityIndex, capabilitiesFor } from '../src/modules/ai/mcp/capabilities.js';
import { detectEntityIntent } from '../src/modules/ai/agent/entityIntent.js';
import { narrowToolsForMessage, parseIntent } from '../src/modules/ai/agent/intent.js';
import { actorForRole } from './support/mcpSchool.js';

/**
 * Declarative preference between capabilities.
 *
 * Two kinds of information used to live only in the legacy pattern rules, and
 * both are about CAPABILITIES rather than about questions:
 *
 *   supersession   two names front the same service, and one of them is the
 *                  canonical form. Derived from the catalog, not declared.
 *   result shape   a capability answers with a figure about a group, or with
 *                  the records themselves. Declared, because no schema implies
 *                  it.
 *
 * These tests assert the mechanism, not a mapping. Where a phrasing appears it
 * is an INPUT that varies one dimension while everything else is held
 * constant — which is the only way to show that the dimension is what decided
 * the outcome.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const teacher = () => actorForRole('TEACHER');
const admin = () => actorForRole('ADMIN');
const capabilityOf = (name) => capabilityIndex().find((c) => c.name === name);

/* ── 1. Supersession is derived, and decides preference ───── */

describe('1. duplicate capabilities have a derived canonical form', () => {
  it('marks a wrapper that fronts the same service as its native capability', () => {
    const superseded = capabilityIndex().filter((c) => c.supersededBy);
    expect(superseded.length).toBeGreaterThan(0);

    for (const c of superseded) {
      const canonical = capabilityOf(c.supersededBy);
      expect(canonical, `${c.name} points at a capability that does not exist`).toBeTruthy();
      // The reason they are duplicates: same service, same entity, same operation.
      expect(canonical.service).toBe(c.service);
      expect(canonical.entity).toBe(c.entity);
      expect(canonical.operation).toBe(c.operation);
      // And the canonical one is the native tool, not another wrapper.
      expect(canonical.wraps).toBeNull();
      expect(c.wraps).toBeTruthy();
    }
  });

  it('is not declared anywhere — nothing in the catalog names a preferred tool', () => {
    // If supersession were hand-written, this string would appear in a tool file.
    for (const file of fs.readdirSync(path.join(SRC, 'modules/ai/mcp/tools'))) {
      if (!file.endsWith('.js')) continue;
      expect(read(`modules/ai/mcp/tools/${file}`), file).not.toMatch(/supersededBy/);
    }
  });

  it('spans more than one entity, so it is not a fix for one pair', () => {
    const entities = new Set(capabilityIndex().filter((c) => c.supersededBy).map((c) => c.entity));
    expect(entities.size).toBeGreaterThan(1);
  });

  it('resolution prefers the canonical capability when both are authorized', () => {
    const actor = admin();
    const offered = new Set(capabilitiesFor(actor).map((c) => c.name));
    const pair = capabilityIndex().find((c) => c.supersededBy && offered.has(c.name) && offered.has(c.supersededBy));
    expect(pair, 'no superseded pair is visible to this role').toBeTruthy();

    // A request in that entity must never resolve to the superseded name.
    const resolved = detectEntityIntent("Show Aarav Mishra's marks", actor);
    expect(resolved?.tool).toBeTruthy();
    expect(capabilityOf(resolved.tool).supersededBy).toBeNull();
  });
});

/* ── 2. Result shape answers aggregation ──────────────────── */

describe('2. an aggregate request selects a capability that answers with a figure', () => {
  it('declares a result shape on capabilities across several entities', () => {
    const shaped = capabilityIndex().filter((c) => c.resultShape);
    expect(shaped.length).toBeGreaterThan(0);
    for (const c of shaped) expect(['SUMMARY', 'LIST', 'DETAIL']).toContain(c.resultShape);

    const entities = new Set(shaped.map((c) => c.entity));
    // Generic: the same field distinguishes capabilities in unrelated modules.
    expect(entities.size).toBeGreaterThanOrEqual(3);
  });

  it('changes the chosen capability when ONLY the aggregation dimension changes', () => {
    const actor = admin();
    // Same entity, same class, same day. The one difference is whether a figure
    // about the group or the rows of it were asked for.
    const aggregate = detectEntityIntent('how many students are absent in Class 5-A today', actor);
    const listing = detectEntityIntent('show the attendance of Class 5-A today', actor);

    expect(aggregate?.tool).toBeTruthy();
    expect(listing?.tool).toBeTruthy();
    expect(aggregate.tool).not.toBe(listing.tool);
    expect(capabilityOf(aggregate.tool).resultShape).toBe('SUMMARY');
    expect(capabilityOf(listing.tool).resultShape).toBe('LIST');
  });

  it('does not let a detail capability win an aggregate request by having more arguments', () => {
    const actor = admin();
    const resolved = detectEntityIntent('how many students are absent in Class 5-A today', actor);
    // The roster accepts className and would otherwise score higher on targets.
    expect(resolved.tool).not.toBe('get_attendance_roster');
  });

  it('leaves a request that asks for neither alone', () => {
    // No aggregation words: the shape must not tip the result, so the routes
    // established before this metadata existed are unchanged.
    const actor = teacher();
    expect(detectEntityIntent('Show July attendance for Class 5-A', actor)?.tool).toBe('get_attendance_roster');
    expect(detectEntityIntent('Show attendance for July', actor)?.tool).toBe('get_attendance_statistics');
  });
});

/* ── 3. No question list, no per-capability branches ──────── */

describe('3. the mechanism is metadata, not a rewritten rule table', () => {
  const RESOLVER = ['modules/ai/agent/entityIntent.js', 'modules/ai/mcp/capabilities.js'];

  it('introduces no phrase-to-tool mapping', () => {
    // The legacy table's shape is a tool name beside a list of patterns to match
    // a message against, with optional exclusions. None of those may appear:
    // a capability is chosen by what it declares, not by what a message says.
    // (A tool NAME on its own is covered by the next test, which pins the single
    // documented case exactly.)
    for (const file of RESOLVER) {
      expect(read(file), `${file} contains a patterns list`).not.toMatch(/patterns:\s*\[/);
      expect(read(file), `${file} contains rule exclusions`).not.toMatch(/exclude:\s*\[/);
      expect(read(file), `${file} weights rules`).not.toMatch(/weight:\s*\d/);
    }
  });

  it('names at most one capability in the resolver, and says why', () => {
    // A bare name typed on its own is a lookup with no entity and no verb; that
    // single case is documented in entityIntent.js. Anything beyond it would be
    // the rule table growing back.
    const source = read('modules/ai/agent/entityIntent.js');
    const named = Object.keys(MCP_TOOLS).filter((name) => source.includes(`'${name}'`));
    expect(named).toEqual(['search_students']);
  });

  it('keeps preference in metadata rather than in conditionals', () => {
    const source = read('modules/ai/agent/entityIntent.js');
    // The scorer reads declared fields; it does not test capability names.
    expect(source).toMatch(/capability\.resultShape/);
    expect(source).toMatch(/capability\.supersededBy/);
    expect(source).not.toMatch(/capability\.name ===/);
  });
});

/* ── 4. Nothing regressed ─────────────────────────────────── */

describe('4. the existing architecture still holds', () => {
  it('keeps every teacher capability discoverable and undropped', () => {
    const actor = teacher();
    const tools = mcpToolsFor(actor);
    expect(tools.length).toBeGreaterThan(45);
    expect(capabilitiesFor(actor).map((c) => c.name).sort()).toEqual(tools.map((t) => t.name).sort());

    const narrowed = narrowToolsForMessage(tools, 'how many students are absent in Class 5-A today');
    expect(narrowed.length).toBe(tools.length);
  });

  it('never offers a capability the role lacks, whatever the preference metadata says', () => {
    for (const roleKey of ['STUDENT', 'PARENT', 'TEACHER']) {
      const actor = actorForRole(roleKey);
      const allowed = new Set(mcpToolsFor(actor).map((t) => t.name));
      for (const message of ['how many students are absent in Class 5-A today', "Show Aarav Mishra's marks"]) {
        const resolved = detectEntityIntent(message, actor);
        if (resolved) expect(allowed.has(resolved.tool), `${roleKey}: ${resolved.tool}`).toBe(true);
      }
    }
  });

  it('keeps ALL-gated capabilities away from an OWN holder', () => {
    const actor = teacher();
    for (const c of capabilitiesFor(actor)) {
      if (c.minScope === 'ALL') expect(actor.permissions[c.permission]).toBe('ALL');
    }
    // get_absent_students is ALL-gated: the aggregate preference must not reach it.
    expect(capabilityOf('get_absent_students').minScope).toBe('ALL');
    const resolved = detectEntityIntent('how many students are absent in Class 5-A today', actor);
    if (resolved) expect(resolved.tool).not.toBe('get_absent_students');
  });

  it('keeps every teacher write confirmable', () => {
    for (const { name } of mcpToolsFor(teacher())) {
      const tool = MCP_TOOLS[name];
      if (mutates(tool)) expect(typeof tool.summarise, name).toBe('function');
    }
  });
});

/* ── 5. The legacy table and the model tier ───────────────── */

describe('5. the legacy rule table remains a fallback, not the authority', () => {
  it('is not consulted by capability discovery', () => {
    for (const file of ['modules/ai/mcp/capabilities.js', 'modules/ai/agent/entityIntent.js']) {
      expect(read(file), file).not.toMatch(/from ['"][^'"]*\/intent\.js['"]/);
    }
  });

  it('names fewer capabilities than the registry offers a teacher', () => {
    const ruleTools = new Set([...read('modules/ai/agent/intent.js').matchAll(/tool: '([a-z_]+)'/g)].map((m) => m[1]));
    const visible = mcpToolsFor(teacher()).map((t) => t.name);
    expect(visible.filter((n) => ruleTools.has(n)).length).toBeLessThan(visible.length);
  });

  it('still answers deterministically with no model configured', () => {
    // AI_PROVIDER=rules is a supported deployment. parseIntent is the whole
    // routing tier there, so it must keep resolving without a model.
    const resolved = parseIntent('Show July attendance for Class 5-A', teacher());
    expect(resolved?.tool).toBe('get_attendance_roster');
  });

  it('hands the model tier the complete authorized catalog when one is configured', () => {
    const tools = mcpToolsFor(teacher());
    expect(narrowToolsForMessage(tools, 'anything at all').length).toBe(tools.length);
  });
});
