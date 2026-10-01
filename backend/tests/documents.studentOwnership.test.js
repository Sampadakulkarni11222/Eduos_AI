import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A document filed for one student belongs to that student (and their
 * guardians) — not to every student and parent in the school.
 *
 * buildVisibilityFilter() in modules/documents/document.service.js gave a
 * STUDENT or PARENT every document published to their role, with no check of
 * the document's studentId. So Rahul's Transfer Certificate, published to
 * students and parents, was listed for — and downloadable by — Priya, and by
 * every other family in the school. The same filter guards the list and the
 * file route, so both are exercised here, over real HTTP.
 *
 * Fixture (shared MCP school): Oakridge 6A has Rahul (OAK-1, whose father is
 * PARENT), Priya (OAK-2, the STUDENT login) and Aman (OAK-3); 6B has Riya.
 * Riverside has its own Rahul.
 */

const UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'eduos-docs-'));
process.env.UPLOAD_DIR = UPLOAD_DIR;

const { default: apiRoutes } = await import('../src/routes/index.js');
const { errorHandler, notFoundHandler } = await import('../src/middleware/errorHandler.js');
const { signAccessToken } = await import('../src/utils/jwt.js');
const { Document } = await import('../src/models/document.model.js');
const { seedSchool, seedPerson, inSchool, OAK, RIVER } = await import('./support/mcpSchool.js');

let server;
let base;
let s;
let docs;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', apiRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  server = await new Promise((resolve) => { const srv = app.listen(0, '127.0.0.1', () => resolve(srv)); });
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(UPLOAD_DIR, { recursive: true, force: true });
});

/** A document with a real file behind it, so a permitted download returns the bytes. */
async function publish(tenant, title, extra = {}) {
  const name = `${title.replace(/\W+/g, '-').toLowerCase()}-${tenant}.pdf`;
  writeFileSync(join(UPLOAD_DIR, name), `%PDF-1.4 ${title}`);
  return inSchool(tenant, () => Document.create({
    title, type: 'TC', fileUrl: `/uploads/${name}`, visibleToRoles: ['STUDENT', 'PARENT'],
    authorProfileId: s.people.ADMIN.profile._id, ...extra,
  }));
}

beforeEach(async () => {
  s = await seedSchool();
  s.people.LONE_PARENT = await seedPerson({ roleKey: 'PARENT', roleId: s.roleIds.PARENT, displayName: 'Parent with no children' });
  s.people.RIVER_PARENT = await seedPerson({ roleKey: 'PARENT', roleId: s.roleIds.PARENT, tenantId: RIVER });
  docs = {
    priyaTc: await publish(OAK, 'Priya TC', { studentId: s.priya.student._id }),
    rahulTc: await publish(OAK, 'Rahul TC', { studentId: s.rahul.student._id }),
    amanLetter: await publish(OAK, 'Aman Letter', { type: 'LETTER', studentId: s.aman.student._id }),
    // Filed for no particular student: a school-level notice published to families.
    holidayList: await publish(OAK, 'Holiday List', { type: 'LETTER' }),
    // Course material for 6A, and for 6B.
    notes6A: await publish(OAK, 'Algebra Notes 6A', { type: 'CUSTOM', sectionId: s.sectionA._id }),
    notes6B: await publish(OAK, 'Algebra Notes 6B', { type: 'CUSTOM', sectionId: s.sectionB._id }),
    riverTc: await publish(RIVER, 'Riverside Rahul TC', { studentId: s.river.student._id }),
    // Forged: another school's row naming an Oakridge student's id.
    riverForged: await publish(RIVER, 'Forged TC', { studentId: s.priya.student._id }),
  };
});

const tokenFor = (p) => signAccessToken({ accountId: p.actor.accountId, profileId: p.actor.profileId, door: null });

async function list(person, qs = '') {
  const res = await fetch(`${base}/documents${qs}`, { headers: { authorization: `Bearer ${tokenFor(person)}` } });
  const body = await res.json();
  const items = body.data?.items ?? body.data ?? [];
  return { status: res.status, body, titles: Array.isArray(items) ? items.map((d) => d.title).sort() : [] };
}

async function file(person, id) {
  const res = await fetch(`${base}/documents/${id}/file`, { headers: { authorization: `Bearer ${tokenFor(person)}` }, redirect: 'manual' });
  const text = await res.text();
  return { status: res.status, text };
}

const ALL_TITLES = [
  'Algebra Notes 6A', 'Algebra Notes 6B', 'Aman Letter', 'Holiday List', 'Priya TC', 'Rahul TC',
];

/* ── Student ─────────────────────────────────────────────────── */

