import { Scenario } from '../../models/scenario.model.js';
import { AcademicYear, Grade, Section } from '../../models/academics.model.js';
import { Enrollment } from '../../models/student.model.js';
import { Invoice, Payment } from '../../models/fee.model.js';
import { Vehicle } from '../../models/fleet.model.js';
import { BusEnrollment } from '../../models/transport.model.js';
import { PayrollRun, Budget } from '../../models/finance.model.js';
import { AppError } from '../../utils/AppError.js';
import { profilesWithRoles, assertObjectId, requireText, optionalText, dto } from '../ops/common.js';

/**
 * Scenario planning: what-if projections for the principal, administrator
 * and finance, 1–5 years ahead from the school's current actuals.
 *
 * Everything here is a PROJECTION from assumptions a person chose, not a
 * forecast of what will happen. Each assumption is returned with its value
 * and where the default came from (ACTUAL from records, or a stated DEFAULT),
 * and edited values are marked EDITED, so the page can show them next to the
 * figures. Payroll is read only as a school-wide monthly total, never per person.
 */
export const PROJECTION_LABEL = 'Projection from the assumptions shown, not a forecast. Actuals are this school\'s current records.';
const STAFF_ROLES = ['TEACHER'];
const OTHER_STAFF_ROLES = ['ADMIN', 'FINANCE', 'LIBRARIAN', 'WARDEN', 'HR', 'MARKETING', 'COMPLIANCE'];

// ── actuals ──────────────────────────────────────────────────────────────

export async function baseline() {
  const year = await AcademicYear.findOne({ isCurrent: true }).lean();
  const enrFilter = { status: 'ACTIVE', ...(year ? { academicYearId: year._id } : {}) };
  const [grades, sections, enrollments] = await Promise.all([
    Grade.find({}).select('name level').sort({ level: 1 }).lean(),
    Section.find({}).select('gradeId').lean(),
    Enrollment.find(enrFilter).select('_id sectionId').lean(),
  ]);
  const gradeOfSection = new Map(sections.map((s) => [String(s._id), String(s.gradeId)]));
  const perGrade = new Map(grades.map((g) => [String(g._id), 0]));
  for (const e of enrollments) {
    const g = gradeOfSection.get(String(e.sectionId));
    if (g && perGrade.has(g)) perGrade.set(g, perGrade.get(g) + 1);
  }
  const students = enrollments.length;

  const invoices = await Invoice.find({ enrollmentId: { $in: enrollments.map((e) => e._id) }, status: { $ne: 'CANCELLED' } }).select('_id totalPaise grossTotalPaise').lean();
  const billedPaise = invoices.reduce((t, i) => t + (i.grossTotalPaise ?? i.totalPaise ?? 0), 0);
  const payablePaise = invoices.reduce((t, i) => t + (i.totalPaise ?? 0), 0);
  const paid = await Payment.aggregate([{ $match: { invoiceId: { $in: invoices.map((i) => i._id) }, status: 'SUCCESS' } }, { $group: { _id: null, sum: { $sum: '$amountPaise' } } }]);
  const collectedPaise = paid[0]?.sum ?? 0;

  const [teachers, others] = await Promise.all([profilesWithRoles(STAFF_ROLES), profilesWithRoles(OTHER_STAFF_ROLES)]);
  const run = await PayrollRun.findOne({ status: { $in: ['APPROVED', 'BANK_FILE_GENERATED', 'PAYMENT_INITIATED', 'PAYMENT_CONFIRMED', 'CLOSED'] } }).sort({ period: -1 }).select('period totals.grossPaise totals.employerContributionsPaise').lean();
  const monthlyPayrollPaise = run ? (run.totals?.grossPaise ?? 0) + (run.totals?.employerContributionsPaise ?? 0) : null;

  const [vehicles, riders] = await Promise.all([
    Vehicle.find({ status: 'ACTIVE' }).select('usableSeats lawfulCapacity').lean(),
    BusEnrollment.countDocuments(year ? { academicYearId: year._id } : {}),
  ]);
  const seats = vehicles.reduce((t, v) => t + (v.usableSeats ?? 0), 0);

  const fiscal = year?.name ?? null;
  const budgets = await Budget.find(fiscal ? { fiscalYear: fiscal } : {}).select('lines status').lean();
  const plannedPaise = budgets.reduce((t, b) => t + (b.lines ?? []).reduce((x, l) => x + (l.plannedPaise ?? 0), 0), 0);
  const actualPaise = budgets.reduce((t, b) => t + (b.lines ?? []).reduce((x, l) => x + (l.actualPaise ?? 0), 0), 0);

  return {
    asOf: new Date(), academicYear: year?.name ?? null,
    enrolment: { students, grades: grades.map((g) => ({ gradeId: String(g._id), name: g.name, level: g.level, students: perGrade.get(String(g._id)) ?? 0 })) },
    fees: { billedPaise, payablePaise, collectedPaise, perStudentPaise: students ? Math.round(billedPaise / students) : null, concessionPct: billedPaise ? Math.round(((billedPaise - payablePaise) / billedPaise) * 1000) / 10 : null, collectionPct: payablePaise ? Math.round((collectedPaise / payablePaise) * 1000) / 10 : null },
    staffing: { teachers: teachers.length, otherStaff: others.length, studentsPerTeacher: teachers.length ? Math.round((students / teachers.length) * 10) / 10 : null, monthlyPayrollPaise, payrollPeriod: run?.period ?? null },
    transport: { riders, vehicles: vehicles.length, usableSeats: seats, seatsPerVehicle: vehicles.length ? Math.round(seats / vehicles.length) : null },
    budget: { fiscalYear: fiscal, plannedPaise, actualPaise, budgets: budgets.length },
    sources: [
      `${students} active enrolments${year ? ` in ${year.name}` : ''}`,
      `${invoices.length} fee invoices for those enrolments, payments recorded against them`,
      `${teachers.length} teachers and ${others.length} other staff with active profiles`,
      run ? `Payroll total for ${run.period} (school total only)` : 'No approved payroll run yet',
      `${vehicles.length} active vehicles, ${riders} bus enrolments`,
      `${budgets.length} budget(s)${fiscal ? ` for ${fiscal}` : ''}`,
    ],
  };
}

