import { Lead } from '../models/lead.model.js';
import { Campaign } from '../models/marketing.model.js';
import { CommunityPost } from '../models/community.model.js';
import { SocialPost } from '../models/social.model.js';
import { OfflineCampaign, HeardFromOption, AdMetric } from '../models/marketingGrowth.model.js';

/**
 * Sample data for universal search (nothing to seed), newsroom social sharing,
 * offline campaigns, "how did you hear" answers, lead attribution and an
 * imported (fictional) ad-platform export. Everything is fictional: nothing is
 * posted, spent or sent.
 */
export async function seedGrowth({ section, attempt, who }) {
  const { ADMIN, MARKETING, PRINCIPAL } = who;
  const { setFeatures } = await import('../utils/features.js');
  const growth = await import('../modules/marketing/growth.service.js');
  const connectors = await import('../modules/marketing/connectors.service.js');
  const newsroomSocial = await import('../modules/social/newsroom-social.service.js');

  // Always: the demo school has social publishing switched on, so the newsroom offers "Also post to social media".
  await section('Social publishing switched on', null, async () => {
    await setFeatures({ socialPublishing: true });
    return 'socialPublishing on for the demo school';
  });

  await section('Newsroom story shared to social (sample)', null, async () => {
    if (await SocialPost.exists({ communityPostId: { $ne: null } })) return 'kept (a story is already shared)';
    const story = await CommunityPost.create({
      kind: 'EVENT_HIGHLIGHT', title: 'Open day this Saturday (sample)', body: 'Families are welcome to tour the campus from 10 am to 1 pm. (Sample story.)',
      audience: 'PUBLIC', status: 'PUBLISHED', publishedAt: new Date(), authorProfileId: MARKETING.profile._id, authorName: MARKETING.profile.displayName, authorRole: 'MARKETING',
    });
    await newsroomSocial.shareStory(MARKETING.actor, String(story._id), { networks: ['FACEBOOK', 'INSTAGRAM'] });
    return 'one public story shared to Facebook and Instagram — simulated, nothing was posted';
  });

  await section('Offline campaigns (sample)', OfflineCampaign, async () => {
    const umbrella = await Campaign.findOne({}).select('_id').lean();
    const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const plan = [
      { name: 'Sector 21 market posters (sample)', code: 'POSTER-S21', channelType: 'POSTER', placements: [{ location: 'Sector 21 market, bus stop', quantity: 25 }, { location: 'Sector 21 community hall', quantity: 15 }], quantity: 40, vendorName: 'Sample Printers', cost: '4000', promoCode: 'S21', live: true },
      { name: 'Ring road hoarding (sample)', code: 'HOARD-RING', channelType: 'BANNER_HOARDING', placements: [{ location: 'Ring road flyover, eastbound', detail: '20 x 10 ft' }], quantity: 1, vendorName: 'Sample Outdoor Media', cost: '35000', trackingPhone: '9000011111', live: true },
      { name: 'Newspaper insert — city edition (sample)', code: 'NEWS-INSERT', channelType: 'PAMPHLET_FLYER', placements: [{ location: 'City edition, 3 pin codes', quantity: 8000 }], quantity: 8000, vendorName: 'Sample News Agency', cost: '24000', promoCode: 'PAPER27', live: true },
      { name: 'FM 92.7 morning spots (sample)', code: 'RADIO-927', channelType: 'RADIO_SPOT', placements: [{ location: 'Sample FM 92.7', detail: '10 x 20 s, 8–10 am' }], quantity: 10, vendorName: 'Sample Radio', cost: '18000', live: true },
      { name: 'Green Meadows society stall (sample)', code: 'SOC-GREEN', channelType: 'SOCIETY_ACTIVATION', placements: [{ location: 'Green Meadows apartments clubhouse' }], quantity: 1, cost: '3000', live: false },
    ];
    const made = [];
    for (const p of plan) {
      // eslint-disable-next-line no-await-in-loop
      const c = await growth.createOffline(MARKETING.actor, { ...p, startsOn: day(-20), endsOn: day(20), campaignId: umbrella?._id ?? null });
      // eslint-disable-next-line no-await-in-loop
      await growth.moveOffline(MARKETING.actor, c.id, { action: 'SUBMIT' });
      if (p.live) {
        // eslint-disable-next-line no-await-in-loop
        await growth.moveOffline(PRINCIPAL.actor, c.id, { action: 'APPROVE', note: 'Approved (sample)' });
        // eslint-disable-next-line no-await-in-loop
        await growth.moveOffline(MARKETING.actor, c.id, { action: 'GO_LIVE' });
        // eslint-disable-next-line no-await-in-loop
        await OfflineCampaign.updateOne({ _id: c.id }, { $set: { scans: 20 + made.length * 13 } });
      }
      made.push(c);
    }
    const options = [['Poster or banner near home', 'POSTER'], ['Newspaper insert', 'PAMPHLET_FLYER'], ['Radio', 'RADIO_SPOT'], ['Facebook or Instagram', 'META_ADS'], ['Google search', 'ONLINE_SEARCH'], ['A friend or family member', 'WORD_OF_MOUTH'], ['Society or apartment event', 'SOCIETY_ACTIVATION']];
    for (const [i, [label, channel]] of options.entries()) {
      // eslint-disable-next-line no-await-in-loop
      if (!(await HeardFromOption.exists({ label }))) await growth.saveHeardFrom(MARKETING.actor, { label, channel, order: i });
    }
    await growth.saveSettings(MARKETING.actor, { admissionValue: '85000' });
    // Trace some existing sample enquiries back to these campaigns.
    const leads = await Lead.find({}).sort({ createdAt: 1 }).select('_id').limit(24).lean();
    const ways = [{ code: 'POSTER-S21' }, { promoCode: 'PAPER27' }, { trackingPhone: '9000011111' }, { code: 'RADIO-927' }, { promoCode: 'S21' }, { code: 'NEWS-INSERT' }];
    let traced = 0;
    for (const [i, l] of leads.entries()) {
      if (i % 4 === 3) continue; // some stay "not known"
      // eslint-disable-next-line no-await-in-loop
      const ok = await attempt('attribution', () => growth.attributeLead(MARKETING.actor, String(l._id), ways[i % ways.length]));
      if (ok) traced += 1;
    }
    return `${made.length} offline campaigns (4 live, 1 waiting for approval), ${options.length} "how did you hear" answers, ${traced} enquiries traced`;
  });

  await section('Ad platform export (sample)', AdMetric, async () => {
    const camp = await Campaign.findOne({}).select('code').lean();
    const name = camp ? `${camp.code} lead form (sample)` : 'Sample lead form';
    const lines = ['Campaign name,Day,Amount spent (INR),Impressions,Link clicks,Leads'];
    for (let d = 20; d >= 1; d -= 1) {
      const dt = new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
      lines.push(`${name},${dt},${400 + (d * 53) % 300}.00,${12000 + d * 310},${150 + d * 7},${d % 3}`);
    }
    const r = await connectors.importMetrics(MARKETING.actor, 'META_ADS', { csv: lines.join('\n'), fileName: 'meta-ads-sample-export.csv' });
    await connectors.setSample(ADMIN.actor, 'GOOGLE_ADS', true);
    return `${r.accepted} Meta rows imported from a fictional export; Google Ads shows a labelled simulated sample`;
  });
}
