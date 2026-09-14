import crypto from 'crypto';
import { env } from '../../config/env.js';
import { generateFromAudio } from '../../providers/ai.provider.js';
import { AppError } from '../../utils/AppError.js';
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
import { chunkText } from '../../utils/chunker.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const rupees = (n) => '₹' + Number(n ?? 0).toLocaleString('en-IN');
const shortDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—');

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

async function answerAttendance(actor, toolsUsed) {
  const role = actor?.roleKey;
  if (role === 'STUDENT') {
    toolsUsed.push('attendance.summary');
    const student = await dashboard.getStudentDashboard(actor.profileId);
    if (student.totalDays === 0) return 'No attendance has been recorded for you yet this term.';
    return `Your attendance is ${student.attendancePercentage}% — present ${student.presentDays} of ${student.totalDays} recorded days.`;
  }
  if (role === 'PARENT') {
    toolsUsed.push('attendance.summary');
    const parent = await dashboard.getParentDashboard(actor.profileId);
    const kids = parent.linkedChildren;
    if (!kids?.length) return 'No children are linked to your account yet — please contact the school office.';
    return kids
      .map((k) => `${k.name}: ${k.attendance.percentage}% attendance (${k.attendance.present}/${k.attendance.total} days)`)
      .join('\n');
  }
  if (role === 'TEACHER') {
    toolsUsed.push('attendance.today');
    const teacher = await dashboard.getTeacherDashboard(actor.profileId);
    const a = teacher.attendanceSummary;
    const marked = Object.values(a).reduce((x, y) => x + y, 0);
    if (marked === 0) return "Today's attendance hasn't been marked yet for your classes.";
    return `Today across your classes: ${a.PRESENT} present, ${a.ABSENT} absent, ${a.LATE} late, ${a.EXCUSED} excused.`;
  }
  return 'Open Attendance in the sidebar for school-wide attendance trends.';
}

async function answerFees(actor, toolsUsed) {
  const role = actor?.roleKey;
  if (role === 'STUDENT') {
    toolsUsed.push('fees.summary');
    const student = await dashboard.getStudentDashboard(actor.profileId);
    const f = student.feeStatus;
    if (f.totalFees === 0) return 'No fee invoices have been raised for you yet.';
    return `Fees: ${rupees(f.paidFees)} paid of ${rupees(f.totalFees)} billed — ${rupees(f.pendingFees)} pending across ${f.pendingInvoices} invoice(s).`;
  }
  if (role === 'PARENT') {
    toolsUsed.push('fees.summary');
    const parent = await dashboard.getParentDashboard(actor.profileId);
    if (!parent.feeInvoices?.length) return 'No fee invoices have been raised for your children yet.';
    return `Pending fees for your family: ${rupees(parent.pendingFees)}. You can pay online from Payments in the sidebar.`;
  }
  if (['OWNER', 'ADMIN', 'PRINCIPAL', 'FINANCE'].includes(role)) {
    toolsUsed.push('fees.summary');
    const f = await fees.getSummary(actor, 'ALL');
    return `School fee health: ${rupees(f.totalCollectedPaise / 100)} collected of ${rupees(f.totalBilledPaise / 100)} billed (${f.collectionPct}% collection rate), ${f.pendingCount} invoice(s) still open.`;
  }
  return 'Fee information is available to parents, students, and school staff.';
}

