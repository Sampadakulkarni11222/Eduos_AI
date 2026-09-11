import * as students from '../../../students/student.service.js';
import * as agentTools from '../../agent/tools.js';
import { AppError } from '../../../../utils/AppError.js';
import { ok } from '../protocol.js';

/**
 * Helpers shared by every MCP tool module.
 *
 * Nothing here contains business logic. It is schema fragments, formatting,
 * and the two things every tool file would otherwise re-invent: how to turn
 * "Rahul" into a student the caller is allowed to see, and how to front an
 * existing agent tool without copying it.
 */

/* ── Risk levels ──────────────────────────────────────────
   Drive confirmation and audit weight. See docs/MCP-SECURITY.md.
     LOW      reads. Nothing to undo.
     MEDIUM   ordinary creates and updates on a single record.
     HIGH     money, admission decisions, bulk reach, external messages,
              sensitive-data writes, anything touching somebody else's record.
     CRITICAL irreversible. Erasure, and destructive operations at scale. */
export const RISK = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL' };

export const OBJECT_ID = '^[a-f0-9]{24}$';
export const DATE = '^\\d{4}-\\d{2}-\\d{2}$';
export const MONTH = '^\\d{4}-\\d{2}$';

export const objectId = (description) => ({ type: 'string', pattern: OBJECT_ID, ...(description && { description }) });
export const dateStr = (description) => ({ type: 'string', pattern: DATE, ...(description && { description }) });
export const noArgs = { type: 'object', properties: {}, additionalProperties: false };

export const paise = (n) => Number(n ?? 0);
export const rupees = (n) => '₹' + (paise(n) / 100).toLocaleString('en-IN');
export const shortDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—');

/** Truncates a list for a spoken answer while reporting the true total. */
export function summarise(items, render, { limit = 5 } = {}) {
  const shown = items.slice(0, limit);
  return {
    shown: shown.length,
    total: items.length,
    list: shown.map(render).join('; '),
    more: items.length > shown.length,
  };
}

/**
 * Fronts an existing agent tool (src/modules/ai/agent/tools.js) over MCP.
 *
 * The agent tool is resolved **lazily**, through the live module namespace,
 * rather than destructured at import time. There is a genuine import cycle in
 * this repository — `agent/tools.js → announcement.service → whatsapp.service
 * → whatsapp.agent → orchestrator → mcp` — and reading `TOOLS[name]` while
 * that unwinds finds it uninitialised. The getters below run after every
 * module has finished loading, so the cycle stops mattering.
 * `validateMcpRegistry()` does the eager checking at boot, where a mistake is
 * loud instead of latent.
 *
 * No behaviour is copied: the fee balance the assistant quotes is still
 * produced by `fee.service.getSummary()`, through the same tool body that
 * produced it before MCP existed.
 */
export function wrapAgentTool(name, { description, inputSchema = noArgs, module, operation = 'GET', risk = RISK.LOW, confirm = false, service } = {}) {
  const agentTool = () => {
    const tool = agentTools.TOOLS?.[name];
    if (!tool) throw new Error(`MCP registry references a non-existent agent tool: ${name}`);
    return tool;
  };
  return {
    wraps: name,
    module,
    operation,
    risk,
    confirm,
    get description() {
      return description ?? agentTool().description;
    },
    inputSchema,
    get permission() {
      return agentTool().permission;
    },
    get minScope() {
      return agentTool().minScope ?? null;
    },
    get affectsOthers() {
      return Boolean(agentTool().affectsOthers);
    },
    service: service ?? `agent tool ${name}`,
    summarise: (args, actor, prepared) => {
      const tool = agentTool();
      return tool.summarise ? tool.summarise(args ?? {}, actor, prepared) : tool.description;
    },
    validate: (args) => agentTool().validate?.(args ?? {}),
    prepare: (ctx, args) => {
      const tool = agentTool();
      return tool.prepare ? tool.prepare(ctx.actor, ctx.scope, args ?? {}) : null;
    },
    snapshot: (ctx, args, prepared) => {
      const tool = agentTool();
      return tool.snapshot ? tool.snapshot(ctx.actor, ctx.scope, args ?? {}, prepared ?? null) : null;
    },
    async run(ctx, args, prepared) {
      const result = await agentTool().execute(ctx.actor, ctx.scope, args ?? {}, prepared ?? null);
      return ok(result?.data ?? null, {
        speakKey: result?.speakKey ?? null,
        params: result?.params ?? null,
        speak: result?.speak ?? null,
      });
    },
  };
}

