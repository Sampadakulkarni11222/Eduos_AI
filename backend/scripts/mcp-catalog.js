#!/usr/bin/env node
/**
 * Emits the MCP tool catalog, human-readable and machine-readable.
 *
 * Generated rather than hand-written, because a catalog maintained by hand
 * drifts from the code the first time somebody adds a tool in a hurry — and a
 * stale security document is worse than none, since it is believed.
 *
 *   node scripts/mcp-catalog.js            → Markdown on stdout
 *   node scripts/mcp-catalog.js --json     → JSON on stdout
 *   node scripts/mcp-catalog.js --write    → writes docs/MCP-TOOLS.md and
 *                                            docs/mcp-tools.json
 *
 * Reads the registry and the permission catalog only. It connects to no
 * database and starts no server.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  MCP_TOOLS, mcpCatalogStats, mutates, validateMcpRegistry, mcpToolsFor,
} from '../src/modules/ai/mcp/registry.js';
import { LEGACY_TOOL_ALIASES, CONFIRM_TTL_MINUTES } from '../src/modules/ai/mcp/confirm.js';
import { SYSTEM_ROLES, PERMISSION_CATALOG } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const argOf = (name) => process.argv.includes(name);

const OPERATIONS = ['GET', 'CREATE', 'UPDATE', 'ACTION', 'DELETE'];
const isHighRisk = (tool) => tool.risk === 'HIGH' || tool.risk === 'CRITICAL';

/**
 * Custom roles are rows in each school's database, so no catalog can list them
 * in advance. This is the one the test suites create (tests/mcp.security.test.js),
 * shown to make the point concrete: a custom role sees exactly what its grants
 * imply, computed the same way as for a system role.
 */
const EXAMPLE_CUSTOM_ROLES = [
  {
    key: 'COUNSELLOR (custom, example)',
    grants: [
      { key: 'students.read', scope: 'ALL' },
      { key: 'attendance.read', scope: 'ALL' },
      { key: 'ai.copilot.use', scope: 'ALL' },
    ],
  },
];

/**
 * Tools whose underlying service is known to be less than the capability's
 * name suggests. The tool itself works and is honest about what it returns;
 * the limitation is in the service it fronts.
 */
const PARTIAL = {
  get_growth_score: 'growth.service.getScore() is a documented stand-in heuristic (60% published marks + 40% attendance for the month), not the ML model its name suggests. It also upserts the computed score as a cache row, as its REST route does.',
  get_at_risk_students: 'risk.service.scan() upserts its computed risk rows as a cache, as its REST route does — a read with a side effect on derived data, not on anything a person entered.',
};

/** Pre-MCP agent tools that still exist as implementation code but that nothing in the assistant reaches. */
const DEPRECATED = [
  {
    name: 'record_fee_payment',
    where: 'backend/src/modules/ai/agent/tools.js',
    status: 'Not in the MCP catalog and not reachable from either channel. Replaced by the MCP tool record_payment. Kept only because agent.bulkAuthorization.test.js exercises its permission metadata; safe to delete together with those assertions.',
  },
];

/**
 * Capabilities deliberately NOT exposed, and why — from docs/MCP-AUDIT.md §L
 * and docs/MCP-SECURITY.md. None has a tool; asking for one gets an honest
 * "not available", never a simulated success.
 */
const BLOCKED = [
  ['execute_sql / run_query / raw database access', 'By design. Every tool calls an existing EduOS service; no tool accepts a query, collection, model or update document (enforced by tests/mcp.architecture.test.js).'],
  ['arbitrary HTTP / API call, shell', 'By design. No tool accepts a URL to call or a command to run.'],
  ['arbitrary field update', 'By design. update_student, update_ticket, update_book and update_hostel_room apply explicit field allow-lists; student.service.update() enforces its own for every caller.'],
  ['online payment execution (payOnline / verifyCheckout)', 'Charging a family from a chat message is not something confirm-before-commit makes safe enough. Families pay through the payment link; staff record payments with record_payment.'],
  ['bulk WhatsApp / email to all parents', 'announcement.service.dispatch() writes a log line for the email and WhatsApp channels and sends nothing, and Meta requires approved templates for business-initiated messages. A tool would report a delivery that never happened. One-to-one send_whatsapp_message exists.'],
  ['update a phone number', 'No service writes Account.phoneE164 after creation; phone lives on the Account, not the Student. Would need new business logic.'],
  ['send_email', 'Only OTP email exists, and EMAIL_PROVIDER=console logs rather than sends.'],
  ['generate_certificate / transfer certificate', 'No generator exists; the PDF generators that do exist stream to an HTTP response and return nothing reusable.'],
  ['promote_student / transfer_student', 'No service; updateEnrollmentStatus() only sets one enrolment\'s status (exposed as update_enrollment_status).'],
  ['generate_fee_report / export', 'No report service; MCP returns the data (get_fee_statistics, get_pending_fees), not a file.'],
  ['delete_student (hard delete)', 'Only soft delete (archive_student) and irreversible anonymisation (anonymise_student) exist, both confirmed. Correct as-is.'],
  ['regularize_attendance', 'The permission exists in the catalog but no route or service implements it.'],
  ['HR / payroll / inventory / events', 'The modules do not exist.'],
];

