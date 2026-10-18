import { callTool as callMcpTool } from '../mcp/client.js';
import { latestFile, schemaForTarget, reviewLink } from '../../imports/imports.service.js';
import { IMPORT_SCHEMAS, mayImport } from '../../imports/schemas.js';
import { downloadsFor } from '../../imports/present.js';

/**
 * Ask AI's side of a bulk import (p7): the turns about a spreadsheet.
 *
 *   a file attached          → preview_import (target from the words and the
 *                              header row); all rows ready → the run_import
 *                              draft straight away, so ONE confirmation imports
 *   "import the valid rows"  → the run_import draft with validOnly
 *   "import it" / "go ahead" → the run_import draft
 *   "it's library books"     → the preview again, for the target named, when the
 *                              last check asked which import the sheet was for
 *   "for Class 6 A, today"   → the preview again with what the sheet lacked
 *   "template for students" / "what can I import" → the template / the formats
 *   "upload my student sheet" with nothing attached → how to attach one
 *
 * Only for a person who can import something (preview_import is in their
 * catalogue), and only on words that are unmistakably about a spreadsheet, so
 * nothing else a person says is taken from the tools that answer it. Every
 * step is an MCP call: the server authorizes, scopes, validates and audits it,
 * and the import itself is a draft the same person confirms -- on the website
 * (run_import is HIGH risk and affects many records; WhatsApp gets a link).
 */

const SHEET_WORDS = /\b(?:sheets?|spreadsheets?|excel|xlsx|xls|csv|workbook)\b|शीट|एक्सेल/i;
const IMPORT_VERBS = /\b(?:import|upload|bulk|load|add)\w*\b|अपलोड|इम्पोर्ट/i;
const NOT_OURS = /\b(?:ads?|campaigns?|meta|google\s+ads|ga4|analytics\s+views?|assignment|homework|submission|photo|picture|document\s+request|certificate)\b/i;

const VALID_ONLY = /\b(?:import|upload|add|save|load)\b[^.?!]*\b(?:valid|good|correct|clean|ready|ok|okay|remaining|other)\s+(?:rows?|ones|entries|records|lines|data)\b|\bonly\s+(?:the\s+)?(?:valid|good|correct|ready)\b|\bskip\s+(?:the\s+)?(?:errors?|bad|invalid|wrong)\b|\bignore\s+(?:the\s+)?(?:errors?|bad\s+rows|invalid)\b|\b(?:sahi|theek)\s+(?:wale|vale)\b/i;
const GO_IMPORT = /^\s*(?:ok(?:ay)?|yes|haan|ji|sure|great|fine)?[\s,.!]*(?:please\s+)?(?:go\s+ahead\s+(?:and\s+)?)?(?:import|upload|load|add)\s+(?:it|this|them|that|now|all|the\s+(?:file|sheet|rows|data|students|records))(?:\s+now)?\s*(?:please)?[.!]*\s*$/i;
const CHECK_FILE = /\b(?:is|was|check)\b[^.?!]*\b(?:this|the|my)\s+(?:file|sheet|excel|csv)\b[^.?!]*\b(?:right|correct|valid|proper|ok|okay)?\b|\b(?:right|correct)\s+format\b/i;
const ERROR_REPORT = /\berror\s+report\b|\b(?:which|what)\s+rows?\b[^.?!]*\b(?:wrong|problems?|errors?|fix)\b|\brows\s+to\s+fix\b/i;
const TEMPLATE = /\b(?:template|sample\s+(?:sheet|file|csv|excel|format)|blank\s+(?:sheet|format)|format\s+(?:sheet|file)|example\s+sheet)\b|\b(?:what|which)\s+(?:format|columns?)\b[^.?!]*\b(?:sheet|file|import|upload|excel|csv)\b|नमूना/i;
const FORMATS = /\bwhat\s+can\s+i\s+(?:bulk\s+)?(?:import|upload)\b|\bbulk\s+import(?:s|ing)?\b|\bimport\s+formats?\b|\bhow\s+(?:do|can)\s+i\s+(?:bulk\s+)?(?:import|upload)\b/i;

