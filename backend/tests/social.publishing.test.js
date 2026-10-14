import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import express from 'express';
import { seedSchool, seedPerson, inSchool, OAK } from './support/mcpSchool.js';
import { MediaConsent, CommunityPost } from '../src/models/community.model.js';
import { SocialOutbox, SocialPost, SocialAccount } from '../src/models/social.model.js';
import { School } from '../src/models/school.model.js';
import * as social from '../src/modules/social/social.service.js';

/**
 * Newsroom social publishing: one outbox row per network, SIMULATED without
 * provider credentials, consent re-checked at the moment of publishing,
 * retries that never post twice, parents and students refused whatever
 * their role holds, and account connections that never keep a token.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);
const consent = (studentId, level = 'PUBLIC') => inOak(() => MediaConsent.create({ studentId, level, grantedByProfileId: s.people.PARENT.profile._id, grantedByRole: 'PARENT' }));
const rahul = () => String(s.rahul.student._id);

beforeEach(async () => {
  s = await seedSchool();
  s.people.MARKETING = await seedPerson({ roleKey: 'MARKETING', roleId: s.roleIds.MARKETING, displayName: 'Marketing lead' });
});
afterEach(() => social.setSocialAdapterForTests(null));

describe('composing', () => {
  it('needs every child tagged with public consent, or a statement that no child is identifiable', async () => {
    const m = s.people.MARKETING.actor;
    await expect(inOak(() => social.compose(m, { text: 'Sports day!', networks: ['FACEBOOK'] }))).rejects.toMatchObject({ code: 'TAG_OR_CONFIRM' });
    await expect(inOak(() => social.compose(m, { text: 'Sports day!', networks: [] }))).rejects.toMatchObject({ code: 'NO_NETWORKS' });
    await expect(inOak(() => social.compose(m, { text: 'Sports day!', networks: ['MYSPACE'], noIdentifiableStudents: true }))).rejects.toMatchObject({ code: 'BAD_NETWORK' });
    await expect(inOak(() => social.compose(m, { text: 'Rahul wins', networks: ['FACEBOOK'], studentIds: [rahul()] }))).rejects.toMatchObject({ code: 'CONSENT_MISSING' });
    // Internal-only consent is not enough for an external network.
    await consent(s.rahul.student._id, 'INTERNAL');
    await expect(inOak(() => social.compose(m, { text: 'Rahul wins', networks: ['FACEBOOK'], studentIds: [rahul()] }))).rejects.toMatchObject({ code: 'CONSENT_MISSING' });
    await consent(s.rahul.student._id, 'PUBLIC');
    const post = await inOak(() => social.compose(m, { text: 'Rahul wins', networks: ['FACEBOOK', 'INSTAGRAM', 'X', 'LINKEDIN', 'YOUTUBE'], studentIds: [rahul()] }));
    expect(post.outbox.map((r) => r.status)).toEqual(['QUEUED', 'QUEUED', 'QUEUED', 'QUEUED', 'QUEUED']);
    expect(await inOak(() => SocialOutbox.countDocuments())).toBe(5);
  });

  it('shares only a published public newsroom story, carrying its tagged children', async () => {
    const story = await inOak(() => CommunityPost.create({
      kind: 'STORY', title: 'Science fair', body: 'Our science fair', audience: 'INSTITUTION', status: 'PUBLISHED', authorProfileId: s.people.PRINCIPAL.profile._id,
      media: [{ url: '/uploads/x.jpg', studentIds: [s.rahul.student._id] }],
    }));
    const m = s.people.MARKETING.actor;
    await expect(inOak(() => social.compose(m, { communityPostId: String(story._id), networks: ['FACEBOOK'] }))).rejects.toMatchObject({ code: 'NOT_PUBLIC' });
    await inOak(() => CommunityPost.updateOne({ _id: story._id }, { $set: { audience: 'PUBLIC' } }));
    await expect(inOak(() => social.compose(m, { communityPostId: String(story._id), networks: ['FACEBOOK'] }))).rejects.toMatchObject({ code: 'CONSENT_MISSING' });
    await consent(s.rahul.student._id);
    const post = await inOak(() => social.compose(m, { communityPostId: String(story._id), networks: ['FACEBOOK'] }));
    expect(post.studentIds).toEqual([rahul()]);
    expect(post.text).toContain('Science fair');
  });
});

describe('publishing', () => {
  it('records SIMULATED without credentials and never attempts a network twice', async () => {
    await consent(s.rahul.student._id);
    const m = s.people.MARKETING.actor;
    const post = await inOak(() => social.compose(m, { text: 'Rahul wins', networks: ['FACEBOOK', 'X'], studentIds: [rahul()] }));
    const out = await inOak(() => social.publish(m, post.id));
    expect(out.status).toBe('DONE');
    expect(out.outbox.map((r) => [r.status, r.display])).toEqual([['SIMULATED', 'Simulated — not posted'], ['SIMULATED', 'Simulated — not posted']]);
    const again = await inOak(() => social.publish(m, post.id));
    expect(again.outbox.map((r) => r.attempts)).toEqual([1, 1]);
  });

  it('re-checks consent at the moment of publishing', async () => {
    await consent(s.rahul.student._id);
    const m = s.people.MARKETING.actor;
    const post = await inOak(() => social.compose(m, { text: 'Rahul wins', networks: ['FACEBOOK'], studentIds: [rahul()] }));
    // The parent withdraws consent after the post was written.
    await inOak(() => MediaConsent.updateMany({ studentId: s.rahul.student._id }, { $set: { withdrawnAt: new Date() } }));
    let calls = 0;
    social.setSocialAdapterForTests(async () => { calls += 1; return { status: 'SENT' }; });
    await expect(inOak(() => social.publish(m, post.id))).rejects.toMatchObject({ code: 'CONSENT_MISSING' });
    expect(calls).toBe(0);
    expect((await inOak(() => SocialPost.findById(post.id).lean())).status).toBe('BLOCKED');
    expect((await inOak(() => SocialOutbox.findOne({}).lean())).status).toBe('QUEUED');
  });

  it('retries only the failed network, and concurrent publishes deliver each network once', async () => {
    const m = s.people.MARKETING.actor;
    const calls = { FACEBOOK: 0, X: 0, LINKEDIN: 0 };
    const sent = { FACEBOOK: 0, X: 0, LINKEDIN: 0 };
    let failX = true;
    social.setSocialAdapterForTests(async (network) => {
      calls[network] += 1;
      await new Promise((r) => setTimeout(r, 20));
      if (network === 'X' && failX) return { status: 'FAILED', reason: 'HTTP 503' };
      sent[network] += 1;
      return { status: 'SENT', providerPostId: `${network}-1` };
    });
    const post = await inOak(() => social.compose(m, { text: 'Open day on Saturday', networks: ['FACEBOOK', 'X', 'LINKEDIN'], noIdentifiableStudents: true }));
    // Two clicks at once: each network is claimed by exactly one of them.
    await Promise.all([inOak(() => social.publish(m, post.id)), inOak(() => social.publish(m, post.id))]);
    expect(sent).toEqual({ FACEBOOK: 1, X: 0, LINKEDIN: 1 });
    expect(calls.FACEBOOK).toBe(1);
    expect(calls.LINKEDIN).toBe(1);
    const failed = await inOak(() => social.getPost(m, post.id));
    expect(failed.status).toBe('PUBLISHING');
    expect(failed.outbox.find((o) => o.network === 'X')).toMatchObject({ status: 'FAILED', display: 'Failed — can be retried' });

    failX = false;
    const before = { ...calls };
    const retried = await inOak(() => social.publish(m, post.id));
    expect(calls).toEqual({ ...before, X: before.X + 1 });
    expect(retried.status).toBe('DONE');
    expect(retried.outbox.every((o) => o.status === 'SENT')).toBe(true);
    await inOak(() => social.publish(m, post.id));
    expect(sent).toEqual({ FACEBOOK: 1, X: 1, LINKEDIN: 1 });
    expect(calls).toEqual({ ...before, X: before.X + 1 });
    // The idempotency key is unique per post and network.
    await expect(inOak(() => SocialOutbox.create({ socialPostId: post.id, network: 'X', idempotencyKey: `${post.id}:X` }))).rejects.toMatchObject({ code: 11000 });
  });
});

describe('who may publish', () => {
  it('refuses parents, students and alumni server-side even with a misconfigured role', async () => {
    const forced = (roleKey) => ({ ...s.people.PARENT.actor, roleKey, permissions: { 'social.publish': 'ALL', 'social.connect': 'ALL' } });
    for (const roleKey of ['PARENT', 'STUDENT', 'ALUMNUS']) {
      await expect(inOak(() => social.compose(forced(roleKey), { text: 'x', networks: ['FACEBOOK'], noIdentifiableStudents: true })), roleKey).rejects.toMatchObject({ code: 'FAMILY_CANNOT_PUBLISH' });
      await expect(inOak(() => social.connectAccount(forced(roleKey), { network: 'X', handle: 'school' })), roleKey).rejects.toMatchObject({ code: 'FAMILY_CANNOT_PUBLISH' });
    }
    const m = s.people.MARKETING.actor;
    const post = await inOak(() => social.compose(m, { text: 'Open day', networks: ['FACEBOOK'], noIdentifiableStudents: true }));
    await expect(inOak(() => social.publish(forced('PARENT'), post.id))).rejects.toMatchObject({ code: 'FAMILY_CANNOT_PUBLISH' });
    // A teacher (no social.publish) is refused by permission.
    await expect(inOak(() => social.compose(s.people.TEACHER.actor, { text: 'x', networks: ['FACEBOOK'], noIdentifiableStudents: true }))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('refuses a parent at the HTTP layer too', async () => {
    const { default: socialRoutes } = await import('../src/modules/social/social.routes.js');
    const { signAccessToken } = await import('../src/utils/jwt.js');
    await School.create({ slug: OAK, name: 'Oakridge Academy' });
    const app = express();
    app.use(express.json());
    app.use('/social', socialRoutes);
    // eslint-disable-next-line no-unused-vars
    app.use((err, _req, res, _next) => res.status(err.statusCode ?? 500).json({ code: err.code, message: err.message }));
    const server = app.listen(0);
    try {
      const port = server.address().port;
      const call = (person) => fetch(`http://127.0.0.1:${port}/social/posts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signAccessToken({ accountId: String(person.account._id), profileId: String(person.profile._id) })}` },
        body: JSON.stringify({ text: 'x', networks: ['FACEBOOK'], noIdentifiableStudents: true }),
      });
      const res = await call(s.people.PARENT);
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('FAMILY_CANNOT_PUBLISH');
      // Staff reach the feature gate: social publishing is off by default.
      const staff = await call(s.people.MARKETING);
      expect((await staff.json()).code).toBe('FEATURE_OFF');
    } finally { server.close(); }
  });
});

describe('connecting accounts', () => {
  it('records the account as pending provider credentials and never keeps a token', async () => {
    const admin = s.people.ADMIN.actor;
    const a = await inOak(() => social.connectAccount(admin, { network: 'INSTAGRAM', handle: '@oakridge.sample', accessToken: 'tok-SECRET-123', password: 'pw-SECRET' }));
    expect(a).toMatchObject({ status: 'CONNECTION_PENDING', statusNote: 'Connection pending: needs provider credentials', handle: 'oakridge.sample' });
    const raw = await mongoose.connection.collection(SocialAccount.collection.collectionName).find({}).toArray();
    expect(JSON.stringify(raw)).not.toMatch(/SECRET/);
    expect(raw[0].credentialEnc ?? null).toBeNull();
    await expect(inOak(() => social.connectAccount(s.people.MARKETING.actor, { network: 'X', handle: 'school' }))).rejects.toMatchObject({ statusCode: 403 });
    const list = await inOak(() => social.listAccounts(s.people.MARKETING.actor));
    expect(list.networks.every((n) => n.credentials === 'not configured')).toBe(true);
  });
});
