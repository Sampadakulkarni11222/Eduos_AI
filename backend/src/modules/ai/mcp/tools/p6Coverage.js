import { tools as people } from './p6/people.js';
import { tools as academic } from './p6/academic.js';
import { tools as office } from './p6/office.js';
import { tools as compliance } from './p6/compliance.js';
import { tools as finance } from './p6/finance.js';
import { tools as campusops } from './p6/campusops.js';
import { tools as community } from './p6/community.js';
import { tools as newsletter } from './p6/newsletter.js';
import { tools as marketing } from './p6/marketing.js';
import { tools as health } from './p6/health.js';
import { tools as misc } from './p6/misc.js';

/**
 * Part 6: the assistant covers every route a person can call.
 *
 * docs/erp-operations/ASSISTANT-COVERAGE-MAP.md enumerates every API route
 * (method, path, permission, minimum scope, the roles that can call it) and
 * matches it to the MCP tools that perform it by the service function both
 * call. The routes that had no tool and should have one are closed here, one
 * file per area under ./p6/, all built with the same kit (./p6/_kit.js): the
 * route's own service call behind the route's own guard, every write a draft
 * the same person confirms on the same channel, decisions recorded only when
 * the approver states and confirms them on the website.
 *
 * The routes deliberately left to the screen (credentials, file uploads and
 * downloads, payment checkout, safeguarding case files, payroll, device and
 * webhook endpoints, platform administration, and the decisions existing
 * tests keep on screen) are listed with their reasons in the coverage map.
 */
const PARTS = { people, academic, office, compliance, finance, campusops, community, newsletter, marketing, health, misc };

const merged = {};
for (const [part, set] of Object.entries(PARTS)) {
  for (const [name, def] of Object.entries(set)) {
    if (Object.hasOwn(merged, name)) throw new Error(`p6Coverage: ${name} is defined twice (${part})`);
    merged[name] = def;
  }
}

export const p6CoverageTools = merged;
