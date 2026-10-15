import { describe, it, expect, beforeEach } from 'vitest';
import { seedSchool, seedPerson, inSchool, OAK } from './support/mcpSchool.js';
import { CommunityPost, MediaConsent } from '../src/models/community.model.js';
import { SocialOutbox, SocialPost } from '../src/models/social.model.js';
import { School } from '../src/models/school.model.js';
import { setFeatures } from '../src/utils/features.js';
import * as ns from '../src/modules/social/newsroom-social.service.js';

/**
 * "Also post to social media" from the newsroom: offered to staff holding
 * social.publish, refused to families, an admin hint when switched off,
 * consent re-checked, per-network status on the story, never posted twice.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);
const story = (extra = {}) => inOak(() => CommunityPost.create({
  kind: 'STORY', title: 'Science fair', body: 'Our science fair', audience: 'PUBLIC', status: 'PUBLISHED', authorProfileId: s.people.PRINCIPAL.profile._id, ...extra,
}));

beforeEach(async () => {
  s = await seedSchool();
  s.people.MARKETING = await seedPerson({ roleKey: 'MARKETING', roleId: s.roleIds.MARKETING, displayName: 'Marketing lead' });
  await School.create({ slug: OAK, name: 'Oakridge Academy' });
});

describe('what the composer offers', () => {
  it('tells an administrator where to switch it on, and offers families nothing', async () => {
    const admin = await inOak(() => ns.options(s.people.ADMIN.actor));
    expect(admin).toMatchObject({ available: false, enabled: false });
    expect(admin.hint).toMatch(/Tenant Settings/);
    const parent = await inOak(() => ns.options(s.people.PARENT.actor));
    expect(parent).toMatchObject({ available: false });
    expect(parent.hint).toBeUndefined();
    // Marketing staff (no settings.manage) get no hint either.
    expect((await inOak(() => ns.options(s.people.MARKETING.actor))).hint ?? null).toBeNull();
  });

  it('lists the five networks with their connection state once switched on', async () => {
    await inOak(() => setFeatures({ socialPublishing: true }));
    const o = await inOak(() => ns.options(s.people.MARKETING.actor));
    expect(o.available).toBe(true);
    expect(o.networks.map((n) => n.key)).toEqual(['FACEBOOK', 'INSTAGRAM', 'X', 'LINKEDIN', 'YOUTUBE']);
    expect(o.networks.every((n) => n.state === 'NOT_CONNECTED')).toBe(true);
    for (const who of ['PARENT', 'STUDENT']) expect((await inOak(() => ns.options(s.people[who].actor))).available).toBe(false);
  });
});

describe('sharing a story', () => {
  it('is refused while switched off, and for families even with the permission forced', async () => {
    const p = await story();
    await expect(inOak(() => ns.shareStory(s.people.MARKETING.actor, String(p._id), { networks: ['FACEBOOK'] }))).rejects.toMatchObject({ code: 'FEATURE_OFF' });
    await inOak(() => setFeatures({ socialPublishing: true }));
    for (const who of ['PARENT', 'STUDENT']) {
      const forced = { ...s.people[who].actor, permissions: { ...s.people[who].actor.permissions, 'social.publish': 'ALL' } };
      // eslint-disable-next-line no-await-in-loop
      await expect(inOak(() => ns.shareStory(forced, String(p._id), { networks: ['FACEBOOK'] }))).rejects.toMatchObject({ code: 'FAMILY_CANNOT_PUBLISH' });
    }
    expect(await inOak(() => SocialPost.countDocuments())).toBe(0);
  });

  it('shares only a published public story, simulated, with per-network status, never twice', async () => {
    await inOak(() => setFeatures({ socialPublishing: true }));
    const m = s.people.MARKETING.actor;
    const internal = await story({ audience: 'INSTITUTION' });
    await expect(inOak(() => ns.shareStory(m, String(internal._id), { networks: ['FACEBOOK'] }))).rejects.toMatchObject({ code: 'NOT_PUBLIC' });
    const pending = await story({ status: 'PENDING_REVIEW' });
    await expect(inOak(() => ns.shareStory(m, String(pending._id), { networks: ['FACEBOOK'] }))).rejects.toMatchObject({ code: 'NOT_PUBLISHED' });

    const p = await story();
    const out = await inOak(() => ns.shareStory(m, String(p._id), { networks: ['FACEBOOK', 'X'] }));
    expect(out.networks.map((n) => [n.network, n.status, n.display])).toEqual([['FACEBOOK', 'SIMULATED', 'Simulated — not posted'], ['X', 'SIMULATED', 'Simulated — not posted']]);
    // Sharing again, adding LinkedIn, delivers LinkedIn only.
    const again = await inOak(() => ns.shareStory(m, String(p._id), { networks: ['FACEBOOK', 'LINKEDIN'] }));
    expect(again.networks.map((n) => n.network).sort()).toEqual(['FACEBOOK', 'LINKEDIN', 'X']);
    const rows = await inOak(() => SocialOutbox.find({}).lean());
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.attempts === 1)).toBe(true);
    const map = await inOak(() => ns.statusesFor(m, [String(p._id), String(internal._id)]));
    expect(Object.keys(map)).toEqual([String(p._id)]);
  });

  it('needs public consent for a pictured child, checked at the moment of sharing', async () => {
    await inOak(() => setFeatures({ socialPublishing: true }));
    const p = await story({ media: [{ url: '/uploads/x.jpg', studentIds: [s.rahul.student._id], altText: 'Stall' }] });
    await expect(inOak(() => ns.shareStory(s.people.MARKETING.actor, String(p._id), { networks: ['FACEBOOK'] }))).rejects.toMatchObject({ code: 'CONSENT_MISSING' });
    await inOak(() => MediaConsent.create({ studentId: s.rahul.student._id, level: 'PUBLIC', grantedByProfileId: s.people.PARENT.profile._id, grantedByRole: 'PARENT' }));
    const ok = await inOak(() => ns.shareStory(s.people.MARKETING.actor, String(p._id), { networks: ['FACEBOOK'] }));
    expect(ok.networks[0].status).toBe('SIMULATED');
  });
});
