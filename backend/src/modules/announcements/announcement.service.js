import mongoose from 'mongoose';
import { Announcement } from '../../models/announcement.model.js';
import { Grade, Section, Subject, SubjectOffering } from '../../models/academics.model.js';
import { Role } from '../../models/role.model.js';
import { Profile } from '../../models/profile.model.js';
import { Enrollment } from '../../models/student.model.js';
import { getTeacherSectionIds, getGuardianStudentIds, getOwnStudentId } from '../../utils/scope.js';
import { currentTenantId } from '../../tenancy/tenantContext.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import { isLiveMode } from '../whatsapp/whatsapp.service.js';
import { env } from '../../config/env.js';

const isId = (v) => mongoose.isValidObjectId(v);

/**
 * The roles a teacher may address: the families of the classes they teach.
 * Reaching colleagues or administrators is a school-wide act and belongs to an
 * actor holding announcements.publish at ALL scope.
 */
const TEACHER_TARGETABLE_ROLES = ['STUDENT', 'PARENT'];

/** Everything the acting teacher is entitled to address. */
async function teacherReach(profileId) {
  const sectionIds = new Set(await getTeacherSectionIds(profileId));
  const offerings = await SubjectOffering.find({ teacherId: profileId }).select('subjectId');
  const ownSections = await Section.find({ _id: { $in: [...sectionIds] } }).select('gradeId');

  // A grade is only addressable if the teacher covers every section in it.
  // Teaching 6-A does not entitle anyone to address Class 6, which would carry
  // the message into 6-B as well — the rule this replaces allowed exactly that.
  const candidateGradeIds = [...new Set(ownSections.map((s) => s.gradeId.toString()))];
  const gradeIds = new Set();
  for (const gradeId of candidateGradeIds) {
    const siblings = await Section.find({ gradeId }).select('_id');
    if (siblings.every((s) => sectionIds.has(s._id.toString()))) gradeIds.add(gradeId);
  }

  return {
    sectionIds,
    subjectIds: new Set(offerings.map((o) => o.subjectId.toString())),
    gradeIds,
  };
}

/**
 * Every id must name something in the acting school.
 *
 * These reads are tenant-scoped, so an id belonging to another school is
 * simply not found — which is what stops a School Admin addressing another
 * school's classes by pasting its ids into the request.
 */
async function assertTargetsExist({ gradeIds, sectionIds, subjectIds }) {
  const checks = [
    [Grade, gradeIds, 'class'],
    [Section, sectionIds, 'section'],
    [Subject, subjectIds, 'subject'],
  ];
  for (const [Model, ids, label] of checks) {
    if (!ids.length) continue;
    const found = await Model.countDocuments({ _id: { $in: ids } });
    if (found !== ids.length) {
      throw new AppError(`One or more ${label}es in the audience do not belong to this school`, 403);
    }
  }
}

/** Role targeting is optional; when used, the keys have to be real and allowed. */
async function assertRolesAllowed(roleKeys, allowed) {
  if (!roleKeys.length) return;

  const known = new Set(
    (await Role.find({ key: { $in: roleKeys } }).select('key').lean()).map((r) => r.key),
  );
  const unknown = roleKeys.filter((k) => !known.has(k));
  if (unknown.length) {
    throw new AppError(`Unknown role(s) in the audience: ${unknown.join(', ')}`, 400);
  }

  if (allowed === 'ANY') return;
  const refused = roleKeys.filter((k) => !allowed.includes(k));
  if (refused.length) {
    throw new AppError(`You are not allowed to announce to: ${refused.join(', ')}`, 403);
  }
}

/**
 * Builds the stored audience, and decides whether this actor may address it.
 *
 * The ordering is the whole point of this function: "everyone" used to be
 * returned before the scope check ran, so a teacher who asked for all — or who
 * simply left the audience empty, which both the composer and the agent did by
 * default — reached the entire school. Nothing may resolve to everyone until
 * the actor has been shown to be entitled to it.
 */
