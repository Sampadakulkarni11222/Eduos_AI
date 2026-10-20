import { School } from '../models/school.model.js';
import { JobRun } from '../models/jobRun.model.js';
import { NoticeSource } from '../models/compliance.model.js';
import { runWithTenant } from '../tenancy/tenantContext.js';
import { logger } from '../utils/logger.js';
import { featureEnabled } from '../utils/features.js';
import * as messaging from '../modules/messaging/messaging.service.js';
import * as correspondence from '../modules/administration/correspondence.service.js';
import * as verification from '../modules/administration/verification.service.js';
import * as governance from '../modules/governance/governance.service.js';
import * as compliance from '../modules/compliance/compliance.service.js';
import * as lectures from '../modules/lectures/lecture.service.js';
import * as marketing from '../modules/marketing/marketing.service.js';
import * as tasks from '../modules/tasks/tasks.service.js';
import * as fleetTrips from '../modules/fleet/trips.service.js';
import * as visitorsSvc from '../modules/safety/visitors.service.js';
import * as pickupSvc from '../modules/safety/pickup.service.js';
import * as outpassSvc from '../modules/hostel/outpass.service.js';
import * as libraryDesk from '../modules/library/library.desk.js';
import * as cameraSvc from '../modules/safety/camera.service.js';
import * as cctvSvc from '../modules/cctv/cctv.service.js';
import * as ptm from '../modules/ptm/ptm.service.js';
import * as quarterlyReports from '../modules/analytics/quarterly.service.js';
import { runLabsDue } from '../modules/labs/labs.due.js';
import { syncDuties as syncSanitation } from '../modules/sustainability/sustainability.sanitation.js';
import { runAttendanceReminders as runClubRegisters } from '../modules/clubs/sessions.service.js';
import { runBillsDue } from '../modules/bills/bills.service.js';
import { syncRenewals } from '../modules/bills/renewals.service.js';
import { runDaily as runDigest } from '../modules/digest/digest.service.js';
import { runScheduled as runNewsletter } from '../modules/newsletter/editions.service.js';
import { pollFeeds as pollAlertFeeds, extractPending as extractAlertItems } from '../modules/newsletter/alerts.service.js';
import { syncAllConnected as runAdSync } from '../modules/integrations/adsync.service.js';
import { refreshDue as refreshSocialEngagement } from '../modules/integrations/engagement.service.js';
import { runSchoolAutomations } from '../modules/automations/automations.jobs.js';
import { runPersonalDue } from '../modules/automations/personal.js';

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
  // Reminders at each lead time, escalation of overdue items, and items whose owner left.
  // Transport and safety: trip delay / GPS-health alerts, visitor overstays and expired delegations,
  // late out-pass returns, camera evidence past retention.
  { key: 'fleet.alerts', everyMinutes: 5, feature: 'fleet', run: (now) => fleetTrips.runAlerts({ now }) },
  { key: 'visitors.overstay', everyMinutes: 15, feature: 'visitors', run: async (now) => ({ ...(await visitorsSvc.alertOverstays({ now })), ...(await pickupSvc.expireDelegations(now)) }) },
  { key: 'hostel.outpass.late', everyMinutes: 15, feature: 'hostelOutpass', run: (now) => outpassSvc.alertLate({ now }) },
  // Not feature-gated: evidence past retention is purged even after a school switches cameras off.
  { key: 'camera.retention', everyMinutes: 24 * 60, run: (now) => cameraSvc.purgeEvidence({ now }) },
  // Live CCTV: idle or over-long viewings are ended (not gated, so switching the feature off still closes them);
  // camera health is probed on the school's gateway (no video is fetched).
  { key: 'cctv.sessions', everyMinutes: 5, run: (now) => cctvSvc.sweepSessions({ now }) },
  { key: 'cctv.health', everyMinutes: 15, run: (now) => cctvSvc.scheduledHealthCheck({ now }) },
  { key: 'tasks.reminders', everyMinutes: 60, feature: 'tasks', run: (now) => tasks.runReminders({ now }) },
  // PTM: day-before and hour-before reminders to families (once each), and waiting-list offers that ran out passed on.
  { key: 'ptm.reminders', everyMinutes: 15, feature: 'ptm', run: (now) => ptm.runReminders({ now }) },
  // The previous quarter's report, once per school (quarter + version is unique), then its deliveries; a rerun only retries what failed.
  { key: 'reports.quarterly', everyMinutes: 6 * 60, feature: 'analytics', leaseMinutes: 45, run: (now) => quarterlyReports.generateScheduled({ now }) },
  // Lab expiries, calibrations, warranty/AMC ends, licence renewals and low stock into the tasks queue.
  { key: 'labs.due', everyMinutes: 24 * 60, feature: 'labs', run: (now) => runLabsDue({ now }) },
  // Sanitation duties (toilet cleaning, pad dispensers, incinerators, water tanks): the next occurrence of each as a task.
  { key: 'sustainability.sanitation', everyMinutes: 60, feature: 'sustainability', run: (now) => syncSanitation({ now }) },
  // Club sessions that ended without a register become a task for the coach.
  { key: 'clubs.registers', everyMinutes: 60, feature: 'clubs', run: (now) => runClubRegisters({ now }) },
  // Unpaid bills, expected bills, AMC visits and the renewals list (licences, agreements, warranties) into the tasks queue.
  { key: 'bills.due', everyMinutes: 24 * 60, feature: 'bills', run: async (now) => ({ bills: await runBillsDue(), renewals: await syncRenewals({ now }) }) },
  // A seat offer past its last day frees the seat; nobody is offered it automatically.
  { key: 'marketing.offers.expire', everyMinutes: 60, run: (now) => marketing.expireOffers({ now }) },
  // Part 4: a library reservation not collected by its date goes back, and the copy passes to the next in line.
  { key: 'library.holds.expire', everyMinutes: 60, run: (now) => libraryDesk.expireHolds({ now }) },
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
  // Daily learning digest: fetch the admin-approved feeds (SSRF-safe), then build each person's digest; email only to those who opted in.
  { key: 'digest.daily', everyMinutes: 24 * 60, feature: 'digest', run: (now) => runDigest({ now }) },
  // Part 4 newsletter: opportunity candidates from the approved feeds, this week's and this month's drafts (once per period;
  // an editor publishes), and "Remind me" deadline reminders through the outbox.
  { key: 'newsletter.daily', everyMinutes: 24 * 60, feature: 'newsletter', run: (now) => runNewsletter({ now }) },
  // Part 5 newsletter alerts: read the editor-added feeds that are due (hourly; a failing feed backs off 2h, 4h ... a day),
  // then turn new items into review-queue candidates (unique per item; nothing is published). Both idempotent.
  { key: 'newsletter.alerts.poll', everyMinutes: 60, feature: 'newsletterAlerts', run: async (now) => ((await featureEnabled('newsletter')) ? pollAlertFeeds({ now }) : { skipped: 'newsletter is switched off' }) },
  { key: 'newsletter.alerts.extract', everyMinutes: 30, feature: 'newsletterAlerts', run: async (now) => ((await featureEnabled('newsletter')) ? extractAlertItems({ now }) : { skipped: 'newsletter is switched off' }) },
  // Live ad sync: daily campaign metrics for the last three days from each connected ad account; re-syncing replaces, never doubles.
  // Makes no request at all for a school with no connected account (or when the provider app is not configured).
  // Gated inside run (not `feature:`) because both switches are off by default and the job is still listed for every school.
  { key: 'marketing.adsync', everyMinutes: 6 * 60, run: async (now) => ((await featureEnabled('adSync')) ? runAdSync({ now }) : { skipped: 'adSync is switched off' }) },
  // Likes, comments and shares read back for posts really sent in the last 30 days (simulated posts are never asked about).
  // Part 7 automations: each school automation decides for itself whether it is on, due (its hour, its weekday, a school
  // day) and outside the quiet window, and claims its day once (JobRun); every message goes through the outbox.
  { key: 'automations.school', everyMinutes: 15, run: (now) => runSchoolAutomations({ now }) },
  // A person's own reminders and reports (set up in Ask AI), each once per run time.
  { key: 'automations.personal', everyMinutes: 15, run: (now) => runPersonalDue({ now }) },
  { key: 'social.engagement', everyMinutes: 6 * 60, run: async (now) => ((await featureEnabled('socialPublishing')) ? refreshSocialEngagement({ now }) : { skipped: 'socialPublishing is switched off' }) },
];

