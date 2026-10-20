import { IMPORT_PERMISSIONS } from '../../imports/schemas.js';

/**
 * Rule-parser entries for the bulk-import capabilities (p7, tools/p7BulkImport.js),
 * so "describe import formats", "preview import" or "show import result" reach
 * them in their own words. The conversation itself (a file attached, "import
 * the valid rows") is handled earlier by agent/importTurn.js; these only make
 * the capabilities reachable by name. One copy per import permission, because a
 * rule requires a single permission and the tools are offered to anyone who
 * holds any of them.
 */
const BASE = [
  {
    tool: 'describe_import_formats',
    patterns: [/\b(?:describe|list|show|what\s+are)\b[^?]*\bimport\s+formats?\b/i, /\bbulk\s+import\s+formats?\b/i, /\bwhat\s+can\s+i\s+(?:bulk\s+)?import\b/i],
    weight: 6,
    decisive: true,
    args: () => ({}),
  },
  {
    tool: 'preview_import',
    patterns: [/^\s*(?:please\s+)?(?:preview|check)\s+(?:the\s+|my\s+)?(?:import|upload(?:ed)?\s+(?:file|sheet))\s*[?.!]*\s*$/i, /\b(?:is|was)\s+(?:this|the|my)\s+(?:file|sheet|excel|csv)\b[^?]*\b(?:right|correct)\s+format\b/i],
    weight: 6,
    decisive: true,
    args: () => ({}),
  },
  {
    tool: 'get_import_result',
    patterns: [/\b(?:show|get|what\s+(?:is|was))\b[^?]*\bimport\s+results?\b/i, /\b(?:did|has)\s+my\s+(?:import|upload)\s+(?:work|finish|go\s+through)\b/i, /\bhow\s+did\s+(?:the|my)\s+(?:import|upload)\s+go\b/i],
    weight: 6,
    decisive: true,
    args: () => ({}),
  },
];

export const IMPORT_RULES = IMPORT_PERMISSIONS.flatMap((permission) => BASE.map((rule) => ({ ...rule, requires: { permission } })));
