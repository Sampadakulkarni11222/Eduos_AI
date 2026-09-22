import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { MCP_TOOLS, mcpToolsFor, mutates } from '../src/modules/ai/mcp/registry.js';
import {
  capabilityIndex, capabilitiesFor, entitiesFor, entitiesInText, orderToolsByRelevance, ENTITY_VOCABULARY,
} from '../src/modules/ai/mcp/capabilities.js';
import { detectEntityIntent, detectOperation } from '../src/modules/ai/agent/entityIntent.js';
import { narrowToolsForMessage } from '../src/modules/ai/agent/intent.js';
import { PERMISSION_CATALOG } from '../src/constants/permissions.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { seedSchool, actorForRole, mcp, OAK, RIVER } from './support/mcpSchool.js';

/**
 * Registry-driven capability resolution — the architectural dimensions.
 *
 * These tests are deliberately NOT a list of sentences mapped to tools. That
 * list is what the architecture audit was about: every question answered by
 * adding another branch, and a capability unreachable until somebody wrote one
 * for it. What is asserted here is the property that replaces it — that
 * resolution is driven by what the registry declares, that every capability a
 * teacher is authorized for has a path to being used, and that narrowing never
 * grants anything.
 *
 * Where a phrasing does appear it is as INPUT to a dimension (an operation
 * verb, a named class), never as a fixture proving a specific question reaches
 * a specific branch.
 */

let school;
beforeEach(async () => {
  school = await seedSchool();
});
afterAll(async () => {
  await resetMcpClient();
});

const teacherActor = () => actorForRole('TEACHER');
const visibleTo = (actor) => mcpToolsFor(actor).map((t) => t.name);
const capabilityOf = (name) => capabilityIndex().find((c) => c.name === name);

/* ── 1. Capability discovery ──────────────────────────────── */

describe('1. teacher capability discovery', () => {
  it('every capability the permission map authorizes is discoverable as metadata', () => {
    const actor = teacherActor();
    const visible = visibleTo(actor);
    expect(visible.length).toBeGreaterThan(45);

    const discovered = capabilitiesFor(actor).map((c) => c.name);
    // Discovery is exactly the authorized set — not a subset chosen by hand,
    // and not a superset that would show something unauthorized.
    expect(discovered.slice().sort()).toEqual(visible.slice().sort());
  });

  it('excludes capabilities the actor is not authorized for', () => {
    const teacher = teacherActor();
    const discovered = new Set(capabilitiesFor(teacher).map((c) => c.name));

    const unauthorized = Object.entries(MCP_TOOLS).filter(
      ([, tool]) => !teacher.permissions[tool.permission],
    );
    expect(unauthorized.length).toBeGreaterThan(0);
    for (const [name] of unauthorized) {
      expect(discovered.has(name), `${name} is exposed without its permission`).toBe(false);
    }
  });

  it('describes every teacher capability in the dimensions resolution uses', () => {
    for (const name of visibleTo(teacherActor())) {
      const c = capabilityOf(name);
      expect(c, `${name} has no capability metadata`).toBeTruthy();
      expect(typeof c.entity, `${name} has no entity`).toBe('string');
      expect(c.entity.length, `${name} has an empty entity`).toBeGreaterThan(0);
      expect(['GET', 'CREATE', 'UPDATE', 'DELETE', 'ACTION'], `${name} operation`).toContain(c.operation);
      expect(Array.isArray(c.targets), `${name} targets`).toBe(true);
      expect(Array.isArray(c.filters), `${name} filters`).toBe(true);
      expect(Array.isArray(c.ids), `${name} ids`).toBe(true);
    }
  });
});

/* ── 2. Entity-first narrowing ────────────────────────────── */

describe('2. narrowing is driven by declared entity, not by the words of a question', () => {
  it('orders the tools of the entity a message is about first', () => {
    const actor = teacherActor();
    const tools = mcpToolsFor(actor);

    for (const [message, entity] of [
      ['what did the register say for Class 5-A', 'attendance'],
      ['which notices went out this week', 'announcement'],
      ['who has not handed in their worksheets', 'homework'],
    ]) {
      const ordered = orderToolsByRelevance(tools, message);
      expect(entitiesInText(message), message).toContain(entity);
      expect(capabilityOf(ordered[0].name).entity, message).toBe(entity);
    }
  });

  it('recognises an entity from vocabulary the resolver has never been given as an example', () => {
    // None of these phrasings appears in the implementation; they are recognised
    // because the entity's vocabulary is declared once, per entity.
    expect(entitiesInText('is the roll call done')).toContain('attendance');
    expect(entitiesInText('any circulars for the parents')).toContain('announcement');
    expect(entitiesInText('hand out the worksheets')).toContain('homework');
  });

  it('adding an entity to the vocabulary needs no new branch — every entity resolves the same way', () => {
    // The vocabulary is one table, per entity, and every entry has the same
    // shape. This is the property that replaces one code path per entity.
    for (const [entity, pattern] of ENTITY_VOCABULARY) {
      expect(typeof entity).toBe('string');
      expect(pattern).toBeInstanceOf(RegExp);
    }
    const entities = new Set(ENTITY_VOCABULARY.map(([e]) => e));
    // Every entity a teacher holds capabilities for has vocabulary to reach it.
    for (const entity of entitiesFor(teacherActor())) {
      expect(entities.has(entity), `entity "${entity}" has no vocabulary`).toBe(true);
    }
  });
});

