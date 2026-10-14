import { describe, it, expect, beforeEach } from 'vitest';
import { seedSchool, inSchool, OAK } from './support/mcpSchool.js';
import { InstitutionProfile } from '../src/models/institution.model.js';
import { StudentGuardian, Student } from '../src/models/student.model.js';
import { RegulatoryReturn } from '../src/models/compliance.model.js';
import * as compliance from '../src/modules/compliance/compliance.service.js';
import * as documents from '../src/modules/compliance/documents.service.js';
import * as correspondence from '../src/modules/administration/correspondence.service.js';

/**
 * Printable official documents: on letterhead, marked DRAFT until approved,
 * honest about what is missing, and recorded every time they are exported.
 * EduOS never claims to have filed anything.
 */

let school;
const inOak = (fn) => inSchool(OAK, fn);

beforeEach(async () => {
  school = await seedSchool();
  await inOak(() => InstitutionProfile.create({
    displayName: 'Oakridge Academy', legalName: 'Oakridge Academy Senior Secondary School',
    legalEntity: { type: 'TRUST', name: 'Oakridge Education Trust', registrationNo: 'TR-123' },
    contact: { email: 'office@oakridge.example', phone: '+91 80 0000 0000' },
    affiliations: [{ body: 'CBSE', kind: 'BOARD', number: '830000', status: 'ACTIVE' }],
    campuses: [{ code: 'MAIN', name: 'Main campus', addressLine: '1 School Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001', udiseCode: '29000000000' }],
  }));
});

describe('returns as printable documents', () => {
  it('prints on letterhead with a DRAFT mark until the return is approved, and records the export', async () => {
    const r = await inOak(() => compliance.createReturn(school.people.ADMIN.actor, { template: 'STAFF_STRENGTH', period: '2026-27' }));
    const doc = await inOak(() => documents.returnDocument(school.people.PRINCIPAL.actor, r.id));
    expect(doc.letterhead).toMatchObject({ name: 'Oakridge Academy Senior Secondary School', missing: [] });
    expect(doc.letterhead.codes).toEqual(['CBSE Affiliation No. 830000', 'UDISE+ Code 29000000000']);
    expect(doc.letterhead.managedBy).toBe('Managed by Oakridge Education Trust (Reg. No. TR-123)');
    expect(doc.watermark).toMatch(/^DRAFT/);
    expect(doc.signatories.map((s) => s.role)).toEqual(['Prepared by', 'Verified by', 'Principal']);
    expect(doc.signatories[2].seal).toBe(true);
    expect(doc.filingNote).toMatch(/does not submit/);
    expect(doc.sections[0].rows.at(-1)).toMatchObject({ role: 'Total', isTotal: true });

    await inOak(() => RegulatoryReturn.updateOne({ _id: r.id }, { $set: { status: 'APPROVED_FOR_SUBMISSION' } }));
    expect((await inOak(() => documents.returnDocument(school.people.PRINCIPAL.actor, r.id))).watermark).toBeNull();
    const stored = await inOak(() => RegulatoryReturn.findById(r.id).lean());
    expect(stored.history.filter((h) => h.action === 'EXPORTED')).toHaveLength(2);
  });

  it('says what the letterhead is missing instead of printing a blank', async () => {
    await inOak(() => InstitutionProfile.deleteMany({}));
    await inOak(() => InstitutionProfile.create({ displayName: 'Oakridge Academy' }));
    const head = await inOak(() => documents.letterhead());
    expect(head.missing).toEqual(['address', 'affiliation number or UDISE+/AISHE code']);
  });

  it('builds a board candidate list with the details boards ask for, and flags what is missing', async () => {
    await inOak(() => Student.updateMany({}, { $set: { dob: new Date('2012-05-01'), gender: 'F' } }));
    const r = await inOak(() => compliance.createReturn(school.people.ADMIN.actor, { template: 'BOARD_CANDIDATE_LIST', period: 'Class 6' }));
    expect(r.data.total).toBe(4);
    expect(r.data.candidates[0]).toMatchObject({ sno: 1, section: 'A' });
    const rahul = r.data.candidates.find((c) => c.admissionNo === 'OAK-1');
    expect(rahul.father).toBe('PARENT user');
    // Mothers are not recorded for anyone in the fixture, and three have no father either.
    expect(r.validation.map((v) => v.message)).toEqual(expect.arrayContaining(['3 candidate(s) have no father\'s name recorded.', '4 candidate(s) have no mother\'s name recorded.']));
    const doc = await inOak(() => documents.returnDocument(school.people.PRINCIPAL.actor, r.id));
    expect(doc.sections[0].columns.map((c) => c.label)).toContain('Date of birth');
    expect(doc.findings.errors.length).toBeGreaterThan(0);

    await expect(inOak(() => compliance.createReturn(school.people.ADMIN.actor, { template: 'BOARD_CANDIDATE_LIST', period: 'Class 99' }))).rejects.toMatchObject({ code: 'NO_SUCH_CLASS' });
    expect(await inOak(() => StudentGuardian.countDocuments())).toBe(1);
  });

  it('drafts the mandatory disclosure from the profile, and lists what EduOS cannot fill', async () => {
    const r = await inOak(() => compliance.createReturn(school.people.ADMIN.actor, { template: 'MANDATORY_DISCLOSURE', period: '2026-27' }));
    const general = Object.fromEntries(r.data.disclosure[0].items);
    expect(general).toMatchObject({ 'Affiliation number': '830000', 'UDISE+ code': '29000000000', 'Managed by': 'Oakridge Education Trust' });
    expect(r.validation.map((v) => v.message).join(' ')).toMatch(/Results, fee structure and staff qualification/);
  });
});

describe('letters as printable documents', () => {
  it('prints the latest draft on letterhead, marked DRAFT until approved, and needs a draft to exist', async () => {
    const c = await inOak(() => correspondence.register(school.people.ADMIN.actor, {
      direction: 'INWARD', counterpartyType: 'BOARD', counterpartyName: 'Regional Officer, CBSE', subject: 'Verification of affiliation records', theirReference: 'CBSE/RO/2026/77', receivedOn: '2026-10-01',
    }));
    await expect(inOak(() => documents.correspondenceDocument(school.people.PRINCIPAL.actor, 'ALL', c.id))).rejects.toMatchObject({ code: 'NO_DRAFT' });
    await inOak(() => correspondence.saveDraft(school.people.ADMIN.actor, 'ALL', c.id, { body: 'With reference to your letter, the records are enclosed.' }));
    const letter = await inOak(() => documents.correspondenceDocument(school.people.PRINCIPAL.actor, 'ALL', c.id));
    expect(letter).toMatchObject({ kind: 'LETTER', to: 'Regional Officer, CBSE', subject: 'Reply: Verification of affiliation records', theirReference: 'CBSE/RO/2026/77' });
    expect(letter.body).toMatch(/records are enclosed/);
    expect(letter.watermark).toMatch(/^DRAFT/);
  });
});
