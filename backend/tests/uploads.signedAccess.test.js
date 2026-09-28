import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { join } from 'path';
import { mkdir, writeFile, rm } from 'fs/promises';
import { Permission } from '../src/models/permission.model.js';
import { Role } from '../src/models/role.model.js';
import { Account } from '../src/models/account.model.js';
import { Profile } from '../src/models/profile.model.js';
import { School } from '../src/models/school.model.js';
import { Student, StudentGuardian } from '../src/models/student.model.js';
import { Ticket } from '../src/models/ticket.model.js';
import { Upload } from '../src/models/upload.model.js';
import { PERMISSION_CATALOG, SYSTEM_ROLES } from '../src/constants/permissions.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { env } from '../src/config/env.js';
import apiRoutes from '../src/routes/index.js';
import { errorHandler, notFoundHandler } from '../src/middleware/errorHandler.js';
import {
  requireSignedUploadUrl, signUploadPath, verifyUploadSignature, stripUploadSignature, expiryFor,
} from '../src/modules/uploads/signedUrls.js';

/**
 * Files under /uploads are served only through signed, expiring links, handed
 * out inside responses the caller was already entitled to. These tests drive
 * the real API router and the real /uploads gate together.
 */

const OAK = 'oakridge';
const NVMP = 'nvmp';
const inOak = (fn) => runWithTenant(OAK, fn);
const uploadDir = join(process.cwd(), env.UPLOAD_DIR);
const created = [];

let server;
let base;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // The same two layers app.js mounts: the signature gate, then the files.
  app.use('/uploads', requireSignedUploadUrl, express.static(uploadDir));
  app.use('/api/v1', apiRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  await mkdir(uploadDir, { recursive: true });
});

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await Promise.all(created.map((name) => rm(join(uploadDir, name), { force: true })));
});

const roleByKey = new Map();
const tokens = {};
const ids = {};

async function mkProfile(tenantId, phone, roleKey) {
  const account = await Account.create({ phoneE164: phone });
  const profile = await Profile.create({
    accountId: account._id, roleId: roleByKey.get(roleKey)._id, displayName: `${roleKey} ${phone}`, tenantId, tenantName: tenantId,
  });
  return { profile, token: signAccessToken({ accountId: account._id.toString(), profileId: profile._id.toString() }) };
}

async function api(method, path, token, body) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function upload(token, name, bytes) {
  const res = await fetch(`${base}/api/v1/uploads`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'x-filename': name, 'content-type': 'application/octet-stream' },
    body: Buffer.from(bytes),
  });
  const json = await res.json();
  const stored = json.data.fileUrl.split('?')[0].replace('/uploads/', '');
  created.push(stored);
  return json.data.fileUrl;
}

const getFile = (url) => fetch(`${base}${url}`);

beforeEach(async () => {
  for (const p of PERMISSION_CATALOG) await Permission.create({ key: p.key, group: p.group, description: p.description, isSystem: true });
  roleByKey.clear();
  for (const r of SYSTEM_ROLES) {
    roleByKey.set(r.key, await Role.create({ key: r.key, name: r.name, isSystem: true, permissions: r.grants }));
  }
  await School.create({ slug: OAK, name: 'Oakridge' });
  await School.create({ slug: NVMP, name: 'NVMP' });

  const oakAdmin = await mkProfile(OAK, '+919700000001', 'ADMIN');
  const parent = await mkProfile(OAK, '+919700000002', 'PARENT');
  const otherParent = await mkProfile(OAK, '+919700000003', 'PARENT');
  const nvmpParent = await mkProfile(NVMP, '+919700000004', 'PARENT');
  Object.assign(tokens, { oakAdmin: oakAdmin.token, parent: parent.token, otherParent: otherParent.token, nvmpParent: nvmpParent.token });

  await inOak(async () => {
    const kid = await Student.create({ admissionNo: 'K-1', firstName: 'Own', lastName: 'Kid' });
    const other = await Student.create({ admissionNo: 'K-2', firstName: 'Other', lastName: 'Kid' });
    await StudentGuardian.create({ studentId: kid._id, guardianProfileId: parent.profile._id, relation: 'MOTHER' });
    await StudentGuardian.create({ studentId: other._id, guardianProfileId: otherParent.profile._id, relation: 'MOTHER' });
    ids.kid = kid._id.toString();
    ids.other = other._id.toString();
  });
});

