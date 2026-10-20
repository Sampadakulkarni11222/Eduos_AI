import crypto from 'node:crypto';
import { OnlineClass } from '../../models/onlineClass.model.js';
import { Section, SubjectOffering } from '../../models/academics.model.js';
import { Student, StudentGuardian, Enrollment } from '../../models/student.model.js';
import { Profile } from '../../models/profile.model.js';
import { currentTenantId } from '../../tenancy/tenantContext.js';
import { AppError } from '../../utils/AppError.js';
import { getTeacherSectionIds, getGuardianStudentIds, getOwnStudentId } from '../../utils/scope.js';
import { sendOperational } from '../messaging/messaging.service.js';

import {
  nextRef, requireProfile, assertObjectId, pushHistory, cleanAttachments, parseDate, requireText, optionalText, oneOf, dto, profilesWithRoles,
} from '../ops/common.js';

// Built once: a formatter is expensive to construct and this runs for every class listed.
const WHEN_FMT = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

/**
 * Digital lectures and online meetings.
 *
 * EduOS schedules the class, tells the people it is for (in the app, by email
 * and by WhatsApp), hands each of them the join link, and keeps what was
 * shared afterwards. The video call itself runs on a meeting service:
 *
 *   JITSI        a room on a Jitsi Meet server is named here, so a class can be
 *                held with no account and no key. The default server is the
 *                public meet.jit.si, where anyone holding the link can enter;
 *                set JITSI_BASE_URL to the institution's own server to close
 *                that, or use one of the providers below.
 *   GOOGLE_MEET, ZOOM, TEAMS, OTHER
 *                the host creates the meeting in that service and pastes its
 *                link. Nothing is created in those services from here.
 *
 * The link is never listed. It is given by join() to a person the class is
 * for, from fifteen minutes before the start until the end, and each handing
 * out is recorded. That record says who opened the link through EduOS, not who
 * attended: only the meeting service knows who stayed.
 */
const KINDS = ['LECTURE', 'DOUBT_SESSION', 'PARENT_MEETING', 'STAFF_MEETING', 'WEBINAR', 'OTHER'];
const PROVIDERS = ['JITSI', 'GOOGLE_MEET', 'ZOOM', 'TEAMS', 'OTHER'];
const STAFF_ROLES = ['ADMIN', 'PRINCIPAL', 'TEACHER', 'FINANCE', 'LIBRARIAN', 'WARDEN', 'HR', 'MARKETING', 'COMPLIANCE', 'TRUSTEE'];
const OPEN_BEFORE_MS = 15 * 60_000;
const CHANNELS = ['WHATSAPP', 'EMAIL'];

const jitsiBase = () => String(process.env.JITSI_BASE_URL || 'https://meet.jit.si').replace(/\/+$/, '');

/** India time, as a person reads it: "Tue 14 Oct, 10:30 am". */
export function whenText(at) {
  return WHEN_FMT.format(new Date(at));
}

function meetingLink(provider, given) {
  if (provider === 'JITSI') {
    // Unguessable, and carrying nothing that identifies the school or the class.
    return `${jitsiBase()}/eduos-${crypto.randomBytes(12).toString('hex')}`;
  }
  const url = requireText(given, 'joinUrl', { max: 600 });
  let parsed;
  try { parsed = new URL(url); } catch { throw new AppError('The meeting link is not a valid web address.', 400, [], 'BAD_LINK'); }
  if (parsed.protocol !== 'https:') throw new AppError('The meeting link must start with https://', 400, [], 'BAD_LINK');
  return parsed.toString();
}

const isManager = (actor) => actor.permissions?.['lectures.manage'] === 'ALL';
const seesAll = (actor) => actor.permissions?.['lectures.read'] === 'ALL';
const isHost = (cls, actor) => String(cls.hostProfileId) === String(actor.profileId);

async function load(id) {
  const cls = await OnlineClass.findById(assertObjectId(id));
  if (!cls) throw new AppError('Online class not found', 404);
  return cls;
}

