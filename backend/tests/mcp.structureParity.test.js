import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mcpToolsFor } from '../src/modules/ai/mcp/registry.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { StudentGuardian } from '../src/models/student.model.js';
import { AcademicYear, Term } from '../src/models/academics.model.js';
import { PaymentChangeRequest } from '../src/models/fee.model.js';
import * as fees from '../src/modules/fees/fee.service.js';
import { seedSchool, actorForRole, mcp, proposeAndConfirm, inSchool, OAK, RIVER } from './support/mcpSchool.js';

/**
 * The web operations the role audit of 2026-09-24 found with no capability.
 *
 * Each had a single-row web route whose permission was already "covered" by a
 * neighbouring tool — create_section covered academics.structure.manage,
 * list_guardians covered students, decide_payment_change_request covered the
 * change-request flow — so permission-level coverage reported nothing missing.
 * The CSV imports beside them stay web-only.
 *
 * The execute / outsider / wrong-school matrix for these tools lives in
 * mcp.writes.coverage.test.js; this file holds the rules specific to them.
 */

let school;
beforeEach(async () => {
  school = await seedSchool();
});
afterAll(async () => {
  await resetMcpClient();
});

const NEW_TOOLS = {
  create_academic_year: ['ADMIN', 'PRINCIPAL'],
  create_term: ['ADMIN', 'PRINCIPAL'],
  create_grade: ['ADMIN', 'PRINCIPAL'],
  create_subject: ['ADMIN', 'PRINCIPAL'],
  add_guardian: ['ADMIN'],
  request_payment_change: ['ADMIN', 'FINANCE'],
};
const ROLES = ['ADMIN', 'PRINCIPAL', 'TEACHER', 'STUDENT', 'PARENT', 'FINANCE', 'LIBRARIAN', 'WARDEN', 'SUPER_ADMIN'];

describe('offered to exactly the roles whose web route admits them', () => {
  for (const [tool, holders] of Object.entries(NEW_TOOLS)) {
    it(tool, () => {
      const offered = ROLES.filter((r) => mcpToolsFor(actorForRole(r)).some((t) => t.name === tool));
      expect(offered.sort()).toEqual([...holders].sort());
    });
  }
});

describe('the records they name must belong to this school', () => {
  it('a guardian profile from another school is not linked', async () => {
    const { done } = await proposeAndConfirm(OAK, school.people.ADMIN.actor, 'add_guardian', {
      admissionNo: 'OAK-3', guardianProfileId: school.people.RIVER_ADMIN.actor.profileId, relation: 'GUARDIAN',
    });
    expect(done.success).toBe(false);
    expect(await inSchool(OAK, () => StudentGuardian.countDocuments({ studentId: school.aman.student._id }))).toBe(0);
  }, 60000);

  it('a guardian already linked is refused, not duplicated', async () => {
    const { done } = await proposeAndConfirm(OAK, school.people.ADMIN.actor, 'add_guardian', {
      admissionNo: 'OAK-1', guardianProfileId: school.people.PARENT.actor.profileId, relation: 'FATHER',
    });
    expect(done.success).toBe(false);
    expect(await inSchool(OAK, () => StudentGuardian.countDocuments({ studentId: school.rahul.student._id }))).toBe(1);
  }, 60000);

  it('a term cannot be put in another school\'s academic year', async () => {
    const riverYear = await inSchool(RIVER, () => AcademicYear.create({
      name: 'River 2030-31', startsOn: new Date('2026-04-01'), endsOn: new Date('2027-03-31'),
    }));
    const { done } = await proposeAndConfirm(OAK, school.people.ADMIN.actor, 'create_term', {
      academicYearId: String(riverYear._id), name: 'Term 9', startsOn: '2026-04-01', endsOn: '2026-09-30',
    });
    expect(done.success).toBe(false);
    expect(await inSchool(OAK, () => Term.countDocuments({ name: 'Term 9' }))).toBe(0);
  }, 60000);
});

describe('a payment change request follows the web\'s rules', () => {
  it('is refused on a payment still awaiting approval — that one is corrected directly', async () => {
    const { payment } = await inSchool(OAK, () => fees.recordPayment(school.people.FINANCE.actor, 'ALL', {
      invoiceId: school.inv1._id, amountPaise: 100000, mode: 'CASH',
    }));
    const { done } = await proposeAndConfirm(OAK, school.people.FINANCE.actor, 'request_payment_change', {
      paymentId: String(payment._id), field: 'notes', requestedValue: 'x', reason: 'typo',
    });
    expect(done.success).toBe(false);
    expect(await inSchool(OAK, () => PaymentChangeRequest.countDocuments({ paymentId: payment._id }))).toBe(0);
  }, 60000);

  it('does not change the payment itself', async () => {
    const { payment } = await inSchool(OAK, () => fees.recordPayment(school.people.ADMIN.actor, 'ALL', {
      invoiceId: school.inv1._id, amountPaise: 100000, mode: 'CASH',
    }));
    const { done } = await proposeAndConfirm(OAK, school.people.FINANCE.actor, 'request_payment_change', {
      paymentId: String(payment._id), field: 'receiptNo', requestedValue: 'R-9', reason: 'wrong book',
    });
    expect(done.success, JSON.stringify(done.error ?? {})).toBe(true);
    const { Payment } = await import('../src/models/fee.model.js');
    const after = await inSchool(OAK, () => Payment.findById(payment._id).lean());
    expect(after.receiptNo ?? null).not.toBe('R-9');
  }, 60000);
});
