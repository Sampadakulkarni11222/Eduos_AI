import crypto from 'node:crypto';
import { ImportFile } from '../../models/importFile.model.js';
import { Subject } from '../../models/academics.model.js';
import { AppError } from '../../utils/AppError.js';
import { env } from '../../config/env.js';
import { classFromText } from '../../utils/classNames.js';
import { writtenDatesIn, localToday } from '../../utils/naturalDates.js';
import { readSheet, sheetExtension, MAX_FILE_BYTES, toCsv, toXlsx, CONTENT_TYPES } from './sheet.js';
import { rankSchemas, mapHeaders, requiredSatisfied, parseEnum } from './mapping.js';
import { IMPORT_SCHEMAS, SCHEMA_BY_KEY, mayImport, schemasFor, meltSubjectColumns } from './schemas.js';

/**
 * Bulk import through Ask AI: a sheet in, the right records out.
 *
 *   storeFile    the bytes, hashed, kept for at most 24 hours
 *   previewImport  read → recognise the target → map the columns → check
 *                every row → "N ready, M with problems (row, column, problem,
 *                fix)". Writes nothing.
 *   runImport    the confirmed import: the same analysis again (so what runs
 *                is checked at the moment it runs), then the module's own bulk
 *                service for the rows that are ready, chunked. Idempotent per
 *                file hash and target, and per row: a corrected re-upload skips
 *                the rows an earlier import already wrote.
 *   errorReport  the problem rows with an Errors column, CSV or Excel
 *   template     headers, an example row and a Notes sheet, CSV or Excel
 *
 * Permissions are the target's own: the import route's permission (mayImport)
 * and, inside the service, its OWN-scope rules -- a teacher's attendance and
 * marks only for their classes and papers. Nothing here can do what the
 * screen's upload could not.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** The raw sheet: at most a day. */
export const RAW_TTL_MS = DAY_MS;
/** What is kept after an import (counts, row hashes): long enough to recognise a re-upload. */
export const RESULT_TTL_MS = 90 * DAY_MS;
/** How many problems a preview carries in full (the error report has all of them). */
const PROBLEMS_SHOWN = 50;

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

function notFound() {
  return new AppError('I could not find that file. Upload it again (it is kept for 24 hours).', 404, [], 'NOT_FOUND');
}

/* ── Files ───────────────────────────────────────────────────────────── */

/** Deletes expired sheets and strips raw bytes that are no longer needed. */
export async function purgeExpired(now = new Date()) {
  const gone = await ImportFile.deleteMany({ expiresAt: { $lte: now } });
  // Belt and braces for the TTL monitor: an imported file never keeps its bytes,
  // and its error rows (copies of the sheet's own rows) go after a day.
  await ImportFile.updateMany({ status: 'IMPORTED', data: { $ne: null } }, { $set: { data: null } });
  await ImportFile.updateMany(
    { importedAt: { $lte: new Date(now.getTime() - RAW_TTL_MS) }, 'result.errorSheet': { $exists: true } },
    { $unset: { 'result.errorSheet': 1 } },
  );
  return gone.deletedCount ?? 0;
}

/**
 * Keeps an uploaded sheet for preview. The file type and size limits are the
 * upload endpoint's and the bulk importers' own: .csv / .xlsx / .xls, 2 MB.
 */
export async function storeFile({ actor, channel = 'WEB', name, buffer }) {
  if (!actor?.profileId) throw new AppError('Sign in first.', 401);
  const originalName = String(name ?? '').split(/[\\/]/).pop().replace(/[^\p{L}\p{N}._ ()-]/gu, '_').slice(0, 120) || 'sheet';
  const ext = sheetExtension(originalName);
  if (!ext) throw new AppError('Only spreadsheets can be imported: .csv, .xlsx or .xls.', 415, [], 'UPLOAD_TYPE_NOT_ALLOWED');
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new AppError('The file is empty.', 400, [], 'IMPORT_EMPTY');
  if (buffer.length > MAX_FILE_BYTES) throw new AppError('The file is larger than 2 MB. Split it into smaller sheets.', 413, [], 'IMPORT_TOO_LARGE');
  // Fail fast on a file that is not a readable sheet at all.
  readSheet(buffer, ext);
  await purgeExpired().catch(() => {});
  const file = await ImportFile.create({
    uploaderProfileId: actor.profileId,
    channel: channel === 'WHATSAPP' ? 'WHATSAPP' : 'WEB',
    originalName,
    ext,
    size: buffer.length,
    sha256: sha256(buffer),
    data: buffer,
    expiresAt: new Date(Date.now() + RAW_TTL_MS),
  });
  return { fileId: String(file._id), name: originalName, size: buffer.length };
}

