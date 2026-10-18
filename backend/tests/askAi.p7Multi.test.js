import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

/**
 * Part 7 (multi-ask, performance score, verification):
 *
 *   - the performance score is computed by the metric definition exactly as
 *     its formulas say (hand-computed expectations), with coverage and the
 *     renormalisation of missing components stated, never guessed;
 *   - get_student_performance reads the seeded records at the caller's scope
 *     (a parent: own child; a teacher: pupils they teach; principal: any);
 *   - the verification engine traces every figure, name and claimed action to
 *     a tool result or a calculation, stores the provenance, and rejects a
 *     model-written answer that states anything else;
 *   - the four open follow-ups, and a multi-part message that drafts several
 *     messages one at a time ("next").
 *
 * The per-role multi-ask conversations are in the harness
 * (support/askAiP7Scenarios.js, replayed by askAi.conversations.test.js).
 */

vi.hoisted(() => { process.env.RATE_LIMIT_AI_MAX = '100000'; });

const { scorePerformance, VERSION, COMPONENTS } = await import('../src/modules/ai/mcp/metrics/studentPerformance.js');
const { createLedger } = await import('../src/modules/ai/agent/calc.js');
const { verifyAnswer, applyVerification } = await import('../src/modules/ai/agent/verify.js');
const { planAsks, splitAsks } = await import('../src/modules/ai/agent/multiAsk.js');
const { runAgentSafely } = await import('../src/modules/ai/agent/orchestrator.js');
const { resetAgentThrottle } = await import('../src/modules/ai/agent/throttle.js');
const { resetMcpClient } = await import('../src/modules/ai/mcp/client.js');
const { AuditLog } = await import('../src/models/auditLog.model.js');
const { Student, Enrollment, StudentGuardian } = await import('../src/models/student.model.js');
const { Exam, ExamSubject, Mark } = await import('../src/models/exam.model.js');
const { Assignment, Submission } = await import('../src/models/assignment.model.js');
const { AttendanceRecord } = await import('../src/models/attendanceRecord.model.js');
const { Club, ClubMembership, ClubSession } = await import('../src/models/club.model.js');
const { ReportCardTemplate, TermReportCard } = await import('../src/models/reportCard.model.js');
const { seedConversationSchool } = await import('./support/askAiConversationSchool.js');
const { inSchool, OAK, mcp, todayKey, seedPerson } = await import('./support/mcpSchool.js');

afterAll(async () => { await resetMcpClient(); });

/* ── The metric definition, by hand ─────────────────────────────────── */

