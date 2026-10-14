import { registerMetric } from '../catalogue.js';
import { Section, Grade } from '../../../models/academics.model.js';
import { Enrollment } from '../../../models/student.model.js';
import { Lead } from '../../../models/lead.model.js';
import { IntakeCapacity, SeatOffer } from '../../../models/marketing.model.js';
import { within, earliest, onRollAt, enrolmentHistorySince, asOf, pct, sum } from './helpers.js';

/** Students and admissions: strength from enrolment history, the enquiry funnel, withdrawals and seats. */

async function gradeNames(ctx) {
  return ctx.memo('gradeOfSection', async () => {
    const [sections, grades] = await Promise.all([Section.find({}).select('gradeId name').lean(), Grade.find({}).select('name level').lean()]);
    const g = new Map(grades.map((x) => [String(x._id), x]));
    return new Map(sections.map((s) => [String(s._id), g.get(String(s.gradeId))?.name ?? 'Unassigned']));
  });
}

const STRENGTH_DEF = 'Pupils on roll: enrolments of the academic year containing the date that had not been withdrawn, transferred or graduated by then. Enrolments carry no admission date, so a pupil counts from the start of their academic year; a pupil who left counts until their enrolment last changed.';

registerMetric({
  key: 'admissions.strength', department: 'admissions', label: 'Students on roll (closing)', headline: true, trend: true,
  definition: STRENGTH_DEF, unit: 'count', kind: 'stock', dateBasis: 'As of the last day of the period',
  sources: ['Enrollment', 'AcademicYear'], link: '/students', version: 1,
  since: (ctx) => enrolmentHistorySince(ctx),
  compute: async (ctx) => {
    const { year, rows } = await onRollAt(ctx, asOf(ctx.period));
    if (!year) return { value: null, records: 0, note: 'No academic year covers this date.' };
    const names = await gradeNames(ctx);
    const by = new Map();
    for (const r of rows) { const n = names.get(String(r.sectionId)) ?? 'Unassigned'; by.set(n, (by.get(n) ?? 0) + 1); }
    return { value: rows.length, records: rows.length, detail: { academicYear: year.name }, breakdown: [...by.entries()].map(([label, value]) => ({ label, value })) };
  },
});

registerMetric({
  key: 'admissions.opening_strength', department: 'admissions', label: 'Students on roll (opening)',
  definition: `${STRENGTH_DEF} Counted at the first moment of the period.`, unit: 'count', kind: 'stock', dateBasis: 'As of the first day of the period',
  sources: ['Enrollment', 'AcademicYear'], link: '/students', version: 1,
  since: (ctx) => enrolmentHistorySince(ctx),
  compute: async (ctx) => {
    const { year, rows } = await onRollAt(ctx, ctx.period.start);
    if (!year) return { value: null, records: 0, note: 'No academic year covers this date.' };
    return { value: rows.length, records: rows.length, detail: { academicYear: year.name } };
  },
});

registerMetric({
  key: 'admissions.withdrawals', department: 'admissions', label: 'Withdrawals and transfers out',
  definition: 'Enrolments marked withdrawn or transferred whose status changed during the period (the change is the recorded leaving date). Graduations are not withdrawals.',
  unit: 'count', kind: 'flow', dateBasis: 'Date the enrolment was last changed', sources: ['Enrollment'], link: '/students', version: 1,
  since: (ctx) => enrolmentHistorySince(ctx),
  compute: async (ctx) => {
    const n = await Enrollment.countDocuments({ status: { $in: ['WITHDRAWN', 'TRANSFERRED'] }, ...within('updatedAt', ctx.period) });
    return { value: n, records: n };
  },
});

registerMetric({
  key: 'admissions.enquiries', department: 'admissions', label: 'New enquiries', headline: true, trend: true,
  definition: 'Admission enquiries (leads) recorded during the period, by source.',
  unit: 'count', kind: 'flow', dateBasis: 'Date the enquiry was recorded', sources: ['Lead'], link: '/marketing', version: 1,
  since: (ctx) => ctx.memo('leadSince', () => earliest(Lead, 'createdAt')),
  compute: async (ctx) => {
    const rows = await ctx.memo(`leads:${ctx.period.from}:${ctx.period.to}`, () => Lead.find(within('createdAt', ctx.period)).select('source stage createdAt').lean());
    const by = new Map();
    for (const r of rows) by.set(r.source ?? 'UNKNOWN', (by.get(r.source ?? 'UNKNOWN') ?? 0) + 1);
    return { value: rows.length, records: rows.length, breakdown: [...by.entries()].map(([label, value]) => ({ label, value })) };
  },
  series: async (ctx, list) => {
    const rows = await Lead.find(within('createdAt', ctx.period)).select('createdAt').lean();
    return list.map((b) => rows.filter((r) => r.createdAt >= b.start && r.createdAt < b.end).length);
  },
});