async function resolveAudience(actor, scope, requested) {
  const gradeIds = [...new Set((requested?.gradeIds ?? []).filter(isId))];
  const sectionIds = [...new Set((requested?.sectionIds ?? []).filter(isId))];
  const subjectIds = [...new Set((requested?.subjectIds ?? []).filter(isId))];
  const roleKeys = [...new Set(
    (requested?.roleKeys ?? []).map((r) => String(r).trim().toUpperCase()).filter(Boolean),
  )];
  const nothingChosen = !gradeIds.length && !sectionIds.length && !subjectIds.length && !roleKeys.length;

  // ── school-wide authority: admin, principal ──────────────
  if (scope === 'ALL') {
    if (requested?.all === true || nothingChosen) {
      return { all: true, gradeIds: [], sectionIds: [], subjectIds: [], roleKeys };
    }
    await assertTargetsExist({ gradeIds, sectionIds, subjectIds });
    await assertRolesAllowed(roleKeys, 'ANY');
    return { all: false, gradeIds, sectionIds, subjectIds, roleKeys };
  }

  // ── a teacher, limited to what they teach ────────────────
  const own = await teacherReach(actor.profileId);
  if (own.sectionIds.size === 0) {
    throw new AppError('You are not assigned to any class, so you cannot post an announcement', 403);
  }
  if (requested?.all === true) {
    throw new AppError('You can only announce to classes or subjects you teach', 403);
  }

  // No audience chosen means their own classes — never the whole school. It is
  // written out in full so the record says exactly who was addressed.
  if (nothingChosen) {
    return { all: false, gradeIds: [], sectionIds: [...own.sectionIds], subjectIds: [], roleKeys };
  }

  const outOfScope =
    sectionIds.some((id) => !own.sectionIds.has(id)) ||
    gradeIds.some((id) => !own.gradeIds.has(id)) ||
    subjectIds.some((id) => !own.subjectIds.has(id));
  if (outOfScope) {
    throw new AppError('You can only announce to classes or subjects you teach', 403);
  }
  await assertRolesAllowed(roleKeys, TEACHER_TARGETABLE_ROLES);

  return { all: false, gradeIds, sectionIds, subjectIds, roleKeys };
}

/**
 * The classes, subjects and role the reader belongs to.
 *
 * Targeting is only real if it also governs who can *read* the result: an
 * announcement addressed to 6-A used to be listed for the whole school, so the
 * audience decided the label and nothing else. This resolves the same three
 * dimensions the audience is written in, from whichever side the reader sits.
 */
async function readerReach(actor) {
  let sectionIds = [];

  if (actor?.roleKey === 'TEACHER') {
    sectionIds = await getTeacherSectionIds(actor.profileId);
  } else if (actor?.roleKey === 'STUDENT') {
    const studentId = await getOwnStudentId(actor.profileId);
    if (studentId) {
      const enrolments = await Enrollment.find({ studentId, status: 'ACTIVE' }).select('sectionId').lean();
      sectionIds = enrolments.map((e) => e.sectionId?.toString()).filter(Boolean);
    }
  } else if (actor?.roleKey === 'PARENT') {
    const studentIds = await getGuardianStudentIds(actor.profileId);
    if (studentIds.length) {
      const enrolments = await Enrollment.find({
        studentId: { $in: studentIds }, status: 'ACTIVE',
      }).select('sectionId').lean();
      sectionIds = enrolments.map((e) => e.sectionId?.toString()).filter(Boolean);
    }
  }

  sectionIds = [...new Set(sectionIds)];
  if (!sectionIds.length) return { sectionIds: [], gradeIds: [], subjectIds: [] };

  // A grade-wide announcement reaches every section under it, and a
  // subject-wide one reaches the sections that subject is taught in.
  const [sections, offerings] = await Promise.all([
    Section.find({ _id: { $in: sectionIds } }).select('gradeId').lean(),
    SubjectOffering.find({ sectionId: { $in: sectionIds } }).select('subjectId').lean(),
  ]);

  return {
    sectionIds,
    gradeIds: [...new Set(sections.map((x) => x.gradeId?.toString()).filter(Boolean))],
    subjectIds: [...new Set(offerings.map((o) => o.subjectId?.toString()).filter(Boolean))],
  };
}

