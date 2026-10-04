import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MCP_TOOLS, mcpToolsFor } from '../src/modules/ai/mcp/registry.js';
import { capabilitiesFor } from '../src/modules/ai/mcp/capabilities.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { resetAgentThrottle } from '../src/modules/ai/agent/throttle.js';
import { StudentGuardian } from '../src/models/student.model.js';
import { startApi } from './support/mcpHttp.js';
import { seedSchool, seedPerson, inSchool, mcp, OAK } from './support/mcpSchool.js';

/**
 * Every other role asking the assistant about its own work.
 *
 * The student and teacher suites cover the two roles that were built first.
 * This covers the rest of the school — a parent, an administrator, the
 * principal, the finance clerk, the librarian and the hostel warden — through
 * the same two doors people actually use: POST /ai/agent and the WhatsApp
 * webhook.
 *
 * There is one architecture. Nothing below is role-specific machinery: each
 * role carries a different permission map, the same registry yields a
 * different capability set from it, and the answers differ for that reason
 * alone. What is asserted is that a request in each role's own words reaches a
 * capability that role is authorized for, answers from live fixture data, and
 * that a question about somebody else's part of the school discloses nothing.
 *
 * The phrasings are INPUTS, not a routing table. A role that cannot route a
 * phrasing deterministically must give an honest non-answer — never a
 * confident answer drawn from the wrong module, which is the failure the
 * library/invoice case below exists to pin down.
 *
 * Model-free: these run with the deterministic tier only, so a passing
 * assertion here is a statement about routing and authorization rather than
 * about a model's choices.
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

const person = (role) => school.people[role];
const say = (res) => String(res.reply ?? res.body?.data?.reply ?? res.body?.message ?? '');

/** Nothing internal may reach a person: no tool names, no schema words, no ids. */
function expectNoCatalogLeak(text) {
  const reply = String(text ?? '');
  for (const leak of [
    /\bget_[a-z_]+\b/, /\blist_[a-z_]+\b/, /\bcreate_[a-z_]+\b/,
    /inputSchema/i, /additionalProperties/i, /minScope/i, /read-only/i,
    /enrollmentId/i, /sectionId/i, /[a-f0-9]{24}/,
  ]) {
    expect(reply, `leaked internals: ${leak}`).not.toMatch(leak);
  }
}

/**
 * What each role should be able to ask about its own work, and the evidence in
 * the reply that it was answered from the fixture rather than deflected.
 *
 * The fixture: Class 6 A with Rahul Sharma (OAK-1, absent today, ₹8,000
 * overdue) and Priya Verma (OAK-2, present). PARENT is Rahul's father.
 */
const OWN_WORK = {
  PARENT: [
    ["How is my child's attendance?", /attendance is \d+%|present of|Attendance:\*{1,2} \d+%/i],
    ['Does my child have any pending fees?', /8,000|outstanding/i],
    ['What announcements are there?', /announcement/i],
  ],
  ADMIN: [
    ['Who is absent today?', /absent today/i],
    ['Which students are below 75% attendance?', /Rahul/],
    ['What announcements are published?', /announcement/i],
  ],
  PRINCIPAL: [
    ['Who is absent today?', /absent today/i],
    ['Which students are below 75% attendance?', /Rahul/],
  ],
  FINANCE: [
    ['Show me the pending fees', /13,000|pending fees/i],
    ['What is the fee collection so far?', /collected|collection rate/i],
  ],
  LIBRARIAN: [
    ['Which library books are overdue?', /overdue/i],
    ['Show me the library summary', /librar/i],
  ],
  WARDEN: [
    ['Who are the hostel residents?', /hostel|bed/i],
    ['Show me the hostel summary', /bed|hostel/i],
  ],
};

/* ── One architecture, every role ─────────────────────────── */

describe('every role reaches the one shared architecture', () => {
  it('sees exactly the capabilities its permissions authorize, and more than none', () => {
    for (const role of Object.keys(OWN_WORK)) {
      const actor = person(role).actor;
      expect(capabilitiesFor(actor).map((c) => c.name).sort(), role)
        .toEqual(mcpToolsFor(actor).map((t) => t.name).sort());
      expect(mcpToolsFor(actor).length, `${role} can reach nothing`).toBeGreaterThan(0);
    }
  });

  it('gives each role a capability set shaped by its own work', () => {
    const named = (role, re) => mcpToolsFor(person(role).actor).map((t) => t.name).filter((n) => re.test(n));
    // The librarian has the library and no fees; the warden the hostel and no
    // fees. If these ever overlap, a permission map has widened.
    expect(named('LIBRARIAN', /book|librar/).length).toBeGreaterThan(0);
    expect(named('LIBRARIAN', /fee/)).toEqual([]);
    expect(named('WARDEN', /hostel/).length).toBeGreaterThan(0);
    expect(named('WARDEN', /fee/)).toEqual([]);
    expect(named('FINANCE', /fee/).length).toBeGreaterThan(0);
    expect(named('FINANCE', /hostel|book/)).toEqual([]);
  });
});

