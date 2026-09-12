import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Announcement } from '../src/models/announcement.model.js';
import { Grade, Section } from '../src/models/academics.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { resetAgentThrottle } from '../src/modules/ai/agent/throttle.js';
import { parseIntent } from '../src/modules/ai/agent/intent.js';
import { startApi } from './support/mcpHttp.js';
import { seedSchool, inSchool, mcp, proposeAndConfirm, OAK } from './support/mcpSchool.js';

/**
 * Correcting an announcement.
 *
 * Manual testing found every editing wording answered with the announcement
 * LIST: "update the announcement for Class 5-A as submit the books" proposed
 * nothing, and "change the announcement message" neither asked which one nor
 * offered a choice. Two causes: the read rule's bare /announcement/ swallowed
 * every verb, and — the larger one — no update capability existed at all, in
 * MCP, in the service, or as a REST route.
 *
 * What is pinned here: UPDATE intent is detected from a verb beside an entity
 * (not from these sentences), the target is resolved through the canonical
 * class resolver, an ambiguous request asks rather than listing, NOTHING is
 * written before confirmation, the write goes through MCP and is audited, a
 * later read shows the change, and a teacher can only change what they posted.
 */

let api;
let school;
let extra;

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

  extra = await inSchool(OAK, async () => {
    // Class 5 A, taught by this teacher, mirroring the staging data.
    const grade5 = await Grade.create({ name: 'Class 5', level: 5 });
    const c5a = await Section.create({
      gradeId: grade5._id, name: 'A', classTeacherId: school.people.TEACHER.profile._id,
    });
    // A class this teacher teaches but has never posted to — the difference
    // between "not yours" and "nothing of yours there".
    const c5b = await Section.create({
      gradeId: grade5._id, name: 'B', classTeacherId: school.people.TEACHER.profile._id,
    });

    const post = (title, content, sectionIds, author) => Announcement.create({
      title,
      content,
      audience: { all: false, sectionIds, gradeIds: [], subjectIds: [], roleKeys: [] },
      createdByProfileId: author,
      publishedAt: new Date(),
    });

    const teacherId = school.people.TEACHER.profile._id;
    const mine5a = await post('Library books', 'Return the library books.', [c5a._id], teacherId);
    const mine6a = await post('Sports day', 'Sports day on Friday.', [school.sectionA._id], teacherId);
    // A colleague's notice, addressed to a class this teacher teaches.
    const theirs = await post('Fee reminder', 'Pay the term fee.', [c5a._id], school.people.ADMIN.profile._id);

    return { grade5, c5a, c5b, mine5a, mine6a, theirs };
  });
});

const teacher = () => school.people.TEACHER;

async function lastCall() {
  const entry = await inSchool(OAK, () => AuditLog.findOne({ 'after.via': 'MCP' }).sort({ createdAt: -1, _id: -1 }).lean());
  return {
    tool: entry?.action?.replace(/^agent\./, '') ?? null,
    args: entry?.after?.request ?? null,
    status: entry?.after?.status ?? null,
  };
}

const contentOf = (id) => inSchool(OAK, async () => (await Announcement.findById(id).lean())?.content);

function expectNoCatalogLeak(text) {
  const reply = String(text ?? '');
  for (const leak of [/read-only/i, /\bupdate_announcement\b/, /\bget_announcements\b/, /inputSchema/i, /additionalProperties/i]) {
    expect(reply, `leaked catalog metadata: ${leak}`).not.toMatch(leak);
  }
}

/* ── 1. Intent ────────────────────────────────────────────── */