/** The sections a person belongs to as a student, or through their children. */
async function familySections(actor) {
  const own = await getOwnStudentId(actor.profileId);
  const studentIds = own ? [own] : await getGuardianStudentIds(actor.profileId);
  if (!studentIds.length) return { sectionIds: [], asGuardian: false };
  const rows = await Enrollment.find({ studentId: { $in: studentIds }, status: 'ACTIVE' }).select('sectionId').lean();
  return { sectionIds: [...new Set(rows.map((r) => String(r.sectionId)))], asGuardian: !own };
}

/** Whether this class is for this person. The single rule behind list, get and join. */
async function isFor(cls, actor, family = null) {
  if (seesAll(actor) || isHost(cls, actor)) return true;
  if ((cls.inviteeProfileIds ?? []).some((p) => String(p) === String(actor.profileId))) return true;
  if ((cls.inviteeRoles ?? []).includes(actor.roleKey)) return true;
  const sections = (cls.sectionIds ?? []).map(String);
  if (!sections.length) return false;
  if (actor.roleKey === 'TEACHER') {
    const mine = await getTeacherSectionIds(actor.profileId);
    if (mine.some((s) => sections.includes(s))) return true;
  }
  const fam = family ?? await familySections(actor);
  if (!fam.sectionIds.some((s) => sections.includes(s))) return false;
  // A student's class is theirs; a parent sees it too, and may join only when guardians are invited.
  return true;
}

function present(doc, actor, { detail = false } = {}) {
  const c = dto(doc);
  const now = Date.now();
  const host = isHost(doc, actor);
  const manage = host || isManager(actor);
  const out = {
    id: c.id, refNo: c.refNo, seriesId: c.seriesId ?? null, kind: c.kind, title: c.title, description: c.description ?? null,
    hostName: c.hostName ?? null, isHost: host, canManage: manage, subjectName: c.subjectName ?? null,
    sectionIds: (c.sectionIds ?? []).map(String), includeGuardians: Boolean(c.includeGuardians),
    inviteeRoles: c.inviteeRoles ?? [], invitedPeople: (c.inviteeProfileIds ?? []).length,
    startsAt: c.startsAt, endsAt: c.endsAt, when: whenText(c.startsAt), durationMinutes: Math.round((new Date(c.endsAt) - new Date(c.startsAt)) / 60_000),
    provider: c.provider, status: c.status, cancelReason: c.cancelReason ?? null,
    // The door opens a little early and shuts when the class is over.
    joinOpen: ['SCHEDULED', 'LIVE'].includes(c.status) && now >= new Date(c.startsAt).getTime() - OPEN_BEFORE_MS && now <= new Date(c.endsAt).getTime(),
    joinOpensAt: new Date(new Date(c.startsAt).getTime() - OPEN_BEFORE_MS),
    materials: (c.materials ?? []).map((m) => ({ name: m.name, url: m.url, kind: m.kind })),
    recordingUrl: c.recordingUrl ?? null, summary: c.summary ?? null,
    joinedCount: (c.joins ?? []).length,
  };
  if (detail && manage) {
    out.joins = (c.joins ?? []).map((j) => ({ name: j.name, roleKey: j.roleKey, firstJoinedAt: j.firstJoinedAt, lastJoinedAt: j.lastJoinedAt, times: j.times }));
    out.history = c.history ?? [];
  }
  return out;
}

/** Everyone a class is for, as profile ids: students, their guardians when invited, named people and role holders. */
export async function audienceProfileIds(cls) {
  const ids = new Set((cls.inviteeProfileIds ?? []).map(String));
  if ((cls.sectionIds ?? []).length) {
    const enrolments = await Enrollment.find({ sectionId: { $in: cls.sectionIds }, status: 'ACTIVE' }).select('studentId').lean();
    const studentIds = enrolments.map((e) => e.studentId);
    const students = await Student.find({ _id: { $in: studentIds }, profileId: { $ne: null } }).select('profileId').lean();
    for (const s of students) ids.add(String(s.profileId));
    if (cls.includeGuardians) {
      const links = await StudentGuardian.find({ studentId: { $in: studentIds } }).select('guardianProfileId').lean();
      for (const l of links) ids.add(String(l.guardianProfileId));
    }
  }
  if ((cls.inviteeRoles ?? []).length) for (const p of await profilesWithRoles(cls.inviteeRoles)) ids.add(String(p._id));
  ids.delete(String(cls.hostProfileId));
  return [...ids];
}

