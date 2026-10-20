import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { runAgentSafely } from '../src/modules/ai/agent/orchestrator.js';
import { resetAgentThrottle } from '../src/modules/ai/agent/throttle.js';
import { converse } from '../src/modules/whatsapp/whatsapp.agent.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { seedPerson, inSchool, OAK } from './support/mcpSchool.js';
import { seedFamilySchool } from './support/familySchool.js';
import { setFeatures } from '../src/utils/features.js';
import { FEATURES } from '../src/constants/features.js';
import { School } from '../src/models/school.model.js';

/**
 * Natural phrasing for the common part-6 capabilities: the words a person
 * actually types, not the tool's name, reach the tool -- on the website and,
 * with the same answer, on WhatsApp. Run on the deterministic router (no
 * model), so what is asserted is the routing itself.
 */
const PHRASES = [
  // [role, message, expected tool]
  ['TEACHER', 'show my staff profile', 'get_my_staff_profile'],
  ['PARENT', "who are my child's teachers", 'list_my_child_teacher_profiles'],
  ['ADMIN', 'show the approval policies', 'list_approval_policies'],
  ['ADMIN', 'list the document types', 'list_document_types'],
  ['ADMIN', 'show the facility bookings', 'list_facility_bookings'],
  ['TEACHER', 'show the school shifts', 'list_school_shifts'],
  ['TEACHER', 'show the report card templates', 'list_report_card_templates'],
  ['TEACHER', 'show the support plans', 'list_support_plans'],
  ['TEACHER', 'show the question bank scopes', 'list_question_bank_scopes'],
  ['ADMIN', 'list the vendors', 'list_vendors'],
  ['ADMIN', 'show the procurement stats', 'get_procurement_stats'],
  ['ADMIN', 'list the budget scenarios', 'list_budget_scenarios'],
  ['ADMIN', 'show the lab devices', 'list_lab_devices'],
  ['ADMIN', 'list the id cards', 'list_id_cards'],
  ['ADMIN', 'show the safety alerts', 'list_safety_alerts'],
  ['ADMIN', 'show the club fixtures', 'list_club_fixtures'],
  ['ADMIN', 'show the house points', 'get_house_points'],
  ['ADMIN', 'list the sustainability zones', 'list_sustainability_zones'],
  ['ADMIN', 'show the showcase editions', 'list_showcase_editions'],
  ['ADMIN', 'show the community circles', 'list_community_circles'],
  ['ADMIN', 'show the newsletter archive', 'list_newsletter_archive'],
  ['ADMIN', 'show the digest sources', 'list_digest_sources'],
  ['ADMIN', 'show the marketing assets', 'list_marketing_assets'],
  ['ADMIN', 'list the offline campaigns', 'list_offline_campaigns'],
  ['COMPLIANCE', 'show the compliance obligations', 'list_compliance_obligations'],
  ['COMPLIANCE', 'list the regulatory returns', 'list_regulatory_returns'],
  ['ADMIN', 'show the analytics views', 'list_analytics_views'],
  ['ADMIN', 'show the cover rules', 'get_cover_assignment_rules'],
  ['ADMIN', 'list the staff leave policies', 'list_staff_leave_policies'],
  ['PARENT', 'show the medication plans', 'list_medication_plans'],
];

let s;
beforeEach(async () => {
  s = await seedFamilySchool();
  // Every module on, so a capability is judged on its words, not its switch.
  await School.updateOne({ slug: OAK }, { $setOnInsert: { slug: OAK, name: 'Oakridge Academy' } }, { upsert: true });
  await inSchool(OAK, () => setFeatures(Object.fromEntries(Object.keys(FEATURES).map((k) => [k, true]))));
  for (const key of ['COMPLIANCE', 'NURSE', 'MARKETING']) {
    if (!s.people[key]) s.people[key] = await seedPerson({ roleKey: key, roleId: s.roleIds[key] });
  }
});
afterAll(async () => { await resetMcpClient(); });

async function turn(fn) {
  resetAgentThrottle();
  try {
    return await inSchool(OAK, fn);
  } catch (err) {
    return { error: err?.message ?? String(err) };
  }
}

describe('common part-6 capabilities are reached in natural words, the same on both channels', () => {
  it('every phrase reaches its capability on the website and on WhatsApp', async () => {
    const misses = [];
    for (const [role, message, expected] of PHRASES) {
      const actor = s.people[role].actor;
      // eslint-disable-next-line no-await-in-loop
      const web = await turn(() => runAgentSafely({ message, actor, source: 'WEB' }));
      // eslint-disable-next-line no-await-in-loop
      const wa = await turn(() => converse({ actor, text: message }));
      const webTool = web.action?.tool ?? web.tool ?? null;
      if (webTool !== expected) misses.push(`${role} "${message}": website reached ${webTool ?? web.error ?? 'nothing'}`);
      else if ((wa.tool ?? null) !== expected) misses.push(`${role} "${message}": WhatsApp reached ${wa.tool ?? wa.error ?? 'nothing'}`);
    }
    expect(misses, misses.join('\n')).toEqual([]);
  }, 300_000);
});
