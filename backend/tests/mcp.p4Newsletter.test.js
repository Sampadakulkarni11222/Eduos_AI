import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { MCP_TOOLS, mcpToolsFor, validateMcpRegistry } from '../src/modules/ai/mcp/registry.js';
import { newsletterP4Tools } from '../src/modules/ai/mcp/tools/p4Newsletter.js';
import { isDecidingToolName } from '../src/modules/ai/mcp/decisions.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { OpportunitySave, NewsletterEdition, Opportunity } from '../src/models/newsletter.model.js';
import * as opps from '../src/modules/newsletter/opportunities.service.js';
import * as editions from '../src/modules/newsletter/editions.service.js';
import { inSchool, mcp, actorForRole, OAK } from './support/mcpSchool.js';
import { seedFamilySchool } from './support/familySchool.js';

/**
 * The newsletter's assistant tools (tools/p4Newsletter.js): reads scoped like
 * the screens (a parent: own children only), every write drafted then
 * confirmed by the same person, and nothing that publishes or sends.
 */
const NAMES = Object.keys(newsletterP4Tools);
let s;
const inOak = (fn) => inSchool(OAK, fn);
const confirm = async (actor, name, args) => {
  const proposal = await mcp(OAK, actor, name, args);
  expect(proposal.success, JSON.stringify(proposal.error)).toBe(true);
  expect(proposal.action.status).toBe('confirmation_required');
  const done = await mcp(OAK, actor, name, {}, { confirmationToken: proposal.action.confirmationToken });
  expect(done.success, JSON.stringify(done.error)).toBe(true);
  return { proposal, done };
};

beforeEach(async () => {
  s = await seedFamilySchool();
  const ed = s.people.PRINCIPAL.actor;
  await inOak(() => opps.create(ed, {
    title: 'Junior Science Olympiad', summary: 'A science olympiad for middle school.', type: 'OLYMPIAD', level: 'NATIONAL', domains: ['SCIENCE'],
    eligibility: { gradeMin: 5, gradeMax: 8 }, officialUrl: 'https://olympiads.hbcse.tifr.res.in/', organiser: 'Sample Society', typicalMonths: [new Date().getUTCMonth() + 1], publish: true,
  }));
  await inOak(() => opps.create(ed, {
    title: 'Senior Coding Hackathon', summary: 'For older students.', type: 'HACKATHON', level: 'NATIONAL', domains: ['CODING_AI'],
    eligibility: { gradeMin: 11, gradeMax: 12 }, officialUrl: 'https://www.sih.gov.in/', organiser: 'Sample Cell', publish: true,
  }));
  await inOak(() => opps.setPreferences(s.people.PARENT.actor, { domains: ['SCIENCE'] }));
});
afterAll(async () => { await resetMcpClient(); });

describe('the contract', () => {
  it('registers eleven closed, non-deciding tools behind the newsletter switch; every write confirms; the boot check passes', () => {
    expect(NAMES).toHaveLength(11);
    for (const n of NAMES) {
      const t = MCP_TOOLS[n];
      expect(t, n).toBeTruthy();
      expect(t.inputSchema.additionalProperties, n).toBe(false);
      expect(isDecidingToolName(n), n).toBe(false);
      expect(t.feature, n).toBe('newsletter');
      if (t.operation !== 'GET') { expect(t.confirm, n).toBe(true); expect(typeof t.summarise, n).toBe('function'); }
    }
    expect(validateMcpRegistry()).toEqual([]);
  });

  it('shows readers the reading tools, families the "ask a teacher", staff the "suggest", editors the desk tools', () => {
    const visible = (role) => mcpToolsFor(actorForRole(role)).map((t) => t.name).filter((n) => NAMES.includes(n)).sort();
    const readerTools = ['find_opportunities', 'check_opportunity_eligibility', 'save_opportunity', 'list_saved_opportunities', 'get_newsletter_edition', 'get_newsletter_flashcards', 'answer_newsletter_quiz'];
    expect(visible('PARENT')).toEqual([...readerTools, 'ask_teacher_about_opportunity'].sort());
    expect(visible('STUDENT')).toEqual([...readerTools, 'ask_teacher_about_opportunity'].sort());
    expect(visible('TEACHER')).toEqual([...readerTools, 'suggest_opportunity'].sort());
    expect(visible('PRINCIPAL')).toEqual([...readerTools, 'suggest_opportunity', 'draft_newsletter', 'get_newsletter_analytics'].sort());
  });
});

