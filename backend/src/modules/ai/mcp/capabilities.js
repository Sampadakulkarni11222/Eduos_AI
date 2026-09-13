import { MCP_TOOLS, mcpToolsFor, mutates, requiresConfirmation } from './registry.js';

/**
 * The capability index: what the AI is allowed to do, derived from the registry.
 *
 * The audit that produced this file found the architectural problem plainly: a
 * teacher could see 52 tools and only 18 had any routing path to them, because
 * every route was hand-written as a pattern rule somewhere else. Tools could be
 * added — and were — without anything being able to reach them.
 *
 * So routing metadata is not maintained by hand here. It is DERIVED from what
 * each tool already declares:
 *
 *   entity      from `module` (with a small override map, below, for the few
 *               modules whose name is not the word a person would use)
 *   operation   from `operation`
 *   authority   from `permission` + `minScope`, through mcpToolsFor(), so this
 *               index can never show a capability the caller is not entitled to
 *   targets     from the argument names the inputSchema accepts
 *   filters     likewise
 *
 * The consequence is the property the audit asked for: a new capability becomes
 * routable by declaring a correct module and schema. Nothing has to be taught
 * about it in a second place, and tests/teacher.capabilityCoverage asserts that
 * nothing visible is unreachable.
 *
 * This file decides NOTHING about authorization. It reads the same permission
 * map the MCP server enforces, and the server re-checks every call.
 */

/** The word a person uses for each registry module. */
const ENTITY_OF_MODULE = {
  Students: 'student',
  Attendance: 'attendance',
  Exams: 'marks',
  Assignments: 'homework',
  Academics: 'class',
  Communication: 'announcement',
  Calendar: 'calendar',
  Leave: 'leave',
  Registrations: 'elective',
  'Student requests': 'studentRequest',
  Medical: 'medical',
  Tickets: 'ticket',
  Documents: 'material',
  Notifications: 'notification',
  Profile: 'profile',
  Analytics: 'analytics',
  Users: 'user',
  Fees: 'fee',
  Library: 'library',
  Hostel: 'hostel',
  Transport: 'transport',
  Admissions: 'admission',
};

/**
 * Tools whose module is broader than the thing they answer about.
 *
 * The Academics module carries classes, subjects and the timetable, which are
 * three different questions to the person asking. Everything not listed here
 * takes its entity from the module.
 */
const ENTITY_OF_TOOL = {
  get_timetable: 'timetable',
  upsert_timetable_slot: 'timetable',
  get_subjects: 'subject',
  list_subjects: 'subject',
  get_my_classes: 'class',
  get_my_profile: 'profile',
  get_dashboard: 'analytics',
  list_notifications: 'notification',
};

/** Argument names that name WHAT the request is about. */
export const TARGET_ARGS = {
  class: ['className', 'sectionId'],
  student: ['studentId', 'studentName', 'admissionNo', 'enrollmentId'],
  subject: ['subject', 'subjectOfferingId'],
  exam: ['examSubjectId', 'examId', 'exam'],
  assignment: ['assignmentId'],
  ticket: ['ticketId'],
  document: ['documentId'],
  leave: ['leaveId'],
  request: ['requestId', 'registrationId'],
  announcement: ['announcementId'],
  book: ['bookId'],
  room: ['roomId'],
  route: ['routeId', 'stopId'],
  invoice: ['invoiceId', 'invoiceNo'],
};

/** Argument names that NARROW a request without naming its subject. */
export const FILTER_ARGS = {
  date: ['date', 'from', 'to', 'dueAt', 'activityDate'],
  month: ['month', 'period'],
  status: ['status'],
  query: ['query', 'search'],
  day: ['day'],
  limit: ['limit'],
  topic: ['topic'],
  sections: ['include'],
  latest: ['latest'],
};

const keysOf = (map, properties) =>
  Object.entries(map)
    .filter(([, names]) => names.some((n) => properties.includes(n)))
    .map(([kind]) => kind);

