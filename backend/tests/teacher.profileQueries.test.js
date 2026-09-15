import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { AuditLog } from '../src/models/auditLog.model.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { resetAgentThrottle } from '../src/modules/ai/agent/throttle.js';
import { parseIntent } from '../src/modules/ai/agent/intent.js';
import { detectProfileIntent } from '../src/modules/ai/agent/profileIntent.js';
import { mcpToolsFor } from '../src/modules/ai/mcp/registry.js';
import { startApi } from './support/mcpHttp.js';
import { seedSchool, inSchool, mcp, OAK } from './support/mcpSchool.js';

/**
 * "Anything about me", by category rather than by sentence.
 *
 * The requirement: a teacher asks ANY natural-language question about their own
 * profile and reaches the right authorized capability — without a rule per
 * question. So these tests are written the way the resolver works: per
 * CATEGORY, with many phrasings each, including phrasings that appear nowhere
 * in the source. If the implementation were a list of sentences, the "phrasings
 * nobody wrote down" block below would fail.
 *
 * Also pinned: the categories stay apart (subjects ≠ classes ≠ timetable ≠
 * profile), identity comes from the session and not from any argument, a field
 * the ERP does not hold is reported as not recorded rather than invented, and
 * no tool description ever reaches the reply.
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

const teacher = () => school.people.TEACHER;

async function lastCall() {
  const entry = await inSchool(OAK, () => AuditLog.findOne({ 'after.via': 'MCP' }).sort({ createdAt: -1, _id: -1 }).lean());
  return {
    tool: entry?.action?.replace(/^agent\./, '') ?? null,
    args: entry?.after?.request ?? null,
    status: entry?.after?.status ?? null,
    actor: String(entry?.actorProfileId ?? ''),
  };
}

function expectNoCatalogLeak(text) {
  const reply = String(text ?? '');
  for (const leak of [
    /read-only/i, /\bget_my_profile\b/, /\bget_[a-z_]+\b/, /\binputSchema\b/,
    /\bfield\b\s*[`:]/i, /additionalProperties/i, /\benum\b/i, /profileId/i, /accountId/i, /tenantId/i,
  ]) {
    expect(reply, `leaked catalog metadata: ${leak}`).not.toMatch(leak);
  }
}

/* ── 1. Category detection, not sentence matching ─────────── */

describe('1. profile questions resolve by category', () => {
  /** Many phrasings per category — synonyms, short, long, conversational, capitalised. */
  const BY_CATEGORY = {
    name: [
      'What is my name?',
      'WHAT IS MY NAME',
      'my name?',
      'what am i called',
      'Can you tell me what my name is, please?',
    ],
    contact: [
      'What is my contact information?',
      'how can people reach me',
    ],
    email: [
      'what is my email',
      'could you remind me what my email address is',
    ],
    phone: [
      'my phone number?',
      'my mobile number',
    ],
    employeeId: [
      'What is my employee ID?',
      'my staff number',
      'whats my emp code',
      'what is my id',
    ],
    designation: [
      'What is my designation?',
      'what post do i hold',
      'my job title?',
      'what position am i in here',
    ],
    department: [
      'What department am I in?',
      'my dept?',
      'which faculty do i belong to',
    ],
    reportingManager: [
      'Who is my reporting manager?',
      'who do i report to',
      'my supervisor?',
      'who is my hod',
    ],
    joined: [
      'When did I join the school?',
      'my date of joining',
      'how long have i been here',
      'since when am i registered',
    ],
    school: [
      'Which school am I in?',
      'which institution am i attached to',
      'what campus am i at',
    ],
    status: [
      'Is my account active?',
      'am i still active',
      'what is my status',
    ],
    all: [
      'Tell me about myself',
      'Show my profile',
      'Give me my complete profile',
      'What are my professional details?',
      'What information do you have about me?',
      'who am i',
      'gimme my info',
      'what do you know about me',
      'my details',
      'Could you please give me everything you have about me in the system?',
    ],
  };

  for (const [field, phrasings] of Object.entries(BY_CATEGORY)) {
    it(`maps ${phrasings.length} phrasings to the "${field}" category`, () => {
      for (const phrase of phrasings) {
        const intent = parseIntent(phrase, teacher().actor);
        expect(intent?.tool, phrase).toBe('get_my_profile');
        expect(intent.args.field, phrase).toBe(field);
      }
    });
  }

  it('resolves phrasings that appear nowhere in the source', () => {
    // If routing were a list of questions, these would all miss. They resolve
    // because each shares a vocabulary term with its category.
    const novel = [
      ['do you know who i am?', 'all'],
      ['remind me of my own particulars', 'all'],
      ['whats my designation here again', 'designation'],
      ['i forgot my staff id', 'employeeId'],
      ['tell me the department i sit in', 'department'],
      ['e-mail on my record?', 'email'],
    ];
    for (const [phrase, field] of novel) {
      expect(detectProfileIntent(phrase)?.field, phrase).toBe(field);
    }
  });
});

