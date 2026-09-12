import * as students from '../../../students/student.service.js';
import * as agentTools from '../../agent/tools.js';
import { AppError } from '../../../../utils/AppError.js';
import { getOwnStudentId, getGuardianStudentIds, getTeacherSectionIds } from '../../../../utils/scope.js';
import { Section } from '../../../../models/academics.model.js';
import { classKey, classLabel } from '../../../../utils/classNames.js';
import { nameCandidates } from '../../../../utils/peopleNames.js';
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
 * The student a caller *is*, or is the guardian of — resolved from the session.
 *
 * This is what stops the assistant asking a student who they are. A student
 * asking "what is my attendance?" names nobody, and the honest reading of that
 * is not "which student?" — it is their own record. The link is read from the
 * profile the session carries, never from anything the model or the message
 * said, so it cannot be steered: the same lookup the REST routes make
 * (see utils/scope.js, used by every OWN-scoped service).
 *
 * Deliberately narrow:
 *   STUDENT  their own record.
 *   PARENT   their child, but only when they have exactly one. With several,
 *            "my child's attendance" really is ambiguous and asking which is
 *            the right answer rather than a guess about whose record to open.
 *   anyone else — a teacher, an administrator — has no record of their own, so
 *            this returns null and the caller is asked, exactly as before.
 */