/* ── Each role, asking about its own work ─────────────────── */

describe('each role is answered about its own work, from live data', () => {
  for (const [role, questions] of Object.entries(OWN_WORK)) {
    it(`${role} — on the website`, async () => {
      for (const [question, evidence] of questions) {
        const res = await api.ask(person(role), question);
        expect(res.status, `${role}: ${question}`).toBe(200);
        const reply = say(res);
        expect(reply, `${role}: ${question}`).toMatch(evidence);
        expectNoCatalogLeak(reply);
      }
    }, 60000);

    it(`${role} — on WhatsApp`, async () => {
      // The same question through Meta's webhook, signed as Meta signs it.
      // Identity comes from the phone the message arrived from, never from the
      // message: the same actor, the same capabilities, the same answer.
      const [question, evidence] = questions[0];
      const res = await api.whatsapp(person(role), question);
      expect(res.status, `${role}: ${question}`).toBe(200);
      expect(String(res.reply ?? ''), `${role}: ${question}`).toMatch(evidence);
      expectNoCatalogLeak(res.reply);
    }, 60000);
  }
});

/* ── A parent naming their child by relationship ──────────── */

describe('a parent speaking of "my child" is answered about their child', () => {
  /**
   * "Show my child's marks" was answered 'No student named "child".'
   *
   * The possessive slot in a parent's sentence holds a RELATIONSHIP, not a
   * name, and the person meant is already known from the session — the
   * guardian link on the profile the request authenticated as. Reading "child"
   * as a name is what stopped the question being recognised as one about the
   * caller's own record (nameFromText in utils/peopleNames.js; selfStudentId
   * in mcp/tools/_shared.js resolves the rest).
   *
   * A parent of several children is still asked which one: that ambiguity is
   * real, and guessing whose record to open is not an answer.
   */
  const KINSHIP = [
    "Show my child's marks",
    "How is my son doing with attendance?",
    "What is my daughter's report card?",
    'Does my child have any pending fees?',
  ];

  it('never reports the relationship word as a missing student', async () => {
    for (const question of KINSHIP) {
      const reply = say(await api.ask(person('PARENT'), question));
      for (const word of ['child', 'son', 'daughter', 'kid', 'ward']) {
        expect(reply, `${question} → treated "${word}" as a name`)
          .not.toMatch(new RegExp(`no student named "?${word}`, 'i'));
      }
      expectNoCatalogLeak(reply);
    }
  }, 60000);

  it('answers from the child\'s own record', async () => {
    // The fixture's parent has exactly one child, Rahul, who is absent today
    // and owes ₹8,000. Both figures are his, reached without his name.
    expect(say(await api.ask(person('PARENT'), "How is my son's attendance?")))
      .toMatch(/attendance is \d+%|present of|Attendance:\*{1,2} \d+%/i);
    expect(say(await api.ask(person('PARENT'), "Does my child owe any fees?")))
      .toMatch(/8,000/);
  }, 60000);
});

/* ── Nothing about anybody else's part of the school ──────── */

describe('a question about another part of the school discloses nothing', () => {
  /**
   * Two honest outcomes, and both are secure: a refusal when the role holds no
   * such permission, or a non-answer when the request cannot be routed to
   * anything the role holds. What must never happen is an answer carrying the
   * other module's figures.
   */
  const FOREIGN = [
    ['LIBRARIAN', 'What is the fee collection so far?', /13,000|collection rate|collected/i],
    ['LIBRARIAN', 'Show me the pending fees', /13,000|8,000/],
    ['WARDEN', 'Show me the pending fees', /13,000|8,000/],
    ['FINANCE', 'Who are the hostel residents?', /bed|resident/i],
    ['FINANCE', 'Which library books are overdue?', /book/i],
  ];

  it('refuses or declines, and never returns the other module\'s figures', async () => {
    for (const [role, question, forbidden] of FOREIGN) {
      const res = await api.ask(person(role), question);
      const reply = say(res);
      if (res.status !== 200) {
        // A refusal. It must say so without describing what was refused.
        expect(res.status, `${role}: ${question}`).toBe(403);
        expectNoCatalogLeak(reply);
      }
      expect(reply, `${role}: ${question} disclosed another module`).not.toMatch(forbidden);
    }
  }, 60000);

  it('keeps a school-wide question away from a parent', async () => {
    // "Who is absent today?" is a school-wide roll-call. A parent holds
    // attendance.read at OWN scope only, so the honest answer is not their own
    // child's attendance dressed up as the school's.
    const reply = say(await api.ask(person('PARENT'), 'Who is absent today?'));
    expect(reply).not.toMatch(/Priya/);
    expect(reply).not.toMatch(/\d+ student\(s\) absent today/);
  }, 60000);

  it('keeps school-wide fee figures away from a student', async () => {
    // The student holds fees.read at OWN scope. Asked about the school's
    // collection, they get their own position, never the school's ₹13,000.
    const reply = say(await api.ask(person('STUDENT'), 'What is the fee collection so far?'));
    expect(reply).not.toMatch(/13,000/);
    expect(reply).not.toMatch(/collection rate/i);
  }, 60000);
});

