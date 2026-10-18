import { HealthVisit, HealthEntry } from '../../models/health.model.js';
import { Student, Enrollment } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { decrypt } from '../../utils/crypto.js';
import { recordPiiRead, recordAudit } from '../../utils/auditTrail.js';
import { logger } from '../../utils/logger.js';
import { periodFromDates } from '../../utils/periods.js';
import { classLabel, studentLabel, istYmd, istHm } from '../ptm/relations.js';

/**
 * The nurse's watch list (part 4, nurse audit), computed from the health room's
 * own records and shown only to the school nurse (health.manage at ALL):
 *
 *   clusters         three or more visits with a similar complaint (fever,
 *                    stomach, cough and cold, rash, eye) from one class within
 *                    a few days: a possible outbreak to look into
 *   frequentVisitors children seen four or more times in 30 days, which is often
 *                    worth a quiet word with the parents or the counsellor
 *   immunisationsDue next doses recorded as due in the coming weeks (or overdue)
 *   screeningCoverage how many children in each class have this year's screening,
 *                    and screenings that need a follow-up (BMI out of range,
 *                    vision below 6/9, a dental or hearing remark)
 *   registerCsv      the health-room register for a date range
 *
 * These are prompts for the nurse, with the visits behind each; nothing is
 * decided or sent. The complaint words are matched on the server after
 * decryption and never leave this module except to the nurse. Every read is
 * audited like the Health page's own.
 */

const DAY = 86_400_000;
const CATEGORIES = [
  { key: 'FEVER', label: 'Fever / flu-like', re: /fever|temperature|flu|chill|body ?ache|viral/i },
  { key: 'GASTRO', label: 'Stomach / vomiting / diarrhoea', re: /stomach|vomit|nause|diarr|loose motion|gastr|abdom|tummy/i },
  { key: 'RESPIRATORY', label: 'Cough / cold / breathing', re: /cough|cold|sneez|throat|breath|asthma|wheez|runny/i },
  { key: 'SKIN', label: 'Rash / skin', re: /rash|itch|spots|chicken ?pox|hives|skin|scabies|lice/i },
  { key: 'EYE', label: 'Eye (red, sticky)', re: /\beye|conjunctiv|pink ?eye/i },
  { key: 'HEADACHE', label: 'Headache / dizziness', re: /head ?ache|migraine|dizz|faint/i },
];
const categoryOf = (text) => CATEGORIES.find((c) => c.re.test(String(text ?? '')))?.key ?? null;
const dec = (v, fallback = null) => { try { return decrypt(v) ?? fallback; } catch (err) { logger.error(`Health record could not be decrypted: ${err.message}`); return fallback; } };

function assertNurse(actor) {
  if (actor?.permissions?.['health.manage'] !== 'ALL') throw new AppError('Only the school nurse (health.manage) can see this.', 403, [], 'HEALTH_RESTRICTED');
  if (!actor.profileId) throw new AppError('Select a profile first', 403);
}

async function classOf(studentIds) {
  const unique = [...new Set(studentIds.map(String))];
  const [students, enrolments] = await Promise.all([
    Student.find({ _id: { $in: unique } }).select('firstName lastName admissionNo').lean(),
    Enrollment.find({ studentId: { $in: unique }, status: 'ACTIVE' }).populate({ path: 'sectionId', select: 'name gradeId', populate: { path: 'gradeId', select: 'name' } }).lean(),
  ]);
  const out = new Map(students.map((s) => [String(s._id), { name: studentLabel(s), admissionNo: s.admissionNo, className: null, sectionId: null }]));
  for (const e of enrolments) {
    const r = out.get(String(e.studentId));
    if (r) { r.className = classLabel(e.sectionId); r.sectionId = String(e.sectionId?._id ?? e.sectionId); }
  }
  return out;
}

