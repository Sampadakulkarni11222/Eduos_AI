import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { Document } from '../../models/document.model.js';
import { Enrollment } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import { env } from '../../config/env.js';
import { getOwnStudentId, getGuardianStudentIds } from '../../utils/scope.js';

const uploadDir = resolve(process.cwd(), env.UPLOAD_DIR);

/** Resolve the section IDs a student/parent's own enrollments belong to. */
async function getOwnSectionIds(actor) {
  let studentIds = [];
  if (actor.roleKey === 'STUDENT') {
    const id = await getOwnStudentId(actor.profileId);
    if (id) studentIds = [id];
  } else if (actor.roleKey === 'PARENT') {
    studentIds = await getGuardianStudentIds(actor.profileId);
  }
  if (studentIds.length === 0) return [];
  const enrollments = await Enrollment.find({ studentId: { $in: studentIds } }).select('sectionId');
  return [...new Set(enrollments.map((e) => e.sectionId.toString()))];
}

/**
 * Builds the Document query filter a given actor/scope is allowed to see.
 * Shared by the list endpoint and the file-download endpoint so a document
 * that isn't listable can never be fetched directly by id either.
 */
async function buildVisibilityFilter(actor, scope, studentId) {
  const role = actor?.roleKey;
  const profileId = actor?.profileId;
  const query = {};

  if (studentId) query.studentId = studentId;

  if (role !== 'ADMIN' && role !== 'OWNER') {
    if (role === 'TEACHER') {
      query.$or = [{ visibleToRoles: role }, { authorProfileId: profileId }];
    } else {
      query.visibleToRoles = role;
    }
  }

  // Course material (type CUSTOM) is additionally scoped to the caller's own
  // section for students/parents — a material uploaded for one class must
  // not be visible to every student in that role school-wide. Materials
  // seeded before section-scoping existed (sectionId null) stay visible to
  // everyone in the granted role, for back-compat.
  if (scope === 'OWN' && (role === 'STUDENT' || role === 'PARENT')) {
    const sectionIds = await getOwnSectionIds(actor);
    query.$and = [
      { $or: [{ type: { $ne: 'CUSTOM' } }, { sectionId: null }, { sectionId: { $in: sectionIds } }] },
    ];
  }

  return query;
}

export async function listForActor(actor, scope, studentId) {
  const query = await buildVisibilityFilter(actor, scope, studentId);
  const documents = await Document.find(query).sort({ createdAt: -1 });

  return documents.map((d) => ({
    id: d._id,
    title: d.title,
    type: d.type,
    fileUrl: d.fileUrl,
    mimeType: d.mimeType,
    visibleToRoles: d.visibleToRoles,
    sectionId: d.sectionId ?? null,
    subjectOfferingId: d.subjectOfferingId ?? null,
    issuedAt: d.createdAt.toISOString(),
  }));
}

/**
 * Resolves a document's on-disk file for a given actor, re-checking the
 * same visibility rule used for listing so a document that wouldn't appear
 * in someone's list can't be fetched directly by id either.
 */
export async function getFileForActor(actor, scope, id) {
  const doc = await Document.findById(id);
  if (!doc) throw new AppError('Document not found', 404);

  const query = await buildVisibilityFilter(actor, scope);
  const visible = await Document.exists({ _id: id, ...query });
  if (!visible) throw new AppError('Document not found', 404);

  if (!doc.fileUrl.startsWith('/uploads/')) {
    // Legacy/manually-pasted external link — nothing on our disk to serve.
    logger.warn(`Document ${id} has a non-local fileUrl (${doc.fileUrl}); serving as external redirect`);
    return { external: doc.fileUrl };
  }

  const absolutePath = join(uploadDir, doc.fileUrl.replace('/uploads/', ''));
  if (!existsSync(absolutePath)) {
    throw new AppError('This document is no longer available. Please contact the school office.', 404, [], 'FILE_NOT_FOUND');
  }

  return { absolutePath, mimeType: doc.mimeType, title: doc.title };
}