// ── assumptions ──────────────────────────────────────────────────────────

const num = (v, { min = -Infinity, max = Infinity } = {}) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : null;
};

/**
 * The assumptions in force: defaults from actuals, overridden by what the
 * person entered. Each comes back with { value, source, label, unit }.
 */
export function resolveAssumptions(base, input = {}) {
  const lowest = base.enrolment.grades[0];
  const teacherCost = base.staffing.monthlyPayrollPaise && (base.staffing.teachers + base.staffing.otherStaff)
    ? Math.round((base.staffing.monthlyPayrollPaise * 12) / (base.staffing.teachers + base.staffing.otherStaff)) : 42_000_000;
  const otherBudget = Math.max(0, base.budget.plannedPaise - (base.staffing.monthlyPayrollPaise ?? 0) * 12);
  const defs = {
    intake: { label: `New intake each year into ${lowest?.name ?? 'the first grade'}`, unit: 'students', value: lowest?.students ?? 0, source: 'ACTUAL', min: 0, max: 5000 },
    retentionPct: { label: 'Students who continue to the next grade', unit: '%', value: 95, source: 'DEFAULT', min: 0, max: 100 },
    lateralPerGrade: { label: 'Lateral admissions per other grade each year', unit: 'students', value: 0, source: 'DEFAULT', min: 0, max: 500 },
    feePerStudentPaise: { label: 'Annual fee billed per student (current)', unit: 'paise', value: base.fees.perStudentPaise ?? 6_000_000, source: base.fees.perStudentPaise ? 'ACTUAL' : 'DEFAULT', min: 0, max: 1_000_000_000 },
    feeIncreasePct: { label: 'Fee increase each year', unit: '%', value: 8, source: 'DEFAULT', min: -50, max: 100 },
    concessionPct: { label: 'Concessions (share of fees waived)', unit: '%', value: base.fees.concessionPct ?? 5, source: base.fees.concessionPct !== null ? 'ACTUAL' : 'DEFAULT', min: 0, max: 100 },
    collectionPct: { label: 'Fees actually collected', unit: '%', value: base.fees.collectionPct ? Math.min(base.fees.collectionPct, 100) : 95, source: base.fees.collectionPct ? 'ACTUAL' : 'DEFAULT', min: 0, max: 100 },
    studentsPerTeacher: { label: 'Students per teacher (target ratio)', unit: 'students', value: base.staffing.studentsPerTeacher ?? 30, source: base.staffing.studentsPerTeacher ? 'ACTUAL' : 'DEFAULT', min: 5, max: 80 },
    extraHiresPerYear: { label: 'Additional hires each year beyond the ratio', unit: 'people', value: 0, source: 'DEFAULT', min: 0, max: 200 },
    costPerStaffPaise: { label: 'Annual cost per member of staff (salary and employer contributions)', unit: 'paise', value: teacherCost, source: base.staffing.monthlyPayrollPaise ? 'ACTUAL' : 'DEFAULT', min: 0, max: 1_000_000_000 },
    salaryIncrementPct: { label: 'Salary increment each year', unit: '%', value: 6, source: 'DEFAULT', min: -20, max: 50 },
    riderPct: { label: 'Students using school transport', unit: '%', value: base.enrolment.students ? Math.round((base.transport.riders / base.enrolment.students) * 1000) / 10 : 30, source: base.enrolment.students ? 'ACTUAL' : 'DEFAULT', min: 0, max: 100 },
    seatsPerVehicle: { label: 'Usable seats per vehicle', unit: 'seats', value: base.transport.seatsPerVehicle ?? 40, source: base.transport.seatsPerVehicle ? 'ACTUAL' : 'DEFAULT', min: 1, max: 100 },
    targetLoadPct: { label: 'Planned seat use per vehicle', unit: '%', value: 90, source: 'DEFAULT', min: 10, max: 100 },
    costPerVehiclePaise: { label: 'Annual running cost per vehicle', unit: 'paise', value: 120_000_000, source: 'DEFAULT', min: 0, max: 1_000_000_000 },
    otherCostsPaise: { label: 'Other annual costs (budget less payroll)', unit: 'paise', value: otherBudget, source: base.budget.plannedPaise ? 'ACTUAL' : 'DEFAULT', min: 0, max: 100_000_000_000 },
    otherCostsGrowthPct: { label: 'Growth in other costs each year', unit: '%', value: 5, source: 'DEFAULT', min: -50, max: 100 },
  };
  const out = {};
  for (const [k, d] of Object.entries(defs)) {
    const edited = input[k] !== undefined && input[k] !== null && input[k] !== '' ? num(input[k], d) : null;
    out[k] = { key: k, label: d.label, unit: d.unit, value: edited ?? d.value, source: edited !== null ? 'EDITED' : d.source, default: d.value };
  }
  return out;
}

