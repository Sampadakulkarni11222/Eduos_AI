import { describe, it, expect, beforeEach } from 'vitest';
import { seedRoles, seedPerson, inSchool, OAK, RIVER } from './support/mcpSchool.js';
import * as accreditation from '../src/modules/compliance/accreditation.service.js';
import * as academics from '../src/modules/academics/academics.service.js';

/**
 * Accreditation preparation: the checklist is honest about where its headings
 * came from, an item is ready only with proof, an owner can work on their own
 * item and nobody else's, and a submission is something a person records.
 */

let people;
const inOak = (fn) => inSchool(OAK, fn);
const proof = [{ name: 'Syllabus 2026.pdf', url: '/uploads/syllabus-2026.pdf' }];

beforeEach(async () => {
  const roles = await seedRoles();
  people = {};
  for (const key of ['COMPLIANCE', 'TEACHER', 'PRINCIPAL']) people[key] = await seedPerson({ roleKey: key, roleId: roles[key], displayName: `${key} person` });
  people.OTHER_TEACHER = await seedPerson({ roleKey: 'TEACHER', roleId: roles.TEACHER, displayName: 'Another teacher' });
  people.RIVER = await seedPerson({ roleKey: 'COMPLIANCE', roleId: roles.COMPLIANCE, tenantId: RIVER });
});

const newCycle = (framework = 'NAAC') => inOak(() => accreditation.createCycle(people.COMPLIANCE.actor, { framework, title: `${framework} cycle 2027`, targetDate: '2027-03-31' }));

