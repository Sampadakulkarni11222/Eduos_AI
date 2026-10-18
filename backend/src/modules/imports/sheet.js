import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { AppError } from '../../utils/AppError.js';

/**
 * Reading and writing the spreadsheets of a bulk import.
 *
 * CSV is read with csv-parse (already the bulk importers' parser); Excel with
 * SheetJS (xlsx, from its official distribution at cdn.sheetjs.com). Both come
 * out as the same shape -- a header row and data rows of trimmed strings -- so
 * nothing downstream knows which it was.
 *
 * Limits are the bulk importers' own (utils/csvImport.js): 2 MB and 2000 data
 * rows. A workbook is read with `sheetRows` capped, so an oversized sheet is
 * refused without materialising all of it.
 */

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_ROWS = 2000;
export const MAX_COLUMNS = 60;
export const IMPORT_EXTENSIONS = ['csv', 'xlsx', 'xls'];

/** "Students (final).XLSX" → "xlsx"; null when it is not a sheet this reads. */
export function sheetExtension(name) {
  const ext = String(name ?? '').split('.').pop()?.toLowerCase() ?? '';
  return IMPORT_EXTENSIONS.includes(ext) ? ext : null;
}

const pad = (n) => String(n).padStart(2, '0');

/** One Excel cell as the text a person sees, with dates as YYYY-MM-DD. */
function cellText(cell) {
  if (!cell) return '';
  if (cell.t === 'd' && cell.v instanceof Date) {
    const d = cell.v;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  if (cell.t === 'n') {
    const fmt = cell.z ?? '';
    if (fmt && XLSX.SSF.is_date(fmt)) {
      const p = XLSX.SSF.parse_date_code(cell.v);
      if (p) return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
    }
    // The raw number, not its formatted text: a phone number formatted as
    // "9.88E+09" or an amount as "₹8,000.00" is read from its value.
    return Number.isInteger(cell.v) ? String(cell.v) : String(Math.round(cell.v * 1e6) / 1e6);
  }
  if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE';
  if (cell.t === 'e') return '';
  return String(cell.w ?? cell.v ?? '');
}

const NOTE_SHEETS = /^(notes?|instructions?|readme|help|guide|how\s*to)$/i;

function workbookGrid(buffer) {
  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'buffer', cellNF: true, cellDates: false, sheetRows: MAX_ROWS + 12, dense: false });
  } catch (err) {
    throw new AppError(`That Excel file could not be read (${String(err?.message ?? 'unreadable').slice(0, 80)}). Save it again as .xlsx or .csv and re-upload.`, 400, [], 'IMPORT_UNREADABLE');
  }
  // The first sheet with data that is not a notes/instructions sheet (our own
  // templates carry one).
  const names = wb.SheetNames.filter((n) => !NOTE_SHEETS.test(n.trim()));
  for (const name of names.length ? names : wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws?.['!ref']) continue;
    const range = XLSX.utils.decode_range(ws['!ref']);
    const grid = [];
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      const row = [];
      for (let c = range.s.c; c <= Math.min(range.e.c, range.s.c + MAX_COLUMNS - 1); c += 1) {
        row.push(cellText(ws[XLSX.utils.encode_cell({ r, c })]).trim());
      }
      grid.push(row);
    }
    if (grid.some((row) => row.filter(Boolean).length >= 1)) return { grid, sheetName: name };
  }
  return { grid: [], sheetName: null };
}

function csvGrid(buffer) {
  try {
    const grid = parse(buffer, {
      bom: true, relax_column_count: true, skip_empty_lines: true, trim: true, relax_quotes: true,
      to: MAX_ROWS + 12,
    });
    return { grid: grid.map((row) => row.slice(0, MAX_COLUMNS).map((v) => String(v ?? '').trim())), sheetName: null };
  } catch (err) {
    throw new AppError(`That CSV file could not be read (${String(err?.message ?? 'malformed').slice(0, 80)}). Check it opens in Excel, save it again and re-upload.`, 400, [], 'IMPORT_UNREADABLE');
  }
}

