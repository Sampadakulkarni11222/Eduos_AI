import mongoose from 'mongoose';
import { AcademicYear, Term, Section, Grade, Subject, SubjectOffering } from '../models/academics.model.js';
import { Enrollment } from '../models/student.model.js';
import { AttendanceRecord } from '../models/attendanceRecord.model.js';
import { Exam, ExamSubject, Mark } from '../models/exam.model.js';
import { Invoice, InvoiceLine, Payment, FeeHead, FeeStructure } from '../models/fee.model.js';
import { Assignment, Submission } from '../models/assignment.model.js';
import { CalendarEvent } from '../models/calendarEvent.model.js';
import { Counter } from '../models/counter.model.js';
import { gradeForPercentage, percentage } from '../utils/grading.js';
import { currentTenantId } from '../tenancy/tenantContext.js';

/**
 * Part-3 sample data: volume and history for every portal (all FICTIONAL).
 *
 * The earlier sections give each screen something to open; this one makes the
 * school look lived-in: a term and a half of daily registers plus the whole of
 * last year (so year-on-year comparisons have a baseline), several published
 * exams, fee invoices with payments spread over the months (some overdue),
 * homework with submissions, library circulation, hostel and transport
 * riders, help-desk tickets, notices and events, enquiries over eighteen
 * months, alumni, staff leave, payslips, tasks for every role and approvals in
 * every state.
 *
 * Volume is written with bulk inserts (a service call per register mark would
 * take minutes); records whose rules matter (approvals, payroll, leave) go
 * through the module services. Every section checks for its own marker first,
 * so running the seed twice adds nothing. Random numbers come from a fixed
 * seed, so two runs produce the same school.
 *
 * Not here on purpose: timetables, shifts, bell schedules, holidays and
 * teacher qualifications (Campus World seed) and health records (health seed).
 */
const DAY = 86_400_000;
const { ObjectId } = mongoose.Types;

/** Deterministic pseudo-random numbers (mulberry32), so every run builds the same school. */
export function rng(seed = 20261015) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const utcDay = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const ymdOf = (d) => d.toISOString().slice(0, 10);
/** Today's date in the school's time zone (India), as the UTC-midnight key registers use. */
const localToday = (now = new Date()) => { const ist = new Date(now.getTime() + 330 * 60_000); return utcDay(ist.getUTCFullYear(), ist.getUTCMonth() + 1, ist.getUTCDate()); };
/** A moment on a given day at an India-time hour. */
const atIst = (day, hour = 10, minute = 0) => new Date(day.getTime() + (hour * 60 + minute - 330) * 60_000);

// National and festival days the school is closed (in addition to any HOLIDAY on the calendar).
const FIXED_HOLIDAYS = new Set([
  '2025-08-15', '2025-08-27', '2025-10-02', '2025-10-20', '2025-10-21', '2025-10-22', '2025-10-23', '2025-10-24',
  '2025-12-25', '2025-12-26', '2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-26', '2026-03-04', '2026-03-31',
  '2026-08-15', '2026-09-14', '2026-10-02',
]);

async function holidaySet() {
  const set = new Set(FIXED_HOLIDAYS);
  const events = await CalendarEvent.find({ type: 'HOLIDAY', deletedAt: null }).select('startsAt endsAt').lean().catch(() => []);
  for (const e of events) {
    for (let t = utcDay(...ymdOf(new Date(e.startsAt)).split('-').map(Number)).getTime(); t <= new Date(e.endsAt).getTime(); t += DAY) set.add(ymdOf(new Date(t)));
  }
  return set;
}

/** School days (Monday to Friday, not a holiday) from `from` up to and including `to`. */
function schoolDays(from, to, holidays) {
  const out = [];
  for (let t = from.getTime(); t <= to.getTime(); t += DAY) {
    const d = new Date(t);
    const wd = d.getUTCDay();
    if (wd === 0 || wd === 6 || holidays.has(ymdOf(d))) continue;
    out.push(d);
  }
  return out;
}