/**
 * The query clause limiting a reader to the announcements addressed to them.
 *
 * An actor holding announcements.publish school-wide (admin, principal) reads
 * everything — they are the ones running school communications, and the
 * composer lists what has been sent. Everyone else sees a notice only if it
 * was addressed to the whole school, to one of their classes, or to their role.
 */
/** Matches a list field that is empty, or absent on a pre-migration row. */
const unset = (field) => ({ $or: [{ [field]: { $size: 0 } }, { [field]: { $exists: false } }] });

async function audienceFilterFor(actor) {
  if (actor?.permissions?.['announcements.publish'] === 'ALL') return {};

  const reach = await readerReach(actor);
  const roleKey = actor?.roleKey ?? null;

  return {
    $and: [
      // Narrowing by role is optional. Empty (or absent, on rows written
      // before the field existed) means everyone in the classes named.
      {
        $or: [
          { 'audience.roleKeys': { $size: 0 } },
          { 'audience.roleKeys': { $exists: false } },
          ...(roleKey ? [{ 'audience.roleKeys': roleKey }] : []),
        ],
      },
      {
        $or: [
          // $ne:false rather than :true so an announcement written before the
          // audience field existed still reads as school-wide.
          { 'audience.all': { $ne: false } },
          // Narrowed by role alone — "every parent in the school" — names no
          // class, so it reaches the whole school subject to the role clause
          // above. Without this such a notice would reach nobody.
          {
            $and: [
              unset('audience.sectionIds'),
              unset('audience.gradeIds'),
              unset('audience.subjectIds'),
            ],
          },
          { 'audience.sectionIds': { $in: reach.sectionIds } },
          { 'audience.gradeIds': { $in: reach.gradeIds } },
          { 'audience.subjectIds': { $in: reach.subjectIds } },
          // Authors always see what they sent.
          ...(actor?.profileId ? [{ createdByProfileId: actor.profileId }] : []),
        ],
      },
    ],
  };
}

/** Human-readable summary of who an announcement targets, for the list view. */
async function labelAudience(audience) {
  if (!audience || audience.all) return 'All classes';
  const parts = [];
  if (audience.sectionIds?.length) {
    const sections = await Section.find({ _id: { $in: audience.sectionIds } }).populate('gradeId');
    parts.push(sections.map((s) => `${s.gradeId?.name ?? ''} - ${s.name}`.trim()).join(', '));
  } else if (audience.gradeIds?.length) {
    const grades = await Grade.find({ _id: { $in: audience.gradeIds } });
    parts.push(grades.map((g) => g.name).join(', '));
  }
  if (audience.subjectIds?.length) {
    const subjects = await Subject.find({ _id: { $in: audience.subjectIds } });
    parts.push(subjects.map((s) => s.name).join(', '));
  }
  if (audience.roleKeys?.length) {
    parts.push(audience.roleKeys.map((r) => r.charAt(0) + r.slice(1).toLowerCase()).join(', '));
  }
  return parts.join(' · ') || 'All classes';
}

/** No live email/WhatsApp provider is wired up — this logs the fan-out the same way OTP delivery does in dev. */
function dispatch(announcement, channels) {
  if (channels.email) {
    logger.info(`[announcement:email] "${announcement.title}" queued (EMAIL_PROVIDER=${env.EMAIL_PROVIDER})`);
  }
  if (channels.whatsapp) {
    logger.info(`[announcement:whatsapp] "${announcement.title}" queued (mode=${isLiveMode() ? 'LIVE' : 'SIMULATION'})`);
  }
}