describe('the performance score is the metric definition, computed exactly', () => {
  const FULL = {
    period: { from: '2026-04-01', to: '2026-10-18' },
    // 16 present + 1 late + ½ of 1 half-day = 17.5 of 20 = 87.5%
    attendance: { PRESENT: 16, ABSENT: 2, LATE: 1, EXCUSED: 0, HALF_DAY: 1, workingDays: 20 },
    assessments: [
      { exam: 'Unit Test 1', subject: 'Mathematics', date: '2026-07-01', marks: 30, maxMarks: 50, classAverage: null, classMarked: 3 }, // 60
      { exam: 'Unit Test 1', subject: 'Science', date: '2026-07-01', marks: 40, maxMarks: 50, classAverage: null, classMarked: 3 }, // 80
      { exam: 'Unit Test 2', subject: 'Mathematics', date: '2026-09-01', marks: 40, maxMarks: 50, classAverage: 70, classMarked: 6 }, // 80
      { exam: 'Unit Test 2', subject: 'Science', date: '2026-09-01', marks: 45, maxMarks: 50, classAverage: null, classMarked: 3 }, // 90
    ],
    papersSet: 5,
    assignments: { due: 10, submitted: 8, onTime: 6, late: 2, upcoming: 1 },
    coScholastic: { scale: ['A', 'B', 'C'], grades: [{ area: 'Work education', grade: 'A' }, { area: 'Art education', grade: 'B' }] },
    clubs: { memberships: 1, held: 10, attended: 9 },
  };

  it('every component and the overall score match the hand calculation', () => {
    const out = scorePerformance(FULL);
    const by = Object.fromEntries(out.components.map((c) => [c.key, c]));
    expect(out.metric).toEqual({ id: 'student-performance', version: VERSION });
    expect(by.attendance.score).toBe(87.5);
    expect(by.marks.score).toBe(77.5); // mean(60, 80, 80, 90)
    expect(by.progress.score).toBe(87.5); // UT2 85 − UT1 70 = +15 → 50 + 2.5×15
    expect(by.assignments.score).toBe(77.5); // completion 80, on time 75
    expect(by.consistency.score).toBe(78.2); // σ(60,80,80,90) = 10.9 → 100 − 21.8
    expect(by.coScholastic.score).toBeCloseTo(83.34, 1); // A 100, B 66.67
    expect(by.clubs.score).toBe(90);
    // 0.25×87.5 + 0.30×77.5 + 0.10×87.5 + 0.20×77.5 + 0.05×78.2 + 0.05×83.34 + 0.05×90 = 81.95
    expect(out.overall.score).toBeCloseTo(81.95, 1);
    expect(out.overall.band).toBe('Good');
    expect(out.weighting.renormalised).toBe(false);
    expect(out.coverage.tests).toBe('4 of 5 test paper(s) recorded');
    // Weights sum to 1 and each is stated.
    expect(COMPONENTS.reduce((a, c) => a + c.weight, 0)).toBeCloseTo(1, 6);
    expect(out.howCalculated.join(' ')).toMatch(/weighted average/);
  });

  it('a component with no data is excluded and the others re-weighted -- and the answer says so', () => {
    const out = scorePerformance({
      period: { from: '2026-04-01', to: '2026-10-18' },
      attendance: { PRESENT: 10, ABSENT: 10, LATE: 0, EXCUSED: 0, HALF_DAY: 0, workingDays: 20 },
      assessments: [{ exam: 'Unit Test 2', subject: 'Mathematics', date: '2026-09-01', marks: 35, maxMarks: 50, classAverage: null, classMarked: 2 }],
      papersSet: 2,
      assignments: { due: 0, submitted: 0, onTime: 0, late: 0, upcoming: 1 },
      coScholastic: null,
      clubs: { memberships: 1, held: 0, attended: 0 },
    });
    // (0.25×50 + 0.30×70) ÷ 0.55 = 60.91
    expect(out.overall.score).toBe(60.91);
    expect(out.overall.band).toBe('Satisfactory');
    expect(out.weighting).toMatchObject({ renormalised: true, usedWeight: 0.55 });
    expect(out.weighting.note).toMatch(/5 component\(s\) had no data and were left out/);
    expect(out.excluded.map((e) => e.key).sort()).toEqual(['assignments', 'clubs', 'coScholastic', 'consistency', 'progress']);
    expect(out.excluded.find((e) => e.key === 'clubs').reason).toMatch(/member of 1 club\(s\), but no session attendance/);
    expect(out.coverage.tests).toBe('1 of 2 test paper(s) recorded');
    const by = Object.fromEntries(out.components.map((c) => [c.key, c]));
    expect(by.attendance.effectiveWeight).toBeCloseTo(0.455, 3);
    expect(by.marks.effectiveWeight).toBeCloseTo(0.545, 3);
    expect(by.clubs.score).toBeUndefined(); // never guessed as zero
  });

  it('with nothing recorded there is no score at all', () => {
    const out = scorePerformance({ period: { from: '2026-04-01', to: '2026-10-18' }, attendance: null, assessments: [], papersSet: 0, assignments: null, coScholastic: null, clubs: null });
    expect(out.overall).toEqual({ score: null, band: null });
    expect(out.excluded).toHaveLength(COMPONENTS.length);
  });

  it('every number comes with its calculation (the provenance ledger)', () => {
    const out = scorePerformance(FULL);
    const overall = out.calculations.find((c) => c.label === 'overall score');
    expect(overall).toMatchObject({ op: 'weighted_mean' });
    expect(overall.inputs).toHaveLength(7);
    expect(out.calculations.find((c) => c.label === 'attendance %')).toMatchObject({ op: 'percentage', value: 87.5 });
  });
});

