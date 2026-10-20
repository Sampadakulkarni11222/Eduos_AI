import { describe, it, expect } from 'vitest';
import { inSchool, OAK } from './support/mcpSchool.js';
import { seedFamilySchool } from './support/familySchool.js';
import { SupportPlan } from '../src/models/supportPlan.model.js';
import { PortfolioRating } from '../src/models/competencyPortfolio.model.js';
import { Scenario } from '../src/models/scenario.model.js';
import { seedP2Gaps } from '../src/seed/seed_p2_gaps.js';

/** The demo sample-data section for support plans, portfolios and scenarios runs and fills each one. */
describe('sample data for the part-2 gaps', () => {
  it('creates plans from risk signals, portfolio ratings and saved scenarios', async () => {
    const s = await seedFamilySchool();
    const results = [];
    const section = async (name, Model, fn) => { try { results.push([name, await fn()]); } catch (err) { results.push([name, `FAILED: ${err.message}`]); } };
    const attempt = async (_l, fn) => { try { return await fn(); } catch { return null; } };
    const who = { PRINCIPAL: { actor: s.people.PRINCIPAL.actor }, TEACHER: { id: String(s.people.TEACHER.profile._id) }, STUDENT: s.people.STUDENT, PARENT: s.people.PARENT };
    await inSchool(OAK, () => seedP2Gaps({ section, attempt, who, teachers: [], actorOf: () => s.people.TEACHER.actor }));
    expect(results.filter(([, n]) => String(n).startsWith('FAILED'))).toEqual([]);
    expect(await inSchool(OAK, () => SupportPlan.countDocuments({}))).toBeGreaterThan(0);
    expect(await inSchool(OAK, () => PortfolioRating.countDocuments({}))).toBeGreaterThan(0);
    expect(await inSchool(OAK, () => Scenario.countDocuments({}))).toBe(2);
  });
});