/** One of this person's files (never anybody else's). */
export async function loadFile(actor, fileId, { withData = false } = {}) {
  if (!/^[a-f0-9]{24}$/.test(String(fileId ?? ''))) throw notFound();
  const q = ImportFile.findOne({ _id: fileId, uploaderProfileId: actor.profileId, expiresAt: { $gt: new Date() } });
  if (withData) q.select('+data');
  const file = await q;
  if (!file) throw notFound();
  return file;
}

/** The person's most recent file, optionally only one not yet imported. */
export function latestFile(actor, { pending = false, withinMs = 6 * 60 * 60 * 1000 } = {}) {
  return ImportFile.findOne({
    uploaderProfileId: actor.profileId,
    expiresAt: { $gt: new Date() },
    createdAt: { $gte: new Date(Date.now() - withinMs) },
    ...(pending && { status: { $in: ['UPLOADED', 'PREVIEWED'] } }),
  }).sort({ createdAt: -1 });
}

/* ── What the person said ────────────────────────────────────────────── */

const EXAM_WORDS = /\b((?:unit|class|weekly|monthly|periodic|cycle)\s+test\s*-?\s*\d*|pt\s*-?\s*\d+|ut\s*-?\s*\d+|mid[-\s]?terms?|half[-\s]?yearly|quarterly|pre[-\s]?boards?|annual(?:\s+exam)?|finals?(?:\s+exam)?|term\s*-?\s*\d+(?:\s+exam)?|sa\s*-?\s*\d|fa\s*-?\s*\d)\b/i;

/**
 * The values a request supplies in place of a column: the class, the date,
 * the exam and subject, the role of the staff being added.
 */
export async function contextFromText(text) {
  const said = String(text ?? '');
  const out = {};
  const cls = classFromText(said, { lenient: true });
  if (cls?.text) out.className = cls.text;
  if (/\btoday\b|\baaj\b|आज/i.test(said)) out.date = localToday();
  else if (/\byesterday\b|\bkal\b(?=.*\b(?:ki|ka|ke)\b)|कल/i.test(said)) out.date = localToday(new Date(Date.now() - DAY_MS));
  const dates = writtenDatesIn(said);
  if (dates.length) out.date = dates[0].iso;
  const exam = EXAM_WORDS.exec(said);
  if (exam) out.exam = exam[1].replace(/\s+/g, ' ').trim();
  const period = /\bperiod\s*(\d{1,2})\b/i.exec(said);
  if (period) out.periodNo = Number(period[1]);
  const role = /\b(teachers?|accountants?|librarians?|wardens?|nurses?|principals?|admins?)\b/i.exec(said);
  if (role) {
    const key = parseEnum(role[1].replace(/s$/i, ''), { TEACHER: ['teacher'], FINANCE: ['accountant'], LIBRARIAN: ['librarian'], WARDEN: ['warden'], NURSE: ['nurse'], PRINCIPAL: ['principal'], ADMIN: ['admin'] });
    if (key) out.roleKey = key;
  }
  // A subject named in the sentence ("maths marks"): matched against the school's subjects.
  const subjects = await Subject.find().select('name').lean();
  const lower = said.toLowerCase();
  const short = { maths: 'mathematics', math: 'mathematics', sci: 'science', eng: 'english', hindi: 'hindi', sst: 'social studies', evs: 'environmental studies', cs: 'computer science' };
  for (const s of subjects) {
    const name = s.name.toLowerCase();
    if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower)) { out.subject = s.name; break; }
  }
  if (!out.subject) {
    for (const [abbr, full] of Object.entries(short)) {
      if (new RegExp(`\\b${abbr}\\b`).test(lower)) {
        const hit = subjects.find((s) => s.name.toLowerCase() === full || s.name.toLowerCase().startsWith(full));
        if (hit) { out.subject = hit.name; break; }
      }
    }
  }
  return out;
}

/* ── Analysis ────────────────────────────────────────────────────────── */

