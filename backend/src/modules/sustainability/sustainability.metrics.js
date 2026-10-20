import { registerMetric } from '../analytics/catalogue.js';
import { WasteLog, Plant, MeterReading } from '../../models/sustainability.model.js';
import { earliest } from '../analytics/metrics/helpers.js';
import { figures } from './sustainability.service.js';

/**
 * Sustainability figures in the analytics catalogue. Filed under
 * "Facilities & compliance" (the department that runs them). Each reads the
 * same figures() the Sustainability screen and the evidence packs use, so the
 * three always agree. Per-student figures divide by pupils on roll now
 * (active enrolments), which the definition states.
 */

const f = (ctx) => ctx.memo(`sustainability:${ctx.period.start.toISOString()}:${ctx.period.end.toISOString()}`, () => figures(ctx.period));
const common = { department: 'facilities', kind: 'flow', link: '/sustainability', version: 1 };

registerMetric({
  ...common, key: 'facilities.waste_per_student', label: 'Waste per student',
  definition: 'Kilograms of waste recorded in the period (all streams) divided by pupils on roll now. Shown in grams per student to keep it whole.',
  unit: 'count', dateBasis: 'Date the waste was weighed', sources: ['WasteLog', 'Enrollment'],
  numerator: 'Grams of waste recorded', denominator: 'Pupils on roll',
  since: () => earliest(WasteLog, 'date'),
  compute: async (ctx) => {
    const x = await f(ctx);
    const value = x.waste.perStudentKg === null ? null : Math.round(x.waste.perStudentKg * 1000);
    return { value, records: x.waste.records, note: value === null ? 'No waste recorded in the period, or nobody on roll.' : 'grams per student' };
  },
});

registerMetric({
  ...common, key: 'facilities.waste_segregation', label: 'Waste segregated at source',
  definition: 'Share of the weight of waste recorded in the period that was collected already separated by stream.',
  unit: 'percent', dateBasis: 'Date the waste was weighed', sources: ['WasteLog'],
  since: () => earliest(WasteLog, 'date'),
  compute: async (ctx) => { const x = await f(ctx); return { value: x.waste.segregationPct, records: x.waste.records, breakdown: Object.entries(x.waste.byStreamKg).map(([label, value]) => ({ label, value })) }; },
});

registerMetric({
  ...common, key: 'facilities.tree_survival', label: 'Tree and plant survival', kind: 'stock',
  definition: 'Plants recorded as alive or needing care at their latest survival check, as a share of all plants planted before the period end.',
  unit: 'percent', dateBasis: 'Planted date; status from the latest check', sources: ['Plant'],
  since: () => earliest(Plant, 'plantedOn'),
  compute: async (ctx) => { const x = await f(ctx); return { value: x.trees.survivalPct, records: x.trees.records, detail: { planted: x.trees.planted, alive: x.trees.alive } }; },
});

registerMetric({
  ...common, key: 'facilities.water_per_student', label: 'Water per student',
  definition: 'Litres of water used in the months starting inside the period (monthly meter figures) divided by pupils on roll now.',
  unit: 'count', dateBasis: 'Meter month', sources: ['MeterReading', 'Enrollment'],
  since: () => earliest(MeterReading, 'createdAt', { kind: 'WATER' }),
  compute: async (ctx) => { const x = await f(ctx); const value = x.water.perStudentKL === null ? null : Math.round(x.water.perStudentKL * 1000); return { value, records: x.water.months, note: value === null ? 'No water readings for the period.' : 'litres per student' }; },
});

registerMetric({
  ...common, key: 'facilities.energy_per_student', label: 'Electricity per student',
  definition: 'kWh of grid electricity used in the months starting inside the period divided by pupils on roll now. Solar generation is reported separately.',
  unit: 'count', dateBasis: 'Meter month', sources: ['MeterReading', 'Enrollment'],
  since: () => earliest(MeterReading, 'createdAt', { kind: 'ELECTRICITY' }),
  compute: async (ctx) => { const x = await f(ctx); const value = x.energy.perStudentKWh === null ? null : Math.round(x.energy.perStudentKWh * 10) / 10; return { value, records: x.energy.months, detail: { solarKWh: x.energy.solarKWh }, note: value === null ? 'No electricity readings for the period.' : 'kWh per student' }; },
});
