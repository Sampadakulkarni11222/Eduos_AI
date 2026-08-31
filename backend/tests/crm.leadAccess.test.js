import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Lead } from '../src/models/lead.model.js';
import { Account } from '../src/models/account.model.js';
import { Profile } from '../src/models/profile.model.js';
import { Role } from '../src/models/role.model.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { requirePermission } from '../src/middleware/permission.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import * as admissions from '../src/modules/admissions/admission.service.js';

/**
 * Who may reach the admissions pipeline, and who a lead may be handed to.
 *
 * The assignee used to be written straight through from the request body with
 * no check at all, so a lead could be handed to a profile in another school —
 * Profile is not tenant-scoped, because sign-in has to see across schools — or
 * to someone with no CRM access, and it then sat in nobody's queue.
 */

const OAK = 'oakridge';
const NVMP = 'nvmp';
const inOak = (fn) => runWithTenant(OAK, fn);
const inNvmp = (fn) => runWithTenant(NVMP, fn);

const grantsFor = (roleKey) => SYSTEM_ROLES.find((r) => r.key === roleKey).grants;
const permsOf = (roleKey) => buildPermissionMap({ permissions: grantsFor(roleKey) });

const canReach = (roleKey, permissionKey) => {
  const req = { actor: { roleKey, permissions: permsOf(roleKey) } };
  try {
    requirePermission(permissionKey)(req, {}, () => {});
    return true;
  } catch {
    return false;
  }
};

const roleDocs = new Map();
let oakAdmin;
let oakTeacher;
let nvmpAdmin;
let oakLead;
let nvmpLead;

/** A profile holding `roleKey` in the given school. */
const makeProfile = async (roleKey, displayName, tenantId) => {
  const account = await Account.create({
    phoneE164: `+9197${Math.floor(Math.random() * 90000000) + 10000000}`,
  });
  return Profile.create({
    accountId: account._id, roleId: roleDocs.get(roleKey)._id,
    displayName, tenantId, tenantName: tenantId,
  });
};

const newLead = (childName) => Lead.create({
  childName, guardianName: `${childName} Guardian`, phone: '+919800000001', stage: 'NEW',
});

beforeEach(async () => {
  roleDocs.clear();
  for (const r of SYSTEM_ROLES) {
    roleDocs.set(r.key, await Role.create({ key: r.key, name: r.name, isSystem: true, permissions: r.grants }));
  }

  oakAdmin = await makeProfile('ADMIN', 'Oak Admin', OAK);
  oakTeacher = await makeProfile('TEACHER', 'Oak Teacher', OAK);
  nvmpAdmin = await makeProfile('ADMIN', 'NVMP Admin', NVMP);

  oakLead = await inOak(() => newLead('Oak Child'));
  nvmpLead = await inNvmp(() => newLead('NVMP Child'));
});

describe('6 & 9. who may reach the CRM at all', () => {
  it.each(['ADMIN', 'SUPER_ADMIN'])('%s holds the admissions permissions', (roleKey) => {
    expect(canReach(roleKey, 'admissions.read')).toBe(true);
    expect(canReach(roleKey, 'admissions.manage')).toBe(true);
  });

  it.each(['TEACHER', 'STUDENT', 'PARENT', 'PRINCIPAL', 'FINANCE', 'LIBRARIAN', 'WARDEN'])(
    '%s is refused the CRM', (roleKey) => {
      expect(canReach(roleKey, 'admissions.read'), roleKey).toBe(false);
      expect(canReach(roleKey, 'admissions.manage'), roleKey).toBe(false);
    });
});

describe('1. available and assigned leads are distinguishable', () => {
  it('an unassigned lead reports no assignee', async () => {
    const pipeline = await inOak(() => admissions.getPipeline());
    const card = pipeline.byStage.NEW.find((l) => l.childName === 'Oak Child');
    expect(card.assigneeProfileId).toBeNull();
    expect(card.assigneeName).toBeNull();
  });

  it('an assigned lead names its owner on the board', async () => {
    await inOak(() => admissions.updateLead({
      leadId: oakLead._id.toString(),
      assigneeProfileId: oakAdmin._id.toString(),
      actorProfileId: oakAdmin._id.toString(),
    }));

    const pipeline = await inOak(() => admissions.getPipeline());
    const card = pipeline.byStage.NEW.find((l) => l.childName === 'Oak Child');
    expect(String(card.assigneeProfileId)).toBe(oakAdmin._id.toString());
    expect(card.assigneeName).toBe('Oak Admin');
  });

  it('an assignment can be cleared, returning the lead to the available pool', async () => {
    const leadId = oakLead._id.toString();
    const actorProfileId = oakAdmin._id.toString();
    await inOak(() => admissions.updateLead({ leadId, assigneeProfileId: oakAdmin._id.toString(), actorProfileId }));
    await inOak(() => admissions.updateLead({ leadId, assigneeProfileId: null, actorProfileId }));

    const pipeline = await inOak(() => admissions.getPipeline());
    expect(pipeline.byStage.NEW.find((l) => l.childName === 'Oak Child').assigneeProfileId).toBeNull();
  });
});