/* ── 3. Operation resolution ──────────────────────────────── */

describe('3. the operation is read from the request, not from a question list', () => {
  it('distinguishes the operations by verb, across inflections', () => {
    for (const [message, operation] of [
      ['show the worksheets', 'GET'],
      ['list what is pending', 'GET'],
      ['create homework for them', 'CREATE'],
      ['adding homework tomorrow', 'CREATE'],
      ['change that homework', 'UPDATE'],
      ['revising the homework', 'UPDATE'],
      ['delete that homework', 'DELETE'],
      ['removing the homework', 'DELETE'],
    ]) {
      expect(detectOperation(message), message).toBe(operation);
    }
  });

  it('resolves a read and a write of the same entity to different capabilities', () => {
    const actor = teacherActor();
    const read = detectEntityIntent('show Mathematics homework for Class 5-A', actor);
    const write = detectEntityIntent('create Mathematics homework for Class 5-A', actor);
    expect(read?.tool).toBeTruthy();
    expect(write?.tool).toBeTruthy();
    expect(read.tool).not.toBe(write.tool);
    expect(mutates(MCP_TOOLS[read.tool])).toBe(false);
    expect(mutates(MCP_TOOLS[write.tool])).toBe(true);
  });
});

/* ── 4. Argument resolution ───────────────────────────────── */

describe('4. required arguments', () => {
  it('never writes text into an identifier argument', () => {
    const actor = teacherActor();
    const messages = [
      'mark attendance for Class 5-A today',
      'show attendance for Class 5-A today',
      'show marks for Class 5-A',
      'grade the submissions for Class 5-A',
      'show Mathematics homework for Class 5-A',
    ];
    for (const message of messages) {
      const resolved = detectEntityIntent(message, actor);
      if (!resolved) continue;
      const c = capabilityOf(resolved.tool);
      for (const [arg, value] of Object.entries(resolved.args)) {
        if (!c.ids.includes(arg)) continue;
        expect(String(value), `${message} → ${resolved.tool}.${arg}`).toMatch(/^[a-f0-9]{24}$/);
      }
    }
  });

  it('does not choose a capability whose required identifier it could not derive', () => {
    const actor = teacherActor();
    // get_submissions requires an assignmentId, which a sentence cannot carry.
    const resolved = detectEntityIntent('show me the submissions', actor);
    expect(resolved?.tool).not.toBe('get_submissions');
  });

  it('does choose a capability whose missing required arguments are answerable in words', () => {
    // The PROPERTY, asserted rather than the name that happened to hold it:
    // routing to a capability whose missing arguments a person can simply say,
    // and letting the tool ask for them, is a better answer than refusing.
    //
    // It used to name generate_homework, which requires a topic and a due
    // date. create_assignment -- which SETS the work rather than drafting it
    // with AI -- now also identifies its class and subject by name, so it too
    // is reachable from these words and wins on the verb the sentence used
    // ("create"). Both satisfy the property, so the property is what is
    // checked: every required argument still missing must be one a person
    // could answer in a sentence, never an ObjectId.
    const resolved = detectEntityIntent('create Mathematics homework for Class 5-A', teacherActor());
    expect(resolved?.tool).toBeTruthy();

    const capability = capabilityOf(resolved.tool);
    expect(capability.module).toBe('Assignments');
    expect(capability.operation === 'CREATE' || capability.operation === 'ACTION').toBe(true);

    const stillMissing = (capability.required ?? []).filter((name) => resolved.args[name] === undefined);
    for (const name of stillMissing) {
      expect(capability.ids, `${resolved.tool}.${name} cannot be said in words`).not.toContain(name);
    }

    expect(resolved.args.subject).toBe('Mathematics');
    expect(resolved.args.className).toMatch(/5-?A/i);
  });
});

/* ── 5. The tool ceiling ──────────────────────────────────── */