async function announce(cls, templateKey, actor, extra = {}) {
  const recipients = await audienceProfileIds(cls);
  if (!recipients.length) return { recipients: 0 };
  const results = await sendOperational({
    templateKey, recipientProfileIds: recipients, channels: CHANNELS,
    variables: { title: cls.title, when: whenText(cls.startsAt), host: cls.hostName ?? null, ...extra },
    link: `/lectures?id=${cls._id}`,
    // One announcement per class per kind of news per time it was moved to.
    idempotencyKey: `class:${cls._id}:${templateKey}:${new Date(cls.startsAt).getTime()}`,
    relatedEntityType: 'OnlineClass', relatedEntityId: cls._id, requestedBy: actor?.profileId ?? null,
  });
  return { recipients: recipients.length, byStatus: results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {}) };
}

async function audienceFrom(actor, body) {
  const sectionIds = [...new Set((Array.isArray(body.sectionIds) ? body.sectionIds : []).map((s) => String(assertObjectId(s, 'sectionId'))))];
  if (sectionIds.length) {
    const found = await Section.find({ _id: { $in: sectionIds } }).select('_id').lean();
    if (found.length !== sectionIds.length) throw new AppError('One of the classes was not found.', 404);
    if (!isManager(actor)) {
      // A teacher schedules for the classes they teach; anyone else needs school-wide authority.
      const mine = await getTeacherSectionIds(actor.profileId);
      const foreign = sectionIds.filter((s) => !mine.includes(s));
      if (foreign.length) throw new AppError('You can schedule online classes only for the classes you teach.', 403, [], 'NOT_YOUR_CLASS');
    }
  }
  const inviteeProfileIds = [...new Set((Array.isArray(body.inviteeProfileIds) ? body.inviteeProfileIds : []).map((p) => String(assertObjectId(p, 'inviteeProfileId'))))].slice(0, 500);
  if (inviteeProfileIds.length) {
    const tenantId = currentTenantId();
    const real = await Profile.countDocuments({ _id: { $in: inviteeProfileIds }, status: 'ACTIVE', ...(tenantId ? { tenantId } : {}) });
    if (real !== inviteeProfileIds.length) throw new AppError('One of the invited people was not found in this school.', 404);
  }
  const inviteeRoles = [...new Set((Array.isArray(body.inviteeRoles) ? body.inviteeRoles : []).map((r) => String(r).toUpperCase()))];
  if (inviteeRoles.some((r) => !STAFF_ROLES.includes(r))) throw new AppError(`Roles can be any of ${STAFF_ROLES.join(', ')}.`, 400);
  if (inviteeRoles.length && !isManager(actor)) throw new AppError('Inviting a whole staff role needs school-wide authority over online classes.', 403, [], 'ROLE_INVITE_FORBIDDEN');
  if (!sectionIds.length && !inviteeProfileIds.length && !inviteeRoles.length) throw new AppError('Say who the class is for: a class, a staff role, or named people.', 400, [], 'NO_AUDIENCE');
  return { sectionIds, inviteeProfileIds, inviteeRoles, includeGuardians: Boolean(body.includeGuardians) && sectionIds.length > 0 };
}

function timesFrom(body, { required = true } = {}) {
  const startsAt = parseDate(body.startsAt, 'startsAt', { required });
  if (!startsAt) return null;
  const minutes = Number(body.durationMinutes ?? 45);
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 480) throw new AppError('Duration must be between 5 minutes and 8 hours.', 400);
  return { startsAt, endsAt: new Date(startsAt.getTime() + Math.round(minutes) * 60_000) };
}

/** A host cannot be in two classes at once, and neither can a section. */
async function assertNoClash({ hostProfileId, sectionIds, startsAt, endsAt }, excludeId = null) {
  const overlap = { status: { $in: ['SCHEDULED', 'LIVE'] }, startsAt: { $lt: endsAt }, endsAt: { $gt: startsAt }, ...(excludeId ? { _id: { $ne: excludeId } } : {}) };
  const clash = await OnlineClass.findOne({ ...overlap, $or: [{ hostProfileId }, ...(sectionIds.length ? [{ sectionIds: { $in: sectionIds } }] : [])] }).select('title startsAt hostProfileId').lean();
  if (clash) {
    const who = String(clash.hostProfileId) === String(hostProfileId) ? 'The host already has' : 'That class already has';
    throw new AppError(`${who} "${clash.title}" at ${whenText(clash.startsAt)}.`, 409, [], 'CLASS_CLASH');
  }
}

