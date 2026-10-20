/**
 * Sample sustainability records, online admission applications and library
 * accession numbers for `npm run seed:operations` (called from
 * seed_operations.js). FICTIONAL: invented zones, plantings, weights, meter
 * figures, vendors, receipts and applicants. Written through the services the
 * screens use, so the same rules apply (photo evidence for checks, receipts
 * for hazardous waste, verification by someone other than the logger,
 * sanitation duties as tasks). Each part runs only while its collection is empty.
 */
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { env } from '../config/env.js';
import { Section } from '../models/academics.model.js';
import { Upload } from '../models/upload.model.js';
import { Book } from '../models/library.model.js';
import { BookCopy } from '../models/bookCopy.model.js';
import { OnlineApplication } from '../models/onlineApplication.model.js';
import { School } from '../models/school.model.js';
import * as green from '../models/sustainability.model.js';
import * as svc from '../modules/sustainability/sustainability.service.js';
import * as sanitation from '../modules/sustainability/sustainability.sanitation.js';
import { generateCopies } from '../modules/library/library.copies.js';
import { submitApplication } from '../modules/admissions/online.service.js';

const DAY = 86_400_000;
// A 1x1 green PNG, stored once as the sample "photo" every sample check points at.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaPhfDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function sampleFile(name, tenantId) {
  const stored = `sample-${name}`;
  const dir = resolve(process.cwd(), env.UPLOAD_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, stored), PNG);
  await Upload.updateOne({ storedName: stored }, { $setOnInsert: { storedName: stored, tenantId, originalName: name, size: PNG.length } }, { upsert: true });
  return [{ name: `${name} (sample)`, url: `/uploads/${stored}` }];
}