describe('the calculation helper', () => {
  it('computes and records sums, means, percentages, differences and a renormalised weighted mean', () => {
    const l = createLedger('t');
    expect(l.sum([1, 2, 3.5])).toBe(6.5);
    expect(l.mean([60, 80])).toBe(70);
    expect(l.pct(3, 4)).toBe(75);
    expect(l.pct(1, 0)).toBeNull();
    expect(l.diff(85, 70)).toBe(15);
    expect(l.weightedMean([{ key: 'a', weight: 0.25, score: 50 }, { key: 'b', weight: 0.3, score: 70 }, { key: 'c', weight: 0.45, score: null }])).toBe(60.91);
    expect(l.entries.map((e) => e.op)).toEqual(['sum', 'mean', 'percentage', 'percentage', 'difference', 'weighted_mean']);
    expect(l.entries.every((e) => /^t-\d+$/.test(e.id))).toBe(true);
  });
});

/* ── Verification engine / answer validation ────────────────────────── */

describe('every figure, name and claimed action must trace to a tool result or a calculation', () => {
  const calls = [{
    tool: 'get_class_marks',
    args: { className: 'Class 5 A' },
    result: { success: true, data: { class: 'Class 5 A', subjects: [{ subject: 'Mathematics', averagePct: 75, highest: 45, maxMarks: 50, rows: [{ studentName: 'Aarav Mishra', marks: 45 }] }], calculations: [{ id: 'perf-9', op: 'weighted_mean', value: 81.95, label: 'overall score' }] } },
  }];

  it('a grounded reply passes, with the provenance of each figure and name', () => {
    const v = verifyAnswer({ reply: 'Class 5 A — Mathematics average 75%, highest 45/50 (Aarav Mishra). Overall 81.95.', calls });
    expect(v.ok).toBe(true);
    const figure = v.provenance.find((p) => p.fact === '75');
    expect(figure.source).toMatchObject({ kind: 'tool', ref: 'get_class_marks' });
    expect(figure.source.path).toMatch(/averagePct/);
    expect(v.provenance.find((p) => p.fact === '81.95').source).toMatchObject({ kind: 'calculation', ref: 'perf-9', op: 'weighted_mean' });
    expect(v.provenance.find((p) => p.fact === 'Aarav Mishra').source).toMatchObject({ kind: 'tool', ref: 'get_class_marks' });
  });

  it('an unsupported figure, name, deed or rank is refused', () => {
    const v = verifyAnswer({ reply: 'The average is 97% and Kabir Singh topped. I have sent the report to parents. Aarav is ranked 1st in the class.', calls });
    expect(v.ok).toBe(false);
    expect(v.unsupported).toEqual(expect.arrayContaining(['the figure 97', 'the name Kabir Singh', 'a claim that something was done']));
    expect(v.unsupported.some((u) => /rank/.test(u))).toBe(true);
  });

  it('a model-written answer that fails is replaced by the deterministic one; internals never leave', () => {
    const out = applyVerification({
      reply: 'Average 97%.', modelWritten: true, _deterministic: 'Class 5 A — Mathematics average 75%.', _calls: calls, via: 'MCP',
    }, { message: 'class 5 A marks' });
    expect(out.reply).toBe('Class 5 A — Mathematics average 75%.');
    expect(out.verification).toMatchObject({ ok: true, fallback: 'deterministic' });
    expect(out._calls).toBeUndefined();
    expect(out._deterministic).toBeUndefined();
  });

  it('what the person typed grounds itself', () => {
    expect(verifyAnswer({ reply: 'No homework due on 2026-11-30.', calls: [{ tool: 'get_assignments', args: {}, result: { success: true, data: { items: [] } } }], message: 'homework due on 2026-11-30' }).ok).toBe(true);
  });
});

/* ── The tool, against seeded records ───────────────────────────────── */

const DAY = 86_400_000;