/**
 * Resolves however the caller named a student into a student id.
 *
 * Looking somebody up by name or admission number is a **student directory
 * read**, so it runs at the caller's own `students.read` scope rather than at
 * the scope of whichever tool wanted the id. Otherwise `attendance.read` on
 * its own would quietly become a student directory: the services take whatever
 * scope they are handed, and handing them the wrong one is how a permission
 * gets widened by accident.
 *
 * An ambiguous name is refused, never guessed — picking one would be a guess
 * about whose record to disclose.
 */
export async function resolveStudentId(ctx, { studentId, admissionNo, studentName }) {
  if (studentId) {
    // Confirms the caller may see this student at all; throws the same 404 the
    // students API gives them if not.
    await students.getById(ctx.actor, studentScopeOf(ctx), String(studentId), { via: 'mcp.resolve', audit: false });
    return String(studentId);
  }
  if (!admissionNo && !studentName) return null;

  const scope = studentScopeOf(ctx);
  const search = admissionNo ?? studentName;
  const page = await students.list(ctx.actor, scope, { search, page: 1, pageSize: 10 });
  const rows = page.items ?? [];

  if (admissionNo) {
    const exact = rows.find((s) => s.admissionNo?.toLowerCase() === String(admissionNo).toLowerCase());
    if (!exact) throw new AppError(`No student with admission number "${admissionNo}".`, 404);
    return exact.id;
  }
  // The list search is a substring match — right for a search box, wrong for
  // naming someone: "Riya" is inside "Priya", and answering about Priya when
  // asked about Riya is a wrong answer about a real child. So a name must match
  // whole words of the student's name; a near miss is offered, never taken.
  const term = String(studentName).trim().toLowerCase().replace(/\s+/g, ' ');
  const named = rows.filter((s) => ` ${String(s.name ?? '').toLowerCase()} `.includes(` ${term} `));
  const label = (s) => `${s.name} (${s.admissionNo})`;

  if (named.length === 0) {
    throw new AppError(
      `No student named "${studentName}".` + (rows.length ? ` Did you mean: ${rows.slice(0, 5).map(label).join(', ')}?` : ''),
      404,
    );
  }
  if (named.length > 1) {
    throw new AppError(
      `More than one student matches "${studentName}": ${named.slice(0, 5).map(label).join(', ')}. Which one?`,
      400,
    );
  }
  return named[0].id;
}

/** The caller's own students.read scope, or a refusal when they hold none. */
export function studentScopeOf(ctx) {
  const scope = ctx.actor?.permissions?.['students.read'];
  if (!scope) throw new AppError('You are not authorized to look up student records.', 403);
  return scope;
}

/** Resolves a student to their current active enrolment. */
export async function resolveEnrollmentId(ctx, args) {
  if (args.enrollmentId) return args.enrollmentId;
  const studentId = await resolveStudentId(ctx, args);
  // OWN-scope callers name nobody; the service resolves their own enrolment.
  if (!studentId) return undefined;

  const enrolments = await students.listEnrollments({ studentId, status: 'ACTIVE' });
  if (!enrolments.length) throw new AppError('That student has no active enrolment.', 404);
  return enrolments[0].id;
}

/**
 * Resolves a named student to their active enrolment and the class it is in.
 *
 * Built on resolveStudentId(), so the lookup runs at the caller's own
 * students.read scope and an ambiguous name is refused rather than guessed.
 */
export async function resolveStudentEnrollment(ctx, ident) {
  const studentId = await resolveStudentId(ctx, ident);
  if (!studentId) throw new AppError('Name the student — by id, admission number or name.', 400, [], 'AGENT_NEEDS_INPUT');

  const [enrolment] = await students.listEnrollments({ studentId, status: 'ACTIVE' });
  if (!enrolment) throw new AppError('That student has no active enrolment.', 404);
  return {
    studentId,
    enrollmentId: enrolment.id,
    sectionId: enrolment.sectionId,
    name: enrolment.studentName,
    class: enrolment.class,
  };
}

/** Student identification arguments, shared by every per-student tool. */
export const studentIdentitySchema = {
  studentId: objectId('Preferred when known, e.g. from search_students'),
  admissionNo: { type: 'string', maxLength: 40, description: 'Admission number, e.g. "OAK-12"' },
  studentName: { type: 'string', maxLength: 80, description: 'Full or partial name; an ambiguous match is refused, never guessed' },
};