describe('1. an editing verb beside a notice is an UPDATE, not a read', () => {
  const asTeacher = (msg) => parseIntent(msg, teacher().actor);

  it('routes the reported wordings to the update tool', () => {
    for (const msg of [
      'Update the announcement for Class 5-A as submit the books',
      'Change the announcement message.',
      "Update the latest announcement for Class 5-A. Change its message to 'Submit the books'.",
    ]) {
      expect(asTeacher(msg)?.tool, msg).toBe('update_announcement');
    }
  });

  it('routes editing verbs it has never been shown, in either order', () => {
    for (const msg of [
      'amend the notice for class 5-A to say bring your books',
      'the circular needs rewording',
      'please revise that announcement',
      'fix the announcement for 5-A',
      'modify the notice',
    ]) {
      expect(asTeacher(msg)?.tool, msg).toBe('update_announcement');
    }
  });

  it('reads the class, the new wording and "latest" out of the sentence', () => {
    const intent = asTeacher("Update the latest announcement for Class 5-A. Change its message to 'Submit the books'.");
    expect(intent.args.className).toMatch(/5-?A/i);
    expect(intent.args.content).toBe('Submit the books');
    expect(intent.args.latest).toBe(true);

    const unquoted = asTeacher('Update the announcement for Class 5-A as submit the books');
    expect(unquoted.args.content).toBe('submit the books');
  });

  it('preserves the existing read behaviour', () => {
    for (const msg of ['any new announcements?', 'show me the notices', 'what announcements are there']) {
      expect(asTeacher(msg)?.tool, msg).toBe('get_announcements');
    }
  });

  it('leaves posting a new one to the create tool', () => {
    expect(asTeacher('post an announcement about the sports day')?.tool).toBe('create_announcement');
    // "create a new notice" matches no rule today — the pre-existing create
    // rule keys on the word "announcement", not "notice", so this phrasing has
    // always fallen through to the model. What matters here is that it is
    // never mistaken for an edit, and never answered with the list.
    const created = asTeacher('create a new notice for class 5-A')?.tool;
    expect(created).not.toBe('update_announcement');
    expect(created).not.toBe('get_announcements');
  });
});

/* ── 2. Propose, confirm, execute ─────────────────────────── */

describe('2. nothing changes until the teacher confirms', () => {
  it('proposes the change and writes nothing yet', async () => {
    const proposal = await mcp(OAK, teacher().actor, 'update_announcement', {
      className: 'Class 5-A', content: 'Submit the books', latest: true,
    });
    expect(proposal.action?.status).toBe('confirmation_required');
    expect(proposal.action.summary).toContain('Library books');
    expect(proposal.action.summary).toContain('Submit the books');
    expect(proposal.action.affectsOthers).toBe(true);
    // The database is untouched.
    expect(await contentOf(extra.mine5a._id)).toBe('Return the library books.');
  });

  it('executes through MCP once confirmed, and a later read shows it', async () => {
    const { done } = await proposeAndConfirm(OAK, teacher().actor, 'update_announcement', {
      className: 'Class 5-A', content: 'Submit the books', latest: true,
    });
    expect(done.success).toBe(true);
    expect(await contentOf(extra.mine5a._id)).toBe('Submit the books');

    // The authorized read reflects the change.
    const read = await mcp(OAK, teacher().actor, 'get_announcements', {});
    expect(JSON.stringify(read.data)).toContain('Submit the books');
  });

  it('audits the update', async () => {
    await proposeAndConfirm(OAK, teacher().actor, 'update_announcement', {
      className: 'Class 5-A', content: 'Submit the books', latest: true,
    });
    const entry = await inSchool(OAK, () => AuditLog.findOne({ action: 'agent.update_announcement', 'after.status': 'EXECUTED' }).lean());
    expect(entry).not.toBeNull();
    expect(entry.after.confirmed).toBe(true);
    // Before and after are both recorded, which is the point of auditing a write.
    expect(entry.before?.content).toBe('Return the library books.');
    expect(entry.after?.state?.content).toBe('Submit the books');
  });

  it('resolves the class however it is written', async () => {
    for (const className of ['Class 5-A', 'class 5a', '5-A', 'Class 5 A']) {
      const proposal = await mcp(OAK, teacher().actor, 'update_announcement', {
        className, content: 'Bring your books', latest: true,
      });
      expect(proposal.action?.status, className).toBe('confirmation_required');
    }
  });
});

/* ── 3. Ambiguity asks, and never lists ───────────────────── */

describe('3. an ambiguous request asks which announcement', () => {
  it('offers a shortlist instead of the announcement list', async () => {
    const res = await mcp(OAK, teacher().actor, 'update_announcement', { content: 'Submit the books' });
    expect(res.success).toBe(false);
    expect(res.error.message).toMatch(/^Which announcement should I change/);
    expect(res.error.message).toContain('Library books');
    expect(res.error.message).toContain('Sports day');
    expectNoCatalogLeak(res.error.message);
    // And it changed nothing.
    expect(await contentOf(extra.mine5a._id)).toBe('Return the library books.');
  });

  it('asks what it should say when no new wording is given', async () => {
    const res = await mcp(OAK, teacher().actor, 'update_announcement', { className: 'Class 5-A' });
    expect(res.success).toBe(false);
    expect(res.error.message).toBe('What should the announcement say now?');
  });

  it('end to end, "Change the announcement message." asks rather than listing', async () => {
    const res = await api.ask(teacher(), 'Change the announcement message.');
    expect(res.status).toBe(200);
    expect(res.reply).not.toMatch(/announcement\(s\)\. Latest/i);
    expect(res.reply).toMatch(/what should the announcement say now/i);
    expectNoCatalogLeak(res.reply);
  });
});

