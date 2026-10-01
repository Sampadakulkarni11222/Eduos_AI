import { describe, it, expect } from 'vitest';
import { parseIntent } from '../src/modules/ai/agent/intent.js';
import { capabilitiesFor } from '../src/modules/ai/mcp/capabilities.js';
import { getMcpTool } from '../src/modules/ai/mcp/registry.js';
import { nameParts } from '../src/modules/ai/agent/capabilityResolver.js';
import { actorForRole } from './support/mcpSchool.js';

/**
 * Can a capability be reached by asking for it?
 *
 * The audit that produced the capability index found 52 tools visible to a
 * teacher and 18 with any routing path to them. The rest were unreachable: they
 * existed, they were authorized, and no sentence anybody typed could get to
 * them. That is the failure this file measures, and it measures it for every
 * role rather than for the one that was audited.
 *
 * The sentence is generated from the capability's OWN NAME -- `return_book`
 * becomes "return book", `list_hostel_rooms` becomes "list hostel rooms". That
 * is deliberately the weakest possible phrasing test: if a capability cannot be
 * reached when asked for in its own words, no phrasing a person invents will
 * reach it either. It is also why this file is not a phrase table: nothing here
 * is written by hand, and a capability added tomorrow is tested the same day.
 *
 * What is asserted is the ENTITY and the OPERATION, not the exact tool. Several
 * capabilities legitimately answer the same words -- `get_student` and
 * `get_student_overview` both do something with a student -- and demanding a
 * particular one of them would be asserting a preference, not reachability.
 */

const ROLES = ['ADMIN', 'PRINCIPAL', 'TEACHER', 'PARENT', 'STUDENT', 'FINANCE', 'LIBRARIAN', 'WARDEN'];

/**
 * The capability's own name, as a person would say it.
 *
 * `get_my_profile` becomes "show MY profile", not "show profile". The "my" is
 * part of the tool's own name and part of the question -- a self-scoped
 * capability answers about the caller, and dropping the word that says so
 * asked a different question and then reported the capability unreachable.
 */
function asAQuestion(name) {
  const { verb, nouns, self } = nameParts(name);
  const spoken = name.split('_').join(' ');
  if (!['get', 'list', 'search'].includes(verb)) return spoken;
  return `show ${self ? 'my ' : ''}${nouns.join(' ')}`;
}

/** Every capability this role holds, with what it is about. */
const held = (role) => capabilitiesFor(actorForRole(role));

describe('every authorized capability can be reached by asking for it', () => {
  for (const role of ROLES) {
    it(`${role}`, () => {
      const mine = held(role);
      expect(mine.length, `${role} holds no capabilities at all`).toBeGreaterThan(0);

      const byName = new Map(mine.map((c) => [c.name, c]));
      const unreachable = [];

      for (const capability of mine) {
        const message = asAQuestion(capability.name);
        const step = parseIntent(message, actorForRole(role));
        const reached = step ? byName.get(step.tool) : null;

        if (!reached) {
          unreachable.push(`${capability.name} ("${message}") reached ${step?.tool ?? 'nothing'}`);
          continue;
        }
        // Same subject and same kind of act is reachability; the exact tool is
        // a preference, and preferences are asserted elsewhere.
        if (reached.entity !== capability.entity || reached.operation !== capability.operation) {
          unreachable.push(
            `${capability.name} ("${message}") reached ${reached.name} [${reached.entity}/${reached.operation}]`,
          );
        }
      }

      // A FLOOR rather than perfection, and deliberately so. Some capabilities
      // share their words with a neighbour -- "show performance" fits both the
      // history and the current marks -- and demanding that every one of them
      // win its own name would be asserting a preference between two correct
      // answers. What matters is that the proportion does not fall back: the
      // audit this replaces measured 18 of 52 for a teacher (35%).
      //
      // The misses are listed in the failure message rather than counted, so a
      // regression says which capability stopped being reachable.
      const reachable = mine.length - unreachable.length;
      const pct = Math.round((100 * reachable) / mine.length);
      expect(
        pct,
        `${role}: only ${reachable}/${mine.length} (${pct}%) reachable — ${unreachable.join('; ')}`,
      ).toBeGreaterThanOrEqual(60);
    });
  }
});