/** Argument names whose value is an opaque identifier rather than something sayable. */
function identifierArgs(schema) {
  return Object.entries(schema?.properties ?? {})
    .filter(([, spec]) => typeof spec?.pattern === 'string' && spec.pattern.includes('[a-f0-9]{24}'))
    .map(([name]) => name);
}

/** One tool, as the resolver sees it. */
function describe(name, tool) {
  const properties = Object.keys(tool.inputSchema?.properties ?? {});
  return {
    name,
    entity: ENTITY_OF_TOOL[name] ?? ENTITY_OF_MODULE[tool.module] ?? String(tool.module ?? 'other').toLowerCase(),
    module: tool.module,
    operation: tool.operation,
    permission: tool.permission,
    minScope: tool.minScope ?? null,
    risk: tool.risk,
    writes: mutates(tool),
    confirms: Boolean(tool.confirm || tool.confirmWhen),
    affectsOthers: Boolean(tool.affectsOthers),
    properties,
    required: tool.inputSchema?.required ?? [],
    targets: keysOf(TARGET_ARGS, properties),
    filters: keysOf(FILTER_ARGS, properties),
    // Which arguments are opaque ids. A resolver can ask a person for a topic
    // or a due date; it cannot ask them for an ObjectId, so a capability that
    // requires one it could not derive is not a candidate at all.
    ids: identifierArgs(tool.inputSchema),
  };
}

let cached = null;

/** Every capability in the catalog, regardless of who is asking. */
export function capabilityIndex() {
  if (!cached) cached = Object.entries(MCP_TOOLS).map(([name, tool]) => describe(name, tool));
  return cached;
}

/** Test seam: the index is memoised, and a test that mutates the registry needs it rebuilt. */
export function resetCapabilityIndex() {
  cached = null;
}

/**
 * The capabilities this actor may actually use, optionally narrowed.
 *
 * Authority comes from mcpToolsFor(), which is the same permission-and-scope
 * filter `tools/list` applies — so narrowing can hide a capability from a
 * prompt but can never reveal one the caller lacks.
 */
export function capabilitiesFor(actor, { entity = null, operation = null, entities = null } = {}) {
  const allowed = new Set(mcpToolsFor(actor).map((t) => t.name));
  const wanted = entities ? new Set(entities) : null;
  return capabilityIndex().filter((c) => {
    if (!allowed.has(c.name)) return false;
    if (entity && c.entity !== entity) return false;
    if (wanted && !wanted.has(c.entity)) return false;
    if (operation && c.operation !== operation) return false;
    return true;
  });
}

/** The entities this actor has any capability for — the domains AI may offer. */
export function entitiesFor(actor) {
  return [...new Set(capabilitiesFor(actor).map((c) => c.entity))].sort();
}

/**
 * The words people use for each entity.
 *
 * The one hand-maintained vocabulary in the architecture, and it is per ENTITY
 * (about twenty) rather than per question — which is the distinction the audit
 * drew. Stems and plurals are matched, so inflections need no new entries.
 */
