import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Document } from '../src/models/document.model.js';
import * as documents from '../src/modules/documents/document.service.js';
import { seedSchool, inSchool, OAK, RIVER } from './support/mcpSchool.js';

/**
 * Course-material writes, at the service layer.
 *
 * These rules moved out of document.controller.js in Phase 4 precisely so they
 * would hold for every caller rather than for HTTP alone — MCP does not pass
 * through a controller. Testing them through a tool would therefore prove the
 * wrong thing: it would show the wrapper behaving, not the rule holding. So
 * these call document.service directly, which is the boundary every caller
 * meets.
 *
 * One test deliberately records a gap rather than asserting a fix (see "a
 * school-wide caller and another school's section"). It is written to fail if
 * the behaviour changes, so the finding cannot quietly drift.
 */

let school;
beforeEach(async () => {
  school = await seedSchool();
});

const teacher = () => school.people.TEACHER.actor;
const admin = () => school.people.ADMIN.actor;
const ownSection = () => String(school.sectionA._id); // TEACHER is its class teacher
const foreignSection = () => String(school.sectionB._id); // nobody's class, not taught by TEACHER

const material = (over = {}) => ({ title: 'Chapter 4 notes', fileUrl: '/uploads/ch4.pdf', ...over });

/* ── CREATE ───────────────────────────────────────────────── */

