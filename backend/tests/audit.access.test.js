import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { AuditLog } from '../src/models/auditLog.model.js';
import { Account } from '../src/models/account.model.js';
import { Profile } from '../src/models/profile.model.js';
import { Role } from '../src/models/role.model.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { requirePermission } from '../src/middleware/permission.js';
import { runWithTenant, runAcrossSchools } from '../src/tenancy/tenantContext.js';
import { listLogs } from '../src/modules/audit/audit.controller.js';

/**
 * Who may read the audit trail, and which of it they get.
 *
 * The trail records who did what, to which record, from which IP, across the
 * whole school, so the two questions are separate: the route guard decides
 * whether the log opens at all, and the controller decides which rows are
 * inside it once open.
 */

const OAK = 'oakridge';
const NVMP = 'nvmp';
const inOak = (fn) => runWithTenant(OAK, fn);
const inNvmp = (fn) => runWithTenant(NVMP, fn);

const roleDocs = new Map();
const grantsFor = (roleKey) => SYSTEM_ROLES.find((r) => r.key === roleKey).grants;
const actorFor = (roleKey) => ({
  roleKey,
  profileId: new mongoose.Types.ObjectId().toString(),
  permissions: buildPermissionMap({ permissions: grantsFor(roleKey) }),
});

/** Runs the real route guard and reports whether the log opens. */
const canOpenAuditLog = (roleKey) => {
  const req = { actor: actorFor(roleKey) };
  try {
    requirePermission('audit.read')(req, {}, () => {});
    return true;
  } catch {
    return false;
  }
};

/** Invokes the controller the way the route does and returns the DTOs. */
const fetchLogs = async (actor, query = {}) => {
  const req = { actor, query };
  let payload;
  const res = {
    status: () => res,
    json: (body) => { payload = body; return res; },
  };
  await listLogs(req, res, (err) => { if (err) throw err; });
  return payload.data.items;
};

/** Creates a profile in the acting school holding the given role. */
const makeProfile = async (roleKey, displayName) => {
  const account = await Account.create({
    phoneE164: `+9198${Math.floor(Math.random() * 90000000) + 10000000}`,
  });
  return Profile.create({
    accountId: account._id, roleId: roleDocs.get(roleKey)._id,
    displayName, tenantId: OAK, tenantName: OAK,
  });
};

let teacherProfile;
let adminProfile;
let studentProfile;

beforeEach(async () => {
  roleDocs.clear();
  for (const r of SYSTEM_ROLES) {
    roleDocs.set(r.key, await Role.create({ key: r.key, name: r.name, isSystem: true, permissions: r.grants }));
  }

  await inOak(async () => {
    teacherProfile = await makeProfile('TEACHER', 'A Teacher');
    adminProfile = await makeProfile('ADMIN', 'An Admin');
    studentProfile = await makeProfile('STUDENT', 'A Student');

    await AuditLog.create({ actorProfileId: teacherProfile._id, action: 'attendance.mark', entityType: 'Attendance', createdAt: new Date('2026-03-10T10:00:00Z') });
    await AuditLog.create({ actorProfileId: adminProfile._id, action: 'student.create', entityType: 'Student', createdAt: new Date('2026-03-12T10:00:00Z') });
    await AuditLog.create({ actorProfileId: studentProfile._id, action: 'auth.login', entityType: 'Account', createdAt: new Date('2026-03-14T10:00:00Z') });
    await AuditLog.create({ actorProfileId: adminProfile._id, action: 'users.import', entityType: 'User', createdAt: new Date('2026-02-02T10:00:00Z') });
  });

  await inNvmp(async () => {
    await AuditLog.create({ action: 'student.create', entityType: 'Student', createdAt: new Date('2026-03-12T10:00:00Z') });
  });
});

describe('1. who may open the audit log at all', () => {
  it.each(['SUPER_ADMIN', 'ADMIN', 'PRINCIPAL'])('%s holds audit.read', (roleKey) => {
    expect(canOpenAuditLog(roleKey)).toBe(true);
  });

  it.each(['TEACHER', 'STUDENT', 'PARENT', 'FINANCE', 'LIBRARIAN', 'WARDEN'])(
    '%s is refused, by URL or by direct API call', (roleKey) => {
      expect(canOpenAuditLog(roleKey)).toBe(false);
    });
});