/* ── 4. Authorization ─────────────────────────────────────── */

describe('4. a teacher may only change their own announcements', () => {
  it('refuses a colleague\'s notice, even for a class they teach', async () => {
    const res = await mcp(OAK, teacher().actor, 'update_announcement', {
      announcementId: String(extra.theirs._id), content: 'Rewritten',
    });
    expect(res.success).toBe(false);
    expect(res.error.message).toMatch(/only change an announcement you posted/i);
    expect(await contentOf(extra.theirs._id)).toBe('Pay the term fee.');
  });

  it('refuses at the service boundary too, not only in the tool', async () => {
    const { update } = await import('../src/modules/announcements/announcement.service.js');
    await expect(
      inSchool(OAK, () => update(teacher().actor, 'OWN', String(extra.theirs._id), { content: 'Rewritten' })),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('lets a school-wide publisher correct any notice', async () => {
    const { done } = await proposeAndConfirm(OAK, school.people.ADMIN.actor, 'update_announcement', {
      announcementId: String(extra.mine5a._id), content: 'Corrected by the office',
    });
    expect(done.success).toBe(true);
    expect(await contentOf(extra.mine5a._id)).toBe('Corrected by the office');
  });

  it('is refused to a role without publish permission', async () => {
    const res = await mcp(OAK, school.people.STUDENT.actor, 'update_announcement', { content: 'nope' });
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('FORBIDDEN');
    expect(await contentOf(extra.mine5a._id)).toBe('Return the library books.');
  });

  it('will not retarget an announcement outside the teacher\'s reach', async () => {
    const { update } = await import('../src/modules/announcements/announcement.service.js');
    await expect(
      inSchool(OAK, () => update(teacher().actor, 'OWN', String(extra.mine5a._id), { audience: { all: true } })),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('refuses a class outside their scope before revealing anything about it', async () => {
    const res = await mcp(OAK, teacher().actor, 'update_announcement', {
      className: 'Class 6-B', content: 'Anything',
    });
    expect(res.success).toBe(false);
    // The class resolver refuses first, so nothing about 6 B is disclosed —
    // not whether it has announcements, not who wrote them.
    expect(res.error.message).toBe('Class 6 B is not one of your classes.');
  });

  it('says so plainly when a class they do teach has none of their announcements', async () => {
    const res = await mcp(OAK, teacher().actor, 'update_announcement', {
      className: 'Class 5-B', content: 'Anything',
    });
    expect(res.success).toBe(false);
    expect(res.error.message).toMatch(/have not posted an announcement to Class 5 B/i);
  });
});

/* ── 5. End to end, the reported request ──────────────────── */

describe('5. the reported request, over HTTP', () => {
  it('proposes, confirms, and the change is visible afterwards', async () => {
    const said = await api.ask(teacher(), "Update the latest announcement for Class 5-A. Change its message to 'Submit the books'.");
    expect(said.status).toBe(200);
    expect(said.action?.confirmToken).toBeTruthy();
    expect(said.reply).toContain('Library books');
    expectNoCatalogLeak(said.reply);
    expect(await contentOf(extra.mine5a._id)).toBe('Return the library books.');

    const confirmed = await api.confirm(teacher(), said.action.confirmToken);
    expect(confirmed.status).toBe(200);
    expect(await contentOf(extra.mine5a._id)).toBe('Submit the books');
    expect((await lastCall())).toMatchObject({ tool: 'update_announcement', status: 'EXECUTED' });
  });

  it('a declined proposal changes nothing', async () => {
    const said = await api.ask(teacher(), "Update the latest announcement for Class 5-A. Change its message to 'Something else'.");
    expect(said.action?.confirmToken).toBeTruthy();
    await api.confirm(teacher(), said.action.confirmToken, false);
    expect(await contentOf(extra.mine5a._id)).toBe('Return the library books.');
  });
});
