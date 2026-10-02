import { DocumentType, DocumentRequest } from '../../models/documentRequest.model.js';
import { AppError } from '../../utils/AppError.js';
import { recordAudit } from '../../utils/auditTrail.js';
import { assertObjectId, cleanDocumentType } from './documentRequest.validation.js';
import { assertSchoolContext } from './schoolContext.js';

/**
 * Document types: what a school issues, configured as data.
 *
 * Gated on `settings.manage` (school configuration) in the routes. Which
 * school's types these are is settled by the tenancy plugin on DocumentType —
 * a type from another school is simply not found.
 */

/**
 * Starting points a school can add with one click. They are written as
 * ordinary DocumentType rows — editable, renameable, deactivatable — and the
 * request workflow never refers to them by name.
 */
export const SUGGESTED_TYPES = [
  {
    name: 'Bonafide Certificate',
    description: "Certifies that the student is currently enrolled at the school.",
    instructions: 'State what the certificate is needed for (e.g. internship, bank account, scholarship).',
  },
  {
    name: 'Study Certificate',
    description: 'Certifies the period during which the student has studied at the school.',
    fields: [{ label: 'Academic years to cover', kind: 'text', required: false }],
  },
  {
    name: 'Character Certificate',
    description: "Attests to the student's conduct while at the school.",
  },
  {
    name: 'Fee Certificate',
    description: 'Confirms the fees paid by the student for a period.',
    fields: [{ label: 'Academic year', kind: 'text', required: true }],
  },
  {
    name: 'Leaving Certificate',
    description: 'Issued when a student leaves the school.',
    fields: [
      { label: 'Reason for leaving', kind: 'textarea', required: true },
      { label: 'Last date of attendance', kind: 'date', required: false },
    ],
  },
  {
    name: 'Transfer Certificate',
    description: 'Issued when a student transfers to another school.',
    fields: [
      { label: 'School transferring to', kind: 'text', required: true },
      { label: 'Last date of attendance', kind: 'date', required: false },
    ],
  },
  {
    name: 'Enrollment Certificate',
    description: 'Confirms the class the student is enrolled in for the current academic year.',
  },
];

export function toTypeDto(t, { forStudent = false } = {}) {
  const base = {
    id: String(t._id),
    name: t.name,
    description: t.description ?? '',
    instructions: t.instructions ?? '',
    fields: (t.fields ?? []).map((f) => ({ key: f.key, label: f.label, kind: f.kind, required: !!f.required, options: f.options ?? [] })),
  };
  if (forStudent) return base;
  return {
    ...base,
    isActive: !!t.isActive,
    requestEnabled: !!t.requestEnabled,
    maxFileSizeMb: t.maxFileSizeMb,
    allowedFileTypes: t.allowedFileTypes ?? [],
    createdAt: t.createdAt ? new Date(t.createdAt).toISOString() : null,
    updatedAt: t.updatedAt ? new Date(t.updatedAt).toISOString() : null,
  };
}

const duplicateName = () => new AppError('A document type with this name already exists', 409, [], 'DOCUMENT_TYPE_EXISTS');

export async function list() {
  assertSchoolContext();
  const types = await DocumentType.find().sort({ name: 1 }).lean();
  return types.map((t) => toTypeDto(t));
}

/** What a student may ask for: active and open to requests. */
export async function listRequestable() {
  const types = await DocumentType.find({ isActive: true, requestEnabled: true }).sort({ name: 1 }).lean();
  return types.map((t) => toTypeDto(t, { forStudent: true }));
}

export async function create(actor, body) {
  assertSchoolContext();
  const data = cleanDocumentType(body);
  try {
    const t = await DocumentType.create({ ...data, createdByProfileId: actor.profileId, updatedByProfileId: actor.profileId });
    await recordAudit({ actor, action: 'document_type.create', entityType: 'DocumentType', entityId: t._id, after: { name: t.name } });
    return toTypeDto(t);
  } catch (err) {
    if (err?.code === 11000) throw duplicateName();
    throw err;
  }
}

export async function update(actor, id, body) {
  assertSchoolContext();
  const t = await DocumentType.findById(assertObjectId(id, 'document type id'));
  if (!t) throw new AppError('Document type not found', 404, [], 'DOCUMENT_TYPE_NOT_FOUND');
  const data = cleanDocumentType(body, { partial: true });
  const before = { name: t.name, isActive: t.isActive, requestEnabled: t.requestEnabled };
  Object.assign(t, data, { updatedByProfileId: actor.profileId });
  try {
    await t.save();
  } catch (err) {
    if (err?.code === 11000) throw duplicateName();
    throw err;
  }
  await recordAudit({
    actor, action: 'document_type.update', entityType: 'DocumentType', entityId: t._id,
    before, after: { name: t.name, isActive: t.isActive, requestEnabled: t.requestEnabled },
  });
  return toTypeDto(t);
}

/** Deletes a type nobody has requested yet. One with requests is deactivated instead, so its history keeps its meaning. */
export async function remove(actor, id) {
  assertSchoolContext();
  const t = await DocumentType.findById(assertObjectId(id, 'document type id'));
  if (!t) throw new AppError('Document type not found', 404, [], 'DOCUMENT_TYPE_NOT_FOUND');
  if (await DocumentRequest.exists({ documentTypeId: t._id })) {
    throw new AppError('Students have requested this document type. Deactivate it instead.', 409, [], 'DOCUMENT_TYPE_IN_USE');
  }
  await t.deleteOne();
  await recordAudit({ actor, action: 'document_type.delete', entityType: 'DocumentType', entityId: t._id, before: { name: t.name } });
  return { id: String(t._id), deleted: true };
}

/** Adds whichever suggested types the school does not already have (matched by name). */
export async function addSuggested(actor) {
  assertSchoolContext();
  const existing = new Set((await DocumentType.find().select('nameKey').lean()).map((t) => t.nameKey));
  const created = [];
  const skipped = [];
  for (const suggestion of SUGGESTED_TYPES) {
    if (existing.has(suggestion.name.toLowerCase())) { skipped.push(suggestion.name); continue; }
    const data = cleanDocumentType({ maxFileSizeMb: 5, allowedFileTypes: ['pdf'], fields: [], ...suggestion });
    try {
      const t = await DocumentType.create({ ...data, createdByProfileId: actor.profileId, updatedByProfileId: actor.profileId });
      created.push(toTypeDto(t));
    } catch (err) {
      // Another admin added the same type a moment ago.
      if (err?.code === 11000) { skipped.push(suggestion.name); continue; }
      throw err;
    }
  }
  if (created.length) {
    await recordAudit({
      actor, action: 'document_type.add_suggested', entityType: 'DocumentType', entityId: null,
      after: { created: created.map((t) => t.name) },
    });
  }
  return { created, skipped };
}
