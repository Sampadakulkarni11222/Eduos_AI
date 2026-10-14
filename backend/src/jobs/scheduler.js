import { School } from '../models/school.model.js';
import { JobRun } from '../models/jobRun.model.js';
import { NoticeSource } from '../models/compliance.model.js';
import { runWithTenant } from '../tenancy/tenantContext.js';
import { logger } from '../utils/logger.js';
import * as messaging from '../modules/messaging/messaging.service.js';
import * as correspondence from '../modules/administration/correspondence.service.js';
import * as verification from '../modules/administration/verification.service.js';
import * as governance from '../modules/governance/governance.service.js';
import * as compliance from '../modules/compliance/compliance.service.js';
import * as lectures from '../modules/lectures/lecture.service.js';

/**
 * The in-process scheduler for the operations modules.
 *
 * Every job here is something an administrator can also trigger by hand, and
 * every one is idempotent, so a missed or repeated tick does no harm. Jobs run
 * per school, inside that school's tenant context, exactly as a request would.
 *
 * Nothing here decides anything: jobs send reminders, release messages that
 * were held for quiet hours, mark lapsed clearances as expired and notice that
 * a watched page changed. Approving, filing and deciding stay with people.
 *
 * `everyMinutes` is the window: a job runs at most once per school per window,
 * across all server processes (see JobRun).
 */
const SYSTEM = { system: true, profileId: null, displayName: 'Scheduler', roleKey: 'SYSTEM', permissions: {} };

export const JOBS = [
  { key: 'messaging.release', everyMinutes: 15, run: (now) => messaging.releaseDeferred(SYSTEM, { now }) },
  // Every five minutes with a twenty-minute look-ahead: each class is reminded once, 15 to 20 minutes before it starts.
  { key: 'lectures.reminders', everyMinutes: 5, run: (now) => lectures.sendReminders(SYSTEM, { now }) },
  { key: 'verification.expire', everyMinutes: 60, run: (now) => verification.expireLapsed(now) },
  { key: 'governance.reminders', everyMinutes: 60, run: () => governance.sendReminders(SYSTEM, { hours: 48 }) },
  { key: 'correspondence.reminders', everyMinutes: 24 * 60, run: (now) => correspondence.sendDueReminders(SYSTEM, { withinDays: 3, now }) },
  { key: 'compliance.reminders', everyMinutes: 24 * 60, run: (now) => compliance.sendDeadlineReminders(SYSTEM, { withinDays: 14, now }) },
  {
    key: 'compliance.notices',
    everyMinutes: 24 * 60,
    run: async () => {
      const sources = await NoticeSource.find({ active: { $ne: false } }).select('_id').lean();
      let changed = 0;
      for (const s of sources) {
        // eslint-disable-next-line no-await-in-loop -- one outbound request at a time, by design
        const out = await compliance.checkNoticeSource(SYSTEM, String(s._id));
        if (out.notice) changed += 1;
      }
      return { checked: sources.length, changed };
    },
  },
];

/** Runs every job that is due for every active school. Returns what ran, for tests and logs. */
export async function tick(now = new Date()) {
  const schools = await School.find({ status: 'ACTIVE' }).select('slug').lean();
  const ran = [];
  for (const { slug } of schools) {
    for (const job of JOBS) {
      const window = Math.floor(now.getTime() / (job.everyMinutes * 60_000));
      const key = `${job.key}:${slug}:${window}`;
      let claim;
      try {
        // eslint-disable-next-line no-await-in-loop -- jobs run one at a time so a slow school cannot starve the database
        claim = await JobRun.create({ key, job: job.key, tenantId: slug, startedAt: now });
      } catch (err) {
        if (err?.code === 11000) continue; // already done (or being done) for this window
        throw err;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await runWithTenant(slug, () => job.run(now));
        claim.ok = true;
        claim.result = result ?? null;
      } catch (err) {
        claim.ok = false;
        claim.error = String(err?.message ?? err).slice(0, 500);
        logger.error(`Scheduled job ${job.key} failed for ${slug}: ${claim.error}`);
      }
      claim.finishedAt = new Date();
      // eslint-disable-next-line no-await-in-loop
      await claim.save();
      ran.push({ job: job.key, tenantId: slug, ok: claim.ok });
    }
  }
  return ran;
}

let timer = null;
let running = false;

/** Starts the scheduler: one tick a minute, never two at once. */
export function startScheduler({ intervalMs = 60_000 } = {}) {
  if (timer) return;
  const beat = async () => {
    if (running) return;
    running = true;
    try { await tick(); } catch (err) { logger.error(`Scheduler tick failed: ${err.message}`); } finally { running = false; }
  };
  timer = setInterval(beat, intervalMs);
  timer.unref?.();
  logger.info(`✔  Scheduler started  →  ${JOBS.length} jobs, checked every ${Math.round(intervalMs / 1000)}s`);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
