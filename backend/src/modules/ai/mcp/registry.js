import * as agentTools from '../agent/tools.js';
import { studentTools } from './tools/students.js';
import { attendanceTools } from './tools/attendance.js';
import { feeTools } from './tools/fees.js';
import { academicTools } from './tools/academics.js';
import { communicationTools } from './tools/communication.js';
import { facilityTools } from './tools/facilities.js';
import { welfareTools } from './tools/welfare.js';
import { requestTools } from './tools/requests.js';
import { analyticsTools } from './tools/analytics.js';
import { profileTools } from './tools/profile.js';
import { seatTools } from './tools/seats.js';
import { customizationTools } from './tools/customization.js';
import { domainTools } from './tools/domains.js';
import { operationsTools } from './tools/operations.js';
import { platformPeopleTools } from './tools/platformPeople.js';
import { platformGapTools } from './tools/platformGaps.js';
import { platformOpsTools } from './tools/platformOps.js';
import { openuiTools } from './tools/p3Openui.js';
import { healthTools } from './tools/p3Health.js';
import { campusTools } from './tools/p3Campus.js';
import { integrationTools } from './tools/p3Integrations.js';
import { leadershipTools } from './tools/p4Leadership.js';
import { p4FinanceHrNurseTools } from './tools/p4FinanceHrNurse.js';
import { p4StudentAlumnusTools } from './tools/p4StudentAlumnus.js';
import { teacherP4Tools } from './tools/p4Teacher.js';
import { newsletterP4Tools } from './tools/p4Newsletter.js';
import { newsletterP5Tools } from './tools/p5NewsletterAi.js';
import { p4LibrarianTools } from './tools/p4Librarian.js';
import { p4WardenTools } from './tools/p4Warden.js';
import { p4MarketingTools } from './tools/p4Marketing.js';
import { p4ComplianceTools } from './tools/p4Compliance.js';
import { p4ParentTools } from './tools/p4Parent.js';
import { p5GapTools } from './tools/p5Gaps.js';
import { p5AskAiTools } from './tools/p5AskAi.js';
import { p6CoverageTools } from './tools/p6Coverage.js';
import { p6AskAiTools } from './tools/p6AskAi.js';
import { p7BulkImportTools } from './tools/p7BulkImport.js';
import { p7AutomationTools } from './tools/p7Automation.js';
import { p7MultiTools } from './tools/p7Multi.js';
import { p8ExamRoomsTools } from './tools/p8ExamRooms.js';
import { p8CctvTools } from './tools/p8Cctv.js';
import { AI_ASSISTANT_PERMISSION } from '../../../constants/permissions.js';
import { isDecidingToolName } from './decisions.js';

/**
 * The EduOS MCP tool catalog.
 *
 * Assembled from per-module files rather than written in one place, so a tool
 * sits next to the other tools that call the same service and a module's whole
 * surface can be read at once.
 *
 * Two kinds of entry, and the distinction matters:
 *
 *   WRAPPED — a capability the agent already had (`agent/tools.js`). The entry
 *     supplies the MCP schema, risk level and confirmation rule, and delegates
 *     to that tool's own `execute`. No behaviour is copied.
 *   NATIVE — a capability nobody had yet. These call the existing service layer
 *     directly, with the same actor/scope arguments the REST controllers pass.
 *
 * What is NOT here is business logic. Every entry is a schema, a permission, a
 * risk level and a call into `src/modules/*`. A tool that needed a rule of its
 * own would mean that rule belongs in the service the REST API uses, so the
 * screen and the assistant cannot drift apart.
 *
 * Every entry declares:
 *   module       for the catalog and the audit trail
 *   operation    GET | CREATE | UPDATE | DELETE | ACTION
 *   risk         LOW | MEDIUM | HIGH | CRITICAL
 *   confirm      true when a human must approve before it runs
 *   confirmWhen  optional (args) => boolean, for tools where only some calls
 *                are high-impact (a dry run does not need approval)
 *   permission   checked against the caller's live permission map, server-side
 *   minScope     'ALL' when the tool reaches beyond the caller's own records
 *   service      the EduOS service it fronts, for the catalog
 *   run          (ctx, args, prepared) → a protocol envelope
 */