function confirmationOf(tool) {
  if (tool.confirmWhen) return 'CONDITIONAL';
  return tool.confirm ? 'REQUIRED' : 'NOT_REQUIRED';
}

function scopeOf(tool) {
  return tool.minScope === 'ALL' ? 'ALL' : 'OWN or ALL';
}

function statusOf(name) {
  return PARTIAL[name] ? 'PARTIAL' : 'AVAILABLE';
}

function schemaSummary(schema) {
  const props = schema?.properties ?? {};
  const required = schema?.required ?? [];
  const entries = Object.entries(props);
  if (!entries.length) return '_(no arguments)_';
  return entries
    .map(([key, rule]) => {
      const req = required.includes(key) ? ' **(required)**' : '';
      const type = rule.type ?? 'any';
      const enumeration = rule.enum ? ` — one of: ${rule.enum.join(', ')}` : '';
      const note = rule.description ? ` — ${rule.description}` : '';
      return `\`${key}\`: ${type}${req}${enumeration}${note}`;
    })
    .join('<br>');
}

/** Per-role counts, computed from the permission map exactly as tools/list computes discovery. */
function roleMatrix() {
  const rows = [
    ...SYSTEM_ROLES.map((r) => ({ key: r.key, custom: false, permissions: buildPermissionMap({ permissions: r.grants }) })),
    ...EXAMPLE_CUSTOM_ROLES.map((r) => ({ key: r.key, custom: true, permissions: buildPermissionMap({ permissions: r.grants }) })),
  ];
  return rows.map(({ key, custom, permissions }) => {
    const visible = mcpToolsFor({ roleKey: key, permissions }).map((t) => t.name);
    const tools = visible.map((n) => MCP_TOOLS[n]);
    const byOp = Object.fromEntries(OPERATIONS.map((op) => [op, tools.filter((t) => t.operation === op).length]));
    const highRisk = visible.filter((n) => mutates(MCP_TOOLS[n]) && isHighRisk(MCP_TOOLS[n]));
    return {
      role: key,
      custom,
      total: visible.length,
      ...byOp,
      highRiskActions: highRisk.length,
      highRiskActionNames: highRisk,
      confirmationRequired: tools.filter((t) => t.confirm || t.confirmWhen).length,
      names: visible,
    };
  });
}

function toJson() {
  return {
    generatedFrom: 'backend/src/modules/ai/mcp/registry.js',
    stats: mcpCatalogStats(),
    tools: Object.entries(MCP_TOOLS).map(([name, tool]) => ({
      name,
      module: tool.module,
      operation: tool.operation,
      description: tool.description,
      input: tool.inputSchema,
      permission: tool.permission,
      scope: scopeOf(tool),
      risk: tool.risk,
      confirmation: confirmationOf(tool),
      affectsOthers: Boolean(tool.affectsOthers),
      readOnly: !mutates(tool),
      service: tool.service,
      status: statusOf(name),
      ...(PARTIAL[name] && { statusNote: PARTIAL[name] }),
      wrapsAgentTool: tool.wraps ?? null,
    })),
    roleMatrix: roleMatrix(),
    compatibilityAliases: Object.entries(LEGACY_TOOL_ALIASES).map(([legacy, canonical]) => ({
      legacyName: legacy,
      mcpTool: canonical,
      purpose: 'Redeems a proposal the pre-MCP agent stored under the old name. No new proposal is ever stored under it.',
      removableWhen: `No AgentAction row with tool "${legacy}" is PENDING or EXECUTING, and at least ${CONFIRM_TTL_MINUTES} minutes have passed since the first MCP deployment.`,
    })),
    deprecated: DEPRECATED,
    blocked: BLOCKED.map(([capability, reason]) => ({ capability, reason })),
  };
}

