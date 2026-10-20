import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { MCP_TOOLS, mcpToolsFor, validateMcpRegistry } from '../src/modules/ai/mcp/registry.js';
import { tools as p6Newsletter } from '../src/modules/ai/mcp/tools/p6/newsletter.js';
import { isDecidingToolName } from '../src/modules/ai/mcp/decisions.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { DigestSource, DigestPreference } from '../src/models/digest.model.js';
import { NewsletterFeedSource } from '../src/models/newsletterAi.model.js';
import { NewsletterEdition, NewsletterComment, NewsletterRead, Opportunity, NewsletterReader } from '../src/models/newsletter.model.js';
import * as opps from '../src/modules/newsletter/opportunities.service.js';
import * as editions from '../src/modules/newsletter/editions.service.js';
import * as alerts from '../src/modules/newsletter/alerts.service.js';
import { inSchool, mcp, actorForRole, OAK } from './support/mcpSchool.js';
import { seedFamilySchool } from './support/familySchool.js';

/**
 * Part-6 newsletter coverage (tools/p6/newsletter.js): the digest's sources
 * and run, the newsletter reader actions, the editor's desk and the alert
 * feeds. Every write is proposed, leaves the data unchanged, and runs only on
 * the same person's confirmation; decisions need the editor's stated words.
 */
const NAMES = Object.keys(p6Newsletter);
const FEED_URL = 'https://www.google.com/alerts/feeds/01234567890123456789/9876543210987654321';
const month = new Date().getUTCMonth() + 1;
let s;
const inOak = (fn) => inSchool(OAK, fn);

async function propose(actor, name, args, opts) {
  const p = await mcp(OAK, actor, name, args, opts);
  expect(p.success, JSON.stringify(p.error)).toBe(true);
  expect(p.action.status).toBe('confirmation_required');
  return p;
}
async function confirm(actor, name, args) {
  const proposal = await propose(actor, name, args);
  const done = await mcp(OAK, actor, name, {}, { confirmationToken: proposal.action.confirmationToken });
  expect(done.success, JSON.stringify(done.error)).toBe(true);
  return { proposal, done };
}

beforeEach(async () => {
  s = await seedFamilySchool();
  const P = s.people.PRINCIPAL.actor;
  await inOak(async () => {
    await opps.create(P, { title: 'Junior Science Olympiad', summary: 'A science olympiad for middle school.', type: 'OLYMPIAD', level: 'NATIONAL', domains: ['SCIENCE'], eligibility: { gradeMin: 5, gradeMax: 8 }, officialUrl: 'https://olympiads.hbcse.tifr.res.in/', typicalMonths: [month], publish: true });
    await opps.create(P, { title: 'Junior Maths Olympiad', summary: 'A maths olympiad.', type: 'OLYMPIAD', level: 'NATIONAL', domains: ['MATHS'], eligibility: { gradeMin: 5, gradeMax: 8 }, officialUrl: 'https://olympiads.hbcse.tifr.res.in/maths', typicalMonths: [month], publish: true });
    await opps.create(s.people.TEACHER.actor, { title: 'Inter-school quiz', summary: 'A quiz.', type: 'COMPETITION', level: 'SCHOOL' });
    await DigestSource.create({ title: 'Science daily', url: 'https://news.example.org/science.xml', interests: ['SCIENCE'], approvedByProfileId: s.people.PRINCIPAL.profile._id });
    await alerts.addSource(P, { kind: 'GOOGLE_ALERT', url: FEED_URL, title: 'Olympiads India', tags: { domains: ['SCIENCE'] } });
  });
});
afterAll(async () => { await resetMcpClient(); });