const ALREADY_LOOKBACK_MS = RESULT_TTL_MS;

function rowHash(schemaKey, values) {
  const stable = JSON.stringify(Object.keys(values).sort().map((k) => [k, values[k] ?? null]));
  return sha256(`${schemaKey}|${stable}`).slice(0, 32);
}

function columnLabel(schema, key) {
  return schema.columns.find((c) => c.key === key)?.label ?? key;
}

/** The schema a target names: its key, or its label/noun in words ("library books"). */
export function schemaForTarget(target) {
  if (!target) return null;
  const t = String(target).trim().toLowerCase();
  if (SCHEMA_BY_KEY[t]) return SCHEMA_BY_KEY[t];
  return IMPORT_SCHEMAS.find((s) => s.label.toLowerCase() === t || s.key.replace(/_/g, ' ') === t || `${s.noun}s` === t || s.noun === t)
    ?? IMPORT_SCHEMAS.find((s) => s.said.some((re) => re.test(t))) ?? null;
}

/**
 * Reads, recognises, maps and checks a stored sheet. Writes nothing.
 * Returns `{ status, schema?, ... }`; status is one of
 *   READY | HAS_PROBLEMS        a target was settled and every row checked
 *   ASK_TARGET                  two targets fit about equally; which?
 *   UNKNOWN_FORMAT              nothing fits: here are the formats and templates
 *   WRONG_FORMAT                the target is known but required columns are missing
 *   NOT_PERMITTED               the sheet is for a target this person cannot import
 */
