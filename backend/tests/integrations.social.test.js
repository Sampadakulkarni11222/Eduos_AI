import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { seedSchool, seedPerson, inSchool, OAK } from './support/mcpSchool.js';
import { stubProviders, unstubProviders, setAppEnv, json, seedConnection } from './support/integrationsStub.js';
import { MediaConsent, CommunityPost } from '../src/models/community.model.js';
import { SocialOutbox } from '../src/models/social.model.js';
import * as social from '../src/modules/social/social.service.js';
import * as engagement from '../src/modules/integrations/engagement.service.js';
import { renderFor, xLength } from '../src/modules/integrations/social.publishers.js';
import { escapeCommentary } from '../src/modules/integrations/clients/linkedin.js';

/**
 * Live social posting against recorded API shapes (fetch stubbed): one post
 * per post + network, provider ids and links kept, each network's limits,
 * consent re-checked first, YouTube honestly unsupported, SIMULATED (and no
 * request) without the app or a connected account.
 */
let s;
let net;
const inOak = (fn) => inSchool(OAK, fn);
const m = () => s.people.MARKETING.actor;
const META_ASSETS = { metaPages: [{ id: '111', name: 'Oakridge', igUserId: '178414', igUsername: 'oakridge' }] };

beforeEach(async () => {
  s = await seedSchool();
  s.people.MARKETING = await seedPerson({ roleKey: 'MARKETING', roleId: s.roleIds.MARKETING, displayName: 'Marketing lead' });
  net = stubProviders();
});
afterEach(() => { unstubProviders(); setAppEnv(false); social.setSocialAdapterForTests(null); });

const compose = (extra = {}) => inOak(() => social.compose(m(), { text: 'Sports day was a joy!', networks: ['FACEBOOK'], noIdentifiableStudents: true, ...extra }));

describe('without the app or a connected account', () => {
  it('is SIMULATED and sends nothing', async () => {
    const p = await compose({ networks: ['FACEBOOK', 'INSTAGRAM', 'X', 'LINKEDIN', 'YOUTUBE'] });
    const out = await inOak(() => social.publish(m(), p.id));
    expect(out.outbox.map((r) => r.status)).toEqual(['SIMULATED', 'SIMULATED', 'SIMULATED', 'SIMULATED', 'SIMULATED']);
    expect(out.outbox[0].statusReason).toMatch(/app is not configured by the platform administrator/);
    setAppEnv(true);
    const p2 = await compose({ networks: ['X'] });
    const out2 = await inOak(() => social.publish(m(), p2.id));
    expect(out2.outbox[0]).toMatchObject({ status: 'SIMULATED' });
    expect(out2.outbox[0].statusReason).toMatch(/not connected/);
    expect(net.calls).toHaveLength(0);
    const accounts = await inOak(() => social.listAccounts(s.people.ADMIN.actor));
    expect(accounts.networks.every((n) => n.mode === 'SIMULATED')).toBe(true);
  });
});

