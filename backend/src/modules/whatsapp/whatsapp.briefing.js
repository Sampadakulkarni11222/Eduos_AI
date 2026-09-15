import { withMcpSession, callTool as callMcpTool } from '../ai/mcp/client.js';
import { getMcpTool } from '../ai/mcp/registry.js';
import { speakOf } from '../ai/agent/response.js';
import { t } from '../../utils/language.js';
import { logger } from '../../utils/logger.js';

/**
 * The opening briefing: what the assistant says the moment a user arrives from
 * the app, before they have asked anything.
 *
 * The hand-off used to work the other way round -- the deep link prefilled a
 * message in which the *user* introduced themselves ("I am Diya Sharma,
 * Student ID ADM-2026-0001, I need assistance") and sent it to the bot. That
 * was backwards on both counts. It made the person do the identifying, when
 * their number already identifies them; and it made a form out of what should
 * be a conversation, so the first thing they did on WhatsApp was recite
 * details the school already holds.
 *
 * Now the link carries a bare "Hi" and this module answers it: the records are
 * fetched here, on arrival, and the reply already contains that user's own
 * standing -- so the next thing they type can be an actual question. What
 * "their standing" means follows their permissions rather than their job
 * title: fees and homework for a family, today's register and their own
 * periods for staff.
 *
 * SECURITY -- nothing here is a new data path. Every line comes from a tool in
 * the shared catalogue, each one gated by checkAuthorization() against the
 * permissions of the profile the phone number resolved to, and run inside that
 * profile's school scope (the caller wraps this in runInActorScope). A briefing
 * therefore shows exactly what the same person would get by asking for each
 * item by hand, and nothing a role is not entitled to.
 */

/**
 * Openers that mean "I'm here", not "answer this".
 *
 * A greeting handed to the intent parser produces "I'm not sure what you
 * need", which is a poor first impression from an assistant that could simply
 * have said what it knows. The old prefill's wording is matched too, because
 * links already sent out will keep arriving for a while.
 */
const OPENER =
  /^(?:hi+|hey+|hello+|hlo|yo|start|menu|help|greetings|good\s*(?:morning|afternoon|evening|day)|namaste|namaskar|नमस्ते|नमस्कार|हाय|हॅलो|हैलो|नमस्कारम्)[\s!.,?]*$/i;

/** The old deep-link prefill, and the "I need assistance" phrasings like it. */
const SELF_INTRODUCTION = /\b(?:i (?:need|want|require) (?:some )?(?:assistance|help)|मुझे (?:सहायता|मदद) चाहिए)\b/i;

export function isOpeningMessage(text) {
  const message = String(text ?? '').trim();
  if (!message) return false;
  if (OPENER.test(message)) return true;
  // The prefilled introduction: a greeting, an identity the bot never needed,
  // and a request for help with nothing specific in it.
  return message.length <= 200 && SELF_INTRODUCTION.test(message) && !/\?/.test(message);
}

/**
 * The reads a briefing draws from, most useful first.
 *
 * Ordered rather than exhaustive: a WhatsApp message that scrolls is a message
 * nobody reads, so the list is filtered to what this actor may see and then
 * cut to BRIEFING_LINES.
 *
 * One list serves everyone because permission does the sorting. A student's
 * `attendance.read` is OWN, so get_attendance answers with their own record and
 * who_is_absent_today (minScope ALL) is refused and dropped; a principal's is
 * ALL, so the same two lines come back as the school's register. A teacher gets
 * their own classes, their periods and the notices addressed to them. Nobody
 * needs a per-role list, and nobody has to remember to update one when a role's
 * grants change.
 */
const BRIEFING_TOOLS = [
  'get_attendance',
  'who_is_absent_today',
  'get_fees',
  'get_assignments',
  'get_timetable',
  'get_announcements',
  // Held by few roles, and the whole briefing for those who do hold them: a
  // warden's or librarian's opening line should be their own domain, not the
  // three empty family reads above it.
  'get_hostel_summary',
  'get_library_summary',
  'get_overdue_books',
];

const BRIEFING_LINES = 4;