export const list = async (actor) => {
  const items = await Announcement.find({ deletedAt: null, ...(await audienceFilterFor(actor)) })
    .sort({ publishedAt: -1 })
    .lean();
  return Promise.all(
    items.map(async (a) => ({
      id: a._id.toString(),
      title: a.title,
      content: a.content,
      publishedAt: a.publishedAt,
      audience: a.audience,
      audienceLabel: await labelAudience(a.audience),
      channels: a.channels ?? { app: true, email: false, whatsapp: false },
    }))
  );
};

/**
 * Attachment URLs, restricted to files this server issued.
 *
 * The composer uploads through /uploads and sends back the `fileUrl` it was
 * given. Accepting an arbitrary string would turn every announcement into a
 * link the school appears to vouch for, so anything that is not one of our own
 * upload paths is dropped rather than stored.
 */
function normalizeAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .map((a) => (typeof a === 'string' ? a.trim() : ''))
    .filter((a) => a.startsWith('/uploads/'))
    .slice(0, 10);
}

/**
 * What an announcement *would* be, without writing one.
 *
 * The preview runs the same `resolveAudience` the send path runs, so what the
 * composer shows is the audience the server would actually accept — including
 * the refusal. A preview that resolved the audience in the browser would show
 * a teacher the whole school and then fail at send time, which is precisely
 * the confusion this is meant to remove. Nothing is created and nothing is
 * dispatched.
 */
export const preview = async (actor, scope, data) => {
  if (!currentTenantId()) {
    throw new AppError('Choose a school before posting an announcement', 400, [], 'SCHOOL_REQUIRED');
  }
  const audience = await resolveAudience(actor, scope, data.audience);
  const channels = {
    app: data.channels?.app ?? true,
    email: !!data.channels?.email,
    whatsapp: !!data.channels?.whatsapp,
  };
  const attachments = normalizeAttachments(data.attachments);
  const title = String(data.title ?? '').trim();
  const content = String(data.content ?? '').trim();

  return {
    title,
    content,
    audience,
    audienceLabel: await labelAudience(audience),
    recipientCount: await countRecipients(audience),
    channels,
    attachments,
    // Channel renderings are built here, not in the browser, so the preview
    // cannot drift from what the fan-out would send.
    email: channels.email
      ? { subject: title, body: content, attachments }
      : null,
    whatsapp: channels.whatsapp
      // WhatsApp's own markup: *bold* for the title, a blank line, the body.
      ? { body: `*${title}*\n\n${content}`, attachments }
      : null,
  };
};

/**
 * How many profiles the resolved audience reaches.
 *
 * Counted from enrolments and profiles rather than guessed, because "who will
 * actually receive this" is the one question a preview exists to answer.
 */
async function countRecipients(audience) {
  const roleKeys = audience.roleKeys ?? [];
  const roleFilter = async () => {
    if (!roleKeys.length) return {};
    const roles = await Role.find({ key: { $in: roleKeys } }).select('_id').lean();
    return { roleId: { $in: roles.map((r) => r._id) } };
  };

  if (audience.all || (!audience.sectionIds?.length && !audience.gradeIds?.length && !audience.subjectIds?.length)) {
    return Profile.countDocuments({
      tenantId: currentTenantId(), deletedAt: null, ...(await roleFilter()),
    });
  }

  let sectionIds = [...(audience.sectionIds ?? [])];
  if (audience.gradeIds?.length) {
    const sections = await Section.find({ gradeId: { $in: audience.gradeIds } }).select('_id').lean();
    sectionIds.push(...sections.map((s) => s._id));
  }
  if (audience.subjectIds?.length) {
    const offerings = await SubjectOffering.find({ subjectId: { $in: audience.subjectIds } }).select('sectionId').lean();
    sectionIds.push(...offerings.map((o) => o.sectionId));
  }
  sectionIds = [...new Set(sectionIds.map(String))];
  if (!sectionIds.length) return 0;

  // Students in those sections. Parents are reached through their children, so
  // counting enrolments is the honest floor for "people this reaches".
  return Enrollment.countDocuments({ sectionId: { $in: sectionIds }, status: 'ACTIVE' });
}