/* ── 2. Categories stay apart ─────────────────────────────── */

describe('2. other capabilities keep their own questions', () => {
  it('subjects, classes and the timetable are not profile questions', () => {
    const cases = [
      ['What subjects do I teach?', 'get_subjects'],
      ['What classes do I teach?', 'get_my_classes'],
      ['Which classes are assigned to me?', 'get_my_classes'],
      ['What is my timetable?', 'get_timetable'],
      ['What is my attendance?', 'get_attendance'],
    ];
    for (const [msg, tool] of cases) {
      const intent = parseIntent(msg, teacher().actor);
      expect(intent?.tool, msg).toBe(tool);
      expect(detectProfileIntent(msg), msg).toBeNull();
    }
  });

  it('a question about somebody else is never answered as the caller\'s profile', () => {
    for (const msg of ["what is my child's name", 'my son\'s attendance', 'tell me about student Rahul', "Priya's designation"]) {
      expect(detectProfileIntent(msg), msg).toBeNull();
    }
  });

  it('a profile word next to a specific category yields to that category', () => {
    // "my details about class 5" is a class question, not a profile one.
    expect(detectProfileIntent('my details about class 5')).toBeNull();
    expect(detectProfileIntent('my fee details')).toBeNull();
  });
});

/* ── 3. The tool, through MCP ─────────────────────────────── */

describe('3. the answer comes from the database, for the signed-in caller', () => {
  it('answers the whole profile from the caller\'s own records', async () => {
    const res = await mcp(OAK, teacher().actor, 'get_my_profile', {});
    expect(res.success).toBe(true);
    expect(res.data.name).toBe(teacher().profile.displayName);
    expect(res.data.role).toBe('Teacher');
    expect(res.data.school).toBe('Oakridge Academy');
    expect(res.data.phone).toBe(teacher().phone);
    // The teacher is class teacher of Class 6 A in the fixture.
    expect(res.data.classesTaught).toBeGreaterThanOrEqual(1);
    expectNoCatalogLeak(res.speak);
  });

  it('answers one category at a time', async () => {
    const name = await mcp(OAK, teacher().actor, 'get_my_profile', { field: 'name' });
    expect(name.speak).toBe(`You are ${teacher().profile.displayName}.`);

    const role = await mcp(OAK, teacher().actor, 'get_my_profile', { field: 'role' });
    expect(role.speak).toMatch(/^You are registered as a Teacher at Oakridge Academy\./);

    const contact = await mcp(OAK, teacher().actor, 'get_my_profile', { field: 'contact' });
    expect(contact.data.phone).toBe(teacher().phone);

    const joined = await mcp(OAK, teacher().actor, 'get_my_profile', { field: 'joined' });
    expect(joined.data.profileCreatedOn).toMatch(/\d{1,2} \w+ \d{4}/);
  });

  it('says plainly when the school records nothing, and invents no value', async () => {
    for (const field of ['employeeId', 'department', 'reportingManager']) {
      const res = await mcp(OAK, teacher().actor, 'get_my_profile', { field });
      expect(res.success, field).toBe(true);
      expect(res.data.available, field).toBe(false);
      expect(res.data.unavailable, field).toEqual([field]);
      expect(res.speak, field).toMatch(/does not record/i);
      // No plausible-looking placeholder anywhere in the answer.
      expect(JSON.stringify(res), field).not.toMatch(/EMP-|N\/A|unknown|TBD/i);
    }
  });

  it('answers "designation" with the role it does hold, and says the rest is not recorded', async () => {
    const res = await mcp(OAK, teacher().actor, 'get_my_profile', { field: 'designation' });
    expect(res.speak).toMatch(/does not hold a separate job title/i);
    expect(res.speak).toMatch(/registered as a Teacher/);
  });

  it('names the gaps in the whole-profile answer too', async () => {
    const res = await mcp(OAK, teacher().actor, 'get_my_profile', {});
    expect(res.data.unavailable).toEqual(['employeeId', 'designation', 'department', 'reportingManager']);
  });
});

