import crypto from 'node:crypto';
import { AgentConversation } from '../../../models/agentConversation.model.js';
import { getMcpTool } from '../mcp/registry.js';
import { logger } from '../../../utils/logger.js';

/**
 * Server-side conversation memory for Ask AI -- the website and WhatsApp alike.
 *
 * What it keeps, per (school, person, channel, conversation id):
 *
 *   turns    the last MAX_TURNS messages, oldest first, as `{ role, text }` --
 *            the same transcript shape the parser has always read, so every
 *            follow-up reader in intent.js works from it unchanged
 *   context  what the conversation is about, in structured form:
 *              lastRead      { tool, args }   the last read that answered
 *              students      [name]           the people the last answer listed
 *                                             (the absent ones, when it said who)
 *              continuation  token            where a long list stopped ("show more")
 *              lastActionId  id               the draft the last reply proposed
 *
 * Why on the server: the website kept the conversation in a component that
 * every page renders anew, so a page change or a reload forgot it (reproduced
 * in the browser: the transcript sent after navigating was empty). And text
 * alone loses what the reply was ABOUT -- "message their parents" needs the
 * students the last answer named, which the transcript only has as prose.
 *
 * What it can never do is widen anything. It is looked up by the signed-in
 * profile and the tenant plugin; the conversation id alone finds nothing. Every
 * value carried from it goes back through an MCP tool, which authorizes and
 * scopes the call for the person asking now -- a name remembered from an
 * earlier turn is resolved again at their scope, exactly as if they had typed
 * it. And replies about restricted records are not kept as text at all.
 */

export const MAX_TURNS = 24;
/** Turns handed to the parser: enough to go back to an earlier topic. */
export const HISTORY_TURNS = 16;
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TEXT = 2000;
const MAX_STUDENTS = 30;

/** Modules whose answers are not written into the stored transcript. */
const RESTRICTED_MODULES = new Set(['Medical', 'Health room', 'Payroll', 'Safety']);
const WITHHELD = '[a restricted answer was shown here; it is not kept in the conversation memory]';

const ID_SHAPE = /^[A-Za-z0-9_-]{8,64}$/;

/** A fresh conversation id. */
export function newConversationId() {
  return `c-${crypto.randomBytes(12).toString('hex')}`;
}

/** A client-supplied id, if it is one this server could have issued. */
export function acceptableConversationId(value) {
  return typeof value === 'string' && ID_SHAPE.test(value) ? value : null;
}

const channelOf = (source) => (source === 'WHATSAPP' ? 'WHATSAPP' : 'WEB');

/**
 * The stored conversation, or an empty one under `conversationId` (a new id
 * when none was given). Never throws: memory is an aid, and a database hiccup
 * must not cost the person their answer.
 */
export async function loadMemory({ actor, source = 'WEB', conversationId = null } = {}) {
  const id = acceptableConversationId(conversationId) ?? newConversationId();
  const empty = { conversationId: id, turns: [], context: {}, stored: false };
  if (!actor?.profileId) return empty;
  try {
    const row = await AgentConversation.findOne({
      profileId: actor.profileId,
      channel: channelOf(source),
      conversationId: id,
      expiresAt: { $gt: new Date() },
    }).lean();
    if (!row) return empty;
    return {
      conversationId: id,
      turns: (row.turns ?? []).map((t) => ({ role: t.role, text: String(t.text ?? '') })),
      context: row.context ?? {},
      stored: true,
    };
  } catch (err) {
    logger.warn(`Ask AI memory could not be read: ${err.message}`);
    return empty;
  }
}

/** The turns the parser reads: the stored ones when there are any, else what the client sent. */
export function historyFrom(memory, clientHistory = []) {
  if (memory?.turns?.length) return memory.turns.slice(-HISTORY_TURNS);
  return clientHistory ?? [];
}

/** True when any tool the turn used belongs to a restricted module. */
function touchesRestricted(result) {
  const names = [result?.tool, ...(result?.tools ?? []), result?.action?.tool].filter(Boolean);
  return names.some((name) => RESTRICTED_MODULES.has(getMcpTool(name)?.module));
}