describe('what a parent can ask', () => {
  it('"what competitions can my daughter enter this month" answers for their own child, with the reason', async () => {
    const r = await mcp(OAK, s.people.PARENT.actor, 'find_opportunities', { childName: 'Riya', thisMonth: true });
    expect(r.success, JSON.stringify(r.error)).toBe(true);
    expect(r.data.groups).toHaveLength(1);
    expect(r.data.groups[0].for).toBe('Riya');
    expect(r.data.groups[0].items.map((i) => i.title)).toEqual(['Junior Science Olympiad']);
    expect(r.data.groups[0].items[0].reason).toMatch(/^Because Riya is in Class 6/);
    // Aman is not their child: refused, never guessed.
    const other = await mcp(OAK, s.people.PARENT.actor, 'find_opportunities', { childName: 'Aman' });
    expect(other.success).toBe(false);
  });

  it('"save the science olympiad and remind me" is drafted, then saved on confirmation', async () => {
    const { proposal, done } = await confirm(s.people.PARENT.actor, 'save_opportunity', { title: 'science olympiad', childName: 'Rahul' });
    expect(proposal.action.summary ?? JSON.stringify(proposal)).toMatch(/Junior Science Olympiad/);
    expect(done.action.type).toBe('opportunity_saved');
    const row = await inOak(() => OpportunitySave.findOne({}).lean());
    expect(row.remind).toBe(true);
    expect(String(row.studentId)).toBe(String(s.rahul.student._id));
  });

  it('"Can I enter?" for the hackathon says no for a Class 6 child', async () => {
    const r = await mcp(OAK, s.people.PARENT.actor, 'check_opportunity_eligibility', { title: 'hackathon', childName: 'Rahul' });
    expect(r.success, JSON.stringify(r.error)).toBe(true);
    expect(r.data.results[0].verdict).toBe('NO');
  });
});

describe('editions through the assistant', () => {
  it('the editor drafts this month\'s edition on confirmation; nothing is published; a teacher cannot', async () => {
    const { done } = await confirm(s.people.PRINCIPAL.actor, 'draft_newsletter', { cadence: 'MONTHLY' });
    expect(done.data.status).toBe('DRAFT');
    expect(await inOak(() => NewsletterEdition.countDocuments({ status: 'PUBLISHED' }))).toBe(0);
    const t = await mcp(OAK, s.people.TEACHER.actor, 'draft_newsletter', {});
    expect(t.success).toBe(false);
  });

  it('"show this week\'s newsletter" and "quiz me on this week\'s flashcards" read the published edition', async () => {
    const { edition } = await inOak(() => editions.generate({ cadence: 'WEEKLY' }));
    await inOak(() => editions.publish(s.people.PRINCIPAL.actor, String(edition._id)));
    const show = await mcp(OAK, s.people.STUDENT.actor, 'get_newsletter_edition', {});
    expect(show.success, JSON.stringify(show.error)).toBe(true);
    expect(show.data.items.length).toBeGreaterThan(0);
    expect(show.data.quiz.answered).toBe(false);
    const cards = await mcp(OAK, s.people.STUDENT.actor, 'get_newsletter_flashcards', {});
    expect(cards.data.cards.length).toBeGreaterThan(0);
    const answers = edition.quiz.map((q) => q.answerIndex + 1);
    const { done } = await confirm(s.people.STUDENT.actor, 'answer_newsletter_quiz', { answers });
    expect(done.data.score).toBe(edition.quiz.length);
  });

  it('a teacher suggests an item into the review queue (not published); a bad link is refused before confirming', async () => {
    const bad = await mcp(OAK, s.people.TEACHER.actor, 'suggest_opportunity', { title: 'X', summary: 'Y', type: 'COMPETITION', level: 'NATIONAL', officialUrl: 'https://not-allowed.example/' });
    expect(bad.success).toBe(false);
    await confirm(s.people.TEACHER.actor, 'suggest_opportunity', { title: 'Inter-school quiz', summary: 'A quiz.', type: 'COMPETITION', level: 'SCHOOL' });
    expect((await inOak(() => Opportunity.findOne({ title: 'Inter-school quiz' }).lean())).status).toBe('SUBMITTED');
  });
});