// ── projection ───────────────────────────────────────────────────────────

export function project(base, assumptions, years = 3) {
  const a = Object.fromEntries(Object.entries(assumptions).map(([k, v]) => [k, v.value]));
  const n = Math.min(Math.max(Number.parseInt(years, 10) || 3, 1), 5);
  let grades = base.enrolment.grades.map((g) => g.students);
  const startTeachers = base.staffing.teachers;
  const rows = [];
  for (let y = 0; y <= n; y += 1) {
    if (y > 0) {
      const next = grades.map((_, i) => (i === 0 ? Math.round(a.intake) : Math.round(grades[i - 1] * (a.retentionPct / 100)) + Math.round(a.lateralPerGrade)));
      grades = next;
    }
    const students = grades.reduce((t, x) => t + x, 0);
    const fee = a.feePerStudentPaise * (1 + a.feeIncreasePct / 100) ** y;
    const feeRevenuePaise = Math.round(students * fee * (1 - a.concessionPct / 100) * (a.collectionPct / 100));
    const teachersNeeded = y === 0 ? startTeachers : Math.ceil(students / a.studentsPerTeacher) + Math.round(a.extraHiresPerYear) * y;
    const staff = teachersNeeded + base.staffing.otherStaff;
    const staffCostPaise = Math.round(staff * a.costPerStaffPaise * (1 + a.salaryIncrementPct / 100) ** y);
    const riders = Math.round(students * (a.riderPct / 100));
    const perVehicle = Math.max(1, Math.floor(a.seatsPerVehicle * (a.targetLoadPct / 100)));
    const vehiclesNeeded = y === 0 ? base.transport.vehicles : Math.ceil(riders / perVehicle);
    const transportCostPaise = Math.round(vehiclesNeeded * a.costPerVehiclePaise);
    const otherCostsPaise = Math.round(a.otherCostsPaise * (1 + a.otherCostsGrowthPct / 100) ** y);
    const totalCostPaise = staffCostPaise + transportCostPaise + otherCostsPaise;
    rows.push({
      year: y, label: y === 0 ? `Now${base.academicYear ? ` (${base.academicYear})` : ''}` : `Year ${y}`, actual: y === 0,
      students, byGrade: base.enrolment.grades.map((g, i) => ({ name: g.name, students: grades[i] })),
      feePerStudentPaise: Math.round(fee), feeRevenuePaise,
      teachersNeeded, newTeachersVsNow: teachersNeeded - startTeachers, studentsPerTeacher: teachersNeeded ? Math.round((students / teachersNeeded) * 10) / 10 : null,
      staffCostPaise, riders, vehiclesNeeded, newVehiclesVsNow: vehiclesNeeded - base.transport.vehicles, transportCostPaise,
      otherCostsPaise, totalCostPaise, surplusPaise: feeRevenuePaise - totalCostPaise,
    });
  }
  return rows;
}