describe('the /uploads gate', () => {
  it('refuses a bare path, even to a file that exists', async () => {
    const signed = await upload(tokens.oakAdmin, 'plain.pdf', '%PDF-plain');
    const bare = signed.split('?')[0];
    const res = await getFile(bare);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('%PDF-plain');
  });

  it('serves the file through the signed link the upload returned', async () => {
    const signed = await upload(tokens.oakAdmin, 'notes.pdf', '%PDF-notes');
    expect(signed).toMatch(/^\/uploads\/[^?]+\?exp=\d+&sig=[0-9a-f]{40}$/);
    const res = await getFile(signed);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('%PDF-notes');
  });

  it('refuses a tampered signature, and a signature moved to another file', async () => {
    const a = await upload(tokens.oakAdmin, 'a.pdf', '%PDF-a');
    const b = await upload(tokens.oakAdmin, 'b.pdf', '%PDF-b');
    // Always a DIFFERENT digit: overwriting with a fixed "0" left the link
    // untouched whenever the real signature already began with 0 (1 run in 16).
    const tampered = a.replace(/sig=([0-9a-f])/, (_m, d) => `sig=${d === '0' ? '1' : '0'}`);
    expect(tampered).not.toBe(a);
    expect((await getFile(tampered)).status).toBe(403);
    const moved = `${b.split('?')[0]}?${a.split('?')[1]}`;
    expect((await getFile(moved)).status).toBe(403);
  });

  it('expires links, and refuses an expiry pushed into the future', () => {
    const now = Date.UTC(2026, 8, 27, 10, 30);
    const url = signUploadPath('x.pdf', now);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(verifyUploadSignature('x.pdf', params.get('exp'), params.get('sig'), now)).toBe(true);
    expect(verifyUploadSignature('x.pdf', params.get('exp'), params.get('sig'), now + 3 * 3600_000)).toBe(false);
    const far = expiryFor(now) + 24 * 3600;
    expect(verifyUploadSignature('x.pdf', far, params.get('sig'), now)).toBe(false);
  });

  it('refuses a traversal name outright', () => {
    expect(verifyUploadSignature('..', expiryFor(), 'x')).toBe(false);
    expect(verifyUploadSignature('../.env', expiryFor(), 'x')).toBe(false);
  });
});

describe('medical attachments', () => {
  it("reach the child's guardian through a signed link, and nobody else", async () => {
    const signed = await upload(tokens.oakAdmin, 'allergy-report.pdf', '%PDF-medical');
    const saved = await api('PUT', `/medical/${ids.kid}`, tokens.oakAdmin, {
      bloodGroup: 'O+', attachments: [{ name: 'Allergy report', fileUrl: signed }],
    });
    expect(saved.status).toBe(200);

    // The guardian's read hands back a working link.
    const read = await api('GET', `/medical/${ids.kid}`, tokens.parent);
    expect(read.status).toBe(200);
    const link = read.body.data.attachments[0].fileUrl;
    expect(link).toMatch(/\?exp=\d+&sig=/);
    expect(await (await getFile(link)).text()).toBe('%PDF-medical');

    // Another family cannot read the record, so never receives a link.
    expect((await api('GET', `/medical/${ids.kid}`, tokens.otherParent)).status).toBe(404);
    // Another school cannot either.
    expect([403, 404]).toContain((await api('GET', `/medical/${ids.kid}`, tokens.nvmpParent)).status);
    // And the stored path on its own opens nothing.
    expect((await getFile(link.split('?')[0])).status).toBe(403);
  });
});

describe('what is stored, and what gets signed', () => {
  it('stores the canonical path when a signed link is sent back', async () => {
    const signed = await upload(tokens.parent, 'note.pdf', '%PDF-note');
    const res = await api('POST', '/tickets', tokens.parent, {
      subject: 'With a document', routedToRoleKey: 'ADMIN', documentUrl: signed,
    });
    expect(res.status).toBe(201);
    const ticket = await inOak(() => Ticket.findOne({ subject: 'With a document' }).lean());
    expect(ticket.documentUrl).toBe(signed.split('?')[0]);
    expect(stripUploadSignature(signed)).toBe(ticket.documentUrl);
  });

  it("never signs another school's file, even when it is pasted into a record here", async () => {
    const oakFile = await upload(tokens.oakAdmin, 'oak-private.pdf', '%PDF-oak');
    const leakedPath = oakFile.split('?')[0];
    const res = await api('POST', '/tickets', tokens.nvmpParent, {
      subject: 'Laundering', routedToRoleKey: 'ADMIN', documentUrl: leakedPath,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.documentUrl).toBe(leakedPath);
    expect((await getFile(res.body.data.documentUrl)).status).toBe(403);
  });

  it('still signs a file stored before uploads were recorded', async () => {
    const legacy = `legacy-${Date.now()}-report.pdf`;
    await writeFile(join(uploadDir, legacy), '%PDF-legacy');
    created.push(legacy);
    expect(await Upload.countDocuments({ storedName: legacy })).toBe(0);
    const res = await api('POST', '/tickets', tokens.parent, {
      subject: 'Legacy', routedToRoleKey: 'ADMIN', documentUrl: `/uploads/${legacy}`,
    });
    expect(res.body.data.documentUrl).toMatch(/\?exp=\d+&sig=/);
    expect(await (await getFile(res.body.data.documentUrl)).text()).toBe('%PDF-legacy');
  });

  it('records which school an upload belongs to', async () => {
    const signed = await upload(tokens.nvmpParent, 'n.pdf', '%PDF-n');
    const row = await Upload.findOne({ storedName: signed.split('?')[0].replace('/uploads/', '') }).lean();
    expect(row.tenantId).toBe(NVMP);
  });
});
