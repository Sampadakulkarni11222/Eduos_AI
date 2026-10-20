import { ok, action } from '../protocol.js';
import { RISK } from './_shared.js';
import { AppError } from '../../../../utils/AppError.js';
import { IMPORT_PERMISSIONS, IMPORT_SCHEMAS, SCHEMA_BY_KEY, mayImport } from '../../../imports/schemas.js';
import * as imports from '../../../imports/imports.service.js';
import { previewText, resultText, downloadsFor, templatePaths } from '../../../imports/present.js';

/**
 * Part 7: bulk import from Ask AI (website file attach, WhatsApp document).
 *
 * The person attaches a sheet and says where it goes, or not. The assistant
 * recognises the target from their words and the header row, maps the columns
 * (synonyms, Hindi, typos), checks every row and shows the preview; one
 * confirmation on the WEBSITE imports it through the module's own bulk
 * service. A sheet sent on WhatsApp is checked there and handed to the website
 * for the import (HIGH risk, affects many records: confirmableOn refuses it on
 * WhatsApp by design).
 *
 * Permission: each tool is offered to anyone who can import SOMETHING (anyOf
 * the import routes' permissions); the target's own permission and the
 * service's own scope rules then apply per file (imports/schemas.js mayImport,
 * a teacher's attendance and marks only for their classes and papers).
 */

const GRANTS = IMPORT_PERMISSIONS.map((key) => [key]);
const access = { permission: GRANTS[0][0], anyOf: GRANTS };
const TARGETS = IMPORT_SCHEMAS.map((s) => s.key);
const OBJECT_ID = '^[a-f0-9]{24}$';

const contextProps = {
  className: { type: 'string', maxLength: 40, description: 'The class the rows are for when the sheet has no class column, e.g. "Class 6 A"' },
  date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'The date for an attendance sheet with no date column' },
  exam: { type: 'string', maxLength: 60, description: 'The exam for a marks sheet with no exam column, e.g. "Unit Test 1"' },
  subject: { type: 'string', maxLength: 60, description: 'The subject for a marks sheet with no subject column' },
};

const contextOf = (args) => Object.fromEntries(Object.entries({ className: args.className, date: args.date, exam: args.exam, subject: args.subject }).filter(([, v]) => v));

