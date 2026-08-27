import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { Student } from '../src/models/student.model.js';
import { Counter } from '../src/models/counter.model.js';
import { Lead } from '../src/models/lead.model.js';
import { nextSequence } from '../src/utils/sequence.js';
import { updateLead } from '../src/modules/admissions/admission.service.js';

/**
 * Covers ISS-003 from docs/ISSUES.md: admission numbers derived from
 * countDocuments() raced, cost a collection scan each time, and the retry loop
 * fell through after 100 attempts to create a student with a number it already
 * knew was taken.
 */

const YEAR = new Date().getFullYear();
const PADDED = (n) => `ADM-${YEAR}-${String(n).padStart(4, '0')}`;

const makeLead = (overrides = {}) =>
  Lead.create({
    childName: 'Test Child',
    guardianName: 'Test Guardian',
    phone: `+9199${Math.floor(1_0000000 + Math.random() * 8_999999)}`,
    stage: 'NEW',
    ...overrides,
  });

describe('nextSequence', () => {
  it('returns strictly increasing values', async () => {
    const seen = [];
    for (let i = 0; i < 5; i++) seen.push(await nextSequence('test:seq'));
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  it('never issues the same value twice under concurrency', async () => {
    const values = await Promise.all(Array.from({ length: 50 }, () => nextSequence('test:concurrent')));
    expect(new Set(values).size).toBe(50);
    expect(Math.max(...values)).toBe(50);
  });

  it('seeds from existing data only on first use', async () => {
    let seedCalls = 0;
    const seedWith = async () => { seedCalls += 1; return 41; };

    expect(await nextSequence('test:seeded', { seedWith })).toBe(42);
    expect(await nextSequence('test:seeded', { seedWith })).toBe(43);
    // Seeding is a one-time carry-over, not a per-call cost.
    expect(seedCalls).toBe(1);
  });

  it('keeps separate sequences independent', async () => {
    await nextSequence('test:a');
    await nextSequence('test:a');
    expect(await nextSequence('test:b')).toBe(1);
  });
});

describe('admission numbers — allocation', () => {
  it('issues a padded, year-scoped number on enrolment', async () => {
    const lead = await makeLead();
    await updateLead({ leadId: lead._id.toString(), stage: 'ENROLLED' });

    const student = await Student.findOne({ leadId: lead._id }).lean();
    expect(student).toBeTruthy();
    expect(student.admissionNo).toBe(PADDED(1));
  });

  it('does not re-create a student for a lead that already has one', async () => {
    const lead = await makeLead();
    await updateLead({ leadId: lead._id.toString(), stage: 'ENROLLED' });
    await updateLead({ leadId: lead._id.toString(), stage: 'ENROLLED' });

    expect(await Student.countDocuments({ leadId: lead._id })).toBe(1);
  });
});

describe('admission numbers — ISS-003: concurrency and continuity', () => {
  it('issues unique numbers when several leads enrol at once', async () => {
    const leads = await Promise.all(Array.from({ length: 12 }, (_, i) => makeLead({ childName: `Child ${i}` })));

    // The old implementation read countDocuments() per call; concurrent
    // callers all saw the same count and fought over the same number.
    await Promise.allSettled(
      leads.map((l) => updateLead({ leadId: l._id.toString(), stage: 'ENROLLED' }))
    );

    const students = await Student.find({}).select('admissionNo').lean();
    const numbers = students.map((s) => s.admissionNo);
    expect(students).toHaveLength(12);
    expect(new Set(numbers).size).toBe(12);
  });

  it('continues from existing numbering rather than restarting at 1', async () => {
    // Simulates a database created before counters existed.
    await Student.create({ admissionNo: PADDED(7), firstName: 'Legacy', status: 'ACTIVE' });
    await Student.create({ admissionNo: PADDED(31), firstName: 'Legacy', status: 'ACTIVE' });

    const lead = await makeLead();
    await updateLead({ leadId: lead._id.toString(), stage: 'ENROLLED' });

    const student = await Student.findOne({ leadId: lead._id }).lean();
    expect(student.admissionNo).toBe(PADDED(32));
  });

  it('ignores other years when seeding the counter', async () => {
    await Student.create({ admissionNo: `ADM-${YEAR - 1}-9999`, firstName: 'LastYear', status: 'ACTIVE' });

    const lead = await makeLead();
    await updateLead({ leadId: lead._id.toString(), stage: 'ENROLLED' });

    expect((await Student.findOne({ leadId: lead._id }).lean()).admissionNo).toBe(PADDED(1));
  });

  it('skips past a hand-entered number that collides with the sequence', async () => {
    // A number assigned by hand that the counter is about to reach.
    await Student.create({ admissionNo: PADDED(1), firstName: 'Manual', status: 'ACTIVE' });
    await Counter.create({ _id: `admissionNo:${YEAR}`, seq: 0 });

    const lead = await makeLead();
    await updateLead({ leadId: lead._id.toString(), stage: 'ENROLLED' });

    // Old behaviour: fall out of the retry loop and throw a raw E11000 as a 500.
    const student = await Student.findOne({ leadId: lead._id }).lean();
    expect(student.admissionNo).toBe(PADDED(2));
  });

  it('does not scan the students collection to pick a number', async () => {
    // countDocuments() was O(n) on every admission. Once the counter is warm,
    // allocation must not depend on how many students exist.
    await Counter.create({ _id: `admissionNo:${YEAR}`, seq: 5 });
    const spy = [];
    const original = Student.countDocuments.bind(Student);
    Student.countDocuments = (...args) => { spy.push(args); return original(...args); };

    try {
      const lead = await makeLead();
      await updateLead({ leadId: lead._id.toString(), stage: 'ENROLLED' });
      expect((await Student.findOne({ leadId: lead._id }).lean()).admissionNo).toBe(PADDED(6));
      expect(spy).toHaveLength(0);
    } finally {
      Student.countDocuments = original;
    }
  });
});
