import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { Document } from '../../models/document.model.js';
import { Enrollment } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import { env } from '../../config/env.js';
import { getOwnStudentId, getGuardianStudentIds } from '../../utils/scope.js';
import { paginate, mapPage } from '../../utils/paginate.js';

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
async function buildVisibilityFilter(actor, scope, studentId, categories = {}) {
  const role = actor?.roleKey;
  const profileId = actor?.profileId;
  const query = {};

  if (studentId) query.studentId = studentId;

  // Narrowing only — these never widen what the visibility rules below allow,
  // so they are safe to take straight from the query string. A school-wide
  // reader now sees every document the school holds, which is a lot to page
  // through without them.
  if (categories.type) query.type = categories.type;
  if (categories.sectionId) query.sectionId = categories.sectionId;
  if (categories.subjectOfferingId) query.subjectOfferingId = categories.subjectOfferingId;

  // School-wide readers see the school's material; everyone else sees what was
  // published to their role.
  //
  // This used to test `role !== 'ADMIN'` — a hardcoded role string rather than
  // the permission the route is guarded by. A Principal and a Super Admin both
  // hold materials.read at ALL, but neither is literally "ADMIN", so both fell
  // through to `visibleToRoles: 'PRINCIPAL'` / `'SUPER_ADMIN'` — a tag course
  // material never carries — and saw an all-but-empty list. Reading the scope
  // instead means the grant decides, as it does everywhere else.
  //
  // Which school's material that is remains settled by the tenant plugin on
  // Document, so a School Admin at ALL scope still sees only their own school.
  if (scope !== 'ALL') {
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

/**
 * Deletes a document the actor is entitled to delete.
 *
 * Moved here from document.controller.js so the rule has one home: a
 * school-wide holder of materials.manage may delete any document, anyone else
 * only their own. The controller and the MCP tool both call this, so neither
 * can drift into a looser version of the check.
 *
 * Returns what was deleted, so a caller can say which document is gone.
 */
export async function deleteForActor(actor, scope, id) {
  const doc = await findDeletableForActor(actor, scope, id);
  await Document.deleteOne({ _id: doc._id });
  return { id: String(doc._id), title: doc.title, type: doc.type };
}

/**
 * The document, if this actor may delete it — the rule deleteForActor applies,
 * without deleting anything.
 *
 * Exported so a caller can check before it asks somebody to confirm: the
 * assistant names the document in its confirmation prompt and refuses up front
 * rather than asking a person to approve a deletion that cannot happen.
 */
export async function findDeletableForActor(actor, scope, id) {
  const doc = await Document.findById(id);
  if (!doc) throw new AppError('Document not found', 404);

  if (scope !== 'ALL' && String(doc.authorProfileId) !== String(actor?.profileId)) {
    throw new AppError('Not authorized to delete this document', 403);
  }
  return doc;
}

export async function listForActor(actor, scope, studentId, opts = {}) {
  const query = await buildVisibilityFilter(actor, scope, studentId, {
    type: opts.type,
    sectionId: opts.sectionId,
    subjectOfferingId: opts.subjectOfferingId,
  });
  const page = await paginate(
    Document.find(query).sort({ createdAt: -1 }),
    Document,
    query,
    { page: opts.page, pageSize: opts.pageSize, label: 'documents.listForActor' }
  );

  return mapPage(page, (d) => ({
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