/** The import a sentence names, if any (and only one this person may run). */
function targetIn(text, actor, among = null) {
  const said = String(text ?? '');
  const pool = (among ?? IMPORT_SCHEMAS).filter((s) => mayImport(actor, s));
  const byLabel = pool.find((s) => said.toLowerCase().includes(s.label.toLowerCase()) || said.toLowerCase().includes(s.key.replace(/_/g, ' ')));
  if (byLabel) return byLabel;
  const hits = pool.filter((s) => s.said.some((re) => re.test(said)));
  return hits.length === 1 ? hits[0] : (among && hits[0]) || null;
}

/** One MCP call, kept for the answer-validation layer. */
async function call(mcpSession, tool, args) {
  const result = await callMcpTool(mcpSession, tool, args);
  return { tool, args, result };
}

function failureReply(c, lang) {
  const err = c.result?.error;
  return { reply: err?.message ?? 'That file could not be checked.', lang, action: null, tool: c.tool, via: 'MCP', refused: err?.code ?? 'ERROR', _calls: [c] };
}

/** The answer to a read: the tool's own words, its data and its download buttons. */
function answered(c, lang, extra = {}) {
  if (!c.result?.success) return failureReply(c, lang);
  const reply = c.result.speak ?? 'Done.';
  return {
    // The records ride as `importData`, not `data`: the reply is already laid out
    // (preview, problems, what to do next), and a generated panel would hide it.
    reply, importData: c.result.data, lang, action: null, tool: c.tool, tools: [c.tool], via: 'MCP',
    plan: [{ tool: c.tool, args: c.args }],
    downloads: c.result.data?.downloads ?? [],
    _calls: [c],
    ...extra,
  };
}

/** A preview, and -- when every row is ready on the website -- the import draft beneath it. */
async function previewTurn({ mcpSession, args, lang, source, runPlan }) {
  const c = await call(mcpSession, 'preview_import', args);
  if (!c.result?.success) return failureReply(c, lang);
  const view = c.result.data;
  const base = answered(c, lang, { importFileId: view?.file?.id ?? null });

  if (source === 'WHATSAPP') {
    if (view?.reviewLink) {
      base.reply += `\n\nImporting changes many records at once, so it is confirmed on the website: ${view.reviewLink}`
        + (view.status === 'HAS_PROBLEMS' ? '\nThe error report and a sample sheet are there too.' : '');
      base.link = view.reviewLink;
    }
    return base;
  }

  if (view?.status === 'READY' && view.counts?.ready > 0) {
    const draft = await runPlan([{ tool: 'run_import', args: { fileId: view.file.id } }]);
    if (draft?.action) {
      return { ...draft, reply: `${base.reply}\n\n${draft.reply}`, preface: base.reply, importData: base.importData, downloads: base.downloads, importFileId: base.importFileId, _calls: base._calls, tools: ['preview_import', 'run_import'] };
    }
  }
  return base;
}

/**
 * The import turn for this message, or null when the message is not about a
 * spreadsheet. `runPlan(steps)` is the orchestrator's own plan runner, so a
 * draft is proposed exactly as every other write is.
 */
