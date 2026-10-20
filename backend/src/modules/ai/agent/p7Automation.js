import { parsePersonalRequest } from '../../automations/personal.js';
import { mcpToolsFor } from '../mcp/registry.js';

/**
 * Part 7: Ask AI as the way into automation.
 *
 * automationTurn()  reads the requests the rule tiers do not know -- setting up
 *                   a personal reminder or report in words, listing and
 *                   stopping them, "what needs me today", automation drafts,
 *                   and switching a school automation -- into ONE plan step on
 *                   a p7 tool the caller holds (tools/p7Automation.js). Every
 *                   write still goes through the MCP server as a draft the
 *                   person confirms.
 * withNextSteps()   "suggested next steps" chips after an answer: a few
 *                   follow-up questions that fit what was just shown, each
 *                   only when the caller holds the capability it would use.
 *                   They are suggestions to send, never actions taken.
 */

const ASKED_WHEN = /^When should I remind you\?/;
const ASKED_WHAT = /^What should I remind you about\?/;

const LIST_MINE = /^\s*(?:please\s+)?(?:(?:show|list|see|view|display|get|check)\s+(?:me\s+)?)?(?:all\s+)?my\s+(?:personal\s+)?(?:reminders?|scheduled\s+reports?|automations|scheduled\s+reminders?)\s*[?.!]*\s*$|\bwhat\s+reminders\s+(?:do\s+i\s+have|have\s+i\s+set)\b|\b(?:which|what)\s+(?:reminders|reports)\s+(?:did\s+i|have\s+i)\s+(?:set|schedule)/i;
const STOP_MINE = /\b(?:stop|cancel|delete|remove|turn\s+off|end|disable|switch\s+off)\b[^?]*\b(?:reminders?|reports?)\b/i;
const NEEDS_ME = /\bwhat\s+needs\s+(?:me|my\s+attention)\b|^\s*(?:show\s+)?what\s+needs?\s+(?:me\s+)?today\s*[?.!]*$|\bwhat(?:'s|\s+is)\s+on\s+my\s+plate\b|\bwhat\s+(?:should|do)\s+i\s+(?:need\s+to\s+)?do\s+today\b|\bmy\s+to-?do(?:\s+list)?(?:\s+for)?\s+today\b|\banything\s+(?:pending|waiting)\s+(?:for|on)\s+me(?:\s+today)?\b|\bwhat\s+needs\s+doing\s+today\b|\bwhat\s+is\s+pending\s+for\s+me\s+today\b/i;
const DRAFTS = /\b(?:automation\s+drafts?|drafts?\s+(?:to|for\s+me\s+to)\s+(?:confirm|check)|cover\s+suggestions?)\b/i;
const CONFIRM_DRAFT = /\b(?:confirm|accept|go\s+ahead\s+with)\s+(?:the\s+)?(?:automation\s+)?draft(?:\s+(?:no\.?|number|#)?\s*(\d{1,3}))?\b/i;
const DISMISS_DRAFT = /\b(?:dismiss|discard|ignore|skip)\s+(?:the\s+)?(?:automation\s+)?draft(?:\s+(?:no\.?|number|#)?\s*(\d{1,3}))?\b/i;
const SCHOOL_LIST = /\b(?:show|list|which|what)\b[^?]*\b(?:school\s+)?automations?\b|\bautomations?\s+(?:settings|status)\b/i;
const SWITCH_ON = /\b(?:turn|switch)\s+on\b|\benable\b|\bstart\b/i;
const SWITCH_OFF = /\b(?:turn|switch)\s+off\b|\bdisable\b|\bstop\b/i;

/** Words for each school automation, as people say them. */
const AUTOMATION_WORDS = [
  ['feeReminders', /\bfee\s+(?:due\s+)?reminders?\b|\bautomatic\s+fee\b/i],
  ['homeworkDueReminders', /\bhomework\s+(?:due\s+)?reminders?\b/i],
  ['libraryOverdueDaily', /\blibrary\s+(?:overdue\s+)?reminders?\b|\boverdue\s+book\s+reminders?\b/i],
  ['principalDailyBriefing', /\b(?:principal'?s?\s+|daily\s+|morning\s+)briefing\b/i],
  ['staffCoverSuggestions', /\bcover\s+suggestions?\b|\bautomatic\s+cover\b/i],
  ['lowStockPurchaseDrafts', /\blow[\s-]stock\b|\bpurchase\s+drafts?\b/i],
  ['admissionsFollowupReminder', /\b(?:admissions?\s+)?follow[\s-]?up\s+reminders?\b/i],
  ['healthVisitFollowups', /\bhealth\s+(?:visit\s+)?follow[\s-]?ups?\b/i],
  ['weeklyParentDigest', /\b(?:weekly\s+(?:parent\s+|child\s+)?digest|parent\s+digest|weekly\s+summary)\b/i],
  ['birthdayGreetings', /\bbirthday\s+(?:greetings?|wishes|messages?)\b/i],
  ['attendanceRegisterNudge', /\b(?:register|attendance)\s+(?:not\s+marked\s+)?(?:nudges?|reminders?)\b|\bunmarked\s+register\s+(?:nudges?|reminders?)\b/i],
];

const ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, last: -1 };

function lastTurns(history = []) {
  const turns = [...history];
  const assistant = [...turns].reverse().find((t) => t?.role === 'assistant')?.text ?? '';
  const idx = turns.map((t) => t?.role).lastIndexOf('assistant');
  const prevUser = idx > 0 ? [...turns.slice(0, idx)].reverse().find((t) => t?.role === 'user')?.text ?? '' : '';
  return { assistant: String(assistant), prevUser: String(prevUser) };
}

/**
 * One step (or a reply) for an automation request, or null when the message
 * is not one. `held` is the set of tool names the caller holds.
 */
export function automationTurn(message, actor, held = new Set(), history = []) {
  const text = String(message ?? '').trim();
  if (!text || !actor?.permissions) return null;
  const has = (name) => held.has(name);

  // The capabilities asked for in their own words ("create my reminder", "set school automation"):
  // the tool then asks for what is missing.
  if (has('create_my_reminder') && /^\s*(?:create|set\s+up|make)\s+(?:a\s+)?(?:my|personal)\s+reminders?\s*[.!?]*$/i.test(text)) return { step: { tool: 'create_my_reminder', args: {} } };
  if (has('set_school_automation') && /^\s*(?:set|change|update)\s+(?:a\s+|the\s+)?school\s+automations?\s*[.!?]*$/i.test(text)) return { step: { tool: 'set_school_automation', args: {} } };
  // A question about the opt-ins reads them; anything else about them is the change.
  if (has('get_my_automation_optins') && /\b(?:automation\s+)?opt[\s-]?ins?\b/i.test(text) && /^\s*(?:please\s+)?(?:(?:show|list|see|view|check|get)\b|what\b|which\b)/i.test(text)) return { step: { tool: 'get_my_automation_optins', args: {} } };
  if (has('set_my_automation_optin') && /\bautomation\s+opt[\s-]?ins?\b/i.test(text)) return { step: { tool: 'set_my_automation_optin', args: {} } };

  // The answer to "When should I remind you?" / "What should I remind you about?": read with the request it answers.
  const { assistant, prevUser } = lastTurns(history);
  if (has('create_my_reminder') && (ASKED_WHEN.test(assistant) || ASKED_WHAT.test(assistant)) && prevUser) {
    const joined = ASKED_WHEN.test(assistant) ? `${prevUser} ${text}` : `remind me ${text} ${prevUser.replace(/^\s*remind\s+me\s*/i, '')}`;
    const parsed = parsePersonalRequest(joined);
    if (parsed?.ask) return { reply: parsed.ask, needsInput: true };
    if (parsed) return { step: { tool: 'create_my_reminder', args: parsed } };
  }

  if (has('get_what_needs_me_today') && NEEDS_ME.test(text)) return { step: { tool: 'get_what_needs_me_today', args: {} } };

  if (has('list_my_reminders') && LIST_MINE.test(text)) return { step: { tool: 'list_my_reminders', args: {} } };

  if (has('stop_my_reminder') && STOP_MINE.test(text) && !/\b(?:fee|library|overdue)\s+reminders\b/i.test(text)) {
    const all = /\b(?:all|every)\b[^?]*\b(?:my\s+)?(?:reminders|reports)\b/i.test(text);
    const num = /\b(?:reminder|report)\s*(?:no\.?|number|#)?\s*(\d{1,2})\b|#(\d{1,2})\b/i.exec(text);
    const ord = /\b(first|second|third|fourth|fifth)\b/i.exec(text);
    const args = all ? { all: true } : num ? { number: Number(num[1] ?? num[2]) } : ord ? { number: ORDINALS[ord[1].toLowerCase()] } : { match: text.slice(0, 200) };
    return { step: { tool: 'stop_my_reminder', args } };
  }

  // A parent asking for the weekly summary is opting in to the school's digest, not setting a reminder.
  if (actor.roleKey === 'PARENT' && has('set_my_automation_optin') && /\b(?:send|give)\s+me\s+(?:a\s+|the\s+)?weekly\s+(?:summary|digest|update|report)\b/i.test(text)) {
    return { step: { tool: 'set_my_automation_optin', args: { key: 'weeklyParentDigest', enabled: true } } };
  }

  if (has('create_my_reminder')) {
    const parsed = parsePersonalRequest(text);
    if (parsed?.ask) return { reply: parsed.ask, needsInput: true };
    if (parsed) return { step: { tool: 'create_my_reminder', args: parsed } };
  }

  const confirm = CONFIRM_DRAFT.exec(text);
  if (confirm && has('confirm_automation_draft')) return { step: { tool: 'confirm_automation_draft', args: confirm[1] ? { number: Number(confirm[1]) } : {} } };
  const dismiss = DISMISS_DRAFT.exec(text);
  if (dismiss && has('dismiss_automation_draft')) return { step: { tool: 'dismiss_automation_draft', args: dismiss[1] ? { number: Number(dismiss[1]) } : {} } };
  if (DRAFTS.test(text) && has('list_automation_drafts') && !/\bsuggest\s+cover\b/i.test(text)) return { step: { tool: 'list_automation_drafts', args: {} } };

  // A named automation switched on or off, its hour changed, or previewed.
  const named = AUTOMATION_WORDS.find(([, re]) => re.test(text))?.[0] ?? null;
  const on = SWITCH_ON.test(text);
  const off = !on && SWITCH_OFF.test(text);
  if (named && ['weeklyParentDigest', 'birthdayGreetings'].includes(named) && ['PARENT', 'STUDENT'].includes(actor.roleKey) && has('set_my_automation_optin') && (on || off || /\bsend\s+me\b/i.test(text))) {
    return { step: { tool: 'set_my_automation_optin', args: { key: named, enabled: !off } } };
  }
  if (actor.roleKey === 'PARENT' && has('set_my_automation_optin') && /\b(?:send|give)\s+me\s+(?:a\s+)?weekly\s+(?:summary|digest|update)\b/i.test(text)) {
    return { step: { tool: 'set_my_automation_optin', args: { key: 'weeklyParentDigest', enabled: true } } };
  }
  // "Run the fee reminders now": the page's "Run now" (a draft, confirmed on the website).
  if (has('run_school_automation_now') && /\brun\b/i.test(text) && /\b(?:now|right\s+away|immediately)\b/i.test(text)
    && (named || /^\s*run\s+(?:a\s+|the\s+)?school\s+automations?\s+now\s*[.!?]*$/i.test(text))) {
    return { step: { tool: 'run_school_automation_now', args: named ? { key: named } : {} } };
  }
  if (named && has('set_school_automation')) {
    const hour = /\bat\s+(\d{1,2})(?:[:.]00)?\s*(am|pm)?\b/i.exec(text);
    const args = { key: named };
    if (on) args.enabled = true;
    if (off) args.enabled = false;
    if (hour) { let h = Number(hour[1]); if (hour[2]?.toLowerCase() === 'pm' && h < 12) h += 12; if (!hour[2] && h >= 1 && h <= 6) h += 12; args.hour = h; }
    // "run the parent digest on Saturdays": the weekday of a weekly one (0 Sunday ... 6 Saturday).
    const day = /\bon\s+(sun|mon|tue|wed|thu|fri|sat)[a-z]*?(?:day)?s?\b/i.exec(text);
    if (day) args.weekday = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(day[1].toLowerCase());
    if (Object.keys(args).length > 1) return { step: { tool: 'set_school_automation', args } };
    if (/\b(?:preview|sample|what\s+does|show)\b/i.test(text) && has('list_school_automations')) return { step: { tool: 'list_school_automations', args: { key: named } } };
  }
  if (SCHOOL_LIST.test(text) && has('list_school_automations') && !/\bmy\s+automations\b/i.test(text)) return { step: { tool: 'list_school_automations', args: {} } };
  return null;
}

/**
 * The same reading for the rule parser (intent.js chooseStep): a plan step on
 * a p7 tool this actor holds, or null. No history here; the conversation-level
 * turn above also finishes a reminder from the answer to "When?".
 */
export function automationStep(message, actor) {
  if (!actor?.permissions?.['ai.copilot.use']) return null;
  const held = new Set(mcpToolsFor(actor).map((tool) => tool.name));
  return automationTurn(message, actor, held)?.step ?? null;
}

/* ── Suggested next steps ──────────────────────────────────────────────── */

const STEPS = {
  who_is_absent_today: [
    { label: 'Message their parents', ask: 'message their parents', needs: 'send_conversation_message' },
    { label: 'Students with low attendance', ask: 'students with low attendance', needs: 'get_low_attendance_students' },
    { label: 'Registers not marked', ask: 'which registers are not marked today', needs: 'get_school_attendance_overview' },
    { label: 'Send me this every morning', ask: 'every morning send me the list of absent students', needs: 'create_my_reminder' },
  ],
  get_absent_students: null, // filled below: the same steps as who_is_absent_today
  get_attendance: [
    { label: 'Who is absent today?', ask: 'who is absent today', needs: 'who_is_absent_today' },
    { label: 'Students with low attendance', ask: 'students with low attendance', needs: 'get_low_attendance_students' },
  ],
  get_low_attendance_students: [
    { label: 'Message their parents', ask: 'message their parents', needs: 'send_conversation_message' },
  ],
  get_overdue_books: [
    { label: 'Send reminders', ask: 'send reminders', needs: 'send_library_overdue_reminders' },
    { label: 'Send me this every morning', ask: 'every morning send me the overdue library books', needs: 'create_my_reminder' },
  ],
  list_overdue_loans: [
    { label: 'Send reminders', ask: 'send reminders', needs: 'send_library_overdue_reminders' },
  ],
  get_pending_fees: [
    { label: 'Send fee reminders', ask: 'send reminders', needs: 'send_fee_reminders' },
    { label: 'Overdue fees every Monday', ask: 'every Monday at 9 am send me the overdue fees', needs: 'create_my_reminder' },
  ],
  list_staff_leave: [
    { label: 'Cover needed today', ask: 'show cover needs for today', needs: 'get_cover_needs' },
    { label: 'Absent staff every morning', ask: 'every morning send me the list of absent staff', needs: 'create_my_reminder' },
  ],
  get_cover_needs: [
    { label: 'Show cover suggestions', ask: 'show my automation drafts', needs: 'list_automation_drafts' },
    { label: 'Absent staff every morning', ask: 'every morning send me the list of absent staff', needs: 'create_my_reminder' },
  ],
  get_my_day: [
    { label: 'What needs me today', ask: 'what needs me today', needs: 'get_what_needs_me_today' },
    { label: 'Pending approvals', ask: 'what is waiting on me to approve', needs: 'get_pending_items_for_me' },
  ],
  get_what_needs_me_today: [
    { label: 'My tasks', ask: 'show my tasks', needs: 'list_due_items' },
    { label: 'My reminders', ask: 'show my reminders', needs: 'list_my_reminders' },
    { label: 'Send me this every morning', ask: 'every morning at 8 send me my daily briefing', needs: 'create_my_reminder' },
  ],
  get_pending_items_for_me: [
    { label: 'Every morning', ask: 'every morning send me the pending approvals', needs: 'create_my_reminder' },
  ],
  list_pending_approvals: [
    { label: 'Every morning', ask: 'every morning send me the pending approvals', needs: 'create_my_reminder' },
  ],
  get_assignments: [
    { label: 'Remind me tomorrow evening', ask: 'remind me tomorrow at 6 pm to finish my homework', needs: 'create_my_reminder' },
  ],
  get_timetable: [
    { label: 'Weekly lesson-plan reminder', ask: 'remind me every Friday at 4 pm to submit lesson plans', needs: 'create_my_reminder', roles: ['TEACHER'] },
  ],
  list_my_reminders: [
    { label: 'Stop reminder 1', ask: 'stop reminder 1', needs: 'stop_my_reminder' },
    { label: 'What needs me today', ask: 'what needs me today', needs: 'get_what_needs_me_today' },
  ],
  create_my_reminder: [
    { label: 'Show my reminders', ask: 'show my reminders', needs: 'list_my_reminders' },
  ],
  list_school_automations: [
    { label: 'Show automation drafts', ask: 'show my automation drafts', needs: 'list_automation_drafts' },
  ],
  get_family_today: [
    { label: 'Weekly summary', ask: 'send me a weekly summary of my children', needs: 'set_my_automation_optin', roles: ['PARENT'] },
  ],
};

STEPS.get_absent_students = STEPS.who_is_absent_today;
STEPS.get_class_absentees = STEPS.who_is_absent_today;

/**
 * The answer with up to three `nextSteps` chips, or unchanged. Only after an
 * answer that came back with data (or a confirmed write): never on a refusal,
 * a question back, or a draft still waiting for "yes".
 */
export function withNextSteps(result, actor, heldNames = []) {
  if (!result || result.action || result.refused || result.needsInput || result.clarification || result.flagged || result.degraded) return result;
  const tool = result.tool ?? result.tools?.[0];
  const options = STEPS[tool];
  if (!options) return result;
  const held = new Set(heldNames);
  const steps = options
    .filter((o) => held.has(o.needs) && (!o.roles || o.roles.includes(actor?.roleKey)))
    // "Message their parents" only means something when the answer named students.
    .filter((o) => o.ask !== 'message their parents' || hasStudents(result.data))
    .slice(0, 3)
    .map(({ label, ask }) => ({ label, ask }));
  return steps.length ? { ...result, nextSteps: steps } : result;
}

function hasStudents(data) {
  if (!data || typeof data !== 'object') return false;
  const lists = [data.students, data.absent, data.absentees, data.rows, data.items].filter(Array.isArray);
  return lists.some((l) => l.length > 0);
}
