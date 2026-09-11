import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AgentAction } from '../src/models/agentAction.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { Payment } from '../src/models/fee.model.js';
import { MCP_TOOLS } from '../src/modules/ai/mcp/registry.js';
import { proposeAction, canonicalToolName, LEGACY_TOOL_ALIASES, reissueToken } from '../src/modules/ai/mcp/confirm.js';
import { confirmAction } from '../src/modules/ai/agent/orchestrator.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { seedSchool, inSchool, OAK } from './support/mcpSchool.js';

/**
 * MCP as the single tool and action layer — the claims that have to hold for
 * that sentence to be true, checked against the source and the running code.
 *
 * These are architecture tests on purpose. "Every tool call goes through MCP"
 * is not something one behavioural test can prove: it is a property of the
 * absence of any other path, and absence is proved by looking.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

function sourceFiles(dir = SRC) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const rel = (file) => path.relative(SRC, file).split(path.sep).join('/');
const files = sourceFiles().map((f) => ({ file: rel(f), text: fs.readFileSync(f, 'utf8') }));

afterAll(async () => {
  await resetMcpClient();
});

describe('there is no execution path around MCP', () => {
  it('only the MCP wrapper ever calls an agent tool implementation', () => {
    // `tool.execute(`, `agentTool().execute(`, `TOOLS[x].execute(` — any of
    // these outside the MCP wrapper would be a second way to run a tool.
    const call = /\b(?:tool|agentTool\(\)|legacy|TOOLS\[[^\]]+\])\.execute\(/;
    const offenders = files.filter(({ text }) => call.test(text)).map(({ file }) => file);
    expect(offenders).toEqual(['modules/ai/mcp/tools/_shared.js']);
  });

  it('agent/tools.js is reached only through the MCP registry, never executed by the agent', () => {
    const importers = files
      .filter(({ text }) => /from ['"][./]*agent\/tools\.js['"]|from ['"]\.\/tools\.js['"]/.test(text))
      .map(({ file }) => file)
      .sort();
    // intent.js imports only toolsAvailableTo(), as a discovery fallback for a
    // caller that passes no MCP tool list; it executes nothing.
    expect(importers).toEqual(['modules/ai/agent/intent.js', 'modules/ai/mcp/registry.js', 'modules/ai/mcp/tools/_shared.js']);
    const intent = files.find(({ file }) => file === 'modules/ai/agent/intent.js').text;
    expect(intent).not.toMatch(/\bgetTool\b|\.execute\(/);
  });

  it('the orchestrator contains no direct execution or legacy path', () => {
    const orchestrator = files.find(({ file }) => file === 'modules/ai/agent/orchestrator.js').text;
    for (const gone of ['legacyTurn', 'confirmLegacyAction', 'snapshotState', 'getTool(', 'toolsAvailableTo', '.execute(']) {
      expect(orchestrator, `orchestrator still contains ${gone}`).not.toContain(gone);
    }
  });

  it('only the MCP confirmation store creates action proposals', () => {
    const creators = files
      .filter(({ text }) => /AgentAction\.create\(|new AgentAction\(/.test(text))
      .map(({ file }) => file);
    expect(creators).toEqual(['modules/ai/mcp/confirm.js']);
  });

  it('the dead /ai/chat endpoint and its duplicate AI service are gone', () => {
    expect(fs.existsSync(path.join(SRC, 'modules/ai/ai.service.js'))).toBe(false);
    const routes = files.find(({ file }) => file === 'modules/ai/ai.routes.js').text;
    expect(routes).not.toMatch(/router\.post\(\s*['"]\/chat['"]/);
  });
});

describe('no tool offers arbitrary access', () => {
  const FORBIDDEN_WORDS = new Set([
    'sql', 'query', 'raw', 'exec', 'execute', 'eval', 'shell', 'command', 'script',
    'http', 'fetch', 'api', 'url', 'database', 'db', 'collection', 'model', 'arbitrary',
  ]);

  it('no tool name is an escape hatch', () => {
    // Whole words only, split on "_": "withdraw_elective_registration" is not
    // "raw", and "search_students" is not "query".
    for (const name of Object.keys(MCP_TOOLS)) {
      const hits = name.split('_').filter((w) => FORBIDDEN_WORDS.has(w));
      expect(hits, `${name} looks like an escape hatch`).toEqual([]);
    }
  });

  /** Every object schema, recursively, with the path to it. */
  function objectSchemas(schema, where, out = []) {
    if (!schema || typeof schema !== 'object') return out;
    if (schema.type === 'object') out.push({ where, schema });
    for (const [key, value] of Object.entries(schema.properties ?? {})) objectSchemas(value, `${where}.${key}`, out);
    if (schema.items) objectSchemas(schema.items, `${where}[]`, out);
    return out;
  }

  it('no tool accepts an open-ended object — every object declares its fields and refuses others', () => {
    for (const [name, tool] of Object.entries(MCP_TOOLS)) {
      for (const { where, schema } of objectSchemas(tool.inputSchema, name)) {
        expect(schema.additionalProperties, `${where} accepts arbitrary keys`).toBe(false);
      }
    }
  });

  it('no parameter names a query, collection, model, command, endpoint or update document', () => {
    const banned = /^(sql|query_?string|filter|pipeline|collection|model|command|script|endpoint|url|update|updates|patch)$/i;
    for (const [name, tool] of Object.entries(MCP_TOOLS)) {
      for (const { where, schema } of objectSchemas(tool.inputSchema, name)) {
        for (const key of Object.keys(schema.properties ?? {})) {
          expect(banned.test(key), `${where}.${key} is an arbitrary-access parameter`).toBe(false);
        }
      }
    }
    // Stored references such as resourceUrl, proofUrl and link are strings the
    // services save; nothing on the server fetches them.
  });
});