export async function create(actor, body = {}) {
  requireProfile(actor);
  const title = requireText(body.title, 'title', { max: 200 });
  const kind = oneOf(body.kind, KINDS, 'kind', 'LECTURE');
  const provider = oneOf(body.provider, PROVIDERS, 'provider', 'JITSI');
  const audience = await audienceFrom(actor, body);
  const first = timesFrom(body);
  if (first.startsAt.getTime() < Date.now() - 5 * 60_000) throw new AppError('The class cannot start in the past.', 400, [], 'IN_THE_PAST');
  const repeat = Math.min(Math.max(Number.parseInt(body.repeatWeekly, 10) || 1, 1), 20);

  let subjectName = null;
  let subjectOfferingId = null;
  if (body.subjectOfferingId) {
    const offering = await SubjectOffering.findById(assertObjectId(body.subjectOfferingId, 'subjectOfferingId')).populate('subjectId', 'name').lean();
    if (!offering) throw new AppError('Subject not found', 404);
    subjectOfferingId = offering._id;
    subjectName = offering.subjectId?.name ?? null;
  }

  const seriesId = repeat > 1 ? crypto.randomBytes(8).toString('hex') : null;
  const slots = Array.from({ length: repeat }, (_, i) => ({ startsAt: new Date(first.startsAt.getTime() + i * 7 * 86_400_000), endsAt: new Date(first.endsAt.getTime() + i * 7 * 86_400_000) }));
  for (const slot of slots) {
    // eslint-disable-next-line no-await-in-loop -- each week is checked before anything is written
    await assertNoClash({ hostProfileId: actor.profileId, sectionIds: audience.sectionIds, ...slot });
  }

  // A pasted link is one meeting reused every week; a Jitsi room is made fresh for each.
  const pasted = provider === 'JITSI' ? null : meetingLink(provider, body.joinUrl);
  const created = [];
  for (const slot of slots) {
    const cls = new OnlineClass({
      // eslint-disable-next-line no-await-in-loop
      refNo: await nextRef('CLS'), seriesId, kind, title,
      description: optionalText(body.description, { max: 4000 }) || null,
      hostProfileId: actor.profileId, hostName: actor.displayName ?? null,
      ...audience, subjectOfferingId, subjectName,
      ...slot, provider, joinUrl: pasted ?? meetingLink('JITSI'),
      passcode: optionalText(body.passcode, { max: 60 }) || null,
      materials: cleanAttachments(body.materials, actor), history: [],
    });
    pushHistory(cls, actor, 'SCHEDULED', { to: 'SCHEDULED' });
    // eslint-disable-next-line no-await-in-loop
    await cls.save();
    created.push(cls);
  }
  // One announcement, for the first class; the rest are announced by their reminders.
  const delivery = await announce(created[0], 'CLASS_SCHEDULED', actor);
  return { ...present(created[0].toObject(), actor), occurrences: created.length, delivery };
}

async function manageable(actor, id) {
  requireProfile(actor);
  const cls = await load(id);
  if (!isHost(cls, actor) && !isManager(actor)) throw new AppError('Only the host or an administrator can change this class.', 403, [], 'NOT_HOST');
  return cls;
}

export async function update(actor, id, body = {}) {
  const cls = await manageable(actor, id);
  if (!['SCHEDULED'].includes(cls.status)) throw new AppError('Only a class that has not started can be changed.', 409, [], 'CLASS_LOCKED');
  const before = cls.startsAt.getTime();
  if (body.title !== undefined) cls.title = requireText(body.title, 'title', { max: 200 });
  if (body.description !== undefined) cls.description = optionalText(body.description, { max: 4000 }) || null;
  if (body.passcode !== undefined) cls.passcode = optionalText(body.passcode, { max: 60 }) || null;
  if (body.joinUrl !== undefined && cls.provider !== 'JITSI') cls.joinUrl = meetingLink(cls.provider, body.joinUrl);
  if (body.startsAt !== undefined || body.durationMinutes !== undefined) {
    const t = timesFrom({ startsAt: body.startsAt ?? cls.startsAt, durationMinutes: body.durationMinutes ?? Math.round((cls.endsAt - cls.startsAt) / 60_000) });
    await assertNoClash({ hostProfileId: cls.hostProfileId, sectionIds: cls.sectionIds.map(String), ...t }, cls._id);
    cls.startsAt = t.startsAt; cls.endsAt = t.endsAt;
  }
  const moved = cls.startsAt.getTime() !== before;
  if (moved) { cls.reminderSentAt = null; pushHistory(cls, actor, 'RESCHEDULED', { note: whenText(cls.startsAt) }); }
  await cls.save();
  const delivery = moved ? await announce(cls, 'CLASS_CHANGED', actor) : null;
  return { ...present(cls.toObject(), actor, { detail: true }), delivery };
}