describe('7. lead assignment is authorized', () => {
  const assignTo = (assigneeProfileId) => inOak(() => admissions.updateLead({
    leadId: oakLead._id.toString(),
    assigneeProfileId,
    actorProfileId: oakAdmin._id.toString(),
  }));

  it('accepts a colleague in the same school who can work the CRM', async () => {
    const lead = await assignTo(oakAdmin._id.toString());
    expect(String(lead.assigneeProfileId)).toBe(oakAdmin._id.toString());
  });

  it('refuses an admin belonging to another school', async () => {
    await expect(assignTo(nvmpAdmin._id.toString()))
      .rejects.toMatchObject({ statusCode: 403, code: 'INVALID_ASSIGNEE' });
  });

  it('refuses someone in this school with no CRM access', async () => {
    await expect(assignTo(oakTeacher._id.toString()))
      .rejects.toMatchObject({ statusCode: 403, code: 'INVALID_ASSIGNEE' });
  });

  it('refuses a profile id that names nobody', async () => {
    await expect(assignTo(new mongoose.Types.ObjectId().toString()))
      .rejects.toMatchObject({ statusCode: 403, code: 'INVALID_ASSIGNEE' });
  });

  it('refuses a malformed id rather than throwing a cast error', async () => {
    await expect(assignTo('not-an-object-id'))
      .rejects.toMatchObject({ statusCode: 403, code: 'INVALID_ASSIGNEE' });
  });

  it('leaves the lead unassigned when the assignment is refused', async () => {
    await assignTo(oakTeacher._id.toString()).catch(() => {});
    const fresh = await inOak(() => Lead.findById(oakLead._id).lean());
    expect(fresh.assigneeProfileId ?? null).toBeNull();
  });
});

describe('4, 5 & 8. school boundaries', () => {
  it('a School Admin pipeline holds only its own school leads', async () => {
    const oak = await inOak(() => admissions.getPipeline());
    const nvmp = await inNvmp(() => admissions.getPipeline());

    expect(oak.byStage.NEW.map((l) => l.childName)).toEqual(['Oak Child']);
    expect(nvmp.byStage.NEW.map((l) => l.childName)).toEqual(['NVMP Child']);
  });

  it('a School Admin cannot open another school lead by id', async () => {
    await expect(
      inOak(() => admissions.getLeadById(nvmpLead._id.toString())),
    ).rejects.toThrow('Lead not found');
  });

  it('a School Admin cannot update another school lead by id', async () => {
    await expect(
      inOak(() => admissions.updateLead({
        leadId: nvmpLead._id.toString(), stage: 'LOST', actorProfileId: oakAdmin._id.toString(),
      })),
    ).rejects.toThrow('Lead not found');

    const untouched = await inNvmp(() => Lead.findById(nvmpLead._id).lean());
    expect(untouched.stage).toBe('NEW');
  });

  it('a lead created in one school never appears in the other analytics', async () => {
    await inOak(() => admissions.createLead({
      childName: 'Second Oak', guardianName: 'G', phone: '+919800000002',
    }));

    const nvmp = await inNvmp(() => admissions.getPipeline());
    const allNvmpNames = Object.values(nvmp.byStage).flat().map((l) => l.childName);
    expect(allNvmpNames).toEqual(['NVMP Child']);
  });
});

describe('lead status is held to the existing enum', () => {
  const setStage = (stage) => inOak(() => admissions.updateLead({
    leadId: oakLead._id.toString(), stage, actorProfileId: oakAdmin._id.toString(),
  }));

  it.each(['NEW', 'CONTACTED', 'TOUR_SCHEDULED', 'APPLICATION', 'LOST'])(
    'accepts the real stage %s', async (stage) => {
      const lead = await setStage(stage);
      expect(lead.stage).toBe(stage);
    });

  it('refuses a stage the board has no column for', async () => {
    await expect(setStage('BANANA'))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_LEAD_STAGE' });
  });

  it('leaves the lead on its previous stage when refused', async () => {
    await setStage('CONTACTED');
    await setStage('BANANA').catch(() => {});
    expect((await inOak(() => Lead.findById(oakLead._id).lean())).stage).toBe('CONTACTED');
  });

  it('a refused stage never disappears from the pipeline', async () => {
    await setStage('BANANA').catch(() => {});
    const pipeline = await inOak(() => admissions.getPipeline());
    const names = Object.values(pipeline.byStage).flat().map((l) => l.childName);
    expect(names).toContain('Oak Child');
  });
});
