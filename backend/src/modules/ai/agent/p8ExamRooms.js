import { mcpToolsFor } from '../mcp/registry.js';

/**
 * Part 8: the sentences about exam halls and class rooms whose grammar
 * settles their meaning, read into a tool and its arguments before the
 * general scorers (which weigh nouns, and would read "move 7B to the science
 * lab" as a lab question):
 *
 *   "where is the class 10 maths exam?"                     get_exam_hall
 *   "my invigilation duties"                                list_my_invigilation_duties
 *   "show my exam timetable" (family / staff)               get_my_exam_timetable / list_exam_timetable
 *   "which room is 7B in today?"                            get_section_room
 *   "move 7B to the science lab for period 3 tomorrow because of painting"   create_room_shift
 *   "assign room 204 to 8A"                                 assign_home_room
 *   "change the exam hall for class 9 science to the auditorium"             change_exam_hall
 *   "delay the class 10 maths exam by 30 minutes"           update_exam_hall_status
 *   "free rooms for 7B period 3 tomorrow"                   list_free_rooms
 *
 * Only ever a tool the caller holds; arguments are words from the sentence,
 * checked again by the tool (dates and rooms are resolved there).
 */

const FAMILY = new Set(['PARENT', 'STUDENT']);
const CLASS = String.raw`(?:class\s+|grade\s+)?(\d{1,2}\s*-?\s*[a-z])\b`;
const GRADE_OR_CLASS = String.raw`(?:class\s+|grade\s+)?(\d{1,2}(?:\s*-?\s*[a-z]\b)?)`;
const WHEN_RE = /\b(today|tomorrow|day after tomorrow|now|(?:next\s+)?(?:mon|tues|wednes|thurs|fri|satur|sun)day|\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)\b/i;

const tidyClass = (c) => String(c ?? '').replace(/\s+|-/g, '').toUpperCase();
const whenIn = (t) => WHEN_RE.exec(t)?.[1] ?? null;
const periodsIn = (t) => {
  const m = /\b(?:periods?|p)\s*(\d{1,2}(?:\s*(?:,|and|&)\s*\d{1,2})*)\b/i.exec(t);
  return m ? [...new Set(m[1].split(/\s*(?:,|and|&)\s*/).map(Number).filter((n) => n >= 1 && n <= 20))] : null;
};
const reasonIn = (t) => /\b(?:because(?:\s+of)?|due\s+to|reason[:\s]+|as\s+there\s+is)\s+(.+?)\s*[.?!]*$/i.exec(t)?.[1]?.replace(/^(?:the|a|an)\s+/i, '') ?? null;
const clean = (room) => String(room ?? '').replace(/^(?:the|room)\s+/i, (m) => (/room/i.test(m) ? 'room ' : '')).trim();

/** Room words after " to ", up to the first clause that is not part of a room name. */
function roomAfterTo(t) {
  const m = /\bto\s+(.+)$/i.exec(t);
  if (!m) return null;
  const stop = /\s+(?:for\s+(?:the\s+)?(?:periods?|p\d|the\s+whole|all\s+day|today|tomorrow)|for\s+periods?|periods?\s+\d|today|tomorrow|day after|on\s+|from\s+|this\s+|next\s+|because|due\s+to|permanently|for\s+good|till|until)\b/i;
  const cut = m[1].split(stop)[0];
  return clean(cut.replace(/[.?!]+$/, '').trim()) || null;
}