async function answerAssignments(actor, toolsUsed) {
  const role = actor?.roleKey;
  if (role === 'STUDENT' || role === 'PARENT') {
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
  if (role === 'TEACHER') {
    toolsUsed.push('submissions.pending');
    const teacher = await dashboard.getTeacherDashboard(actor.profileId);
    const n = teacher.pendingAssignmentEvaluations;
    return n === 0
      ? 'No submissions are waiting for grading.'
      : `${n} submission${n > 1 ? 's are' : ' is'} waiting for your grading in Assignments.`;
  }
  return 'Assignments are managed per class — teachers create them, students submit from their portal.';
}

async function answerGrades(actor, toolsUsed) {
  const role = actor?.roleKey;
  if (role !== 'STUDENT' && role !== 'PARENT') {
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

async function answerTimetable(actor, toolsUsed) {
  const role = actor?.roleKey;
  let slots = null;
  if (role === 'STUDENT') slots = (await dashboard.getStudentDashboard(actor.profileId)).todayTimetable;
  else if (role === 'TEACHER') slots = (await dashboard.getTeacherDashboard(actor.profileId)).todayTimetable;
  else if (role === 'PARENT') slots = (await dashboard.getParentDashboard(actor.profileId)).timetable;

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

async function answerExams(actor, toolsUsed) {
  const role = actor?.roleKey;
  let exams = null;
  if (role === 'STUDENT') exams = (await dashboard.getStudentDashboard(actor.profileId)).examSchedule;
  else if (role === 'TEACHER') exams = (await dashboard.getTeacherDashboard(actor.profileId)).upcomingExams;
  else if (role === 'PARENT') exams = (await dashboard.getParentDashboard(actor.profileId)).upcomingExams;

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

async function answerSchool(actor, toolsUsed) {
  if (['OWNER', 'ADMIN', 'PRINCIPAL'].includes(actor?.roleKey)) {
    toolsUsed.push('analytics.school');
    const a = await dashboard.getAdminDashboard();
    return `School snapshot: ${a.totalStudents} active students, ${a.openTickets} open tickets, ${a.announcementsCount} announcements published.`;
  }
  return 'School-wide analytics are available to admins, owners, and principals.';
}

async function answerLibrary(actor, toolsUsed) {
  if (['LIBRARIAN', 'OWNER', 'ADMIN', 'PRINCIPAL'].includes(actor?.roleKey)) {
    toolsUsed.push('library.summary');
    const l = await library.getSummary();
    return `Library: ${l.totalCatalogBooks} books in the catalog (${l.uniqueTitles} titles), ${l.activeBookIssues} currently on loan, ${l.overdueReturns} overdue.`;
  }
  if (actor?.roleKey === 'STUDENT') {
    toolsUsed.push('library.myIssues');
    const issues = await library.listIssues(actor, 'OWN', {});
    const borrowed = issues.filter((i) => i.status !== 'RETURNED');
    if (!borrowed.length) return 'You have no books currently borrowed from the library.';
    const lines = borrowed.slice(0, 5).map((i) => `• ${i.bookTitle} — due ${shortDate(i.dueAt)}${i.status === 'OVERDUE' ? ' (overdue)' : ''}`);
    return `Books you've borrowed:\n${lines.join('\n')}`;
  }
  return 'Library catalog and lending data is available to librarians, admins, and owners.';
}

async function answerHostel(actor, toolsUsed) {
  if (['WARDEN', 'OWNER', 'ADMIN', 'PRINCIPAL'].includes(actor?.roleKey)) {
    toolsUsed.push('hostel.summary');
    const h = await hostel.getSummary();
    return `Hostel: ${h.occupiedBeds}/${h.totalCapacity} beds occupied (${h.occupancyRate}%), ${h.availableBeds} available across ${h.totalRooms} rooms. ${h.hostelInquiries} open inquiries.`;
  }
  return 'Hostel occupancy and allocation data is available to wardens, admins, and owners.';
}

async function answerSubjects(actor, toolsUsed) {
  if (!['STUDENT', 'PARENT', 'TEACHER'].includes(actor?.roleKey)) {
    return 'Open Academic Setup in the sidebar to manage subjects.';
  }
  toolsUsed.push('academics.offerings');
  const offerings = await getMyOfferings(actor);
  if (!offerings.length) return 'No subjects are set up for your class yet.';
  const names = [...new Set(offerings.map((o) => o.subjectId?.name).filter(Boolean))];
  return `Your subjects: ${names.join(', ')}.`;
}

async function answerTeachers(actor, toolsUsed) {
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

async function answerAnnouncements(actor, toolsUsed) {
  toolsUsed.push('announcements.list');
  // Same audience filter the announcements screen uses, so the copilot cannot
  // read out a notice the asker was not addressed in.
  const items = await announcements.list(actor);
  if (!items.length) return 'No announcements have been published yet.';
  const lines = items.slice(0, 5).map((a) => `• ${a.title} — ${shortDate(a.publishedAt)}`);
  return `Latest announcements:\n${lines.join('\n')}`;
}

async function answerCalendar(actor, toolsUsed) {
  toolsUsed.push('calendar.list');
  const from = new Date();
  const to = new Date(from.getTime() + 30 * 24 * 60 * 60 * 1000);
  const items = await calendarEvents.list({ from: from.toISOString(), to: to.toISOString() });
  if (!items.length) return 'No events are scheduled in the next 30 days.';
  const lines = items.slice(0, 5).map((e) => `• ${e.title} — ${shortDate(e.startsAt)}`);
  return `Upcoming events:\n${lines.join('\n')}`;
}

async function answerTransport(actor, toolsUsed) {
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

async function answerDocuments(actor, toolsUsed) {
  if (!actor?.roleKey) return 'Open Documents in the sidebar to view your files.';
  toolsUsed.push('documents.list');
  const scope = actor.permissions?.['materials.read'] ?? 'OWN';
  const docs = await documents.listForActor(actor, scope);
  if (!docs.length) return 'No documents have been published for you yet.';
  const lines = docs.slice(0, 3).map((d) => `• ${d.title} (${d.type.replace('_', ' ')})`);
  return `Your recent documents:\n${lines.join('\n')}\nOpen Documents in the sidebar for the full list and downloads.`;
}

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

// In-memory simple RAG over announcements as an example of unstructured data fallback
async function handleRagFallback(message, actor, toolsUsed) {
  toolsUsed.push('rag.search');
  
  // 1. Fetch unstructured data
  const anns = await announcements.list();
  
  // 2. Chunk it
  let allChunks = [];
  for (const a of anns) {
     const text = `Announcement: ${a.title}\n${a.content}`;
     const chunks = chunkText(text, 200, 20);
     allChunks.push(...chunks);
  }
  
  // Simple TF-IDF / Keyword search since we don't have a Vector DB set up
  const queryWords = message.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  const scoredChunks = allChunks.map(chunk => {
      let score = 0;
      const lowerChunk = chunk.toLowerCase();
      for (const w of queryWords) {
          if (lowerChunk.includes(w)) score++;
      }
      return { chunk, score };
  });
  
  scoredChunks.sort((a, b) => b.score - a.score);
  const bestChunks = scoredChunks.slice(0, 3).filter(c => c.score > 0).map(c => c.chunk);
  
  if (bestChunks.length === 0 || bestChunks[0].score === 0) {
      return HELP;
  }
  
  // Use Gemini LLM to answer the question
  try {
      if (!env.GEMINI_API_KEY) {
         return "I found some information, but AI generation is disabled: \n" + bestChunks.map(c => "- " + c).join('\n');
      }
      const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const prompt = `Answer the user's question using the provided context from the school's unstructured data. Keep it concise.
      
      Context:
      ${bestChunks.join('\n---\n')}
      
      Question: ${message}
      `;
      const result = await model.generateContent(prompt);
      return result.response.text();
  } catch (err) {
      return "I found relevant information but failed to generate an answer: " + err.message;
  }
}

export async function chat({ message, conversationId }, actor) {
  const convId = conversationId ?? `conv-${crypto.randomBytes(6).toString('hex')}`;
  const toolsUsed = [];

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
      reply = await best.answer(actor, toolsUsed);
    } catch (err) {
      reply = "Something went wrong fetching that — please try again in a moment.";
    }
  } else {
    reply = await handleRagFallback(message, actor, toolsUsed);
  }

  return {
    conversationId: convId,
    reply,
    toolsUsed,
    provider: env.AI_PROVIDER,
    isStandIn: env.AI_PROVIDER === 'rules',
  };
}

export async function transcribeAudio({ audioBase64, mediaType = 'audio/webm' }) {
  if (!audioBase64) throw new AppError('audioBase64 is required', 400);

  const system = `You are a speech-to-text transcriber and automatic language detector for an ERP system.
Listen to the user's spoken audio carefully.
Perform two tasks:
1. Transcribe the spoken text accurately into text. If spoken in Hindi/Hinglish (e.g. "Meri attendance kitni hai" or "मेरी उपस्थिति कितनी है"), capture the exact spoken words.
2. Detect the spoken language and assign its 2-letter ISO tag ('en' for English, 'hi' for Hindi/Hinglish/Marathi, 'bn' for Bengali, 'ta' for Tamil, 'te' for Telugu, 'gu' for Gujarati, 'pa' for Punjabi, 'kn' for Kannada, 'ml' for Malayalam, 'ur' for Urdu).

Output MUST be a JSON object with keys "transcript" and "lang":
{"transcript": "transcribed text here", "lang": "en"}
Do NOT include markdown formatting or commentary.`;

  const message = "Transcribe this audio clip and detect its language.";
  const res = await generateFromAudio({ system, message, audioBase64, mediaType });

  if (!res.generated || !res.text) {
    return { transcript: '', lang: 'en', confident: false, reason: res.reason ?? 'TRANSCRIPTION_FAILED' };
  }

  try {
    const cleaned = res.text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      transcript: parsed.transcript ?? '',
      lang: parsed.lang ?? 'en',
      confident: true,
    };
  } catch {
    return {
      transcript: res.text.trim(),
      lang: 'en',
      confident: false,
    };
  }
}

