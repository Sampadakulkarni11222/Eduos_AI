import { describe, it, expect, beforeEach } from 'vitest';
import { inSchool, OAK, seedSchool } from './support/mcpSchool.js';
import { RiskPrediction } from '../src/models/growthRisk.model.js';
import { Enrollment } from '../src/models/student.model.js';
import { query, read } from '../src/modules/risk/risk.service.js';

/**
 * The risk table's read path. It filters predictions to active enrolments
 * with an indexed $in and, when nothing filters or sorts on a joined column,
 * pages before joining. These pin the results that change must not alter:
 * which rows count, their order, paging, the joined columns and the summary.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);

beforeEach(async () => {
  s = await seedSchool();
  await inOak(async () => {
    const at = new Date();
    const p = (who, type, level, probability) => ({ enrollmentId: s[who].enrollment._id, type, level, probability, topFeatures: [{ feature: 'f', value: 1 }], computedAt: at });
    await RiskPrediction.create([
      p('rahul', 'ATTENDANCE', 'HIGH', 0.8),
      p('rahul', 'FEE_DEFAULT', 'MEDIUM', 0.5),
      p('priya', 'ATTENDANCE', 'LOW', 0.1),
      p('priya', 'FEE_DEFAULT', 'MEDIUM', 0.6),
      p('aman', 'ATTENDANCE', 'LOW', 0),
      p('riya', 'ATTENDANCE', 'MEDIUM', 0.45),
    ]);
    // Riya leaves: her prediction stays in the collection but must not be shown or counted.
    await Enrollment.updateOne({ _id: s.riya.enrollment._id }, { $set: { status: 'TRANSFERRED' } });
  });
});

describe('risk table read path', () => {
  it('shows only active enrolments, highest level then probability first', async () => {
    const r = await inOak(() => query({}));
    expect(r.total).toBe(5);
    expect(r.items.map((i) => [i.type, i.level, i.probability])).toEqual([
      ['ATTENDANCE', 'HIGH', 0.8], ['FEE_DEFAULT', 'MEDIUM', 0.6], ['FEE_DEFAULT', 'MEDIUM', 0.5], ['ATTENDANCE', 'LOW', 0.1], ['ATTENDANCE', 'LOW', 0],
    ]);
    expect(r.items[0]).toMatchObject({ studentId: String(s.rahul.student._id), studentName: 'Rahul Sharma', sectionId: String(s.sectionA._id) });
    expect(r.items[0].class).toMatch(/A$/);
    expect(r.summary).toMatchObject({ activeEnrollments: 3, signalsEvaluated: 5, flaggedSignals: 3, flaggedStudents: 2, studentsAtHighRisk: 1, studentsAtMediumRisk: 2, clearStudents: 1 });
    expect(r.counts).toEqual({ HIGH: 1, MEDIUM: 2, LOW: 2 });
    expect(r.summary.byCategory).toEqual({ ATTENDANCE: 1, FEE_DEFAULT: 2 });
    expect(r.computedAt).toBeTruthy();
  });

  it('pages, clamps a page past the end, and filters by probability and level', async () => {
    const p2 = await inOak(() => query({ pageSize: 2, page: 2 }));
    expect(p2).toMatchObject({ total: 5, page: 2, pageSize: 2, totalPages: 3 });
    expect(p2.items.map((i) => i.probability)).toEqual([0.5, 0.1]);
    const past = await inOak(() => query({ pageSize: 2, page: 99 }));
    expect(past.page).toBe(3);
    expect(past.items.map((i) => i.probability)).toEqual([0]);
    const min = await inOak(() => query({ minProbability: 0.4, pageSize: 6 }));
    expect(min.total).toBe(3);
    const med = await inOak(() => query({ level: 'medium' }));
    expect(med.items.map((i) => i.probability)).toEqual([0.6, 0.5]);
  });

  it('sorts and searches on the joined student and class columns', async () => {
    const byName = await inOak(() => query({ sortBy: 'student', sortDir: 'asc' }));
    const names = byName.items.map((i) => i.studentName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    const search = await inOak(() => query({ search: 'priya' }));
    expect(search.total).toBe(2);
    expect(new Set(search.items.map((i) => i.studentId))).toEqual(new Set([String(s.priya.student._id)]));
  });

  it('serves the persisted predictions without rescoring while they are fresh', async () => {
    const before = await inOak(() => RiskPrediction.countDocuments());
    const r = await inOak(() => read({ pageSize: 6 }));
    expect(r.total).toBe(5);
    expect(await inOak(() => RiskPrediction.countDocuments())).toBe(before);
  });
});
