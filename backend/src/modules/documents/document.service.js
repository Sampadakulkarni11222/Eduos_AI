import { existsSync } from 'fs';
import { join, resolve, sep } from 'path';
import { Document } from '../../models/document.model.js';
import { Section } from '../../models/academics.model.js';
import { Enrollment } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import { env } from '../../config/env.js';
import { getOwnStudentId, getGuardianStudentIds, getTeacherSectionIds } from '../../utils/scope.js';
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
 * The fields a document write may set.
 *
 * The controller's own allow-list, moved here unchanged. Everything outside it
 * — `type`, `authorProfileId`, `studentId`, the tenant — is either the
 * school's own record or decided below, never taken from a caller's payload.
 */
const WRITABLE_FIELDS = ['title', 'fileUrl', 'mimeType', 'visibleToRoles', 'sectionId', 'subjectOfferingId'];

// What POST /uploads hands back (`/uploads/<uuid>-<sanitised name>`), and
// nothing that could climb out of the upload directory.
const LOCAL_FILE_URL = /^\/uploads\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/**
 * A document's fileUrl is either a file this system stored or a web link.
 *
 * It used to be accepted as any string, and getFileForActor() joins a local
 * one onto the upload directory and streams it back — so `/uploads/../.env`
 * let anyone holding materials.manage (every teacher, for their own classes)
 * download the server's secrets. External links are limited to http(s): the
 * file route redirects to them, and a `javascript:` or `file:` target has no
 * business being a course material.
 */
function assertValidFileUrl(fileUrl) {
  const url = String(fileUrl ?? '').trim();
  if (LOCAL_FILE_URL.test(url) && !url.includes('..')) return url;
  if (/^https?:\/\/[^\s]+$/i.test(url)) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return url;
    } catch { /* falls through to the refusal */ }
  }
  throw new AppError(
    'fileUrl must be a file uploaded to this system (/uploads/...) or an http(s) link',
    400, [], 'INVALID_FILE_URL',
  );
}

/**
 * The class a document is filed under must belong to the acting school.
 *
 * Section is tenant-scoped, so a section from another school simply is not
 * found by this query — the tenant plugin is doing the work, and this is a
 * lookup rather than a second copy of the tenancy rule.
 *
 * It matters for a school-wide caller specifically. A teacher is already
 * bounded by getTeacherSectionIds(), which reads the same tenant-scoped
 * collection and therefore cannot return another school's section; but an ALL
 * scope skips that check entirely, and without this it could file a document
 * in its own school against a section belonging to a different one. Nothing
 * leaked — the row is stamped with the caller's school and unreadable from the
 * other — but the reference was meaningless, and a class-filtered read would
 * never match it.
 */
async function assertSectionInSchool(sectionId) {
  const section = await Section.findById(sectionId).select('_id');
  if (!section) {
    throw new AppError('That class does not belong to this school', 403, [], 'SECTION_NOT_IN_SCHOOL');
  }
}

/**
 * Creates a document the actor is entitled to create.
 *
 * Moved here from document.controller.js for the same reason deleteForActor
 * was: the rule needs one home. A controller-only check holds for HTTP callers
 * and nothing else, and MCP does not pass through the controller — so a tool
 * calling the service directly would have written course material for any
 * section, holding materials.manage at OWN. The check belongs where every
 * caller meets it.
 *
 * The teacher rule is unchanged in behaviour: a teacher may upload course
 * material and nothing else, scoped to a class they actually teach. ID cards
 * are refused outright for everyone — they are generated on demand from live
 * enrolment data (GET /students/:id/id-card), and accepting one as an upload is
 * how a stray external URL once masqueraded as one.
 *
 * Which school the document belongs to stays with the tenant plugin on
 * Document, exactly as it does for the read and delete paths.
 */