export async function seedGreenAdmission({ section, attempt, who, tenantId, now = new Date() }) {
  if (process.argv.includes('--reset')) {
    for (const m of [...Object.values(green).filter((x) => typeof x?.deleteMany === 'function'), OnlineApplication, BookCopy]) {
      // eslint-disable-next-line no-await-in-loop
      await m.deleteMany({});
    }
  }
  const { ADMIN, COMPLIANCE, TEACHER, PRINCIPAL, WARDEN } = who;
  const photo = await sampleFile('eco-photo.png', tenantId);
  const receipt = await sampleFile('vendor-receipt.png', tenantId);
  const day = (n) => new Date(now.getTime() + n * DAY);

  await section('Sustainability: zones, teams, trees', green.SustainabilityZone, async () => {
    const zones = {};
    for (const [name, kind] of [['East garden', 'GARDEN'], ['Main ground boundary', 'GROUND'], ['Block A toilets', 'TOILET_BLOCK'], ['Block B toilets', 'TOILET_BLOCK'], ['Rooftop tank', 'WATER_TANK'], ['Kitchen compost pit', 'KITCHEN']]) {
      // eslint-disable-next-line no-await-in-loop
      zones[name] = await svc.createZone(ADMIN.actor, { name, kind });
    }
    const sections = await Section.find({}).populate('gradeId', 'name').sort({ createdAt: 1 }).limit(4).lean();
    const teams = [];
    for (const s of sections) {
      // eslint-disable-next-line no-await-in-loop
      const t = await attempt(`team ${s.name}`, () => svc.createTeam(ADMIN.actor, { kind: 'CLASS', name: `${s.gradeId?.name ?? 'Class'} ${s.name}`.trim(), sectionId: String(s._id) }));
      if (t) teams.push(t);
    }
    const club = await svc.createTeam(ADMIN.actor, { kind: 'CLUB', name: 'Green Warriors eco club', leadProfileIds: TEACHER ? [TEACHER.id] : [] });
    teams.push(club);
    for (const h of ['Red', 'Blue', 'Green', 'Yellow']) {
      // eslint-disable-next-line no-await-in-loop
      teams.push(await svc.createTeam(ADMIN.actor, { kind: 'HOUSE', name: `${h} House`, houseValue: h.toLowerCase() }));
    }
    const plantings = [
      ['Azadirachta indica', 'Neem', 'TREE', 'East garden', 6, -80], ['Ficus religiosa', 'Peepal', 'TREE', 'Main ground boundary', 2, -75],
      ['Polyalthia longifolia', 'Ashoka', 'TREE', 'Main ground boundary', 10, -60], ['Ocimum tenuiflorum', 'Tulsi', 'HERB', 'East garden', 12, -40],
      ['Bougainvillea glabra', 'Bougainvillea', 'SHRUB', 'East garden', 8, -30], ['Mangifera indica', 'Mango', 'TREE', 'East garden', 3, -20],
    ];
    let checks = 0;
    for (const [i, [species, commonName, kind, zone, count, ago]] of plantings.entries()) {
      // eslint-disable-next-line no-await-in-loop
      const p = await svc.createPlant(ADMIN.actor, 'ALL', { species, commonName, kind, zoneId: zones[zone].id, plantedOn: day(ago), plantedByTeamId: teams[i % teams.length]?.id, count });
      // eslint-disable-next-line no-await-in-loop
      await svc.recordPlantCheck(ADMIN.actor, 'ALL', p.id, { status: i === 3 ? 'NEEDS_CARE' : i === 1 ? 'DEAD' : 'ALIVE', evidence: photo, note: i === 3 ? 'Some plants wilting; watering rota restarted (sample)' : 'Monthly survival check (sample)' });
      checks += 1;
    }
    return `${Object.keys(zones).length} zones, ${teams.length} eco teams, ${plantings.length} plantings with ${checks} photo-checked survival checks`;
  });

  await section('Sustainability: waste, compost, meters', green.WasteLog, async () => {
    const pit = await green.SustainabilityZone.findOne({ name: 'Kitchen compost pit' }).lean();
    let n = 0;
    for (let w = 0; w < 12; w++) {
      const date = day(-7 * w - 1);
      // eslint-disable-next-line no-await-in-loop
      await svc.createWaste(ADMIN.actor, { date, stream: 'WET', weightKg: 38 + (w % 4) * 3.5, destination: 'COMPOST', zoneId: pit ? String(pit._id) : undefined });
      // eslint-disable-next-line no-await-in-loop
      await svc.createWaste(ADMIN.actor, { date, stream: 'DRY', weightKg: 22 + (w % 3) * 2, segregated: w % 5 !== 0, vendorName: 'Shakti Dry Waste Collectors (sample)', receiptNo: `SDW-${4100 + w}` });
      n += 2;
    }
    await svc.createWaste(ADMIN.actor, { date: day(-12), stream: 'E_WASTE', weightKg: 14.2, vendorName: 'GreenCycle E-Waste Recyclers (sample)', receiptNo: 'GC-2026-0187', receipts: receipt });
    await svc.createWaste(ADMIN.actor, { date: day(-18), stream: 'HAZARDOUS_LAB', weightKg: 2.6, vendorName: 'SafeChem Disposal (sample)', receiptNo: 'SC-778', receipts: receipt, notes: 'Expired reagents from the chemistry lab (sample)' });
    await svc.createWaste(ADMIN.actor, { date: day(-5), stream: 'SANITARY', weightKg: 4.1, destination: 'OTHER', notes: 'Incinerated on site (sample)' });
    n += 3;
    await svc.createCompost(ADMIN.actor, { startedOn: day(-70), inputKg: 160, zoneId: pit ? String(pit._id) : undefined });
    const b2 = await svc.createCompost(ADMIN.actor, { startedOn: day(-120), inputKg: 210, zoneId: pit ? String(pit._id) : undefined });
    await svc.updateCompost(ADMIN.actor, b2.id, { status: 'MATURED', outputKg: 64 });
    let meters = 0;
    for (let m = 1; m <= 6; m++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 1));
      const period = d.toISOString().slice(0, 7);
      // eslint-disable-next-line no-await-in-loop
      await svc.recordMeter(ADMIN.actor, { kind: 'WATER', period, quantity: 410 + m * 12, evidence: m === 1 ? receipt : [] });
      // eslint-disable-next-line no-await-in-loop
      await svc.recordMeter(ADMIN.actor, { kind: 'ELECTRICITY', period, quantity: 5200 - m * 140 });
      // eslint-disable-next-line no-await-in-loop
      await svc.recordMeter(ADMIN.actor, { kind: 'SOLAR_GENERATED', period, quantity: 900 + m * 25 });
      if (d.getUTCMonth() >= 5 && d.getUTCMonth() <= 8) {
        // eslint-disable-next-line no-await-in-loop
        await svc.recordMeter(ADMIN.actor, { kind: 'RAINWATER_HARVESTED', period, quantity: 60 + m * 5 });
      }
      meters += 3;
    }
    return `${n} waste entries (vendor receipts on hazardous streams), 2 compost batches, ${meters}+ monthly meter figures`;
  });

  await section('Sustainability: sanitation duties', green.SanitationDuty, async () => {
    const zone = async (name) => (await green.SustainabilityZone.findOne({ name }).lean())?._id;
    const owner = WARDEN?.id ?? ADMIN.id;
    const a = await sanitation.createDuty(ADMIN.actor, { kind: 'TOILET_CLEANING', title: 'Clean Block A toilets', zoneId: String(await zone('Block A toilets')), ownerProfileId: owner, firstDueAt: day(-1) });
    await sanitation.createDuty(ADMIN.actor, { kind: 'TOILET_CLEANING', title: 'Clean Block B toilets', zoneId: String(await zone('Block B toilets')), ownerProfileId: owner, firstDueAt: day(1) });
    await sanitation.createDuty(ADMIN.actor, { kind: 'PAD_DISPENSER', title: 'Sanitary-pad dispenser, Block B girls\' toilet', zoneId: String(await zone('Block B toilets')), ownerProfileId: owner, stockLevel: 9, reorderLevel: 10, frequency: 'WEEK' });
    await sanitation.createDuty(ADMIN.actor, { kind: 'INCINERATOR', title: 'Incinerator service, Block B', zoneId: String(await zone('Block B toilets')), frequency: 'MONTH', every: 1, firstDueAt: day(6) });
    await sanitation.createDuty(ADMIN.actor, { kind: 'WATER_TANK_CLEANING', title: 'Rooftop drinking-water tank cleaning', zoneId: String(await zone('Rooftop tank')), frequency: 'MONTH', every: 6, firstDueAt: day(12) });
    await sanitation.recordCheck(ADMIN.actor, 'ALL', a.id, { itemsDone: a.checklist, evidence: photo, note: 'All clean (sample)' });
    return '5 duties, each with its next occurrence in Tasks; one check recorded with a photo; a restock task for the pad dispenser';
  });

  await section('Sustainability: eco activities and points', green.EcoActivity, async () => {
    const teams = await green.EcoTeam.find({}).sort({ kind: 1, name: 1 }).lean();
    const verifier = COMPLIANCE ?? PRINCIPAL ?? ADMIN;
    const rows = [
      ['Plastic-free lunch week', 'LIFE_ACTION', 'SAY_NO_TO_SINGLE_USE_PLASTIC', 34], ['Switch-off drive in classrooms', 'ENERGY_SAVING', 'SAVE_ENERGY', 28],
      ['Campus clean-up after sports day', 'CLEANUP', 'REDUCE_WASTE', 40], ['Leak hunt: taps and tanks', 'WATER_SAVING', 'SAVE_WATER', 18],
      ['E-waste collection drive', 'WASTE_SEGREGATION', 'REDUCE_E_WASTE', 25], ['Millet tasting and kitchen garden', 'AWARENESS', 'ADOPT_SUSTAINABLE_FOOD_SYSTEMS', 30],
      ['Neem sapling planting', 'PLANTING', null, 22], ['Cycle-to-school day', 'LIFE_ACTION', 'ADOPT_HEALTHY_LIFESTYLES', 45],
    ];
    let verified = 0;
    for (const [i, [title, category, lifeTheme, participants]] of rows.entries()) {
      const team = teams[i % teams.length];
      // eslint-disable-next-line no-await-in-loop
      const a = await svc.logActivity(ADMIN.actor, 'ALL', { teamId: String(team._id), title: `${title} (sample)`, category, lifeTheme, date: day(-3 * i - 2), participants, evidence: photo });
      if (i < 6 && String(verifier.id) !== String(ADMIN.id)) {
        // eslint-disable-next-line no-await-in-loop
        await svc.decideActivity(verifier.actor, 'ALL', a.id, { decision: 'VERIFY' });
        verified += 1;
      }
    }
    return `${rows.length} activities, ${verified} verified by someone other than the logger (points count only those); the rest wait in the verification queue`;
  });

  await section('Online admission applications', OnlineApplication, async () => {
    const school = await School.findOne({ slug: tenantId }).select('slug name').lean();
    if (!school) return 'skipped: no school record';
    const made = [];
    for (const f of [
      { childName: 'Ishaan Kulkarni', guardianName: 'Neha Kulkarni', phone: '+919800011101', email: 'neha.k@example.com', gradeApplying: 'Class 1', dateOfBirth: '2020-03-14', relation: 'MOTHER', address: '14 Lake View Road (sample)', consent: true },
      { childName: 'Sara Thomas', guardianName: 'Joseph Thomas', phone: '+919800011102', gradeApplying: 'Class 6', dateOfBirth: '2015-08-02', previousSchool: 'Hillside Public School (sample)', relation: 'FATHER', consent: true, message: 'We are relocating in March.' },
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const r = await attempt(`application ${f.childName}`, () => submitApplication(school, f, { ip: '127.0.0.1' }));
      if (r) made.push(r.refNo);
    }
    return `${made.length} sample applications (${made.join(', ')}) as NEW web leads; acknowledgements recorded as SIMULATED`;
  });

  await section('Library accession numbers', BookCopy, async () => {
    const books = await Book.find({ deletedAt: null, resourceType: { $ne: 'DIGITAL' } }).sort({ createdAt: 1 }).limit(25).lean();
    let n = 0;
    for (const b of books) {
      // eslint-disable-next-line no-await-in-loop
      const r = await attempt(`copies ${b.title}`, () => generateCopies({ bookId: String(b._id) }));
      n += r?.created?.length ?? 0;
    }
    return `${n} copies numbered across ${books.length} titles (labels ready to print)`;
  });
}