describe('2 & 3. the primary view shows teacher and admin activity', () => {
  it('lists staff actions and leaves out a student login', async () => {
    const items = await inOak(() => fetchLogs(actorFor('ADMIN')));
    const actions = items.map((i) => i.action).sort();
    expect(actions).toEqual(['attendance.mark', 'student.create', 'users.import']);
    expect(actions).not.toContain('auth.login');
  });

  it('reports the actor role, which the view could not previously show', async () => {
    const items = await inOak(() => fetchLogs(actorFor('ADMIN')));
    const roles = [...new Set(items.map((i) => i.actorRole))].sort();
    expect(roles).toEqual(['ADMIN', 'TEACHER']);
  });

  it('returns the newest first', async () => {
    const items = await inOak(() => fetchLogs(actorFor('ADMIN')));
    const times = items.map((i) => new Date(i.createdAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });
});

describe('every staff role appears in the default view', () => {
  /**
   * The default was pinned to TEACHER and ADMIN, so a payment registered by
   * Finance — the entry an audit is most often opened for — was recorded and
   * then invisible unless the reader already knew to filter by that role.
   */
  it('shows a Finance payment action without asking for it by role', async () => {
    const finance = await inOak(() => makeProfile('FINANCE', 'A Cashier'));
    await inOak(() => AuditLog.create({
      actorProfileId: finance._id,
      action: 'fees.payment.submit',
      entityType: 'Payment',
      createdAt: new Date('2026-03-13T10:00:00Z'),
    }));

    const items = await inOak(() => fetchLogs(actorFor('ADMIN')));
    expect(items.map((i) => i.action)).toContain('fees.payment.submit');
  });

  it('still leaves the family roles out of the default view', async () => {
    const items = await inOak(() => fetchLogs(actorFor('ADMIN')));
    expect(items.map((i) => i.action)).not.toContain('auth.login');
  });

  it('shows an admin approving a payment, with the actor named', async () => {
    await inOak(() => AuditLog.create({
      actorProfileId: adminProfile._id,
      action: 'fees.payment.approve',
      entityType: 'Payment',
      createdAt: new Date('2026-03-15T10:00:00Z'),
    }));

    const items = await inOak(() => fetchLogs(actorFor('ADMIN'), { action: 'fees.payment.approve' }));
    expect(items).toHaveLength(1);
    expect(items[0].actor ?? items[0].actorName).toBe('An Admin');
  });
});

describe('6. filtering', () => {
  it('by role — another role is reachable when asked for by name', async () => {
    const items = await inOak(() => fetchLogs(actorFor('ADMIN'), { roleKey: 'STUDENT' }));
    expect(items.map((i) => i.action)).toEqual(['auth.login']);
  });

  it('by role — teacher only', async () => {
    const items = await inOak(() => fetchLogs(actorFor('ADMIN'), { roleKey: 'TEACHER' }));
    expect(items.map((i) => i.action)).toEqual(['attendance.mark']);
  });

  it('by user', async () => {
    const items = await inOak(() =>
      fetchLogs(actorFor('ADMIN'), { actorProfileId: teacherProfile._id.toString() }));
    expect(items).toHaveLength(1);
    expect(items[0].actorName).toBe('A Teacher');
  });

  it('by action', async () => {
    const items = await inOak(() => fetchLogs(actorFor('ADMIN'), { action: 'student.create' }));
    expect(items).toHaveLength(1);
    expect(items[0].actorRole).toBe('ADMIN');
  });

  it('by date range', async () => {
    const items = await inOak(() =>
      fetchLogs(actorFor('ADMIN'), { from: '2026-03-11', to: '2026-03-13' }));
    expect(items.map((i) => i.action)).toEqual(['student.create']);
  });

  it('an unknown role filter returns nothing rather than everything', async () => {
    const items = await inOak(() => fetchLogs(actorFor('ADMIN'), { roleKey: 'NOT_A_ROLE' }));
    expect(items).toEqual([]);
  });
});

describe('8. the historical view', () => {
  it('by month', async () => {
    const march = await inOak(() => fetchLogs(actorFor('ADMIN'), { month: '2026-03' }));
    expect(march.map((i) => i.action).sort()).toEqual(['attendance.mark', 'student.create']);

    const february = await inOak(() => fetchLogs(actorFor('ADMIN'), { month: '2026-02' }));
    expect(february.map((i) => i.action)).toEqual(['users.import']);
  });

  it('by year', async () => {
    const items = await inOak(() => fetchLogs(actorFor('ADMIN'), { year: '2026' }));
    expect(items).toHaveLength(3);
    expect(await inOak(() => fetchLogs(actorFor('ADMIN'), { year: '2025' }))).toEqual([]);
  });

  it('rejects a malformed month rather than ignoring it', async () => {
    await expect(
      inOak(() => fetchLogs(actorFor('ADMIN'), { month: 'March' })),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_MONTH' });
  });
});

describe('9. import and export entries are for administrators', () => {
  it('an admin sees the import entry', async () => {
    const items = await inOak(() => fetchLogs(actorFor('ADMIN'), { month: '2026-02' }));
    expect(items.map((i) => i.action)).toContain('users.import');
  });

  it('a principal, who holds audit.read but not users.manage, does not', async () => {
    expect(actorFor('PRINCIPAL').permissions['audit.read']).toBe('ALL');
    expect(actorFor('PRINCIPAL').permissions['users.manage']).toBeUndefined();

    const items = await inOak(() => fetchLogs(actorFor('PRINCIPAL'), { month: '2026-02' }));
    expect(items).toEqual([]);
  });

  it('and cannot reach it by naming the action directly', async () => {
    const items = await inOak(() => fetchLogs(actorFor('PRINCIPAL'), { action: 'users.import' }));
    expect(items).toEqual([]);
  });
});

describe('4 & 5. school boundaries', () => {
  it('a School Admin sees only its own school', async () => {
    const items = await inOak(() => fetchLogs(actorFor('ADMIN')));
    expect(items).toHaveLength(3);

    const other = await inNvmp(() => fetchLogs(actorFor('ADMIN')));
    expect(other).toEqual([]); // the NVMP row has no actor profile, so no staff row
  });

  it('a School Admin cannot widen the view to another school with a role filter', async () => {
    // profileIdsForRole is scoped to the acting school, so an NVMP admin asking
    // for ADMIN activity gets NVMP's, never Oakridge's.
    const items = await inNvmp(() => fetchLogs(actorFor('ADMIN'), { roleKey: 'ADMIN' }));
    expect(items).toEqual([]);
  });

  it('a Super Admin acting on one school sees that school', async () => {
    const items = await inOak(() => fetchLogs(actorFor('SUPER_ADMIN')));
    expect(items).toHaveLength(3);
  });

  it('a Super Admin at platform level reads across schools', async () => {
    const items = await runAcrossSchools(() =>
      fetchLogs(actorFor('SUPER_ADMIN'), { actorProfileId: adminProfile._id.toString() }));
    expect(items.length).toBeGreaterThan(0);
  });
});