export async function selfStudentId(ctx) {
  const { roleKey, profileId } = ctx?.actor ?? {};
  if (!profileId) return null;
  if (roleKey === 'STUDENT') return await getOwnStudentId(profileId);
  if (roleKey === 'PARENT') {
    const children = await getGuardianStudentIds(profileId);
    return children.length === 1 ? children[0] : null;
  }
  return null;
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
  // Nobody named. A student (or a single child's parent) is asking about
  // themselves, so that is answered rather than asked back; everyone else still
  // gets null, and their tool still asks who they mean.
  if (!admissionNo && !studentName) return await selfStudentId(ctx);

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
  const label = (s) => `${s.name} (${s.admissionNo})`;

  // An exact full name wins outright. Without this, "Aarav Mishra" and the
  // surname-only "Mishra" were treated alike, so a class with two Mishras made
  // an exact request ambiguous.
  const exact = rows.filter((s) => String(s.name ?? '').trim().toLowerCase().replace(/\s+/g, ' ') === term);
  if (exact.length === 1) return exact[0].id;

  const named = exact.length > 1 ? exact : rows.filter((s) => ` ${String(s.name ?? '').toLowerCase()} `.includes(` ${term} `));

  if (named.length === 0) {
    // A misspelling ("Arav Mishra") finds nothing by substring, so the name is
    // searched a token at a time and the results ranked by similarity. The
    // close ones are OFFERED, never chosen: picking for the caller would mean
    // guessing whose record to open, and a write must never rest on a guess.
    const suggestions = await similarlyNamed(ctx, scope, term, rows);
    throw new AppError(
      `No student named "${studentName}".` +
        (suggestions.length ? ` Did you mean: ${suggestions.map(label).join(', ')}?` : ''),
      404,
      [],
      'STUDENT_NOT_FOUND',
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

/**
 * Students whose names are close to what was asked for, best first.
 *
 * Only ever used to build a suggestion. The directory search is a substring
 * match, so a single wrong letter finds nothing; each token of the name is
 * searched separately and the union is ranked by similarity. Runs at the
 * caller's own scope, so a suggestion can only ever name a student they were
 * already allowed to find.
 */
async function similarlyNamed(ctx, scope, term, alreadyFound) {
  const pool = new Map((alreadyFound ?? []).map((s) => [s.id, s]));
  for (const token of term.split(' ').filter((t) => t.length >= 3)) {
    try {
      // eslint-disable-next-line no-await-in-loop -- a handful of tokens at most
      const page = await students.list(ctx.actor, scope, { search: token, page: 1, pageSize: 10 });
      for (const s of page.items ?? []) pool.set(s.id, s);
    } catch {
      // A token that finds nothing simply contributes nothing.
    }
  }
  return nameCandidates(term, [...pool.values()]).map((x) => x.candidate);
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

/* ── Classes ──────────────────────────────────────────────
   A class is a Grade ("Class 5") plus a Section ("A"), and the ids the tools
   take are section ids. Nothing in a conversation carries one, so a class named
   in words has to be resolved -- and resolved at the caller's own scope, or the
   assistant would become a way to read a class the caller does not teach. */

/**
 * The sections this caller may act on, or null when they are unrestricted.
 *
 * Driven by the scope the tool itself declares (`ctx.scope`), not by the role
 * name, so the same helper is correct for an attendance tool and a student
 * tool. An OWN-scoped caller who is not a teacher holds no classes at all: a
 * class roster is a staff view, which is the same rule
 * attendance.service.assertSectionAccess() enforces underneath.
 */
export async function allowedSectionIds(ctx) {
  if (ctx?.scope === 'ALL') return null;
  if (ctx?.actor?.roleKey === 'TEACHER') return await getTeacherSectionIds(ctx.actor.profileId);
  return [];
}

/** Every section, with its grade, as the label a person would recognise. */
async function sectionsWithLabels() {
  const sections = await Section.find().select('_id name gradeId').populate('gradeId', 'name').lean();
  return sections.map((s) => ({
    sectionId: String(s._id),
    label: classLabel(s.gradeId?.name, s.name),
  }));
}

/**
 * Resolves a class named in words into one section the caller may see.
 *
 * The three outcomes are deliberately different answers, because the reported
 * bug was all three collapsing into one wrong sentence -- *No students match
 * "Class 5-A"* -- which told a teacher their own class was empty when the real
 * problem was that nothing had resolved it:
 *
 *   no such class          404 CLASS_NOT_FOUND     "I could not find a class
 *                                                   called ..." (never "no
 *                                                   students match")
 *   exists, not theirs     403 CLASS_OUT_OF_SCOPE  named, and nothing about it
 *                                                   disclosed -- not its size,
 *                                                   not its students
 *   a grade with several   400 AGENT_NEEDS_INPUT   asks which section
 *   sections in scope
 *
 * Matching is on the canonical key (see utils/classNames.js), so "Class 5-A",
 * "class 5a", "5-A" and "Class 5 A" all resolve to the same section. Tenant
 * isolation is unchanged: Section is tenant-scoped, so this only ever sees the
 * acting school's classes.
 */
export async function resolveSection(ctx, { sectionId, className } = {}) {
  const allowed = await allowedSectionIds(ctx);
  const permitted = (id) => allowed === null || allowed.includes(String(id));

  if (sectionId) {
    const all = await sectionsWithLabels();
    const found = all.find((s) => s.sectionId === String(sectionId));
    if (!found) throw new AppError('I could not find that class.', 404, [], 'CLASS_NOT_FOUND');
    if (!permitted(found.sectionId)) {
      throw new AppError(`${found.label} is not one of your classes.`, 403, [], 'CLASS_OUT_OF_SCOPE');
    }
    return found;
  }

  if (!className) return null;
  const key = classKey(className);
  if (!key) return null;

  const all = await sectionsWithLabels();
  // A grade on its own ("Class 5") matches every section in it; a full
  // reference ("Class 5 A") matches exactly one.
  const matches = all.filter((s) => classKey(s.label) === key)
    .concat(all.filter((s) => classKey(s.label) !== key && classKey(s.label).split(' ')[0] === key));

  if (!matches.length) {
    throw new AppError(`I could not find a class called "${String(className).trim()}".`, 404, [], 'CLASS_NOT_FOUND');
  }

  const mine = matches.filter((s) => permitted(s.sectionId));
  if (!mine.length) {
    // Named so the teacher knows which request was refused, and nothing else:
    // no roll count, no students, no ids.
    const label = matches.length === 1 ? matches[0].label : String(className).trim();
    throw new AppError(`${label} is not one of your classes.`, 403, [], 'CLASS_OUT_OF_SCOPE');
  }
  if (mine.length > 1) {
    throw new AppError(
      `Which one — ${mine.map((s) => s.label).join(', ')}?`,
      400, [], 'AGENT_NEEDS_INPUT',
    );
  }
  return mine[0];
}

/** resolveSection(), for callers that only want the id. */
export async function resolveSectionId(ctx, args) {
  return (await resolveSection(ctx, args))?.sectionId ?? null;
}

/** The class-identification argument every class-level tool accepts. */
export const classIdentitySchema = {
  className: {
    type: 'string',
    maxLength: 60,
    description: 'The class as a person names it, e.g. "Class 5 A", "Class 5-A" or "5-A"',
  },
};

/** Student identification arguments, shared by every per-student tool. */
export const studentIdentitySchema = {
  studentId: objectId('Preferred when known, e.g. from search_students'),
  admissionNo: { type: 'string', maxLength: 40, description: 'Admission number, e.g. "OAK-12"' },
  studentName: { type: 'string', maxLength: 80, description: 'Full or partial name; an ambiguous match is refused, never guessed' },
};
