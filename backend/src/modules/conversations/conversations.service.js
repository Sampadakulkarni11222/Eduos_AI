import mongoose from 'mongoose';
import { ConversationThread, ConversationMessage, ConversationSetting } from '../../models/conversation.model.js';
import { Enrollment, StudentGuardian, Student } from '../../models/student.model.js';
import { Section } from '../../models/academics.model.js';
import { AppError } from '../../utils/AppError.js';
import { recordAudit } from '../../utils/auditTrail.js';
import { getTeacherSectionIds } from '../../utils/scope.js';
import { sendOperational } from '../messaging/messaging.service.js';
import {
  requireProfile, assertObjectId, requireText, optionalText, cleanAttachments, profileNames, pageArgs,
} from '../ops/common.js';
import {
  childrenOf, isGuardianOf, teachersOfSection, activeEnrollment, loadStudent, studentLabel, classLabel, teachesStudent, assertStaffProfile,
} from '../ptm/relations.js';

/**
 * Parent–teacher conversations about a child.
 *
 *  - A parent may start a thread only with a teacher of their own child (the
 *    class teacher, a subject teacher of the child's class) or the principal.
 *  - A teacher may start one only with a guardian of a pupil they teach.
 *  - Principal and administration (school-wide scope) can read any thread for
 *    oversight; each such read by someone outside the thread is audited, and
 *    does not mark messages as read for the family or teacher.
 *  - No phone number or email of anyone is shown; numbers typed into a
 *    message are removed, because the school's platform is the channel.
 *  - Sending is rate limited, and a message the family sent that has had no
 *    staff reply for 48 hours appears on the unanswered queue.
 */

const HOUR = 3_600_000;
const LIMITS = { PARENT: { hour: 10, day: 40 }, STAFF: { hour: 60, day: 300 } };
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/g;

export function redactNumbers(text) {
  return String(text).replace(PHONE_RE, (m) => (m.replace(/\D/g, '').length >= 8 ? '[number removed]' : m));
}

const isAll = (scope) => scope === 'ALL';
const isParent = (actor) => actor?.roleKey === 'PARENT';

function sideOf(actor, t) {
  if (String(t.parentProfileId) === String(actor.profileId)) return 'PARENT';
  if (String(t.staffProfileId) === String(actor.profileId)) return 'STAFF';
  return null;
}

async function presentThread(t, actor, { names, students, unread } = {}) {
  const n = names ?? await profileNames([t.parentProfileId, t.staffProfileId]);
  const st = students?.get(String(t.studentId)) ?? studentLabel(await Student.findById(t.studentId).select('firstName lastName').lean());
  return {
    id: String(t._id), studentId: String(t.studentId), studentName: st, subject: t.subject, status: t.status,
    parentProfileId: String(t.parentProfileId), parentName: n.get(String(t.parentProfileId)) ?? null,
    staffProfileId: String(t.staffProfileId), staffName: n.get(String(t.staffProfileId)) ?? null, staffRole: t.staffRole,
    lastMessageAt: t.lastMessageAt, lastMessageSide: t.lastMessageSide, awaitingStaffSince: t.awaitingStaffSince ?? null,
    messageCount: t.messageCount, unread: unread ?? 0, mySide: sideOf(actor, t), closedAt: t.closedAt ?? null,
  };
}

async function staffRoleFor(staffProfileId, sectionId) {
  const teachers = await teachersOfSection(sectionId);
  const t = teachers.find((x) => x.profileId === String(staffProfileId));
  if (!t) return null;
  if (t.roles.includes('CLASS_TEACHER')) return 'CLASS_TEACHER';
  if (t.roles.includes('SUBJECT_TEACHER')) return 'SUBJECT_TEACHER';
  return 'PRINCIPAL';
}

async function assertRate(actor, side) {
  const now = Date.now();
  const lim = LIMITS[side];
  const [hour, day] = await Promise.all([
    ConversationMessage.countDocuments({ senderProfileId: actor.profileId, createdAt: { $gte: new Date(now - HOUR) } }),
    ConversationMessage.countDocuments({ senderProfileId: actor.profileId, createdAt: { $gte: new Date(now - 24 * HOUR) } }),
  ]);
  if (hour >= lim.hour || day >= lim.day) throw new AppError('You have sent a lot of messages in a short time. Please wait a while before sending more.', 429, [], 'RATE_LIMITED');
}