export async function cancel(actor, id, body = {}) {
  const cls = await manageable(actor, id);
  if (!['SCHEDULED', 'LIVE'].includes(cls.status)) throw new AppError('This class is already over or cancelled.', 409, [], 'CLASS_LOCKED');
  const reason = requireText(body.reason, 'reason', { max: 300 });
  const from = cls.status;
  cls.status = 'CANCELLED'; cls.cancelReason = reason;
  pushHistory(cls, actor, 'CANCELLED', { from, to: 'CANCELLED', note: reason });
  await cls.save();
  const delivery = await announce(cls, 'CLASS_CANCELLED', actor, { reason });
  return { ...present(cls.toObject(), actor, { detail: true }), delivery };
}

/** After the class: mark it over and attach what should stay with it. */
export async function finish(actor, id, body = {}) {
  const cls = await manageable(actor, id);
  if (cls.status === 'CANCELLED') throw new AppError('A cancelled class cannot be finished.', 409, [], 'CLASS_LOCKED');
  if (cls.startsAt.getTime() - OPEN_BEFORE_MS > Date.now()) throw new AppError('This class has not started yet.', 409, [], 'NOT_STARTED');
  if (body.recordingUrl !== undefined) cls.recordingUrl = body.recordingUrl ? meetingLink('OTHER', body.recordingUrl) : null;
  if (body.summary !== undefined) cls.summary = optionalText(body.summary, { max: 6000 }) || null;
  if (Array.isArray(body.materials)) cls.materials = cleanAttachments(body.materials, actor);
  if (cls.status !== 'ENDED') {
    const from = cls.status;
    cls.status = 'ENDED'; cls.endedAt = new Date();
    pushHistory(cls, actor, 'ENDED', { from, to: 'ENDED' });
  }
  await cls.save();
  return present(cls.toObject(), actor, { detail: true });
}

export async function list(actor, query = {}) {
  requireProfile(actor);
  const now = new Date();
  const tab = String(query.tab ?? 'upcoming');
  const filter = {};
  if (tab === 'past') filter.$or = [{ endsAt: { $lt: now } }, { status: { $in: ['ENDED', 'CANCELLED'] } }];
  else if (tab !== 'all') { filter.endsAt = { $gte: now }; filter.status = { $in: ['SCHEDULED', 'LIVE'] }; }
  if (query.sectionId) filter.sectionIds = assertObjectId(query.sectionId, 'sectionId');

  if (!seesAll(actor) || tab === 'mine') {
    const family = await familySections(actor);
    const teaching = actor.roleKey === 'TEACHER' ? await getTeacherSectionIds(actor.profileId) : [];
    const mine = [{ hostProfileId: actor.profileId }];
    if (tab !== 'mine') {
      mine.push({ inviteeProfileIds: actor.profileId }, { inviteeRoles: actor.roleKey });
      const sections = [...new Set([...family.sectionIds, ...teaching])];
      if (sections.length) mine.push({ sectionIds: { $in: sections } });
    }
    filter.$and = [{ $or: mine }];
  }
  const rows = await OnlineClass.find(filter).sort({ startsAt: tab === 'past' ? -1 : 1 }).limit(200).lean();
  return rows.map((r) => present(r, actor));
}

export async function get(actor, id) {
  requireProfile(actor);
  const cls = await load(id);
  if (!(await isFor(cls, actor))) throw new AppError('Online class not found', 404);
  return present(cls.toObject(), actor, { detail: true });
}