/** Rahul (6A) with two tests, four marked days, two past assignments, a club and a published report card. */
async function seedPerformance(school) {
  return inSchool(OAK, async () => {
    const ut1 = await Exam.create({ termId: school.term._id, name: 'Unit Test 1', startsOn: new Date('2026-07-01'), endsOn: new Date('2026-07-03') });
    const p1 = await ExamSubject.create({ examId: ut1._id, subjectOfferingId: school.offerings.m6a._id, maxMarks: 50 });
    await Mark.create({ examSubjectId: p1._id, enrollmentId: school.rahul.enrollment._id, marks: 30, status: 'PUBLISHED' });
    await Mark.create({ examSubjectId: p1._id, enrollmentId: school.priya.enrollment._id, marks: 45, status: 'PUBLISHED' });
    // Three more 6 A pupils with Unit Test 2 marks: five marked, so the class average is shown.
    const ut2Paper = await ExamSubject.findOne({ subjectOfferingId: school.offerings.m6a._id, examId: { $ne: ut1._id } });
    let roll = 10;
    for (const [first, marks] of [['Kabir', 25], ['Zoya', 30], ['Neel', 45]]) {
      // eslint-disable-next-line no-await-in-loop
      const s = await Student.create({ admissionNo: `OAK-P7-${first}`, firstName: first, lastName: 'Test' });
      // eslint-disable-next-line no-await-in-loop
      const e = await Enrollment.create({ studentId: s._id, sectionId: school.sectionA._id, academicYearId: school.year._id, status: 'ACTIVE', rollNo: roll += 1 });
      // eslint-disable-next-line no-await-in-loop
      await Mark.create({ examSubjectId: ut2Paper._id, enrollmentId: e._id, marks, status: 'PUBLISHED' });
    }
    for (const back of [1, 2, 3]) {
      // eslint-disable-next-line no-await-in-loop
      await AttendanceRecord.create({ enrollmentId: school.rahul.enrollment._id, date: new Date(todayKey().getTime() - back * DAY), periodNo: null, status: 'PRESENT' });
    }
    const a = await Assignment.create({ subjectOfferingId: school.offerings.m6a._id, title: 'Past A', dueAt: new Date(Date.now() - 10 * DAY) });
    const b = await Assignment.create({ subjectOfferingId: school.offerings.m6a._id, title: 'Past B', dueAt: new Date(Date.now() - 5 * DAY) });
    await Submission.create({ assignmentId: a._id, enrollmentId: school.rahul.enrollment._id, status: 'SUBMITTED', submittedAt: new Date(Date.now() - 11 * DAY) });
    await Submission.create({ assignmentId: b._id, enrollmentId: school.rahul.enrollment._id, status: 'LATE', submittedAt: new Date(Date.now() - 4 * DAY) });
    const club = await Club.create({ code: 'CHESS', name: 'Chess club', category: 'ACADEMIC', capacity: 20 });
    await ClubMembership.create({ clubId: club._id, studentId: school.rahul.student._id, status: 'ACTIVE', requestedByProfileId: school.people.PARENT.profile._id });
    for (const [back, status] of [[3, 'PRESENT'], [2, 'ABSENT']]) {
      const at = new Date(Date.now() - back * DAY);
      // eslint-disable-next-line no-await-in-loop
      await ClubSession.create({ clubId: club._id, startsAt: at, endsAt: new Date(at.getTime() + 3600_000), status: 'HELD', attendance: [{ studentId: school.rahul.student._id, status }] });
    }
    const tpl = await ReportCardTemplate.create({
      name: 'CBSE', terms: [{ key: 'TERM_1', name: 'Term 1', components: [{ key: 'UT', label: 'Unit test', maxMarks: 20 }] }],
      coScholasticAreas: [{ key: 'WORK_EDUCATION', label: 'Work education' }, { key: 'ART_EDUCATION', label: 'Art education' }],
      coScholasticGrades: ['A', 'B', 'C'],
    });
    await TermReportCard.create({
      templateId: tpl._id, termKey: 'TERM_1', enrollmentId: school.rahul.enrollment._id, studentId: school.rahul.student._id, sectionId: school.sectionA._id,
      status: 'PUBLISHED', publishedAt: new Date(), coScholastic: { WORK_EDUCATION: 'A', ART_EDUCATION: 'C' }, discipline: 'B',
    });
  });
}