describe('the contract', () => {
  it('every tool is registered, closed, non-deciding; writes confirm and summarise; decisions are HIGH, web-only, with a required decision', () => {
    expect(NAMES.length).toBe(42);
    for (const n of NAMES) {
      const t = MCP_TOOLS[n];
      expect(t, n).toBeTruthy();
      expect(t.inputSchema.additionalProperties, n).toBe(false);
      expect(isDecidingToolName(n), n).toBe(false);
      expect(['Newsletter', 'Digest']).toContain(t.module);
      expect(['digest.read', 'digest.manage']).toContain(t.permission);
      if (t.permission === 'digest.manage') expect(t.minScope, n).toBe('ALL');
      if (t.operation === 'GET') expect(/^(get|list|search)_/.test(n), n).toBe(true);
      else { expect(t.confirm, n).toBe(true); expect(typeof t.summarise, n).toBe('function'); expect(t.description, n).toMatch(/(Needs confirmation|Confirmed on the website)\.$/); }
      if (t.approverDecision) {
        expect(t.risk, n).toBe('HIGH');
        expect(t.affectsOthers, n).toBe(true);
        expect(t.inputSchema.required, n).toContain('decision');
        expect(t.inputSchema.properties.decision.default, n).toBeUndefined();
      }
    }
    expect(NAMES.filter((n) => MCP_TOOLS[n].approverDecision).sort()).toEqual(['moderate_newsletter_comment', 'record_opportunity_decision']);
    expect(validateMcpRegistry()).toEqual([]);
    const visible = (role) => mcpToolsFor(actorForRole(role)).map((t) => t.name).filter((n) => NAMES.includes(n));
    expect(visible('PARENT')).not.toContain('list_digest_sources');
    expect(visible('PARENT')).toContain('get_newsletter_home');
    expect(visible('PRINCIPAL')).toContain('transition_newsletter_edition');
  });
});

describe('the daily digest', () => {
  it('reads interests and sources; adding a source is proposed, unchanged, then confirmed; a teacher is refused', async () => {
    const i = await mcp(OAK, s.people.PARENT.actor, 'get_my_digest_interests', {});
    expect(i.success, JSON.stringify(i.error)).toBe(true);
    expect(i.data.interests.length).toBe(8);
    const l = await mcp(OAK, s.people.PRINCIPAL.actor, 'list_digest_sources', {});
    expect(l.data.items.map((x) => x.title)).toEqual(['Science daily']);

    const args = { title: 'ISRO news', feedAddress: 'https://news.example.org/isro.xml', interests: ['SCIENCE', 'TECHNOLOGY'] };
    const p = await propose(s.people.PRINCIPAL.actor, 'add_digest_source', args);
    expect(p.action.summary ?? JSON.stringify(p)).toMatch(/ISRO news/);
    expect(await inOak(() => DigestSource.countDocuments({}))).toBe(1);
    await confirm(s.people.PRINCIPAL.actor, 'add_digest_source', args);
    expect(await inOak(() => DigestSource.countDocuments({}))).toBe(2);

    await confirm(s.people.PRINCIPAL.actor, 'update_digest_source', { feed: 'Science daily', status: 'PAUSED' });
    expect((await inOak(() => DigestSource.findOne({ title: 'Science daily' }).lean())).status).toBe('PAUSED');

    const t = await mcp(OAK, s.people.TEACHER.actor, 'list_digest_sources', {});
    expect(t.success).toBe(false);
  });

  it('over WhatsApp, a school-wide feed change is handed to the website', async () => {
    const r = await mcp(OAK, s.people.PRINCIPAL.actor, 'add_digest_source', { title: 'X', feedAddress: 'https://news.example.org/x.xml', interests: ['SCIENCE'] }, { channel: 'WHATSAPP' });
    expect(r.success).toBe(false);
    expect(r.error.details?.reason).toBe('CONFIRM_ON_WEB');
    expect(await inOak(() => DigestSource.countDocuments({}))).toBe(1);
    expect(await inOak(() => DigestPreference.countDocuments({}))).toBe(0);
  });
});

