import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MCP_TOOLS, mcpToolsFor, mutates } from '../src/modules/ai/mcp/registry.js';
import {
  kindOfProperty, kindsOfSchema, extractArgument, EXTRACTORS, UNEXTRACTABLE_KINDS,
  extractIdentifier, extractEnum, extractDate, extractDateRange, extractMoney,
  extractPercentage, extractNumber, extractText, FOUND, MISSING, AMBIGUOUS, INVALID,
} from '../src/modules/ai/agent/argumentKinds.js';
import { actorForRole } from './support/mcpSchool.js';

/**
 * Generic, schema-derived argument extraction.
 *
 * The legacy rules carried one extractor per capability — one that knew
 * attendanceBelowPct is a percentage, another that knew amountPaise is money.
 * None of that is a fact about a tool; it is a fact about an argument, and the
 * argument's own JSON Schema already states it. These tests assert that the
 * kind is DERIVED rather than declared, that each kind has exactly one
 * extractor, and that the statuses which keep writes safe are real.
 *
 * The migration matrix at the end is the question this phase exists to answer:
 * can the generic mechanism represent every argument the 30 legacy rules
 * extract? It is one test over a table, not thirty tests over sentences.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const schemaOf = (tool, arg) => MCP_TOOLS[tool].inputSchema.properties[arg];

/* ── 1. Kinds are derived from the schema ─────────────────── */

describe('1. an argument kind comes from its schema, not from a declaration', () => {
  it('reads each kind off the schema that states it', () => {
    expect(kindOfProperty('invoiceId', schemaOf('record_payment', 'invoiceId'))).toBe('identifier');
    expect(kindOfProperty('mode', schemaOf('record_payment', 'mode'))).toBe('enum');
    expect(kindOfProperty('amountPaise', schemaOf('record_payment', 'amountPaise'))).toBe('money');
    expect(kindOfProperty('attendanceBelowPct', schemaOf('get_at_risk_students', 'attendanceBelowPct'))).toBe('percentage');
    expect(kindOfProperty('dueAt', schemaOf('generate_homework', 'dueAt'))).toBe('date');
    expect(kindOfProperty('maxMarks', schemaOf('generate_homework', 'maxMarks'))).toBe('number');
    expect(kindOfProperty('title', schemaOf('create_announcement', 'title'))).toBe('text');
    expect(kindOfProperty('latest', schemaOf('update_announcement', 'latest'))).toBe('boolean');
  });

  it('is stated nowhere in the tool files — nothing declares a kind', () => {
    for (const file of fs.readdirSync(path.join(SRC, 'modules/ai/mcp/tools'))) {
      if (!file.endsWith('.js')) continue;
      const text = fs.readFileSync(path.join(SRC, 'modules/ai/mcp/tools', file), 'utf8');
      expect(text, file).not.toMatch(/argKind|argumentKind|extractAs/);
    }
  });

  it('names no capability anywhere in the extractor module', () => {
    const source = fs.readFileSync(path.join(SRC, 'modules/ai/agent/argumentKinds.js'), 'utf8');
    const named = Object.keys(MCP_TOOLS).filter((name) => source.includes(`'${name}'`));
    expect(named).toEqual([]);
  });

  it('covers the arguments of every teacher-visible capability', () => {
    for (const { name } of mcpToolsFor(actorForRole('TEACHER'))) {
      const kinds = kindsOfSchema(MCP_TOOLS[name].inputSchema);
      for (const [arg, kind] of Object.entries(kinds)) {
        expect(Object.keys(EXTRACTORS).concat(UNEXTRACTABLE_KINDS), `${name}.${arg}`).toContain(kind);
      }
    }
  });
});

/* ── 2. Identifier safety ─────────────────────────────────── */

describe('2. identifiers are never invented', () => {
  it('accepts only an id the caller actually wrote', () => {
    expect(extractIdentifier('open 5f4d3c2b1a0908070605f4d3')).toMatchObject({ status: FOUND, value: '5f4d3c2b1a0908070605f4d3' });
  });

  it('does not turn numbers, names or codes into an id', () => {
    for (const message of ['record 5000 for invoice 42', 'Rahul Sharma', 'invoice INV-1042', 'Class 5-A']) {
      expect(extractIdentifier(message).status, message).toBe(MISSING);
    }
  });

  it('refuses to choose between two ids', () => {
    const result = extractIdentifier('5f4d3c2b1a0908070605f4d3 and 1111111111111111111111aa');
    expect(result.status).toBe(AMBIGUOUS);
    expect(result.value).toBeUndefined();
  });

  it('never fills an identifier argument from free text', () => {
    // Every identifier-kind argument in the catalog, against a sentence full of
    // words and numbers: none may come back with a value.
    const message = 'please show class 5-A totals for 2026 with 500 students';
    for (const [name, tool] of Object.entries(MCP_TOOLS)) {
      for (const [arg, schema] of Object.entries(tool.inputSchema?.properties ?? {})) {
        if (kindOfProperty(arg, schema) !== 'identifier') continue;
        expect(extractArgument(arg, schema, message).value, `${name}.${arg}`).toBeUndefined();
      }
    }
  });
});

