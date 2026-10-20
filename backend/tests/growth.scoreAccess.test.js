import { describe, it, expect, beforeEach } from 'vitest';
import { seedSchool, inSchool, OAK } from './support/mcpSchool.js';
import { canReadScore } from '../src/modules/growth/growth.routes.js';

/**
 * Who may read a growth score: school-wide readers see anyone; a reader at OWN
 * scope only their own pupils (a teacher's sections, a student's own record);
 * a parent only their own child.
 */
let s;
beforeEach(async () => { s = await seedSchool(); });

const check = (actor, enrollmentId) => inSchool(OAK, () => new Promise((resolve) => {
  canReadScore({ actor, query: { enrollmentId: String(enrollmentId) } }, {}, (err) => resolve(err ?? null));
}));
const withInsights = (actor, scope) => ({ ...actor, permissions: { ...actor.permissions, 'ai.insights.read': scope } });

describe('growth score access', () => {
  it('lets a school-wide reader see any student', async () => {
    expect(await check(withInsights(s.people.PRINCIPAL.actor, 'ALL'), s.riya.enrollment._id)).toBeNull();
  });

  it('limits an OWN-scope teacher to sections they teach', async () => {
    const teacher = withInsights(s.people.TEACHER.actor, 'OWN');
    expect(await check(teacher, s.rahul.enrollment._id)).toBeNull();
    expect(await check(teacher, s.riya.enrollment._id)).toMatchObject({ statusCode: 403, code: 'OUT_OF_SCOPE' });
  });

  it('limits an OWN-scope student to their own record', async () => {
    const student = withInsights(s.people.STUDENT.actor, 'OWN');
    expect(await check(student, s.priya.enrollment._id)).toBeNull();
    expect(await check(student, s.rahul.enrollment._id)).toMatchObject({ statusCode: 403 });
  });

  it('limits a parent to their own child', async () => {
    const parent = { ...s.people.PARENT.actor, permissions: { 'analytics.child.read': 'OWN' } };
    expect(await check(parent, s.rahul.enrollment._id)).toBeNull();
    expect(await check(parent, s.riya.enrollment._id)).toMatchObject({ statusCode: 403, code: 'NOT_YOUR_CHILD' });
  });
});