const ASSEMBLED = {
  ...studentTools,
  ...attendanceTools,
  ...feeTools,
  ...academicTools,
  ...communicationTools,
  ...facilityTools,
  ...welfareTools,
  ...requestTools,
  ...analyticsTools,
  ...profileTools,
  ...seatTools,
  ...customizationTools,
  ...domainTools,
  ...operationsTools,
  ...platformPeopleTools,
  ...platformGapTools,
  ...platformOpsTools,
  ...openuiTools,
  ...healthTools,
  ...campusTools,
  ...integrationTools,
  ...leadershipTools,
  ...p4FinanceHrNurseTools,
  ...p4LibrarianTools,
  ...p4WardenTools,
  ...p4MarketingTools,
  ...p4ComplianceTools,
  ...p4ParentTools,
  ...teacherP4Tools,
  ...newsletterP4Tools,
  ...newsletterP5Tools,
  ...p4StudentAlumnusTools,
  ...p5GapTools,
  ...p5AskAiTools,
  ...p6AskAiTools,
  ...p6CoverageTools,
  ...p7MultiTools,
  ...p7AutomationTools,
  ...p7BulkImportTools,
  ...p8CctvTools,
  ...p8ExamRoomsTools,
};

/**
 * The catalogue, less anything that would DECIDE.
 *
 * The assistant never approves, rejects, publishes, refunds or records money:
 * a person does that on the screen (see decisions.js). The tool files no longer
 * declare such tools, and validateMcpRegistry() fails the boot if one comes
 * back; this filter is the second lock, so a deciding tool added by mistake is
 * neither shown to the model nor executable while somebody reads the boot log.
 */
export const MCP_TOOLS = Object.freeze(Object.fromEntries(
  Object.entries(ASSEMBLED).filter(([name]) => !isDecidingToolName(name)),
));

export function getMcpTool(name) {
  return Object.hasOwn(MCP_TOOLS, name) ? MCP_TOOLS[name] : null;
}

/**
 * The grants that admit a caller to a tool.
 *
 * Normally one: `permission` at `minScope`, the route's requirePermission().
 * A route that accepts any of several keys (requireAnyOf -- the principal
 * reads trips by transport.tracking.read ALL, the transport office by
 * transport.fleet.manage, a teacher on bus duty by transport.trips.operate)
 * is mirrored by `anyOf: [[key, minScope?], ...]`; `permission` must be one
 * of them, so the catalogue and the audit still name a primary key.
 */
export function toolGrants(tool) {
  if (Array.isArray(tool?.anyOf) && tool.anyOf.length) return tool.anyOf.map(([key, minScope]) => [key, minScope ?? null]);
  return [[tool?.permission, tool?.minScope ?? null]];
}

/**
 * The scope this caller holds for this tool -- what req.scope would be on its
 * route: ALL when any admitting grant is held at ALL, else OWN -- or null with
 * the reason ('MISSING' no admitting key at all, 'SCOPE' held only at OWN where
 * ALL is needed).
 */
export function toolScope(actor, tool) {
  let best = null;
  let ownOnly = false;
  for (const [key, minScope] of toolGrants(tool)) {
    const held = actor?.permissions?.[key];
    if (!held) continue;
    if (minScope === 'ALL' && held !== 'ALL') { ownOnly = true; continue; }
    if (held === 'ALL') return { scope: 'ALL', reason: null };
    best = best ?? held;
  }
  if (best) return { scope: best, reason: null };
  return { scope: null, reason: ownOnly ? 'SCOPE' : 'MISSING' };
}