export async function importTurn({ mcpSession, message, actor, source, lang, attachment = null, held, runPlan }) {
  if (!held?.has('preview_import')) return null;
  const text = String(message ?? '').trim();

  // A sheet attached to this message.
  if (attachment?.fileId) {
    const target = targetIn(text, actor);
    return previewTurn({
      mcpSession, source, lang, runPlan,
      args: { fileId: attachment.fileId, hint: text.slice(0, 300), ...(target && { target: target.key }) },
    });
  }

  const pending = await latestFile(actor, { pending: true }).lean();
  const recent = pending && pending.preview?.at && Date.now() - new Date(pending.preview.at).getTime() < 60 * 60 * 1000;

  if (recent && pending.status !== 'IMPORTED') {
    // On WhatsApp the import is never proposed: it is confirmed on the website.
    if (source === 'WHATSAPP' && (VALID_ONLY.test(text) || GO_IMPORT.test(text))) {
      const link = reviewLink(actor, String(pending._id));
      return {
        reply: `Importing ${pending.originalName} changes many records at once, so it is confirmed on the website, not on WhatsApp. Open this link, check the preview and confirm: ${link}`,
        lang, action: null, refused: 'CONFIRM_ON_WEB', link, via: 'MCP',
      };
    }
    if (VALID_ONLY.test(text)) {
      return runPlan([{ tool: 'run_import', args: { fileId: String(pending._id), validOnly: true } }]);
    }
    if (GO_IMPORT.test(text)) {
      return runPlan([{ tool: 'run_import', args: { fileId: String(pending._id) } }]);
    }
    if (ERROR_REPORT.test(text) && pending.preview?.status === 'HAS_PROBLEMS') {
      return previewTurn({ mcpSession, source, lang, runPlan, args: { fileId: String(pending._id), ...(pending.target && { target: pending.target }) } });
    }
    const asked = pending.preview?.status;
    // The answer to "which import is this?" / "where should it go?".
    if (['ASK_TARGET', 'UNKNOWN_FORMAT', 'NOT_PERMITTED'].includes(asked) && text.split(/\s+/).length <= 12) {
      const target = targetIn(text, actor);
      if (target) return previewTurn({ mcpSession, source, lang, runPlan, args: { fileId: String(pending._id), target: target.key, hint: text.slice(0, 300) } });
    }
    // What the sheet lacked, said in words ("Class 6 A, for today", "Unit Test 1 maths").
    if (asked === 'WRONG_FORMAT' && pending.target && text.split(/\s+/).length <= 16 && !TEMPLATE.test(text)) {
      return previewTurn({ mcpSession, source, lang, runPlan, args: { fileId: String(pending._id), target: pending.target, hint: text.slice(0, 300) } });
    }
    if (CHECK_FILE.test(text) && SHEET_WORDS.test(text) || /\b(?:check|recheck|re-check)\s+(?:it|again|the\s+file)\b/i.test(text)) {
      return previewTurn({ mcpSession, source, lang, runPlan, args: { fileId: String(pending._id), hint: text.slice(0, 300), ...(pending.target && { target: pending.target }) } });
    }
  }

  if (NOT_OURS.test(text)) return null;

  // Templates and formats: no file needed.
  if (TEMPLATE.test(text) && (SHEET_WORDS.test(text) || IMPORT_VERBS.test(text) || targetIn(text, actor))) {
    const target = targetIn(text, actor);
    if (target) {
      const format = /\bcsv\b/i.test(text) ? 'csv' : 'xlsx';
      return answered(await call(mcpSession, 'get_import_template', { target: target.key, format }), lang);
    }
    return answered(await call(mcpSession, 'describe_import_formats', {}), lang);
  }
  if (FORMATS.test(text)) {
    const target = targetIn(text, actor);
    return answered(await call(mcpSession, 'describe_import_formats', target ? { target: target.key } : {}), lang);
  }

  // "Upload this sheet of new students" / "is this file in the right format?" with nothing attached.
  if ((IMPORT_VERBS.test(text) && SHEET_WORDS.test(text)) || (CHECK_FILE.test(text) && SHEET_WORDS.test(text))) {
    const target = targetIn(text, actor);
    const how = source === 'WHATSAPP'
      ? 'Send the sheet here as a document (CSV or Excel, up to 2 MB) and I will check it'
      : 'Attach the sheet with the paperclip button next to the message box (CSV or Excel, up to 2 MB) and I will check it';
    return {
      reply: `${how}${target ? ` against the ${target.label.toLowerCase()} format` : ''}: where it goes, whether every column and row is right, and what to fix. Nothing is imported until you confirm.`
        + (target ? ` Say "template for ${target.label.toLowerCase()}" if you want the sample sheet first.` : ''),
      lang, action: null, needsInput: true, via: 'MCP',
    };
  }
  return null;
}

export { downloadsFor, schemaForTarget };