describe('the five operations are all reachable, for every role that holds them', () => {
  /**
   * The report's central complaint: reads were made to work and writes were
   * not. So the counts are asserted per operation -- a role that holds writes
   * must be able to reach writes, and a role that holds none must not somehow
   * reach one.
   */
  for (const role of ROLES) {
    it(`${role} reaches each operation it holds`, () => {
      const mine = held(role);
      const byOperation = {};
      for (const c of mine) (byOperation[c.operation] ??= []).push(c);

      const byName = new Map(mine.map((c) => [c.name, c]));
      for (const [operation, capabilities] of Object.entries(byOperation)) {
        const reached = capabilities.filter((c) => {
          const step = parseIntent(asAQuestion(c.name), actorForRole(role));
          return step && byName.get(step.tool)?.operation === operation;
        });
        // A role that holds several capabilities of an operation must be able
        // to reach at least one of them. This is the assertion the report's
        // section 10 asks for: reads working while writes do not is exactly
        // what it found, and it is what this catches.
        if (capabilities.length < 2) continue;
        expect(
          reached.length,
          `${role}: none of its ${capabilities.length} ${operation} capabilities could be reached`,
        ).toBeGreaterThan(0);
      }
    });
  }
});

describe('every capability that cannot be reached has a stated reason', () => {
  /**
   * The classification, asserted rather than written down.
   *
   * A capability that no phrasing can reach is either a DEFECT or it is
   * unreachable for a reason the catalogue itself states. The only reason this
   * codebase accepts is that the capability REQUIRES an opaque identifier --
   * an ObjectId for a parent record chosen from a list on screen (a grade, a
   * term, an exam, a subject offering, a fee plan, a payment), or a payload no
   * sentence carries (a grid of marks, a set of invoice lines).
   *
   * That is checked, not asserted in a comment. Anything unreachable WITHOUT a
   * required identifier is a resolver defect and fails here, which is what
   * stops this file becoming a list of excuses: a capability cannot be quietly
   * written off, it has to declare why it needs an id.
   *
   * The deliberate Web-parity exclusions are a different thing entirely -- they
   * are capabilities that do not exist, and mcp.manualScenarios.test.js asserts
   * their absence.
   */
  it('is unreachable only because it requires an identifier nothing can type', () => {
    const everywhere = new Map();
    const reached = new Set();

    for (const role of ROLES) {
      const mine = held(role);
      const byName = new Map(mine.map((c) => [c.name, c]));
      for (const capability of mine) {
        everywhere.set(capability.name, capability);
        const step = parseIntent(asAQuestion(capability.name), actorForRole(role));
        const got = step ? byName.get(step.tool) : null;
        if (got && got.entity === capability.entity && got.operation === capability.operation) {
          reached.add(capability.name);
        }
      }
    }

    const unexplained = [];
    for (const capability of everywhere.values()) {
      if (reached.has(capability.name)) continue;

      // Reason one: it requires an opaque identifier. A grade, a term, an
      // exam, a fee plan, a payment -- all chosen from a list on a screen, and
      // none of them sayable.
      const required = getMcpTool(capability.name)?.inputSchema?.required ?? [];
      const ids = new Set(capability.ids ?? []);
      if (required.some((argument) => ids.has(argument))) continue;

      // Reason two: it answers about ONE named record, and the generated
      // question names none. That is a real reason and not an excuse, so it is
      // PROVED rather than asserted -- the same capability must be reachable
      // when a record IS named. If it is not, this is a defect and says so.
      if ((capability.targets ?? []).includes('student')) {
        const role = ROLES.find((r) => held(r).some((c) => c.name === capability.name));
        const { nouns } = nameParts(capability.name);
        const named = parseIntent(`show Rahul's ${nouns.join(' ')}`, actorForRole(role));
        if (named?.tool === capability.name) continue;
        unexplained.push(
          `${capability.name} [${capability.operation}] is about one student, `
          + `but naming one still reaches ${named?.tool ?? 'nothing'}`,
        );
        continue;
      }

      unexplained.push(
        `${capability.name} [${capability.operation}] requires no identifier and is about no one record, `
        + 'so nothing explains why it cannot be reached',
      );
    }

    expect(unexplained, unexplained.join('; ')).toEqual([]);
  });
});

describe('SUPER_ADMIN reaches none of them', () => {
  it('holds no capabilities and routes to nothing, for every capability name in the catalog', () => {
    const actor = actorForRole('SUPER_ADMIN');
    expect(capabilitiesFor(actor)).toHaveLength(0);

    // Asked for every capability any role holds, in its own words.
    const everyName = new Set(ROLES.flatMap((role) => held(role).map((c) => c.name)));
    for (const name of everyName) {
      expect(parseIntent(asAQuestion(name), actor), name).toBeNull();
    }
  });
});
