/**
 * One-time migration to per-school data isolation.
 *
 * Before this, a school was only a label on its profiles and every school read
 * the same pool of students, fees, tickets, books and rooms. Now each
 * school-owned document carries a `tenantId`, and every query is filtered by
 * the acting school. This script gives the existing data its owner.
 *
 *   node scripts/migrate-to-schools.js                         # dry run
 *   node scripts/migrate-to-schools.js --apply
 *   node scripts/migrate-to-schools.js --apply --allow-remote
 *   node scripts/migrate-to-schools.js --apply --school=oakridge --name="Oakridge Academy"
 *
 * What it does:
 *   1. Creates the School record for the existing data (default: oakridge).
 *   2. Creates a School record for any other tenant already present on a
 *      profile — schools created through the Super Admin console before this.
 *   3. Repoints legacy profiles (tenantId 'eduos-demo-tenant', or missing)
 *      at the existing school.
 *   4. Stamps every unstamped school-owned document with that school.
 *   5. Drops the unique indexes that were global and are now per-school, so
 *      a second school can have its own "Class 5" or admission no. ADM-0001.
 *
 * Safe to re-run: every step only touches documents that have no school yet.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { logger } from '../src/utils/logger.js';
import { School } from '../src/models/school.model.js';
import { Profile } from '../src/models/profile.model.js';

// Collections that belong to a school, and the model file each lives in.
const SCHOOL_OWNED = [
  ['academics.model.js', ['AcademicYear', 'Term', 'Grade', 'Section', 'Subject', 'SubjectOffering']],
  ['agentAction.model.js', ['AgentAction']],
  ['aiCredit.model.js', ['AiCreditWallet', 'AiCreditOrder']],
  ['announcement.model.js', ['Announcement']],
  ['assignment.model.js', ['Assignment', 'Submission']],
  ['attendanceRecord.model.js', ['AttendanceRecord']],
  ['auditLog.model.js', ['AuditLog']],
  ['calendarEvent.model.js', ['CalendarEvent']],
  ['document.model.js', ['Document']],
  ['exam.model.js', ['Exam', 'ExamSubject', 'Mark']],
  ['fee.model.js', ['FeeHead', 'FeeStructure', 'Invoice', 'Payment']],
  ['growthRisk.model.js', ['GrowthScore', 'RiskPrediction']],
  ['hostel.model.js', ['HostelRoom', 'HostelAllocation', 'HostelInquiry']],
  ['lead.model.js', ['Lead', 'LeadInteraction']],
  ['leaveApplication.model.js', ['LeaveApplication']],
  ['library.model.js', ['Book', 'BookIssue']],
  ['medicalRecord.model.js', ['MedicalRecord']],
  ['notification.model.js', ['Notification']],
  ['student.model.js', ['Student', 'StudentGuardian', 'Enrollment']],
  ['subjectRegistration.model.js', ['SubjectRegistration']],
  ['ticket.model.js', ['Ticket', 'TicketMessage']],
  ['timetableSlot.model.js', ['TimetableSlot']],
  ['transport.model.js', ['TransportRoute', 'TransportStop', 'BusEnrollment']],
];

// Indexes that were unique across the whole database and are now unique per
// school. Mongo keeps an index the schema no longer declares, so they have to
// be dropped explicitly or the second school still collides.
const RETIRED_INDEXES = [
  ['students', 'admissionNo_1'],
  ['grades', 'name_1'],
  ['subjects', 'name_1'],
  ['academicyears', 'name_1'],
  ['feeheads', 'name_1'],
  ['hostelrooms', 'roomNo_1'],
];

// Importing the models must not build indexes here: this script drops the
// indexes that were global (step 5), and mongoose racing to create the new
// ones mid-migration only makes that harder to reason about. The app builds
// them on its next boot.
mongoose.set('autoIndex', false);

const LEGACY_TENANTS = ['eduos-demo-tenant', null, undefined, ''];

const APPLY = process.argv.includes('--apply');
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

async function main() {
  const slug = String(arg('school', 'oakridge')).trim().toLowerCase();
  const name = String(arg('name', 'Oakridge Academy')).trim();

  const safeUri = env.MONGO_URI.replace(/\/\/[^@/]*@/, '//[credentials-redacted]@');
  const isLocal = /localhost|127\.0\.0\.1/.test(env.MONGO_URI);
  if (APPLY && !isLocal && !process.argv.includes('--allow-remote')) {
    logger.error(`REFUSING to modify a non-local database (${safeUri}). Re-run with --allow-remote if you are certain.`);
    process.exit(1);
  }

  await mongoose.connect(env.MONGO_URI);
  logger.info(`Connected to MongoDB → ${safeUri} (NODE_ENV=${env.NODE_ENV})`);
  if (!APPLY) logger.warn('DRY RUN — nothing will be written. Re-run with --apply.');
  logger.info(`Existing data will belong to: ${name} (${slug})`);

  // ── 1. the school that owns today's data ──────────────────
  const existing = await School.findOne({ slug });
  if (existing) {
    logger.info(`-  School "${slug}" already exists`);
  } else if (APPLY) {
    await School.create({ slug, name });
    logger.info(`✔  Created school "${slug}"`);
  } else {
    logger.info(`   would create school "${slug}"`);
  }

  // ── 2. schools that only existed as a profile label ───────
  const tenants = (await Profile.distinct('tenantId')).filter(
    (t) => t && !LEGACY_TENANTS.includes(t) && t !== slug,
  );
  for (const t of tenants) {
    if (await School.findOne({ slug: t })) {
      logger.info(`-  School "${t}" already exists`);
      continue;
    }
    const label = (await Profile.findOne({ tenantId: t }).select('tenantName').lean())?.tenantName || t;
    if (APPLY) {
      await School.create({ slug: t, name: label });
      logger.info(`✔  Created school "${t}" (${label}) from existing profiles`);
    } else {
      logger.info(`   would create school "${t}" (${label}) from existing profiles`);
    }
  }

  // ── 3. legacy profiles join the existing school ───────────
  const legacyFilter = { $or: [{ tenantId: { $in: ['eduos-demo-tenant', ''] } }, { tenantId: { $exists: false } }, { tenantId: null }] };
  const legacyCount = await Profile.countDocuments(legacyFilter);
  if (legacyCount === 0) {
    logger.info('-  No legacy profiles to repoint');
  } else if (APPLY) {
    await Profile.updateMany(legacyFilter, { $set: { tenantId: slug, tenantName: name } });
    logger.info(`✔  Repointed ${legacyCount} profile(s) at "${slug}"`);
  } else {
    logger.info(`   would repoint ${legacyCount} profile(s) at "${slug}"`);
  }

  // ── 4. stamp every unowned school-owned document ──────────
  let totalStamped = 0;
  for (const [file, modelNames] of SCHOOL_OWNED) {
    let mod;
    try {
      mod = await import(`../src/models/${file}`);
    } catch (err) {
      logger.warn(`   skipped ${file}: ${err.message}`);
      continue;
    }
    for (const modelName of modelNames) {
      const Model = mod[modelName];
      if (!Model) continue;
      const filter = { $or: [{ tenantId: { $exists: false } }, { tenantId: null }, { tenantId: '' }] };
      const count = await Model.countDocuments(filter);
      if (count === 0) continue;
      totalStamped += count;
      if (APPLY) {
        await Model.updateMany(filter, { $set: { tenantId: slug } });
        logger.info(`✔  ${modelName.padEnd(20)} ${count} document(s) → ${slug}`);
      } else {
        logger.info(`   ${modelName.padEnd(20)} ${count} document(s) would go to ${slug}`);
      }
    }
  }
  logger.info(`${APPLY ? 'Stamped' : 'Would stamp'} ${totalStamped} document(s) in total`);

  // ── 5. retire the indexes that were global ────────────────
  for (const [collection, indexName] of RETIRED_INDEXES) {
    const coll = mongoose.connection.db.collection(collection);
    let indexes;
    try {
      indexes = await coll.indexes();
    } catch {
      continue; // collection does not exist yet
    }
    if (!indexes.some((i) => i.name === indexName)) continue;
    if (APPLY) {
      await coll.dropIndex(indexName);
      logger.info(`✔  Dropped global unique index ${collection}.${indexName} (now unique per school)`);
    } else {
      logger.info(`   would drop global unique index ${collection}.${indexName}`);
    }
  }

  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info(APPLY ? '  Migration complete.' : '  Dry run complete — re-run with --apply.');
  logger.info(`  Portal URL for this school : /${slug}`);
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  logger.error(`Migration failed: ${err.message}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