/**
 * The header row: the first of the opening rows that looks like headers --
 * at least two filled cells, mostly text, and as wide as the data. A title
 * line above the table ("Class 6 A attendance, June") is skipped.
 */
function headerRowIndex(grid) {
  const width = Math.max(0, ...grid.slice(0, 15).map((r) => r.filter(Boolean).length));
  for (let i = 0; i < Math.min(grid.length, 10); i += 1) {
    const filled = grid[i].filter(Boolean);
    if (filled.length < Math.min(2, width)) continue;
    const texty = filled.filter((v) => !/^[\d\s.,:/-]+$/.test(v)).length;
    if (filled.length >= Math.ceil(width * 0.6) && texty >= Math.ceil(filled.length * 0.6)) return i;
  }
  return 0;
}

/**
 * The sheet as `{ headers, rows, headerRow, sheetName }`. `rows` are arrays
 * aligned with `headers`; `rowNumbers[i]` is the spreadsheet row number of
 * rows[i], so every problem is reported against the row the person sees.
 */
export function readSheet(buffer, ext) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new AppError('The file is empty.', 400, [], 'IMPORT_EMPTY');
  if (buffer.length > MAX_FILE_BYTES) throw new AppError('The file is larger than 2 MB. Split it into smaller sheets and upload them one at a time.', 413, [], 'IMPORT_TOO_LARGE');
  const { grid, sheetName } = ext === 'csv' ? csvGrid(buffer) : workbookGrid(buffer);
  const nonEmpty = grid.filter((row) => row.some(Boolean));
  if (!nonEmpty.length) throw new AppError('The sheet has no rows.', 400, [], 'IMPORT_EMPTY');

  const h = headerRowIndex(grid);
  const rawHeaders = grid[h] ?? [];
  // Trailing empty header cells are dropped; an inner blank header is named so it can be reported.
  let last = rawHeaders.length - 1;
  while (last >= 0 && !rawHeaders[last]) last -= 1;
  const headers = rawHeaders.slice(0, last + 1).map((v, i) => v || `Column ${i + 1}`);

  const rows = [];
  const rowNumbers = [];
  for (let i = h + 1; i < grid.length; i += 1) {
    const row = grid[i].slice(0, headers.length);
    while (row.length < headers.length) row.push('');
    if (!row.some(Boolean)) continue;
    rows.push(row);
    rowNumbers.push(i + 1);
  }
  if (!rows.length) throw new AppError('The sheet has headers but no data rows under them.', 400, [], 'IMPORT_EMPTY');
  if (rows.length > MAX_ROWS) throw new AppError(`The sheet has more than ${MAX_ROWS} rows. Split it into smaller sheets and upload them one at a time.`, 400, [], 'IMPORT_TOO_MANY_ROWS');
  return { headers, rows, rowNumbers, headerRow: h + 1, sheetName };
}

/* ── Writing: templates and error reports ─────────────────────────────── */

/** A value written into a sheet: never something a spreadsheet would run as a formula. */
export function safeCell(value) {
  const s = String(value ?? '');
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

const csvField = (value) => {
  const s = safeCell(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Rows (arrays) as CSV text, with a BOM so Excel reads Hindi correctly. */
export function toCsv(rows) {
  return `\uFEFF${rows.map((row) => row.map(csvField).join(',')).join('\r\n')}\r\n`;
}

/** Sheets `[{ name, rows }]` as an .xlsx buffer. */
export function toXlsx(sheets) {
  const wb = XLSX.utils.book_new();
  for (const { name, rows, widths } of sheets) {
    // Strings become text cells (never formulas) in a workbook, so no escaping is needed here.
    const ws = XLSX.utils.aoa_to_sheet(rows.map((row) => row.map((v) => (v === null || v === undefined ? '' : String(v)))));
    if (widths) ws['!cols'] = widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

export const CONTENT_TYPES = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