describe('student', () => {
  it("lists their own TC, shared documents and their class's material — not another student's", async () => {
    const r = await list(s.people.STUDENT);
    expect(r.status).toBe(200);
    expect(r.titles).toEqual(['Algebra Notes 6A', 'Holiday List', 'Priya TC']);
  });

  it('downloads their own TC', async () => {
    const r = await file(s.people.STUDENT, docs.priyaTc._id);
    expect(r.status).toBe(200);
    expect(r.text).toBe('%PDF-1.4 Priya TC');
  });

  it("cannot download another student's TC or letter, and gets the usual not-found", async () => {
    for (const id of [docs.rahulTc._id, docs.amanLetter._id]) {
      const r = await file(s.people.STUDENT, id);
      expect(r.status).toBe(404);
      expect(JSON.parse(r.text)).toMatchObject({ success: false, message: 'Document not found' });
      expect(r.text).not.toContain('Rahul');
      expect(r.text).not.toContain('Aman');
    }
  });

  it('can reach exactly their own documents by id, whichever ids they try', async () => {
    const reachable = [];
    for (const [key, d] of Object.entries(docs)) {
      if ((await file(s.people.STUDENT, d._id)).status === 200) reachable.push(key);
    }
    expect(reachable.sort()).toEqual(['holidayList', 'notes6A', 'priyaTc']);
  });

  it.each([
    ['another student\'s Mongo id', () => `?studentId=${s.rahul.student._id}`],
    ['a Mongo operator', () => '?studentId[$ne]=000000000000000000000000'],
    ['an $in operator naming everyone', () => `?studentId[$in]=${s.rahul.student._id}&studentId[$in]=${s.aman.student._id}`],
    ['the document type', () => '?type=TC'],
    ['another class', () => `?sectionId=${s.sectionB._id}`],
    ['a large page', () => '?pageSize=500'],
  ])('cannot widen the list with %s', async (_label, qs) => {
    const r = await list(s.people.STUDENT, qs());
    const leaked = r.titles.filter((t) => ['Rahul TC', 'Aman Letter', 'Algebra Notes 6B', 'Riverside Rahul TC', 'Forged TC'].includes(t));
    expect(leaked).toEqual([]);
  });

  it("refuses another student's admission number as a studentId without leaking anything", async () => {
    const r = await list(s.people.STUDENT, '?studentId=OAK-1');
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toContain('Rahul TC');
  });
});

/* ── Parent ──────────────────────────────────────────────────── */

describe('parent', () => {
  it("sees their own child's TC, and not other children's", async () => {
    const r = await list(s.people.PARENT);
    expect(r.titles).toEqual(['Algebra Notes 6A', 'Holiday List', 'Rahul TC']);
  });

  it("downloads their child's TC but no other student's", async () => {
    expect((await file(s.people.PARENT, docs.rahulTc._id)).status).toBe(200);
    for (const id of [docs.priyaTc._id, docs.amanLetter._id, docs.riverTc._id]) {
      expect((await file(s.people.PARENT, id)).status).toBe(404);
    }
  });

  it("cannot widen the list with another student's id", async () => {
    const r = await list(s.people.PARENT, `?studentId=${s.priya.student._id}`);
    expect(r.titles).toEqual([]);
  });

  it('a parent with no linked child sees no student-specific document', async () => {
    const r = await list(s.people.LONE_PARENT);
    expect(r.titles).toEqual(['Holiday List']);
    expect((await file(s.people.LONE_PARENT, docs.rahulTc._id)).status).toBe(404);
  });
});

/* ── School isolation ────────────────────────────────────────── */

describe('school isolation', () => {
  it("a student cannot reach another school's documents, even one forged with their own student id", async () => {
    const r = await list(s.people.STUDENT);
    expect(r.titles).not.toContain('Riverside Rahul TC');
    expect(r.titles).not.toContain('Forged TC');
    expect((await file(s.people.STUDENT, docs.riverTc._id)).status).toBe(404);
    expect((await file(s.people.STUDENT, docs.riverForged._id)).status).toBe(404);
  });

  it("a parent cannot reach another school's documents", async () => {
    expect((await list(s.people.PARENT)).titles).not.toContain('Riverside Rahul TC');
    expect((await file(s.people.PARENT, docs.riverTc._id)).status).toBe(404);
    // And Riverside's parent sees none of Oakridge's.
    const river = await list(s.people.RIVER_PARENT);
    expect(river.titles.filter((t) => ALL_TITLES.includes(t))).toEqual([]);
  });
});

/* ── Unchanged behaviour ─────────────────────────────────────── */

describe('behaviour the fix must not change', () => {
  it("course material stays scoped to the student's class, and school-level documents stay shared", async () => {
    expect((await file(s.people.STUDENT, docs.notes6A._id)).status).toBe(200);
    expect((await file(s.people.STUDENT, docs.notes6B._id)).status).toBe(404);
    expect((await file(s.people.STUDENT, docs.holidayList._id)).status).toBe(200);
    expect((await file(s.people.PARENT, docs.holidayList._id)).status).toBe(200);
  });

  it("a school admin still sees and downloads every one of the school's documents", async () => {
    const r = await list(s.people.ADMIN);
    expect(r.titles).toEqual(ALL_TITLES);
    for (const d of [docs.priyaTc, docs.rahulTc, docs.amanLetter, docs.notes6B]) {
      expect((await file(s.people.ADMIN, d._id)).status).toBe(200);
    }
    expect((await list(s.people.ADMIN, `?studentId=${s.rahul.student._id}`)).titles).toEqual(['Rahul TC']);
  });

  it("a document not published to the student's role stays hidden from them, even their own", async () => {
    await publish(OAK, 'Priya Internal Note', { type: 'LETTER', studentId: s.priya.student._id, visibleToRoles: ['ADMIN'] });
    expect((await list(s.people.STUDENT)).titles).not.toContain('Priya Internal Note');
  });
});