/**
 * Hands the join link to one person the class is for, and records that it was
 * handed out. A parent may open a class that invited guardians; otherwise the
 * class is their child's to attend, and they are shown it without a door.
 */
export async function join(actor, id) {
  requireProfile(actor);
  const cls = await load(id);
  const family = await familySections(actor);
  if (!(await isFor(cls, actor, family))) throw new AppError('Online class not found', 404);
  const host = isHost(cls, actor);
  const direct = host || seesAll(actor) || (cls.inviteeProfileIds ?? []).some((p) => String(p) === String(actor.profileId)) || (cls.inviteeRoles ?? []).includes(actor.roleKey);
  if (!direct && family.asGuardian && !cls.includeGuardians) {
    throw new AppError('This class is for students. Your child joins from their own account.', 403, [], 'STUDENTS_ONLY');
  }
  if (cls.status === 'CANCELLED') throw new AppError('This class was cancelled.', 409, [], 'CLASS_CANCELLED');
  if (cls.status === 'ENDED' || Date.now() > cls.endsAt.getTime()) throw new AppError('This class is over.', 409, [], 'CLASS_OVER');
  if (!host && Date.now() < cls.startsAt.getTime() - OPEN_BEFORE_MS) {
    throw new AppError(`The class opens at ${whenText(new Date(cls.startsAt.getTime() - OPEN_BEFORE_MS))}.`, 409, [], 'NOT_OPEN_YET');
  }
  const now = new Date();
  const seen = cls.joins.find((j) => String(j.profileId) === String(actor.profileId));
  if (seen) { seen.lastJoinedAt = now; seen.times += 1; }
  else cls.joins.push({ profileId: actor.profileId, name: actor.displayName ?? null, roleKey: actor.roleKey ?? null, firstJoinedAt: now, lastJoinedAt: now });
  // The host opening the room is what makes the class live.
  if (host && cls.status === 'SCHEDULED') { cls.status = 'LIVE'; cls.startedAt = now; pushHistory(cls, actor, 'STARTED', { from: 'SCHEDULED', to: 'LIVE' }); }
  await cls.save();
  return { joinUrl: cls.joinUrl, passcode: cls.passcode ?? null, provider: cls.provider, title: cls.title };
}

/** Who was invited and who opened the link, for the host. */
export async function attendance(actor, id) {
  const cls = await manageable(actor, id);
  const invited = await audienceProfileIds(cls);
  const people = await Profile.find({ _id: { $in: invited } }).select('displayName').lean();
  const joined = new Map(cls.joins.map((j) => [String(j.profileId), j]));
  const rows = people.map((p) => {
    const j = joined.get(String(p._id));
    return { name: p.displayName, joined: Boolean(j), firstJoinedAt: j?.firstJoinedAt ?? null, times: j?.times ?? 0 };
  }).sort((a, b) => Number(b.joined) - Number(a.joined) || String(a.name).localeCompare(String(b.name)));
  return {
    title: cls.title, when: whenText(cls.startsAt), invited: rows.length, joined: rows.filter((r) => r.joined).length, rows,
    note: 'Joined means the person opened the meeting link through EduOS. It does not show how long they stayed.',
  };
}

/** Reminds everyone of classes about to start. Safe to run every minute: each class is reminded once. */
export async function sendReminders(actor, { now = new Date(), withinMinutes = 20 } = {}) {
  const soon = await OnlineClass.find({ status: 'SCHEDULED', reminderSentAt: null, startsAt: { $gt: now, $lte: new Date(now.getTime() + withinMinutes * 60_000) } });
  let messages = 0;
  for (const cls of soon) {
    // eslint-disable-next-line no-await-in-loop
    const out = await announce(cls, 'CLASS_REMINDER', actor);
    messages += out.recipients ?? 0;
    cls.reminderSentAt = now;
    // eslint-disable-next-line no-await-in-loop
    await cls.save();
  }
  // A class nobody closed is closed an hour after its end, so lists stay truthful.
  const stale = await OnlineClass.updateMany({ status: { $in: ['SCHEDULED', 'LIVE'] }, endsAt: { $lt: new Date(now.getTime() - 3_600_000) } }, { $set: { status: 'ENDED', endedAt: now } });
  return { reminded: soon.length, recipients: messages, closed: stale.modifiedCount ?? 0 };
}