function cleanInput(body = {}) {
  const raw = body.assumptions && typeof body.assumptions === 'object' ? body.assumptions : {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) if (/^[a-zA-Z]{2,40}$/.test(k) && (typeof v === 'number' || typeof v === 'string')) out[k] = v;
  return out;
}

const yearsOf = (v) => Math.min(Math.max(Number.parseInt(v, 10) || 3, 1), 5);

async function build(input, years, base = null) {
  const b = base ?? (await baseline());
  const assumptions = resolveAssumptions(b, input);
  return { label: PROJECTION_LABEL, baseline: b, assumptions: Object.values(assumptions), years, rows: project(b, assumptions, years) };
}

// ── API ──────────────────────────────────────────────────────────────────

export async function getBaseline() {
  const b = await baseline();
  return { label: PROJECTION_LABEL, baseline: b, assumptions: Object.values(resolveAssumptions(b, {})) };
}

export const preview = (body = {}) => build(cleanInput(body), yearsOf(body.years));

export async function list() {
  const rows = await Scenario.find({ archivedAt: null }).sort({ updatedAt: -1 }).limit(100).lean();
  return rows.map((r) => ({ id: String(r._id), name: r.name, description: r.description, years: r.years, createdByName: r.createdByName, updatedAt: r.updatedAt, edited: Object.keys(r.assumptions ?? {}).length }));
}

async function load(id) {
  const s = await Scenario.findOne({ _id: assertObjectId(id, 'scenarioId'), archivedAt: null });
  if (!s) throw new AppError('Scenario not found', 404);
  return s;
}

export async function get(id) {
  const s = await load(id);
  return { scenario: dto(s.toObject()), ...(await build(s.assumptions ?? {}, s.years)) };
}

export async function create(actor, body = {}) {
  const input = cleanInput(body);
  const base = await baseline();
  const s = await Scenario.create({
    name: requireText(body.name, 'name', { max: 120 }), description: optionalText(body.description, { max: 1000 }) || null,
    years: yearsOf(body.years), assumptions: input, baselineAtSave: { asOf: base.asOf, students: base.enrolment.students, teachers: base.staffing.teachers, vehicles: base.transport.vehicles },
    createdByProfileId: actor.profileId, createdByName: actor.displayName,
  });
  return { scenario: dto(s.toObject()), ...(await build(input, s.years, base)) };
}

export async function update(actor, id, body = {}) {
  const s = await load(id);
  if (body.name !== undefined) s.name = requireText(body.name, 'name', { max: 120 });
  if (body.description !== undefined) s.description = optionalText(body.description, { max: 1000 }) || null;
  if (body.years !== undefined) s.years = yearsOf(body.years);
  if (body.assumptions !== undefined) { s.assumptions = cleanInput(body); s.markModified('assumptions'); }
  await s.save();
  void actor;
  return { scenario: dto(s.toObject()), ...(await build(s.assumptions, s.years)) };
}

export async function archive(id) {
  const s = await load(id);
  s.archivedAt = new Date();
  await s.save();
  return { archived: true };
}

/** Side by side: up to four saved scenarios over the same actuals. */
export async function compare(ids = []) {
  const list = [...new Set(String(ids).split(',').map((x) => x.trim()).filter(Boolean))].slice(0, 4);
  if (list.length < 2) throw new AppError('Choose two to four scenarios to compare.', 400, [], 'COMPARE_NEEDS_TWO');
  const base = await baseline();
  const out = [];
  for (const id of list) {
    // eslint-disable-next-line no-await-in-loop
    const s = await load(id);
    // eslint-disable-next-line no-await-in-loop
    const b = await build(s.assumptions ?? {}, s.years, base);
    out.push({ id, name: s.name, years: s.years, assumptions: b.assumptions, rows: b.rows });
  }
  return { label: PROJECTION_LABEL, baseline: base, scenarios: out };
}