describe('readers', () => {
  it('home, preferences, map and one opportunity; preferences change on confirmation; students cannot turn email on', async () => {
    for (const n of ['get_newsletter_home', 'get_my_newsletter_preferences', 'get_opportunities_map']) {
      const r = await mcp(OAK, s.people.PARENT.actor, n, {});
      expect(r.success, `${n} ${JSON.stringify(r.error)}`).toBe(true);
    }
    const o = await mcp(OAK, s.people.PARENT.actor, 'get_opportunity', { title: 'science olympiad' });
    expect(o.data.title).toBe('Junior Science Olympiad');
    const hidden = await mcp(OAK, s.people.PARENT.actor, 'get_opportunity', { title: 'Inter-school quiz' });
    expect(hidden.success).toBe(false);

    await confirm(s.people.PARENT.actor, 'update_my_newsletter_preferences', { monthly: false, domains: ['SCIENCE'] });
    const r = await inOak(() => NewsletterReader.findOne({ profileId: s.people.PARENT.profile._id }).lean());
    expect(r).toMatchObject({ monthly: false, domains: ['SCIENCE'] });
    const p = await propose(s.people.STUDENT.actor, 'update_my_newsletter_preferences', { email: true });
    const done = await mcp(OAK, s.people.STUDENT.actor, 'update_my_newsletter_preferences', {}, { confirmationToken: p.action.confirmationToken });
    expect(done.success).toBe(false);
  });

  it('save then remove a saved opportunity; the official link is counted', async () => {
    await confirm(s.people.STUDENT.actor, 'save_opportunity', { title: 'Junior Science Olympiad' });
    await confirm(s.people.STUDENT.actor, 'remove_saved_opportunity', { title: 'science' });
    const saved = await mcp(OAK, s.people.STUDENT.actor, 'list_saved_opportunities', {});
    expect(saved.data.items).toEqual([]);
    const link = await mcp(OAK, s.people.STUDENT.actor, 'get_opportunity_official_link', { title: 'Junior Maths' });
    expect(link.data.officialUrl).toMatch(/hbcse/);
    expect((await inOak(() => Opportunity.findOne({ title: 'Junior Maths Olympiad' }).lean())).clicks).toBe(1);
  });
});

describe('the editor and the edition', () => {
  it('decides an item, edits and publishes a draft, then readers vote, comment and a moderator approves', async () => {
    const P = s.people.PRINCIPAL.actor;
    // The decision is the editor's own words.
    const noDecision = await mcp(OAK, P, 'record_opportunity_decision', { title: 'Inter-school quiz' });
    expect(noDecision.success).toBe(false);
    await confirm(P, 'record_opportunity_decision', { title: 'Inter-school quiz', decision: 'PUBLISH' });
    expect((await inOak(() => Opportunity.findOne({ title: 'Inter-school quiz' }).lean())).status).toBe('PUBLISHED');

    await confirm(P, 'update_opportunity', { title: 'Inter-school quiz', summary: 'An inter-school general quiz.', gradeMin: 6 });
    expect((await inOak(() => Opportunity.findOne({ title: 'Inter-school quiz' }).lean())).eligibility.gradeMin).toBe(6);

    await inOak(() => editions.generate({ cadence: 'WEEKLY' }));
    const p = await propose(P, 'update_newsletter_draft', { hook: 'Three doors open this week.', removeItems: ['Inter-school quiz'] });
    expect((await inOak(() => NewsletterEdition.findOne({}).lean())).hook.text).not.toBe('Three doors open this week.');
    await mcp(OAK, P, 'update_newsletter_draft', {}, { confirmationToken: p.action.confirmationToken });
    const draft = await inOak(() => NewsletterEdition.findOne({}).lean());
    expect(draft.hook.text).toBe('Three doors open this week.');

    const list = await mcp(OAK, P, 'list_newsletter_archive', {});
    expect(list.data.items[0].status).toBe('DRAFT');
    const pub = await confirm(P, 'transition_newsletter_edition', { step: 'publish' });
    expect(pub.done.action.type).toBe('newsletter_edition_published');
    expect((await inOak(() => NewsletterEdition.findOne({}).lean())).status).toBe('PUBLISHED');

    const parent = s.people.PARENT.actor;
    await confirm(parent, 'vote_newsletter_poll', { choice: '1' });
    expect((await inOak(() => NewsletterRead.findOne({ profileId: parent.profileId }).lean())).pollChoice).toBeTruthy();
    await confirm(parent, 'react_to_newsletter', { reaction: 'USEFUL' });
    await confirm(parent, 'finish_newsletter_edition', {});
    await confirm(s.people.STUDENT.actor, 'add_newsletter_comment', { comment: 'I want to try the maths one!' });
    expect((await inOak(() => NewsletterComment.findOne({}).lean())).status).toBe('PENDING');

    const pending = await mcp(OAK, s.people.TEACHER.actor, 'list_pending_newsletter_comments', {});
    expect(pending.data.items.length).toBe(1);
    await confirm(s.people.TEACHER.actor, 'moderate_newsletter_comment', { comment: 'maths one', decision: 'APPROVE' });
    expect((await inOak(() => NewsletterComment.findOne({}).lean())).status).toBe('APPROVED');
    const parentMod = await mcp(OAK, parent, 'list_pending_newsletter_comments', {});
    expect(parentMod.success).toBe(false);

    const extras = await mcp(OAK, s.people.STUDENT.actor, 'get_newsletter_edition_extras', {});
    expect(extras.success, JSON.stringify(extras.error)).toBe(true);
    const mates = await mcp(OAK, s.people.STUDENT.actor, 'list_newsletter_challenge_classmates', {});
    expect(mates.success, JSON.stringify(mates.error)).toBe(true);

    await confirm(P, 'transition_newsletter_edition', { step: 'withdraw', reason: 'Wrong week' });
    expect((await inOak(() => NewsletterEdition.findOne({}).lean())).status).toBe('WITHDRAWN');
  });

  it('official sites and the alert feeds', async () => {
    const P = s.people.PRINCIPAL.actor;
    await confirm(P, 'update_newsletter_official_sites', { add: ['sciencefair.example.org'] });
    const sites = await mcp(OAK, P, 'get_newsletter_official_sites', {});
    expect(sites.data.allowedDomains).toContain('sciencefair.example.org');

    const feeds = await mcp(OAK, P, 'list_newsletter_alert_sources', {});
    expect(feeds.data.items[0].title).toBe('Olympiads India');
    await confirm(P, 'update_newsletter_alert_feed', { feed: 'Olympiads', status: 'PAUSED', level: 'NATIONAL' });
    const row = await inOak(() => NewsletterFeedSource.findOne({}).lean());
    expect(row.status).toBe('PAUSED');
    expect(row.tags.level).toBe('NATIONAL');
    for (const n of ['get_google_alerts_guide', 'list_newsletter_alert_items', 'get_newsletter_alert_analytics']) {
      const r = await mcp(OAK, P, n, {});
      expect(r.success, `${n} ${JSON.stringify(r.error)}`).toBe(true);
    }
    const t = await mcp(OAK, s.people.TEACHER.actor, 'list_newsletter_alert_sources', {});
    expect(t.success).toBe(false);
  });
});