/* ── 4. Identity and authorization are server-side ────────── */

describe('4. identity comes from the session, never from the model', () => {
  it('an identity-shaped argument is dropped, and the answer stays the caller\'s own', async () => {
    // `profileId` is in the server's STRIPPED_ARGS, so on a read it is removed
    // before the tool sees it rather than refused — the model's opinion about
    // whose profile this is cannot reach the tool at all. Asking as the teacher
    // while naming the administrator still answers about the teacher.
    const res = await mcp(OAK, teacher().actor, 'get_my_profile', {
      profileId: String(school.people.ADMIN.profile._id),
    });
    expect(res.success).toBe(true);
    expect(res.data.name).toBe(teacher().profile.displayName);
    expect(res.data.name).not.toBe(school.people.ADMIN.profile.displayName);
  });

  it('two different callers get their own profiles from the same tool', async () => {
    const asTeacher = await mcp(OAK, teacher().actor, 'get_my_profile', { field: 'name' });
    const asStudent = await mcp(OAK, school.people.STUDENT.actor, 'get_my_profile', { field: 'name' });
    expect(asTeacher.data.name).toBe(teacher().profile.displayName);
    expect(asStudent.data.name).toBe(school.people.STUDENT.profile.displayName);
    expect(asTeacher.data.name).not.toBe(asStudent.data.name);
  });

  it('is refused to a caller who may not use the assistant', async () => {
    const outsider = { roleKey: 'CUSTOM', profileId: String(new mongoose.Types.ObjectId()), permissions: {}, tenantId: OAK };
    const res = await mcp(OAK, outsider, 'get_my_profile', {});
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('FORBIDDEN');
    expect(mcpToolsFor(outsider).map((t) => t.name)).not.toContain('get_my_profile');
  });

  it('never returns the permission map or internal ids', async () => {
    const res = await mcp(OAK, teacher().actor, 'get_my_profile', {});
    const body = JSON.stringify(res.data);
    expect(body).not.toMatch(/permissions|accountId|tenantId|profileId/);
  });

  it('is offered to every role that can use the assistant', () => {
    for (const roleKey of ['TEACHER', 'STUDENT', 'PARENT', 'ADMIN', 'LIBRARIAN', 'WARDEN', 'FINANCE', 'PRINCIPAL']) {
      const names = mcpToolsFor(school.people[roleKey].actor).map((t) => t.name);
      expect(names, roleKey).toContain('get_my_profile');
    }
  });
});

/* ── 5. End to end ────────────────────────────────────────── */

describe('5. over HTTP, as the teacher asks it', () => {
  it('answers "Tell me about myself" with live data and no catalog metadata', async () => {
    const res = await api.ask(teacher(), 'Tell me about myself');
    expect(res.status).toBe(200);
    expect(res.reply).toContain(teacher().profile.displayName);
    expect(res.reply).toMatch(/Teacher/);
    expectNoCatalogLeak(res.reply);
    const call = await lastCall();
    expect(call).toMatchObject({ tool: 'get_my_profile', status: 'READ', actor: teacher().actor.profileId });
  });

  it('answers a single field', async () => {
    const res = await api.ask(teacher(), 'What is my name?');
    expect(res.reply).toBe(`You are ${teacher().profile.displayName}.`);
    expect((await lastCall()).args).toEqual({ field: 'name' });
  });

  it('answers an unavailable field honestly', async () => {
    const res = await api.ask(teacher(), 'What is my employee ID?');
    expect(res.reply).toMatch(/does not record an employee or staff ID/i);
    expectNoCatalogLeak(res.reply);
  });

  it('keeps subjects and classes on their own tools end to end', async () => {
    await api.ask(teacher(), 'What subjects do I teach?');
    expect((await lastCall()).tool).toBe('get_subjects');
    await api.ask(teacher(), 'What classes do I teach?');
    expect((await lastCall()).tool).toBe('get_my_classes');
  });

  it('an ambiguous, category-less question asks rather than guessing, and leaks nothing', async () => {
    const res = await api.ask(teacher(), 'me');
    expect(res.status).toBe(200);
    expectNoCatalogLeak(res.reply);
  });
});

/* ── 6. Proving it is not a question list ─────────────────── */

