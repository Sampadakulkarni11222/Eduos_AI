import crypto from 'crypto';
import { env } from '../../config/env.js';
import * as dashboard from '../dashboard/dashboard.service.js';
import * as fees from '../fees/fee.service.js';
import * as library from '../library/library.service.js';
import * as hostel from '../hostel/hostel.service.js';
import * as assignments from '../assignments/assignment.service.js';
import * as exams from '../exams/exam.service.js';
import * as academics from '../academics/academics.service.js';
import * as announcements from '../announcements/announcement.service.js';
import * as calendarEvents from '../calendar/calendar.service.js';
import * as documents from '../documents/document.service.js';
import * as transport from '../transport/transport.service.js';
import { Enrollment } from '../../models/student.model.js';
import { getOwnStudentId, getGuardianStudentIds } from '../../utils/scope.js';

/**
 * EduOS copilot.
 *
 * Deterministic, data-grounded assistant: intents are matched by keyword and
 * answered from the SAME role-scoped aggregation services that power the
 * dashboards, so a parent only ever sees their own children's data, a teacher
 * their own classes, etc. No fabricated numbers.
 *
 * Intent routing is a small weighted-keyword scorer (see scoreIntent below),
 * not a single first-match regex — this lets more specific phrases like
 * "exam results" or "fee due" outrank a bare shared word like "due" or
 * "exam" that appears in more than one intent's vocabulary.
 *
 * Provider hook: when AI_PROVIDER is set to an LLM provider (and its API key
 * is present), swap the `respond()` call for the LLM client, passing the same
 * scoped `facts` object as tool results — callers do not change.
 */

const rupees = (n) => '₹' + Number(n ?? 0).toLocaleString('en-IN');
const shortDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—');

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
    case 'FINANCE':
      return { role, feeSummary: await fees.getSummary(actor, 'ALL') };
    case 'LIBRARIAN':
      return { role, librarySummary: await library.getSummary() };
    case 'WARDEN':
      return { role, hostelSummary: await hostel.getSummary() };
    default:
      return { role };
  }
}

/** Resolves the ACTIVE-enrollment section id for a student/parent actor, or null. */
async function getOwnSectionId(actor) {
  let studentIds = [];
  if (actor?.roleKey === 'STUDENT') {
    const id = await getOwnStudentId(actor.profileId);
    if (id) studentIds = [id];
  } else if (actor?.roleKey === 'PARENT') {
    studentIds = await getGuardianStudentIds(actor.profileId);
  }
  if (studentIds.length === 0) return null;
  const enrollment = await Enrollment.findOne({ studentId: { $in: studentIds }, status: 'ACTIVE' }).select('sectionId');
  return enrollment?.sectionId ?? null;
}