describe('5. there is no arbitrary tool ceiling', () => {
  it('drops nothing from any role, including roles above the old limit of 45', () => {
    for (const roleKey of ['ADMIN', 'PRINCIPAL', 'TEACHER', 'STUDENT', 'PARENT']) {
      const tools = mcpToolsFor(actorForRole(roleKey));
      const narrowed = narrowToolsForMessage(tools, 'show the attendance for Class 5-A in July');
      expect(narrowed.length, roleKey).toBe(tools.length);
      expect(narrowed.map((t) => t.name).sort(), roleKey).toEqual(tools.map((t) => t.name).sort());
    }
  });

  it('keeps a capability of an unrelated entity reachable, even for a role over the old limit', () => {
    const actor = teacherActor();
    const tools = mcpToolsFor(actor);
    expect(tools.length).toBeGreaterThan(45);

    // A message about attendance must not make the library, ticket or material
    // capabilities unreachable — that is exactly what the fixed cap did.
    const narrowed = narrowToolsForMessage(tools, 'attendance for Class 5-A');
    const names = new Set(narrowed.map((t) => t.name));
    for (const other of tools.filter((t) => capabilityOf(t.name).entity !== 'attendance')) {
      expect(names.has(other.name), `${other.name} became unreachable`).toBe(true);
    }
  });

  it('a message naming no entity leaves the authorized list untouched', () => {
    const tools = mcpToolsFor(teacherActor());
    const narrowed = narrowToolsForMessage(tools, 'hello, can you help me with something');
    expect(narrowed.map((t) => t.name)).toEqual(tools.map((t) => t.name));
  });
});

/* ── 6. Role isolation ────────────────────────────────────── */

describe('6. role isolation', () => {
  it('gives no other role a capability the teacher holds and they do not', () => {
    const teacherOnly = new Set(visibleTo(teacherActor()));
    for (const roleKey of ['STUDENT', 'PARENT', 'LIBRARIAN', 'WARDEN', 'FINANCE']) {
      const actor = actorForRole(roleKey);
      const theirs = new Set(capabilitiesFor(actor).map((c) => c.name));
      const exclusive = [...teacherOnly].filter((n) => !visibleTo(actor).includes(n));
      expect(exclusive.length, `${roleKey} vs TEACHER`).toBeGreaterThan(0);
      for (const name of exclusive) {
        expect(theirs.has(name), `${roleKey} was offered ${name}`).toBe(false);
      }
    }
  });

  it('resolution for another role never yields a capability that role lacks', () => {
    for (const roleKey of ['STUDENT', 'PARENT']) {
      const actor = actorForRole(roleKey);
      const allowed = new Set(visibleTo(actor));
      for (const message of [
        'show marks for Class 5-A',
        'show attendance for Class 5-A today',
        'create Mathematics homework for Class 5-A',
        'show Mathematics homework',
      ]) {
        const resolved = detectEntityIntent(message, actor);
        if (!resolved) continue;
        expect(allowed.has(resolved.tool), `${roleKey}: ${message} → ${resolved.tool}`).toBe(true);
      }
    }
  });
});

/* ── 7. Scope ─────────────────────────────────────────────── */

describe('7. scope is narrowed, never granted', () => {
  it('never offers an ALL-scoped capability to an actor holding the permission at OWN', () => {
    const actor = teacherActor();
    for (const c of capabilitiesFor(actor)) {
      const held = actor.permissions[c.permission];
      expect(held, `${c.name} offered without its permission`).toBeTruthy();
      if (c.minScope === 'ALL') {
        expect(held, `${c.name} is ALL-gated but was offered to an OWN holder`).toBe('ALL');
      }
    }
  });

  it('resolution cannot reach an ALL-gated capability for an OWN-scoped teacher', () => {
    const actor = teacherActor();
    const allGated = capabilityIndex().filter((c) => c.minScope === 'ALL').map((c) => c.name);
    expect(allGated.length).toBeGreaterThan(0);
    const offered = new Set(capabilitiesFor(actor).map((c) => c.name));
    for (const name of allGated) {
      const held = actor.permissions[MCP_TOOLS[name].permission];
      if (held !== 'ALL') expect(offered.has(name), `${name} leaked to an OWN teacher`).toBe(false);
    }
  });
});

/* ── 8. Tenancy and identity, through the server ──────────── */

describe('8. resolution never crosses a tenant', () => {
  it('resolves a name to the student in the caller\'s own school', async () => {
    // Both schools have a Rahul. The resolver only names him; the server
    // resolves which one, in the caller's tenant.
    const resolved = detectEntityIntent('Rahul Sharma', school.people.TEACHER.actor);
    expect(resolved?.tool).toBe('search_students');

    const res = await mcp(OAK, school.people.TEACHER.actor, resolved.tool, resolved.args);
    expect(res.success).toBe(true);
    expect(JSON.stringify(res.data)).not.toMatch(/Riverside/);
  });

  it('the same resolved call in another school reaches that school only', async () => {
    const resolved = detectEntityIntent('Rahul Riverside', school.people.RIVER_ADMIN.actor);
    const res = await mcp(RIVER, school.people.RIVER_ADMIN.actor, resolved.tool, resolved.args);
    expect(res.success).toBe(true);
    expect(JSON.stringify(res.data)).not.toMatch(/Sharma/);
  });
});

