import crypto from 'crypto';
import { env } from '../../config/env.js';
import * as dashboard from '../dashboard/dashboard.service.js';
import * as fees from '../fees/fee.service.js';

/**
 * EduOS copilot.
 *
 * Deterministic, data-grounded assistant: intents are matched by keyword and
 * answered from the SAME role-scoped aggregation services that power the
 * dashboards, so a parent only ever sees their own children's data, a teacher
 * their own classes, etc. No fabricated numbers.
 *
 * Provider hook: when AI_PROVIDER is set to an LLM provider (and its API key
 * is present), swap the `respond()` call for the LLM client, passing the same
 * scoped `facts` object as tool results — callers do not change.
 */

const rupees = (n) => '₹' + Number(n ?? 0).toLocaleString('en-IN');

async function loadFacts(actor) {
  const role = actor?.roleKey;
  switch (role) {
    case 'STUDENT':
      return { role, student: await dashboard.getStudentDashboard(actor.profileId) };
    case 'PARENT':
      return { role, parent: await dashboard.getParentDashboard(actor.profileId) };
    case 'TEACHER':
      return { role, teacher: await dashboard.getTeacherDashboard(actor.profileId) };
    case 'OWNER':
    case 'ADMIN':
    case 'PRINCIPAL': {
      const [admin, feeSummary] = await Promise.all([
        dashboard.getAdminDashboard(),
        fees.getSummary(actor, 'ALL'),
      ]);
      return { role, admin, feeSummary };
    }
    default:
      return { role };
  }
}

function answerAttendance(facts, toolsUsed) {
  if (facts.student) {
    toolsUsed.push('attendance.summary');
    const s = facts.student;
    if (s.totalDays === 0) return 'No attendance has been recorded for you yet this term.';
    return `Your attendance is ${s.attendancePercentage}% — present ${s.presentDays} of ${s.totalDays} recorded days.`;
  }
  if (facts.parent) {
    toolsUsed.push('attendance.summary');
    const kids = facts.parent.linkedChildren;
    if (!kids?.length) return 'No children are linked to your account yet — please contact the school office.';
    return kids
      .map((k) => `${k.name}: ${k.attendance.percentage}% attendance (${k.attendance.present}/${k.attendance.total} days)`)
      .join('\n');
  }
  if (facts.teacher) {
    toolsUsed.push('attendance.today');
    const a = facts.teacher.attendanceSummary;
    const marked = Object.values(a).reduce((x, y) => x + y, 0);
    if (marked === 0) return "Today's attendance hasn't been marked yet for your classes.";
    return `Today across your classes: ${a.PRESENT} present, ${a.ABSENT} absent, ${a.LATE} late, ${a.EXCUSED} excused.`;
  }
  return 'Open Attendance in the sidebar for school-wide attendance trends.';
}

function answerFees(facts, toolsUsed) {
  if (facts.student) {
    toolsUsed.push('fees.summary');
    const f = facts.student.feeStatus;
    if (f.totalFees === 0) return 'No fee invoices have been raised for you yet.';
    return `Fees: ${rupees(f.paidFees)} paid of ${rupees(f.totalFees)} billed — ${rupees(f.pendingFees)} pending across ${f.pendingInvoices} invoice(s).`;
  }
  if (facts.parent) {
    toolsUsed.push('fees.summary');
    const p = facts.parent;
    if (!p.feeInvoices?.length) return 'No fee invoices have been raised for your children yet.';
    return `Pending fees for your family: ${rupees(p.pendingFees)}. You can pay online from Payments in the sidebar.`;
  }
  if (facts.feeSummary) {
    toolsUsed.push('fees.summary');
    const f = facts.feeSummary;
    return `School fee health: ${rupees(f.paid)} collected of ${rupees(f.total)} billed (${f.collectionRate}% collection rate), ${f.pendingCount} invoice(s) still open.`;
  }
  return 'Fee information is available to parents, students, and school staff.';
}

function answerAssignments(facts, toolsUsed) {
  if (facts.student) {
    toolsUsed.push('assignments.pending');
    const n = facts.student.pendingAssignments;
    return n === 0
      ? 'You are all caught up — no pending assignments. 🎉'
      : `You have ${n} pending assignment${n > 1 ? 's' : ''}. Open Assignments to submit your work.`;
  }
  if (facts.teacher) {
    toolsUsed.push('submissions.pending');
    const n = facts.teacher.pendingAssignmentEvaluations;
    return n === 0
      ? 'No submissions are waiting for grading.'
      : `${n} submission${n > 1 ? 's are' : ' is'} waiting for your grading in Assignments.`;
  }
  if (facts.parent) {
    toolsUsed.push('assignments.read');
    return 'Open Assignments in the sidebar to see homework and submission status for your child.';
  }
  return 'Assignments are managed per class — teachers create them, students submit from their portal.';
}

function answerTimetable(facts, toolsUsed) {
  const slots = facts.student?.todayTimetable ?? facts.teacher?.todayTimetable ?? facts.parent?.timetable;
  if (slots) {
    toolsUsed.push('timetable.today');
    if (!slots.length) return 'No periods are scheduled today.';
    return (
      "Today's timetable:\n" +
      slots.map((s) => `P${s.periodNo} ${s.startTime}–${s.endTime}: ${s.subject}${s.section ? ` (${s.section})` : ''}`).join('\n')
    );
  }
  return 'Open Timetable in the sidebar to view or build class schedules.';
}

function answerExams(facts, toolsUsed) {
  const exams = facts.student?.examSchedule ?? facts.teacher?.upcomingExams ?? facts.parent?.upcomingExams;
  if (exams) {
    toolsUsed.push('exams.upcoming');
    if (!exams.length) return 'No upcoming exams are scheduled.';
    return (
      'Upcoming exams:\n' +
      exams
        .map((e) => `${e.examName} — ${e.subject} on ${new Date(e.examDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`)
        .join('\n')
    );
  }
  return 'Exam schedules appear here once published.';
}

function answerSchool(facts, toolsUsed) {
  if (facts.admin) {
    toolsUsed.push('analytics.school');
    const a = facts.admin;
    return `School snapshot: ${a.totalStudents} active students, ${a.openTickets} open tickets, ${a.announcementsCount} announcements published.`;
  }
  return 'School-wide analytics are available to admins, owners, and principals.';
}

const INTENTS = [
  { match: /attendance|absent|present/i, answer: answerAttendance },
  { match: /fee|invoice|payment|paid|due/i, answer: answerFees },
  { match: /assignment|homework|submit|grading|pending task/i, answer: answerAssignments },
  { match: /timetable|schedule|period|class today/i, answer: answerTimetable },
  { match: /exam|test|result|marks/i, answer: answerExams },
  { match: /school|students|overview|snapshot|how many/i, answer: answerSchool },
];

const HELP =
  'I can answer from your school data: try "attendance", "fees", "assignments", "timetable", or "upcoming exams".';

export async function chat({ message, conversationId }, actor) {
  const convId = conversationId ?? `conv-${crypto.randomBytes(6).toString('hex')}`;
  const toolsUsed = [];

  let facts = { role: actor?.roleKey };
  try {
    facts = await loadFacts(actor);
  } catch {
    // Fall through — intents degrade to navigation hints when data is missing.
  }

  const intent = INTENTS.find((i) => i.match.test(message));
  const reply = intent ? intent.answer(facts, toolsUsed) : HELP;

  return {
    conversationId: convId,
    reply,
    toolsUsed,
    provider: env.AI_PROVIDER,
    isStandIn: env.AI_PROVIDER === 'rules',
  };
}
