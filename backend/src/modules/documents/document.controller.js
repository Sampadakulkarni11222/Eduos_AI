import { Document } from '../../models/document.model.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import { getTeacherSectionIds } from '../../utils/scope.js';
import * as service from './document.service.js';

export const listDocuments = asyncHandler(async (req, res) => {
  const documents = await service.listForActor(req.actor, req.scope, req.query.studentId);
  sendSuccess(res, documents, 'Documents retrieved successfully');
});

export const getFile = asyncHandler(async (req, res) => {
  const file = await service.getFileForActor(req.actor, req.scope, req.params.id);
  if (file.external) {
    return res.redirect(file.external);
  }
  res.type(file.mimeType || 'application/octet-stream');
  res.sendFile(file.absolutePath);
});

export const createDocument = asyncHandler(async (req, res) => {
  const { title, fileUrl, mimeType, visibleToRoles, studentId, academicYearId, sectionId, subjectOfferingId } = req.body;
  let { type } = req.body;

  if (!title || !fileUrl) {
    throw new AppError('Title and fileUrl are required', 400);
  }

  // ID cards are generated on demand from live student/enrollment data
  // (see GET /students/:id/id-card) — never manually uploaded/linked, which
  // is exactly how a stray external URL ended up masquerading as one.
  if (type === 'ID_CARD') {
    throw new AppError('ID cards are generated automatically and cannot be uploaded manually', 400);
  }

  let resolvedSectionId = sectionId || null;

  if (req.scope === 'OWN' && req.actor.roleKey === 'TEACHER') {
    // Teachers may only ever upload course material, scoped to a class they
    // actually teach — never official documents (report cards, ID cards…).
    type = 'CUSTOM';
    if (!resolvedSectionId) throw new AppError('sectionId is required', 400);
    const mySections = await getTeacherSectionIds(req.actor.profileId);
    if (!mySections.includes(String(resolvedSectionId))) {
      throw new AppError('You do not teach this section', 403);
    }
  }

  const doc = await Document.create({
    title,
    type: type || 'CUSTOM',
    fileUrl,
    mimeType,
    visibleToRoles: visibleToRoles || [],
    studentId: studentId || null,
    academicYearId: academicYearId || null,
    sectionId: resolvedSectionId,
    subjectOfferingId: subjectOfferingId || null,
    authorProfileId: req.actor.profileId
  });

  sendSuccess(res, { id: doc._id }, 'Document created successfully', 201);
});

export const updateDocument = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const doc = await Document.findById(id);
  if (!doc) throw new AppError('Document not found', 404);

  const role = req.actor?.roleKey;
  const profileId = req.actor?.profileId;

  if (req.scope === 'OWN' && role === 'TEACHER') {
    if (String(doc.authorProfileId) !== String(profileId)) {
      throw new AppError('Not authorized to edit this document', 403);
    }
    if (doc.type !== 'CUSTOM') {
      throw new AppError('Only course material can be edited', 403);
    }
  }

  const { title, fileUrl, mimeType, visibleToRoles, sectionId, subjectOfferingId } = req.body;

  if (sectionId !== undefined && req.scope === 'OWN' && role === 'TEACHER') {
    const mySections = await getTeacherSectionIds(profileId);
    if (sectionId && !mySections.includes(String(sectionId))) {
      throw new AppError('You do not teach this section', 403);
    }
  }

  if (title !== undefined) doc.title = title;
  if (fileUrl !== undefined) doc.fileUrl = fileUrl;
  if (mimeType !== undefined) doc.mimeType = mimeType;
  if (visibleToRoles !== undefined) doc.visibleToRoles = visibleToRoles;
  if (sectionId !== undefined) doc.sectionId = sectionId || null;
  if (subjectOfferingId !== undefined) doc.subjectOfferingId = subjectOfferingId || null;

  await doc.save();
  sendSuccess(res, { id: doc._id }, 'Document updated successfully');
});

export const deleteDocument = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const doc = await Document.findById(id);
  if (!doc) {
    throw new AppError('Document not found', 404);
  }

  const role = req.actor?.roleKey;
  const profileId = req.actor?.profileId;

  // Only allow admin, owner, or the author to delete
  if (role !== 'ADMIN' && role !== 'OWNER' && String(doc.authorProfileId) !== String(profileId)) {
    throw new AppError('Not authorized to delete this document', 403);
  }

  await Document.deleteOne({ _id: id });
  sendSuccess(res, null, 'Document deleted successfully');
});
