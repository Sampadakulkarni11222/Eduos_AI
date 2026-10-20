import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { MCP_TOOLS, mcpToolsFor, validateMcpRegistry } from '../src/modules/ai/mcp/registry.js';
import { newsletterP5Tools } from '../src/modules/ai/mcp/tools/p5NewsletterAi.js';
import { isDecidingToolName } from '../src/modules/ai/mcp/decisions.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { NewsletterFeedSource } from '../src/models/newsletterAi.model.js';
import { NewsletterEdition, Opportunity } from '../src/models/newsletter.model.js';
import * as opps from '../src/modules/newsletter/opportunities.service.js';
import * as editions from '../src/modules/newsletter/editions.service.js';
import { inSchool, mcp, actorForRole, OAK } from './support/mcpSchool.js';
import { seedFamilySchool } from './support/familySchool.js';

/**
 * The newsletter AI tools (tools/p5NewsletterAi.js): editor only, every write
 * drafted then confirmed by the same editor, nothing that publishes or sends.
 */
const NAMES = Object.keys(newsletterP5Tools);
const FEED_URL = 'https://www.google.com/alerts/feeds/01234567890123456789/9876543210987654321';
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
  await inOak(() => opps.create(s.people.PRINCIPAL.actor, {
    title: 'Junior Science Olympiad', summary: 'A science olympiad for middle school.', type: 'OLYMPIAD', level: 'NATIONAL', domains: ['SCIENCE'],
    eligibility: { gradeMin: 5, gradeMax: 8 }, officialUrl: 'https://olympiads.hbcse.tifr.res.in/', organiser: 'Sample Society', typicalMonths: [new Date().getUTCMonth() + 1], publish: true,
  }));
  await inOak(() => opps.create(s.people.TEACHER.actor, { title: 'Inter-school quiz', summary: 'A quiz.', type: 'COMPETITION', level: 'SCHOOL' }));
});
afterAll(async () => { await resetMcpClient(); });

describe('the contract', () => {
  it('registers three closed, non-deciding, editor-only tools; writes confirm; the boot check passes', () => {
    expect(NAMES.sort()).toEqual(['add_google_alert_feed', 'get_newsletter_review_queue', 'regenerate_newsletter_hook']);
    for (const n of NAMES) {
      const t = MCP_TOOLS[n];
      expect(t, n).toBeTruthy();
      expect(t.inputSchema.additionalProperties, n).toBe(false);
      expect(isDecidingToolName(n), n).toBe(false);
      expect(t.permission, n).toBe('digest.manage');
      expect(t.minScope, n).toBe('ALL');
      if (t.operation !== 'GET') { expect(t.confirm, n).toBe(true); expect(typeof t.summarise, n).toBe('function'); }
    }
    expect(MCP_TOOLS.add_google_alert_feed.description).not.toMatch(/Google Alerts API integration/i);
    expect(validateMcpRegistry()).toEqual([]);
    const visible = (role) => mcpToolsFor(actorForRole(role)).map((t) => t.name).filter((n) => NAMES.includes(n));
    expect(visible('PARENT')).toEqual([]);
    expect(visible('STUDENT')).toEqual([]);
    expect(visible('TEACHER')).toEqual([]);
    expect(visible('PRINCIPAL').sort()).toEqual([...NAMES].sort());
  });
});

describe('what an editor can ask', () => {
  it('"add this Google Alert feed" is drafted, confirmed, and checks the address', async () => {
    const { proposal, done } = await confirm(s.people.PRINCIPAL.actor, 'add_google_alert_feed', { feedAddress: FEED_URL, title: 'Science olympiads India', domains: ['SCIENCE'], level: 'NATIONAL' });
    expect(proposal.action.summary ?? JSON.stringify(proposal)).toMatch(/Science olympiads India/);
    expect(done.action.type).toBe('newsletter_alert_feed_added');
    const row = await inOak(() => NewsletterFeedSource.findOne({}).lean());
    expect(row).toMatchObject({ kind: 'GOOGLE_ALERT', url: FEED_URL, status: 'APPROVED' });
    const bad = await mcp(OAK, s.people.PRINCIPAL.actor, 'add_google_alert_feed', { feedAddress: 'https://www.google.com/search?q=olympiad', title: 'Not a feed' });
    if (bad.success) {
      const r = await mcp(OAK, s.people.PRINCIPAL.actor, 'add_google_alert_feed', {}, { confirmationToken: bad.action.confirmationToken });
      expect(r.success).toBe(false);
    } else expect(bad.success).toBe(false);
    expect(await inOak(() => NewsletterFeedSource.countDocuments({}))).toBe(1);
    const t = await mcp(OAK, s.people.TEACHER.actor, 'add_google_alert_feed', { feedAddress: FEED_URL, title: 'x' });
    expect(t.success).toBe(false);
  });

  it('"what\'s waiting in the newsletter review queue" lists it by source', async () => {
    const r = await mcp(OAK, s.people.PRINCIPAL.actor, 'get_newsletter_review_queue', {});
    expect(r.success, JSON.stringify(r.error)).toBe(true);
    expect(r.data.total).toBe(1);
    expect(r.data.bySource).toEqual({ STAFF: 1 });
    expect(r.data.items[0].title).toBe('Inter-school quiz');
    expect(r.speak).toMatch(/1 item\(s\) waiting/);
  });

  it('"regenerate the hook for this week\'s edition" changes a draft only, after confirmation, and publishes nothing', async () => {
    const none = await mcp(OAK, s.people.PRINCIPAL.actor, 'regenerate_newsletter_hook', {});
    if (none.success) {
      const r = await mcp(OAK, s.people.PRINCIPAL.actor, 'regenerate_newsletter_hook', {}, { confirmationToken: none.action.confirmationToken });
      expect(r.success).toBe(false);
    }
    const { edition } = await inOak(() => editions.generate({ cadence: 'WEEKLY' }));
    const { done } = await confirm(s.people.PRINCIPAL.actor, 'regenerate_newsletter_hook', {});
    expect(done.action.type).toBe('newsletter_hook_regenerated');
    expect(done.data.writtenBy).toBe('TEMPLATE');
    const after = await inOak(() => NewsletterEdition.findById(edition._id).lean());
    expect(after.status).toBe('DRAFT');
    expect(after.history.some((h) => h.action === 'REGENERATED')).toBe(true);
    expect(await inOak(() => Opportunity.countDocuments({ status: 'PUBLISHED' }))).toBe(1);
  });
});
