import { describe, it, expect, beforeEach } from 'vitest';
import { inSchool, OAK, RIVER, seedSchool } from './support/mcpSchool.js';
import { Vehicle } from '../src/models/fleet.model.js';
import { Scenario } from '../src/models/scenario.model.js';
import * as svc from '../src/modules/scenarios/scenarios.service.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';

/**
 * Scenario planning: actuals from records, assumptions with their source,
 * a 1–5 year projection (enrolment rolling up through grades, fees, staffing
 * by ratio, vehicles for riders), saved scenarios and side-by-side comparison.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);
beforeEach(async () => {
  s = await seedSchool();
  await inOak(() => Vehicle.create({ registrationNo: 'MH12AB1234', lawfulCapacity: 40, usableSeats: 40 }));
});

describe('actuals and assumptions', () => {
  it('reads current actuals and marks every assumption with where it came from', async () => {
    const b = await inOak(() => svc.getBaseline());
    expect(b.label).toMatch(/Projection/);
    expect(b.baseline.enrolment.students).toBe(4);
    expect(b.baseline.transport.vehicles).toBe(1);
    expect(b.baseline.fees.billedPaise).toBe(1_300_000);
    const intake = b.assumptions.find((a) => a.key === 'intake');
    expect(intake.source).toBe('ACTUAL');
    expect(b.assumptions.find((a) => a.key === 'feeIncreasePct')).toMatchObject({ source: 'DEFAULT', value: 8 });
  });

  it('projects enrolment, fees, staffing and vehicles, and marks edited assumptions', async () => {
    const p = await inOak(() => svc.preview({ years: 2, assumptions: { intake: 100, retentionPct: 100, feePerStudentPaise: 1000000, feeIncreasePct: 10, concessionPct: 0, collectionPct: 100, studentsPerTeacher: 25, riderPct: 50, seatsPerVehicle: 40, targetLoadPct: 100 } }));
    expect(p.rows).toHaveLength(3);
    expect(p.rows[0].actual).toBe(true);
    const y1 = p.rows[1];
    expect(y1.students).toBe(100); // one grade: everyone moves on, 100 new
    expect(y1.feeRevenuePaise).toBe(100 * 1_100_000);
    expect(y1.teachersNeeded).toBe(4);
    expect(y1.vehiclesNeeded).toBe(2); // 50 riders, 40 seats
    expect(p.rows[2].feePerStudentPaise).toBe(1_210_000);
    expect(p.assumptions.find((a) => a.key === 'intake').source).toBe('EDITED');
    // Out-of-range values are clamped, not trusted.
    const q = await inOak(() => svc.preview({ years: 9, assumptions: { retentionPct: 500 } }));
    expect(q.rows).toHaveLength(6);
    expect(q.assumptions.find((a) => a.key === 'retentionPct').value).toBe(100);
  });
});

describe('saved scenarios', () => {
  it('saves, compares side by side and keeps schools apart', async () => {
    const P = s.people.PRINCIPAL.actor;
    const a = await inOak(() => svc.create(P, { name: 'Steady', years: 3, assumptions: { feeIncreasePct: 5 } }));
    const b = await inOak(() => svc.create(P, { name: 'Growth', years: 3, assumptions: { intake: 60, feeIncreasePct: 10 } }));
    expect((await inOak(() => svc.list())).map((x) => x.name).sort()).toEqual(['Growth', 'Steady']);
    const cmp = await inOak(() => svc.compare(`${a.scenario.id},${b.scenario.id}`));
    expect(cmp.scenarios).toHaveLength(2);
    expect(cmp.scenarios[1].rows[3].students).toBeGreaterThan(cmp.scenarios[0].rows[3].students);
    await expect(inOak(() => svc.compare(a.scenario.id))).rejects.toMatchObject({ code: 'COMPARE_NEEDS_TWO' });
    const upd = await inOak(() => svc.update(P, a.scenario.id, { assumptions: { feeIncreasePct: 7 } }));
    expect(upd.assumptions.find((x) => x.key === 'feeIncreasePct').value).toBe(7);
    expect(await inSchool(RIVER, () => Scenario.countDocuments({}))).toBe(0);
    await expect(inSchool(RIVER, () => svc.get(a.scenario.id))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('is granted to the principal, finance and trustees (read), not teachers or families', () => {
    const grant = (role, key) => SYSTEM_ROLES.find((r) => r.key === role).grants.find((g) => g.key === key)?.scope ?? null;
    expect(grant('PRINCIPAL', 'scenarios.manage')).toBe('ALL');
    expect(grant('FINANCE', 'scenarios.manage')).toBe('ALL');
    expect(grant('ADMIN', 'scenarios.manage')).toBe('ALL');
    expect(grant('TRUSTEE', 'scenarios.read')).toBe('ALL');
    expect(grant('TRUSTEE', 'scenarios.manage')).toBeNull();
    for (const r of ['TEACHER', 'PARENT', 'STUDENT']) expect(grant(r, 'scenarios.read')).toBeNull();
  });
});
