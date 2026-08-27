import { describe, it, expect } from 'vitest';
import { Lead } from '../src/models/lead.model.js';
import { Grade, Subject } from '../src/models/academics.model.js';
import { parseCsvRows } from '../src/utils/csvImport.js';
import { bulkCreateLeads } from '../src/modules/admissions/admission.service.js';
import { bulkCreateGrades, bulkCreateSubjects } from '../src/modules/academics/academics.service.js';

/**
 * CSV bulk import. It runs unattended
 * over large operator-supplied files, so the behaviour that matters is what
 * happens to the *good* rows when some rows are bad.
 */

/** Minimal stand-in for the multer-populated request the parser expects. */
const req = (csv) => ({ file: { buffer: Buffer.from(csv, 'utf8') } });

describe('parseCsvRows — header normalisation', () => {
  it('normalises header spelling so operator spreadsheets just work', () => {
    const rows = parseCsvRows(req('Child Name,guardian_name,PHONE\nAva,Bo,+91900\n'));
    expect(rows[0]).toEqual({ childname: 'Ava', guardianname: 'Bo', phone: '+91900' });
  });

  it('trims values and strips a UTF-8 BOM', () => {
    const rows = parseCsvRows(req('﻿name\n  spaced  \n'));
    expect(rows[0].name).toBe('spaced');
  });

  it('handles quoted fields containing commas', () => {
    const rows = parseCsvRows(req('name,note\n"Doe, Jane","a, b"\n'));
    expect(rows[0]).toEqual({ name: 'Doe, Jane', note: 'a, b' });
  });
});

describe('parseCsvRows — rejections', () => {
  it('requires a file', () => {
    expect(() => parseCsvRows({})).toThrow(/CSV file is required/i);
  });

  it('rejects a header-only file', () => {
    expect(() => parseCsvRows(req('name,phone\n'))).toThrow(/no data rows/i);
  });

  it('rejects a file over the row cap', () => {
    const csv = 'name\n' + Array.from({ length: 12 }, (_, i) => `n${i}`).join('\n') + '\n';
    expect(() => parseCsvRows(req(csv), { maxRows: 10 })).toThrow(/too many rows/i);
  });

  it('reports malformed CSV rather than throwing raw', () => {
    // Ragged rows: more columns than headers.
    expect(() => parseCsvRows(req('a,b\n1,2,3\n'))).toThrow(/Could not parse CSV/i);
  });
});

describe('bulkCreateLeads — partial failure', () => {
  it('imports every valid row and reports the invalid ones', async () => {
    const rows = parseCsvRows(
      req(
        'childName,guardianName,phone\n' +
          'Ava,Bo,+919000000001\n' +
          ',Missing Child,+919000000002\n' +
          'Cy,Dee,+919000000003\n'
      )
    );
    const res = await bulkCreateLeads(rows);

    expect(res.imported).toBe(2);
    expect(res.failed).toBe(1);
    // Row numbers are 1-based *including* the header, so the bad row is 3.
    expect(res.errors[0].row).toBe(3);
    expect(await Lead.countDocuments({})).toBe(2);
  });

  it('rejects an unknown source without sinking the batch', async () => {
    const rows = parseCsvRows(
      req(
        'childName,guardianName,phone,source\n' +
          'Ava,Bo,+919000000001,WALK_IN\n' +
          'Cy,Dee,+919000000002,CARRIER_PIGEON\n'
      )
    );
    const res = await bulkCreateLeads(rows);
    expect(res.imported).toBe(1);
    expect(res.errors[0].error).toMatch(/Invalid source/i);
  });

  it('rejects an unknown stage', async () => {
    const rows = parseCsvRows(req('childName,guardianName,phone,stage\nAva,Bo,+919000000001,MAYBE\n'));
    const res = await bulkCreateLeads(rows);
    expect(res.imported).toBe(0);
    expect(res.errors[0].error).toMatch(/Invalid stage/i);
  });

  it('accepts case-insensitive source and stage values', async () => {
    const rows = parseCsvRows(req('childName,guardianName,phone,source,stage\nAva,Bo,+919000000001,walk_in,new\n'));
    const res = await bulkCreateLeads(rows);
    expect(res.imported).toBe(1);
  });
});

describe('bulkCreateGrades — chunked insert and duplicates', () => {
  it('imports a clean batch', async () => {
    const rows = parseCsvRows(req('name,level\nClass 1,1\nClass 2,2\n'));
    const res = await bulkCreateGrades(rows);
    expect(res.imported).toBe(2);
    expect(await Grade.countDocuments({})).toBe(2);
  });

  it('names the duplicate rather than surfacing a raw E11000', async () => {
    await Grade.create({ name: 'Class 1', level: 1 });
    const rows = parseCsvRows(req('name,level\nClass 1,1\n'));
    const res = await bulkCreateGrades(rows);

    expect(res.imported).toBe(0);
    expect(res.failed).toBe(1);
    expect(res.errors[0].error).toMatch(/already exists/i);
    // The operator must be able to see which value clashed.
    expect(res.errors[0].error).toContain('Class 1');
  });

  it('imports more rows than one chunk (100) in a single call', async () => {
    const csv = 'name,level\n' + Array.from({ length: 150 }, (_, i) => `Grade ${i},${i}`).join('\n') + '\n';
    const res = await bulkCreateGrades(parseCsvRows(csv ? req(csv) : req('')));
    expect(res.imported).toBe(150);
    expect(await Grade.countDocuments({})).toBe(150);
  }, 60_000);
});

describe('bulkCreateSubjects', () => {
  it('imports a clean batch', async () => {
    const res = await bulkCreateSubjects(parseCsvRows(req('name,code\nPhysics,PHY\nChemistry,CHEM\n')));
    expect(res.imported).toBe(2);
  });

  /**
   * Pins CURRENT behaviour, which differs from bulkCreateLeads.
   *
   * chunkedInsert() runs each 100-row chunk as one transactional insertMany,
   * so a single duplicate aborts the whole chunk and the valid rows alongside
   * it roll back too. The report is honest — every row in the chunk is counted
   * as failed, so nothing is silently dropped — but an operator whose 100-row
   * sheet contains one existing subject gets zero rows imported.
   *
   * bulkCreateLeads, by contrast, validates per row and imports the good ones.
   * Changing this means dropping the per-chunk transaction for
   * insertMany({ ordered: false }) with per-document error collection.
   */
  it('rejects the whole chunk when any row duplicates an existing subject', async () => {
    await Subject.create({ name: 'Mathematics', code: 'MATH' });
    const rows = parseCsvRows(req('name,code\nMathematics,MATH\nPhysics,PHY\n'));
    const res = await bulkCreateSubjects(rows);

    expect(res.imported).toBe(0);
    expect(res.failed).toBe(2);
    // Physics was valid, but rolls back with the chunk.
    expect(await Subject.countDocuments({ name: 'Physics' })).toBe(0);
    // The operator is told about every affected row, not just the bad one.
    expect(res.errors).toHaveLength(2);
    expect(res.errors.some((e) => /already exists/i.test(e.error))).toBe(true);
  });
});