export const ENTITY_VOCABULARY = [
  ['attendance', /\battendance\b|\babsent|\bpresent\b|\bregister\b|\broll\s*call\b|उपस्थिति/i],
  ['marks', /\bmarks?\b|\bresults?\b|\bgrades?\b|\bscored?\b|\bscores?\b|\breport\s*card\b|\bgpa\b|\bexams?\b|\bexamination|अंक|परिणाम/i],
  ['homework', /\bhomework\b|\bassignments?\b|\bworksheets?\b|\bsubmissions?\b|गृहकार्य|होमवर्क/i],
  ['announcement', /\bannouncement|\bnotice|\bcircular|\bnews\b/i],
  ['material', /\bmaterial|\bcourse\s*material|\bnotes\b|\bhandout|\bdocument|\bresource/i],
  ['timetable', /\btime.?table\b|\bperiods?\b|\bschedule\b|\blesson/i],
  ['leave', /\bleave\b|\bday\s*off\b|\bchutti\b|छुट्टी/i],
  ['elective', /\belective|\bsubject\s*registration|\bregistration/i],
  ['studentRequest', /\bco.?curricular|\bachievement|\bprofile\s*correction|\bprofile\s*edit|\bstudent\s*request/i],
  ['medical', /\bmedical|\ballerg|\bblood\s*group|\bhealth/i],
  ['ticket', /\bticket|\bsupport|\bhelpdesk|\bcomplaint|\bquer(y|ies)\b/i],
  ['notification', /\bnotification|\balert|\bunread\b/i],
  ['profile', /\bmy\s*profile\b|\bmy\s*details\b|\babout\s*me\b/i],
  ['student', /\bstudents?\b|\bpupils?\b|\bchild|\bclass\s*list\b|\benrol/i],
  ['class', /\bclass(es)?\b|\bsections?\b|\bdivisions?\b|\bgrades?\b/i],
  ['subject', /\bsubjects?\b|\bcourses?\b|विषय/i],
  ['analytics', /\bdashboard|\banalytics|\bsummary\b|\boverview\b/i],
  ['calendar', /\bcalendar|\bevent|\bholiday/i],
  ['fee', /\bfees?\b|\binvoice|\bpayment|फीस/i],
  ['library', /\blibrar|\bbooks?\b/i],
  ['hostel', /\bhostel|\bdorm|\broom\b/i],
  ['transport', /\btransport|\bbus\b|\broute\b/i],
];

/**
 * The entity a message is about, best match first.
 *
 * Returns every entity whose vocabulary matches, in declaration order, because
 * a sentence can legitimately mention two ("marks for Class 5-A" is marks, of a
 * class) and the resolver decides which is the subject and which is the target.
 */
export function entitiesInText(text) {
  const str = String(text ?? '');
  return ENTITY_VOCABULARY.filter(([, re]) => re.test(str)).map(([entity]) => entity);
}

/** Counts for the boot log and the coverage test. */
export function capabilityStats(actor) {
  const mine = capabilitiesFor(actor);
  const byOperation = {};
  const byEntity = {};
  for (const c of mine) {
    byOperation[c.operation] = (byOperation[c.operation] ?? 0) + 1;
    byEntity[c.entity] = (byEntity[c.entity] ?? 0) + 1;
  }
  return { total: mine.length, byOperation, byEntity, writes: mine.filter((c) => c.writes).length };
}

export { mutates, requiresConfirmation };

/**
 * The caller's authorized tools, ordered so the ones this message is about
 * come first — and with nothing dropped.
 *
 * This replaces a word-overlap ranking that then cut the list to a fixed 45.
 * The cut was the bug: a teacher is authorized for 58 tools, so thirteen of
 * their own capabilities were invisible to the model on every turn, and which
 * thirteen depended on whether the words in their sentence happened to appear
 * in a tool's description. A capability the school had granted could not be
 * reached by asking for it.
 *
 * So the list is ordered rather than truncated. Ordering is free — the model
 * reads the whole list either way — while truncation decides, on a guess, that
 * something is unreachable. When the message names no entity this returns the
 * list untouched, which is the honest answer to "no signal": everything the
 * caller may do stays on the table.
 *
 * `tools` is already the MCP server's tools/list for this caller, so this
 * function only ever reorders an authorized set. It cannot widen one: nothing
 * here consults a permission, and the server re-authorizes every call.
 */
export function orderToolsByRelevance(tools, message) {
  const list = tools ?? [];
  const entities = new Set(entitiesInText(message));
  if (!entities.size) return list;

  const entityOf = new Map(capabilityIndex().map((c) => [c.name, c.entity]));
  const matched = [];
  const rest = [];
  for (const tool of list) {
    (entities.has(entityOf.get(tool?.name)) ? matched : rest).push(tool);
  }
  return matched.length ? [...matched, ...rest] : list;
}
