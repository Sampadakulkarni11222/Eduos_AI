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
  Seats: 'seat',
  Customization: 'customization',
  Domains: 'domain',
};

/**
 * Tools whose module is broader than the thing they answer about.
 *
 * The Academics module carries classes, subjects and the timetable, which are
 * three different questions to the person asking. Everything not listed here
 * takes its entity from the module.
 */
const ENTITY_OF_TOOL = {
  // The Communication module carries announcements AND the school calendar,
  // and taking the entity from the module alone classified every calendar
  // question as an announcement -- so "list the holidays in June" could not
  // reach the capability that answers it.
  get_calendar_events: 'calendar',
  create_calendar_event: 'calendar',
  get_timetable: 'timetable',
  upsert_timetable_slot: 'timetable',
  get_subjects: 'subject',
  list_subjects: 'subject',
  create_subject: 'subject',
  get_my_classes: 'class',
  get_my_profile: 'profile',
  get_dashboard: 'analytics',
  // Both live in the Analytics module, and neither is a question about
  // analytics. "Which students are below 75% attendance?" is a question about
  // students, and taking the entity from the module made it score as a request
  // about something the sentence never mentions.
  get_at_risk_students: 'student',
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

/**
 * Whether an argument NAMES a record -- a class, a student, an exam, a school
 * subject -- as opposed to carrying content somebody is supplying.
 *
 * Names are read by the dimension readers, which know what a class or a person
 * looks like; free text ("whatever follows a colon") is content, and filling a
 * name from it sent "Rahul Sharma 41" as the name of an exam. `subject` names a
 * school subject only on academic capabilities: a ticket's subject is its
 * headline, which is exactly the content a person types after a colon.
 */
const ACADEMIC_ENTITIES = new Set(['marks', 'homework', 'attendance', 'timetable', 'class', 'subject']);

export function namesARecord(capability, name, property = {}) {
  if (property.type !== 'string' || property.pattern || Array.isArray(property.enum)) return false;
  if (!Object.values(TARGET_ARGS).flat().includes(name)) return false;
  return name !== 'subject' || ACADEMIC_ENTITIES.has(capability?.entity);
}

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

/**
 * What a capability RETURNS, when it has not said.
 *
 * Declared `resultShape` always wins; this fills the rest in from the one thing
 * that already describes a capability's answer — its name. `list_books` returns
 * rows, `get_student` returns one record, `get_hostel_summary` returns a figure.
 * Derived rather than hand-labelled for the reason the rest of this file is:
 * sixty-odd capabilities would otherwise each need a second statement of
 * something their name already makes plain, and the sixty-first would be
 * forgotten.
 *
 * It matters because the shape of the answer is part of the question. "How many
 * beds are free" and "which beds are free" are different requests, and without
 * a shape the resolver could not tell the capability that answers one from the
 * capability that answers the other.
 */
function defaultResultShape(name) {
  const segments = String(name ?? '').split('_');
  const last = segments[segments.length - 1] ?? '';
  if (/summary|statistic|stats|dashboard|overview|score|health|count/.test(name)) return 'SUMMARY';
  if (segments[0] === 'list' || segments[0] === 'search') return 'LIST';
  // A plural tail is a list of things; a singular tail is one thing.
  if (/s$/.test(last) && !/ss$/.test(last)) return 'LIST';
  return 'DETAIL';
}

/** One tool, as the resolver sees it. */
function describe(name, tool) {
  const properties = Object.keys(tool.inputSchema?.properties ?? {});
  return {
    name,
    // Carried so the resolver can read a capability's own words as a weak
    // lexical signal. The words are the tool's, written once, next to it.
    description: String(tool.description ?? ''),
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
    // The tool's own input schema, carried rather than copied. Argument
    // extraction reads each property's shape from here — an ObjectId pattern,
    // an enum, a bounded integer — so the schema stays the single statement of
    // what an argument is, and nothing re-describes it a second time.
    schema: tool.inputSchema ?? null,
    // The service a capability fronts, and whether it is a wrapper around a
    // legacy agent tool. Together these are what make a duplicate capability
    // recognisable without anyone declaring that it is one.
    service: tool.service ?? null,
    wraps: tool.wraps ?? null,
    // What the capability RETURNS: a figure about a group (SUMMARY), the rows
    // themselves (LIST), or one record in full (DETAIL). Declared by the tool,
    // absent where the distinction does not arise. It describes the answer
    // shape, never the question that asks for it.
    resultShape: tool.operation === 'GET' ? (tool.resultShape ?? defaultResultShape(name)) : (tool.resultShape ?? null),
    // A LIST that also reports the total of what it lists -- the student
    // directory returns the rows AND the roll count. Such a capability answers
    // "show all students" and "how many students" alike, and saying only one of
    // those shapes left it a point from losing the other question to something
    // narrower (the at-risk list) or to the model.
    reportsTotal: Boolean(tool.reportsTotal),
    // Answers only about a class the caller may act on, and asks "which
    // class?" otherwise. See holdsClasses() in capabilityResolver.js.
    requiresClass: Boolean(tool.requiresClass),
    supersededBy: null,
  };
}

let cached = null;

/** A service declaration as the set of functions it names, order-independent. */
function servicesOf(service) {
  return String(service ?? '').split('/').map((part) => part.trim()).filter(Boolean).sort()
    .join(String.fromCharCode(30));
}

/**
 * Marks a capability that duplicates another, and says which one to prefer.
 *
 * Derived, not declared. Two capabilities that front the SAME service with the
 * same entity and operation are the same capability under two names; where one
 * of them wraps a legacy agent tool and the other is native, the native one is
 * the canonical form. That is a structural fact about the catalog, so nothing
 * has to be hand-maintained and a future duplicate is recognised the day it
 * appears.
 *
 * It is deliberately conservative: a group with no single native member is left
 * alone rather than guessed at.
 */
function applySupersession(list) {
  const groups = new Map();
  for (const c of list) {
    if (!c.service) continue;
    // The services are compared as a SET, not as a string. Two entries that
    // front the same pair of service functions describe the same capability
    // whichever order their doc-string happens to list them in, and comparing
    // the raw text missed exactly that case.
    const key = [servicesOf(c.service), c.entity, c.operation].join(String.fromCharCode(31));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const native = members.filter((c) => !c.wraps);
    if (native.length !== 1) continue;
    for (const c of members) if (c.wraps) c.supersededBy = native[0].name;
  }
  return list;
}

/** Every capability in the catalog, regardless of who is asking. */
export function capabilityIndex() {
  if (!cached) cached = applySupersession(Object.entries(MCP_TOOLS).map(([name, tool]) => describe(name, tool)));
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
  // One stem for the whole family: score, scores, scored, scorer, scorers,
  // scoring. Listing the inflections one at a time is how "the highest
  // Mathematics SCORERS in Class 5-A" fell out of the marks vocabulary
  // altogether and was answered with a list of classes.
  ['marks', /\bmarks?\b|\bresults?\b|\bgrades?\b|\bscor(?:e|es|ed|er|ers|ing)\b|\breport\s*card\b|\bgpa\b|\bexams?\b|\bexamination|अंक|परिणाम/i],
  // "Task", "pending work", "submitted work": what a teacher calls homework
  // without the word. Bare "work" is not here -- "does the bus work today?" is
  // no question about homework -- only work qualified by a state homework is in.
  ['homework', /\bhomework\b|\bassignments?\b|\bworksheets?\b|\bsubmissions?\b|\btasks?\b|\bclasswork\b|\b(?:pending|submitted|unsubmitted|overdue|completed)\s+work\b|गृहकार्य|होमवर्क/i],
  // "Notify" is announcing to named people: the verb is the entity's own word.
  ['announcement', /\bannouncement|\bnotice|\bcircular|\bnews\b|\bnotify(?:ing)?\b/i],
  ['material', /\bmaterial|\bcourse\s*material|\bnotes\b|\bhandout|\bdocument|\bresource/i],
  // "What class do I have next?" asks for a period -- which is the timetable,
  // not the caller's section.
  ['timetable', /\btime.?table\b|\bperiods?\b|\bschedule\b|\blesson|\bnext\s+(?:class|lecture)\b|\bclass\b[^?.]*\b(?:next|right\s+now)\b/i],
  ['leave', /\bleave\b|\bday\s*off\b|\bchutti\b|छुट्टी/i],
  ['elective', /\belective|\bsubject\s*registration|\bregistration/i],
  ['studentRequest', /\bco.?curricular|\bachievement|\bactivit(y|ies)\b|\bprofile[\s-]*(?:correction|edit|change)|\bstudent\s*request|\beditable\b|\bfields?\b[^?.]*\bcan\s+i\s+(?:change|edit|correct)/i],
  ['medical', /\bmedical|\ballerg|\bblood\s*group|\bhealth/i],
  ['ticket', /\bticket|\bsupport|\bhelpdesk|\bcomplaint|\bquer(y|ies)\b/i],
  ['notification', /\bnotification|\balert|\bunread\b/i],
  // Not "my profile-edit requests": those are requests, a different record.
  ['profile', /\bmy\s*profile\b(?![\s-]*(?:correction|edit|change))|\bmy\s*details\b|\babout\s*me\b/i],
  ['student', /\bstudents?\b|\bpupils?\b|\bchild|\bclass\s*list\b|\benrol/i],
  ['class', /\bclass(es)?\b|\bsections?\b|\bdivisions?\b|\bgrades?\b/i],
  // "Course material" is material, not a course.
  ['subject', /\bsubjects?\b|\bcourses?\b(?!\s*materials?)|विषय/i],
  // "growth" before the marks vocabulary can claim "growth SCORE": a growth
  // score is an analytics figure that happens to share a word with marks, and
  // whichever entity is spoken first is the subject.
  ['analytics', /\bdashboard|\banalytics|\bsummary\b|\boverview\b|\bgrowth\b/i],
  // "What is scheduled for Friday?" asks the calendar. The word was in no
  // vocabulary at all, so a question that named a real day named no entity,
  // scored below the floor on every capability and was answered with the list
  // of things the assistant can help with. A timetable question says so --
  // "timetable", "period", "lecture" -- and is matched by its own entry.
  ['calendar', /\bcalendar|\bevent|\bholiday|\bschedul(?:e|es|ed|ing)\b|\bagenda\b/i],
  ['fee', /\bfees?\b|\binvoice|\bpayment|\breceipt|\binstallment|फीस/i],
  // Seats a school buys, requested from the platform: "request 25 extra seats".
  ['seat', /\bseats?\b/i],
  ['library', /\blibrar|\bbooks?\b/i],
  ['hostel', /\bhostel|\bdorm|\broom\b|\bbeds?\b|\bwarden\b/i],
  ['transport', /\btransport|\bbus\b|\broute\b|\bpick[\s-]?up\b|\bdrop[\s-]?off\b|\bbus\s*stop/i],
  // Admissions, but NOT the words "admission number" -- that is how a STUDENT
  // is identified, and reading it as the admissions pipeline would answer a
  // question about a pupil with a list of enquiries.
  ['admission', /\badmissions?\b(?!\s*(?:number|no\b))|\benquir(y|ies)\b|\bapplicants?\b|\badmission\s+leads?\b/i],
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

/**
 * The same entities, ordered by where each is first spoken.
 *
 * English puts the subject of a request before what narrows it: "show me the
 * STUDENTS in my classes", "OUTSTANDING FEES for Class 5A". Declaration order
 * cannot know that -- it is fixed -- so a request that named two entities was
 * resolved by whichever happened to be listed first, and "the students in my
 * classes" answered with a list of classes.
 *
 * Position is evidence, not proof, so the caller weights the first entity
 * above the rest rather than discarding them.
 */
export function entitiesInTextByPosition(text) {
  const str = String(text ?? '');
  return ENTITY_VOCABULARY
    .map(([entity, re]) => [entity, str.search(re)])
    .filter(([, at]) => at >= 0)
    .sort((a, b) => a[1] - b[1])
    .map(([entity]) => entity);
}

/**
 * Entities that say WHICH RECORDS, not WHAT ABOUT THEM.
 *
 * Students and classes are the population a question is asked over, and they
 * are named first in ordinary English however unrelated they are to the
 * subject: "which STUDENTS scored highest in Mathematics in Class 5-A" is a
 * question about MARKS, over the population of students, narrowed to a class.
 * Reading the leading word as the subject answered it from the student
 * directory.
 *
 * Two entries, and a property of the entity rather than of any sentence: a
 * population is a thing you can have records ABOUT, which is exactly what
 * makes it the wrong answer to "about what?".
 */
const POPULATION_ENTITIES = new Set(['student', 'class']);

/**
 * What a request is ABOUT: the first entity spoken that is not merely the
 * population it is asked over.
 *
 * Falls back to the leading entity when a request names nothing else -- "show
 * me the students in my school" really is about students, and "my classes"
 * really is about classes. So a population is the subject only when it is the
 * only thing on offer.
 */
export function subjectEntityOf(text) {
  const spoken = entitiesInTextByPosition(text);
  return spoken.find((entity) => !POPULATION_ENTITIES.has(entity)) ?? spoken[0] ?? null;
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
