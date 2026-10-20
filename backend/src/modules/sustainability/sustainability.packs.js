import { Plant, WasteLog, MeterReading, SanitationDuty, SanitationCheck, EcoActivity, CompostBatch, LIFE_THEMES } from '../../models/sustainability.model.js';
import { AppError } from '../../utils/AppError.js';
import { figures, periodFrom } from './sustainability.service.js';
import { requireStaff } from './sustainability.access.js';

/**
 * Evidence packs: the school's own records and evidence files, arranged under
 * the headings of three programmes so a coordinator can copy figures and
 * attach files when they fill in the programme's form themselves.
 *
 * EduOS never files or submits anything to these programmes and holds no
 * account with them. Where a programme's exact form fields are not known to
 * EduOS the sections carry generic labels, and every pack says so.
 */

export const PACK_DISCLAIMER = 'Evidence to support your submission. EduOS does not file or submit anything to this programme; '
  + 'a coordinator fills in the programme\'s own form and attaches what they choose from here.';

export const PACKS = {
  shvr: {
    key: 'shvr', title: 'Swachh Vidyalaya / Swachh Hariyali Vidyalaya Rating (SHVR)',
    fieldsNote: 'Section names follow the rating\'s broad themes (water, sanitation, handwashing, operation and maintenance, behaviour change, greenery). '
      + 'The exact questions and scoring of the current rating form are not encoded in EduOS, so these are generic headings. Check the current form before copying figures.',
  },
  cse: {
    key: 'cse', title: 'CSE Green Schools Programme audit',
    fieldsNote: 'Grouped under the audit\'s sections (Air, Energy, Food, Land, Water, Waste). The audit\'s individual questions are not encoded in EduOS; '
      + 'sections with no EduOS records say so instead of guessing.',
  },
  life: {
    key: 'life', title: 'Eco Club for Mission LiFE activity reporting',
    fieldsNote: 'Verified eco-club activities grouped by the seven Mission LiFE themes. The reporting portal\'s exact fields are not encoded in EduOS; use these rows as a source.',
  },
};

const ev = (list = [], label) => list.map((a) => ({ name: label ? `${label}: ${a.name}` : a.name, url: a.url }));
const n = (v, unit = '') => (v === null || v === undefined ? 'Not recorded' : `${v}${unit ? ` ${unit}` : ''}`);
const humanTheme = (t) => t.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

async function sanitationSummary(period, kinds) {
  const duties = await SanitationDuty.find({ kind: { $in: kinds } }).lean();
  const checks = await SanitationCheck.find({ dutyId: { $in: duties.map((d) => d._id) }, at: { $gte: period.start, $lt: period.end } }).lean();
  const okChecks = checks.filter((c) => c.allOk).length;
  return {
    duties: duties.length, checks: checks.length, okPct: checks.length ? Math.round((okChecks / checks.length) * 1000) / 10 : null,
    evidence: checks.flatMap((c) => ev(c.evidence, `${new Date(c.at).toISOString().slice(0, 10)} check`)).slice(0, 60),
  };
}

async function activitiesBy(period, filter = {}) {
  return EcoActivity.find({ status: 'VERIFIED', date: { $gte: period.start, $lt: period.end }, ...filter }).sort({ date: 1 }).lean();
}

async function buildShvr(period, f) {
  const toilets = await sanitationSummary(period, ['TOILET_CLEANING']);
  const tanks = await sanitationSummary(period, ['WATER_TANK_CLEANING']);
  const menstrual = await sanitationSummary(period, ['PAD_DISPENSER', 'INCINERATOR']);
  const awareness = await activitiesBy(period, { category: { $in: ['AWARENESS', 'CLEANUP', 'WASTE_SEGREGATION'] } });
  const waterBills = await MeterReading.find({ kind: { $in: ['WATER', 'RAINWATER_HARVESTED'] }, evidence: { $ne: [] } }).lean();
  return [
    { key: 'water', title: 'Water', rows: [['Water used', n(f.water.kL, 'kL')], ['Water per student', n(f.water.perStudentKL, 'kL')], ['Rainwater harvested', n(f.water.rainwaterHarvestedKL, 'kL')], ['Tank cleaning checks', String(tanks.checks)]], evidence: [...tanks.evidence, ...waterBills.flatMap((m) => ev(m.evidence, `${m.kind} ${m.period}`))] },
    { key: 'sanitation', title: 'Sanitation (toilets)', rows: [['Toilet cleaning duties', String(toilets.duties)], ['Checks recorded', String(toilets.checks)], ['Checks with every item done', n(toilets.okPct, '%')]], evidence: toilets.evidence },
    { key: 'hygiene', title: 'Handwashing and menstrual hygiene', rows: [['Pad dispenser / incinerator duties', String(menstrual.duties)], ['Service checks recorded', String(menstrual.checks)]], evidence: menstrual.evidence, gaps: ['Handwashing-station counts are not recorded in EduOS; add them on the form directly.'] },
    { key: 'om', title: 'Operation and maintenance', rows: [['Sanitation duties with checks in the period', `${toilets.checks + tanks.checks + menstrual.checks} checks`]], evidence: [] },
    { key: 'behaviour', title: 'Behaviour change and awareness', rows: awareness.map((a) => [`${new Date(a.date).toISOString().slice(0, 10)} · ${a.title}`, `${a.participants} participants`]), evidence: awareness.flatMap((a) => ev(a.evidence, a.title)) },
    { key: 'greenery', title: 'Greenery and environment', rows: [['Trees and plants planted (to date)', String(f.trees.planted)], ['Surviving', `${f.trees.alive} (${n(f.trees.survivalPct, '%')})`], ['Waste recorded', n(f.waste.totalKg, 'kg')], ['Segregated at source', n(f.waste.segregationPct, '%')]], evidence: [] },
  ];
}

