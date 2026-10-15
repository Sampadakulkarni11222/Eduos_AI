import { registerMetric } from '../analytics/catalogue.js';
import { within, pct } from '../analytics/metrics/helpers.js';
import { Lead } from '../../models/lead.model.js';
import { AdMetric, OfflineCampaign, LeadTouch } from '../../models/marketingGrowth.model.js';
import { CHANNEL_LABELS } from './growth.service.js';

/**
 * Marketing figures: spend, cost per lead, cost per admission and conversion
 * by channel. Spend is real only: imported platform rows (never the simulated
 * sample) dated in the period, plus offline campaigns that started in the
 * period (approved or later). Leads and admissions are the CRM's own records.
 */

const LIVE = ['APPROVED', 'LIVE', 'COMPLETED'];

async function spendIn(ctx) {
  return ctx.memo(`mkt-spend:${ctx.period.from}:${ctx.period.to}`, async () => {
    const [online, offline] = await Promise.all([
      AdMetric.find({ simulated: false, ...within('date', ctx.period) }).select('platform spendPaise').lean(),
      OfflineCampaign.find({ status: { $in: LIVE }, ...within('startsOn', ctx.period) }).select('channelType costPaise').lean(),
    ]);
    const by = new Map();
    for (const r of online) by.set(r.platform, (by.get(r.platform) ?? 0) + r.spendPaise);
    for (const r of offline) by.set(r.channelType, (by.get(r.channelType) ?? 0) + (r.costPaise ?? 0));
    const total = [...by.values()].reduce((a, b) => a + b, 0);
    return { total, rows: online.length + offline.length, by };
  });
}

async function leadsIn(ctx) {
  return ctx.memo(`mkt-leads:${ctx.period.from}:${ctx.period.to}`, () => Lead.find(within('createdAt', ctx.period)).select('stage source').lean());
}

const breakdown = (by) => [...by.entries()].map(([k, value]) => ({ label: CHANNEL_LABELS[k] ?? k, value }));
const SOURCES = ['AdMetric', 'OfflineCampaign', 'Lead'];

registerMetric({
  key: 'admissions.marketing_spend', department: 'admissions', label: 'Marketing spend',
  definition: 'Ad spend imported from the platforms for days in the period (simulated sample rows excluded), plus the cost of offline campaigns (approved or later) that started in the period.',
  unit: 'paise', kind: 'flow', dateBasis: 'Day of the platform row; start date of the offline campaign', sources: ['AdMetric', 'OfflineCampaign'], link: '/attribution', version: 1,
  compute: async (ctx) => {
    const s = await spendIn(ctx);
    if (!s.rows) return { value: null, records: 0, note: 'No spend recorded or imported for this period.' };
    return { value: s.total, records: s.rows, breakdown: breakdown(s.by) };
  },
});

registerMetric({
  key: 'admissions.cost_per_lead', department: 'admissions', label: 'Cost per enquiry',
  definition: 'Marketing spend in the period divided by the enquiries created in the period.', numerator: 'Marketing spend', denominator: 'Enquiries created',
  unit: 'paise', kind: 'flow', dateBasis: 'Spend date; enquiry creation date', sources: SOURCES, link: '/attribution', version: 1,
  compute: async (ctx) => {
    const [s, leads] = await Promise.all([spendIn(ctx), leadsIn(ctx)]);
    if (!s.rows || !leads.length) return { value: null, records: leads.length, note: !s.rows ? 'No spend recorded for this period.' : 'No enquiries in this period.' };
    return { value: Math.round(s.total / leads.length), records: leads.length };
  },
});

registerMetric({
  key: 'admissions.cost_per_admission', department: 'admissions', label: 'Cost per admission',
  definition: 'Marketing spend in the period divided by the enquiries created in the period that are now enrolled.', numerator: 'Marketing spend', denominator: 'Enquiries from the period now enrolled',
  unit: 'paise', kind: 'flow', dateBasis: 'Spend date; enquiry creation date (cohort), stage as recorded now', sources: SOURCES, link: '/attribution', version: 1,
  compute: async (ctx) => {
    const [s, leads] = await Promise.all([spendIn(ctx), leadsIn(ctx)]);
    const admitted = leads.filter((l) => l.stage === 'ENROLLED').length;
    if (!s.rows || !admitted) return { value: null, records: leads.length, note: !s.rows ? 'No spend recorded for this period.' : 'No admissions yet from this period\'s enquiries.' };
    return { value: Math.round(s.total / admitted), records: admitted };
  },
});

registerMetric({
  key: 'admissions.conversion_by_channel', department: 'admissions', label: 'Enquiry to admission by channel',
  definition: 'Of the enquiries created in the period, the share now enrolled; the breakdown gives the same share for each channel an enquiry is credited to (its earliest recorded touch, else "Not known").',
  numerator: 'Enquiries now enrolled', denominator: 'Enquiries created',
  unit: 'percent', kind: 'flow', dateBasis: 'Enquiry creation date (cohort); stage as recorded now', sources: ['Lead', 'LeadTouch'], link: '/attribution', version: 1,
  compute: async (ctx) => {
    const leads = await ctx.memo(`mkt-leads-ids:${ctx.period.from}:${ctx.period.to}`, () => Lead.find(within('createdAt', ctx.period)).select('_id stage').lean());
    if (!leads.length) return { value: null, records: 0, note: 'No enquiries in this period.' };
    const touches = await LeadTouch.find({ leadId: { $in: leads.map((l) => l._id) } }).select('leadId channel at').sort({ at: 1 }).lean();
    const first = new Map();
    for (const t of touches) if (!first.has(String(t.leadId))) first.set(String(t.leadId), t.channel);
    const by = new Map();
    for (const l of leads) {
      const k = first.get(String(l._id)) ?? 'UNATTRIBUTED';
      const r = by.get(k) ?? { n: 0, won: 0 };
      r.n += 1; if (l.stage === 'ENROLLED') r.won += 1;
      by.set(k, r);
    }
    const won = leads.filter((l) => l.stage === 'ENROLLED').length;
    return { value: pct(won, leads.length), records: leads.length, breakdown: [...by.entries()].map(([k, r]) => ({ label: CHANNEL_LABELS[k] ?? k, value: pct(r.won, r.n) })) };
  },
});