export const create = async (actor, scope, data) => {
  // An announcement belongs to a school. A platform administrator acting on no
  // school in particular has no audience to address, and the row would carry
  // no school of its own.
  if (!currentTenantId()) {
    throw new AppError('Choose a school before posting an announcement', 400, [], 'SCHOOL_REQUIRED');
  }

  const audience = await resolveAudience(actor, scope, data.audience);
  const channels = {
    app: data.channels?.app ?? true,
    email: !!data.channels?.email,
    whatsapp: !!data.channels?.whatsapp,
  };
  const doc = await Announcement.create({
    title: data.title,
    content: data.content,
    audience,
    channels,
    attachments: normalizeAttachments(data.attachments),
    createdByProfileId: actor.profileId,
  });
  dispatch(doc, channels);
  return doc;
};

/**
 * The announcements this actor posted themselves.
 *
 * Distinct from list(), which answers "what was addressed to me" — the right
 * question for a reader and the wrong one for deciding what somebody may
 * change. Editing is an author's act, so the target set is keyed on
 * authorship. Tenant-scoped by the model plugin, so it cannot reach another
 * school's notices.
 */
export const listMine = async (actor) => {
  const items = await Announcement.find({ deletedAt: null, createdByProfileId: actor?.profileId ?? null })
    .sort({ publishedAt: -1 })
    .lean();
  return Promise.all(
    items.map(async (a) => ({
      id: a._id.toString(),
      title: a.title,
      content: a.content,
      publishedAt: a.publishedAt,
      audience: a.audience,
      audienceLabel: await labelAudience(a.audience),
    }))
  );
};

/**
 * Changes an announcement that has already been published.
 *
 * The authorization rule is authorship: a school-wide publisher (admin,
 * principal) runs school communications and may correct any notice, while
 * anybody else may only change one they posted. Teaching the class a notice was
 * addressed to is deliberately NOT enough — a colleague's message is theirs,
 * and being able to read it is not a licence to rewrite it.
 *
 * Only the fields a person would actually correct can be touched, and an
 * audience change is re-resolved through resolveAudience(), so re-targeting is
 * checked exactly as it was when the notice was first published — a teacher
 * still cannot widen one to the whole school. `publishedAt`,
 * `createdByProfileId`, `deletedAt` and the school are the record's own
 * history and are never writable here.
 *
 * Deliberately does NOT re-dispatch: correcting a typo is not a reason to send
 * the notice to everybody a second time.
 */
export const update = async (actor, scope, id, data) => {
  if (!currentTenantId()) {
    throw new AppError('Choose a school before changing an announcement', 400, [], 'SCHOOL_REQUIRED');
  }
  const doc = await Announcement.findOne({ _id: id, deletedAt: null });
  if (!doc) throw new AppError('Announcement not found', 404);

  if (scope !== 'ALL' && String(doc.createdByProfileId ?? '') !== String(actor?.profileId ?? '')) {
    throw new AppError('You can only change an announcement you posted', 403);
  }

  if (data.title !== undefined) {
    const title = String(data.title).trim();
    if (!title) throw new AppError('An announcement needs a title', 400);
    doc.title = title;
  }
  if (data.content !== undefined) {
    const content = String(data.content).trim();
    if (!content) throw new AppError('An announcement needs a message', 400);
    doc.content = content;
  }
  if (data.audience !== undefined) {
    doc.audience = await resolveAudience(actor, scope, data.audience);
  }
  if (data.channels !== undefined) {
    doc.channels = {
      app: data.channels?.app ?? true,
      email: !!data.channels?.email,
      whatsapp: !!data.channels?.whatsapp,
    };
  }
  if (data.attachments !== undefined) {
    doc.attachments = normalizeAttachments(data.attachments);
  }

  await doc.save();
  return {
    id: doc._id.toString(),
    title: doc.title,
    content: doc.content,
    audience: doc.audience,
    audienceLabel: await labelAudience(doc.audience),
    publishedAt: doc.publishedAt,
  };
};