/* ── 3. Enums come from the schema ────────────────────────── */

describe('3. enum values are the schema\'s own', () => {
  it('matches a value, including one spelt with spaces', () => {
    const stage = schemaOf('get_admissions', 'stage');
    expect(extractEnum('leads at tour scheduled', stage)).toMatchObject({ status: FOUND, value: 'TOUR_SCHEDULED' });
    expect(extractEnum('which leads enrolled?', stage)).toMatchObject({ status: FOUND, value: 'ENROLLED' });
  });

  it('does not coerce a value the schema does not allow', () => {
    const stage = schemaOf('get_admissions', 'stage');
    const result = extractEnum('show rejected leads', stage);
    expect(result.status).not.toBe(FOUND);
    expect(result.value).toBeUndefined();
  });

  it('refuses to choose between two allowed values', () => {
    const stage = schemaOf('get_admissions', 'stage');
    expect(extractEnum('new and lost leads', stage).status).toBe(AMBIGUOUS);
  });

  it('works for any enum in the catalog without naming one', () => {
    // Same extractor, a different tool's enum.
    expect(extractEnum('paid by cash', schemaOf('record_payment', 'mode'))).toMatchObject({ status: FOUND, value: 'CASH' });
  });
});

/* ── 4. Money, percentage, number ─────────────────────────── */

describe('4. typed values are read only when they are actually typed', () => {
  it('reads money in the unit the ERP stores, with a currency marker', () => {
    expect(extractMoney('a payment of Rs 5,000')).toMatchObject({ status: FOUND, value: 500000 });
    expect(extractMoney('2500 rupees received')).toMatchObject({ status: FOUND, value: 250000 });
  });

  it('does not treat a bare number as money', () => {
    // "record 500" could be a roll number; guessing here writes a payment.
    expect(extractMoney('record 500').status).toBe(MISSING);
  });

  it('bounds a percentage by the schema', () => {
    const pct = schemaOf('get_at_risk_students', 'attendanceBelowPct');
    expect(extractPercentage('below 75%', pct)).toMatchObject({ status: FOUND, value: 75 });
    expect(extractPercentage('below 150%', pct).status).toBe(INVALID);
  });

  it('refuses to pick between two numbers', () => {
    const marks = schemaOf('generate_homework', 'maxMarks');
    expect(extractNumber('20 marks and 30 questions', marks).status).toBe(AMBIGUOUS);
  });
});

/* ── 5. Dates and ranges ──────────────────────────────────── */

describe('5. dates and date ranges', () => {
  const now = new Date('2026-09-13T00:00:00Z');

  it('reads an ISO date and a relative one', () => {
    expect(extractDate('on 2026-10-02', { now })).toMatchObject({ status: FOUND, value: '2026-10-02' });
    expect(extractDate('due tomorrow', { now }).status).toBe(FOUND);
  });

  it('treats two dates as ambiguous for a single-date argument', () => {
    expect(extractDate('2026-10-02 and 2026-10-09', { now }).status).toBe(AMBIGUOUS);
  });

  it('builds a range from two dates, from a span, or from one day', () => {
    expect(extractDateRange('from 2026-10-02 to 2026-10-05', { now }).value).toEqual({ from: '2026-10-02', to: '2026-10-05' });
    expect(extractDateRange('leave on 2026-10-02', { now }).value).toEqual({ from: '2026-10-02', to: '2026-10-02' });
    const span = extractDateRange('leave tomorrow for three days', { now });
    expect(span.status).toBe(FOUND);
    expect(span.value.to > span.value.from).toBe(true);
  });

  it('is missing rather than invented when no date is named', () => {
    expect(extractDateRange('I need leave', { now }).status).toBe(MISSING);
  });
});

/* ── 6. Text ──────────────────────────────────────────────── */

describe('6. supplied text', () => {
  const title = () => schemaOf('create_announcement', 'title');

  it('takes quoted text, or text introduced by a colon', () => {
    expect(extractText('announce "Sports Day on Friday"', title())).toMatchObject({ status: FOUND, value: 'Sports Day on Friday' });
    expect(extractText('announcement: Sports Day on Friday', title())).toMatchObject({ status: FOUND, value: 'Sports Day on Friday' });
  });

  it('does not turn a whole sentence into a title', () => {
    expect(extractText('post an announcement', title()).status).toBe(MISSING);
  });

  it('respects the schema\'s own length limit', () => {
    const result = extractText(`announce "${'x'.repeat(400)}"`, title());
    expect(result.value.length).toBeLessThanOrEqual(title().maxLength);
  });
});

