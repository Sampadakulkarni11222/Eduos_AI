import { describe, it, expect, beforeEach } from 'vitest';
import { inSchool, OAK, RIVER } from './support/mcpSchool.js';
import { seedFamilySchool, ymdIn } from './support/familySchool.js';
import { DueItem } from '../src/models/dueItem.model.js';
import { MessageOutbox } from '../src/models/messaging.model.js';
import { SupportPlan } from '../src/models/supportPlan.model.js';
import { scan } from '../src/modules/risk/risk.service.js';
import * as plans from '../src/modules/support/support.service.js';

/**
 * Student support plans: opened from a rule-based risk signal with the
 * figures behind it, measurable goals whose review dates become tasks,
 * actions with owners, a family view that never carries internal notes or
 * the safeguarding flag, progress reviews, and closure with an outcome.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);
const scopeOf = (actor, key) => actor.permissions[key];

const goal = (over = {}) => ({ title: 'Attend school every day', measure: 'Attendance % over 4 weeks', unit: '%', baseline: 60, target: 90, reviewOn: ymdIn(14), ...over });

async function open(actor = s.people.TEACHER.actor, over = {}) {
  return inOak(() => plans.create(actor, scopeOf(actor, 'supportplans.manage'), {
    studentId: String(s.rahul.student._id), concernArea: 'ATTENDANCE', riskType: 'ATTENDANCE',
    summary: 'Rahul has missed several days this month. We will work together to get him to school every day.',
    goals: [goal()],
    actions: [{ title: 'Call home after any absence', ownerKind: 'STAFF', ownerProfileId: String(s.people.T2.profile._id), dueOn: ymdIn(3) }, { title: 'Morning routine chart at home', ownerKind: 'FAMILY' }],
    ...over,
  }));
}

beforeEach(async () => { s = await seedFamilySchool(); });

describe('opening a plan from the risk signals', () => {
  it('suggests students the risk module flags and records the figures behind the plan', async () => {
    await inOak(() => scan({ tenantId: OAK }));
    const T = s.people.TEACHER.actor;
    const sug = await inOak(() => plans.suggestions(T, 'OWN', {}));
    const rahul = sug.items.find((i) => i.studentId === String(s.rahul.student._id));
    expect(rahul).toMatchObject({ riskType: 'ATTENDANCE', concernArea: 'ATTENDANCE' });
    expect(rahul.evidence.label).toMatch(/Attendance 0%/);
    const plan = await open();
    expect(plan.refNo).toMatch(/^SSP\//);
    expect(plan.source.kind).toBe('RISK_SIGNAL');
    expect(plan.source.figures[0].label).toMatch(/Attendance, last 30 days/);
    // An open plan takes the student out of the suggestions.
    const again = await inOak(() => plans.suggestions(T, 'OWN', {}));
    expect(again.items.some((i) => i.studentId === String(s.rahul.student._id))).toBe(false);
  });

  it('refuses goals without a measurable target, clinical detail, duplicates and students the teacher does not teach', async () => {
    await expect(open(undefined, { goals: [{ title: 'Be happier', measure: 'feeling', reviewOn: ymdIn(7) }] })).rejects.toMatchObject({ code: 'GOAL_NOT_MEASURABLE' });
    await expect(open(undefined, { diagnosis: 'x' })).rejects.toMatchObject({ code: 'CLINICAL_NOT_ACCEPTED' });
    await open();
    await expect(open()).rejects.toMatchObject({ code: 'PLAN_EXISTS' });
    // T4 teaches no class.
    await expect(open(s.people.T4.actor, { concernArea: 'ACADEMIC' })).rejects.toMatchObject({ code: 'NOT_YOUR_STUDENT' });
    // Families cannot open plans.
    await expect(open(s.people.PARENT.actor)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('tasks, actions and reviews', () => {
  it('turns review dates and staff actions into tasks and resolves them as the plan moves on', async () => {
    const plan = await open();
    const items = await inOak(() => DueItem.find({ sourceKey: { $regex: `^supportplan:${plan.id}` } }).lean());
    expect(items).toHaveLength(2); // the review and the staff action (the family action is not a staff task)
    const review = items.find((i) => i.sourceKey.includes(':review:'));
    expect(String(review.ownerProfileId)).toBe(String(s.people.TEACHER.profile._id));
    const action = items.find((i) => i.sourceKey.includes(':action:'));
    expect(String(action.ownerProfileId)).toBe(String(s.people.T2.profile._id));
    expect(await inOak(() => MessageOutbox.countDocuments({ templateKey: 'SUPPORT_PLAN_ACTION' }))).toBeGreaterThan(0);

    // The action owner (who teaches the class) completes it.
    const staffAction = plan.actions.find((a) => a.ownerKind === 'STAFF');
    await inOak(() => plans.completeAction(s.people.T2.actor, 'OWN', plan.id, staffAction.id, { note: 'Called twice' }));
    expect((await inOak(() => DueItem.findOne({ sourceKey: action.sourceKey }).lean())).status).toBe('DONE');

    // A review with a new date replaces the review task.
    const reviewed = await inOak(() => plans.addReview(s.people.TEACHER.actor, 'OWN', plan.id, { familySummary: 'Attendance is improving: 4 of 5 days this week.', internalNote: 'Older sibling drops him; bus timing issue.', goalStatuses: [{ goalId: plan.goals[0].id, status: 'ON_TRACK' }], nextReviewOn: ymdIn(28) }));
    expect(reviewed.goals[0].status).toBe('ON_TRACK');
    const open1 = await inOak(() => DueItem.find({ sourceKey: { $regex: `^supportplan:${plan.id}:review:` }, status: 'OPEN' }).lean());
    expect(open1).toHaveLength(1);
    expect(open1[0].sourceKey).toContain(ymdIn(28));
    expect((await inOak(() => DueItem.findOne({ sourceKey: review.sourceKey }).lean())).status).toBe('DONE');

    // Closing resolves the last review task.
    const closed = await inOak(() => plans.close(s.people.TEACHER.actor, 'OWN', plan.id, { outcome: 'GOALS_MET', note: 'Attendance 94% for four weeks.' }));
    expect(closed.status).toBe('CLOSED');
    expect(await inOak(() => DueItem.countDocuments({ sourceKey: { $regex: `^supportplan:${plan.id}` }, status: 'OPEN' }))).toBe(0);
  });

  it('records progress against a goal and marks it met when the target is reached', async () => {
    const plan = await open();
    const out = await inOak(() => plans.recordProgress(s.people.TEACHER.actor, 'OWN', plan.id, plan.goals[0].id, { value: 92, note: 'Four weeks' }));
    expect(out.goals[0].status).toBe('MET');
    expect(out.goals[0].latest.value).toBe(92);
  });
});

describe('who sees what', () => {
  it('shows the family the summary and goals for their own child only, never internal notes or the referral flag', async () => {
    const plan = await open();
    await inOak(() => plans.addNote(s.people.TEACHER.actor, 'OWN', plan.id, { text: 'Private: family situation discussed with counsellor.' }));
    await inOak(() => plans.addReview(s.people.TEACHER.actor, 'OWN', plan.id, { familySummary: 'Good week.', internalNote: 'Internal only remark', nextReviewOn: ymdIn(10) }));
    // Not shared yet: the family sees nothing.
    expect((await inOak(() => plans.familyPlans(s.people.PARENT.actor))).items).toHaveLength(0);
    await inOak(() => plans.share(s.people.TEACHER.actor, 'OWN', plan.id));
    expect(await inOak(() => MessageOutbox.countDocuments({ templateKey: 'SUPPORT_PLAN_SHARED', recipientProfileId: s.people.PARENT.profile._id }))).toBeGreaterThan(0);
    // The principal records a referral flag.
    await inOak(() => plans.markReferred(s.people.PRINCIPAL.actor, 'ALL', plan.id));

    const fam = await inOak(() => plans.familyPlans(s.people.PARENT.actor));
    expect(fam.items).toHaveLength(1);
    const text = JSON.stringify(fam);
    expect(text).toContain('work together');
    expect(text).toContain('Good week.');
    expect(text).not.toMatch(/Private: family situation|Internal only remark|referr|internalNote/i);
    expect(fam.items[0].familyActions.map((a) => a.title)).toEqual(['Morning routine chart at home']);
    // Another parent sees nothing; a family cannot open the staff record.
    expect((await inOak(() => plans.familyPlans(s.people.PARENT2.actor))).items).toHaveLength(0);
    await expect(inOak(() => plans.get(s.people.PARENT.actor, 'OWN', plan.id))).rejects.toMatchObject({ statusCode: 404 });
    // The family acknowledges.
    const ack = await inOak(() => plans.acknowledge(s.people.PARENT.actor, plan.id, { comment: 'We will help with mornings.' }));
    expect(ack.acknowledgedAt).toBeTruthy();
    await expect(inOak(() => plans.acknowledge(s.people.PARENT2.actor, plan.id, {}))).rejects.toMatchObject({ statusCode: 404 });

    // Staff: the class teacher does not hold the referral permission, the principal does.
    const teacherView = await inOak(() => plans.get(s.people.TEACHER.actor, 'OWN', plan.id));
    expect(teacherView.referral).toBeUndefined();
    const principalView = await inOak(() => plans.get(s.people.PRINCIPAL.actor, 'ALL', plan.id));
    expect(principalView.referral.referred).toBe(true);
    // A teacher of another class cannot see the plan.
    await expect(inOak(() => plans.get(s.people.T4.actor, 'OWN', plan.id))).rejects.toMatchObject({ statusCode: 404 });
    const t3List = await inOak(() => plans.list(s.people.T3.actor, 'OWN', {}));
    expect(t3List.items).toHaveLength(0);
  });

  it('keeps schools apart', async () => {
    await open();
    expect(await inSchool(RIVER, () => SupportPlan.countDocuments({}))).toBe(0);
  });
});