/**
 * Keys that mean "there is nothing to report".
 *
 * "You have no homework due" is worth saying; "there are no announcements" is
 * filler that pushes the useful lines out of view. Empty results are dropped
 * so the briefing is made of facts, not of absences.
 */
const EMPTY_RESULT = /\.(?:none|empty)$/;

/**
 * Runs one briefing tool, returning null instead of throwing.
 *
 * A briefing is a courtesy: if fees are unreachable the user should still be
 * told their attendance and be able to ask a question, so every failure here
 * -- forbidden, missing record, service down -- costs one line and nothing
 * else.
 */
async function lineFor(mcpSession, name, lang) {
  const tool = getMcpTool(name);
  // A briefing is unasked-for, so it may only ever read. Even if this list
  // grew a write by accident, it would be dropped here rather than performed
  // on somebody who said nothing but "Hi".
  if (!tool || tool.operation !== 'GET') return null;

  try {
    // Through MCP like every other tool call, so the permission check, the
    // school scope and the audit entry are the same ones an ordinary question
    // gets. Nothing here is a second data path.
    const result = await callMcpTool(mcpSession, name, {});
    if (!result?.success) {
      // For most actors most of this list is legitimately forbidden, and
      // logging that at warning level would bury real faults.
      logger.debug?.(`Briefing skipped ${name}: ${result?.error?.code}`);
      return null;
    }
    if (EMPTY_RESULT.test(result?.speakKey ?? '')) return null;

    const text = speakOf(result, lang).trim();
    return text ? { tool: name, text } : null;
  } catch (err) {
    logger.debug?.(`Briefing skipped ${name}: ${err.message}`);
    return null;
  }
}

/** Example questions to close on, chosen for what this role can actually ask. */
function examplesFor(roleKey, lang) {
  const key =
    roleKey === 'PARENT'
      ? 'whatsapp.examples.parent'
      : roleKey === 'STUDENT'
        ? 'whatsapp.examples.student'
        : 'whatsapp.examples.staff';
  return t(key, lang);
}

/**
 * Builds the arrival message for an already-resolved actor.
 *
 * Must be called inside the actor's school scope (runInActorScope), exactly as
 * an ordinary turn is -- the tools below read school-owned collections and an
 * unscoped read would cross schools.
 */
export async function buildBriefing({ actor, lang = 'en' }) {
  // Pre-filtered on the permission so the obviously-forbidden reads are not
  // attempted at all. The MCP server checks again on each call — this only
  // saves nine refusals per greeting, it does not decide anything.
  const available = BRIEFING_TOOLS.filter((name) => {
    const tool = getMcpTool(name);
    return tool && actor?.permissions?.[tool.permission];
  });

  // One session for the whole briefing, closed when it is built. Fetched
  // together: a sequential round trip per tool is a visibly slow first reply,
  // and no line depends on another.
  const settled = await withMcpSession({ actor, channel: 'WHATSAPP' }, (mcpSession) =>
    Promise.all(available.map((name) => lineFor(mcpSession, name, lang))));

  // Deduplicated on the rendered sentence, not the tool name. For an ALL-scoped
  // caller get_attendance and who_is_absent_today are deliberately the same
  // read -- "attendance" and "who is absent" being the same question when you
  // can see the whole school -- and printing that sentence twice reads as a
  // bug.
  const seen = new Set();
  const lines = [];
  for (const line of settled) {
    if (!line || seen.has(line.text)) continue;
    seen.add(line.text);
    lines.push(line);
    if (lines.length === BRIEFING_LINES) break;
  }

  const name = String(actor?.displayName ?? '').split(/\s+/)[0] || null;
  const school = actor?.tenantName ?? null;

  const header = t(
    school ? 'whatsapp.welcome' : 'whatsapp.welcome.noSchool',
    lang,
    { name: name ?? '', school: school ?? '' }
  );

  const body = lines.length
    ? `\n\n${lines.map((line) => `• ${line.text}`).join('\n')}`
    : `\n\n${t('whatsapp.welcome.noRecords', lang)}`;

  const invite = `\n\n${t('whatsapp.welcome.ask', lang, { examples: examplesFor(actor?.roleKey, lang) })}`;

  return {
    reply: `${header}${body}${invite}`,
    tools: lines.map((line) => line.tool),
  };
}