export async function analyse(ctx, file, { target = null, hint = '', context: given = {} } = {}) {
  const actor = ctx.actor;
  if (!file.data) throw new AppError('That file has already been imported, so its contents are no longer kept. Upload it again to import it once more.', 409, [], 'CONFLICT');
  let sheet = readSheet(file.data, file.ext);
  const context = { ...(await contextFromText(hint)), ...Object.fromEntries(Object.entries(given).filter(([, v]) => v !== undefined && v !== null && v !== '')) };
  const mine = schemasFor(actor);
  const base = { file: { id: String(file._id), name: file.originalName, rows: sheet.rows.length, headers: sheet.headers, sheetName: sheet.sheetName }, context };

  let schema = null;
  let ranked = null;
  if (target) {
    schema = schemaForTarget(target);
    if (!schema) throw new AppError(`"${target}" is not something that can be imported. Ask "what can I import?" for the list.`, 400, [], 'AGENT_NEEDS_INPUT');
    if (!mayImport(actor, schema)) {
      return { ...base, status: 'NOT_PERMITTED', target: { key: schema.key, label: schema.label }, message: `Your account cannot import ${schema.label.toLowerCase()} (the ${schema.label} screen needs ${schema.permission}).` };
    }
  } else {
    ranked = rankSchemas(sheet.headers, IMPORT_SCHEMAS, { text: hint, context });
    // A wide marks sheet (one column per subject) is scored as marks in its long form.
    const wideForm = meltSubjectColumns(sheet.headers, sheet.rows, sheet.rowNumbers, (await Subject.find().select('name').lean()).map((s) => s.name));
    if (wideForm) {
      const asMarks = rankSchemas(wideForm.headers, [SCHEMA_BY_KEY.marks], { text: hint, context })[0];
      ranked = ranked.map((r) => (r.schema.key === 'marks' && asMarks.total > r.total ? asMarks : r)).sort((a, b) => b.total - a.total);
    }
    const best = ranked.find((r) => mayImport(actor, r.schema));
    const overall = ranked[0];
    if (!best || (overall && !mayImport(actor, overall.schema) && overall.total >= 0.45 && overall.total - (best?.total ?? 0) > 0.15)) {
      return {
        ...base, status: 'NOT_PERMITTED', target: { key: overall.schema.key, label: overall.schema.label },
        message: `This looks like a ${overall.schema.label.toLowerCase()} sheet, which your account cannot import.`,
        formats: mine.map((s) => ({ key: s.key, label: s.label })),
      };
    }
    const runnerUp = ranked.filter((r) => r !== best && mayImport(actor, r.schema))[0];
    if (best.total < 0.33) {
      return {
        ...base, status: 'UNKNOWN_FORMAT',
        message: 'I could not tell what this sheet is for from its columns.',
        formats: mine.map((s) => ({ key: s.key, label: s.label })),
      };
    }
    if (runnerUp && best.total - runnerUp.total < 0.08 && best.words === runnerUp.words) {
      return {
        ...base, status: 'ASK_TARGET',
        message: `This could be ${best.schema.label.toLowerCase()} or ${runnerUp.schema.label.toLowerCase()}. Which is it?`,
        options: [best, runnerUp].map((r) => ({ key: r.schema.key, label: r.schema.label })),
      };
    }
    schema = best.schema;
  }

  let melted = null;
  let { mapping, matches, unmapped } = mapHeaders(sheet.headers, schema);
  if (schema.key === 'marks' && mapping.marks === undefined) {
    const subjects = (await Subject.find().select('name').lean()).map((s) => s.name);
    const wide = meltSubjectColumns(sheet.headers, sheet.rows, sheet.rowNumbers, subjects);
    if (wide) {
      melted = wide.melted;
      sheet = { ...sheet, headers: wide.headers, rows: wide.rows, rowNumbers: wide.rowNumbers };
      ({ mapping, matches, unmapped } = mapHeaders(sheet.headers, schema));
    }
  }

  const mappingView = matches.map((m) => ({ header: m.header, column: m.column, label: columnLabel(schema, m.column), exact: m.exact }));
  const ignored = unmapped.map((i) => sheet.headers[i]);
  const missing = requiredSatisfied(schema, mapping, context);
  const targetView = { key: schema.key, label: schema.label, module: schema.module, link: schema.link };
  if (missing.length) {
    return {
      ...base, status: 'WRONG_FORMAT', target: targetView, mapping: mappingView, ignored, melted,
      missing: missing.map((c) => ({ key: c.key, label: c.label, note: c.note ?? null, canSay: Boolean(c.fromContext) })),
      message: `This sheet is missing ${missing.map((c) => `"${c.label}"`).join(', ')}, which ${schema.label.toLowerCase()} need${missing.length === 1 ? 's' : ''}.`,
    };
  }

  // Rows as objects keyed by the schema's columns.
  const raw = sheet.rows.map((row) => Object.fromEntries(Object.entries(mapping).map(([key, idx]) => [key, row[idx] ?? ''])));
  const refs = await schema.lookups(ctx, raw, context);

  const prior = await ImportFile.find({
    target: schema.key, status: 'IMPORTED', importedAt: { $gte: new Date(Date.now() - ALREADY_LOOKBACK_MS) }, _id: { $ne: file._id },
  }).select('importedRowHashes importedAt').lean();
  const importedAt = new Map();
  for (const p of prior) for (const h of p.importedRowHashes ?? []) importedAt.set(h, p.importedAt);

  const seen = new Map();
  const rows = raw.map((r, i) => {
    const rowNo = sheet.rowNumbers[i];
    const { values, problems = [], skip = null } = schema.check(r, refs, context, ctx);
    for (const k of schema.dupKeys?.(values) ?? []) {
      if (seen.has(k)) problems.push({ field: null, problem: `is the same record as row ${seen.get(k)}`, suggestion: 'remove one of the two rows' });
      else seen.set(k, rowNo);
    }
    const hash = rowHash(schema.key, values);
    const already = importedAt.get(hash);
    return {
      rowNo, raw: sheet.rows[i], values, hash,
      problems: problems.map((p) => ({ ...p, column: p.field ? columnLabel(schema, p.field) : null })),
      skip: skip ?? (already ? `already imported on ${new Date(already).toISOString().slice(0, 10)}` : null),
    };
  });

  const ready = rows.filter((r) => !r.problems.length && !r.skip);
  const withProblems = rows.filter((r) => r.problems.length && !r.skip);
  const skipped = rows.filter((r) => r.skip);
  const problemList = withProblems.flatMap((r) => r.problems.map((p) => ({
    row: r.rowNo, column: p.column, value: p.value ?? null, problem: p.problem, suggestion: p.suggestion ?? null,
  })));

  return {
    ...base,
    status: withProblems.length ? 'HAS_PROBLEMS' : 'READY',
    target: targetView,
    mapping: mappingView,
    ignored,
    melted,
    counts: { total: rows.length, ready: ready.length, problems: withProblems.length, skipped: skipped.length },
    problems: problemList,
    skipped: skipped.slice(0, 20).map((r) => ({ row: r.rowNo, reason: r.skip })),
    // Kept off the persisted preview: the full row set, for the import and the error report.
    _schema: schema,
    _rows: rows,
    _refs: refs,
    _sheet: sheet,
  };
}

