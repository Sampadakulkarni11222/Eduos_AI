import mongoose from 'mongoose';
import { AppError } from '../../utils/AppError.js';
import { env } from '../../config/env.js';

/**
 * Validation for document types, document requests and issued files.
 *
 * All of it runs on the server: the forms mirror these rules, but every
 * endpoint is reachable without them.
 */

const bad = (message, code) => new AppError(message, 400, [], code);

export const FIELD_KINDS = ['text', 'textarea', 'date', 'number', 'select'];
// What an official document may be. Each is recognised from the file's own
// bytes (see detectFileType), never from its name.
export const FILE_TYPES = ['pdf', 'png', 'jpeg'];
export const MAX_FILE_SIZE_MB = Math.max(1, Math.floor(env.UPLOAD_MAX_BYTES / (1024 * 1024)));

export function assertObjectId(value, label = 'id') {
  if (!value || !mongoose.isValidObjectId(String(value))) throw bad(`A valid ${label} is required`, 'INVALID_ID');
  return String(value);
}

/** Optional text: trimmed, capped, '' → null. Anything that isn't a string is refused. */
export function optionalText(value, label, max) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw bad(`${label} must be text`, 'INVALID_TEXT');
  const text = value.trim();
  if (text.length > max) throw bad(`${label} must be at most ${max} characters`, 'TEXT_TOO_LONG');
  return text || null;
}

export function requiredText(value, label, max, code) {
  const text = optionalText(value, label, max);
  if (!text) throw bad(`${label} is required`, code);
  return text;
}

const optionalBool = (value, label) => {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw bad(`${label} must be true or false`, 'INVALID_BOOLEAN');
  return value;
};

const slug = (label) => label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

/** The extra questions a document type asks. */
function cleanFields(raw) {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw bad('fields must be a list', 'DOCUMENT_TYPE_FIELDS_INVALID');
  if (raw.length > 20) throw bad('A document type can ask at most 20 questions', 'DOCUMENT_TYPE_FIELDS_INVALID');

  const keys = new Set();
  return raw.map((f, i) => {
    const label = requiredText(f?.label, `Field ${i + 1} label`, 80, 'DOCUMENT_TYPE_FIELD_LABEL_REQUIRED');
    let key = typeof f?.key === 'string' && f.key.trim() ? f.key.trim().toLowerCase() : slug(label);
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) key = `field_${slug(label) || i + 1}`.slice(0, 40);
    if (keys.has(key)) throw bad(`Two fields share the key "${key}"`, 'DOCUMENT_TYPE_FIELD_DUPLICATE');
    keys.add(key);

    const kind = f?.kind ?? 'text';
    if (!FIELD_KINDS.includes(kind)) throw bad(`Field "${label}" has an unknown kind`, 'DOCUMENT_TYPE_FIELD_KIND_INVALID');

    let options = [];
    if (kind === 'select') {
      if (!Array.isArray(f.options)) throw bad(`Field "${label}" needs a list of options`, 'DOCUMENT_TYPE_FIELD_OPTIONS_INVALID');
      options = [...new Set(f.options.map((o) => (typeof o === 'string' ? o.trim() : '')).filter(Boolean))];
      if (options.length < 1 || options.length > 30 || options.some((o) => o.length > 80)) {
        throw bad(`Field "${label}" needs between 1 and 30 options of up to 80 characters`, 'DOCUMENT_TYPE_FIELD_OPTIONS_INVALID');
      }
    }
    return { key, label, kind, required: f?.required === true, options };
  });
}

function cleanFileTypes(raw) {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw bad('allowedFileTypes must be a list', 'DOCUMENT_TYPE_FILE_TYPES_INVALID');
  const types = [...new Set(raw.map((t) => String(t).toLowerCase().replace(/^\./, '')).map((t) => (t === 'jpg' ? 'jpeg' : t)))];
  if (types.length === 0 || types.some((t) => !FILE_TYPES.includes(t))) {
    throw bad(`Allowed file types must be chosen from: ${FILE_TYPES.join(', ')}`, 'DOCUMENT_TYPE_FILE_TYPES_INVALID');
  }
  return types;
}