async function buildCse(period, f) {
  const waste = await WasteLog.find({ date: { $gte: period.start, $lt: period.end } }).lean();
  const compost = await CompostBatch.find({ startedOn: { $lt: period.end } }).lean();
  const plants = await Plant.find({ plantedOn: { $lt: period.end } }).lean();
  const meters = await MeterReading.find({ kind: { $in: ['ELECTRICITY', 'SOLAR_GENERATED'] }, evidence: { $ne: [] } }).lean();
  const handovers = waste.filter((w) => w.destination === 'VENDOR');
  return [
    { key: 'air', title: 'Air', rows: [], evidence: [], gaps: ['EduOS does not record air-quality or vehicle data for this section.'] },
    { key: 'energy', title: 'Energy', rows: [['Electricity used', n(f.energy.kWh, 'kWh')], ['Electricity per student', n(f.energy.perStudentKWh, 'kWh')], ['Solar generated', n(f.energy.solarKWh, 'kWh')], ['Months with readings', String(f.energy.months)]], evidence: meters.flatMap((m) => ev(m.evidence, `${m.kind} ${m.period}`)) },
    { key: 'food', title: 'Food', rows: [], evidence: [], gaps: ['EduOS does not record canteen or food data for this section.'] },
    { key: 'land', title: 'Land', rows: [['Plant records', String(plants.length)], ['Trees and plants planted', String(f.trees.planted)], ['Survival', n(f.trees.survivalPct, '%')]], evidence: plants.flatMap((p) => (p.checks ?? []).slice(-1).flatMap((c) => ev(c.evidence, `${p.code} ${p.species}`))).slice(0, 80) },
    { key: 'water', title: 'Water', rows: [['Water used', n(f.water.kL, 'kL')], ['Water per student', n(f.water.perStudentKL, 'kL')], ['Rainwater harvested', n(f.water.rainwaterHarvestedKL, 'kL')]], evidence: [] },
    {
      key: 'waste', title: 'Waste',
      rows: [...Object.entries(f.waste.byStreamKg).map(([k, v]) => [`${humanTheme(k)} waste`, `${v} kg`]), ['Segregated at source', n(f.waste.segregationPct, '%')], ['Composted', n(f.waste.compostedKg, 'kg')], ['Compost batches', String(compost.length)], ['Vendor handovers', String(handovers.length)]],
      evidence: handovers.flatMap((w) => ev(w.receipts, `${w.refNo} ${w.vendorName ?? ''}`.trim())),
    },
  ];
}

async function buildLife(period) {
  const acts = await activitiesBy(period);
  const sections = LIFE_THEMES.map((theme) => {
    const list = acts.filter((a) => a.lifeTheme === theme);
    return {
      key: theme.toLowerCase(), title: humanTheme(theme),
      rows: list.map((a) => [`${new Date(a.date).toISOString().slice(0, 10)} · ${a.title}`, `${a.participants} participants · ${a.refNo}`]),
      evidence: list.flatMap((a) => ev(a.evidence, a.title)),
      gaps: list.length ? [] : ['No verified activity under this theme in the period.'],
    };
  });
  const untagged = acts.filter((a) => !a.lifeTheme);
  if (untagged.length) sections.push({ key: 'untagged', title: 'Verified activities without a LiFE theme', rows: untagged.map((a) => [a.title, a.refNo]), evidence: [], gaps: ['Tag these with a theme if they belong in the LiFE report.'] });
  return sections;
}

export async function buildPack(actor, key, query = {}) {
  requireStaff(actor);
  const meta = PACKS[key];
  if (!meta) throw new AppError(`Unknown evidence pack ${key}. Choose one of: ${Object.keys(PACKS).join(', ')}`, 400, [], 'UNKNOWN_PACK');
  const period = periodFrom(query);
  const f = await figures(period);
  const sections = key === 'shvr' ? await buildShvr(period, f) : key === 'cse' ? await buildCse(period, f) : await buildLife(period);
  return {
    ...meta, disclaimer: PACK_DISCLAIMER, period: f.period, generatedAt: new Date(), students: f.students,
    sections: sections.map((s) => ({ gaps: [], ...s, evidenceCount: s.evidence.length })),
  };
}

const csvCell = (v) => {
  const s = String(v ?? '');
  // Neutralise spreadsheet formulas and quote everything.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

export async function packCsv(actor, key, query = {}) {
  const pack = await buildPack(actor, key, query);
  const lines = [['Section', 'Item', 'Value'].map(csvCell).join(',')];
  lines.push([pack.title, 'Note', pack.disclaimer].map(csvCell).join(','));
  lines.push([pack.title, 'Fields', pack.fieldsNote].map(csvCell).join(','));
  lines.push([pack.title, 'Period', pack.period.label].map(csvCell).join(','));
  for (const s of pack.sections) {
    for (const [k, v] of s.rows) lines.push([s.title, k, v].map(csvCell).join(','));
    for (const g of s.gaps) lines.push([s.title, 'Gap', g].map(csvCell).join(','));
    for (const e of s.evidence) lines.push([s.title, `Evidence: ${e.name}`, e.url].map(csvCell).join(','));
  }
  return { filename: `evidence-pack-${key}-${pack.period.from}-to-${pack.period.to}.csv`, csv: lines.join('\r\n') };
}