/** What a preview keeps on the file and returns: everything but the internal row set. */
function publicView(analysis) {
  const { _schema, _rows, _refs, _sheet, ...rest } = analysis;
  return {
    ...rest,
    problems: (rest.problems ?? []).slice(0, PROBLEMS_SHOWN),
    problemsTotal: (rest.problems ?? []).length,
  };
}

export async function previewImport(ctx, { fileId, target = null, hint = '', context = {} }) {
  const file = fileId ? await loadFile(ctx.actor, fileId, { withData: true }) : await latestFile(ctx.actor, { pending: true }).select('+data');
  if (!file) throw new AppError('Attach the sheet first (CSV or Excel) and I will check it.', 400, [], 'AGENT_NEEDS_INPUT');
  if (file.status === 'IMPORTED') return { status: 'ALREADY_IMPORTED', file: { id: String(file._id), name: file.originalName }, result: file.result };
  const analysis = await analyse(ctx, file, { target, hint, context });
  const view = publicView(analysis);
  const settled = analysis.target && ['READY', 'HAS_PROBLEMS', 'WRONG_FORMAT'].includes(analysis.status);
  await ImportFile.updateOne({ _id: file._id }, {
    $set: {
      status: 'PREVIEWED',
      ...(settled && { target: analysis.target.key, context: analysis.context }),
      preview: { status: view.status, target: view.target ?? null, counts: view.counts ?? null, problems: view.problems ?? [], problemsTotal: view.problemsTotal ?? 0, at: new Date() },
    },
  });
  return view;
}

/* ── The import ──────────────────────────────────────────────────────── */

/**
 * The confirmed import. Re-analyses the stored sheet (so what runs is what is
 * true now), refuses rows with problems unless `validOnly`, writes the ready
 * rows through the module's own bulk service, records the outcome and drops
 * the raw sheet.
 */