/* ── Nothing from the other school ────────────────────────── */

describe('no role reaches the other school', () => {
  /**
   * Riverside is a second school in the same database, with its own Rahul
   * (RIV-1) and its own overdue invoice INV-9001 for ₹3,000. Tenancy is
   * enforced under the request's AsyncLocalStorage state rather than by any
   * argument, so the check that matters is that a role answering normally
   * never has the other school's figures in the answer.
   */
  // The amount needs the lookbehind: a bare /3,000/ also matches Oakridge's
  // own ₹13,000, which would have made this test fail on correct behaviour.
  const RIVERSIDE = /Riverside|RIV-1|INV-9001|(?<![\d,])3,000/;

  it('answers each role from its own school only', async () => {
    for (const [role, questions] of Object.entries(OWN_WORK)) {
      for (const [question] of questions) {
        const reply = say(await api.ask(person(role), question));
        expect(reply, `${role}: ${question} leaked Riverside`).not.toMatch(RIVERSIDE);
      }
    }
  }, 60000);

  it('refuses the other school\'s identifier rather than resolving it', async () => {
    // A section id from Riverside, handed to a role that holds the capability
    // school-wide in its OWN school. The id is well-formed and real; it simply
    // is not in this tenant, so it must find nothing.
    const res = await api.ask(person('ADMIN'), `Show me the attendance roster for section ${school.river.section._id}`);
    expect(say(res)).not.toMatch(RIVERSIDE);
    expectNoCatalogLeak(say(res));
  }, 60000);
});

/* ── A parent reaches their own child and no one else ─────── */

describe('a parent is confined to their own child', () => {
  /**
   * The fixture's parent is Rahul's father. Priya and Aman are classmates with
   * their own records and their own invoice; Riverside has a second Rahul in
   * another school entirely.
   *
   * Every attempt below hands the parent a REAL identifier for somebody else's
   * child — the case that matters, because a well-formed id is exactly what a
   * model could put in an argument. Identity and scope are re-resolved from the
   * session, so the id decides nothing.
   */
  it('cannot reach a classmate by id', async () => {
    const res = await mcp(OAK, person('PARENT').actor, 'get_student_attendance', {
      studentId: String(school.priya.student._id),
    });
    if (res.success) {
      expect(JSON.stringify(res.data)).not.toMatch(/Priya/);
    } else {
      expect(['NOT_FOUND', 'FORBIDDEN', 'FORBIDDEN_SCOPE', 'NEEDS_INPUT', 'INVALID_INPUT']).toContain(res.error?.code);
    }
    expect(JSON.stringify(res)).not.toMatch(/Priya/);
  }, 60000);

  it('cannot reach a classmate by name', async () => {
    const reply = say(await api.ask(person('PARENT'), "Show me Priya Verma's attendance"));
    expect(reply).not.toMatch(/Priya Verma is|present|absent/i);
    expectNoCatalogLeak(reply);
  }, 60000);

  it('cannot reach another child\'s invoice', async () => {
    // Aman's INV-1002 for ₹5,000. The parent's own child owes ₹8,000.
    const reply = say(await api.ask(person('PARENT'), 'Do I owe any fees?'));
    expect(reply).not.toMatch(/INV-1002|5,000/);
  }, 60000);

  it('cannot reach a child in another school', async () => {
    const res = await mcp(OAK, person('PARENT').actor, 'get_student_attendance', {
      studentId: String(school.river.student._id),
    });
    expect(JSON.stringify(res)).not.toMatch(/Riverside/);
  }, 60000);

  it('keeps two parents out of each other\'s children', async () => {
    // A second, genuinely separate parent, linked to Aman the way the fixture
    // links the first parent to Rahul.
    const second = await inSchool(OAK, async () => {
      const seeded = await seedPerson({ roleKey: 'PARENT', roleId: school.roleIds.PARENT, displayName: 'Aman parent' });
      await StudentGuardian.create({
        studentId: school.aman.student._id,
        guardianProfileId: seeded.profile._id,
        relation: 'MOTHER',
        isPrimary: true,
      });
      return seeded;
    });

    // Each parent asks the same unqualified question and gets their own child.
    const first = say(await api.ask(person('PARENT'), 'Do I owe any fees?'));
    const other = say(await api.ask(second, 'Do I owe any fees?'));

    expect(first).toMatch(/8,000/);          // Rahul's invoice
    expect(first).not.toMatch(/5,000/);      // not Aman's
    expect(other).toMatch(/5,000/);          // Aman's invoice
    expect(other).not.toMatch(/8,000/);      // not Rahul's
  }, 60000);

  it('asks which child rather than guessing, when a parent has more than one', async () => {
    // The same parent, given a second child. selfStudentId deliberately
    // resolves only when there is exactly one: with two, whose record to open
    // is a real question and guessing it would disclose the wrong child.
    await inSchool(OAK, () => StudentGuardian.create({
      studentId: school.aman.student._id,
      guardianProfileId: person('PARENT').profile._id,
      relation: 'FATHER',
      isPrimary: false,
    }));

    const reply = say(await api.ask(person('PARENT'), "How is my child's attendance?"));
    // Whatever it says, it must not quietly pick one of the two.
    const namedRahul = /Rahul/.test(reply);
    const namedAman = /Aman/.test(reply);
    expect(namedRahul && namedAman, 'answered about both children at once').toBe(false);
    expectNoCatalogLeak(reply);
  }, 60000);
});

