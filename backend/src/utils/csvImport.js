import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { AppError } from './AppError.js';

const MAX_CSV_BYTES = 2 * 1024 * 1024; // plenty for a spreadsheet-style bulk import
const DEFAULT_MAX_ROWS = 2000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CSV_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!/\.csv$/i.test(file.originalname)) {
      return cb(new AppError('Only .csv files are supported', 415, [], 'UPLOAD_TYPE_NOT_ALLOWED'));
    }
    cb(null, true);
  },
});

/**
 * Express middleware: parses a single-file multipart upload (field name
 * "file") into memory. Converts multer's own errors (and the AppError thrown
 * by fileFilter above) into the shape errorHandler.js expects, since multer
 * calls its callback directly rather than throwing into an async handler.
 */
export function csvUploadSingle(fieldName = 'file') {
  const middleware = upload.single(fieldName);
  return (req, res, next) => {
    middleware(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        return next(new AppError(`Upload error: ${err.message}`, 400, [], 'UPLOAD_ERROR'));
      }
      next(err);
    });
  };
}

/** "Admission No" / "admission_no" / "admissionNo" all normalize to "admissionno". */
function normalizeHeader(header) {
  return header.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Reads the CSV buffer attached by `csvUploadSingle` and returns an array of
 * row objects keyed by normalized header name. Throws AppError for missing
 * files, malformed CSV, empty files, or files exceeding maxRows.
 */
export function parseCsvRows(req, { maxRows = DEFAULT_MAX_ROWS } = {}) {
  if (!req.file) throw new AppError('A CSV file is required (form field "file")', 400);

  let rows;
  try {
    rows = parse(req.file.buffer, {
      columns: (header) => header.map(normalizeHeader),
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch (err) {
    throw new AppError(`Could not parse CSV: ${err.message}`, 400);
  }

  if (rows.length === 0) throw new AppError('CSV file has no data rows', 400);
  if (rows.length > maxRows) throw new AppError(`CSV has too many rows (max ${maxRows})`, 400);

  return rows;
}

/**
 * One row's failure, described the way the person fixing the spreadsheet needs
 * it: which row, which column, what is wrong, and what to put there instead.
 *
 * `error` is kept as the flattened sentence so callers written against the
 * older `{ row, error }` shape — including the upload modal — keep working
 * while the structured fields are added around it.
 */
export function rowError(row, { field = null, value = undefined, problem, suggestion = null }) {
  const shown = value === undefined || value === null || value === '' ? null : `"${value}"`;
  return {
    row,
    field,
    value: value ?? null,
    problem,
    suggestion,
    error: [
      field ? `${field}${shown ? ` ${shown}` : ''}: ${problem}` : problem,
      suggestion,
    ].filter(Boolean).join(' — '),
  };
}

const CHUNK_SIZE = 100;

/**
 * Inserts validated rows, keeping the good ones when a row is bad.
 *
 * Every bulk importer used to run `insertMany` inside a transaction, which is
 * ordered and all-or-nothing: one duplicate in a 100-row chunk rolled back the
 * other 99 and reported all 100 as failed, each blamed for the *offending*
 * row's problem. That is the "bulk import silently does nothing" the QA report
 * describes — the file was correct apart from one line.
 *
 * Unordered and untransacted, MongoDB inserts every row it can and reports the
 * rest individually by index, which is exactly the per-row report a CSV import
 * owes its user. A partial import is the right outcome here: the rows that
 * were accepted are real, and the report names the ones to fix and re-upload.
 *
 * @param {import('mongoose').Model} Model
 * @param {{rowNo:number, doc:object}[]} validRows
 * @param {{dupField?:string, dupLabel?:string}} opts  Which field a duplicate
 *   key error is about, so the message can name the value rather than echo a
 *   raw E11000.
 */
export async function insertRows(Model, validRows, { dupField, dupLabel } = {}) {
  const results = { imported: 0, failed: 0, errors: [] };

  for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
    const chunk = validRows.slice(i, i + CHUNK_SIZE);
    try {
      await Model.insertMany(chunk.map((c) => c.doc), { ordered: false });
      results.imported += chunk.length;
    } catch (err) {
      // `writeErrors` carries the index of each row that failed *within this
      // chunk*; everything not named in it was written.
      const writeErrors = err?.writeErrors ?? (err?.index !== undefined ? [err] : []);
      const failedIndexes = new Map(
        writeErrors.map((we) => [we.index ?? we.err?.index, we])
      );

      chunk.forEach((c, idx) => {
        const we = failedIndexes.get(idx);
        if (!we && failedIndexes.size) {
          results.imported += 1;
          return;
        }
        // No index information at all (a non-write failure, e.g. the
        // connection): the whole chunk is genuinely unaccounted for.
        const cause = we ?? err;
        const code = cause?.code ?? cause?.err?.code;
        results.failed += 1;
        results.errors.push(
          code === 11000 && dupField
            ? rowError(c.rowNo, {
              field: dupLabel ?? dupField,
              value: c.doc[dupField],
              problem: 'already exists',
              suggestion: 'remove the row, or give it a value that is not taken',
            })
            : rowError(c.rowNo, {
              problem: cause?.errmsg ?? cause?.err?.errmsg ?? cause?.message ?? 'could not be saved',
            })
        );
      });
    }
  }

  return results;
}