describe('live posting', () => {
  beforeEach(() => setAppEnv(true));

  it('Facebook: a text + link post with the Page token, id and permalink kept, never posted twice', async () => {
    await inOak(() => seedConnection('META', { secrets: { pageTokens: { 111: 'page-token-111' } }, assets: META_ASSETS, selected: { metaPageId: '111' } }));
    net.routes.push(
      ['POST', /graph\.facebook\.com\/v21\.0\/111\/feed$/, json({ id: '111_9001' })],
      ['GET', /graph\.facebook\.com\/v21\.0\/111_9001\?/, json({ id: '111_9001', permalink_url: 'https://www.facebook.com/111/posts/9001' })],
    );
    const p = await compose({ link: 'https://oakridge.example/news/sports-day' });
    const out = await inOak(() => social.publish(m(), p.id));
    expect(out.outbox[0]).toMatchObject({ status: 'SENT', display: 'Posted', providerPostId: '111_9001', permalink: 'https://www.facebook.com/111/posts/9001' });
    const form = new URLSearchParams(net.calls[0].body);
    expect(form.get('message')).toBe('Sports day was a joy!');
    expect(form.get('link')).toBe('https://oakridge.example/news/sports-day');
    expect(net.calls[0].headers.Authorization).toBe('Bearer page-token-111');
    await inOak(() => social.publish(m(), p.id));
    expect(net.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(out.status).toBe('DONE');
  });

  it('Instagram: needs a photo; with one, creates a container, waits for it, then publishes', async () => {
    await inOak(() => seedConnection('META', { secrets: { pageTokens: { 111: 'page-token-111' } }, assets: META_ASSETS, selected: { metaPageId: '111' } }));
    const noPhoto = await compose({ networks: ['INSTAGRAM'] });
    const failed = await inOak(() => social.publish(m(), noPhoto.id));
    expect(failed.outbox[0]).toMatchObject({ status: 'FAILED' });
    expect(failed.outbox[0].statusReason).toMatch(/need a photo/);
    expect(net.calls).toHaveLength(0);

    net.routes.push(
      ['POST', /178414\/media$/, json({ id: '17890001' })],
      ['GET', /17890001\?fields=status_code/, json({ status_code: 'FINISHED', id: '17890001' })],
      ['POST', /178414\/media_publish$/, json({ id: '17990002' })],
      ['GET', /17990002\?fields=permalink/, json({ permalink: 'https://www.instagram.com/p/abc/' })],
    );
    const p = await compose({ networks: ['INSTAGRAM'], imageUrl: 'https://cdn.oakridge.example/sports.jpg' });
    const out = await inOak(() => social.publish(m(), p.id));
    expect(out.outbox[0]).toMatchObject({ status: 'SENT', providerPostId: '17990002', permalink: 'https://www.instagram.com/p/abc/' });
    expect(new URLSearchParams(net.calls[0].body).get('image_url')).toBe('https://cdn.oakridge.example/sports.jpg');
    expect(new URLSearchParams(net.calls[2].body).get('creation_id')).toBe('17890001');
  });

  it('LinkedIn: an organisation post with escaped commentary and the article link', async () => {
    await inOak(() => seedConnection('LINKEDIN', { assets: { linkedinOrgs: [{ urn: 'urn:li:organization:2414183', name: 'Oakridge' }] }, selected: { linkedinOrgUrn: 'urn:li:organization:2414183' } }));
    net.routes.push(['POST', /api\.linkedin\.com\/rest\/posts$/, json(undefined, 201, { 'x-restli-id': 'urn:li:share:7100' })]);
    const p = await compose({ networks: ['LINKEDIN'], text: 'Results (2026) are out #proud', link: 'https://oakridge.example/results' });
    const out = await inOak(() => social.publish(m(), p.id));
    expect(out.outbox[0]).toMatchObject({ status: 'SENT', providerPostId: 'urn:li:share:7100', permalink: 'https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A7100/' });
    const sent = JSON.parse(net.calls[0].body);
    expect(sent).toMatchObject({ author: 'urn:li:organization:2414183', visibility: 'PUBLIC', lifecycleState: 'PUBLISHED', content: { article: { source: 'https://oakridge.example/results' } } });
    expect(sent.commentary).toBe('Results \\(2026\\) are out \\#proud');
    expect(net.calls[0].headers['LinkedIn-Version']).toBe('202409');
    expect(escapeCommentary('a_b*c')).toBe('a\\_b\\*c');
  });

  it('X: posts the text with the link, refuses free text over 280 and shortens a shared story', async () => {
    await inOak(() => seedConnection('X', { purposes: ['social'] }));
    net.routes.push(['POST', /api\.x\.com\/2\/tweets$/, json({ data: { id: '1846000000000000001', text: 'x' } }, 201)]);
    await expect(compose({ networks: ['X'], text: 'a'.repeat(281) })).rejects.toMatchObject({ code: 'TOO_LONG_FOR_X' });
    const p = await compose({ networks: ['X'], link: 'https://oakridge.example/n' });
    const out = await inOak(() => social.publish(m(), p.id));
    expect(out.outbox[0]).toMatchObject({ status: 'SENT', permalink: 'https://x.com/i/web/status/1846000000000000001' });
    expect(JSON.parse(net.calls[0].body)).toEqual({ text: 'Sports day was a joy! https://oakridge.example/n' });
    expect(net.calls[0].headers.Authorization).toBe('Bearer x-access-token');

    const r = renderFor('X', { text: `${'word '.repeat(80)}end`, link: 'https://oakridge.example/story', shortenable: true });
    expect(xLength(r.text)).toBeLessThanOrEqual(280);
    expect(r.text).toMatch(/… https:\/\/oakridge\.example\/story$/);
  });

  it('YouTube community posts are not supported: said so, final, never retried', async () => {
    await inOak(() => seedConnection('GOOGLE'));
    const p = await compose({ networks: ['YOUTUBE'] });
    const out = await inOak(() => social.publish(m(), p.id));
    expect(out.outbox[0]).toMatchObject({ status: 'NOT_SUPPORTED', display: 'Not supported by this network' });
    expect(out.outbox[0].statusReason).toMatch(/no public API for community posts/);
    expect(out.status).toBe('DONE');
    await inOak(() => social.publish(m(), p.id));
    expect((await inOak(() => SocialOutbox.findOne({}).lean())).attempts).toBe(1);
    expect(net.calls).toHaveLength(0);
  });

  it('a network error is FAILED with the reason, sent once, and can be retried', async () => {
    await inOak(() => seedConnection('X', { purposes: ['social'] }));
    let n = 0;
    net.routes.push(['POST', /api\.x\.com\/2\/tweets$/, () => (++n === 1 ? json({ title: 'Service Unavailable', detail: 'Over capacity' }, 503) : json({ data: { id: '42' } }, 201))]);
    const p = await compose({ networks: ['X'] });
    const first = await inOak(() => social.publish(m(), p.id));
    expect(first.outbox[0]).toMatchObject({ status: 'FAILED', display: 'Failed — can be retried' });
    expect(first.outbox[0].statusReason).toMatch(/Over capacity/);
    expect(n).toBe(1); // a post is never repeated automatically after a server error
    const second = await inOak(() => social.publish(m(), p.id));
    expect(second.outbox[0]).toMatchObject({ status: 'SENT', providerPostId: '42' });
  });

  it('consent is re-checked before anything is sent', async () => {
    await inOak(() => seedConnection('X', { purposes: ['social'] }));
    await inOak(() => MediaConsent.create({ studentId: s.rahul.student._id, level: 'PUBLIC', grantedByProfileId: s.people.PARENT.profile._id, grantedByRole: 'PARENT' }));
    const p = await inOak(() => social.compose(m(), { text: 'Rahul wins', networks: ['X'], studentIds: [String(s.rahul.student._id)] }));
    await inOak(() => MediaConsent.updateMany({}, { $set: { withdrawnAt: new Date() } }));
    await expect(inOak(() => social.publish(m(), p.id))).rejects.toMatchObject({ code: 'CONSENT_MISSING' });
    expect(net.calls).toHaveLength(0);
  });

  it('a shared newsroom story carries its photo to Facebook as a photo post', async () => {
    process.env.PUBLIC_API_URL = 'https://api.oakridge.example';
    try {
      await inOak(() => seedConnection('META', { secrets: { pageTokens: { 111: 'page-token-111' } }, assets: META_ASSETS, selected: { metaPageId: '111' } }));
      const story = await inOak(() => CommunityPost.create({ kind: 'STORY', title: 'Science fair', body: 'Our science fair', audience: 'PUBLIC', status: 'PUBLISHED', authorProfileId: s.people.PRINCIPAL.profile._id, media: [{ url: '/uploads/fair.jpg', noIdentifiableStudents: true }] }));
      net.routes.push(['POST', /111\/photos$/, json({ id: '5001', post_id: '111_5002' })], ['GET', /111_5002\?/, json({ permalink_url: 'https://www.facebook.com/111/posts/5002' })]);
      const p = await inOak(() => social.compose(m(), { communityPostId: String(story._id), networks: ['FACEBOOK'], noIdentifiableStudents: true }));
      const out = await inOak(() => social.publish(m(), p.id));
      expect(out.outbox[0]).toMatchObject({ status: 'SENT', providerPostId: '111_5002' });
      expect(new URLSearchParams(net.calls[0].body).get('url')).toMatch(/^https:\/\/api\.oakridge\.example\/uploads\/fair\.jpg\?exp=\d+&sig=[a-f0-9]+$/);
    } finally { delete process.env.PUBLIC_API_URL; }
  });

  it('reads engagement back for a sent post only', async () => {
    await inOak(() => seedConnection('X', { purposes: ['social'] }));
    net.routes.push(
      ['POST', /api\.x\.com\/2\/tweets$/, json({ data: { id: '77' } }, 201)],
      ['GET', /api\.x\.com\/2\/tweets\/77\?/, json({ data: { id: '77', public_metrics: { like_count: 12, reply_count: 3, retweet_count: 2, quote_count: 1, impression_count: 900 } } })],
    );
    const sim = await compose({ networks: ['FACEBOOK'] });
    await inOak(() => social.publish(m(), sim.id));
    await expect(inOak(() => engagement.refreshPost(m(), sim.id))).rejects.toMatchObject({ code: 'NOTHING_SENT' });
    const p = await compose({ networks: ['X'] });
    await inOak(() => social.publish(m(), p.id));
    const out = await inOak(() => engagement.refreshPost(m(), p.id));
    expect(out.networks[0].engagement).toMatchObject({ likes: 12, comments: 3, shares: 3, impressions: 900 });
    const due = await inOak(() => engagement.refreshDue({ now: new Date() }));
    expect(due.checked).toBe(0); // just refreshed: not due for six hours
  });
});