async function writeMessage(actor, thread, side, body) {
  await assertRate(actor, side);
  const text = redactNumbers(requireText(body.body, 'message', { max: 4000 }));
  const msg = await ConversationMessage.create({
    threadId: thread._id, senderProfileId: actor.profileId, senderName: actor.displayName ?? null, side, body: text,
    attachments: cleanAttachments(body.attachments, actor).slice(0, 5), readBy: [{ profileId: actor.profileId, at: new Date() }],
  });
  const now = new Date();
  await ConversationThread.updateOne({ _id: thread._id }, {
    $set: { lastMessageAt: now, lastMessageSide: side, awaitingStaffSince: side === 'PARENT' ? (thread.awaitingStaffSince ?? now) : null },
    $inc: { messageCount: 1 },
  });
  const other = side === 'PARENT' ? thread.staffProfileId : thread.parentProfileId;
  const student = await Student.findById(thread.studentId).select('firstName').lean();
  await sendOperational({
    templateKey: 'CONVERSATION_MESSAGE', recipientProfileIds: [String(other)], channels: ['EMAIL'],
    variables: { from: actor.displayName ?? (side === 'PARENT' ? 'A parent' : 'A teacher'), student: student?.firstName ?? 'your child' },
    link: `/conversations?id=${thread._id}`, idempotencyKey: `conversation:${msg._id}`, relatedEntityType: 'ConversationThread', relatedEntityId: thread._id, requestedBy: actor.profileId,
  });
  return msg;
}

/** Starts a thread (or adds to the open one between the same people about the same child). */
export async function start(actor, scope, body = {}) {
  requireProfile(actor);
  const student = await loadStudent(body.studentId);
  const enrol = await activeEnrollment(student._id);
  const sectionId = enrol ? (enrol.sectionId?._id ?? enrol.sectionId) : null;
  let parentId; let staffId; let staffRole; let side;
  if (isParent(actor)) {
    if (!(await isGuardianOf(actor.profileId, student._id))) throw new AppError('You can only message about your own child.', 403, [], 'NOT_YOUR_CHILD');
    staffId = assertObjectId(body.staffProfileId, 'staffProfileId');
    staffRole = sectionId ? await staffRoleFor(staffId, sectionId) : null;
    if (!staffRole) throw new AppError('You can message your child\'s teachers and the principal only.', 403, [], 'NOT_CHILDS_TEACHER');
    parentId = actor.profileId; side = 'PARENT';
  } else {
    await assertStaffProfile(actor.profileId, 'sender');
    if (!isAll(scope) && !(await teachesStudent(actor.profileId, student._id))) throw new AppError('You can message the parents of pupils you teach only.', 403, [], 'NOT_YOUR_PUPIL');
    parentId = assertObjectId(body.parentProfileId, 'parentProfileId');
    if (!(await isGuardianOf(parentId, student._id))) throw new AppError('That person is not a guardian of this student.', 403, [], 'NOT_GUARDIAN');
    staffId = actor.profileId; side = 'STAFF';
    staffRole = (sectionId && await staffRoleFor(staffId, sectionId)) ?? 'STAFF';
  }
  let thread = await ConversationThread.findOne({ studentId: student._id, parentProfileId: parentId, staffProfileId: staffId, status: 'OPEN' });
  if (!thread) {
    try {
      thread = await ConversationThread.create({
        studentId: student._id, sectionId, parentProfileId: parentId, staffProfileId: staffId, staffRole,
        subject: requireText(body.subject ?? `About ${student.firstName}`, 'subject', { max: 160 }), status: 'OPEN', startedByProfileId: actor.profileId,
      });
    } catch (err) {
      if (err?.code !== 11000) throw err;
      thread = await ConversationThread.findOne({ studentId: student._id, parentProfileId: parentId, staffProfileId: staffId, status: 'OPEN' });
    }
  }
  await writeMessage(actor, thread, side, body);
  return getThread(actor, scope, String(thread._id));
}

async function loadThread(actor, scope, id) {
  const t = await ConversationThread.findById(assertObjectId(id));
  if (!t) throw new AppError('Conversation not found', 404);
  if (!sideOf(actor, t) && !isAll(scope)) throw new AppError('Conversation not found', 404);
  return t;
}

