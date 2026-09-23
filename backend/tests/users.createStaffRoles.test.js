import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';

/**
 * BUG-04: the staff roles the Create User form now offers, over real HTTP.
 *
 * The backend already accepted them (user.service.js VALID_ROLE_KEYS); only
 * the form had narrowed itself to Student and Teacher. These pin that the API
 * creates each one as the role asked for, and that the RBAC gate in front of
 * it is unchanged: only a holder of users.manage may create anyone.
 */

const { default: apiRoutes } = await import('../src/routes/index.js');
const { errorHandler, notFoundHandler } = await import('../src/middleware/errorHandler.js');
const { signAccessToken } = await import('../src/utils/jwt.js');
const { Profile } = await import('../src/models/profile.model.js');
const { seedRoles, seedPerson } = await import('./support/mcpSchool.js');

let server;
let base;
let people;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', apiRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  const roleIds = await seedRoles();
  people = {};
  for (const key of ['ADMIN', 'PRINCIPAL', 'TEACHER', 'WARDEN']) {
    people[key] = await seedPerson({ roleKey: key, roleId: roleIds[key] });
  }
});

async function createUser(as, body) {
  const token = signAccessToken({ accountId: as.actor.accountId, profileId: as.actor.profileId, door: null });
  const res = await fetch(`${base}/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

let n = 0;
const staff = (roleKey) => ({ roleKey, displayName: `New ${roleKey}`, phone: `+9195550${String(++n).padStart(5, '0')}` });

describe('an admin creating staff from the Create User form', () => {
  it.each(['PRINCIPAL', 'FINANCE', 'LIBRARIAN', 'WARDEN', 'TEACHER'])('creates a %s holding that role', async (roleKey) => {
    const res = await createUser(people.ADMIN, staff(roleKey));
    expect(res.status).toBe(201);
    const profile = await Profile.findOne({ displayName: `New ${roleKey}` }).populate('roleId');
    expect(profile.roleId.key).toBe(roleKey);
    expect(profile.tenantId).toBe(people.ADMIN.profile.tenantId);
  });

  it('still refuses a role that does not exist', async () => {
    const res = await createUser(people.ADMIN, staff('HEADMASTER'));
    expect(res.status).toBe(400);
  });
});

describe('the RBAC gate is unchanged', () => {
  it.each(['PRINCIPAL', 'TEACHER', 'WARDEN'])('a %s, who lacks users.manage, cannot create staff', async (as) => {
    const res = await createUser(people[as], staff('FINANCE'));
    expect(res.status).toBe(403);
    expect(await Profile.countDocuments({ displayName: 'New FINANCE' })).toBe(0);
  });
});