describe('get_student_performance reads the records, at the caller\'s scope', () => {
  let school;
  beforeEach(async () => {
    school = await seedConversationSchool();
    await seedPerformance(school);
  });

  it('Rahul\'s score matches the hand calculation from the seeded records', async () => {
    const out = await mcp(OAK, school.people.PARENT.actor, 'get_student_performance', { studentName: 'Rahul' });
    expect(out.success).toBe(true);
    const d = out.data;
    const by = Object.fromEntries(d.components.map((c) => [c.key, c]));
    expect(by.attendance.score).toBe(75); // 3 of 4 days
    expect(by.marks.score).toBe(65); // UT1 60%, UT2 70%
    expect(by.progress.score).toBe(75); // +10 points → 50 + 25
    expect(by.assignments.score).toBe(75); // 2 of 2 submitted (100%), 1 of 2 on time (50%)
    expect(by.assignments.detail).toMatch(/2 of 2 submitted \(1 on time, 1 late\); 1 not yet due/);
    expect(by.consistency.score).toBe(90); // σ(60, 70) = 5
    expect(by.coScholastic.score).toBeCloseTo(66.67, 1); // A 100, C 33.33
    expect(by.clubs.score).toBe(50); // 1 of 2 sessions
    // 0.25×75 + 0.30×65 + 0.10×75 + 0.20×75 + 0.05×90 + 0.05×66.67 + 0.05×50 = 71.08
    expect(d.overall.score).toBeCloseTo(71.08, 1);
    expect(d.overall.band).toBe('Good');
    expect(d.coverage.tests).toBe('2 of 2 test paper(s) recorded');
    expect(d.metric.version).toBe(VERSION);
    // The class average, because five 6 A pupils have a Unit Test 2 mark: (35+40+25+30+45) ÷ 250 = 70%.
    expect(d.subjects).toEqual([expect.objectContaining({ subject: 'Mathematics', current: { exam: 'Unit Test 2', percent: 70 }, previous: { exam: 'Unit Test 1', percent: 60 }, change: 10, classAverage: 70 })]);
    // No behaviour score, no classmate named.
    const text = JSON.stringify(d);
    expect(text).not.toMatch(/discipline|Priya|Kabir|Zoya|Neel/i);
    expect(d.evidence.map((e) => e.link)).toEqual(expect.arrayContaining(['/attendance', '/exams', '/assignments', '/report-cards', '/clubs']));
  });

  it('a parent only for their own child; a teacher only for pupils they teach; the principal for anyone', async () => {
    const parentOther = await mcp(OAK, school.people.PARENT.actor, 'get_student_performance', { studentName: 'Aman Gupta' });
    expect(parentOther.success).toBe(false);
    const teacherOwn = await mcp(OAK, school.people.TEACHER.actor, 'get_student_performance', { studentName: 'Rahul Sharma' });
    expect(teacherOwn.success).toBe(true);
    const teacherOther = await mcp(OAK, school.people.TEACHER.actor, 'get_student_performance', { studentName: 'Ishaan Bose' });
    expect(teacherOther.success).toBe(false);
    const principal = await mcp(OAK, school.people.PRINCIPAL.actor, 'get_student_performance', { studentName: 'Ishaan Bose' });
    expect(principal.success).toBe(true);
    expect(principal.data.overall.score).toBeNull(); // nothing recorded for Ishaan beyond attendance? (none) -> no guess
    const finance = await mcp(OAK, school.people.FINANCE.actor, 'get_student_performance', { studentName: 'Rahul Sharma' });
    expect(finance.success).toBe(false);
  });

  it('through Ask AI the score is verified: every figure traced, the overall to its calculation', async () => {
    resetAgentThrottle();
    const out = await inSchool(OAK, () => runAgentSafely({ message: "Rahul's performance score", actor: school.people.PARENT.actor, source: 'WEB' }));
    expect(out.reply).toMatch(/performance score 71\.08\/100 · Good/);
    expect(out.reply).toMatch(/How it's calculated/);
    expect(out.reply).toMatch(/2 of 2 test paper\(s\) recorded/);
    expect(out.verification).toMatchObject({ ok: true });
    expect(out.provenance.find((p) => p.fact === '71.08').source).toMatchObject({ kind: 'calculation', op: 'weighted_mean' });
    // The verdict and the provenance are stored with the conversation.
    const { AgentConversation } = await import('../src/models/agentConversation.model.js');
    const row = await inSchool(OAK, () => AgentConversation.findOne({ conversationId: out.conversationId }).lean());
    expect(row.context.verification).toMatchObject({ ok: true });
    expect(row.context.verification.provenance.some((p) => p.fact === '71.08')).toBe(true);
  });
});

/* ── Splitting ──────────────────────────────────────────────────────── */

describe('a message with several asks is split where people join them, and only there', () => {
  it('splits lists, commas, "and also", question marks and "aur"', () => {
    expect(splitAsks('1. attendance of 6A\n2. homework due\n3. my timetable').map((p) => p.text)).toEqual(['attendance of 6A', 'homework due', 'my timetable']);
    expect(splitAsks("Rahul's score, his performance, assignment updates and who is the class teacher").map((p) => p.text))
      .toEqual(["Rahul's score", 'his performance', 'assignment updates', 'who is the class teacher']);
    expect(splitAsks('show my fees and also my attendance? what is due').map((p) => p.text)).toEqual(['show my fees', 'my attendance', 'what is due']);
    expect(splitAsks('meri attendance aur fees').map((p) => p.text)).toEqual(['meri attendance', 'fees']);
    // A framing clause stays with the question it frames (integration: mcp.e2e RAG + MCP).
    expect(splitAsks('According to the attendance policy, which students are below 75% attendance?').map((p) => p.text)).toEqual(['According to the attendance policy, which students are below 75% attendance']);
  });

  it('does not split one request that merely contains "and" (or quoted words)', async () => {
    const school = await seedConversationSchool();
    const teacher = school.people.TEACHER.actor;
    expect(planAsks('Mark Rahul Sharma and Aman Gupta absent today', teacher)).toBeNull();
    expect(planAsks('Show the name and class of Rahul Sharma', teacher)).toBeNull();
    expect(planAsks('Post an announcement to Class 6 A saying "bring your atlas and compass"', teacher)).toBeNull();
    expect(planAsks('show attendance for Class 6 A', teacher)).toBeNull();
  });
});

/* ── The four open follow-ups, and queued drafts ────────────────────── */

/** A conversation through the shared core, carrying the server-side memory as the website does. */
function chat(school, role, source = 'WEB') {
  const actor = school.people[role].actor;
  const history = [];
  let conversationId = null;
  return {
    async say(message) {
      resetAgentThrottle();
      const before = await inSchool(OAK, () => AuditLog.countDocuments({}));
      const result = await inSchool(OAK, () => runAgentSafely({ message, actor, source, history: [...history], conversationId }));
      if (result?.conversationId) conversationId = result.conversationId;
      const entries = await inSchool(OAK, () => AuditLog.find({}).sort({ _id: 1 }).skip(before).lean());
      const calls = entries.filter((e) => e.after?.via === 'MCP').map((e) => ({ tool: e.action.replace(/^agent\./, ''), args: e.after?.request ?? {}, status: e.after?.status }));
      history.push({ role: 'user', text: message }, { role: 'assistant', text: String(result?.reply ?? '') });
      return { ...result, calls };
    },
  };
}

describe('the four open follow-ups', () => {
  let school;
  beforeEach(async () => { school = await seedConversationSchool(); });

  it('"Who scored the highest?" after a class\'s marks names the student(s), for staff', async () => {
    const c = chat(school, 'TEACHER');
    await c.say('show marks for Class 6 A');
    const turn = await c.say('Who scored the highest?');
    expect(turn.calls.at(-1)).toMatchObject({ tool: 'get_class_marks', args: { className: 'Class 6 A', scorers: true }, status: 'READ' });
    expect(turn.reply).toMatch(/highest 40\/50 \(Priya Verma\)/);
  });

  it('a parent or a student gets the policy, and nothing is looked up', async () => {
    for (const role of ['PARENT', 'STUDENT']) {
      const c = chat(school, role);
      // eslint-disable-next-line no-await-in-loop
      const turn = await c.say('who scored the highest in my class?');
      expect(turn.calls).toEqual([]);
      expect(turn.reply).toMatch(/aren't shown to (?:parents|students) — that is the school's policy/);
      expect(turn.reply).not.toMatch(/Priya Verma|Rahul Sharma/);
    }
  });

  it('an admin\'s "her class?" after a student is discussed answers the class', async () => {
    const c = chat(school, 'ADMIN');
    await c.say("show Riya Kapoor's attendance");
    const turn = await c.say('her class?');
    expect(turn.calls.at(-1)).toMatchObject({ tool: 'get_enrolment_details', args: { studentName: 'Riya Kapoor' } });
    expect(turn.reply).toMatch(/Riya Kapoor is in Class 6 B/);
  });

  it('"Show its students" after a class ranking carries the class', async () => {
    const c = chat(school, 'PRINCIPAL');
    const ranked = await c.say('which class has the lowest attendance');
    expect(ranked.reply).toMatch(/Class 10 B has the lowest attendance/);
    const turn = await c.say('Show its students');
    expect(turn.calls.at(-1)).toMatchObject({ tool: 'search_students', args: { query: 'Class 10 B' } });
    expect(turn.reply).toMatch(/Rohan Desai/);
    expect(turn.reply).toMatch(/Meera Nair/);
    expect(turn.reply).not.toMatch(/Rahul Sharma|Aarav Mishra/);
  });

  it('HR "how many staff" counts staff accounts only', async () => {
    const turn = await chat(school, 'HR').say('how many staff are there?');
    expect(turn.calls.at(-1)).toMatchObject({ tool: 'count_staff' });
    expect(turn.data.total).toBe(8);
    expect(turn.reply).not.toMatch(/PARENT|STUDENT|ALUMNUS|Riverside/);
  });
});

describe('a multi-part message that drafts several messages proposes them one at a time', () => {
  it('reads, then drafts the first; "yes" sends it; "next" drafts the second', async () => {
    const school = await seedConversationSchool();
    await inSchool(OAK, async () => {
      await AttendanceRecord.create({ enrollmentId: school.aman.enrollment._id, date: todayKey(), periodNo: null, status: 'ABSENT' });
    });
    const amanParent = await seedPerson({ roleKey: 'PARENT', roleId: school.roleIds.PARENT, displayName: 'Aman parent' });
    await inSchool(OAK, () => StudentGuardian.create({ studentId: school.aman.student._id, guardianProfileId: amanParent.profile._id, relation: 'MOTHER' }));

    const c = chat(school, 'TEACHER');
    const first = await c.say("attendance of 6A today, who's absent, and send their parents a message");
    expect(first.reply).toMatch(/\*\*1\. Attendance of 6A today\*\*/);
    expect(first.reply).toMatch(/\*\*2\. Who's absent\*\*\nAbsent — Class 6 A on \d{4}-\d{2}-\d{2}: Rahul Sharma, Aman Gupta\./);
    expect(first.reply).toMatch(/1 more draft\(s\) queued/);
    expect(first.action?.summary).toMatch(/about Rahul Sharma/);
    expect(first.calls.filter((x) => x.status === 'EXECUTED')).toEqual([]);
    expect(first.queuedWrites).toHaveLength(1);

    const sent = await c.say('yes');
    expect(sent.calls.at(-1)).toMatchObject({ tool: 'send_conversation_message', status: 'EXECUTED' });

    const next = await c.say('next');
    expect(next.action?.summary).toMatch(/about Aman Gupta/);
    expect(next.calls.at(-1)).toMatchObject({ tool: 'send_conversation_message', status: 'CONFIRMATION_REQUIRED' });
    const second = await c.say('yes');
    expect(second.calls.at(-1)).toMatchObject({ tool: 'send_conversation_message', status: 'EXECUTED' });
  });
});
