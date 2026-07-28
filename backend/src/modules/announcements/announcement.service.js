import mongoose from 'mongoose';
import { Announcement } from '../../models/announcement.model.js';
import { Grade, Section, Subject, SubjectOffering } from '../../models/academics.model.js';
import { getTeacherSectionIds } from '../../utils/scope.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import { isLiveMode } from '../whatsapp/whatsapp.service.js';
import { env } from '../../config/env.js';

const isId = (v) => mongoose.isValidObjectId(v);

/**
 * Builds the stored audience shape, restricting a scope:'OWN' actor (a
 * subject/class teacher) to the grades/sections/subjects they actually
 * teach — everyone else (scope 'ALL': admin/principal/owner) may target
 * anything.
 */
async function resolveAudience(actor, scope, requested) {
  const gradeIds = [...new Set((requested?.gradeIds ?? []).filter(isId))];
  const sectionIds = [...new Set((requested?.sectionIds ?? []).filter(isId))];
  const subjectIds = [...new Set((requested?.subjectIds ?? []).filter(isId))];

  if (requested?.all || (!gradeIds.length && !sectionIds.length && !subjectIds.length)) {
    return { all: true, gradeIds: [], sectionIds: [], subjectIds: [] };
  }

  if (scope !== 'ALL') {
    const ownSectionIds = new Set(await getTeacherSectionIds(actor.profileId));
    const ownOfferings = await SubjectOffering.find({ teacherId: actor.profileId }).select('subjectId sectionId');
    const ownSubjectIds = new Set(ownOfferings.map((o) => o.subjectId.toString()));
    const ownGradeIds = new Set(
      (await Section.find({ _id: { $in: [...ownSectionIds] } }).select('gradeId')).map((s) => s.gradeId.toString())
    );
    const outOfScope =
      sectionIds.some((id) => !ownSectionIds.has(id)) ||
      gradeIds.some((id) => !ownGradeIds.has(id)) ||
      subjectIds.some((id) => !ownSubjectIds.has(id));
    if (outOfScope) {
      throw new AppError('You can only announce to classes or subjects you teach', 403);
    }
  }

  return { all: false, gradeIds, sectionIds, subjectIds };
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

export const list = async () => {
  const items = await Announcement.find({ deletedAt: null }).sort({ publishedAt: -1 }).lean();
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

export const create = async (actor, scope, data) => {
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
    createdByProfileId: actor.profileId,
  });
  dispatch(doc, channels);
  return doc;
};