describe('createForActor', () => {
  it('refuses an ID card, whatever the caller scope', async () => {
    for (const [actor, scope] of [[teacher(), 'OWN'], [admin(), 'ALL']]) {
      await expect(
        inSchool(OAK, () => documents.createForActor(actor, scope, material({ type: 'ID_CARD', sectionId: ownSection() }))),
      ).rejects.toMatchObject({ statusCode: 400 });
    }
  });

  it('forces a teacher\'s upload to course material, whatever type was asked for', async () => {
    const doc = await inSchool(OAK, () =>
      documents.createForActor(teacher(), 'OWN', material({ type: 'REPORT_CARD', sectionId: ownSection() })));
    expect(doc.type).toBe('CUSTOM');
  });

  it('requires a section from a teacher', async () => {
    await expect(
      inSchool(OAK, () => documents.createForActor(teacher(), 'OWN', material())),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuses a section the teacher does not teach', async () => {
    await expect(
      inSchool(OAK, () => documents.createForActor(teacher(), 'OWN', material({ sectionId: foreignSection() }))),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('takes the author from the actor, never from the payload', async () => {
    const doc = await inSchool(OAK, () => documents.createForActor(teacher(), 'OWN', material({
      sectionId: ownSection(),
      authorProfileId: String(school.people.ADMIN.profile._id),
    })));
    expect(String(doc.authorProfileId)).toBe(teacher().profileId);
    expect(String(doc.authorProfileId)).not.toBe(String(school.people.ADMIN.profile._id));
  });

  it('leaves a school-wide caller unrestricted, as it was before', async () => {
    const doc = await inSchool(OAK, () =>
      documents.createForActor(admin(), 'ALL', material({ type: 'REPORT_CARD', title: 'Term 1 report' })));
    expect(doc.type).toBe('REPORT_CARD');
    expect(doc.sectionId ?? null).toBeNull();
  });

  it('stamps the acting school on the document', async () => {
    const doc = await inSchool(OAK, () => documents.createForActor(teacher(), 'OWN', material({ sectionId: ownSection() })));
    expect(doc.tenantId).toBe(OAK);
  });

  it('a school-wide caller may file against any section of their own school', async () => {
    const doc = await inSchool(OAK, () =>
      documents.createForActor(admin(), 'ALL', material({ title: 'Class 6 B pack', sectionId: foreignSection() })));
    // foreignSection() is 6-B: not the teacher's, but the admin's school's.
    expect(String(doc.sectionId)).toBe(foreignSection());
    expect(doc.tenantId).toBe(OAK);
  });

  /**
   * The Phase 6 finding, now fixed.
   *
   * A school-wide caller could file a document in their own school against a
   * section belonging to a different one. Nothing crossed tenants — the row was
   * stamped with the caller's school — but the reference was meaningless and no
   * class-filtered read could ever match it. Section is tenant-scoped, so the
   * lookup in assertSectionInSchool() simply does not find another school's
   * section.
   */
  it('refuses another school\'s section to a school-wide caller, and writes nothing', async () => {
    const oakSection = ownSection();
    await expect(
      inSchool(RIVER, () => documents.createForActor(
        school.people.RIVER_ADMIN.actor, 'ALL', material({ title: 'Cross-school ref', sectionId: oakSection }),
      )),
    ).rejects.toMatchObject({ statusCode: 403, code: 'SECTION_NOT_IN_SCHOOL' });

    expect(await inSchool(RIVER, () => Document.countDocuments({ title: 'Cross-school ref' }))).toBe(0);
    expect(await inSchool(OAK, () => Document.countDocuments({ title: 'Cross-school ref' }))).toBe(0);
  });

  it('refuses another school\'s section to a teacher too', async () => {
    const riverSection = String(school.river.section._id);
    await expect(
      inSchool(OAK, () => documents.createForActor(teacher(), 'OWN', material({ sectionId: riverSection }))),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

/* ── UPDATE ───────────────────────────────────────────────── */

describe('updateForActor', () => {
  const ownMaterial = () => inSchool(OAK, () => Document.create({
    title: 'Chapter 1 notes', type: 'CUSTOM', fileUrl: '/uploads/ch1.pdf',
    authorProfileId: school.people.TEACHER.profile._id, sectionId: school.sectionA._id,
  }));

  it('is a 404 for a document that does not exist', async () => {
    const missing = String(new mongoose.Types.ObjectId());
    await expect(
      inSchool(OAK, () => documents.updateForActor(teacher(), 'OWN', missing, { title: 'x' })),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('refuses a teacher who did not write it', async () => {
    const doc = await inSchool(OAK, () => Document.create({
      title: 'The office circular', type: 'CUSTOM', fileUrl: '/uploads/office.pdf',
      authorProfileId: school.people.ADMIN.profile._id,
    }));
    await expect(
      inSchool(OAK, () => documents.updateForActor(teacher(), 'OWN', String(doc._id), { title: 'mine now' })),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('refuses anything that is not course material, even to its author', async () => {
    const doc = await inSchool(OAK, () => Document.create({
      title: 'Report card', type: 'REPORT_CARD', fileUrl: '/uploads/rc.pdf',
      authorProfileId: school.people.TEACHER.profile._id,
    }));
    await expect(
      inSchool(OAK, () => documents.updateForActor(teacher(), 'OWN', String(doc._id), { title: 'edited' })),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('re-checks the section when the material is moved', async () => {
    const doc = await ownMaterial();
    await expect(
      inSchool(OAK, () => documents.updateForActor(teacher(), 'OWN', String(doc._id), { sectionId: foreignSection() })),
    ).rejects.toMatchObject({ statusCode: 403 });

    const moved = await inSchool(OAK, () => documents.updateForActor(teacher(), 'OWN', String(doc._id), { sectionId: ownSection() }));
    expect(String(moved.sectionId)).toBe(ownSection());
  });

  it('writes only the fields on the allow-list', async () => {
    const doc = await ownMaterial();
    const updated = await inSchool(OAK, () => documents.updateForActor(teacher(), 'OWN', String(doc._id), {
      title: 'Chapter 1 notes (revised)',
      // None of these may be written through an update.
      type: 'ID_CARD',
      authorProfileId: String(school.people.ADMIN.profile._id),
      tenantId: RIVER,
      studentId: String(school.rahul.student._id),
    }));
    expect(updated.title).toBe('Chapter 1 notes (revised)');
    expect(updated.type).toBe('CUSTOM');
    expect(String(updated.authorProfileId)).toBe(teacher().profileId);
    expect(updated.tenantId).toBe(OAK);
    expect(updated.studentId ?? null).toBeNull();
  });

  it('refuses a move to another school\'s section, leaving the document where it was', async () => {
    const doc = await ownMaterial();
    const riverSection = String(school.river.section._id);
    await expect(
      inSchool(OAK, () => documents.updateForActor(teacher(), 'OWN', String(doc._id), { sectionId: riverSection })),
    ).rejects.toMatchObject({ statusCode: 403, code: 'SECTION_NOT_IN_SCHOOL' });

    const after = await inSchool(OAK, () => Document.findById(doc._id).lean());
    expect(String(after.sectionId)).toBe(String(school.sectionA._id));
  });

  it('refuses a school-wide caller moving material to another school\'s section', async () => {
    const doc = await ownMaterial();
    const riverSection = String(school.river.section._id);
    await expect(
      inSchool(OAK, () => documents.updateForActor(admin(), 'ALL', String(doc._id), { sectionId: riverSection })),
    ).rejects.toMatchObject({ statusCode: 403, code: 'SECTION_NOT_IN_SCHOOL' });
  });

  it('cannot reach a document in another school', async () => {
    const doc = await ownMaterial();
    await expect(
      inSchool(RIVER, () => documents.updateForActor(school.people.RIVER_ADMIN.actor, 'ALL', String(doc._id), { title: 'theirs' })),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