function toMarkdown() {
  const stats = mcpCatalogStats();
  const byModule = {};
  for (const [name, tool] of Object.entries(MCP_TOOLS)) {
    (byModule[tool.module] ??= []).push([name, tool]);
  }

  const lines = [];
  lines.push('# EduOS MCP Tool Catalog');
  lines.push('');
  lines.push('> **Generated file — do not edit by hand.**');
  lines.push('> Regenerate with `node backend/scripts/mcp-catalog.js --write`.');
  lines.push('> The source of truth is `backend/src/modules/ai/mcp/registry.js`.');
  lines.push('');
  lines.push(`**${stats.total} tools** — ` +
    Object.entries(stats.byOperation).map(([op, n]) => `${n} ${op}`).join(', ') + '.');
  lines.push('');
  lines.push('Risk mix: ' + Object.entries(stats.byRisk).map(([r, n]) => `${n} ${r}`).join(', ') + '.');
  lines.push('');
  lines.push(`Status: ${Object.keys(MCP_TOOLS).filter((n) => statusOf(n) === 'AVAILABLE').length} AVAILABLE, ` +
    `${Object.keys(PARTIAL).length} PARTIAL (see below). ${Object.keys(LEGACY_TOOL_ALIASES).length} compatibility aliases, ` +
    `${DEPRECATED.length} deprecated implementation entry, ${BLOCKED.length} capabilities deliberately blocked.`);
  lines.push('');

  lines.push('## What each column means');
  lines.push('');
  lines.push('| Column | Meaning |');
  lines.push('|---|---|');
  lines.push('| **Operation** | GET reads; CREATE, UPDATE and DELETE change one record; ACTION performs a business operation that is not plain CRUD. |');
  lines.push('| **Risk** | LOW = read. MEDIUM = ordinary single-record change. HIGH = money, admission decisions, bulk reach, external messages, sensitive data, or somebody else\'s record. CRITICAL = irreversible. |');
  lines.push('| **Confirm** | REQUIRED means the tool never runs on the first call: it returns a summary and a token, and a person must approve it. CONDITIONAL means only some calls need it (a dry run does not). |');
  lines.push('| **Permission** | Checked against the caller\'s live permission map on every call, and again at confirmation. |');
  lines.push('| **Scope** | ALL means the tool reaches beyond the caller\'s own records, so an OWN-scoped holder of the permission is refused. "OWN or ALL" means it serves both, and the service narrows OWN callers to their own records. |');
  lines.push('| **Status** | AVAILABLE, or PARTIAL where the service it fronts is less than the name suggests (explained below). |');
  lines.push('');

  lines.push('## Permission matrix by role');
  lines.push('');
  lines.push('Computed from each role\'s grants in `backend/src/constants/permissions.js`, the same way `tools/list` computes discovery at runtime — never from the role name. **High-risk actions** are write tools of risk HIGH or CRITICAL.');
  lines.push('');
  lines.push('| Role | Tools | GET | CREATE | UPDATE | ACTION | DELETE | High-risk actions | Need confirmation |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of roleMatrix()) {
    lines.push(`| \`${r.role}\` | ${r.total} | ${r.GET} | ${r.CREATE} | ${r.UPDATE} | ${r.ACTION} | ${r.DELETE} | ${r.highRiskActions} | ${r.confirmationRequired} |`);
  }
  lines.push('');
  lines.push('Custom roles are database rows, created per school, so none can be listed here in advance. The COUNSELLOR row is the custom role the test suites create; any custom role is computed exactly this way from its own grants.');
  lines.push('');
  lines.push('<details><summary>High-risk actions visible to each role</summary>');
  lines.push('');
  for (const r of roleMatrix()) {
    lines.push(`- **${r.role}** (${r.highRiskActions}): ${r.highRiskActionNames.length ? r.highRiskActionNames.map((n) => `\`${n}\``).join(', ') : '_none_'}`);
  }
  lines.push('');
  lines.push('</details>');
  lines.push('');

  lines.push('## Catalog summary');
  lines.push('');
  lines.push('| Tool | Module | Operation | Permission | Scope | Risk | Confirm | Status |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const [name, tool] of Object.entries(MCP_TOOLS).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`| \`${name}\` | ${tool.module} | ${tool.operation} | \`${tool.permission}\` | ${scopeOf(tool)} | ${tool.risk} | ${confirmationOf(tool)} | ${statusOf(name)} |`);
  }
  lines.push('');

  lines.push('## Partially implemented');
  lines.push('');
  for (const [name, note] of Object.entries(PARTIAL)) lines.push(`- \`${name}\` — ${note}`);
  lines.push('');

  lines.push('## Compatibility aliases');
  lines.push('');
  lines.push('| Legacy name | Redeemed by | Removable when |');
  lines.push('|---|---|---|');
  for (const a of toJson().compatibilityAliases) lines.push(`| \`${a.legacyName}\` | \`${a.mcpTool}\` | ${a.removableWhen} |`);
  lines.push('');

  lines.push('## Deprecated');
  lines.push('');
  for (const d of DEPRECATED) lines.push(`- \`${d.name}\` (\`${d.where}\`) — ${d.status}`);
  lines.push('');

  lines.push('## Blocked — deliberately not exposed');
  lines.push('');
  lines.push('| Capability | Why |');
  lines.push('|---|---|');
  for (const [capability, reason] of BLOCKED) lines.push(`| ${capability} | ${reason} |`);
  lines.push('');

  for (const module of Object.keys(byModule).sort()) {
    lines.push(`## ${module}`);
    lines.push('');
    for (const [name, tool] of byModule[module]) {
      lines.push(`### \`${name}\``);
      lines.push('');
      lines.push(tool.description);
      lines.push('');
      lines.push('| | |');
      lines.push('|---|---|');
      lines.push(`| **Operation** | ${tool.operation} |`);
      lines.push(`| **Risk** | ${tool.risk} |`);
      lines.push(`| **Confirmation** | ${confirmationOf(tool)} |`);
      lines.push(`| **Permission** | \`${tool.permission}\` |`);
      lines.push(`| **Scope** | ${scopeOf(tool)} |`);
      lines.push(`| **Affects others** | ${tool.affectsOthers ? 'Yes' : 'No'} |`);
      lines.push(`| **EduOS service** | \`${tool.service}\` |`);
      lines.push(`| **Status** | ${statusOf(name)} |`);
      lines.push(`| **Audited** | Yes — \`agent.${name}\` |`);
      lines.push('');
      lines.push('**Input**');
      lines.push('');
      lines.push(schemaSummary(tool.inputSchema));
      lines.push('');
      lines.push('**Output** — `{ success: true, data: { … } }`' +
        (mutates(tool) ? ', plus `action: { type, id, status: "completed" }` once performed.' : '.'));
      lines.push('');
      lines.push('**Errors** — `FORBIDDEN` / `FORBIDDEN_SCOPE` (not permitted), `INVALID_INPUT` (arguments), ' +
        '`NOT_FOUND` (no such record), `CONFLICT` (business rule), `SCHOOL_REQUIRED` (no school chosen), ' +
        '`TIMEOUT`, `DATABASE_ERROR`, `INTERNAL`.' +
        (tool.confirm || tool.confirmWhen ? ' `CONFIRMATION_INVALID` when the token is wrong, expired, reused or belongs to somebody else.' : ''));
      lines.push('');
    }
  }

  lines.push('## Permission coverage');
  lines.push('');
  const used = new Set(Object.values(MCP_TOOLS).map((t) => t.permission));
  const unused = PERMISSION_CATALOG.filter((p) => !used.has(p.key));
  lines.push(`${used.size} of the ${PERMISSION_CATALOG.length} permissions in the catalog are reachable through MCP.`);
  lines.push('');
  lines.push('Permissions **not** reachable through any tool:');
  lines.push('');
  for (const p of unused) lines.push(`- \`${p.key}\` — ${p.description}`);
  lines.push('');

  return lines.join('\n');
}

const problems = validateMcpRegistry();
if (problems.length) {
  console.error('Registry is inconsistent:\n  ' + problems.join('\n  '));
  process.exit(1);
}

if (argOf('--write')) {
  const docs = path.join(repoRoot, 'docs');
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(docs, 'MCP-TOOLS.md'), toMarkdown() + '\n');
  fs.writeFileSync(path.join(docs, 'mcp-tools.json'), JSON.stringify(toJson(), null, 2) + '\n');
  console.log(`Wrote docs/MCP-TOOLS.md and docs/mcp-tools.json (${mcpCatalogStats().total} tools)`);
} else if (argOf('--json')) {
  console.log(JSON.stringify(toJson(), null, 2));
} else {
  console.log(toMarkdown());
}