export async function runImport(ctx, { fileId, target = null, validOnly = false, context = {} }) {
  const actor = ctx.actor;
  const file = await loadFile(actor, fileId, { withData: true });

  if (file.status === 'IMPORTED') return { ...file.result, alreadyImported: true };
  const settledTarget = target ?? file.target;
  if (!settledTarget) throw new AppError('Check the file first so I know where it goes.', 400, [], 'AGENT_NEEDS_INPUT');

  // The same bytes already imported into the same place (an upload repeated, a
  // WhatsApp copy of a sheet imported on the website): answered with that import.
  const twin = await ImportFile.findOne({ _id: { $ne: file._id }, sha256: file.sha256, target: schemaForTarget(settledTarget)?.key, status: 'IMPORTED' }).lean();
  if (twin) {
    await ImportFile.updateOne({ _id: file._id }, { $set: { status: 'IMPORTED', result: { ...twin.result, duplicateOf: String(twin._id) }, data: null, importedAt: twin.importedAt, expiresAt: new Date(Date.now() + RESULT_TTL_MS) } });
    return { ...twin.result, alreadyImported: true, duplicateOf: String(twin._id) };
  }

  // One import of a file at a time (a double-tap, a retried confirmation).
  const claimed = await ImportFile.findOneAndUpdate(
    { _id: file._id, status: { $in: ['UPLOADED', 'PREVIEWED', 'FAILED'] } },
    { $set: { status: 'IMPORTING' } },
    { new: true },
  ).select('+data');
  if (!claimed) throw new AppError('That file is already being imported.', 409, [], 'CONFLICT');

  try {
    const analysis = await analyse(ctx, claimed, { target: settledTarget, context: { ...(file.context ?? {}), ...context } });
    if (!['READY', 'HAS_PROBLEMS'].includes(analysis.status)) {
      throw new AppError(analysis.message ?? 'This file is not in the right format for that import.', 400, [], 'AGENT_NEEDS_INPUT');
    }
    const schema = analysis._schema;
    const ready = analysis._rows.filter((r) => !r.problems.length && !r.skip);
    const withProblems = analysis._rows.filter((r) => r.problems.length && !r.skip);
    if (withProblems.length && !validOnly) {
      throw new AppError(`${withProblems.length} row(s) have problems. Import only the ${ready.length} valid row(s), or fix the file and upload it again.`, 409, [], 'CONFLICT');
    }
    if (!ready.length) throw new AppError('There are no rows ready to import.', 409, [], 'CONFLICT');

    const written = await schema.write(ctx, ready, analysis.context, analysis._refs);
    const failedRows = written.failedRows ?? new Set();
    const importedHashes = ready.filter((r) => !failedRows.has(r.rowNo)).map((r) => r.hash);

    const problemRows = [
      ...withProblems.map((r) => ({ rowNo: r.rowNo, raw: r.raw, errors: r.problems.map((p) => [p.column, p.problem, p.suggestion].filter(Boolean).join(': ')) })),
      ...written.errors.filter((e) => e.row).map((e) => ({ rowNo: e.row, raw: analysis._rows.find((r) => r.rowNo === e.row)?.raw ?? [], errors: [[e.field, e.problem, e.suggestion].filter(Boolean).join(': ')] })),
    ].sort((a, b) => a.rowNo - b.rowNo);

    const result = {
      fileId: String(file._id),
      fileName: file.originalName,
      target: { key: schema.key, label: schema.label, link: schema.link },
      total: analysis._rows.length,
      imported: written.imported,
      failed: written.failed,
      notImported: withProblems.length,
      skipped: analysis._rows.filter((r) => r.skip).length,
      errors: [
        ...withProblems.flatMap((r) => r.problems.map((p) => ({ row: r.rowNo, column: p.column, problem: p.problem, suggestion: p.suggestion ?? null }))),
        ...written.errors.map((e) => ({ row: e.row, column: e.field ? columnLabel(schema, e.field) : null, problem: e.problem, suggestion: e.suggestion })),
      ].slice(0, 500),
      ...(problemRows.length && { errorSheet: { headers: analysis._sheet.headers, rows: problemRows.slice(0, 2000) } }),
      at: new Date().toISOString(),
    };

    await ImportFile.updateOne({ _id: file._id }, {
      $set: {
        status: 'IMPORTED', target: schema.key, result, importedRowHashes: importedHashes, importedAt: new Date(),
        // The raw sheet is not needed any more.
        data: null,
        expiresAt: new Date(Date.now() + RESULT_TTL_MS),
      },
    });
    const { errorSheet, ...shown } = result;
    return { ...shown, hasErrorReport: Boolean(errorSheet) };
  } catch (err) {
    await ImportFile.updateOne({ _id: file._id, status: 'IMPORTING' }, { $set: { status: 'PREVIEWED' } });
    throw err;
  }
}

/** The outcome of an import (the latest of this person's when no id is given). */
export async function getResult(actor, { fileId = null } = {}) {
  const file = fileId
    ? await loadFile(actor, fileId)
    : await ImportFile.findOne({ uploaderProfileId: actor.profileId, expiresAt: { $gt: new Date() } }).sort({ updatedAt: -1 });
  if (!file) throw new AppError('You have no recent imports.', 404, [], 'NOT_FOUND');
  const result = file.result ? (({ errorSheet, ...r }) => ({ ...r, hasErrorReport: Boolean(errorSheet) }))(file.result) : null;
  return { fileId: String(file._id), fileName: file.originalName, status: file.status, target: file.target, preview: file.preview, result, uploadedAt: file.createdAt };
}

/* ── Sheets to download ──────────────────────────────────────────────── */