describe('accreditation cycles', () => {
  it('starts from headings only, and says they have not been checked against the current manual', async () => {
    const cycle = await newCycle('NAAC');
    expect(cycle.criteria.map((c) => c.code)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']);
    expect(cycle.criteria.every((c) => c.items.length === 0)).toBe(true);
    expect(cycle.templateVerified).toBe(false);
    expect(cycle.templateNote).toMatch(/check the current manual/i);
    // Nothing planned yet is "not available", never 0% or 100%.
    expect(cycle.progress.readyPct).toBeNull();

    const checked = await inOak(() => accreditation.verifyTemplate(people.COMPLIANCE.actor, cycle.id, { note: 'Checked against the 2026 manual' }));
    expect(checked.templateVerified).toBe(true);
    // A custom framework has no template to verify.
    expect((await newCycle('CUSTOM')).templateVerified).toBe(true);
  });

  it('marks an item ready only with evidence, and un-readies it if the evidence is removed', async () => {
    const cycle = await newCycle();
    const withItem = await inOak(() => accreditation.addItem(people.COMPLIANCE.actor, cycle.id, cycle.criteria[0].id, { metric: 'Curriculum revised in the last five years', ownerProfileId: people.TEACHER.actor.profileId }));
    const item = withItem.criteria[0].items[0];
    expect(item).toMatchObject({ status: 'NOT_STARTED', ownerName: 'TEACHER person' });

    await expect(inOak(() => accreditation.updateItem(people.TEACHER.actor, cycle.id, item.id, { status: 'READY' }))).rejects.toMatchObject({ code: 'EVIDENCE_REQUIRED' });
    const ready = await inOak(() => accreditation.updateItem(people.TEACHER.actor, cycle.id, item.id, { evidence: proof, status: 'READY' }));
    expect(ready.progress).toMatchObject({ ready: 1, counted: 1, readyPct: 100 });

    const stripped = await inOak(() => accreditation.updateItem(people.COMPLIANCE.actor, cycle.id, item.id, { evidence: [] }));
    expect(stripped.criteria[0].items[0].status).toBe('IN_PROGRESS');
    expect(stripped.progress.readyPct).toBe(0);
  });

  it('lets the owner work on their own item, and nobody else without compliance.manage', async () => {
    const cycle = await newCycle();
    const withItem = await inOak(() => accreditation.addItem(people.COMPLIANCE.actor, cycle.id, cycle.criteria[1].id, { metric: 'Student-teacher ratio', ownerProfileId: people.TEACHER.actor.profileId }));
    const item = withItem.criteria[1].items[0];

    await expect(inOak(() => accreditation.updateItem(people.OTHER_TEACHER.actor, cycle.id, item.id, { note: 'mine now' }))).rejects.toMatchObject({ code: 'NOT_ITEM_OWNER' });
    // The owner can add a note, but cannot rewrite what was asked of them or hand it to someone else.
    const out = await inOak(() => accreditation.updateItem(people.TEACHER.actor, cycle.id, item.id, { note: 'Collecting figures', metric: 'Something easier', ownerProfileId: people.OTHER_TEACHER.actor.profileId }));
    expect(out.criteria[1].items[0]).toMatchObject({ note: 'Collecting figures', metric: 'Student-teacher ratio', ownerName: 'TEACHER person' });

    expect(await inOak(() => accreditation.myItems(people.TEACHER.actor))).toHaveLength(1);
    expect(await inOak(() => accreditation.myItems(people.OTHER_TEACHER.actor))).toHaveLength(0);
  });

  it('needs a reason to rule an item out, and leaves it out of the completeness figure', async () => {
    const cycle = await newCycle();
    let c = await inOak(() => accreditation.addItem(people.COMPLIANCE.actor, cycle.id, cycle.criteria[2].id, { metric: 'Research grants received' }));
    c = await inOak(() => accreditation.addItem(people.COMPLIANCE.actor, cycle.id, cycle.criteria[2].id, { metric: 'Extension activities' }));
    const [grants, extension] = c.criteria[2].items;
    await expect(inOak(() => accreditation.updateItem(people.COMPLIANCE.actor, cycle.id, grants.id, { status: 'NOT_APPLICABLE' }))).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    await inOak(() => accreditation.updateItem(people.COMPLIANCE.actor, cycle.id, grants.id, { status: 'NOT_APPLICABLE', note: 'Undergraduate college; no research programme.' }));
    const done = await inOak(() => accreditation.updateItem(people.COMPLIANCE.actor, cycle.id, extension.id, { evidence: proof, status: 'READY' }));
    expect(done.progress).toMatchObject({ items: 2, counted: 1, ready: 1, readyPct: 100 });
  });

  it('records a submission only with a reference, warns when evidence is incomplete, and then locks', async () => {
    const cycle = await newCycle();
    await expect(inOak(() => accreditation.recordSubmission(people.COMPLIANCE.actor, cycle.id, { reference: 'SSR-2027-001' }))).rejects.toMatchObject({ code: 'NOTHING_TO_SUBMIT' });
    const c = await inOak(() => accreditation.addItem(people.COMPLIANCE.actor, cycle.id, cycle.criteria[0].id, { metric: 'Feedback on curriculum' }));
    const item = c.criteria[0].items[0];

    await expect(inOak(() => accreditation.recordSubmission(people.COMPLIANCE.actor, cycle.id, {}))).rejects.toThrow(/reference/i);
    await expect(inOak(() => accreditation.recordSubmission(people.COMPLIANCE.actor, cycle.id, { reference: 'SSR-2027-001' }))).rejects.toMatchObject({ code: 'INCOMPLETE' });
    const sent = await inOak(() => accreditation.recordSubmission(people.COMPLIANCE.actor, cycle.id, { reference: 'SSR-2027-001', acknowledgeIncomplete: true }));
    expect(sent).toMatchObject({ status: 'SUBMITTED', submission: { reference: 'SSR-2027-001' } });

    await expect(inOak(() => accreditation.updateItem(people.COMPLIANCE.actor, cycle.id, item.id, { note: 'late edit' }))).rejects.toMatchObject({ code: 'CYCLE_LOCKED' });
    const closed = await inOak(() => accreditation.recordOutcome(people.COMPLIANCE.actor, cycle.id, { outcome: 'Accredited; report received.' }));
    expect(closed.status).toBe('CLOSED');
  });

  it('is invisible to another school', async () => {
    const cycle = await newCycle();
    expect(await inSchool(RIVER, () => accreditation.listCycles())).toEqual([]);
    await expect(inSchool(RIVER, () => accreditation.getCycle(cycle.id))).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('course credits', () => {
  it('stores credits on a subject, to the half credit, and leaves them empty when not given', async () => {
    const core = await inOak(() => academics.createSubject({ name: 'Data Structures', code: 'CS201', credits: '3.5' }));
    expect(core.credits).toBe(3.5);
    expect((await inOak(() => academics.createSubject({ name: 'Moral Science' }))).credits).toBeNull();
    await expect(inOak(() => academics.createSubject({ name: 'Bad', credits: 99 }))).rejects.toThrow(/between 0 and 40/);
  });
});