const STUDENT_KEYS = ['admissionNo', 'enrollmentId', 'rollNo', 'studentId'];

/**
 * The people an answer listed, by name: the absent ones when the answer says
 * who is absent, otherwise every student-shaped row. Read from the tool's own
 * data, never from the reply's prose.
 */
export function studentsIn(data) {
  const out = [];
  const add = (name) => {
    const n = String(name ?? '').trim();
    if (n && n.length <= 80 && !out.includes(n)) out.push(n);
  };
  const nameOf = (row) => row?.studentName ?? row?.name ?? row?.student?.name
    ?? ([row?.firstName, row?.lastName].filter(Boolean).join(' ') || null);
  const visit = (value, depth = 0) => {
    if (!value || depth > 4 || out.length >= MAX_STUDENTS) return;
    if (Array.isArray(value)) { value.forEach((v) => visit(v, depth + 1)); return; }
    if (typeof value !== 'object') return;
    if (STUDENT_KEYS.some((k) => k in value) || value.studentName || value.student?.name) {
      const name = nameOf(value);
      if (name) add(name);
    }
    for (const v of Object.values(value)) if (v && typeof v === 'object') visit(v, depth + 1);
  };
  const single = Array.isArray(data) ? null : data;
  const absent = single?.absent ?? single?.absentStudents;
  if (Array.isArray(absent) && absent.length) {
    for (const row of absent) add(typeof row === 'string' ? row : nameOf(row));
    return out.slice(0, MAX_STUDENTS);
  }
  visit(data);
  return out.slice(0, MAX_STUDENTS);
}

/** What this turn leaves the conversation about. */
function contextAfter(previous, result) {
  const next = { ...(previous ?? {}) };
  const plan = Array.isArray(result?.plan) ? result.plan : [];
  const lastRead = [...plan].reverse().find((s) => getMcpTool(s.tool)?.operation === 'GET');
  if (lastRead && result?.via === 'MCP' && !result?.needsInput && !result?.refused) {
    next.lastRead = { tool: lastRead.tool, args: lastRead.args ?? {} };
    const students = studentsIn(result.data);
    next.students = students;
  }
  // A write the tool could not prepare yet and asked about: finished by the next answer.
  const intended = result?.needsInput && result?.intendedTool && getMcpTool(result.intendedTool)?.operation !== 'GET'
    ? result.intendedTool : null;
  next.openWrite = intended
    ? { tool: intended, args: plan.find((s) => s.tool === intended)?.args ?? {}, asked: String(result.reply ?? '').slice(0, 500) }
    : null;
  next.continuation = result?.continuation?.token ?? null;
  next.lastActionId = result?.action?.id ? String(result.action.id) : null;
  return next;
}

/**
 * Adds one exchange to the conversation and refreshes its context. Returns
 * the conversation id. Never throws.
 */
export async function rememberTurn({ actor, source = 'WEB', conversationId, message, result }) {
  const id = acceptableConversationId(conversationId);
  if (!id || !actor?.profileId) return id;
  try {
    const memory = await loadMemory({ actor, source, conversationId: id });
    const reply = touchesRestricted(result) ? WITHHELD : String(result?.reply ?? '');
    const turns = [
      ...memory.turns,
      ...(message != null ? [{ role: 'user', text: String(message).slice(0, MAX_TEXT) }] : []),
      ...(reply ? [{ role: 'assistant', text: reply.slice(0, MAX_TEXT) }] : []),
    ].slice(-MAX_TURNS);
    await AgentConversation.findOneAndUpdate(
      { profileId: actor.profileId, channel: channelOf(source), conversationId: id },
      {
        // The filter's own fields (person, channel, id) are what an upsert inserts with.
        $set: { turns, context: contextAfter(memory.context, result ?? {}), expiresAt: new Date(Date.now() + TTL_MS) },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (err) {
    logger.warn(`Ask AI memory could not be written: ${err.message}`);
  }
  return id;
}
