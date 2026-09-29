import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Announcement } from '../src/models/announcement.model.js';
import { Grade, Section } from '../src/models/academics.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { resetAgentThrottle } from '../src/modules/ai/agent/throttle.js';
import { parseIntent } from '../src/modules/ai/agent/intent.js';
import { mcpToolsFor } from '../src/modules/ai/mcp/registry.js';
import { startApi } from './support/mcpHttp.js';
import { seedSchool, inSchool, mcp, proposeAndConfirm, OAK } from './support/mcpSchool.js';

/**
 * Correcting an announcement -- and who may.
 *
 * Manual testing found every editing wording answered with the announcement
 * LIST, and an update capability was built to fix it: an editing verb beside a
 * notice is an UPDATE, the target is resolved through the canonical class
 * resolver, an ambiguous request asks rather than lists, nothing is written
 * before confirmation, and the write is audited.
 *
 * The Teacher Web-parity audit then found the Web offers NO way to edit a
 * posted announcement -- no route, no edit control -- so offering it to a
 * teacher through the assistant was an MCP-only operation. It is now held by
 * school-wide publishers only (minScope ALL). Everything the capability does is
 * still pinned here, exercised as the ADMIN who keeps it; what a teacher now
 * gets is pinned in section 5: the act is declined, on both channels, and
 * nothing is written.
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
    const grade5 = await Grade.create({ name: 'Class 5', level: 5 });
    const c5a = await Section.create({
      gradeId: grade5._id, name: 'A', classTeacherId: school.people.TEACHER.profile._id,
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
    const theirs = await post('Fee reminder', 'Pay the term fee.', [c5a._id], school.people.ADMIN.profile._id);

    return { grade5, c5a, mine5a, mine6a, theirs };
  });
});

const teacher = () => school.people.TEACHER;
const admin = () => school.people.ADMIN;

async function lastCall() {
  const entry = await inSchool(OAK, () => AuditLog.findOne({ 'after.via': 'MCP' }).sort({ createdAt: -1, _id: -1 }).lean());
  return {
    tool: entry?.action?.replace(/^agent\./, '') ?? null,
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
  const asPublisher = (msg) => parseIntent(msg, admin().actor);

  it('routes the reported wordings to the update capability', () => {
    for (const msg of [
      'Update the announcement for Class 5-A as submit the books',
      'Change the announcement message.',
      "Update the latest announcement for Class 5-A. Change its message to 'Submit the books'.",
    ]) {
      expect(asPublisher(msg)?.tool, msg).toBe('update_announcement');
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
      expect(asPublisher(msg)?.tool, msg).toBe('update_announcement');
    }
  });

  it('reads the class, the new wording and "latest" out of the sentence', () => {
    const intent = asPublisher("Update the latest announcement for Class 5-A. Change its message to 'Submit the books'.");
    expect(intent.args.className).toMatch(/5-?A/i);
    expect(intent.args.content).toBe('Submit the books');
    expect(intent.args.latest).toBe(true);

    const unquoted = asPublisher('Update the announcement for Class 5-A as submit the books');
    expect(unquoted.args.content).toBe('submit the books');
  });

  it('preserves the existing read behaviour, for a teacher as for anyone', () => {
    for (const actor of [teacher().actor, admin().actor]) {
      for (const msg of ['any new announcements?', 'show me the notices', 'what announcements are there']) {
        expect(parseIntent(msg, actor)?.tool, msg).toBe('get_announcements');
      }
    }
  });

  it('leaves posting a new one to the create capability', () => {
    expect(parseIntent('post an announcement about the sports day', teacher().actor)?.tool).toBe('create_announcement');
    const created = parseIntent('create a new notice for class 5-A', teacher().actor)?.tool;
    expect(created).not.toBe('update_announcement');
    expect(created).not.toBe('get_announcements');
  });
});

/* ── 2. Propose, confirm, execute ─────────────────────────── */

describe('2. nothing changes until the publisher confirms', () => {
  it('proposes the change and writes nothing yet', async () => {
    const proposal = await mcp(OAK, admin().actor, 'update_announcement', {
      className: 'Class 6-A', content: 'Submit the books', latest: true,
    });
    expect(proposal.action?.status).toBe('confirmation_required');
    expect(proposal.action.summary).toContain('Sports day');
    expect(proposal.action.summary).toContain('Submit the books');
    expect(proposal.action.affectsOthers).toBe(true);
    expect(await contentOf(extra.mine6a._id)).toBe('Sports day on Friday.');
  });

  it('executes through MCP once confirmed, and a later read shows it', async () => {
    const { done } = await proposeAndConfirm(OAK, admin().actor, 'update_announcement', {
      className: 'Class 6-A', content: 'Submit the books', latest: true,
    });
    expect(done.success).toBe(true);
    expect(await contentOf(extra.mine6a._id)).toBe('Submit the books');

    const read = await mcp(OAK, admin().actor, 'get_announcements', {});
    expect(JSON.stringify(read.data)).toContain('Submit the books');
  });

  it('audits the update, before and after', async () => {
    await proposeAndConfirm(OAK, admin().actor, 'update_announcement', {
      className: 'Class 6-A', content: 'Submit the books', latest: true,
    });
    const entry = await inSchool(OAK, () => AuditLog.findOne({ action: 'agent.update_announcement', 'after.status': 'EXECUTED' }).lean());
    expect(entry).not.toBeNull();
    expect(entry.after.confirmed).toBe(true);
    expect(entry.before?.content).toBe('Sports day on Friday.');
    expect(entry.after?.state?.content).toBe('Submit the books');
  });

  it('resolves the class however it is written', async () => {
    for (const className of ['Class 6-A', 'class 6a', '6-A', 'Class 6 A']) {
      const proposal = await mcp(OAK, admin().actor, 'update_announcement', {
        className, content: 'Bring your books', latest: true,
      });
      expect(proposal.action?.status, className).toBe('confirmation_required');
    }
  });
});

