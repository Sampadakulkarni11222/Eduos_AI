import { Vacancy, ExitCase, CashClose, DENOMINATIONS } from '../models/p4People.model.js';
import { EmployeeCompensation } from '../models/finance.model.js';
import { Section } from '../models/academics.model.js';
import { Enrollment } from '../models/student.model.js';
import * as people from '../modules/p4ops/people.service.js';
import * as collections from '../modules/p4ops/collections.service.js';
import * as health from '../modules/health/health.service.js';
import { Role } from '../models/role.model.js';
import { Profile } from '../models/profile.model.js';
import { buildPermissionMap } from '../utils/buildPermissionMap.js';

/**
 * Sample data for the part-4 finance, HR and nurse features (fictional):
 *   - two vacancies and five candidates across the pipeline (scorecards, an
 *     offer drafted, one not taken forward with a reason);
 *   - one resignation with a clearance cleared, one with dues, and the
 *     full-and-final worksheet worked out (not sent to payroll);
 *   - yesterday's cash closed by the finance officer and checked by the
 *     administrator, and the day before closed with a small explained shortfall;
 *   - three "fever" visits in one class over two days, so the nurse's watch list
 *     shows what a possible cluster looks like, and an immunisation coming due.
 * Written through the services, so the rules, history and audit trail apply.
 */
const DAY = 86_400_000;
const ymd = (offset) => new Date(Date.now() + 330 * 60_000 + offset * DAY).toISOString().slice(0, 10);

function countsFor(paise) {
  const out = []; let left = Math.floor(paise / 100) * 100;
  for (const d of DENOMINATIONS) { const n = Math.floor(left / d); if (n) { out.push({ denominationPaise: d, count: n }); left -= n * d; } }
  return { counts: out, counted: out.reduce((s, c) => s + c.denominationPaise * c.count, 0) };
}

async function nurseActor(tenantId) {
  const role = await Role.findOne({ key: 'NURSE' }).lean();
  const p = role ? await Profile.findOne({ roleId: role._id, tenantId, deletedAt: null }).sort({ createdAt: 1 }).lean() : null;
  return p ? { accountId: String(p.accountId), profileId: String(p._id), displayName: p.displayName, roleKey: 'NURSE', permissions: buildPermissionMap(role), tenantId, tenantName: p.tenantName } : null;
}

