/**
 * Removes the retired OWNER role from a database that predates its removal.
 *
 * The boot sequence upserts the roles in SYSTEM_ROLES but never deletes one
 * that has been taken out of the catalog, so an existing deployment keeps an
 * orphaned OWNER role document — and any profile still pointing at it would
 * carry permissions no longer granted by anything. This deletes those profiles
 * and then the role itself.
 *
 *   node scripts/drop-owner-role.js              # report what would change
 *   node scripts/drop-owner-role.js --apply      # perform the deletion
 *   node scripts/drop-owner-role.js --apply --allow-remote
 *
 * Accounts are never deleted: an account keeps every other profile it holds,
 * so someone who was both an Owner and a Teacher stays a Teacher. An account
 * left with no profiles at all cannot sign in (resolveSession refuses) — those
 * are listed by name so an operator can give them a role instead.
 *
 * Platform administration now lives with SUPER_ADMIN; see
 * scripts/create-super-admin.js.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { logger } from '../src/utils/logger.js';
import { Role } from '../src/models/role.model.js';
import { Profile } from '../src/models/profile.model.js';
import { Account } from '../src/models/account.model.js';

const RETIRED_ROLE_KEY = 'OWNER';
const APPLY = process.argv.includes('--apply');

async function main() {
  const safeUri = env.MONGO_URI.replace(/\/\/[^@/]*@/, '//[credentials-redacted]@');
  const isLocal = /localhost|127\.0\.0\.1/.test(env.MONGO_URI);
  if (APPLY && !isLocal && !process.argv.includes('--allow-remote')) {
    logger.error(`REFUSING to modify a non-local database (${safeUri}). Re-run with --allow-remote if you are certain.`);
    process.exit(1);
  }

  await mongoose.connect(env.MONGO_URI);
  logger.info(`Connected to MongoDB → ${safeUri} (NODE_ENV=${env.NODE_ENV})`);
  if (!APPLY) logger.warn('DRY RUN — nothing will be written. Re-run with --apply to perform the deletion.');

  const role = await Role.findOne({ key: RETIRED_ROLE_KEY });
  if (!role) {
    logger.info(`No ${RETIRED_ROLE_KEY} role in this database — nothing to do.`);
    await mongoose.disconnect();
    return;
  }

  const profiles = await Profile.find({ roleId: role._id }).lean();
  logger.info(`Found ${profiles.length} ${RETIRED_ROLE_KEY} profile(s) to remove`);

  // Accounts whose only profile is the one being removed would be left unable
  // to sign in, so name them explicitly rather than discovering it later.
  const stranded = [];
  for (const p of profiles) {
    const others = await Profile.countDocuments({
      accountId: p.accountId,
      _id: { $ne: p._id },
      deletedAt: null,
    });
    const account = await Account.findById(p.accountId).select('email phoneE164').lean();
    logger.info(`  • ${p.displayName} (${account?.email ?? account?.phoneE164 ?? p.accountId}) — ${others} other profile(s)`);
    if (others === 0) stranded.push(account?.email ?? account?.phoneE164 ?? String(p.accountId));
  }

  if (APPLY) {
    const { deletedCount } = await Profile.deleteMany({ roleId: role._id });
    await Role.deleteOne({ _id: role._id });
    logger.info(`✔  Deleted ${deletedCount} profile(s) and the ${RETIRED_ROLE_KEY} role`);
  }

  if (stranded.length) {
    logger.warn(
      `${stranded.length} account(s) now hold no profile and cannot sign in: ${stranded.join(', ')}. ` +
        'Give each one a role (Admin console → User Management), or leave them dormant.',
    );
  }

  logger.info(APPLY ? 'Done.' : 'Dry run complete — re-run with --apply to perform the deletion.');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  logger.error(`Failed to drop the ${RETIRED_ROLE_KEY} role: ${err.message}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
