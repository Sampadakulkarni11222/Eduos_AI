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