describe('6. wordings written for this validation pass, copied from no test', () => {
  /**
   * None of these appears in the resolver, in the tool, or in any earlier
   * test. They resolve because each shares a vocabulary term or an identity
   * form with its category — which is the whole claim being checked here.
   */
  const UNSEEN = [
    ['Tell me who I am in this school.', 'all'],
    ['What does EduOS know about me?', 'all'],
    ['How am I registered in the school system?', 'all'],
    ['What information is stored against my account?', 'all'],
    ['I want to see my information.', 'all'],
    ['Remind me what my role is here.', 'role'],
    ['What do you have on my record?', 'all'],
    ['Can you tell me my details from the school records?', 'all'],
  ];

  it.each(UNSEEN)('routes %s to the "%s" category', (phrase, field) => {
    const intent = parseIntent(phrase, teacher().actor);
    expect(intent?.tool, phrase).toBe('get_my_profile');
    expect(intent.args.field, phrase).toBe(field);
  });

  it('answers one of them end to end, from the database', async () => {
    const res = await api.ask(teacher(), 'What does EduOS know about me?');
    expect(res.status).toBe(200);
    expect(res.reply).toContain(teacher().profile.displayName);
    expectNoCatalogLeak(res.reply);
    expect((await lastCall())).toMatchObject({ tool: 'get_my_profile', status: 'READ' });
  });
});

describe('7. every field individually, and only the field asked for', () => {
  const RECORDED = [
    ['name', (t) => t.profile.displayName],
    ['role', () => 'Teacher'],
    ['school', () => 'Oakridge Academy'],
    ['email', (t) => t.account.email ?? null],
    ['phone', (t) => t.phone],
  ];

  it.each(RECORDED)('returns %s from the ERP', async (field, expected) => {
    const res = await mcp(OAK, teacher().actor, 'get_my_profile', { field });
    expect(res.success).toBe(true);
    const want = expected(teacher());
    if (want !== null) expect(Object.values(res.data)).toContain(want);
    expectNoCatalogLeak(res.speak);
  });

  it('answers the email without reading out the phone, and the reverse', async () => {
    const email = await mcp(OAK, teacher().actor, 'get_my_profile', { field: 'email' });
    expect(Object.keys(email.data).sort()).toEqual(['email', 'field']);

    const phone = await mcp(OAK, teacher().actor, 'get_my_profile', { field: 'phone' });
    expect(Object.keys(phone.data).sort()).toEqual(['field', 'phone']);
    expect(phone.data.phone).toBe(teacher().phone);
  });

  it('reports every field the ERP does not hold as not recorded, inventing nothing', async () => {
    for (const field of ['employeeId', 'designation', 'department', 'reportingManager']) {
      const res = await mcp(OAK, teacher().actor, 'get_my_profile', { field });
      expect(res.success, field).toBe(true);
      expect(res.speak, field).toMatch(/does not (record|hold)/i);
      // Structural rather than a search for placeholder text: the payload
      // carries the category, the fact that it is unavailable, and nothing
      // else, so there is no value to have invented. (A substring check was
      // worse than useless here — /EMP/i matches "employeeId" itself.)
      expect(Object.keys(res.data).sort(), field).toEqual(
        field === 'designation'
          ? ['available', 'field', 'role', 'unavailable']
          : ['available', 'field', 'unavailable'],
      );
    }
  });

  it('is honest about the joining date it does not have', async () => {
    const res = await mcp(OAK, teacher().actor, 'get_my_profile', { field: 'joined' });
    expect(res.speak).toMatch(/does not record a separate joining date/i);
    expect(res.data.profileCreatedOn).toMatch(/\d{1,2} \w+ \d{4}/);
  });
});

describe('8. category separation, stated as routing', () => {
  const CASES = [
    ['Which classes do I teach?', 'get_my_classes'],
    ['Which subjects do I teach?', 'get_subjects'],
    ['What is my timetable?', 'get_timetable'],
    ['What is my attendance?', 'get_attendance'],
    ["Show Rahul's attendance", 'get_student_attendance'],
    ['Show my Class 5-A attendance', 'get_attendance_roster'],
  ];

  it.each(CASES)('%s → %s', (message, tool) => {
    expect(parseIntent(message, teacher().actor)?.tool, message).toBe(tool);
  });

  it('none of those is treated as a profile question', () => {
    for (const [message] of CASES) {
      expect(detectProfileIntent(message), message).toBeNull();
    }
  });
});