/* ── 7. Read vs write safety ──────────────────────────────── */

describe('7. a write is never filled from a guess', () => {
  it('refuses an ambiguous value on a write and supplies nothing', () => {
    const schema = schemaOf('record_payment', 'invoiceId');
    const result = extractArgument('invoiceId', schema, 'pay 5f4d3c2b1a0908070605f4d3 or 1111111111111111111111aa', { write: true });
    expect(result.status).toBe(AMBIGUOUS);
    expect(result.value).toBeUndefined();
    expect(result.refusedForWrite).toBe(true);
  });

  it('supplies nothing ambiguous to any write capability in the catalog', () => {
    const message = 'pay 5f4d3c2b1a0908070605f4d3 or 1111111111111111111111aa';
    for (const [name, tool] of Object.entries(MCP_TOOLS)) {
      if (!mutates(tool)) continue;
      for (const [arg, schema] of Object.entries(tool.inputSchema?.properties ?? {})) {
        const result = extractArgument(arg, schema, message, { write: true });
        if (result.status === AMBIGUOUS) expect(result.value, `${name}.${arg}`).toBeUndefined();
      }
    }
  });

  it('extraction carries no identity, scope or tenant', () => {
    const source = fs.readFileSync(path.join(SRC, 'modules/ai/agent/argumentKinds.js'), 'utf8');
    for (const forbidden of ['actor', 'tenantId', 'permission', 'roleKey', 'profileId', 'scope']) {
      expect(source, `extraction references ${forbidden}`).not.toMatch(new RegExp(`\\b${forbidden}\\b\\s*[=.]`));
    }
  });
});

/* ── 8. The migration matrix ──────────────────────────────── */

describe('8. every argument the legacy rules extract is representable', () => {
  /**
   * The arguments each legacy rule fills, read from the rule bodies in
   * intent.js. This is the question Phase 8A exists to answer, as one table
   * rather than thirty sentences.
   */
  const LEGACY_ARGUMENTS = [
    ['search_students', ['query']],
    ['get_attendance_roster', ['className', 'date']],
    ['get_pending_fees', ['search']],
    ['get_payment_history', ['search']],
    ['get_admissions', ['stage']],
    ['get_at_risk_students', ['attendanceBelowPct']],
    ['get_attendance_statistics', ['month']],
    ['get_student_attendance', ['studentName', 'admissionNo', 'month']],
    ['get_attendance', ['month']],
    ['who_is_absent_today', ['date']],
    ['update_announcement', ['className', 'content', 'latest']],
    ['get_timetable', ['day']],
    ['get_results', ['exam']],
    ['apply_for_leave', ['fromDate', 'toDate', 'reason']],
    ['get_payment_link', ['invoiceId']],
    ['generate_homework', ['topic', 'dueAt', 'subject', 'className', 'maxMarks']],
    ['record_payment', ['invoiceId', 'invoiceNo', 'amountPaise', 'mode']],
    ['create_announcement', ['title', 'content']],
    ['mark_attendance', ['sectionId', 'date']],
  ];

  it('assigns a kind to every argument the rules fill', () => {
    const unrepresentable = [];
    for (const [tool, args] of LEGACY_ARGUMENTS) {
      const properties = MCP_TOOLS[tool]?.inputSchema?.properties ?? {};
      for (const arg of args) {
        const schema = properties[arg];
        const kind = schema ? kindOfProperty(arg, schema) : null;
        if (!kind || UNEXTRACTABLE_KINDS.includes(kind)) unrepresentable.push(`${tool}.${arg} (${kind ?? 'not in schema'})`);
      }
    }
    // One known gap, asserted exactly so it cannot grow unnoticed: a boolean
    // flag is set by a turn of phrase rather than by a value, and there is no
    // honest generic extractor for one.
    expect(unrepresentable).toEqual(['update_announcement.latest (boolean)']);
  });

  it('has an extractor for every kind the rules need', () => {
    const needed = new Set();
    for (const [tool, args] of LEGACY_ARGUMENTS) {
      const properties = MCP_TOOLS[tool]?.inputSchema?.properties ?? {};
      for (const arg of args) {
        const kind = properties[arg] ? kindOfProperty(arg, properties[arg]) : null;
        if (kind && !UNEXTRACTABLE_KINDS.includes(kind)) needed.add(kind);
      }
    }
    for (const kind of needed) expect(typeof EXTRACTORS[kind], kind).toBe('function');
  });

  it('is one extractor per kind, not one per capability', () => {
    // The whole point: a handful of extractors cover what thirteen rules did.
    expect(Object.keys(EXTRACTORS).length).toBeLessThan(LEGACY_ARGUMENTS.length);
  });
});