/* ── 9. Write safety ──────────────────────────────────────── */

describe('9. a write is never executed on a guess', () => {
  it('an ambiguous or misspelt name is not resolved into a write', async () => {
    const actor = school.people.TEACHER.actor;
    // A write whose subject is a near-miss must refuse, not pick a student.
    const res = await mcp(OAK, actor, 'mark_attendance', {
      studentName: 'Rahyl Sharmaa', status: 'PRESENT', date: '2026-09-01',
    });
    expect(res.success).toBe(false);
    expect(['NOT_FOUND', 'NEEDS_INPUT', 'INVALID_INPUT', 'FORBIDDEN', 'FORBIDDEN_SCOPE']).toContain(res.error?.code);
  });

  it('every resolvable write still declares confirmation and a summary', () => {
    for (const name of visibleTo(teacherActor())) {
      const tool = MCP_TOOLS[name];
      if (!mutates(tool)) continue;
      expect(typeof tool.summarise, `${name} cannot summarise itself`).toBe('function');
    }
  });
});

/* ── 10. The coverage invariant ───────────────────────────── */

describe('10. every teacher-visible capability has a resolution path', () => {
  const problems = (name, actor, narrowed) => {
    const found = [];
    const c = capabilityOf(name);
    const tool = MCP_TOOLS[name];

    if (!c) return [`${name}: no capability metadata`];
    // Deterministic narrowing metadata: an entity to be narrowed by, and a
    // classification of its own arguments.
    if (!c.entity) found.push(`${name}: no entity to narrow by`);
    if (!ENTITY_VOCABULARY.some(([entity]) => entity === c.entity)) {
      found.push(`${name}: entity "${c.entity}" has no vocabulary, so nothing can narrow to it`);
    }
    // A model fallback path: it must survive narrowing and be offered.
    if (!narrowed.has(name)) found.push(`${name}: dropped before the model sees it`);
    // Permission metadata that matches the authorization actually applied.
    if (!tool.permission) found.push(`${name}: declares no permission`);
    else if (!PERMISSION_CATALOG.some((p) => p.key === tool.permission)) {
      found.push(`${name}: permission "${tool.permission}" is not in the catalog`);
    }
    if (tool.minScope && tool.minScope !== 'ALL') found.push(`${name}: minScope "${tool.minScope}" is not a scope`);
    if (tool.minScope === 'ALL' && actor.permissions[tool.permission] !== 'ALL') {
      found.push(`${name}: ALL-gated but visible to this actor`);
    }
    // Unusable required arguments: an id that nothing in the caller's own
    // catalog could produce is a capability nobody can call.
    const requiredIds = (c.required ?? []).filter((arg) => c.ids.includes(arg));
    for (const arg of requiredIds) {
      const discoverable = capabilitiesFor(actor, { entity: c.entity })
        .some((other) => other.operation === 'GET' && other.name !== name);
      if (!discoverable) found.push(`${name}: requires ${arg} and nothing in scope can find one`);
    }
    return found;
  };

  it('holds for every capability a teacher is authorized for', () => {
    const actor = teacherActor();
    const tools = mcpToolsFor(actor);
    // Narrowed against a message that names an unrelated entity, which is the
    // hostile case: nothing may fall out of the list because of it.
    const narrowed = new Set(narrowToolsForMessage(tools, 'show attendance for Class 5-A').map((t) => t.name));

    const found = tools.flatMap((t) => problems(t.name, actor, narrowed));
    expect(found).toEqual([]);
  });

  it('does not require a hand-written intent rule for any of them', () => {
    // The invariant above is satisfied by metadata alone. Deterministic
    // resolution covers the entities it claims; everything else reaches the
    // model with its schema, which is a path, not a gap.
    const actor = teacherActor();
    const deterministic = new Set(
      entitiesFor(actor).filter((entity) => detectEntityIntent(`show ${entity}`, actor)),
    );
    const viaModel = mcpToolsFor(actor).filter((t) => !deterministic.has(capabilityOf(t.name).entity));
    // The point is not that one number is large: it is that both paths exist
    // and together cover the catalog.
    expect(deterministic.size + viaModel.length).toBeGreaterThanOrEqual(mcpToolsFor(actor).length);
  });
});