/** Inserts in chunks, bypassing per-document work; every field (and tenantId) must be on the docs. */
async function bulk(Model, docs, { chunk = 5000, lean = true } = {}) {
  const tenantId = currentTenantId();
  for (let i = 0; i < docs.length; i += chunk) {
    const part = docs.slice(i, i + chunk);
    if (tenantId) for (const d of part) d.tenantId = tenantId;
    // The driver directly when the docs are complete (no casting or defaults needed): several times faster.
    // eslint-disable-next-line no-await-in-loop
    if (lean) await Model.collection.insertMany(part, { ordered: false });
    // eslint-disable-next-line no-await-in-loop
    else await Model.insertMany(part, { ordered: false, timestamps: false });
  }
  return docs.length;
}

/** Reserves `n` numbers from a counter series and returns the first. */
async function reserve(key, n) {
  const c = await Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: n } }, { upsert: true, new: true }).lean();
  return c.seq - n + 1;
}

export async function seedP3SampleData({ section, attempt, who, teachers = [], actorOf, roleByKey }) {
  const { TEACHER } = who;
  const now = new Date();
  const today = localToday(now);
  const random = rng();
  const pick = (arr) => arr[Math.floor(random() * arr.length)];
  const holidays = await holidaySet();

  const year = await AcademicYear.findOne({ isCurrent: true }).lean() ?? await AcademicYear.findOne({}).sort({ startsOn: -1 }).lean();
  if (!year) return;
  const sections = await Section.find({}).sort({ _id: 1 }).lean();
  const grades = await Grade.find({}).lean();
  const gradeOf = new Map(grades.map((g) => [String(g._id), g]));
  const sectionLabel = (s) => `${gradeOf.get(String(s.gradeId))?.name ?? ''} ${s.name}`.trim();
  const enrolments = await Enrollment.find({ academicYearId: year._id, status: 'ACTIVE' }).sort({ sectionId: 1, rollNo: 1 }).select('_id studentId sectionId rollNo').lean();
  const coreOfferings = await SubjectOffering.find({ isElective: { $ne: true } }).sort({ sectionId: 1, _id: 1 }).lean();
  const sectionById = new Map(sections.map((s) => [String(s._id), s]));
  const bySection = new Map();
  for (const e of enrolments) { const k = String(e.sectionId); if (!bySection.has(k)) bySection.set(k, []); bySection.get(k).push(e); }
  const markerFor = (s) => s.classTeacherId ?? TEACHER?.profile._id ?? null;

  // Each pupil keeps the same habits all year: most attend nearly every day, a
  // few are often away, and their marks sit around their own level.
  const pupil = new Map();
  for (const e of enrolments) {
    const r = random();
    const attend = r < 0.82 ? 0.94 + random() * 0.055 : r < 0.96 ? 0.83 + random() * 0.09 : 0.66 + random() * 0.14;
    const ability = 48 + random() * 47;
    pupil.set(String(e._id), { attend, ability, late: random() < 0.15 ? 0.06 : 0.015 });
  }

  // ── The previous academic year, so last year's figures have a home ─────
  let lastYear = await AcademicYear.findOne({ name: '2025-26' }).lean();
  await section('Previous academic year (2025-26)', null, async () => {
    if (lastYear) return 'kept';
    lastYear = (await AcademicYear.create({ name: '2025-26', startsOn: utcDay(2025, 6, 1), endsOn: utcDay(2026, 5, 31), isCurrent: false })).toObject();
    await Term.create({ academicYearId: lastYear._id, name: 'Term 1 (2025-26)', startsOn: utcDay(2025, 6, 1), endsOn: utcDay(2025, 11, 30) });
    await Term.create({ academicYearId: lastYear._id, name: 'Term 2 (2025-26)', startsOn: utcDay(2025, 12, 1), endsOn: utcDay(2026, 5, 31) });
    return 'the 2025-26 year with two terms (closed), for last year\'s exams and comparisons';
  });

  // ── Daily registers: this year since June, and all of last year ─────────
  await section('Attendance history (this year and last)', null, async () => {
    if (await AttendanceRecord.exists({ periodNo: null, date: { $lt: utcDay(2025, 7, 1) } })) return 'kept';
    const thisYearDays = schoolDays(utcDay(2026, 6, 1), new Date(today.getTime() - DAY), holidays);
    const lastYearDays = schoolDays(utcDay(2025, 6, 2), utcDay(2026, 4, 30), holidays);
    // Days already marked (the last fortnight from the school seed, today from "Today's attendance") are left alone.
    const marked = new Set((await AttendanceRecord.distinct('date', { periodNo: null })).map((d) => ymdOf(new Date(d))));
    let n = 0;
    const write = async (days, drift) => {
      for (const day of days) {
        if (marked.has(ymdOf(day))) continue;
        const docs = [];
        const stamp = atIst(day, 9, 20);
        // A few pupils are away together in the monsoon and before the winter break.
        const m = day.getUTCMonth() + 1;
        const seasonal = m === 7 || m === 8 ? -0.02 : m === 12 ? -0.015 : 0;
        for (const e of enrolments) {
          const p = pupil.get(String(e._id));
          const r = random();
          const attend = Math.min(0.995, p.attend + drift + seasonal);
          let status = 'PRESENT'; let note = '';
          if (r > attend) { const k = random(); status = k < 0.12 ? 'EXCUSED' : k < 0.2 ? 'HALF_DAY' : 'ABSENT'; note = status === 'EXCUSED' ? 'Leave approved' : status === 'HALF_DAY' ? 'Left after lunch' : pick(['Fever', 'Family function', 'Not well', '', '']); }
          else if (random() < p.late) { status = 'LATE'; note = pick(['Late bus', 'Traffic', 'Late']); }
          docs.push({ _id: new ObjectId(), enrollmentId: e._id, date: day, periodNo: null, status, source: 'WEB', markedByProfileId: markerFor(sectionById.get(String(e.sectionId)) ?? {}), note, createdAt: stamp, updatedAt: stamp });
        }
        // eslint-disable-next-line no-await-in-loop
        n += await bulk(AttendanceRecord, docs);
      }
    };
    await write(thisYearDays, 0);
    await write(lastYearDays, -0.012);
    return `${n} register marks: ${thisYearDays.length} school days this year and ${lastYearDays.length} last year (holidays and weekends skipped)`;
  });

  // ── Published exams: this year's periodic tests and last year's papers ──
  await section('Exam history (published results)', null, async () => {
    if (await Exam.exists({ name: 'Periodic Test 1' })) return 'kept';
    const thisTerm = await Term.findOne({ academicYearId: year._id, startsOn: { $lte: now } }).sort({ startsOn: -1 }).lean() ?? await Term.findOne({ academicYearId: year._id }).lean();
    const lastTerms = lastYear ? await Term.find({ academicYearId: lastYear._id }).sort({ startsOn: 1 }).lean() : [];
    const plans = [
      { name: 'Periodic Test 1', termId: thisTerm._id, from: utcDay(2026, 7, 20), max: 25, drift: 0 },
      { name: 'Class Test (October)', termId: thisTerm._id, from: utcDay(2026, 10, 5), max: 20, drift: 1.5 },
      ...(lastTerms[0] ? [{ name: 'Half-Yearly Examination 2025-26', termId: lastTerms[0]._id, from: utcDay(2025, 9, 15), max: 80, drift: -3 }] : []),
      ...(lastTerms[1] ? [{ name: 'Annual Examination 2025-26', termId: lastTerms[1]._id, from: utcDay(2026, 3, 2), max: 80, drift: -1.5 }] : []),
    ].filter((p) => p.from < today);
    const subjects = new Map((await Subject.find({}).lean()).map((s) => [String(s._id), s]));
    const subjectBias = { MATH: -4, SCI: -1, ENG: 3, SOC: 1, COMP: 4 };
    let marks = 0;
    for (const plan of plans) {
      const papers = [];
      const order = new Map();
      for (const o of coreOfferings) {
        const k = String(o.sectionId);
        const i = order.get(k) ?? 0; order.set(k, i + 1);
        const examDate = new Date(plan.from.getTime() + i * DAY);
        papers.push({ _id: new ObjectId(), examId: null, subjectOfferingId: o._id, examDate, maxMarks: plan.max, offering: o });
      }
      const last = papers.reduce((m, p) => (p.examDate > m ? p.examDate : m), plan.from);
      // eslint-disable-next-line no-await-in-loop
      const exam = await Exam.create({ termId: plan.termId, name: plan.name, startsOn: plan.from, endsOn: last });
      const published = new Date(Math.min(now.getTime() - DAY, last.getTime() + 6 * DAY));
      const markDocs = [];
      for (const p of papers) {
        p.examId = exam._id;
        const bias = subjectBias[subjects.get(String(p.offering.subjectId))?.code] ?? 0;
        for (const e of bySection.get(String(p.offering.sectionId)) ?? []) {
          const pp = pupil.get(String(e._id));
          const absent = random() < 0.025;
          const pct = Math.max(18, Math.min(100, pp.ability + bias + plan.drift + (random() - 0.5) * 22));
          const m = absent ? null : Math.round((pct / 100) * p.maxMarks);
          markDocs.push({
            _id: new ObjectId(), examSubjectId: p._id, enrollmentId: e._id, marks: m, absence: absent ? 'AB' : null,
            gradeLabel: absent ? null : gradeForPercentage(percentage(m, p.maxMarks))?.label ?? null,
            remarks: absent ? 'Absent' : pct >= 90 ? 'Outstanding' : pct >= 75 ? 'Very good' : pct >= 55 ? 'Good, keep practising' : 'Needs more practice',
            status: 'PUBLISHED', publishedAt: published, enteredByProfileId: p.offering.teacherId ?? null, createdAt: published, updatedAt: published,
          });
        }
      }
      // eslint-disable-next-line no-await-in-loop
      await bulk(ExamSubject, papers.map(({ offering, ...p }) => ({ ...p, createdAt: plan.from, updatedAt: plan.from })));
      // eslint-disable-next-line no-await-in-loop
      marks += await bulk(Mark, markDocs);
    }
    return `${plans.length} exams with published results (${plans.map((p) => p.name).join(', ')}): ${marks} marks`;
  });

  // ── Fees: annual charges, transport and last year's invoices with payments ──
  await section('Fee history (invoices and payments over the year)', null, async () => {
    if (await Invoice.exists({ invoiceNo: /^ANN-2026-/ })) return 'kept';
    const tenant = currentTenantId() ?? 'platform';
    const heads = {};
    for (const [name, category, hsnSac, gstRateBp] of [['Tuition', 'TUITION', null, null], ['Annual charges', 'ANNUAL', null, null], ['Transport', 'TRANSPORT', null, null], ['Uniform and kit', 'MATERIAL', '6203', 500], ['Activities and clubs', 'ACTIVITY', '999293', 1800]]) {
      // eslint-disable-next-line no-await-in-loop
      heads[name] = await FeeHead.findOneAndUpdate({ name }, { $setOnInsert: { name, category, hsnSac, gstRateBp } }, { upsert: true, new: true }).lean();
    }
    const structures = {};
    for (const [key, head, amount, due, y] of [
      ['annual', 'Annual charges', 1500000, utcDay(2026, 6, 15), year], ['kit', 'Uniform and kit', 450000, utcDay(2026, 6, 15), year], ['activity', 'Activities and clubs', 300000, utcDay(2026, 6, 15), year],
      ['transport', 'Transport', 900000, utcDay(2026, 7, 10), year],
    ]) {
      // eslint-disable-next-line no-await-in-loop
      structures[key] = await FeeStructure.create({ feeHeadId: heads[head]._id, academicYearId: y._id, name: `${head} 2026-27`, amountPaise: amount, dueOn: due });
    }
    const { BusEnrollment } = await import('../models/transport.model.js');
    const riders = new Set((await BusEnrollment.find({}).select('studentId').lean()).map((b) => String(b.studentId)));
    const invoices = []; const lines = []; const payments = [];
    const fy = (d) => { const y = d.getUTCMonth() + 1 >= 4 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; return `${y}-${String((y + 1) % 100).padStart(2, '0')}`; };
    const pay = (inv, amount, paidOn, mode) => {
      const at = new Date(Math.min(paidOn.getTime(), now.getTime() - 3_600_000));
      payments.push({ _id: new ObjectId(), invoiceId: inv._id, amountPaise: amount, mode, gatewayRef: mode === 'CASH' ? null : `TXN-S${Math.floor(random() * 1e8)}`, status: 'SUCCESS', receiptNo: null, recordStatus: 'PUBLISHED', paidOn: at, refunds: [], warnings: [], refundedPaise: 0, refundPendingPaise: 0, createdAt: at, updatedAt: at });
    };
    const raise = (e, no, raisedAt, dueOn, items, outcome) => {
      const total = items.reduce((s, it) => s + it.amount + (it.tax ?? 0), 0);
      const inv = { _id: new ObjectId(), enrollmentId: e._id, invoiceNo: no, status: 'PENDING', totalPaise: total, paidPaise: 0, dueOn, adjustedPaise: 0, voidedAt: null, createdAt: raisedAt, updatedAt: raisedAt };
      for (const it of items) lines.push({ _id: new ObjectId(), invoiceId: inv._id, feeStructureId: it.structureId ?? null, description: it.description, amountPaise: it.amount, concessionPaise: 0, hsnSac: it.hsnSac ?? null, gstRateBp: it.gstRateBp ?? null, taxPaise: it.tax ?? 0, createdAt: raisedAt, updatedAt: raisedAt });
      const mode = pick(['UPI', 'UPI', 'GATEWAY', 'BANK', 'CASH', 'CHEQUE']);
      if (outcome === 'PAID') { pay(inv, total, new Date(raisedAt.getTime() + (3 + random() * 35) * DAY), mode); inv.paidPaise = total; inv.status = 'PAID'; }
      else if (outcome === 'PARTIAL') { const part = Math.round(total * 0.5); pay(inv, part, new Date(raisedAt.getTime() + (5 + random() * 30) * DAY), mode); inv.paidPaise = part; inv.status = 'PARTIAL'; }
      invoices.push(inv);
    };
    for (const [i, e] of enrolments.entries()) {
      const r = random();
      // 2026-27 annual charges, raised in May: nearly everyone has paid; a few are overdue.
      const kitTax = Math.round(450000 * 0.05); const actTax = Math.round(300000 * 0.18);
      raise(e, `ANN-2026-${String(i + 1).padStart(4, '0')}`, atIst(utcDay(2026, 5, 20), 11), utcDay(2026, 6, 15), [
        { description: 'Annual charges 2026-27', amount: 1500000, structureId: structures.annual._id },
        { description: 'Uniform and kit 2026-27', amount: 450000, structureId: structures.kit._id, hsnSac: '6203', gstRateBp: 500, tax: kitTax },
        { description: 'Activities and clubs 2026-27', amount: 300000, structureId: structures.activity._id, hsnSac: '999293', gstRateBp: 1800, tax: actTax },
      ], r < 0.9 ? 'PAID' : r < 0.95 ? 'PARTIAL' : 'UNPAID');
      if (riders.has(String(e.studentId))) {
        raise(e, `TRN-2026-${String(i + 1).padStart(4, '0')}`, atIst(utcDay(2026, 6, 25), 11), utcDay(2026, 7, 10), [{ description: 'Transport fee, Term 1 2026-27', amount: 900000, structureId: structures.transport._id }], random() < 0.85 ? 'PAID' : 'UNPAID');
      }
      // Last year's three invoices, all settled (a handful late), so collections have a year-on-year baseline.
      raise(e, `LY-ANN-2025-${String(i + 1).padStart(4, '0')}`, atIst(utcDay(2025, 5, 20), 11), utcDay(2025, 6, 15), [{ description: 'Annual charges 2025-26', amount: 1400000 }, { description: 'Uniform and kit 2025-26', amount: 420000 }], 'PAID');
      raise(e, `LY-T1-2025-${String(i + 1).padStart(4, '0')}`, atIst(utcDay(2025, 9, 1), 11), utcDay(2025, 10, 15), [{ description: 'Term 1 Tuition Fee 2025-26', amount: 3800000 }, { description: 'Library & Laboratory Fee 2025-26', amount: 450000 }], 'PAID');
      raise(e, `LY-T2-2025-${String(i + 1).padStart(4, '0')}`, atIst(utcDay(2026, 1, 5), 11), utcDay(2026, 2, 10), [{ description: 'Term 2 Tuition Fee 2025-26', amount: 3800000 }], 'PAID');
    }
    // Receipt numbers from each financial year's series, in payment order.
    payments.sort((a, b) => a.paidOn - b.paidOn);
    const byFy = new Map();
    for (const p of payments) { const k = fy(p.paidOn); if (!byFy.has(k)) byFy.set(k, []); byFy.get(k).push(p); }
    for (const [k, list] of byFy) {
      // eslint-disable-next-line no-await-in-loop
      const first = await reserve(`receipt:${tenant}:${k}`, list.length);
      list.forEach((p, j) => { p.receiptNo = `RCPT/${k}/${String(first + j).padStart(6, '0')}`; });
    }
    await bulk(Invoice, invoices);
    await bulk(InvoiceLine, lines);
    await bulk(Payment, payments);
    const overdue = invoices.filter((x) => x.status !== 'PAID' && x.dueOn < now).length;
    return `${invoices.length} invoices (annual charges, transport, and last year's three) with ${payments.length} payments spread over the months; ${overdue} overdue; GST on kit and activities`;
  });

  // ── Homework through the term, with submissions and grades ──────────────
  await section('Homework history (assignments and submissions)', null, async () => {
    if (await Assignment.exists({ title: /^Weekly practice/ })) return 'kept';
    const titles = {
      MATH: ['Weekly practice: integers', 'Weekly practice: linear equations', 'Weekly practice: angles and triangles', 'Weekly practice: data handling'],
      SCI: ['Weekly practice: states of matter', 'Weekly practice: cells and tissues', 'Weekly practice: force and motion', 'Weekly practice: light'],
      ENG: ['Weekly practice: comprehension', 'Weekly practice: letter writing', 'Weekly practice: reported speech', 'Weekly practice: poem appreciation'],
      SOC: ['Weekly practice: map work', 'Weekly practice: our constitution', 'Weekly practice: resources', 'Weekly practice: medieval kingdoms'],
      COMP: ['Weekly practice: spreadsheets', 'Weekly practice: algorithms', 'Weekly practice: internet safety', 'Weekly practice: block coding'],
    };
    const dues = [utcDay(2026, 7, 10), utcDay(2026, 7, 31), utcDay(2026, 8, 28), utcDay(2026, 10, 9)].filter((d) => d < today);
    const subjects = new Map((await Subject.find({}).lean()).map((s) => [String(s._id), s]));
    const assignments = []; const subs = [];
    for (const o of coreOfferings) {
      const code = subjects.get(String(o.subjectId))?.code ?? 'MATH';
      for (const [k, due] of dues.entries()) {
        const created = new Date(due.getTime() - 7 * DAY);
        const a = { _id: new ObjectId(), subjectOfferingId: o._id, title: (titles[code] ?? titles.MATH)[k % 4], description: 'Practice questions from this week\'s lessons. Show your working. (Sample.)', type: k === 2 ? 'PROJECT' : 'HOMEWORK', chapter: null, dueAt: atIst(due, 18), maxMarks: 10, attachments: [], createdByProfileId: o.teacherId ?? null, deletedAt: null, createdAt: created, updatedAt: created };
        assignments.push(a);
        for (const e of bySection.get(String(o.sectionId)) ?? []) {
          const pp = pupil.get(String(e._id));
          const r = random();
          // Most hand in on time; some late; a few never (no row, so it shows as missing).
          if (r > pp.attend - 0.02 && r > 0.9) continue;
          const late = r > 0.86;
          const at = new Date(a.dueAt.getTime() + (late ? 1 + random() * 3 : -random() * 4) * DAY);
          const graded = k < dues.length - 1 || random() < 0.5;
          const m = Math.max(3, Math.min(10, Math.round((pp.ability / 10) + (random() - 0.5) * 3)));
          subs.push({ _id: new ObjectId(), assignmentId: a._id, enrollmentId: e._id, status: graded ? 'GRADED' : late ? 'LATE' : 'SUBMITTED', submittedAt: at, marks: graded ? m : null, feedback: graded ? (m >= 8 ? 'Well done' : m >= 6 ? 'Good, check your working' : 'Please redo the marked questions') : null, attachments: [], createdAt: at, updatedAt: at });
        }
      }
    }
    await bulk(Assignment, assignments);
    await bulk(Submission, subs);
    return `${assignments.length} assignments over the term with ${subs.length} submissions (graded, late, waiting and missing)`;
  });

  // ── The everyday workflows of every portal: see seed_p3_workflows.js ──
  const base = { enrolments, bySection, sections, sectionLabel, coreOfferings, today, random, pick, year, lastYear, pupil };
  await (await import('./seed_p3_workflows.js')).seedP3Workflows({ section, attempt, who, teachers, actorOf, roleByKey }, base);
  return base;
}
