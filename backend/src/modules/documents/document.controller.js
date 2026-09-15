import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './document.service.js';

export const listDocuments = asyncHandler(async (req, res) => {
  const documents = await service.listForActor(req.actor, req.scope, req.query.studentId, {
    page: req.query.page,
    pageSize: req.query.pageSize,
    // The categories a document is already filed under. Narrowing only — the
    // visibility rules still decide what is reachable at all.
    type: req.query.type,
    sectionId: req.query.sectionId,
    subjectOfferingId: req.query.subjectOfferingId,
  });
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
  // The rules — no manually uploaded ID cards, and a teacher may only add
  // course material for a class they actually teach — live in
  // document.service.createForActor(), so any future caller meets them too.
  const doc = await service.createForActor(req.actor, req.scope, req.body);
  sendSuccess(res, { id: doc._id }, 'Document created successfully', 201);
});

export const updateDocument = asyncHandler(async (req, res) => {
  const doc = await service.updateForActor(req.actor, req.scope, req.params.id, req.body);
  sendSuccess(res, { id: doc._id }, 'Document updated successfully');
});

export const deleteDocument = asyncHandler(async (req, res) => {
  // The rule — a school-wide holder of materials.manage, or the author — lives
  // in document.service.deleteForActor(), so this route and the assistant's
  // delete_document tool enforce exactly the same check.
  await service.deleteForActor(req.actor, req.scope, req.params.id);
  sendSuccess(res, null, 'Document deleted successfully');
});