export async function insights(actor, query = {}, { now = new Date() } = {}) {
  assertNurse(actor);
  const windowDays = Math.min(Math.max(Number.parseInt(query.windowDays, 10) || 3, 1), 14);
  const threshold = Math.min(Math.max(Number.parseInt(query.threshold, 10) || 3, 2), 20);
  const since30 = new Date(now.getTime() - 30 * DAY);
  const visits = await HealthVisit.find({ arrivedAt: { $gte: since30 } }).sort({ arrivedAt: -1 }).lean();
  const who = await classOf(visits.map((v) => v.studentId));

  // Clusters: per class and category, visits within the window ending at the latest one.
  const groups = new Map();
  for (const v of visits) {
    const cat = categoryOf(dec(v.complaintEnc));
    const c = who.get(String(v.studentId));
    if (!cat || !c?.sectionId) continue;
    const key = `${c.sectionId}:${cat}`;
    groups.set(key, [...(groups.get(key) ?? []), { v, c, cat }]);
  }
  const clusters = [];
  for (const rows of groups.values()) {
    rows.sort((a, b) => b.v.arrivedAt - a.v.arrivedAt);
    const latest = rows[0].v.arrivedAt;
    const inWindow = rows.filter((r) => latest - r.v.arrivedAt <= windowDays * DAY);
    const children = new Set(inWindow.map((r) => String(r.v.studentId)));
    if (children.size < threshold) continue;
    const cat = CATEGORIES.find((x) => x.key === rows[0].cat);
    clusters.push({
      className: rows[0].c.className, category: cat.key, label: cat.label, children: children.size, visits: inWindow.length,
      from: istYmd(inWindow.at(-1).v.arrivedAt), to: istYmd(latest), recent: now - latest <= 2 * DAY,
      evidence: inWindow.map((r) => ({ ref: r.v.refNo, student: r.c.name, on: istYmd(r.v.arrivedAt), at: istHm(r.v.arrivedAt), outcome: r.v.outcome, complaint: dec(r.v.complaintEnc) })),
      suggestion: 'Check whether these children share a cause (a class trip, the canteen, water); consider a note to the class parents and the principal, and the local health authority if a notifiable disease is suspected.',
    });
  }
  clusters.sort((a, b) => Number(b.recent) - Number(a.recent) || b.children - a.children);

  // Frequent visitors in 30 days.
  const byChild = new Map();
  for (const v of visits) byChild.set(String(v.studentId), [...(byChild.get(String(v.studentId)) ?? []), v]);
  const frequent = [...byChild.entries()].filter(([, vs]) => vs.length >= 4).map(([id, vs]) => ({
    studentId: id, student: who.get(id)?.name ?? null, className: who.get(id)?.className ?? null, visits: vs.length,
    sentHome: vs.filter((v) => v.outcome === 'SENT_HOME').length, lastOn: istYmd(vs[0].arrivedAt),
    complaints: [...new Set(vs.map((v) => CATEGORIES.find((c) => c.key === categoryOf(dec(v.complaintEnc)))?.label ?? 'Other'))],
    suggestion: 'Several visits in a month can point to an untreated condition, stress or something at school; a call to the parents, or the counsellor if there is a welfare worry.',
  })).sort((a, b) => b.visits - a.visits);

  // Immunisations: next doses due in the coming weeks, or overdue.
  const aheadDays = Math.min(Math.max(Number.parseInt(query.aheadDays, 10) || 30, 1), 365);
  const todayYmd = istYmd(now);
  const until = istYmd(new Date(now.getTime() + aheadDays * DAY));
  const entries = await HealthEntry.find({ kind: 'IMMUNISATION' }).sort({ on: -1 }).lean();
  const latestByVaccine = new Map();
  for (const e of entries) {
    const d = dec(e.dataEnc, {});
    const key = `${e.studentId}:${String(d.vaccine ?? '').toLowerCase()}`;
    if (!latestByVaccine.has(key)) latestByVaccine.set(key, { e, d });
  }
  const dueRows = [...latestByVaccine.values()].filter(({ d }) => d.nextDueOn && d.nextDueOn <= until);
  const whoImm = await classOf(dueRows.map((r) => r.e.studentId));
  const immunisationsDue = dueRows.map(({ e, d }) => ({
    studentId: String(e.studentId), student: whoImm.get(String(e.studentId))?.name ?? null, className: whoImm.get(String(e.studentId))?.className ?? null,
    vaccine: d.vaccine, lastDose: d.doseNo ?? null, lastOn: istYmd(e.on), nextDueOn: d.nextDueOn, overdue: d.nextDueOn < todayYmd,
  })).sort((a, b) => a.nextDueOn.localeCompare(b.nextDueOn));

  // Screening coverage this academic year, and follow-ups.
  const ymd = todayYmd; const y = Number(ymd.slice(0, 4)); const m = Number(ymd.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  const academicYear = `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
  const screenings = await HealthEntry.find({ kind: 'SCREENING', academicYear }).lean();
  const screened = new Set(screenings.map((s) => String(s.studentId)));
  const roll = await Enrollment.find({ status: 'ACTIVE' }).populate({ path: 'sectionId', select: 'name gradeId', populate: { path: 'gradeId', select: 'name' } }).select('studentId sectionId').lean();
  const byClass = new Map();
  for (const e of roll) {
    const label = classLabel(e.sectionId) ?? 'Unassigned';
    const r = byClass.get(label) ?? { className: label, students: 0, screened: 0 };
    r.students += 1; if (screened.has(String(e.studentId))) r.screened += 1;
    byClass.set(label, r);
  }
  const coverage = [...byClass.values()].map((r) => ({ ...r, pct: r.students ? Math.round((r.screened / r.students) * 100) : 0 }))
    .sort((a, b) => a.pct - b.pct || a.className.localeCompare(b.className, 'en', { numeric: true }));
  const followUps = [];
  const whoScr = await classOf(screenings.map((s) => s.studentId));
  for (const s of screenings) {
    const d = dec(s.dataEnc, {});
    const reasons = [];
    if (d.bmi && (d.bmi < 14 || d.bmi > 25)) reasons.push(`BMI ${d.bmi}`);
    for (const [eye, val] of [['left', d.visionLeft], ['right', d.visionRight]]) {
      const mm = /^6\/(\d+)$/.exec(String(val ?? '').trim());
      if (mm && Number(mm[1]) > 9) reasons.push(`vision ${eye} ${val}`);
    }
    if (d.dental && !/^(normal|ok|healthy|nad|no issue)/i.test(d.dental)) reasons.push(`dental: ${d.dental}`);
    if (d.hearing && !/^(normal|ok|nad|no issue)/i.test(d.hearing)) reasons.push(`hearing: ${d.hearing}`);
    if (reasons.length) followUps.push({ studentId: String(s.studentId), student: whoScr.get(String(s.studentId))?.name ?? null, className: whoScr.get(String(s.studentId))?.className ?? null, on: istYmd(s.on), reasons });
  }

  await recordPiiRead({ actor, action: 'health.read', entityType: 'HealthRecord', entityId: null, via: 'health.insights', fields: ['complaint', 'immunisations', 'screenings'], count: visits.length + entries.length + screenings.length });
  return {
    generatedAt: now, rules: { clusterWindowDays: windowDays, clusterThreshold: threshold, frequentVisitsIn30Days: 4, immunisationAheadDays: aheadDays },
    clusters, frequentVisitors: frequent, immunisationsDue,
    screening: { academicYear, totalStudents: roll.length, screened: screened.size, byClass: coverage, followUps },
    note: 'Prompts for the nurse, with the visits behind each. Nothing here is a diagnosis, and nothing is sent.',
  };
}

const csvCell = (v) => { const s = v === null || v === undefined ? '' : String(v); const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };

/** The health-room register for a date range (nurse only), as CSV. Audited. */
export async function registerCsv(actor, query = {}) {
  assertNurse(actor);
  const today = istYmd(new Date());
  const p = periodFromDates(String(query.from ?? `${today.slice(0, 8)}01`), String(query.to ?? today));
  if (p.days > 400) throw new AppError('Choose a range of at most 400 days.', 400);
  const visits = await HealthVisit.find({ arrivedAt: { $gte: p.start, $lt: p.end } }).sort({ arrivedAt: 1 }).lean();
  const who = await classOf(visits.map((v) => v.studentId));
  const rows = [['Ref', 'Date', 'In', 'Out', 'Student', 'Admission no', 'Class', 'Complaint', 'Temperature (C)', 'Action', 'Outcome', 'Injury', 'Medicine given', 'Parent told', 'Attended by']];
  for (const v of visits) {
    const c = who.get(String(v.studentId)); const vit = dec(v.vitalsEnc, {}) ?? {};
    rows.push([v.refNo, istYmd(v.arrivedAt), istHm(v.arrivedAt), v.leftAt ? istHm(v.leftAt) : '', c?.name ?? '', c?.admissionNo ?? '', c?.className ?? '', dec(v.complaintEnc) ?? '', vit.temperatureC ?? '', dec(v.actionEnc) ?? '', v.outcome, v.injury ? 'Yes' : 'No', v.medicineGiven ? 'Yes' : 'No', v.parentNotified?.at ? 'Yes' : 'No', v.attendedBy?.name ?? '']);
  }
  await recordPiiRead({ actor, action: 'health.read', entityType: 'HealthRecord', entityId: null, via: 'health.register.csv', fields: ['complaint', 'vitals', 'action'], count: visits.length });
  await recordAudit({ actor, action: 'health.register.exported', entityType: 'HealthRecord', entityId: null, after: { from: p.from, to: p.to, rows: visits.length } });
  return { filename: `health-register-${p.from}-to-${p.to}.csv`, csv: rows.map((r) => r.map(csvCell).join(',')).join('\n') };
}

export const _test = { categoryOf };
// Part 5: the nurse's role dashboard sorts visits into the same broad reasons.
export { CATEGORIES as COMPLAINT_CATEGORIES, categoryOf as complaintCategory };
