import { Document } from '../../models/document.model.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';

export const listDocuments = asyncHandler(async (req, res) => {
  const { studentId } = req.query;
  const role = req.actor?.roleKey; // e.g. 'STUDENT', 'PARENT', 'TEACHER', 'ADMIN', 'OWNER'
  const profileId = req.actor?.profileId;

  const query = {};

  if (studentId) {
    query.studentId = studentId;
  }

  // Basic visibility filter
  if (role !== 'ADMIN' && role !== 'OWNER') {
    // Teachers see what they uploaded
    if (role === 'TEACHER') {
      query.$or = [{ visibleToRoles: role }, { authorProfileId: profileId }];
    } else {
      query.visibleToRoles = role;
    }
  }

  const documents = await Document.find(query).sort({ createdAt: -1 });

  // Map to DocumentDto
  const dtos = documents.map(d => ({
    id: d._id,
    title: d.title,
    type: d.type,
    fileUrl: d.fileUrl,
    mimeType: d.mimeType,
    visibleToRoles: d.visibleToRoles,
    issuedAt: d.createdAt.toISOString()
  }));

  sendSuccess(res, dtos, 'Documents retrieved successfully');
});

export const createDocument = asyncHandler(async (req, res) => {
  const { title, type, fileUrl, mimeType, visibleToRoles, studentId, academicYearId } = req.body;

  if (!title || !fileUrl) {
    throw new AppError('Title and fileUrl are required', 400);
  }

  const doc = await Document.create({
    title,
    type: type || 'CUSTOM',
    fileUrl,
    mimeType,
    visibleToRoles: visibleToRoles || [],
    studentId: studentId || null,
    academicYearId: academicYearId || null,
    authorProfileId: req.actor.profileId
  });

  sendSuccess(res, { id: doc._id }, 'Document created successfully', 201);
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
