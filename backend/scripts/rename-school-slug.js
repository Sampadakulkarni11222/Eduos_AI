/**
 * Changes a school's slug — its URL and the tenant stamped on its data.
 *
 * The slug is deliberately immutable in normal operation: it is carried by
 * every one of the school's documents, so changing it means rewriting all of
 * them together. That is what this script is for — a slug chosen wrongly, or
 * one that no longer matches the school's address.
 *
 *   node scripts/rename-school-slug.js --from nvmp1 --to nvmp
 *   node scripts/rename-school-slug.js --from nvmp1 --to nvmp --apply
 *   node scripts/rename-school-slug.js --from nvmp1 --to nvmp --apply --allow-remote
 *
 * Works whether or not the schools migration has run: with no School record it
 * simply repoints the profiles and any documents already stamped. Refuses if
 * the target slug is taken, so two schools can never collide.
 *
 * Nothing else references a school by slug — sessions are keyed by profile, so
 * anyone signed in keeps working and lands on the new address next time.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { logger } from '../src/utils/logger.js';
import { School } from '../src/models/school.model.js';
import { Profile } from '../src/models/profile.model.js';

// Same set the migration stamps, so a rename can never miss a collection.
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

// Importing the models must not build indexes. A rename only rewrites a field;
// creating ~37 collections' indexes as a side effect is work nobody asked for,
// and on a database still on the old shape it would rebuild indexes the
// migration is about to drop.
mongoose.set('autoIndex', false);

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const APPLY = process.argv.includes('--apply');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : undefined;
}

async function main() {
  const from = String(arg('from') ?? '').trim().toLowerCase();
  const to = String(arg('to') ?? '').trim().toLowerCase();

  if (!from || !to) {
    logger.error('Usage: node scripts/rename-school-slug.js --from <old-slug> --to <new-slug> [--apply] [--allow-remote]');
    process.exit(1);
  }
  if (!SLUG_RE.test(to)) {
    logger.error('The new slug must be 2-64 lowercase letters, digits or hyphens.');
    process.exit(1);
  }
  if (from === to) {
    logger.error('The two slugs are the same — nothing to do.');
    process.exit(1);
  }

  const safeUri = env.MONGO_URI.replace(/\/\/[^@/]*@/, '//[credentials-redacted]@');
  const isLocal = /localhost|127\.0\.0\.1/.test(env.MONGO_URI);
  if (APPLY && !isLocal && !process.argv.includes('--allow-remote')) {
    logger.error(`REFUSING to modify a non-local database (${safeUri}). Re-run with --allow-remote if you are certain.`);
    process.exit(1);
  }

  await mongoose.connect(env.MONGO_URI);
  logger.info(`Connected to MongoDB → ${safeUri} (NODE_ENV=${env.NODE_ENV})`);
  if (!APPLY) logger.warn('DRY RUN — nothing will be written. Re-run with --apply.');
  logger.info(`Renaming school "${from}" → "${to}"`);

  // ── the target must be free ───────────────────────────────
  if (await School.findOne({ slug: to })) {
    logger.error(`A school with id "${to}" already exists. Renaming into it would merge two schools' data.`);
    await mongoose.disconnect();
    process.exit(1);
  }
  const inUse = await Profile.countDocuments({ tenantId: to });
  if (inUse > 0) {
    logger.error(`${inUse} profile(s) already carry "${to}". Refusing, to avoid merging two schools.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  // ── the source has to exist in some form ──────────────────
  const school = await School.findOne({ slug: from });
  const profileCount = await Profile.countDocuments({ tenantId: from });
  if (!school && profileCount === 0) {
    logger.error(`Nothing found under "${from}" — no school record and no profiles.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  // ── 1. the school record ──────────────────────────────────
  if (school) {
    if (APPLY) {
      await School.updateOne({ _id: school._id }, { $set: { slug: to } });
      logger.info(`✔  School record "${from}" → "${to}" (${school.name})`);
    } else {
      logger.info(`   would rename the school record "${from}" → "${to}" (${school.name})`);
    }
  } else {
    logger.info('-  No School record yet (migration not run); repointing profiles and data only');
  }

  // ── 2. its people ─────────────────────────────────────────
  if (profileCount === 0) {
    logger.info('-  No profiles to repoint');
  } else if (APPLY) {
    await Profile.updateMany({ tenantId: from }, { $set: { tenantId: to } });
    logger.info(`✔  Repointed ${profileCount} profile(s)`);
  } else {
    logger.info(`   would repoint ${profileCount} profile(s)`);
  }

  // ── 3. its data ───────────────────────────────────────────
  let total = 0;
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
      const count = await Model.countDocuments({ tenantId: from });
      if (count === 0) continue;
      total += count;
      if (APPLY) {
        await Model.updateMany({ tenantId: from }, { $set: { tenantId: to } });
        logger.info(`✔  ${modelName.padEnd(20)} ${count} document(s)`);
      } else {
        logger.info(`   ${modelName.padEnd(20)} ${count} document(s) would move`);
      }
    }
  }
  logger.info(`${APPLY ? 'Moved' : 'Would move'} ${total} document(s) in total`);

  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info(APPLY ? `  Done. This school is now at /${to}` : `  Dry run complete — re-run with --apply.`);
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  logger.error(`Rename failed: ${err.message}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
