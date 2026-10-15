import { SupportPlan } from '../models/supportPlan.model.js';
import { PortfolioEvidence } from '../models/competencyPortfolio.model.js';
import { Scenario } from '../models/scenario.model.js';
import { ClassCheckIn } from '../models/safety.model.js';
import { Student, StudentGuardian } from '../models/student.model.js';

/**
 * Sample data for the part-2 gaps (all fictional): support plans opened from
 * the risk signals (one shared with the family and reviewed), competency
 * portfolio evidence, ratings and a reflection for the demo student and the
 * demo parent's child, two saved what-if scenarios, and today's class
 * check-ins so the teacher presence board has something to show.
 */
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export async function seedP2Gaps({ section, attempt, who, teachers = [], actorOf }) {
  const { PRINCIPAL, TEACHER, STUDENT, PARENT } = who;

  await section('Support plans (sample)', SupportPlan, async () => {
    const plans = await import('../modules/support/support.service.js');
    const sug = await plans.suggestions(PRINCIPAL.actor, 'ALL', { refresh: '1' });
    const picks = sug.items.slice(0, 3);
    let made = 0;
    for (const [i, s] of picks.entries()) {
      // eslint-disable-next-line no-await-in-loop
      const p = await attempt(`plan for ${s.studentName}`, () => plans.create(PRINCIPAL.actor, 'ALL', {
        studentId: s.studentId, concernArea: s.concernArea, riskType: s.riskType, ownerProfileId: TEACHER?.id,
        summary: s.concernArea === 'ATTENDANCE'
          ? 'We have noticed a number of missed days this month. Together we will help your child attend every day.'
          : 'Recent test results show some topics need more practice. We will work on them together with short weekly goals.',
        goals: [s.concernArea === 'ATTENDANCE'
          ? { title: 'Attend school every day', measure: 'Attendance % over the next 4 weeks', unit: '%', baseline: 60, target: 90, reviewOn: day(21) }
          : { title: 'Raise the class-test average', measure: 'Average of the next three class tests', unit: '%', baseline: 35, target: 55, reviewOn: day(28) }],
        actions: [
          { title: s.concernArea === 'ATTENDANCE' ? 'Call home on the day of any absence' : 'Two extra practice sheets each week', ownerKind: 'STAFF', ownerProfileId: TEACHER?.id, dueOn: day(7) },
          { title: s.concernArea === 'ATTENDANCE' ? 'Morning routine chart at home' : 'Fifteen minutes of revision each evening', ownerKind: 'FAMILY' },
        ],
      }));
      if (!p) continue;
      made += 1;
      if (i === 0) {
        await attempt('share', () => plans.share(PRINCIPAL.actor, 'ALL', p.id));
        await attempt('review', () => plans.addReview(PRINCIPAL.actor, 'ALL', p.id, { familySummary: 'A good start: four of five days this week.', internalNote: 'Sample internal note (staff only).', goalStatuses: [{ goalId: p.goals[0].id, status: 'ON_TRACK' }], nextReviewOn: day(14) }));
      }
    }
    return `${made} plan(s) from ${sug.items.length} risk signal(s); one shared with the family and reviewed; review dates are in Tasks`;
  });

  await section('Competency portfolios (sample)', PortfolioEvidence, async () => {
    const svc = await import('../modules/portfolios/portfolios.service.js');
    const ids = [];
    if (STUDENT) { const s = await Student.findOne({ profileId: STUDENT.profile._id }).select('_id').lean(); if (s) ids.push(String(s._id)); }
    if (PARENT) for (const l of await StudentGuardian.find({ guardianProfileId: PARENT.profile._id }).select('studentId').lean()) ids.push(String(l.studentId));
    const sys = { ...PRINCIPAL.actor };
    let n = 0;
    for (const id of [...new Set(ids)]) {
      // eslint-disable-next-line no-await-in-loop
      await attempt('evidence', () => svc.addEvidence(sys, 'ALL', id, { competencyKey: 'COLLABORATION', title: 'Led a group model of the solar system (sample)', description: 'Shared roles fairly and presented with the group.', on: day(-12) }));
      // eslint-disable-next-line no-await-in-loop
      await attempt('evidence', () => svc.addEvidence(sys, 'ALL', id, { competencyKey: 'DIGITAL', title: 'Made a short slideshow on water saving (sample)', on: day(-5) }));
      for (const [key, level, comment] of [['COLLABORATION', 'PROFICIENT', 'Works well in a team and shares roles.'], ['COMMUNICATION', 'DEVELOPING', 'Growing confidence speaking in class.'], ['CREATIVITY', 'ADVANCED', 'Original ideas in art and design.']]) {
        // eslint-disable-next-line no-await-in-loop
        await attempt('rating', () => svc.rate(sys, 'ALL', id, { competencyKey: key, level, comment, term: 'Term 1' }));
      }
      n += 1;
    }
    if (STUDENT && ids[0]) await attempt('reflection', () => svc.reflect(STUDENT.actor, ids[0], { competencyKey: 'CREATIVITY', text: 'I enjoyed designing the poster and want to try a comic strip next. (sample)' }));
    return `${n} student portfolio(s) with teacher evidence, rubric ratings and a reflection`;
  });

  await section('Scenario planning (sample)', Scenario, async () => {
    const svc = await import('../modules/scenarios/scenarios.service.js');
    await svc.create(PRINCIPAL.actor, { name: 'Steady: 6% fee rise, current ratio (sample)', years: 3, assumptions: { feeIncreasePct: 6 } });
    await svc.create(PRINCIPAL.actor, { name: 'Growth: bigger intake, two more buses (sample)', years: 5, assumptions: { feeIncreasePct: 8, retentionPct: 97, riderPct: 45, studentsPerTeacher: 25 } });
    return '2 saved scenarios to compare';
  });

  await section('Teacher class check-ins today (sample)', ClassCheckIn, async () => {
    const camera = await import('../modules/safety/camera.service.js');
    let n = 0;
    for (const t of teachers.slice(0, 8)) {
      for (const periodNo of [1, 2]) {
        // eslint-disable-next-line no-await-in-loop
        if (await attempt(`check-in ${t.displayName} P${periodNo}`, () => camera.checkIn(actorOf(t, 'TEACHER'), { periodNo }))) n += 1;
      }
    }
    return `${n} check-in(s) for periods 1 and 2 (teachers with a lesson then)`;
  });
}