describe('every new action is an MCP action', () => {
  let school;
  beforeEach(async () => {
    school = await seedSchool();
  });

  it('refuses to propose anything that is not an MCP tool', async () => {
    await expect(inSchool(OAK, () => proposeAction({
      actor: school.people.ADMIN.actor, tool: 'drop_database', args: {}, summary: 'x',
    }))).rejects.toMatchObject({ code: 'NOT_AN_MCP_TOOL' });
  });

  it('stores a legacy tool name under its MCP name, so no new legacy row can be created', async () => {
    const { actionId } = await inSchool(OAK, () => proposeAction({
      actor: school.people.FINANCE.actor, tool: 'record_fee_payment', args: {}, summary: 'x',
    }));
    const row = await inSchool(OAK, () => AgentAction.findById(actionId).lean());
    expect(row.tool).toBe('record_payment');
    expect(canonicalToolName('apply_leave')).toBe('apply_for_leave');
    expect(Object.keys(LEGACY_TOOL_ALIASES).sort()).toEqual(['apply_leave', 'record_fee_payment']);
  });

  it('redeems a proposal written by the pre-MCP code through the MCP tool, not a second path', async () => {
    // A row exactly as the old agent wrote it: legacy tool name, raw args.
    const finance = school.people.FINANCE.actor;
    const row = await inSchool(OAK, () => AgentAction.create({
      actorProfileId: finance.profileId,
      tool: 'record_fee_payment',
      args: { invoiceId: String(school.inv1._id), amountPaise: 100000, mode: 'CASH' },
      summary: 'Record a ₹1,000 payment',
      source: 'WEB',
      tokenHash: 'legacy-seeded',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    }));
    const token = await inSchool(OAK, () => reissueToken(row));

    const result = await inSchool(OAK, () => confirmAction({ confirmToken: token, actor: finance, source: 'WEB' }));
    expect(result.executed).toBe(true);
    expect(result.via).toBe('MCP');

    expect(await inSchool(OAK, () => Payment.countDocuments({ invoiceId: school.inv1._id }))).toBe(1);
    const audit = await inSchool(OAK, () => AuditLog.findOne({ action: 'agent.record_payment', 'after.status': 'EXECUTED' }).lean());
    expect(audit.after.via).toBe('MCP');
    expect(audit.after.confirmed).toBe(true);
  });
});