export const p7BulkImportTools = {
  describe_import_formats: {
    module: 'Imports', operation: 'GET', risk: RISK.LOW,
    resultShape: 'LIST',
    description: 'What can be bulk-imported from a spreadsheet in Ask AI (attach a CSV or Excel file), and the columns each import needs: new students, staff, admission enquiries, classes, sections, subjects, class placements, fee invoices, hostel rooms and allocations, library books and issues, bus routes, stops and riders, attendance, exam marks -- only those this account may import. Use for "what can I import", "bulk import formats", "what columns does the student sheet need", "how do I upload students in bulk". Read-only.',
    inputSchema: {
      type: 'object',
      properties: { target: { type: 'string', maxLength: 60, description: 'One import, e.g. "students", "library books", "marks"' } },
      additionalProperties: false,
    },
    ...access,
    service: 'imports.service.describeFormats',
    async run(ctx, args) {
      const formats = imports.describeFormats(ctx.actor, { target: args.target ?? null });
      if (!formats.length) {
        return ok({ formats }, { speak: args.target ? `"${args.target}" is not an import your account can run.` : 'Your account cannot import anything in bulk.' });
      }
      const lines = formats.map((f) => `- **${f.label}**: ${f.required.map((r) => `${r.label}${r.or?.length ? ` (or ${r.or.join(' / ')})` : ''}${r.canSay ? ' (or say it in the chat)' : ''}`).join(', ')}${f.optional.length ? `; optional ${f.optional.join(', ')}` : ''}`);
      return ok({
        formats,
        downloads: formats.length === 1 ? [{ label: `Sample sheet: ${formats[0].label}`, path: formats[0].templates.xlsx, filename: `${formats[0].key}-template.xlsx` }] : [],
      }, {
        speak: `You can import ${formats.length === 1 ? 'this' : `these ${formats.length}`} from a spreadsheet (CSV or Excel, up to 2,000 rows). Attach the file in Ask AI and say what it is — column names in your own words are fine.\n\n${lines.join('\n')}`,
      });
    },
  },

  get_import_template: {
    module: 'Imports', operation: 'GET', risk: RISK.LOW,
    resultShape: 'DETAIL',
    description: 'The sample sheet (template) for one bulk import, to fill in and upload in Ask AI: the column headers, an example row and a Notes sheet with what each column accepts. Excel (.xlsx) or CSV. Use for "give me the template for students", "sample sheet for marks import", "download the library books format". Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', maxLength: 60, description: 'Which import, e.g. "students", "staff", "fee invoices", "attendance", "marks", "library books"' },
        format: { type: 'string', enum: ['xlsx', 'csv'], description: 'Excel (default) or CSV' },
      },
      required: ['target'],
      additionalProperties: false,
    },
    ...access,
    service: 'imports.service.template',
    async run(ctx, args) {
      const schema = imports.schemaForTarget(args.target);
      if (!schema) throw new AppError(`"${args.target}" is not an import. Ask "what can I import?" for the list.`, 400, [], 'AGENT_NEEDS_INPUT');
      if (!mayImport(ctx.actor, schema)) throw new AppError(`Your account cannot import ${schema.label.toLowerCase()}.`, 403, [], 'FORBIDDEN');
      const format = args.format === 'csv' ? 'csv' : 'xlsx';
      const path = templatePaths(schema.key)[format];
      return ok({
        target: { key: schema.key, label: schema.label },
        columns: schema.columns.map((c) => ({ label: c.label, required: Boolean(c.required), example: c.example ?? '', note: c.note ?? null })),
        downloads: [{ label: `Sample sheet: ${schema.label} (.${format})`, path, filename: `${schema.key}-template.${format}` }],
      }, {
        speak: `Here is the sample sheet for **${schema.label}**. Columns: ${schema.columns.map((c) => `${c.label}${c.required ? ' (required)' : ''}`).join(', ')}. Fill one row per ${schema.noun}, then attach it here and I will check it before anything is imported.`,
      });
    },
  },

  preview_import: {
    module: 'Imports', operation: 'GET', risk: RISK.LOW,
    resultShape: 'DETAIL',
    description: 'Checks an uploaded spreadsheet before importing it (writes nothing): works out where it goes from the request and the header row, matches the columns, and checks every row (missing values, wrong formats, unknown classes or students, duplicates), answering "N rows ready, M with problems" with each problem\'s row, column and fix. Use after a file is attached: "upload this sheet of new students", "import marks from this file", "is this file in the right format?". With no fileId, the latest file this person uploaded.',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: { type: 'string', pattern: OBJECT_ID, description: 'The uploaded file (from the attach button)' },
        target: { type: 'string', enum: TARGETS, description: 'Where it goes, when the person said so' },
        hint: { type: 'string', maxLength: 300, description: 'What the person said about the file' },
        ...contextProps,
      },
      additionalProperties: false,
    },
    ...access,
    service: 'imports.service.previewImport',
    async run(ctx, args) {
      const view = await imports.previewImport(ctx, { fileId: args.fileId ?? null, target: args.target ?? null, hint: args.hint ?? '', context: contextOf(args) });
      const data = { ...view, downloads: downloadsFor(view) };
      if (ctx.channel === 'WHATSAPP' && view.file?.id && ['READY', 'HAS_PROBLEMS'].includes(view.status) && view.counts?.ready) {
        data.reviewLink = imports.reviewLink(ctx.actor, view.file.id);
      }
      return ok(data, { speak: previewText(view, { channel: ctx.channel }) });
    },
  },

  run_import: {
    module: 'Imports', operation: 'CREATE', risk: RISK.HIGH,
    confirm: true,
    // Many records at once: confirmed by the person on the website only.
    affectsOthers: true,
    description: 'Imports a checked spreadsheet into its target (students, staff, enquiries, classes, fees, hostel, library, transport, attendance, marks) through that module\'s own bulk import, after the person confirms on the website. Idempotent: the same file is never imported twice, and rows already imported are skipped. With validOnly, imports the rows without problems and leaves the rest for the error report. Use after preview_import, for "import it", "go ahead and import", "import only the valid rows".',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: { type: 'string', pattern: OBJECT_ID, description: 'The checked file; defaults to the latest one previewed' },
        target: { type: 'string', enum: TARGETS, description: 'Where it goes (defaults to what the preview settled on)' },
        validOnly: { type: 'boolean', description: 'Import only the rows without problems' },
        ...contextProps,
      },
      additionalProperties: false,
    },
    ...access,
    service: 'imports.service.runImport',
    async prepare(ctx, args) {
      const file = args.fileId ? await imports.loadFile(ctx.actor, args.fileId) : await imports.latestFile(ctx.actor, { pending: true });
      if (!file) throw new AppError('Attach the sheet first, and I will check it before importing.', 400, [], 'AGENT_NEEDS_INPUT');
      if (file.status === 'IMPORTED') throw new AppError(`${file.originalName} was already imported${file.result?.imported != null ? ` (${file.result.imported} rows)` : ''}. Nothing to do.`, 409, [], 'CONFLICT');
      const view = await imports.previewImport(ctx, { fileId: String(file._id), target: args.target ?? file.target ?? null, context: { ...(file.context ?? {}), ...contextOf(args) } });
      if (!['READY', 'HAS_PROBLEMS'].includes(view.status)) throw new AppError(previewText(view, { channel: ctx.channel }), 400, [], 'AGENT_NEEDS_INPUT');
      if (!view.counts.ready) throw new AppError(view.counts.problems ? 'No row is ready to import yet. Fix the rows in the error report and upload the sheet again.' : 'Every row is already in, so there is nothing to import.', 409, [], 'CONFLICT');
      if (view.counts.problems && !args.validOnly) {
        throw new AppError(`${view.counts.problems} row(s) have problems. Say "import the valid rows" to import the ${view.counts.ready} ready row(s), or fix the file and upload it again.`, 400, [], 'AGENT_NEEDS_INPUT');
      }
      return { fileId: String(file._id), fileName: file.originalName, target: view.target, counts: view.counts };
    },
    summarise(args, actor, prepared) {
      const p = prepared ?? {};
      const c = p.counts ?? {};
      return `Import ${c.ready ?? '?'} row(s) from ${p.fileName ?? 'the uploaded sheet'} into ${p.target?.label ?? 'the school'}`
        + `${c.problems ? ` (${c.problems} row(s) with problems left out)` : ''}${c.skipped ? ` (${c.skipped} already in, skipped)` : ''}.`;
    },
    async run(ctx, args, prepared) {
      const fileId = prepared?.fileId ?? args.fileId;
      if (!fileId) throw new AppError('Attach the sheet first.', 400, [], 'AGENT_NEEDS_INPUT');
      const result = await imports.runImport(ctx, { fileId, target: prepared?.target?.key ?? args.target ?? null, validOnly: Boolean(args.validOnly), context: contextOf(args) });
      const downloads = result.hasErrorReport ? [{ label: 'Error report (rows to fix)', path: `/imports/files/${fileId}/errors.xlsx`, filename: 'rows-to-fix.xlsx' }] : [];
      return action({
        type: 'bulk_import',
        id: fileId,
        data: { ...result, link: result.target?.link ?? null, downloads },
        speak: resultText(result),
      });
    },
  },

  get_import_result: {
    module: 'Imports', operation: 'GET', risk: RISK.LOW,
    resultShape: 'DETAIL',
    description: 'How a bulk import went: rows imported, left out and refused, with the problems -- the latest import this person ran (or checked), or one file. Use for "did my import work", "how did the upload go", "show the import result". Read-only.',
    inputSchema: {
      type: 'object',
      properties: { fileId: { type: 'string', pattern: OBJECT_ID, description: 'The file; defaults to the latest one' } },
      additionalProperties: false,
    },
    ...access,
    service: 'imports.service.getResult',
    async run(ctx, args) {
      const r = await imports.getResult(ctx.actor, { fileId: args.fileId ?? null });
      let speak;
      if (r.result) speak = resultText(r.result);
      else if (r.status === 'IMPORTING') speak = `${r.fileName} is being imported now. Ask again in a moment.`;
      else if (r.preview) speak = `${r.fileName} has been checked but not imported: ${r.preview.counts ? `${r.preview.counts.ready} row(s) ready, ${r.preview.counts.problems} with problems` : String(r.preview.status ?? '').toLowerCase().replace(/_/g, ' ')}.`;
      else speak = `${r.fileName} was uploaded but has not been checked yet.`;
      return ok({ ...r, downloads: r.result?.hasErrorReport ? [{ label: 'Error report (rows to fix)', path: `/imports/files/${r.fileId}/errors.xlsx`, filename: 'rows-to-fix.xlsx' }] : [] }, { speak });
    },
  },
};

/** For tests and the coverage map: every import target and the route it mirrors. */
export const IMPORT_ROUTES = Object.fromEntries(Object.values(SCHEMA_BY_KEY).map((s) => [s.key, s.route]));