async function getMyOfferings(actor) {
  if (actor?.roleKey === 'TEACHER') return academics.getMyOfferings(actor);
  const sectionId = await getOwnSectionId(actor);
  if (!sectionId) return [];
  return academics.listOfferings({ sectionId });
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

/** Renders up to 5 assignments (title/subject/due date/status) for a student-or-parent actor. */
async function answerAssignments(facts, toolsUsed, actor) {
  if (facts.student || facts.parent) {
    toolsUsed.push('assignments.list');
    const items = await assignments.list(actor, 'OWN', {});
    const pending = items.filter((a) => !a.mySubmission || a.mySubmission.status === 'PENDING');
    if (pending.length === 0) return 'You are all caught up — no pending assignments. 🎉';
    const lines = pending
      .slice(0, 5)
      .map((a) => `• ${a.title} (${a.subject}) — due ${shortDate(a.dueAt)}`);
    const more = pending.length > 5 ? `\n…and ${pending.length - 5} more.` : '';
    return `You have ${pending.length} pending assignment${pending.length > 1 ? 's' : ''}:\n${lines.join('\n')}${more}`;
  }
  if (facts.teacher) {
    toolsUsed.push('submissions.pending');
    const n = facts.teacher.pendingAssignmentEvaluations;
    return n === 0
      ? 'No submissions are waiting for grading.'
      : `${n} submission${n > 1 ? 's are' : ' is'} waiting for your grading in Assignments.`;
  }
  return 'Assignments are managed per class — teachers create them, students submit from their portal.';
}

/** Published exam results grouped by subject — distinct from the "upcoming exams" schedule intent. */
async function answerGrades(facts, toolsUsed, actor) {
  if (!facts.student && !facts.parent) {
    return 'Grades are available to students and parents once results are published.';
  }
  toolsUsed.push('exams.performance');
  try {
    const perf = await exams.getPerformance(actor, 'OWN', {});
    if (!perf.results.length) return 'No published results yet — grades will appear here once your teacher publishes them.';
    const lines = perf.results.map((r) => `• ${r.subject} (${r.exam}): ${r.marks ?? '—'}/${r.maxMarks}${r.pct != null ? ` (${r.pct}%)` : ''}`);
    const avg = perf.overallAvgPct != null ? `\nOverall average: ${perf.overallAvgPct}%` : '';
    return `Your grades:\n${lines.join('\n')}${avg}`;
  } catch {
    return 'No published results yet — grades will appear here once your teacher publishes them.';
  }
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
        .map((e) => `${e.examName} — ${e.subject} on ${shortDate(e.examDate)}`)
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

async function answerLibrary(facts, toolsUsed, actor) {
  if (facts.librarySummary) {
    toolsUsed.push('library.summary');
    const l = facts.librarySummary;
    return `Library: ${l.totalCatalogBooks} books in the catalog (${l.uniqueTitles} titles), ${l.activeBookIssues} currently on loan, ${l.overdueReturns} overdue.`;
  }
  if (actor?.roleKey === 'STUDENT') {
    toolsUsed.push('library.myIssues');
    const studentId = await getOwnStudentId(actor.profileId);
    const issues = studentId ? await library.listIssues({ studentId }) : [];
    const borrowed = issues.filter((i) => i.status !== 'RETURNED');
    if (!borrowed.length) return 'You have no books currently borrowed from the library.';
    const lines = borrowed.slice(0, 5).map((i) => `• ${i.bookTitle} — due ${shortDate(i.dueAt)}${i.status === 'OVERDUE' ? ' (overdue)' : ''}`);
    return `Books you've borrowed:\n${lines.join('\n')}`;
  }
  return 'Library catalog and lending data is available to librarians, admins, and owners.';
}

function answerHostel(facts, toolsUsed) {
  if (facts.hostelSummary) {
    toolsUsed.push('hostel.summary');
    const h = facts.hostelSummary;
    return `Hostel: ${h.occupiedBeds}/${h.totalCapacity} beds occupied (${h.occupancyRate}%), ${h.availableBeds} available across ${h.totalRooms} rooms. ${h.hostelInquiries} open inquiries.`;
  }
  return 'Hostel occupancy and allocation data is available to wardens, admins, and owners.';
}

async function answerSubjects(facts, toolsUsed, actor) {
  if (!['STUDENT', 'PARENT', 'TEACHER'].includes(actor?.roleKey)) {
    return 'Open Academic Setup in the sidebar to manage subjects.';
  }
  toolsUsed.push('academics.offerings');
  const offerings = await getMyOfferings(actor);
  if (!offerings.length) return 'No subjects are set up for your class yet.';
  const names = [...new Set(offerings.map((o) => o.subjectId?.name).filter(Boolean))];
  return `Your subjects: ${names.join(', ')}.`;
}

async function answerTeachers(facts, toolsUsed, actor) {
  if (!['STUDENT', 'PARENT', 'TEACHER'].includes(actor?.roleKey)) {
    return 'Open Academic Setup in the sidebar to manage teacher assignments.';
  }
  toolsUsed.push('academics.offerings');
  const offerings = await getMyOfferings(actor);
  const lines = offerings
    .filter((o) => o.subjectId && o.teacherId)
    .map((o) => `${o.subjectId.name}: ${o.teacherId.displayName}`);
  if (!lines.length) return 'No teachers are assigned to your class yet.';
  return `Your teachers:\n${lines.join('\n')}`;
}

async function answerAnnouncements(facts, toolsUsed) {
  toolsUsed.push('announcements.list');
  const items = await announcements.list();
  if (!items.length) return 'No announcements have been published yet.';
  const lines = items.slice(0, 5).map((a) => `• ${a.title} — ${shortDate(a.publishedAt)}`);
  return `Latest announcements:\n${lines.join('\n')}`;
}

async function answerCalendar(facts, toolsUsed) {
  toolsUsed.push('calendar.list');
  const from = new Date();
  const to = new Date(from.getTime() + 30 * 24 * 60 * 60 * 1000);
  const items = await calendarEvents.list({ from: from.toISOString(), to: to.toISOString() });
  if (!items.length) return 'No events are scheduled in the next 30 days.';
  const lines = items.slice(0, 5).map((e) => `• ${e.title} — ${shortDate(e.startsAt)}`);
  return `Upcoming events:\n${lines.join('\n')}`;
}

async function answerTransport(facts, toolsUsed, actor) {
  if (!['STUDENT', 'PARENT'].includes(actor?.roleKey)) {
    return 'Open Transport in the sidebar to manage routes and bus enrollments.';
  }
  toolsUsed.push('transport.myBus');
  try {
    const bus = await transport.getOwnBus(actor);
    if (!bus) return 'No bus route is assigned yet — contact the school office to enroll.';
    return `Your bus: Route ${bus.route.name} (${bus.route.vehicleNo ?? 'vehicle TBD'}), driver ${bus.route.driverName ?? 'TBD'}. Stop: ${bus.stop.name}.`;
  } catch {
    return 'No bus route is assigned yet — contact the school office to enroll.';
  }
}

async function answerDocuments(facts, toolsUsed, actor) {
  if (!actor?.roleKey) return 'Open Documents in the sidebar to view your files.';
  toolsUsed.push('documents.list');
  const scope = actor.permissions?.['materials.read'] ?? 'OWN';
  const docs = await documents.listForActor(actor, scope);
  if (!docs.length) return 'No documents have been published for you yet.';
  const lines = docs.slice(0, 3).map((d) => `• ${d.title} (${d.type.replace('_', ' ')})`);
  return `Your recent documents:\n${lines.join('\n')}\nOpen Documents in the sidebar for the full list and downloads.`;
}

/**
 * Each intent lists the phrases/words that identify it. A match on a
 * multi-word phrase (contains a space) outweighs a match on a bare word —
 * this is what lets "assignments due" beat plain "due" (shared with fees)
 * and "exam results"/"test scores" route to grades instead of the exam
 * schedule intent, without needing to hand-order every pair.
 */
const INTENTS = [
  { key: 'attendance', patterns: [/\battendance\b/i, /\babsent\b/i, /\bpresent\b/i], answer: answerAttendance },
  { key: 'library', patterns: [/\bbook(s)?\b/i, /\blibrary\b/i, /\blending\b/i, /\bcatalog\b/i, /\boverdue book(s)?\b/i], answer: answerLibrary },
  { key: 'hostel', patterns: [/\bhostel\b/i, /\broom\b/i, /\bdorm\b/i, /\ballocation\b/i], answer: answerHostel },
  { key: 'transport', patterns: [/\btransport\b/i, /\bbus\b/i, /\bpickup\b/i, /\bdrop\b/i, /\bschool bus\b/i, /\bbus route\b/i], answer: answerTransport },
  { key: 'fees', patterns: [/\bfee(s)?\b/i, /\binvoice\b/i, /\bpayment\b/i, /\bpaid\b/i, /\bdue\b/i], answer: answerFees },
  {
    key: 'assignments',
    patterns: [/\bassignment(s)?\b/i, /\bhomework\b/i, /\bsubmit\b/i, /\bpending work\b/i, /\bproject(s)?\b/i, /\bdue\b/i],
    answer: answerAssignments,
  },
  { key: 'grades', patterns: [/\bgrade(s)?\b/i, /\bmarks?\b/i, /\bresult(s)?\b/i, /\bscore(s)?\b/i, /\bperformance\b/i, /\bacademic performance\b/i, /\btest scores?\b/i, /\bexam results?\b/i, /\bmy marks\b/i], answer: answerGrades },
  { key: 'timetable', patterns: [/\btimetable\b/i, /\bschedule\b/i, /\bperiod\b/i, /\bclass today\b/i], answer: answerTimetable },
  { key: 'subjects', patterns: [/\bsubjects?\b/i, /\bwhat.*(study|studying)\b/i], answer: answerSubjects },
  { key: 'teachers', patterns: [/\bteacher(s)?\b/i, /\bwho teaches\b/i, /\bfaculty\b/i], answer: answerTeachers },
  { key: 'announcements', patterns: [/\bannouncement(s)?\b/i, /\bnotice(s)?\b/i, /\bcircular(s)?\b/i], answer: answerAnnouncements },
  { key: 'calendar', patterns: [/\bcalendar\b/i, /\bholiday(s)?\b/i, /\bupcoming event(s)?\b/i, /\bschool event(s)?\b/i], answer: answerCalendar },
  { key: 'documents', patterns: [/\bdocument(s)?\b/i, /\breport card\b/i, /\btransfer certificate\b/i, /\btc\b/i, /\bletter\b/i], answer: answerDocuments },
  { key: 'exams', patterns: [/\bupcoming exams?\b/i, /\bexam schedule\b/i, /\bexam date\b/i, /\btest schedule\b/i, /\bexam\b/i, /\btest\b/i], answer: answerExams },
  { key: 'school', patterns: [/\bschool\b/i, /\bstudents\b/i, /\boverview\b/i, /\bsnapshot\b/i, /\bhow many\b/i], answer: answerSchool },
];

const HELP =
  'I can answer from your school data: try "attendance", "fees", "assignments", "grades", "timetable", "subjects", "teachers", "announcements", "calendar", "transport", "library", or "documents".';

function scoreIntent(message, patterns) {
  let score = 0;
  for (const p of patterns) {
    if (p.test(message)) score += p.source.includes(' ') ? 2 : 1;
  }
  return score;
}

export async function chat({ message, conversationId }, actor) {
  const convId = conversationId ?? `conv-${crypto.randomBytes(6).toString('hex')}`;
  const toolsUsed = [];

  let facts = { role: actor?.roleKey };
  try {
    facts = await loadFacts(actor);
  } catch {
    // Fall through — intents degrade to navigation hints when data is missing.
  }

  let best = null;
  let bestScore = 0;
  for (const intent of INTENTS) {
    const score = scoreIntent(message, intent.patterns);
    if (score > bestScore) {
      best = intent;
      bestScore = score;
    }
  }

  let reply;
  if (best) {
    try {
      reply = await best.answer(facts, toolsUsed, actor);
    } catch {
      reply = "Something went wrong fetching that — please try again in a moment.";
    }
  } else {
    reply = HELP;
  }

  return {
    conversationId: convId,
    reply,
    toolsUsed,
    provider: env.AI_PROVIDER,
    isStandIn: env.AI_PROVIDER === 'rules',
  };
}
