import { classFromText } from '../../../utils/classNames.js';
import { routingText } from './intent.js';
import { getMcpTool } from '../mcp/registry.js';

/**
 * Follow-ups the p6 harness left open (p7), read against the conversation's
 * structured memory (agent/memory.js) -- never against the assistant's prose:
 *
 *   "Who scored the highest?" after a class's marks   -> that class's top scorers (staff);
 *                                                        students and families get the policy
 *   "Show its students" after a class ranking         -> the class the ranking put first
 *   "what about that class's attendance?"             -> the class the last answer was about
 *
 * Each only REWRITES the sentence with the class the conversation is about,
 * then the ordinary readers route it, and the MCP server authorizes and
 * scopes the call for the person asking now -- a class remembered from an
 * earlier turn reaches nothing a typed class name could not.
 */

const TOP_SCORER = /\bwho\s+(?:scored|got|has|had|secured|obtained)\s+(?:the\s+)?(?:highest|most|top|best|maximum|max)\b|\b(?:highest|top|best)\s+(?:scorers?|scoring|marks)\b|\btoppers?\b|\bwho\s+topped\b|\bsabse\s+(?:zyada|jyada)\s+(?:marks|number)\b/i;
/** "its", "that class", "this class", "the same class", "the first one" (a class just ranked). */
const CLASS_NOUNS = /\b(?:students|pupils|attendance|marks|results|timetable|class\s+teacher|strength|homework|assignments|average|absent|toppers?)\b/i;
const POINTS_AT_CLASS = /\b(?:its|that\s+class(?:'s)?|this\s+class(?:'s)?|the\s+same\s+class(?:'s)?|that\s+section(?:'s)?|the\s+(?:lowest|highest|top|bottom|first)\s+(?:one|class)(?:'s)?)\b/i;
const FAMILY = new Set(['STUDENT', 'PARENT', 'ALUMNUS']);

/** The class the conversation is about, from the last read's arguments or the classes its answer listed. */
function classInContext(context = {}, history = []) {
  const named = context?.lastRead?.args?.className;
  if (named) return String(named);
  if (Array.isArray(context?.classes) && context.classes.length) return context.classes[0];
  // No stored context (a conversation the memory does not hold): the class the
  // person's own most recent message named, never the assistant's prose.
  for (const turn of [...(history ?? [])].reverse()) {
    if (turn?.role !== 'user') continue;
    const spoken = classFromText(routingText(String(turn.text ?? '')));
    if (spoken && !spoken.gradeOnly) return spoken.text;
  }
  return null;
}

/**
 * `{ reply }` (a policy answer), `{ message }` (the sentence with its class
 * filled in), or null when the message is not one of these follow-ups.
 */
export function classFollowUp(message, { actor, context = {}, history = [] } = {}) {
  const text = routingText(String(message ?? ''));
  const role = actor?.roleKey;

  if (TOP_SCORER.test(text) && !/\b(?:my|mine)\b/i.test(text.replace(/\bmy\s+class\b/i, ''))) {
    if (FAMILY.has(role)) {
      return {
        reply: "Other students' marks and who scored the highest aren't shown to "
          + `${role === 'PARENT' ? 'parents' : 'students'} — that is the school's policy, so I haven't looked anyone else up. `
          + `${role === 'PARENT' ? 'Ask for your child\'s results or performance score' : 'Ask "show my results" or "my performance score"'} to see ${role === 'PARENT' ? 'how your child is doing' : 'how you are doing'}.`,
        refused: 'NOT_SHOWN',
      };
    }
    if (classFromText(text)) return null;
    const cls = classInContext(context, history);
    if (!cls) return null;
    const subject = context?.lastRead?.args?.subject;
    const exam = context?.lastRead?.args?.exam;
    return { message: `who scored the highest in ${cls}${subject ? ` in ${subject}` : ''}${exam ? ` in ${exam}` : ''}` };
  }

  // Only after a CLASS-level answer, and about something a class has.
  const lastTool = getMcpTool(context?.lastRead?.tool ?? '');
  const classLevel = Boolean(context?.lastRead?.args?.className || lastTool?.requiresClass);
  if (classLevel && CLASS_NOUNS.test(text) && POINTS_AT_CLASS.test(text) && !classFromText(text.replace(POINTS_AT_CLASS, ''))) {
    const cls = classInContext(context);
    if (!cls) return null;
    // "Show its students" -> "Show the students of Class 10 B"; "its attendance" -> "Class 10 B attendance".
    const rewritten = text
      .replace(/\b(?:its|that\s+class's|this\s+class's|the\s+same\s+class's|that\s+section's|the\s+(?:lowest|highest|top|bottom|first)\s+(?:one|class)'s)\s+students\b/i, `students of ${cls}`)
      .replace(POINTS_AT_CLASS, (m) => (/'s$|^its$/i.test(m) ? `${cls}'s` : cls));
    return rewritten === text ? null : { message: rewritten };
  }
  return null;
}
