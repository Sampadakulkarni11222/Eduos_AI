import { Role } from '../models/role.model.js';
import { Profile } from '../models/profile.model.js';
import { Student, StudentGuardian, Enrollment } from '../models/student.model.js';
import { Section } from '../models/academics.model.js';
import { HealthVisit } from '../models/health.model.js';
import { buildPermissionMap } from '../utils/buildPermissionMap.js';
import * as health from '../modules/health/health.service.js';

/**
 * Sample data for the school health room (part 3, F14). Fictional throughout:
 * a week of visits, two medication plans (one controlled, countersigned),
 * today's doses, first-aid stock with one item close to expiry (a task), care
 * notes (one shared with the class teacher, one waiting for the parent),
 * immunisations and this year's screenings for the demo parent's children.
 *
 * Written through the health service, so everything is encrypted and audited
 * exactly as it would be from the Health page.
 */
const DAY = 86_400_000;
const ymdIst = (d) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const atIst = (daysAgo, hhmm) => new Date(`${ymdIst(new Date(Date.now() - daysAgo * DAY))}T${hhmm}:00+05:30`);

export async function seedHealth({ section, attempt, who, tenantId }) {
  const role = await Role.findOne({ key: 'NURSE' }).lean();
  const nurseProfile = role ? await Profile.findOne({ roleId: role._id, tenantId, deletedAt: null }).sort({ createdAt: 1 }).lean() : null;
  if (!nurseProfile) return;
  const nurse = {
    accountId: String(nurseProfile.accountId), profileId: String(nurseProfile._id), displayName: nurseProfile.displayName,
    roleKey: 'NURSE', permissions: buildPermissionMap(role), tenantId, tenantName: nurseProfile.tenantName,
  };
  const parent = who.PARENT?.actor;

  await section('Health room (visits, medication, stock, care notes, health cards)', HealthVisit, async () => {
    // The demo parent's children first, then the demo teacher's class, then anyone.
    const own = parent ? (await StudentGuardian.find({ guardianProfileId: parent.profileId }).select('studentId').lean()).map((g) => String(g.studentId)) : [];
    const classSection = who.TEACHER ? await Section.findOne({ classTeacherId: who.TEACHER.profile._id }).select('_id').lean() : null;
    const classmates = classSection ? (await Enrollment.find({ sectionId: classSection._id, status: 'ACTIVE' }).select('studentId').limit(6).lean()).map((e) => String(e.studentId)) : [];
    const others = (await Student.find({ deletedAt: null }).select('_id').limit(12).lean()).map((s) => String(s._id));
    const pool = [...new Set([...own, ...classmates, ...others])];
    if (!pool.length) return 'no students to attach sample records to';
    const kid = (i) => pool[i % pool.length];
    const child = own[0] ?? kid(0);

    // A week of visits.
    const visits = [
      [0, '09:40', '10:05', child, 'Headache after the morning assembly', { temperatureC: 37.2, pulse: 84 }, 'Rested 20 minutes, water; no medicine', 'REST', false, false],
      [0, '11:15', '11:30', kid(1), 'Grazed knee on the football ground', null, 'Cleaned and dressed the wound', 'FIRST_AID', true, false],
      [0, '12:50', null, kid(2), 'Stomach ache and nausea', { temperatureC: 38.1, pulse: 96 }, 'Paracetamol as per plan; parents called to collect', 'SENT_HOME', false, true],
      [1, '10:20', '10:35', kid(3), 'Nosebleed during maths', null, 'Pressure applied; stopped in 8 minutes', 'FIRST_AID', false, false],
      [2, '13:05', '13:20', kid(4), 'Feeling dizzy, skipped breakfast', { temperatureC: 36.8, pulse: 78 }, 'Glucose biscuits and rest', 'RETURNED_TO_CLASS', false, false],
      [3, '08:55', '09:40', kid(5), 'Twisted ankle on the stairs', null, 'Ice pack; referred for an X-ray', 'REFERRED', true, false],
    ];
    let made = 0;
    for (const [d, inAt, outAt, studentId, complaint, vitals, action, outcome, injury, medicineGiven] of visits) {
      // eslint-disable-next-line no-await-in-loop
      const v = await attempt('health visit', () => health.recordVisit(nurse, { studentId, arrivedAt: atIst(d, inAt), leftAt: outAt ? atIst(d, outAt) : null, complaint, vitals, action, outcome, injury, medicineGiven }));
      if (v) made += 1;
    }

    // Medication: one plan the parent created with consent, one controlled plan drafted by the nurse and consented.
    const start = ymdIst(new Date(Date.now() - 3 * DAY));
    const end = ymdIst(new Date(Date.now() + 20 * DAY));
    let plans = 0;
    if (parent && own[0]) {
      const p1 = await attempt('parent plan', () => health.createPlan(parent, { studentId: own[0], medicine: { name: 'Cetirizine syrup', strength: '5 mg/5 ml', form: 'Syrup' }, dose: '5 ml', times: ['13:00'], startOn: start, endOn: end, consent: true, prescription: { name: 'Prescription (sample).pdf', url: '/uploads/sample-prescription.pdf' }, instructions: 'After lunch' }));
      if (p1) plans += 1;
      const p2 = await attempt('nurse plan', () => health.createPlan(nurse, { studentId: own[0], medicine: { name: 'Salbutamol inhaler', strength: '100 mcg' }, dose: '2 puffs if wheezy', times: ['11:00'], startOn: start, endOn: end }));
      if (p2) plans += 1;
      // Left waiting for the parent's consent on purpose, so the parent page shows the request.
    }
    const controlled = await attempt('controlled plan', () => health.createPlan(nurse, { studentId: kid(1), medicine: { name: 'Methylphenidate (sample)', strength: '10 mg', form: 'Tablet' }, dose: '1 tablet', times: ['10:30'], startOn: start, endOn: end, controlled: true }));
    if (controlled) {
      plans += 1;
      const guardian = await StudentGuardian.findOne({ studentId: kid(1) }).lean();
      const gProfile = guardian ? await Profile.findById(guardian.guardianProfileId).lean() : null;
      const pRole = await Role.findOne({ key: 'PARENT' }).lean();
      if (gProfile && pRole) {
        const g = { accountId: String(gProfile.accountId), profileId: String(gProfile._id), displayName: gProfile.displayName, roleKey: 'PARENT', permissions: buildPermissionMap(pRole), tenantId };
        await attempt('consent controlled plan', () => health.consentPlan(g, controlled.id, { consent: true, prescription: { name: 'Prescription (sample).pdf', url: '/uploads/sample-prescription.pdf' } }));
        // Yesterday's dose, given (awaiting the second person's countersignature on the Health page).
        const yesterday = ymdIst(new Date(Date.now() - DAY));
        await attempt('controlled dose', () => health.recordDose(nurse, { planId: controlled.id, slot: '10:30', status: 'GIVEN', date: yesterday }));
      }
    }
    const active = (await health.listPlans(nurse, { status: 'ACTIVE' })).items;
    for (const p of active.filter((x) => !x.controlled)) {
      for (let d = 1; d <= 2; d += 1) {
        // eslint-disable-next-line no-await-in-loop
        await attempt('dose', () => health.recordDose(nurse, { planId: p.id, slot: p.times[0], status: d === 2 ? 'REFUSED' : 'GIVEN', date: ymdIst(new Date(Date.now() - d * DAY)), note: d === 2 ? 'Said she felt fine' : null }));
      }
    }

    // Stock: one item close to expiry becomes a task for the nurse.
    const soon = ymdIst(new Date(Date.now() + 18 * DAY));
    const later = ymdIst(new Date(Date.now() + 300 * DAY));
    const stock = [
      { name: 'Adrenaline auto-injector (EpiPen)', kind: 'MEDICINE', quantity: 2, unit: 'pens', reorderLevel: 2, expiresOn: soon, controlled: false, batchNo: 'EP-2291' },
      { name: 'Paracetamol 250 mg/5 ml syrup', kind: 'MEDICINE', quantity: 6, unit: 'bottles', reorderLevel: 2, expiresOn: later, batchNo: 'PC-118' },
      { name: 'Sterile gauze swabs', kind: 'FIRST_AID', quantity: 40, unit: 'packs', reorderLevel: 10, expiresOn: later },
      { name: 'Crepe bandage 7.5 cm', kind: 'FIRST_AID', quantity: 4, unit: 'rolls', reorderLevel: 5 },
      { name: 'Digital thermometer', kind: 'EQUIPMENT', quantity: 3, unit: 'units', reorderLevel: 1 },
    ];
    for (const item of stock) {
      // eslint-disable-next-line no-await-in-loop
      await attempt('stock', () => health.addStock(nurse, item));
    }

    // Care notes: one shared by the parent (the class teacher sees it), one the nurse drafted (waiting for consent).
    if (parent && own[0]) await attempt('care note', () => health.createCareNote(parent, { studentId: own[0], text: 'Severe nut allergy: EpiPen in the health room', severity: 'SEVERE', share: true }));
    if (classmates[1]) await attempt('care note 2', () => health.createCareNote(nurse, { studentId: classmates[1], text: 'Asthma: inhaler kept in school bag', severity: 'IMPORTANT' }));

    // Immunisations and this year's screenings for the health card.
    for (const [i, sid] of [child, kid(1), kid(2)].entries()) {
      // eslint-disable-next-line no-await-in-loop
      await attempt('screening', () => health.addEntry(nurse, { studentId: sid, kind: 'SCREENING', on: ymdIst(new Date(Date.now() - 40 * DAY)), heightCm: 138 + i * 4, weightKg: 32 + i * 3, visionLeft: '6/6', visionRight: i === 1 ? '6/12' : '6/6', dental: i === 2 ? 'Two caries; dentist advised' : 'Healthy', hearing: 'Normal' }));
      // eslint-disable-next-line no-await-in-loop
      await attempt('immunisation', () => health.addEntry(nurse, { studentId: sid, kind: 'IMMUNISATION', on: ymdIst(new Date(Date.now() - 200 * DAY)), vaccine: 'Td (tetanus, diphtheria) booster', doseNo: '1', givenAt: 'School health camp' }));
    }
    return `${made} visits, ${plans} medication plans with doses, ${stock.length} stock items (one expiring soon, as a task), care notes, screenings and immunisations`;
  });
}