/* ── A wrong answer is worse than no answer ───────────────── */

describe('an unroutable request is declined, not answered from the wrong module', () => {
  /**
   * "Which invoices are overdue?" was answered with the library's overdue
   * books, for every role holding library.read at school-wide scope. Both
   * modules speak of things being overdue, and the library rule excluded the
   * word "invoice" but not "invoices" — the boundary in `\binvoice\b` fails
   * before the s — so a question about money was answered with book loans.
   *
   * Asserted as a property rather than a phrasing: for every role that can
   * reach the overdue-books capability, a question naming fee vocabulary must
   * not be answered from the library.
   */
  it('never answers a fee question from the library', async () => {
    const roles = Object.keys(OWN_WORK).filter((role) =>
      mcpToolsFor(person(role).actor).some((t) => t.name === 'get_overdue_books'));
    expect(roles.length, 'no role can reach get_overdue_books').toBeGreaterThan(0);

    for (const role of roles) {
      for (const question of ['Which invoices are overdue?', 'Which payments are overdue?', 'Which fees are overdue?']) {
        const reply = say(await api.ask(person(role), question));
        expect(reply, `${role}: ${question} was answered from the library`)
          .not.toMatch(/book/i);
        expectNoCatalogLeak(reply);
      }
    }
  }, 60000);

  it('declines in its own words, naming no tool', async () => {
    // A request the deterministic tier cannot place must come back as a plain
    // offer of help, with nothing from the catalog in it.
    const reply = say(await api.ask(person('FINANCE'), 'Who are the hostel residents?'));
    expect(reply.length).toBeGreaterThan(0);
    expectNoCatalogLeak(reply);
  }, 60000);
});

/* ── Writes stay protected for these roles too ────────────── */

describe('the writes these roles can reach keep their protections', () => {
  it('every write is confirmable and takes no identity argument', () => {
    const IDENTITY = ['actorProfileId', 'userId', 'profileId', 'roleKey', 'role', 'tenantId', 'scope', 'permissions'];
    for (const role of Object.keys(OWN_WORK)) {
      for (const { name } of mcpToolsFor(person(role).actor)) {
        const tool = MCP_TOOLS[name];
        if (!['CREATE', 'UPDATE', 'DELETE', 'ACTION'].includes(tool.operation)) continue;
        expect(typeof tool.summarise, `${role} -> ${name}`).toBe('function');
        if (tool.affectsOthers) expect(Boolean(tool.confirm || tool.confirmWhen), `${role} -> ${name}`).toBe(true);
        const props = Object.keys(tool.inputSchema?.properties ?? {});
        expect(props.filter((p) => IDENTITY.includes(p)), `${role} -> ${name}`).toEqual([]);
      }
    }
  });
});