/** What is wrong with a tool's `anyOf`, if anything (checked at boot by validateMcpRegistry). */
export function anyOfProblems(name, tool) {
  if (tool?.anyOf === undefined) return [];
  const grants = Array.isArray(tool.anyOf) ? tool.anyOf : [];
  const wellFormed = grants.length >= 2 && grants.every((g) => Array.isArray(g) && g.length >= 1 && g.length <= 2
    && typeof g[0] === 'string' && g[0] && (g[1] === undefined || g[1] === null || g[1] === 'ALL'));
  if (!wellFormed) return [`${name} declares a malformed anyOf (two or more [key, minScope?] grants)`];
  if (!grants.some(([k]) => k === tool.permission)) return [`${name} names a permission that is not one of its anyOf grants`];
  if (tool.minScope !== undefined && !grants.some(([k, m]) => k === tool.permission && (m ?? null) === (tool.minScope ?? null))) {
    return [`${name} declares a minScope that disagrees with its anyOf grant`];
  }
  return [];
}

/** True when a tool changes data. Derived, so it can never disagree with `operation`. */
export function mutates(tool) {
  return Boolean(tool) && tool.operation !== 'GET';
}

/**
 * Whether this specific call needs a human to approve it first.
 *
 * `confirmWhen` exists for tools where only some calls are high-impact —
 * `generate_invoices` with `dryRun: true` writes nothing, and asking somebody
 * to confirm a preview is how confirmation prompts start being clicked
 * through without being read.
 */
export function requiresConfirmation(tool, args) {
  if (!tool || !mutates(tool)) return false;
  if (typeof tool.confirmWhen === 'function') return Boolean(tool.confirmWhen(args ?? {}));
  return Boolean(tool.confirm);
}

/**
 * Whether a write may be proposed and confirmed on this channel.
 *
 * WhatsApp's confirmation is a bare "yes" from whoever holds the phone (a lent
 * handset, a swapped SIM). That is acceptable for a person's own low-impact
 * filing; it is not for a change that is HIGH or CRITICAL risk or that lands
 * on somebody else's record. Those are confirmed on the website, where the
 * session is the person's own sign-in.
 */
export function confirmableOn(tool, channel) {
  if (channel !== 'WHATSAPP') return true;
  return !(tool?.affectsOthers || tool?.risk === 'HIGH' || tool?.risk === 'CRITICAL');
}

/**
 * The tools this actor may actually use, in MCP `tools/list` shape.
 *
 * This is role-filtered discovery, and it is done from the **permission map**,
 * never from the role name — EduOS roles are DB-backed and a school can invent
 * its own, so `if (role === 'ADMIN')` would be wrong the first time somebody
 * creates a Counsellor. A parent sees roughly a dozen tools; an administrator
 * sees most of the catalog; a custom role sees exactly what its grants imply.
 *
 * Filtering here is NOT the authorization — server.js re-checks the permission
 * on every call, because a list is a snapshot and a call is an act. It is what
 * stops the model from being *shown* a capability it would then propose and be
 * refused for, which reads to a user as the assistant being broken, and it
 * keeps the tool list small enough for the model to route accurately.
 */
export function mcpToolsFor(actor, { includeMutations = true } = {}) {
  // The assistant permission gates the assistant's catalogue, not just its
  // endpoints. Every route into the agent already requires ai.copilot.use, so
  // an actor without it has no business being described a catalogue at all —
  // and this way the exclusion holds for any future caller of this function
  // too, rather than depending on each one remembering the route check.
  // Uniform for every role: it is the permission that decides, not the name.
  if (!actor?.permissions?.[AI_ASSISTANT_PERMISSION]) return [];

  return Object.entries(MCP_TOOLS)
    .filter(([, tool]) => {
      if (!includeMutations && mutates(tool)) return false;
      // A route guarded by requireRole() as well as a permission (a family's
      // certificate requests) is mirrored by `forRoles`, so the capability is
      // shown to exactly the people its screen serves.
      if (Array.isArray(tool.forRoles) && !tool.forRoles.includes(actor?.roleKey)) return false;
      return toolScope(actor, tool).scope !== null;
    })
    .map(([name, tool]) => ({
      name,
      description: tool.description,
      inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
      // Carried as MCP tool annotations so a client can reason about risk
      // without a second lookup, and so the agent's prompt can mark which
      // tools write.
      annotations: {
        module: tool.module,
        operation: tool.operation,
        risk: tool.risk,
        readOnlyHint: !mutates(tool),
        destructiveHint: tool.operation === 'DELETE',
        confirmationRequired: Boolean(tool.confirm || tool.confirmWhen),
      },
    }));
}