describe('questions, flashcards and the queue', () => {
  it('a teacher answers a parent question; a student marks a flashcard; the editor fills the queue', async () => {
    await confirm(s.people.PARENT.actor, 'ask_teacher_about_opportunity', { title: 'Junior Science Olympiad', question: 'Is there a fee?', childName: 'Rahul' });
    const open = await mcp(OAK, s.people.TEACHER.actor, 'list_opportunity_questions', { open: true });
    expect(open.data.items.length).toBe(1);
    expect(JSON.stringify(open.data)).not.toMatch(/PARENT user/);
    await confirm(s.people.TEACHER.actor, 'answer_opportunity_question', { question: 'fee', answer: 'No fee for school entries.' });
    const mine = await mcp(OAK, s.people.PARENT.actor, 'list_opportunity_questions', {});
    expect(mine.data.items[0].status).toBe('ANSWERED');

    await inOak(async () => { const { edition } = await editions.generate({ cadence: 'WEEKLY' }); await editions.publish(s.people.PRINCIPAL.actor, String(edition._id)); });
    const deck = await mcp(OAK, s.people.STUDENT.actor, 'get_newsletter_flashcards', {});
    const front = deck.data.cards[0].front;
    await confirm(s.people.STUDENT.actor, 'answer_newsletter_flashcard', { card: front, result: 'KNEW' });

    const before = await inOak(() => Opportunity.countDocuments({}));
    await confirm(s.people.PRINCIPAL.actor, 'add_opportunity_starter_list', {});
    expect(await inOak(() => Opportunity.countDocuments({}))).toBeGreaterThan(before);
    await confirm(s.people.PRINCIPAL.actor, 'sync_newsletter_feeds', {});
    const t = await mcp(OAK, s.people.TEACHER.actor, 'add_opportunity_starter_list', {});
    expect(t.success).toBe(false);
  });
});
