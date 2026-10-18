import * as alerts from '../../../newsletter/alerts.service.js';
import * as editionsAi from '../../../newsletter/editionsAi.service.js';
import { NewsletterEdition, OPP_DOMAINS, OPP_LEVELS } from '../../../../models/newsletter.model.js';
import { AppError } from '../../../../utils/AppError.js';
import { featureEnabled } from '../../../../utils/features.js';
import { ok, action } from '../protocol.js';
import { RISK } from './_shared.js';

/**
 * The newsletter's alert feeds and AI help, through the assistant (part 5).
 * The same services the Newsletter desk uses, editor only (digest.manage for
 * the whole school):
 *
 *   add_google_alert_feed          CREATE  add a Google Alert's RSS feed (https://www.google.com/alerts/feeds/...) with tags
 *   get_newsletter_review_queue    GET     what waits in the review queue, by source, with the newest candidates
 *   regenerate_newsletter_hook     UPDATE  write a fresh hook for this week's (or month's) draft edition
 *
 * Writes are drafted and confirmed by the same editor. Nothing here publishes
 * an item or an edition: the editor does that on the Newsletter desk. Google
 * Alerts has no API; a feed is its RSS delivery, read like any approved feed.
 */
const text = (max, description) => ({ type: 'string', maxLength: max, ...(description && { description }) });
const closed = (properties, required = []) => ({ type: 'object', properties, ...(required.length && { required }), additionalProperties: false });

function behind(feature, tool) {
  const gate = async () => {
    for (const f of ['newsletter', feature]) {
      // eslint-disable-next-line no-await-in-loop
      if (!(await featureEnabled(f))) throw new AppError(f === 'newsletter' ? 'Opportunities and the newsletter are switched off for this school.' : 'Newsletter alert feeds are switched off for this school.', 403, [], 'FEATURE_OFF');
    }
  };
  const { run, prepare } = tool;
  return {
    ...tool,
    feature,
    async run(ctx, args, prepared) { await gate(); return run.call(this, ctx, args, prepared); },
    ...(prepare && { async prepare(ctx, args) { await gate(); return prepare.call(this, ctx, args); } }),
  };
}

export const newsletterP5Tools = {
  add_google_alert_feed: behind('newsletterAlerts', {
    module: 'Newsletter', operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: "Editor: add a Google Alert to the newsletter's alert feeds. Give the alert's RSS feed address (in Google Alerts: Show options → Deliver to: RSS feed → copy the RSS link; it starts https://www.google.com/alerts/feeds/), a name, and optional tags: domains, level, region, and the words the alert watches. EduOS reads it hourly; items become candidates in the review queue (nothing is published). This is Google Alerts' RSS delivery, not an API. Needs confirmation.",
    inputSchema: closed({
      feedAddress: text(300, 'The Google Alerts RSS feed address, https://www.google.com/alerts/feeds/<number>/<number>'),
      title: text(120, 'A name for the feed, e.g. "Science olympiads India"'),
      query: text(200, 'The words the alert watches (for reference)'),
      domains: { type: 'array', items: { type: 'string', enum: OPP_DOMAINS }, maxItems: 5 },
      level: { type: 'string', enum: OPP_LEVELS },
      region: text(80, 'A state, for state-level alerts'),
    }, ['feedAddress', 'title']),
    permission: 'digest.manage', minScope: 'ALL',
    service: 'newsletter/alerts.service.addSource()',
    summarise: (a) => `Add the Google Alert feed "${a.title}"${a.domains?.length ? ` (${a.domains.join(', ')})` : ''} to the newsletter's alert feeds; it is read hourly and its items wait in the review queue`,
    async run(ctx, args) {
      const s = await alerts.addSource(ctx.actor, { kind: 'GOOGLE_ALERT', url: args.feedAddress, title: args.title, query: args.query, tags: { domains: args.domains ?? [], level: args.level ?? null, region: args.region ?? null } });
      return action({ type: 'newsletter_alert_feed_added', id: s.id, data: { title: s.title, url: s.url, tags: s.tagLabels, link: '/newsletter-desk?tab=alerts' }, speak: `Added "${s.title}". EduOS reads it every hour; what it finds waits in the review queue for you.` });
    },
  }),

  get_newsletter_review_queue: behind('newsletter', {
    module: 'Newsletter', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: "Editor: what is waiting in the newsletter review queue: how many items from staff, the starter list, approved feeds and alert feeds (Google Alerts RSS), the newest candidates with how they were extracted (AI or auto, each detail with its source text on the desk), and feed items not yet processed. Read-only.",
    inputSchema: closed({ limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Default 10' } }),
    permission: 'digest.manage', minScope: 'ALL',
    service: 'newsletter/alerts.service.reviewQueue()',
    async run(ctx, args) {
      const q = await alerts.reviewQueue(ctx.actor, { limit: args.limit ?? 10 });
      const from = Object.entries(q.bySource).map(([k, n]) => `${n} from ${{ ALERT: 'alert feeds', FEED: 'approved feeds', CATALOGUE: 'the starter list', STAFF: 'staff' }[k] ?? k.toLowerCase()}`).join(', ');
      return ok({ ...q, link: '/newsletter-desk?tab=queue' }, { speak: q.total ? `${q.total} item(s) waiting: ${from}. Newest: ${q.items.slice(0, 3).map((i) => i.title).join('; ')}. Review them on the Newsletter desk.` : `The review queue is empty.${q.feedItemsWaiting ? ` ${q.feedItemsWaiting} feed item(s) are still being processed.` : ''}` });
    },
  }),

  regenerate_newsletter_hook: behind('newsletter', {
    module: 'Newsletter', operation: 'UPDATE', risk: RISK.LOW, confirm: true,
    description: "Editor: write a fresh opening hook for this week's (default) or this month's DRAFT newsletter. With an AI key it is written from the edition's published items and checked against them (otherwise the template writes another). A published edition is never changed, and nothing is sent: the editor reviews and publishes on the Newsletter desk. Needs confirmation.",
    inputSchema: closed({ cadence: { type: 'string', enum: ['WEEKLY', 'MONTHLY'], description: 'Default WEEKLY' } }),
    permission: 'digest.manage', minScope: 'ALL',
    service: 'newsletter/editionsAi.service.regenerateSection()',
    summarise: (a) => `Write a fresh hook for ${a.cadence === 'MONTHLY' ? "this month's" : "this week's"} draft newsletter (nothing is published or sent)`,
    async run(ctx, args) {
      const cadence = args.cadence ?? 'WEEKLY';
      const e = await NewsletterEdition.findOne({ cadence, status: 'DRAFT' }).sort({ createdAt: -1 }).select('_id').lean();
      if (!e) throw new AppError(`There is no ${cadence === 'MONTHLY' ? 'monthly' : 'weekly'} draft to change. Draft one first ("draft this week's newsletter").`, 404, [], 'NOT_FOUND');
      const out = await editionsAi.regenerateSection(ctx.actor, String(e._id), { section: 'hook' });
      return action({ type: 'newsletter_hook_regenerated', id: e._id, data: { hook: out.content.hook, writtenBy: out.writtenBy, message: out.message, link: `/newsletter-desk?tab=editions&id=${e._id}` }, speak: `New hook: "${out.content.hook.text}" ${out.message}` });
    },
  }),
};