/** The problem rows with Row and Errors columns: before the import from the sheet, after it from the stored outcome. */
export async function errorReport(ctx, { fileId, format = 'xlsx' }) {
  const file = await loadFile(ctx.actor, fileId, { withData: true });
  let headers;
  let rows;
  if (file.data) {
    const analysis = await analyse(ctx, file, { target: file.target, context: file.context ?? {} });
    if (!analysis._rows) throw new AppError(analysis.message ?? 'Check the file first.', 400, [], 'AGENT_NEEDS_INPUT');
    headers = analysis._sheet.headers;
    rows = analysis._rows.filter((r) => r.problems.length).map((r) => ({ rowNo: r.rowNo, raw: r.raw, errors: r.problems.map((p) => [p.column, p.problem, p.suggestion].filter(Boolean).join(': ')) }));
  } else if (file.result?.errorSheet) {
    ({ headers, rows } = file.result.errorSheet);
  } else {
    throw new AppError('There is no error report for this file (every row was imported, or the report has expired after 24 hours).', 404, [], 'NOT_FOUND');
  }
  const grid = [['Row', ...headers, 'Errors'], ...rows.map((r) => [String(r.rowNo), ...headers.map((_, i) => r.raw[i] ?? ''), r.errors.join(' | ')])];
  const base = file.originalName.replace(/\.[^.]+$/, '');
  if (format === 'csv') return { filename: `${base}-errors.csv`, contentType: CONTENT_TYPES.csv, body: Buffer.from(toCsv(grid), 'utf8') };
  return {
    filename: `${base}-errors.xlsx`,
    contentType: CONTENT_TYPES.xlsx,
    body: toXlsx([{ name: 'Rows to fix', rows: grid, widths: [6, ...headers.map(() => 18), 60] }, { name: 'Notes', rows: [['How to use this report'], ['Fix each row as the Errors column says, delete the Row and Errors columns, and upload the sheet again.'], ['Rows that were already imported are not in this report and will be skipped if uploaded again.']] }]),
  };
}

/** The sample sheet for a target: headers, one example row and a Notes sheet. */
export function template(key, format = 'xlsx') {
  const schema = SCHEMA_BY_KEY[key];
  if (!schema) throw new AppError(`There is no import called "${key}".`, 404, [], 'NOT_FOUND');
  const headers = schema.columns.map((c) => c.label);
  const example = schema.columns.map((c) => c.example ?? '');
  if (format === 'csv') return { filename: `${schema.key}-template.csv`, contentType: CONTENT_TYPES.csv, body: Buffer.from(toCsv([headers, example]), 'utf8') };
  const notes = [
    ['Column', 'Required', 'Accepted values / format', 'Example', 'Notes'],
    ...schema.columns.map((c) => [
      c.label,
      c.required ? (c.fromContext ? 'Yes (or say it in the chat)' : c.orColumns ? `Yes (or ${c.orColumns.map((k) => schema.columns.find((x) => x.key === k)?.label).join(' / ')})` : 'Yes') : 'No',
      c.values ? c.values.join(', ') : { phone: '10-digit mobile or +91…', date: 'YYYY-MM-DD or DD/MM/YYYY', amount: 'Rupees', integer: 'Whole number', email: 'name@domain', marks: 'Number, AB or ML' }[c.type] ?? 'Text',
      c.example ?? '',
      c.note ?? '',
    ]),
    [],
    [`Import: ${schema.label}. Delete the example row, add one row per ${schema.noun}, and upload the sheet in Ask AI. Column names can be in your own words; they are matched automatically.`],
  ];
  return {
    filename: `${schema.key}-template.xlsx`,
    contentType: CONTENT_TYPES.xlsx,
    body: toXlsx([{ name: 'Template', rows: [headers, example], widths: headers.map((h) => Math.max(14, h.length + 4)) }, { name: 'Notes', rows: notes, widths: [24, 22, 36, 24, 60] }]),
  };
}

/** The formats this person can import, with their columns. */
export function describeFormats(actor, { target = null } = {}) {
  const list = target ? [schemaForTarget(target)].filter(Boolean) : schemasFor(actor);
  return list.filter((s) => mayImport(actor, s)).map((s) => ({
    key: s.key,
    label: s.label,
    module: s.module,
    required: s.columns.filter((c) => c.required).map((c) => ({ label: c.label, canSay: Boolean(c.fromContext), or: c.orColumns?.map((k) => s.columns.find((x) => x.key === k)?.label) ?? null })),
    optional: s.columns.filter((c) => !c.required).map((c) => c.label),
    templates: { xlsx: `/imports/templates/${s.key}.xlsx`, csv: `/imports/templates/${s.key}.csv` },
  }));
}

/* ── Links ───────────────────────────────────────────────────────────── */

const webOrigin = () => String(process.env.PUBLIC_WEB_URL || env.CORS_ORIGIN || 'http://localhost:3000').split(',')[0].trim().replace(/\/$/, '');

/** The website page that reopens a file's preview in Ask AI for review and confirmation. */
export function reviewLink(actor, fileId) {
  const school = actor?.tenantId ? `/${actor.tenantId}` : '';
  const portal = String(actor?.roleKey ?? 'admin').toLowerCase().replace(/_/g, '-');
  return `${webOrigin()}${school}/${portal}?import=${fileId}`;
}
