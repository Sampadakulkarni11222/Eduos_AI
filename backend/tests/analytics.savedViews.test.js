import { describe, it, expect, beforeEach } from 'vitest';
import { seedSchool, seedPerson, inSchool, OAK, RIVER } from './support/mcpSchool.js';
import { AnalyticsView } from '../src/models/analyticsView.model.js';
import * as views from '../src/modules/analytics/views.service.js';

/**
 * Saved analytics views on the server (part 3, decision 2): per person,
 * per school, name + filters + metric keys, a one-time import from the
 * browser, and nobody can see or forget another person's views.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);
beforeEach(async () => { s = await seedSchool(); });

const q = { preset: 'this_term', compare: 'previous', department: 'ALL', evil: '$where' };

describe('saved analytics views', () => {
  it('saves by name (replacing the same name), keeps only known filter keys, and lists only the owner\'s', async () => {
    const P = s.people.PRINCIPAL.actor;
    const v = await inOak(() => views.save(P, { name: 'Term fees', filters: q, tab: 'FINANCE', focus: 'fees.collected', metricKeys: ['fees.collected', 'fees.collected'] }));
    expect(v.filters).toMatchObject({ preset: 'this_term', compare: 'previous', department: 'ALL' });
    expect(v.filters.evil).toBeUndefined();
    expect(v.metricKeys).toEqual(['fees.collected']);
    await inOak(() => views.save(P, { name: 'Term fees', filters: { ...q, department: 'FINANCE' } }));
    const mine = await inOak(() => views.list(P));
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0].filters.department).toBe('FINANCE');
    expect((await inOak(() => views.list(s.people.ADMIN.actor))).items).toHaveLength(0);
    // Another person cannot forget it.
    await expect(inOak(() => views.remove(s.people.ADMIN.actor, mine.items[0].id))).rejects.toMatchObject({ statusCode: 404 });
    await inOak(() => views.remove(P, mine.items[0].id));
    expect(await inOak(() => AnalyticsView.countDocuments())).toBe(0);
  });

  it('imports browser views once, keeps existing names, caps the count, and stays in its school', async () => {
    const P = s.people.PRINCIPAL.actor;
    await inOak(() => views.save(P, { name: 'Kept', filters: q }));
    const out = await inOak(() => views.importViews(P, { views: [{ name: 'Kept', q: { preset: 'x' } }, { name: 'From browser', q, tab: 'ALL', focus: null }, { name: '' }] }));
    expect(out.imported).toBe(1);
    expect(out.items.map((v) => v.name).sort()).toEqual(['From browser', 'Kept']);
    expect(out.items.find((v) => v.name === 'Kept').filters.preset).toBe('this_term');
    for (let i = 0; i < 18; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await inOak(() => views.save(P, { name: `v${i}`, filters: q }));
    }
    await expect(inOak(() => views.save(P, { name: 'one too many', filters: q }))).rejects.toMatchObject({ code: 'TOO_MANY_VIEWS' });
    const river = await seedPerson({ roleKey: 'ADMIN', roleId: s.roleIds.ADMIN, tenantId: RIVER });
    expect((await inSchool(RIVER, () => views.list(river.actor))).items).toHaveLength(0);
  });
});