/** Every permission the catalog names — checked against the real catalog at boot. */
export function mcpPermissionsUsed() {
  return [...new Set(Object.values(MCP_TOOLS).flatMap((t) => toolGrants(t).map(([k]) => k)))];
}

/** Counts by operation, for the boot log and the docs. */
export function mcpCatalogStats() {
  const byOperation = {};
  const byRisk = {};
  for (const tool of Object.values(MCP_TOOLS)) {
    byOperation[tool.operation] = (byOperation[tool.operation] ?? 0) + 1;
    byRisk[tool.risk] = (byRisk[tool.risk] ?? 0) + 1;
  }
  return { total: Object.keys(MCP_TOOLS).length, byOperation, byRisk };
}

/**
 * Boot-time checks that cannot be made at import time.
 *
 * Wrapped tools resolve lazily (see `_shared.js:wrapAgentTool`), so a typo in a
 * wrapped name — or a wrapped tool that has since become something else —
 * would otherwise surface as a failure in one user's chat rather than at
 * startup. Returns a list of problems; empty means the catalog is sound.
 */
export function validateMcpRegistry() {
  const problems = [];
  for (const name of Object.keys(ASSEMBLED)) {
    if (isDecidingToolName(name)) {
      problems.push(`${name} is a deciding tool; decisions are made by a person on the screen, never by the assistant`);
    }
  }
  for (const [name, tool] of Object.entries(MCP_TOOLS)) {
    // Every CREATE files something in somebody's name -- a ticket, a request,
    // an enquiry -- so a person confirms it first. A plan can be steered by
    // text the model read earlier in the conversation; an unconfirmed filing
    // would be a write nobody asked for.
    if (tool.operation === 'CREATE' && !tool.confirm && typeof tool.confirmWhen !== 'function') {
      problems.push(`${name} creates a record without asking for confirmation`);
    }
    if (!tool.operation) problems.push(`${name} declares no operation`);
    if (!tool.risk) problems.push(`${name} declares no risk level`);
    if (!tool.permission) problems.push(`${name} declares no permission`);
    problems.push(...anyOfProblems(name, tool));
    if (typeof tool.run !== 'function') problems.push(`${name} has no run()`);

    // Every write must be able to describe itself before it happens. A
    // confirmation prompt that cannot say what it is about is not a
    // confirmation.
    if (mutates(tool) && typeof tool.summarise !== 'function') {
      problems.push(`${name} changes data but cannot summarise itself for confirmation`);
    }

    // An approver-confirmed decision (see APPROVER_CONFIRMED in decisions.js):
    // recorded only when its approver states it and confirms it on the website.
    if (tool.approverDecision && !(tool.confirm && tool.risk === 'HIGH' && tool.affectsOthers)) {
      problems.push(`${name} records an approval but is not confirmed, HIGH risk and web-only`);
    }
    if (tool.approverDecision && !(tool.inputSchema?.required ?? []).includes('decision')) {
      problems.push(`${name} records an approval without the approver stating the decision`);
    }

    if (!tool.wraps) continue;
    const wrapped = agentTools.TOOLS?.[tool.wraps];
    if (!wrapped) {
      problems.push(`${name} wraps a non-existent agent tool "${tool.wraps}"`);
      continue;
    }
    // The invariant that keeps a wrapped write honest: if the underlying agent
    // tool mutates, the MCP entry must say so too, or it would skip the
    // confirmation the agent tool was relying on.
    if (wrapped.mutates && !mutates(tool)) {
      problems.push(`${name} wraps "${tool.wraps}", which writes data, but is declared as a GET`);
    }
  }
  return problems;
}