/* ── 3. Ambiguity asks, and never lists ───────────────────── */

describe('3. an ambiguous request asks which announcement', () => {
  it('offers a shortlist instead of the announcement list', async () => {
    const res = await mcp(OAK, admin().actor, 'update_announcement', { content: 'Submit the books' });
    expect(res.success).toBe(false);
    expect(res.error.message).toMatch(/^Which announcement should I change/);
    expect(res.error.message).toContain('Sports day');
    expectNoCatalogLeak(res.error.message);
    expect(await contentOf(extra.mine6a._id)).toBe('Sports day on Friday.');
  });

  it('asks what it should say when no new wording is given', async () => {
    const res = await mcp(OAK, admin().actor, 'update_announcement', { className: 'Class 6-A' });
    expect(res.success).toBe(false);
    expect(res.error.message).toBe('What should the announcement say now?');
  });

  it('end to end, "Change the announcement message." asks rather than listing', async () => {
    const res = await api.ask(admin(), 'Change the announcement message.');
    expect(res.status).toBe(200);
    expect(res.reply).not.toMatch(/announcement\(s\)\. Latest/i);
    expect(res.reply).toMatch(/what should the announcement say now/i);
    expectNoCatalogLeak(res.reply);
  });
});

/* ── 4. Authorization at the service ──────────────────────── */

describe('4. the service keeps authorship and reach, whoever calls it', () => {
  it('refuses a colleague\'s notice to an OWN-scope caller', async () => {
    const { update } = await import('../src/modules/announcements/announcement.service.js');
    await expect(
      inSchool(OAK, () => update(teacher().actor, 'OWN', String(extra.theirs._id), { content: 'Rewritten' })),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('will not retarget an announcement beyond an OWN-scope caller\'s reach', async () => {
    const { update } = await import('../src/modules/announcements/announcement.service.js');
    await expect(
      inSchool(OAK, () => update(teacher().actor, 'OWN', String(extra.mine5a._id), { audience: { all: true } })),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('lets a school-wide publisher correct any notice', async () => {
    const { done } = await proposeAndConfirm(OAK, admin().actor, 'update_announcement', {
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
});

/* ── 5. A teacher: not offered, because the Web does not ──── */

describe('5. a teacher is not offered announcement editing, because the Web has none', () => {
  it('is not in the teacher\'s catalogue', () => {
    expect(mcpToolsFor(teacher().actor).map((t) => t.name)).not.toContain('update_announcement');
  });

  it('is refused at the server even when called directly, and nothing is written', async () => {
    const res = await mcp(OAK, teacher().actor, 'update_announcement', {
      announcementId: String(extra.mine5a._id), content: 'Submit the books',
    });
    expect(res.success).toBe(false);
    // FORBIDDEN_SCOPE: the permission is held, at a scope the capability does not accept.
    expect(res.error.code).toMatch(/^FORBIDDEN/);
    expect(await contentOf(extra.mine5a._id)).toBe('Return the library books.');
  });

  it('is declined in words on the website and on WhatsApp, running nothing', async () => {
    const message = "Update the latest announcement for Class 5-A. Change its message to 'Submit the books'.";
    const since = new Date();
    const web = await api.ask(teacher(), message);
    resetAgentThrottle();
    const wa = await api.whatsapp(teacher(), message);

    expect(web.status).toBe(200);
    expect(web.action ?? null).toBeNull();
    expect(web.reply).toMatch(/can't update an announcement/i);
    expect(wa.reply).toBe(web.reply);
    expectNoCatalogLeak(web.reply);

    const ran = await inSchool(OAK, () => AuditLog.countDocuments({ 'after.via': 'MCP', createdAt: { $gte: since } }));
    expect(ran).toBe(0);
    expect(await contentOf(extra.mine5a._id)).toBe('Return the library books.');
  });
});

/* ── 6. End to end, the reported request, for a publisher ─── */

describe('6. the reported request, over HTTP, for a school-wide publisher', () => {
  it('proposes, confirms, and the change is visible afterwards', async () => {
    const said = await api.ask(admin(), "Update the latest announcement for Class 6-A. Change its message to 'Submit the books'.");
    expect(said.status).toBe(200);
    expect(said.action?.confirmToken).toBeTruthy();
    expect(said.reply).toContain('Sports day');
    expectNoCatalogLeak(said.reply);
    expect(await contentOf(extra.mine6a._id)).toBe('Sports day on Friday.');

    const confirmed = await api.confirm(admin(), said.action.confirmToken);
    expect(confirmed.status).toBe(200);
    expect(await contentOf(extra.mine6a._id)).toBe('Submit the books');
    expect(await lastCall()).toMatchObject({ tool: 'update_announcement', status: 'EXECUTED' });
  });

  it('a declined proposal changes nothing', async () => {
    const said = await api.ask(admin(), "Update the latest announcement for Class 6-A. Change its message to 'Something else'.");
    expect(said.action?.confirmToken).toBeTruthy();
    await api.confirm(admin(), said.action.confirmToken, false);
    expect(await contentOf(extra.mine6a._id)).toBe('Sports day on Friday.');
  });
});