/** The step for a sentence, or null. */
export function examRoomStep(message, actor) {
  if (!actor?.permissions?.['ai.copilot.use']) return null;
  const t = String(message ?? '').trim();
  if (!t || t.length > 300) return null;
  const held = new Set(mcpToolsFor(actor).map((x) => x.name));
  const has = (name) => held.has(name);
  let m;

  // Change the exam hall / move a paper to another room.
  m = new RegExp(String.raw`\b(?:change|move|shift|switch)\s+(?:the\s+)?(?:exam(?:ination)?\s+(?:hall|room|venue)\s+(?:for|of)\s+(?:the\s+)?${GRADE_OR_CLASS}\s+([a-z]+)(?:\s+(?:exam|paper|test))?|${GRADE_OR_CLASS}\s+([a-z]+)\s+(?:exam|paper)(?:\s+hall)?)\s+to\s+`, 'i').exec(t);
  if (m && has('change_exam_hall')) {
    const args = { className: tidyClass(m[1] ?? m[3]), subject: (m[2] ?? m[4]).toLowerCase(), toRoom: roomAfterTo(t.slice(m.index + m[0].search(/\bto\s+$/i))) };
    const reason = reasonIn(t); if (reason) args.reason = reason;
    const when = whenIn(t); if (when) args.date = when;
    if (args.toRoom) return { tool: 'change_exam_hall', args };
  }

  // Delay / postpone / cancel a paper.
  m = new RegExp(String.raw`\b(delay|postpone|cancel|start|finish)\s+(?:the\s+)?${GRADE_OR_CLASS}\s+([a-z]+)\s+(?:exam|paper)\b`, 'i').exec(t);
  if (m && has('update_exam_hall_status')) {
    const change = { delay: 'DELAY', postpone: 'POSTPONE', cancel: 'CANCEL', start: 'START', finish: 'FINISH' }[m[1].toLowerCase()];
    const args = { change, className: tidyClass(m[2]), subject: m[3].toLowerCase() };
    const mins = /\bby\s+(\d{1,3})\s*(?:min|minutes?|mins?)\b/i.exec(t) ?? /\b(\d{1,3})\s*(?:min|minutes?|mins?)\b/i.exec(t);
    if (mins) args.delayMinutes = Number(mins[1]);
    const hours = /\bby\s+(?:an?\s+|one\s+)hour\b/i.test(t);
    if (hours && !mins) args.delayMinutes = 60;
    const reason = reasonIn(t); if (reason) args.reason = reason;
    const to = /\bto\s+(today|tomorrow|day after tomorrow|(?:next\s+)?(?:mon|tues|wednes|thurs|fri|satur|sun)day|\d{4}-\d{2}-\d{2})\b/i.exec(t);
    if (to && change === 'POSTPONE') args.newDate = to[1];
    return { tool: 'update_exam_hall_status', args };
  }

  // Where is a paper.
  m = new RegExp(String.raw`\b(?:where\s+(?:is|are|will)|which\s+(?:room|hall)\s+(?:is|for)|exam\s+hall\s+for)\s+(?:the\s+|my\s+|our\s+)?(?:${GRADE_OR_CLASS}\s+)?([a-z]+)\s+(?:exam|paper|test)s?\b`, 'i').exec(t);
  if (m && (has('get_exam_hall'))) {
    const args = { subject: m[2].toLowerCase() };
    if (m[1]) args.className = tidyClass(m[1]);
    const when = whenIn(t); if (when && when.toLowerCase() !== 'now') args.date = when;
    return { tool: 'get_exam_hall', args };
  }

  // Own invigilation duties.
  if (/\binvigilat\w*|\bmy\s+exam\s+dut(?:y|ies)\b/i.test(t) && has('list_my_invigilation_duties') && !/\b(?:assign|add|remove|change)\b/i.test(t)) {
    return { tool: 'list_my_invigilation_duties', args: {} };
  }

  // Own exam timetable.
  if (/\b(?:my|our|child'?s|son'?s|daughter'?s)\s+exam(?:ination)?\s+(?:time\s*table|timetable|schedule|dates?|seats?|rooms?)\b|\bshow\s+(?:me\s+)?my\s+exams\b|\bwhere\s+do\s+i\s+sit\b|\bmy\s+exam\s+seat\b/i.test(t)) {
    if (FAMILY.has(actor.roleKey) && has('get_my_exam_timetable')) return { tool: 'get_my_exam_timetable', args: {} };
    if (has('list_exam_timetable')) return { tool: 'list_exam_timetable', args: {} };
  }
  if (/\bexam(?:ination)?\s+(?:time\s*table|timetable)\b/i.test(t) && has('list_exam_timetable')) {
    const c = new RegExp(String.raw`\bfor\s+${CLASS}`, 'i').exec(t);
    return { tool: 'list_exam_timetable', args: c ? { className: tidyClass(c[1]) } : {} };
  }

  // Schedule a class test: "schedule a maths class test for 7B tomorrow at 10 to 10:40 in room 204".
  m = new RegExp(String.raw`\b(?:schedule|set|create|plan|fix)\s+(?:a\s+|an\s+)?(?:([a-z]+)\s+)?class\s+test\s+(?:in\s+([a-z]+)\s+)?for\s+${CLASS}(?:\s+(?:in\s+)?([a-z]+)(?=\s))?`, 'i').exec(t);
  if (m && has('create_class_test')) {
    const skip = new Set(['today', 'tomorrow', 'on', 'at', 'from', 'next', 'in']);
    const subject = [m[1], m[2], m[4]].find((w) => w && !skip.has(w.toLowerCase()) && !WHEN_RE.test(w));
    const args = { className: tidyClass(m[3]), ...(subject ? { subject: subject.toLowerCase() } : {}) };
    const when = whenIn(t); if (when) args.date = when;
    const time = /\b(?:at|from)\s+(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)(?:\s*(?:to|till|until|-|–)\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?))?/i.exec(t);
    if (time) { args.startTime = time[1].trim(); if (time[2]) args.endTime = time[2].trim(); }
    const room = /\bin\s+((?:room\s+)?[\w-]*\d[\w-]*|(?:the\s+)?[\w\s]{2,25}?(?:lab|hall|library|auditorium))\b/i.exec(t.slice(m.index + m[0].length));
    if (room) args.room = clean(room[1]);
    if (args.subject) return { tool: 'create_class_test', args };
  }

  // Move a class to another room.
  m = new RegExp(String.raw`\b(?:move|shift|relocate)\s+${CLASS}\s+(?:class\s+)?to\s+`, 'i').exec(t);
  if (m && has('create_room_shift')) {
    const args = { className: tidyClass(m[1]), toRoom: roomAfterTo(t.slice(m.index)) };
    const periods = periodsIn(t); if (periods?.length) args.periods = periods;
    const range = /\bfrom\s+(\S+(?:\s+\S+)?)\s+(?:to|till|until)\s+(\S+(?:\s+\S+)?)/i.exec(t);
    if (range && WHEN_RE.test(range[1]) && WHEN_RE.test(range[2])) { args.date = whenIn(range[1]); args.endDate = whenIn(range[2]); }
    else { const when = whenIn(t); if (when) args.date = when; }
    if (/\bpermanent(?:ly)?\b|\bfor\s+good\b/i.test(t)) args.kind = 'PERMANENT';
    const reason = reasonIn(t); if (reason) args.reason = reason;
    if (args.toRoom) return { tool: 'create_room_shift', args };
  }

  // Assign a home room.
  m = new RegExp(String.raw`\b(?:assign|give|allot|allocate)\s+(?:the\s+)?(room\s+[\w-]+|[\w\s-]{2,30}?(?:lab|room|hall|library))\s+to\s+${CLASS}`, 'i').exec(t)
    ?? new RegExp(String.raw`\bmake\s+(?:the\s+)?(room\s+[\w-]+|[\w\s-]{2,30}?(?:lab|room|hall|library))\s+(?:the\s+)?home\s+room\s+(?:of|for)\s+${CLASS}`, 'i').exec(t);
  if (m && has('assign_home_room')) {
    const args = { room: clean(m[1]), className: tidyClass(m[2]) };
    if (/\bmove\s+\S+\s+out\b|\bdisplace\b|\bswap\b/i.test(t)) args.displace = true;
    const reason = reasonIn(t); if (reason) args.reason = reason;
    return { tool: 'assign_home_room', args };
  }

  // Which room is a class in.
  m = new RegExp(String.raw`\b(?:which|what)\s+room\s+(?:is|will)\s+${CLASS}|\bwhere\s+is\s+${CLASS}\s+(?:class\s+)?(?:today|now|tomorrow|sitting|in)\b|\b${CLASS}(?:'s)?\s+(?:class)?room\s+(?:today|tomorrow|now)\b`, 'i').exec(t);
  if (m && has('get_section_room')) {
    const args = { className: tidyClass(m[1] ?? m[2] ?? m[3]) };
    const when = whenIn(t); if (when && when.toLowerCase() !== 'now') args.date = when;
    return { tool: 'get_section_room', args };
  }

  // The capabilities in their own words, with nothing else named (the tool asks for what is missing).
  if (/^\s*(?:show|list|open|see)?\s*(?:the\s+|all\s+)?(?:rooms?\s+(?:(?:and|&)\s+)?class(?:es)?|(?:class\s+)?home\s+rooms)\s*[?.!]*\s*$/i.test(t) && has('list_rooms_and_classes')) return { tool: 'list_rooms_and_classes', args: {} };
  if (/^\s*(?:assign|change|set)\s+(?:a\s+|the\s+)?home\s+room\s*[?.!]*\s*$/i.test(t) && has('assign_home_room')) return { tool: 'assign_home_room', args: {} };
  if (/^\s*(?:show|get|find)?\s*(?:the\s+)?exam(?:ination)?\s+halls?\s*[?.!]*\s*$/i.test(t) && has('get_exam_hall')) return { tool: 'get_exam_hall', args: {} };
  if (/^\s*(?:show|get|find)?\s*(?:the\s+|my\s+)?(?:section|class)\s+room\s*[?.!]*\s*$/i.test(t) && has('get_section_room')) return { tool: 'get_section_room', args: {} };

  // Free rooms.
  if (/\b(?:free|empty|available|vacant)\s+(?:class)?rooms?\b/i.test(t) && !/\bhostel\b|\bbeds?\b/i.test(t) && has('list_free_rooms')) {
    const args = {};
    const c = new RegExp(String.raw`\bfor\s+${CLASS}`, 'i').exec(t); if (c) args.className = tidyClass(c[1]);
    const periods = periodsIn(t); if (periods?.length) args.periods = periods;
    const when = whenIn(t); if (when && when.toLowerCase() !== 'now') args.date = when;
    const at = /\bat\s+(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)/i.exec(t); if (at) args.startTime = at[1];
    if (!args.className && !args.startTime) {
      const now = new Date(Date.now() + 330 * 60_000);
      args.startTime = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
    }
    return { tool: 'list_free_rooms', args };
  }

  return null;
}
