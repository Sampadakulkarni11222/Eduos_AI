import { describe, it, expect, beforeEach } from 'vitest';
import { Account } from '../src/models/account.model.js';
import { Profile } from '../src/models/profile.model.js';
import { Role } from '../src/models/role.model.js';
import { School } from '../src/models/school.model.js';
import { Student } from '../src/models/student.model.js';
import { authenticate } from '../src/middleware/auth.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { runWithTenant, currentTenantId } from '../src/tenancy/tenantContext.js';
import { PERMISSION_CATALOG, SYSTEM_ROLES, AI_ASSISTANT_PERMISSION } from '../src/constants/permissions.js';

/**
 * What a platform administrator sees when they open one school.
 *
 * The console sends `X-School-Id` with every call once a school is opened, and
 * this is the middleware that turns it into the tenant context every query is
 * filtered by. The rules that matter: a Super Admin may choose, everyone else
 * is pinned to their own school and the header is ignored for them, and a
 * platform actor who names no school still spans the platform.
 */

let superAdminToken;
let adminToken;

/**
 * Runs `authenticate` over a fake request and reports what it resolved.
 *
 * The read happens *inside* `next`: a Mongoose query runs its hooks when it is
 * awaited, so one awaited after the scope has closed would come back
 * unfiltered and this file would pass while proving nothing.
 *
 * A rejection arrives the Express way — as `next(err)`, via asyncHandler —
 * rather than as a rejected promise, so it is captured and rethrown here.
 */
async function actAs(token, headers = {}) {
  const req = { headers: { authorization: `Bearer ${token}`, ...headers }, socket: {} };
  let result;
  let failure;
  await authenticate(req, {}, async (err) => {
    if (err) {
      failure = err;
      return;
    }
    result = {
      tenantId: currentTenantId(),
      actingSchoolId: req.actor.actingSchoolId ?? null,
      actor: req.actor,
      students: await Student.find().lean(),
    };
  });
  if (failure) throw failure;
  return result;
}

async function makeActor(roleKey, email, phone, tenantId) {
  const role = await Role.findOne({ key: roleKey });
  const account = await Account.create({ email, phoneE164: phone });
  const profile = await Profile.create({
    accountId: account._id, roleId: role._id, displayName: email,
    ...(tenantId && { tenantId, tenantName: tenantId }),
  });
  return signAccessToken({
    accountId: account._id.toString(), profileId: profile._id.toString(), door: tenantId ?? null,
  });
}

beforeEach(async () => {
  await School.create([
    { slug: 'oakridge', name: 'Oakridge Academy' },
    { slug: 'nvmp', name: 'NVMP School' },
  ]);
  for (const r of SYSTEM_ROLES) {
    await Role.create({ key: r.key, name: r.name, isSystem: true, permissions: r.grants });
  }

  await runWithTenant('oakridge', () => Student.create({ admissionNo: 'OAK-1', firstName: 'Oak', lastName: 'One' }));
  await runWithTenant('nvmp', () => Student.create({ admissionNo: 'NVMP-1', firstName: 'Nvmp', lastName: 'One' }));

  superAdminToken = await makeActor('SUPER_ADMIN', 'owner@platform.test', '+919700000001', null);
  adminToken = await makeActor('ADMIN', 'admin@oakridge.test', '+919700000002', 'oakridge');
});

describe('a platform administrator opening one school', () => {
  it('scopes the request to the school named by X-School-Id', async () => {
    const { tenantId, students } = await actAs(superAdminToken, { 'x-school-id': 'nvmp' });
    expect(tenantId).toBe('nvmp');
    expect(students.map((s) => s.admissionNo)).toEqual(['NVMP-1']);
  });

  it('reads the other school when it opens the other school', async () => {
    const { students } = await actAs(superAdminToken, { 'x-school-id': 'oakridge' });
    expect(students.map((s) => s.admissionNo)).toEqual(['OAK-1']);
  });

  it('spans every school when no school is named', async () => {
    const { tenantId, students } = await actAs(superAdminToken);
    expect(tenantId).toBeNull();
    expect(students).toHaveLength(2);
  });

  it('accepts the header case-insensitively and trims it', async () => {
    const { tenantId } = await actAs(superAdminToken, { 'x-school-id': '  NVMP ' });
    expect(tenantId).toBe('nvmp');
  });

  it('refuses a school that does not exist', async () => {
    await expect(actAs(superAdminToken, { 'x-school-id': 'no-such-school' })).rejects.toMatchObject({
      code: 'SCHOOL_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('holds every permission in the catalogue at school-wide scope, bar the assistant', async () => {
    const { actor } = await actAs(superAdminToken, { 'x-school-id': 'oakridge' });
    for (const p of PERMISSION_CATALOG) {
      if (p.key === AI_ASSISTANT_PERMISSION) continue;
      expect(actor.permissions[p.key], p.key).toBe('ALL');
    }
    // The one exception, and the whole of the platform role's exclusion from
    // the AI assistant: opening a school gives it that school's data, not a
    // school-level assistant. See tests/ai.superAdminExcluded.test.js.
    expect(actor.permissions[AI_ASSISTANT_PERMISSION]).toBeUndefined();
  });
});

describe('the header is a platform privilege, not a way in', () => {
  it('is ignored for a school admin — they stay in their own school', async () => {
    const { tenantId, students } = await actAs(adminToken, { 'x-school-id': 'nvmp' });
    expect(tenantId).toBe('oakridge');
    expect(students.map((s) => s.admissionNo)).toEqual(['OAK-1']);
  });

  it('does not even 404 a school admin for naming a school that does not exist', async () => {
    // The header is not read for them at all, so a bad value cannot break
    // their session — it simply has no effect.
    const { tenantId } = await actAs(adminToken, { 'x-school-id': 'no-such-school' });
    expect(tenantId).toBe('oakridge');
  });
});
