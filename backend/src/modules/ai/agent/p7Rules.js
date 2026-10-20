import { nameFromText } from '../../../utils/peopleNames.js';
import { classFromText } from '../../../utils/classNames.js';

/**
 * Part 7 routing rules, spread into intent.js RULES (one line there). Same
 * shape as every rule in that file: patterns, exclude, requires (the
 * permission the capability needs, so a role without it falls through to what
 * it CAN read), weight, `decisive` (consulted before the catalogue scorer), and
 * args. They choose; the MCP server still authorizes and scopes every call.
 */

const NOT_A_NAME = /^(?:my|our|his|her|their|the|this|that|child|son|daughter|kid|ward|class|today|student)$/i;

/** The student a sentence names, however it names them, or null. */
export function studentNamedIn(msg) {
  const text = String(msg ?? '');
  const how = /\bhow\s+(?:is|has|are)\s+([\p{L}][\p{L}'-]*(?:\s+[\p{Lu}][\p{L}'-]*)?)\s+(?:doing|performing|progressing|been\s+performing)\b/iu.exec(text)?.[1];
  const which = /\b(?:which|what)\s+class\s+(?:is|does)\s+([\p{L}][\p{L}'-]*(?:\s+[\p{Lu}][\p{L}'-]*)?)\s+(?:in|study|studies|belong)/iu.exec(text)?.[1];
  const named = how ?? which ?? nameFromText(text);
  if (!named) return null;
  const clean = String(named).replace(/['’]s$/i, '').trim();
  if (!clean || clean.split(/\s+/).every((w) => NOT_A_NAME.test(w))) return null;
  if (/\b(?:performance|score|class|teacher|marks?)\b/i.test(clean)) return null;
  return clean;
}

const withStudent = (msg) => {
  const name = studentNamedIn(msg);
  return name ? { studentName: name } : {};
};

const spokenClass = (msg) => {
  const c = classFromText(msg, { lenient: true });
  return c && !c.gradeOnly ? (c.lenient ? `Class ${c.key.toUpperCase()}` : c.text) : null;
};

export const P7_RULES = [
  {
    // "Rahul's performance", "his performance score", "how is Riya performing".
    // Never the class sheet ("performance of Class 6 A"), the trend across
    // years ("performance history") or a write.
    tool: 'get_student_performance',
    patterns: [
      /\bperformance\s+(?:score|index|rating|band|grade)\b/i,
      /\b(?:overall\s+)?performance\b/i,
      /\bhow\s+(?:is|are|has)\s+\S+(?:\s+\S+)?\s+(?:performing|been\s+performing|progressing)\b/i,
      /\bprogress\s+score\b/i,
    ],
    exclude: [
      /\bperformance\s+(?:history|trend|over\s+(?:time|the\s+years))\b/i,
      /\b(?:class|section|school|subject|teacher|staff)(?:'s)?\s+performance\b/i,
      /\bperformance\s+(?:of|in|for)\s+(?:the\s+)?(?:class|section|school|grade)\b/i,
      /\bperformance\s+(?:of|in|for)\s+\d{1,2}\s*-?\s*[a-z]\b/i,
      /\b(?:mark|record|enter|update|create|add|send|message|appraisal)\b/i,
      // Not a student's: an ad campaign's, a post's, a bus's, a vendor's, the system's.
      /\b(?:ads?|campaigns?|marketing|social|posts?|website|newsletter|bus|buses|fleet|vendors?|server|system|staff|employees?|appraisals?)\b/i,
    ],
    requires: { permission: 'marks.read' },
    weight: 6,
    decisive: true,
    args: withStudent,
  },
  {
    // "Who is Rahul's class teacher?", "which class is Riya in?", "her class?".
    tool: 'get_enrolment_details',
    patterns: [
      /\b(?:who\s+is|who's|whos|name\s+of|tell\s+me)\s+(?:the\s+)?(?:(?:my|his|her|their)\s+(?:child'?s?\s+|son'?s?\s+|daughter'?s?\s+)?|[\p{L}]+(?:\s+[\p{L}]+)?['’]s\s+)class\s+teacher\b/iu,
      /\bclass\s+teacher\s+(?:of|for)\s+(?!class\b)(?!\d)[\p{L}]+/iu,
      /\b(?:which|what)\s+class\s+(?:is|does)\s+(?!(?:the|this|that|it)\b)[\p{L}]+(?:\s+[\p{L}]+)?\s+(?:in|study|studies)\b/iu,
      /^\s*(?:and\s+)?(?:(?:please\s+)?(?:show(?:\s+me)?|tell\s+me|give\s+me|what\s+is|what's)\s+)?(?:his|her|their|[\p{L}]+(?:\s+[\p{L}]+)?['’]s)\s+(?:class|section|class\s+teacher)\s*[?.!]*\s*$/iu,
    ],
    exclude: [/\b(?:make|assign|change|set|update|appoint|replace)\b/i, /\bclass\s+teachers\b/i, /\b(?:my|our)\s+class\s+teacher\b(?![^?]*\b(?:child|son|daughter)\b)/i],
    requires: { permission: 'students.read' },
    weight: 7,
    decisive: true,
    args: (msg) => (spokenClass(msg) ? {} : withStudent(msg)),
  },
  {
    // A parent's "who is the class teacher?": their child's class teacher (asked
    // which child when there are two) -- never the parent's own "classes".
    tool: 'get_enrolment_details',
    patterns: [/\b(?:who\s+is|who's|whos|name\s+of)\s+(?:the\s+)?class\s+teacher\b/i, /^\s*(?:and\s+)?(?:the\s+)?class\s+teacher\s*[?.!]*\s*$/i],
    exclude: [/\b(?:make|assign|change|set|update|appoint|replace)\b/i, /\bclass\s+teachers\b/i, /\bclass\s+teacher\s+of\s+(?:class\s+)?\d/i],
    requires: { permission: 'students.read', roles: ['PARENT'] },
    weight: 7,
    decisive: true,
    args: withStudent,
  },
  {
    // "How many staff are there?" -- staff accounts only, never every user.
    tool: 'count_staff',
    patterns: [
      /\bhow\s+many\s+(?:staff|employees|staff\s+members|people\s+work|members\s+of\s+staff)\b/i,
      /\b(?:staff|employee|teaching\s+and\s+non-teaching)\s+(?:count|strength|headcount|numbers?)\b/i,
      /\b(?:number|count|total)\s+of\s+(?:staff|employees|staff\s+members)\b/i,
      /\btotal\s+staff\b|\bheadcount\b/i,
    ],
    exclude: [/\b(?:leave|absent|present|attendance|salary|payroll|cpd)\b/i],
    requires: { permission: 'users.read', scope: 'ALL' },
    weight: 7,
    decisive: true,
    args: () => ({}),
  },
  {
    // "Who scored the highest in Class 6 A?", "topper of 10 A": the class marks
    // sheet with the names said (scorers). Staff only -- a family is told the
    // policy before anything routes (agent/p7FollowUps.js).
    tool: 'get_class_marks',
    patterns: [
      /\b(?:who|which\s+students?)\s+(?:scored|got|has|had|secured|obtained)\s+(?:the\s+)?(?:highest|most|top|best|maximum|max)\b/i,
      /\b(?:highest|top|best)\s+(?:\p{L}+\s+)?(?:scorers?|scoring\s+students?)\b/iu,
      /\btoppers?\b|\bwho\s+topped\b/i,
    ],
    exclude: [/\b(?:my|mine|our)\b/i, /\b(?:enter|update|publish|mark)\b/i, /\blowest\b/i],
    requires: { permission: 'marks.read', roles: ['TEACHER', 'PRINCIPAL', 'ADMIN', 'SUPER_ADMIN'] },
    weight: 7,
    decisive: true,
    args: (msg) => {
      const cls = spokenClass(msg);
      // The subject, when one is said, is filled by the schema reader as for any class-marks question.
      return { ...(cls && { className: cls }), scorers: true };
    },
  },
];