const STAGES = ['NEW', 'CONTACTED', 'TOUR_SCHEDULED', 'APPLICATION', 'ENROLLED', 'LOST'];
registerMetric({
  key: 'admissions.applications', department: 'admissions', label: 'Enquiries that reached application',
  definition: 'Of the enquiries recorded in the period, those now at the application stage or enrolled. The breakdown shows every stage those enquiries are at today.',
  numerator: 'Enquiries at APPLICATION or ENROLLED', denominator: null,
  unit: 'count', kind: 'flow', dateBasis: 'Date the enquiry was recorded (cohort); stage as recorded now', sources: ['Lead'], link: '/marketing', version: 1,
  since: (ctx) => ctx.memo('leadSince', () => earliest(Lead, 'createdAt')),
  compute: async (ctx) => {
    const rows = await ctx.memo(`leads:${ctx.period.from}:${ctx.period.to}`, () => Lead.find(within('createdAt', ctx.period)).select('source stage createdAt').lean());
    const n = rows.filter((r) => ['APPLICATION', 'ENROLLED'].includes(r.stage)).length;
    return { value: n, records: rows.length, breakdown: STAGES.map((s) => ({ label: s, value: rows.filter((r) => r.stage === s).length })) };
  },
});

registerMetric({
  key: 'admissions.conversion', department: 'admissions', label: 'Enquiry to enrolment conversion', headline: true,
  definition: 'Enquiries recorded in the period that are now enrolled, divided by all enquiries recorded in the period (one cohort, one denominator).',
  numerator: 'Enquiries now ENROLLED', denominator: 'All enquiries recorded in the period',
  unit: 'percent', kind: 'flow', dateBasis: 'Date the enquiry was recorded (cohort)', sources: ['Lead'], link: '/marketing', version: 1,
  since: (ctx) => ctx.memo('leadSince', () => earliest(Lead, 'createdAt')),
  compute: async (ctx) => {
    const rows = await ctx.memo(`leads:${ctx.period.from}:${ctx.period.to}`, () => Lead.find(within('createdAt', ctx.period)).select('source stage createdAt').lean());
    const enrolled = rows.filter((r) => r.stage === 'ENROLLED').length;
    return { value: pct(enrolled, rows.length), records: rows.length, detail: { enrolled, enquiries: rows.length }, note: rows.length ? null : 'No enquiries in the period.' };
  },
});

registerMetric({
  key: 'admissions.seat_fill', department: 'admissions', label: 'Seats accepted against capacity', currentOnly: true,
  definition: 'Accepted seats divided by intake capacity, for the academic year containing the period end, from the seat register. The register keeps running totals only.',
  numerator: 'Accepted seats', denominator: 'Intake capacity',
  unit: 'percent', kind: 'stock', dateBasis: 'Current seat register', sources: ['IntakeCapacity'], link: '/marketing', version: 1,
  compute: async (ctx) => {
    const { year } = await onRollAt(ctx, asOf(ctx.period));
    const rows = await IntakeCapacity.find(year ? { academicYear: year.name } : {}).lean();
    if (!rows.length) return { value: null, records: 0, note: 'No intake capacity recorded.' };
    const cap = sum(rows, (r) => r.capacity);
    const acc = sum(rows, (r) => r.accepted);
    return { value: pct(acc, cap), records: rows.length, detail: { capacity: cap, accepted: acc, offered: sum(rows, (r) => r.offered) }, breakdown: rows.map((r) => ({ label: r.gradeOrProgramme, value: r.accepted, of: r.capacity })) };
  },
});

registerMetric({
  key: 'admissions.waitlist', department: 'admissions', label: 'Applicants on the waitlist', currentOnly: true,
  definition: 'Seat offers currently in the WAITLISTED state. Offers keep no dated history of the waitlist, so only the current count is shown.',
  unit: 'count', kind: 'stock', dateBasis: 'Current offer status', sources: ['SeatOffer'], link: '/marketing', version: 1,
  compute: async () => {
    const n = await SeatOffer.countDocuments({ status: 'WAITLISTED' });
    return { value: n, records: n };
  },
});