export async function seedP4FinanceHrNurse({ section, attempt, who, tenantId }) {
  const HR = who.HR?.actor;
  const FIN = who.FINANCE?.actor;
  const ADMIN = who.ADMIN?.actor;
  // The health sample has no collection of its own to check; it goes in once, with the first recruitment sample.
  const fresh = (await Vacancy.countDocuments({})) === 0;

  await section('Recruitment (vacancies, candidates, scorecards, an offer)', Vacancy, async () => {
    if (!HR) return 'no HR person';
    const maths = await people.createVacancy(HR, { title: 'TGT Mathematics', department: 'Academics', subject: 'Mathematics', qualifications: 'B.Sc/M.Sc Mathematics, B.Ed, CTET', salaryBand: '₹4.8–6.0 lakh a year', closesOn: ymd(14) });
    const eng = await people.createVacancy(HR, { title: 'PRT English', department: 'Primary', subject: 'English', qualifications: 'B.A. English, D.El.Ed or B.Ed, CTET', salaryBand: '₹3.6–4.5 lakh a year', closesOn: ymd(21) });
    await people.createVacancy(HR, { title: 'Lab assistant (Chemistry)', department: 'Labs', qualifications: 'B.Sc Chemistry', childFacing: true, closesOn: ymd(-3) }).then((v) => people.setVacancyStatus(HR, v.id, { status: 'ON_HOLD', note: 'Budget review (sample)' }));
    const add = (vacancyId, name, extra) => people.addCandidate(HR, { vacancyId, name, source: 'Job portal (sample)', ...extra });
    const kavya = await add(maths.id, 'Kavya Rao (sample)', { email: 'kavya.sample@example.com', experienceYears: 4, qualifications: 'M.Sc Mathematics, B.Ed, CTET', expectedCtcPaise: 54000000, noticeDays: 30 });
    const rohan = await add(maths.id, 'Rohan Mehta (sample)', { experienceYears: 2, qualifications: 'B.Sc, B.Ed', expectedCtcPaise: 45000000 });
    const sana = await add(maths.id, 'Sana Qureshi (sample)', { experienceYears: 7, qualifications: 'M.Sc, M.Ed, CTET', source: 'Referral (sample)' });
    const tara = await add(eng.id, 'Tara Nair (sample)', { experienceYears: 3, qualifications: 'B.A. English, B.Ed, CTET' });
    await add(eng.id, 'Imran Shaikh (sample)', { experienceYears: 1, qualifications: 'B.A., D.El.Ed' });
    for (const c of [kavya, rohan, sana, tara]) await attempt(`screen ${c.name}`, () => people.moveCandidate(HR, c.id, { stage: 'SCREENED' }));
    await attempt('kavya demo', () => people.moveCandidate(HR, kavya.id, { stage: 'DEMO_LESSON', note: 'Demo lesson on linear equations, Class 8 (sample)' }));
    await attempt('kavya interview', () => people.moveCandidate(HR, kavya.id, { stage: 'INTERVIEW' }));
    await attempt('kavya score', () => people.scoreCandidate(HR, kavya.id, { ratings: { subjectKnowledge: 5, pedagogy: 4, communication: 4, classroomManagement: 4, childSafeguarding: 4, valuesFit: 5 }, recommendation: 'STRONG_YES', note: 'Clear explanations; good use of questioning (sample).' }));
    await attempt('kavya offer', () => people.draftOffer(HR, kavya.id, { ctcPaise: 54000000, joiningOn: ymd(30), schoolName: 'Oakridge Academy' }));
    await attempt('sana interview', () => people.moveCandidate(HR, sana.id, { stage: 'INTERVIEW' }));
    await attempt('sana score', () => people.scoreCandidate(HR, sana.id, { ratings: { subjectKnowledge: 5, pedagogy: 3, communication: 3, classroomManagement: 3, childSafeguarding: 4 }, recommendation: 'MAYBE' }));
    await attempt('rohan rejected', () => people.moveCandidate(HR, rohan.id, { stage: 'REJECTED', note: 'Needs more classroom experience at this level; keep for a PRT opening (sample).' }));
    return '3 vacancies, 5 candidates';
  });

  await section('Staff exits (a resignation with clearances and the full-and-final worksheet)', ExitCase, async () => {
    if (!HR) return 'no HR person';
    const comps = await EmployeeCompensation.find({ status: 'ACTIVE' }).sort({ joiningDate: 1 }).lean();
    const principalId = who.PRINCIPAL?.profile?._id ? String(who.PRINCIPAL.profile._id) : null;
    const leaver = comps.find((c) => String(c.profileId) !== String(HR.profileId) && String(c.profileId) !== principalId && String(c.profileId) !== String(FIN?.profileId));
    if (!leaver) return 'no pay structure to attach an exit to';
    const x = await people.startExit(HR, { profileId: String(leaver.profileId), kind: 'RESIGNATION', noticeOn: ymd(-12), lastWorkingDay: ymd(18), noticeDaysRequired: 30, reason: 'Relocating to another city (sample)', departments: ['ACADEMICS', 'LIBRARY', 'IT', 'ACCOUNTS'] });
    await attempt('library dues', () => people.updateClearance(HR, x.id, { department: 'LIBRARY', status: 'DUES', duesPaise: 45000, note: 'Two books not returned (sample)' }));
    await attempt('IT cleared', () => people.updateClearance(HR, x.id, { department: 'IT', status: 'CLEARED', note: 'Laptop and ID card returned (sample)' }));
    await attempt('interview', () => people.recordExitInterview(HR, x.id, { note: 'Leaving for family reasons; would recommend the school; suggested more planning time for new teachers (sample).' }));
    await attempt('settlement', () => people.settlementEstimate(HR, x.id, {}));
    return `1 exit (${leaver.name})`;
  });

  await section('Day-end cash close (closed and checked)', CashClose, async () => {
    if (!FIN) return 'no finance person';
    let n = 0;
    for (const [offset, shortBy] of [[-2, 10000], [-1, 0]]) {
      // eslint-disable-next-line no-await-in-loop
      const exp = await collections.expectedForDay(FIN, ymd(offset));
      const { counts, counted } = countsFor(exp.expectedCashPaise);
      if (shortBy && counts.length) {
        const last = counts[counts.length - 1];
        // Take ₹100 out of the drawer for the sample shortfall where the notes allow it.
        if (counted >= shortBy) { const hundred = counts.find((c) => c.denominationPaise === 10000); if (hundred && hundred.count > 0) hundred.count -= 1; else last.count = Math.max(0, last.count - 1); }
      }
      const countedNow = counts.reduce((s, c) => s + c.denominationPaise * c.count, 0);
      const variance = countedNow - exp.expectedCashPaise;
      // eslint-disable-next-line no-await-in-loop
      const c = await attempt(`close ${ymd(offset)}`, () => collections.closeDay(FIN, { day: ymd(offset), counts, depositSlipNo: `DS-${ymd(offset).replace(/-/g, '')} (sample)`, note: variance ? 'Change given twice at the counter; noted for the cashier (sample).' : null }));
      if (c && ADMIN && offset === -2) await attempt('check', () => collections.checkClose(ADMIN, c.id, { note: 'Counted with the cashier (sample)' })); // eslint-disable-line no-await-in-loop
      if (c) n += 1;
    }
    return `${n} day(s) closed`;
  });

  await section('Health watch sample (a possible cluster, an immunisation due)', null, async () => {
    if (!fresh) return 'kept (already seeded)';
    const nurse = await nurseActor(tenantId);
    if (!nurse) return 'no nurse';
    const classSection = who.TEACHER ? await Section.findOne({ classTeacherId: who.TEACHER.profile._id }).select('_id').lean() : null;
    if (!classSection) return 'no class';
    const kids = (await Enrollment.find({ sectionId: classSection._id, status: 'ACTIVE' }).select('studentId').sort({ rollNo: -1 }).limit(4).lean()).map((e) => String(e.studentId));
    const at = (daysAgo, hhmm) => new Date(`${ymd(-daysAgo)}T${hhmm}:00+05:30`);
    const plan = [[kids[0], 1, '10:05', 'Fever 38.4 °C and body ache'], [kids[1], 1, '11:40', 'Feverish, headache'], [kids[2], 0, '09:30', 'High temperature and chills']];
    for (const [studentId, daysAgo, hhmm, complaint] of plan) {
      if (!studentId) continue;
      // eslint-disable-next-line no-await-in-loop
      await attempt('fever visit', () => health.recordVisit(nurse, { studentId, complaint: `${complaint} (sample)`, outcome: 'REST', arrivedAt: at(daysAgo, hhmm), leftAt: at(daysAgo, hhmm.replace(/:(\d)\d$/, ':5$1')), vitals: { temperatureC: 38.3 }, action: 'Rested, fluids; parents asked to watch (sample)' }));
    }
    if (kids[3]) await attempt('immunisation', () => health.addEntry(nurse, { studentId: kids[3], kind: 'IMMUNISATION', vaccine: 'Td (tetanus-diphtheria)', doseNo: '1', givenAt: 'School camp (sample)', on: ymd(-300), nextDueOn: ymd(10) }));
    return 'cluster sample + 1 immunisation due';
  });
}