/** Runs every job that is due for every active school. Returns what ran, for tests and logs. */
export async function tick(now = new Date()) {
  const schools = await School.find({ status: 'ACTIVE' }).select('slug').lean();
  const ran = [];
  for (const { slug } of schools) {
    for (const job of JOBS) {
      // A school that has switched a module off gets none of its background work either.
      // eslint-disable-next-line no-await-in-loop
      if (job.feature && !(await featureEnabled(job.feature, slug))) continue;
      const window = Math.floor(now.getTime() / (job.everyMinutes * 60_000));
      const key = `${job.key}:${slug}:${window}`;
      let claim;
      try {
        // eslint-disable-next-line no-await-in-loop -- jobs run one at a time so a slow school cannot starve the database
        claim = await JobRun.create({ key, job: job.key, tenantId: slug, startedAt: now });
      } catch (err) {
        if (err?.code !== 11000) throw err;
        // Already done, or being done, for this window -- unless the worker that
        // claimed it died before finishing. A claim whose lease has run out with
        // no finish is taken over (atomically: only one taker), so a crash does
        // not silently lose a daily or quarterly run.
        const leaseMs = (job.leaseMinutes ?? 30) * 60_000;
        // eslint-disable-next-line no-await-in-loop
        claim = await JobRun.findOneAndUpdate(
          { key, finishedAt: null, startedAt: { $lt: new Date(now.getTime() - leaseMs) } },
          { $set: { startedAt: now }, $inc: { attempts: 1 } },
          { new: true },
        );
        if (!claim) continue;
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