export async function createForActor(actor, scope, data = {}) {
  const { title, fileUrl, mimeType, visibleToRoles, studentId, academicYearId, subjectOfferingId } = data;
  let { type } = data;
  let resolvedSectionId = data.sectionId || null;

  if (!title || !fileUrl) {
    throw new AppError('Title and fileUrl are required', 400);
  }
  const safeFileUrl = assertValidFileUrl(fileUrl);

  if (type === 'ID_CARD') {
    throw new AppError('ID cards are generated automatically and cannot be uploaded manually', 400);
  }

  // Checked for every scope, before anything about who may use the section:
  // belonging to the school is a property of the reference itself.
  if (resolvedSectionId) await assertSectionInSchool(resolvedSectionId);

  if (scope === 'OWN' && actor?.roleKey === 'TEACHER') {
    type = 'CUSTOM';
    if (!resolvedSectionId) throw new AppError('sectionId is required', 400);
    const mySections = await getTeacherSectionIds(actor.profileId);
    if (!mySections.includes(String(resolvedSectionId))) {
      throw new AppError('You do not teach this section', 403);
    }
  }

  return Document.create({
    title,
    type: type || 'CUSTOM',
    fileUrl: safeFileUrl,
    mimeType,
    visibleToRoles: visibleToRoles || [],
    studentId: studentId || null,
    academicYearId: academicYearId || null,
    sectionId: resolvedSectionId,
    subjectOfferingId: subjectOfferingId || null,
    authorProfileId: actor?.profileId ?? null,
  });
}

/**
 * Updates a document the actor is entitled to update.
 *
 * Same rules the controller applied, in the place every caller reaches: an
 * OWN-scoped teacher may edit only material they authored, only while it is
 * course material, and may only move it to a section they teach. A school-wide
 * holder of materials.manage is unrestricted, as before.
 */
export async function updateForActor(actor, scope, id, data = {}) {
  const doc = await Document.findById(id);
  if (!doc) throw new AppError('Document not found', 404);

  const role = actor?.roleKey;
  const profileId = actor?.profileId;

  if (scope === 'OWN' && role === 'TEACHER') {
    if (String(doc.authorProfileId) !== String(profileId)) {
      throw new AppError('Not authorized to edit this document', 403);
    }
    if (doc.type !== 'CUSTOM') {
      throw new AppError('Only course material can be edited', 403);
    }
  }

  // A move to another school's class is refused whoever is asking, for the same
  // reason it is on create.
  if (data.sectionId) await assertSectionInSchool(data.sectionId);
  if (data.fileUrl !== undefined) data = { ...data, fileUrl: assertValidFileUrl(data.fileUrl) };

  // A move between classes is re-checked, so a teacher cannot hand their own
  // material to a section they do not teach.
  if (data.sectionId !== undefined && scope === 'OWN' && role === 'TEACHER') {
    const mySections = await getTeacherSectionIds(profileId);
    if (data.sectionId && !mySections.includes(String(data.sectionId))) {
      throw new AppError('You do not teach this section', 403);
    }
  }

  for (const field of WRITABLE_FIELDS) {
    if (data[field] === undefined) continue;
    doc[field] = field === 'sectionId' || field === 'subjectOfferingId' ? (data[field] || null) : data[field];
  }

  await doc.save();
  return doc;
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

  const unavailable = () =>
    new AppError('This document is no longer available. Please contact the school office.', 404, [], 'FILE_NOT_FOUND');

  if (!doc.fileUrl.startsWith('/uploads/')) {
    // Legacy/manually-pasted external link — nothing on our disk to serve.
    // Only ever redirect to the web; a stored javascript:/file: target is
    // treated as missing rather than handed to the browser.
    if (!/^https?:\/\//i.test(doc.fileUrl)) throw unavailable();
    logger.warn(`Document ${id} has a non-local fileUrl; serving as external redirect`);
    return { external: doc.fileUrl };
  }

  // Contained to the upload directory whatever the row says, so a traversal
  // stored before fileUrl was validated still cannot reach the rest of disk.
  const absolutePath = resolve(join(uploadDir, doc.fileUrl.slice('/uploads/'.length)));
  if (!absolutePath.startsWith(uploadDir + sep)) {
    logger.warn(`Document ${id} has a fileUrl outside the upload directory; refused`);
    throw unavailable();
  }
  if (!existsSync(absolutePath)) {
    throw new AppError('This document is no longer available. Please contact the school office.', 404, [], 'FILE_NOT_FOUND');
  }

  return { absolutePath, mimeType: doc.mimeType, title: doc.title };
}
