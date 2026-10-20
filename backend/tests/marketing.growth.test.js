import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import express from 'express';
import mongoose from 'mongoose';
import { seedRoles, seedPerson, inSchool, OAK, RIVER } from './support/mcpSchool.js';
import { Lead } from '../src/models/lead.model.js';
import { Campaign, CounsellingAppointment } from '../src/models/marketing.model.js';
import { AdMetric, LeadTouch, MarketingConnector, OfflineCampaign } from '../src/models/marketingGrowth.model.js';
import { School } from '../src/models/school.model.js';
import * as growth from '../src/modules/marketing/growth.service.js';
import * as connectors from '../src/modules/marketing/connectors.service.js';

/**
 * Offline campaigns, attribution, ad connectors and the lead webhook.
 */
let P;
const inOak = (fn) => inSchool(OAK, fn);
const lead = (extra = {}) => inOak(() => Lead.create({ childName: 'Kid', guardianName: 'Parent', phone: `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, ...extra }));
const day = (d) => new Date(Date.UTC(2026, 9, d));

beforeEach(async () => {
  const roles = await seedRoles();
  P = {};
  for (const key of ['ADMIN', 'PRINCIPAL', 'MARKETING', 'PARENT', 'TEACHER']) P[key] = await seedPerson({ roleKey: key, roleId: roles[key], displayName: `${key} person` });
  P.RIVER_MARKETING = await seedPerson({ roleKey: 'MARKETING', roleId: roles.MARKETING, tenantId: RIVER });
});

async function poster(extra = {}) {
  return inOak(() => growth.createOffline(P.MARKETING.actor, {
    name: 'Sector 21 posters', code: 'POSTER-S21', channelType: 'POSTER', startsOn: '2026-10-01', endsOn: '2026-10-31',
    placements: [{ location: 'Sector 21 market', quantity: 40 }], quantity: 40, vendorName: 'Sample Printers', cost: '4000', promoCode: 'S21', trackingPhone: '+91 90000 11111', ...extra,
  }));
}

describe('offline campaigns', () => {
  it('needs a second person to approve, and a reason to reject', async () => {
    const c = await poster();
    expect(c).toMatchObject({ status: 'DRAFT', code: 'POSTER-S21', costPaise: 400000, channelLabel: 'Poster' });
    await inOak(() => growth.moveOffline(P.MARKETING.actor, c.id, { action: 'SUBMIT' }));
    await expect(inOak(() => growth.moveOffline(P.MARKETING.actor, c.id, { action: 'APPROVE' }))).rejects.toMatchObject({ code: 'SELF_APPROVAL' });
    await expect(inOak(() => growth.moveOffline(P.ADMIN.actor, c.id, { action: 'REJECT' }))).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    await expect(inOak(() => growth.moveOffline(P.PARENT.actor, c.id, { action: 'APPROVE' }))).rejects.toMatchObject({ statusCode: 403 });
    const ok = await inOak(() => growth.moveOffline(P.PRINCIPAL.actor, c.id, { action: 'APPROVE', note: 'Fine' }));
    expect(ok.status).toBe('APPROVED');
    // The plan is fixed once approved; cost changes need a reason.
    await expect(inOak(() => growth.updateOffline(P.MARKETING.actor, c.id, { name: 'New' }))).rejects.toMatchObject({ code: 'LOCKED' });
    await expect(inOak(() => growth.updateOffline(P.MARKETING.actor, c.id, { cost: '4500' }))).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    expect((await inOak(() => growth.updateOffline(P.MARKETING.actor, c.id, { cost: '4500', note: 'Final invoice' }))).costPaise).toBe(450000);
    await expect(poster()).rejects.toMatchObject({ code: 'DUPLICATE_CODE' });
  });

  it('counts short-link opens only for an approved campaign', async () => {
    const c = await poster();
    expect(await inOak(() => growth.scan('poster-s21'))).toBeNull();
    await inOak(() => OfflineCampaign.updateOne({ _id: c.id }, { $set: { status: 'LIVE' } }));
    const hit = await inOak(() => growth.scan('POSTER-S21'));
    expect(hit.utm).toEqual({ utm_source: 'offline', utm_medium: 'poster', utm_campaign: 'POSTER-S21' });
    expect((await inOak(() => OfflineCampaign.findById(c.id).lean())).scans).toBe(1);
  });
});

describe('attribution', () => {
  it('credits each enquiry once to its earliest touch and reports cost, CPE, CPA and ROI', async () => {
    const c = await poster();
    await inOak(() => OfflineCampaign.updateOne({ _id: c.id }, { $set: { status: 'LIVE' } }));
    const heard = await inOak(() => growth.saveHeardFrom(P.MARKETING.actor, { label: 'Radio', channel: 'RADIO_SPOT' }));
    const a = await lead({ stage: 'ENROLLED' });
    const b = await lead({ stage: 'CONTACTED' });
    const cl = await lead({ stage: 'NEW' });
    const d = await lead({ stage: 'APPLICATION' });
    await inOak(() => CounsellingAppointment.create({ leadId: b._id, counsellorProfileId: P.MARKETING.profile._id, kind: 'CAMPUS_TOUR', at: new Date() }));
    // a: promo code at the online form, then radio later — the poster is credited.
    await inOak(() => growth.recordFormAttribution(a._id, { promoCode: 's21' }));
    await inOak(() => growth.attributeLead(P.MARKETING.actor, String(a._id), { heardFromId: heard.id }));
    // b: the tracking phone number; c: QR code; d: radio only.
    await inOak(() => growth.attributeLead(P.MARKETING.actor, String(b._id), { trackingPhone: '9000011111' }));
    await inOak(() => growth.recordFormAttribution(cl._id, { utm_source: 'offline', utm_campaign: 'POSTER-S21', mc: 'POSTER-S21' }));
    await inOak(() => growth.attributeLead(P.MARKETING.actor, String(d._id), { heardFromId: heard.id }));
    await expect(inOak(() => growth.attributeLead(P.MARKETING.actor, String(d._id), { promoCode: 'NOPE' }))).rejects.toMatchObject({ code: 'NO_MATCH' });

    const att = await inOak(() => growth.leadAttribution(P.MARKETING.actor, String(a._id)));
    expect(att.credited.channel).toBe('POSTER');
    expect(att.touches).toHaveLength(2);

    await inOak(() => growth.saveSettings(P.MARKETING.actor, { admissionValue: '60000' }));
    const r = await inOak(() => growth.attributionReport(P.MARKETING.actor, {}));
    const row = r.offline.find((x) => x.code === 'POSTER-S21');
    expect(row).toMatchObject({ enquiries: 3, visits: 2, applications: 1, admissions: 1, costPaise: 400000, costPerEnquiryPaise: 133333, costPerAdmissionPaise: 400000 });
    expect(row.roiPct).toBe(1400); // (1 × 60,000 − 4,000) ÷ 4,000
    const radio = r.channels.find((x) => x.channel === 'RADIO_SPOT');
    expect(radio).toMatchObject({ enquiries: 1, applications: 1, admissions: 0 });
    expect(r.totals.enquiries).toBe(4);
    // The CSV export neutralises formulas.
    expect(growth.csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
  });
});

describe('connectors', () => {
  const metaCsv = [
    'Report: Oakridge sample export',
    'Campaign name,Day,Amount spent (INR),Impressions,Link clicks,Leads',
    'ADM27 Open day,2026-10-01,"1,250.50",40211,612,18',
    'ADM27 Open day,02/10/2026,₹ 980,30000,400,9',
    '"=HYPERLINK(""http://evil"")",2026-10-03,10,1,1,0',
    'Bad date,someday,10,1,1,1',
    'Formula number,2026-10-04,=1+1,1,1,1',
    'Total,,2230.50,,,',
  ].join('\n');

  it('imports a platform export, validating rows and neutralising formulas; re-import replaces', async () => {
    await inOak(() => Campaign.create({ name: 'Admissions 2027', code: 'ADM27', startsOn: day(1), endsOn: day(31) }));
    const r = await inOak(() => connectors.importMetrics(P.MARKETING.actor, 'META_ADS', { csv: metaCsv, fileName: 'meta.csv' }));
    expect(r).toMatchObject({ accepted: 3, rejected: 2, matchedToCampaigns: 2 });
    expect(r.problems.map((x) => x.row)).toEqual([5, 6]);
    const rows = await inOak(() => AdMetric.find({}).sort({ date: 1 }).lean());
    expect(rows.map((x) => x.spendPaise)).toEqual([125050, 98000, 1000]);
    expect(rows[2].campaignName).toBe('\'=HYPERLINK("http://evil")');
    await inOak(() => connectors.importMetrics(P.MARKETING.actor, 'META_ADS', { csv: metaCsv }));
    expect(await inOak(() => AdMetric.countDocuments())).toBe(3);
    await expect(inOak(() => connectors.importMetrics(P.MARKETING.actor, 'GOOGLE_ADS', { csv: 'foo,bar\n1,2' }))).rejects.toMatchObject({ code: 'MISSING_COLUMNS' });
    await expect(inOak(() => connectors.importMetrics(P.PARENT.actor, 'META_ADS', { csv: metaCsv }))).rejects.toMatchObject({ statusCode: 403 });

    // Simulated sample: labelled, never counted as spend.
    await inOak(() => connectors.setSample(P.MARKETING.actor, 'GOOGLE_ADS', true));
    const rep = await inOak(() => growth.attributionReport(P.MARKETING.actor, {}));
    expect(rep.simulatedSpendPaise).toBeGreaterThan(0);
    expect(rep.channels.find((c) => c.channel === 'GOOGLE_ADS').costPaise).toBe(0);
    expect(rep.online.find((c) => c.code === 'ADM27').costPaise).toBe(223050);
    await inOak(() => connectors.setSample(P.MARKETING.actor, 'GOOGLE_ADS', false));
    expect(await inOak(() => AdMetric.countDocuments({ simulated: true }))).toBe(0);
  });

  it('keeps credentials encrypted and says live sync is not built', async () => {
    const out = await inOak(() => connectors.saveCredentials(P.MARKETING.actor, 'META_ADS', { token: 'EAAB-SECRET-TOKEN-1234', accountLabel: 'act_1' }));
    expect(out).toMatchObject({ status: 'CREDENTIALS_SAVED', credentialHint: '…1234' });
    const raw = await mongoose.connection.collection(MarketingConnector.collection.collectionName).find({}).toArray();
    expect(JSON.stringify(raw)).not.toMatch(/SECRET-TOKEN/);
    expect(JSON.stringify(await inOak(() => connectors.listConnectors(P.MARKETING.actor)))).not.toMatch(/SECRET|credentialEnc/);
    expect((await inOak(() => connectors.sync(P.MARKETING.actor, 'META_ADS'))).synced).toBe(false);
  });

  it('lead CSV import de-duplicates by phone and email', async () => {
    await lead({ phone: '+919811100001', childName: 'Existing' });
    const csv = 'id,full_name,phone_number,email,campaign_name\n1,Asha Rao,+91 98111 00001,,ADM27\n2,Ravi Jain,9811100002,ravi@example.com,ADM27\n3,Ravi J,,RAVI@example.com,ADM27\n4,No contact,,,ADM27';
    const r = await inOak(() => connectors.importLeads(P.MARKETING.actor, 'META_ADS', { csv }));
    expect(r).toMatchObject({ created: 1, duplicates: 2, rejected: 1 });
    expect(await inOak(() => Lead.countDocuments())).toBe(2);
  });
});

describe('lead webhook', () => {
  it('accepts only a correct HMAC, creates one enquiry, and ignores a resend', async () => {
    await School.create({ slug: OAK, name: 'Oakridge Academy' });
    const issued = await inOak(() => connectors.rotateWebhookSecret(P.MARKETING.actor, 'META_ADS'));
    const { publicMarketingRouter } = await import('../src/modules/marketing/growth.routes.js');
    const app = express();
    app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
    app.use('/public/marketing', publicMarketingRouter);
    // eslint-disable-next-line no-unused-vars
    app.use((err, _req, res, _next) => res.status(err.statusCode ?? 500).json({ code: err.code, message: err.message }));
    const server = app.listen(0);
    try {
      const base = `http://127.0.0.1:${server.address().port}/public/marketing`;
      const body = JSON.stringify({ entry: [{ changes: [{ value: { leadgen_id: 'L-1', campaign_name: 'ADM27 Open day', field_data: [{ name: 'full_name', values: ['Neha Iyer'] }, { name: 'phone_number', values: ['+919822200003'] }] } }] }] });
      const sign = (b, key = issued.secret) => `sha256=${crypto.createHmac('sha256', key).update(b).digest('hex')}`;
      const post = (sig, b = body) => fetch(`${base}/leads/${OAK}/meta_ads`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(sig ? { 'X-Hub-Signature-256': sig } : {}) }, body: b });
      expect((await post(null)).status).toBe(401);
      expect((await post(sign(body, 'wrong'))).status).toBe(401);
      expect((await post(sign(`${body} `), body)).status).toBe(401);
      const ok = await post(sign(body));
      expect(ok.status).toBe(200);
      expect((await ok.json()).data).toMatchObject({ received: 1, created: 1 });
      const again = await (await post(sign(body))).json();
      expect(again.data).toMatchObject({ created: 0, duplicates: 1 });
      expect(await inOak(() => Lead.countDocuments())).toBe(1);
      expect(await inOak(() => LeadTouch.countDocuments({ via: 'LEAD_WEBHOOK' }))).toBe(1);
      // Handshake with the verify token only.
      const hs = await fetch(`${base}/leads/${OAK}/meta_ads?hub.mode=subscribe&hub.verify_token=${issued.verifyToken}&hub.challenge=42`);
      expect(await hs.text()).toBe('42');
      expect((await fetch(`${base}/leads/${OAK}/meta_ads?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42`)).status).toBe(403);
      // Another school's webhook path is not this one's.
      expect((await post(sign(body)).then(() => fetch(`${base}/leads/${RIVER}/meta_ads`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sign(body) }, body }))).status).toBe(404);
      // Short link redirects to the form with the campaign's UTM.
      const c = await poster();
      await inOak(() => OfflineCampaign.updateOne({ _id: c.id }, { $set: { status: 'LIVE' } }));
      const red = await fetch(`${base}/r/${OAK}/POSTER-S21`, { redirect: 'manual' });
      expect(red.status).toBe(302);
      expect(red.headers.get('location')).toMatch(/\/public\/admission\/oakridge\?utm_source=offline&utm_medium=poster&utm_campaign=POSTER-S21&mc=POSTER-S21$/);
    } finally { server.close(); }
  });
});