/** What the scheduling form needs: the classes the caller may schedule for, and how meetings can be held. */
export async function options(actor) {
  requireProfile(actor);
  const filter = isManager(actor) ? {} : { _id: { $in: await getTeacherSectionIds(actor.profileId) } };
  const sections = await Section.find(filter).populate('gradeId', 'name').lean();
  const base = jitsiBase();
  return {
    sections: sections.map((s) => ({ id: String(s._id), label: `${s.gradeId?.name ?? ''} ${s.name}`.trim() })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
    kinds: KINDS,
    canInviteRoles: isManager(actor),
    staffRoles: STAFF_ROLES,
    providers: [
      { key: 'JITSI', label: 'Built-in room (Jitsi Meet)', needsLink: false, note: base === 'https://meet.jit.si' ? 'A room is created for you on the public Jitsi Meet service. Anyone with the link can enter, so do not share it outside EduOS.' : `A room is created for you on ${base}.` },
      { key: 'GOOGLE_MEET', label: 'Google Meet', needsLink: true, note: 'Create the meeting in Google Meet and paste its link.' },
      { key: 'ZOOM', label: 'Zoom', needsLink: true, note: 'Create the meeting in Zoom and paste its link.' },
      { key: 'TEAMS', label: 'Microsoft Teams', needsLink: true, note: 'Create the meeting in Teams and paste its link.' },
      { key: 'OTHER', label: 'Another service', needsLink: true, note: 'Paste the meeting link.' },
    ],
  };
}

export async function stats(actor) {
  requireProfile(actor);
  const now = new Date();
  const dayEnd = new Date(now.getTime() + 86_400_000);
  const scope = seesAll(actor) ? {} : { hostProfileId: actor.profileId };
  const [today, live, week] = await Promise.all([
    OnlineClass.countDocuments({ ...scope, status: { $in: ['SCHEDULED', 'LIVE'] }, startsAt: { $lt: dayEnd }, endsAt: { $gt: now } }),
    OnlineClass.countDocuments({ ...scope, status: 'LIVE' }),
    OnlineClass.countDocuments({ ...scope, status: { $in: ['SCHEDULED', 'LIVE'] }, startsAt: { $gte: now, $lt: new Date(now.getTime() + 7 * 86_400_000) } }),
  ]);
  return { next24Hours: today, liveNow: live, next7Days: week };
}

/**
 * For the PTM module: a private online parent meeting with one teacher, in a
 * fresh Jitsi room. The family is the only invitee, so the room is joined
 * through join() like any other class (the link is never listed). PTM sends
 * its own day-before and hour-before reminders, so this class is marked as
 * reminded to avoid a second notice. Nothing is announced here either: the
 * booking confirmation says it all. Calls are never recorded.
 */
export async function createParentMeeting({ hostProfileId, hostName = null, parentProfileId, title, startsAt, endsAt, description = null, actor = null }) {
  const cls = new OnlineClass({
    refNo: await nextRef('CLS'), kind: 'PARENT_MEETING', title: String(title).slice(0, 200),
    description: description ? String(description).slice(0, 4000) : null,
    hostProfileId, hostName, sectionIds: [], inviteeProfileIds: [parentProfileId], inviteeRoles: [], includeGuardians: false,
    startsAt, endsAt, provider: 'JITSI', joinUrl: meetingLink('JITSI'), reminderSentAt: new Date(), history: [],
  });
  pushHistory(cls, actor, 'SCHEDULED', { to: 'SCHEDULED', note: 'PTM booking' });
  await cls.save();
  return cls;
}

/** For the PTM module: cancels the online room of a cancelled or moved booking (quietly; PTM tells the family). */
export async function cancelParentMeeting(id, { reason = 'PTM booking cancelled', actor = null } = {}) {
  if (!id) return null;
  const cls = await OnlineClass.findById(id);
  if (!cls || !['SCHEDULED', 'LIVE'].includes(cls.status)) return null;
  const from = cls.status;
  cls.status = 'CANCELLED'; cls.cancelReason = String(reason).slice(0, 300);
  pushHistory(cls, actor, 'CANCELLED', { from, to: 'CANCELLED', note: cls.cancelReason });
  await cls.save();
  return cls;
}