export async function getThread(actor, scope, id) {
  requireProfile(actor);
  const t = await loadThread(actor, scope, id);
  const side = sideOf(actor, t);
  const messages = await ConversationMessage.find({ threadId: t._id }).sort({ createdAt: 1 }).limit(500).lean();
  if (side) {
    // A participant reading marks the other side's messages as read.
    await ConversationMessage.updateMany({ threadId: t._id, 'readBy.profileId': { $ne: actor.profileId } }, { $push: { readBy: { profileId: actor.profileId, at: new Date() } } });
  } else {
    await recordAudit({ actor, action: 'conversation.read.oversight', entityType: 'ConversationThread', entityId: t._id, after: { studentId: String(t.studentId) } });
  }
  const setting = await ConversationSetting.findOne({ profileId: t.staffProfileId }).lean();
  return {
    ...(await presentThread(t.toObject(), actor)),
    officeHoursNote: setting?.officeHoursNote ?? null,
    oversight: !side,
    canReply: Boolean(side) && t.status === 'OPEN',
    canClose: t.status === 'OPEN' && (side === 'STAFF' || isAll(scope)),
    messages: messages.map((m) => ({
      id: String(m._id), side: m.side, senderName: m.senderName, body: m.body, at: m.createdAt,
      attachments: (m.attachments ?? []).map((a) => ({ name: a.name, url: a.url, kind: a.kind })),
      mine: String(m.senderProfileId) === String(actor.profileId),
      // Read receipt: whether the other participant has opened it.
      readByOther: (m.readBy ?? []).some((r) => String(r.profileId) === (String(m.senderProfileId) === String(t.parentProfileId) ? String(t.staffProfileId) : String(t.parentProfileId))),
      readAt: (m.readBy ?? []).find((r) => String(r.profileId) !== String(m.senderProfileId) && [String(t.parentProfileId), String(t.staffProfileId)].includes(String(r.profileId)))?.at ?? null,
    })),
  };
}

export async function reply(actor, scope, id, body = {}) {
  requireProfile(actor);
  const t = await loadThread(actor, scope, id);
  const side = sideOf(actor, t);
  if (!side) throw new AppError('Only the parent and the teacher in this conversation can write in it.', 403, [], 'NOT_PARTICIPANT');
  if (t.status !== 'OPEN') throw new AppError('This conversation is closed. Start a new one if you need to.', 409, [], 'THREAD_CLOSED');
  await writeMessage(actor, t, side, body);
  return getThread(actor, scope, id);
}

export async function close(actor, scope, id, body = {}) {
  requireProfile(actor);
  const t = await loadThread(actor, scope, id);
  if (sideOf(actor, t) !== 'STAFF' && !isAll(scope)) throw new AppError('Only the teacher or the principal can close a conversation.', 403, [], 'NOT_STAFF');
  if (t.status !== 'OPEN') throw new AppError('Already closed.', 409);
  t.status = 'CLOSED'; t.closedAt = new Date(); t.closedByProfileId = actor.profileId; t.awaitingStaffSince = null;
  await t.save();
  if (body.note) {
    await ConversationMessage.create({ threadId: t._id, senderProfileId: actor.profileId, senderName: actor.displayName ?? null, side: 'STAFF', body: redactNumbers(String(body.note).slice(0, 1000)), readBy: [{ profileId: actor.profileId }] });
  }
  return presentThread(t.toObject(), actor);
}

export async function list(actor, scope, query = {}) {
  requireProfile(actor);
  const filter = {};
  const view = isAll(scope) ? (query.view ?? 'mine') : 'mine';
  if (view === 'mine') filter.$or = [{ parentProfileId: actor.profileId }, { staffProfileId: actor.profileId }];
  if (query.status === 'OPEN' || query.status === 'CLOSED') filter.status = query.status;
  if (query.studentId) filter.studentId = assertObjectId(query.studentId, 'studentId');
  const { page, pageSize, skip } = pageArgs(query);
  const [rows, total] = await Promise.all([
    ConversationThread.find(filter).sort({ lastMessageAt: -1 }).skip(skip).limit(pageSize).lean(),
    ConversationThread.countDocuments(filter),
  ]);
  const names = await profileNames(rows.flatMap((t) => [t.parentProfileId, t.staffProfileId]));
  const studs = new Map((await Student.find({ _id: { $in: rows.map((t) => t.studentId) } }).select('firstName lastName').lean()).map((s) => [String(s._id), studentLabel(s)]));
  const unread = await ConversationMessage.aggregate([
    { $match: { threadId: { $in: rows.map((t) => t._id) }, 'readBy.profileId': { $ne: new mongoose.Types.ObjectId(String(actor.profileId)) } } },
    { $group: { _id: '$threadId', n: { $sum: 1 } } },
  ]);
  const unreadBy = new Map(unread.map((u) => [String(u._id), u.n]));
  const items = [];
  for (const t of rows) {
    // eslint-disable-next-line no-await-in-loop
    items.push(await presentThread(t, actor, { names, students: studs, unread: sideOf(actor, t) ? unreadBy.get(String(t._id)) ?? 0 : 0 }));
  }
  return { items, total, page, pageSize };
}