function cleanMaxSize(raw) {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_FILE_SIZE_MB) {
    throw bad(`Maximum file size must be a whole number of MB between 1 and ${MAX_FILE_SIZE_MB}`, 'DOCUMENT_TYPE_MAX_SIZE_INVALID');
  }
  return n;
}

/**
 * A document type create (`partial` false) or update (`partial` true). Only
 * fields present in the body are returned, so an update changes nothing it
 * was not asked to.
 */
export function cleanDocumentType(body = {}, { partial = false } = {}) {
  const out = {};
  if (!partial || body.name !== undefined) out.name = requiredText(body.name, 'Name', 120, 'DOCUMENT_TYPE_NAME_REQUIRED');
  if (body.description !== undefined) out.description = optionalText(body.description, 'Description', 2000) ?? '';
  if (body.instructions !== undefined) out.instructions = optionalText(body.instructions, 'Instructions', 2000) ?? '';
  const isActive = optionalBool(body.isActive, 'isActive');
  if (isActive !== undefined) out.isActive = isActive;
  const requestEnabled = optionalBool(body.requestEnabled, 'requestEnabled');
  if (requestEnabled !== undefined) out.requestEnabled = requestEnabled;
  const fields = cleanFields(body.fields);
  if (fields !== undefined) out.fields = fields;
  const maxFileSizeMb = cleanMaxSize(body.maxFileSizeMb);
  if (maxFileSizeMb !== undefined) out.maxFileSizeMb = maxFileSizeMb;
  const allowedFileTypes = cleanFileTypes(body.allowedFileTypes);
  if (allowedFileTypes !== undefined) out.allowedFileTypes = allowedFileTypes;
  return out;
}

function parseDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  const d = new Date(`${value.trim()}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The student's answers to a type's own questions, checked against that
 * type's configuration — required, kind, select options. Keys the type does
 * not ask for are dropped.
 */
export function cleanRequestData(type, raw = {}) {
  const answers = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return (type.fields ?? []).map((f) => {
    let value = answers[f.key];
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
      if (f.required) throw bad(`${f.label} is required`, 'DOCUMENT_REQUEST_FIELD_REQUIRED');
      return { key: f.key, label: f.label, value: null };
    }
    if (typeof value === 'number') value = String(value);
    if (typeof value !== 'string') throw bad(`${f.label} must be text`, 'DOCUMENT_REQUEST_FIELD_INVALID');
    value = value.trim();

    if (f.kind === 'date' && !parseDateOnly(value)) throw bad(`${f.label} must be a date (YYYY-MM-DD)`, 'DOCUMENT_REQUEST_FIELD_INVALID');
    if (f.kind === 'number' && !Number.isFinite(Number(value))) throw bad(`${f.label} must be a number`, 'DOCUMENT_REQUEST_FIELD_INVALID');
    if (f.kind === 'select' && !f.options.includes(value)) throw bad(`${f.label} must be one of the listed options`, 'DOCUMENT_REQUEST_FIELD_INVALID');
    const max = f.kind === 'textarea' ? 2000 : 500;
    if (value.length > max) throw bad(`${f.label} must be at most ${max} characters`, 'DOCUMENT_REQUEST_FIELD_INVALID');
    return { key: f.key, label: f.label, value };
  });
}

/** Optional "required by" date: YYYY-MM-DD, not in the past. */
export function cleanRequiredBy(value) {
  if (value === undefined || value === null || value === '') return null;
  const d = parseDateOnly(value);
  if (!d) throw bad('Required-by date must be a date (YYYY-MM-DD)', 'DOCUMENT_REQUEST_DATE_INVALID');
  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  if (d.getTime() < todayUtc) throw bad('Required-by date cannot be in the past', 'DOCUMENT_REQUEST_DATE_INVALID');
  return d;
}

/**
 * What a file actually is, from its first bytes. The upload endpoint checks
 * only the extension; an official document is held to what it contains.
 */
export function detectFileType(head) {
  if (!head || head.length < 4) return null;
  if (head.slice(0, 5).toString('latin1') === '%PDF-') return { type: 'pdf', mimeType: 'application/pdf' };
  if (head.length >= 8 && head.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { type: 'png', mimeType: 'image/png' };
  }
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { type: 'jpeg', mimeType: 'image/jpeg' };
  return null;
}

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
