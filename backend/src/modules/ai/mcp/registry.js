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
import { AI_ASSISTANT_PERMISSION } from '../../../constants/permissions.js';

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

export const MCP_TOOLS = {
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
};

export function getMcpTool(name) {
  return Object.hasOwn(MCP_TOOLS, name) ? MCP_TOOLS[name] : null;
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
      const scope = actor?.permissions?.[tool.permission];
      if (!scope) return false;
      return !(tool.minScope === 'ALL' && scope !== 'ALL');
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
  return [...new Set(Object.values(MCP_TOOLS).map((t) => t.permission))];
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
  for (const [name, tool] of Object.entries(MCP_TOOLS)) {
    if (!tool.operation) problems.push(`${name} declares no operation`);
    if (!tool.risk) problems.push(`${name} declares no risk level`);
    if (!tool.permission) problems.push(`${name} declares no permission`);
    if (typeof tool.run !== 'function') problems.push(`${name} has no run()`);

    // Every write must be able to describe itself before it happens. A
    // confirmation prompt that cannot say what it is about is not a
    // confirmation.
    if (mutates(tool) && typeof tool.summarise !== 'function') {
      problems.push(`${name} changes data but cannot summarise itself for confirmation`);
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