/** Family messages without a staff reply for more than `hours` (48 by default). */
export async function unansweredQueue(actor, scope, query = {}) {
  requireProfile(actor);
  const hours = Math.min(Math.max(Number(query.hours) || 48, 1), 24 * 30);
  const filter = { status: 'OPEN', awaitingStaffSince: { $ne: null, $lte: new Date(Date.now() - hours * HOUR) } };
  if (!isAll(scope)) filter.staffProfileId = actor.profileId;
  const rows = await ConversationThread.find(filter).sort({ awaitingStaffSince: 1 }).limit(200).lean();
  const names = await profileNames(rows.flatMap((t) => [t.parentProfileId, t.staffProfileId]));
  const items = [];
  // eslint-disable-next-line no-await-in-loop
  for (const t of rows) items.push({ ...(await presentThread(t, actor, { names })), waitingHours: Math.floor((Date.now() - new Date(t.awaitingStaffSince).getTime()) / HOUR) });
  return { hours, items, total: items.length };
}

/** Who the caller may start a conversation with. */
export async function contacts(actor, scope, query = {}) {
  requireProfile(actor);
  if (isParent(actor)) {
    const kids = await childrenOf(actor.profileId);
    const out = [];
    for (const k of kids) {
      // eslint-disable-next-line no-await-in-loop
      const teachers = k.sectionId ? await teachersOfSection(k.sectionId) : [];
      // eslint-disable-next-line no-await-in-loop
      const notes = new Map((await ConversationSetting.find({ profileId: { $in: teachers.map((t) => t.profileId) } }).lean()).map((s) => [String(s.profileId), s.officeHoursNote]));
      out.push({ ...k, staff: teachers.map((t) => ({ profileId: t.profileId, name: t.name, roles: t.roles, subjects: t.subjects, officeHoursNote: notes.get(t.profileId) ?? null })) });
    }
    return { kind: 'PARENT', children: out };
  }
  const sections = isAll(scope)
    ? (query.sectionId ? [String(query.sectionId)] : (await Section.find({}).select('_id').lean()).map((x) => String(x._id)))
    : await getTeacherSectionIds(actor.profileId);
  const wanted = query.sectionId ? sections.filter((s) => s === String(query.sectionId)) : sections;
  const enrolments = await Enrollment.find({ sectionId: { $in: wanted }, status: 'ACTIVE' }).populate('studentId', 'firstName lastName').populate({ path: 'sectionId', select: 'name gradeId', populate: { path: 'gradeId', select: 'name' } }).limit(400).lean();
  const links = await StudentGuardian.find({ studentId: { $in: enrolments.map((e) => e.studentId?._id).filter(Boolean) } }).select('studentId guardianProfileId relation').lean();
  const names = await profileNames(links.map((l) => l.guardianProfileId));
  return {
    kind: 'STAFF',
    pupils: enrolments.filter((e) => e.studentId).map((e) => ({
      studentId: String(e.studentId._id), name: studentLabel(e.studentId), className: classLabel(e.sectionId),
      guardians: links.filter((l) => String(l.studentId) === String(e.studentId._id)).map((l) => ({ profileId: String(l.guardianProfileId), name: names.get(String(l.guardianProfileId)) ?? null, relation: l.relation })),
    })).sort((a, b) => a.className.localeCompare(b.className, undefined, { numeric: true }) || a.name.localeCompare(b.name)),
  };
}

export async function getSettings(actor) {
  requireProfile(actor);
  const s = await ConversationSetting.findOne({ profileId: actor.profileId }).lean();
  return { officeHoursNote: s?.officeHoursNote ?? null };
}

export async function setSettings(actor, body = {}) {
  requireProfile(actor);
  if (isParent(actor)) throw new AppError('Office hours are for staff.', 403);
  const note = optionalText(body.officeHoursNote, { max: 300 }) || null;
  await ConversationSetting.findOneAndUpdate({ profileId: actor.profileId }, { $set: { officeHoursNote: note } }, { upsert: true });
  return { officeHoursNote: note };
}
