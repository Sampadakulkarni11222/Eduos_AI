import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { inSchool, OAK, mcp } from './support/mcpSchool.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { seedFamilySchool } from './support/familySchool.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { Book } from '../src/models/library.model.js';
import { BookRequest } from '../src/models/bookRequest.model.js';
import { TransportRoute, TransportStop } from '../src/models/transport.model.js';
import { TransportRequest } from '../src/models/transportRequest.model.js';
import { Notification } from '../src/models/notification.model.js';
import * as library from '../src/modules/library/library.service.js';
import * as transport from '../src/modules/transport/transport.service.js';

/**
 * Part 4 (lead's item): parents make library and transport requests for
 * their own children. PARENT holds library.request and transport.request at
 * OWN; the services take the child from the parent's own guardian links and
 * refuse anyone else's child. Students keep asking for themselves only.
 *
 * Fixture: PARENT is the father of Rahul (6 A) and Riya (6 B); PARENT2 is
 * Aman's mother; STUDENT is Priya.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);
const P = () => s.people.PARENT.actor;
const P2 = () => s.people.PARENT2.actor;
const id = (x) => String(x.student._id);

beforeEach(async () => { s = await seedFamilySchool(); });

describe('the grants', () => {
  it('PARENT holds library.request and transport.request at OWN scope', () => {
    const map = buildPermissionMap({ permissions: SYSTEM_ROLES.find((r) => r.key === 'PARENT').grants });
    expect(map['library.request']).toBe('OWN');
    expect(map['transport.request']).toBe('OWN');
  });
});

describe('library requests by a parent', () => {
  it('asks for one of their own children, lists and withdraws it; the decision tells the parent too', async () => {
    const book = await inOak(() => Book.create({ title: 'Malgudi Days', author: 'R K Narayan', totalCopies: 2, availableCopies: 2 }));
    const r = await inOak(() => library.requestBook(P(), String(book._id), id(s.riya)));
    expect(r).toMatchObject({ status: 'PENDING', studentId: id(s.riya) });
    const mine = await inOak(() => library.listMyBookRequests(P()));
    expect(mine.map((x) => x.studentId)).toEqual([id(s.riya)]);
    await inOak(() => library.decideBookRequest(s.people.LIBRARIAN.actor, r.id, { status: 'APPROVED' }));
    expect(await inOak(() => Notification.countDocuments({ recipientProfileId: s.people.PARENT.profile._id, type: 'LIBRARY' }))).toBe(1);
    const r2 = await inOak(() => library.requestBook(P(), String(book._id), id(s.rahul)));
    const c = await inOak(() => library.cancelBookRequest(P(), r2.id));
    expect(c.status).toBe('CANCELLED');
  });

  it("refuses another family's child, asks which child when there are two, and keeps students to themselves", async () => {
    const book = await inOak(() => Book.create({ title: 'Swami and Friends', author: 'R K Narayan', totalCopies: 1, availableCopies: 1 }));
    await expect(inOak(() => library.requestBook(P(), String(book._id), id(s.aman)))).rejects.toMatchObject({ statusCode: 403, code: 'STUDENT_OUT_OF_SCOPE' });
    await expect(inOak(() => library.requestBook(P(), String(book._id)))).rejects.toMatchObject({ code: 'CHILD_REQUIRED' });
    // One child: no need to say which.
    const one = await inOak(() => library.requestBook(P2(), String(book._id)));
    expect(one.studentId).toBe(id(s.aman));
    // Another parent cannot withdraw it, or list it.
    await expect(inOak(() => library.cancelBookRequest(P(), one.id))).rejects.toMatchObject({ statusCode: 404 });
    expect((await inOak(() => library.listMyBookRequests(P()))).length).toBe(0);
    // A student naming someone else still gets their own record.
    const st = await inOak(() => library.requestBook(s.people.STUDENT.actor, String(book._id), id(s.rahul)));
    expect(st.studentId).toBe(id(s.priya));
    expect(await inOak(() => BookRequest.countDocuments())).toBe(2);
  });
});

describe('transport requests by a parent', () => {
  async function route() {
    return inOak(async () => {
      const r = await TransportRoute.create({ name: 'Route 7', status: 'ACTIVE', fareAmountPaise: 150000 });
      const stop = await TransportStop.create({ routeId: r._id, name: 'Lake Road', sequenceNo: 1 });
      return { routeId: String(r._id), stopId: String(stop._id) };
    });
  }

  it('lists routes and asks for a place for their own child; refuses another family\'s child', async () => {
    const { routeId, stopId } = await route();
    const avail = await inOak(() => transport.listRoutesForStudent(P(), { studentId: id(s.rahul) }));
    expect(avail.routes.map((r) => r.name)).toContain('Route 7');
    const req = await inOak(() => transport.requestRoute(P(), { routeId, stopId, studentId: id(s.rahul) }));
    expect(req).toMatchObject({ status: 'PENDING', studentId: id(s.rahul) });
    await expect(inOak(() => transport.requestRoute(P(), { routeId, stopId, studentId: id(s.aman) }))).rejects.toMatchObject({ statusCode: 403 });
    await expect(inOak(() => transport.requestRoute(P(), { routeId, stopId }))).rejects.toMatchObject({ code: 'CHILD_REQUIRED' });
    expect((await inOak(() => transport.listMyTransportRequests(P()))).map((x) => x.studentId)).toEqual([id(s.rahul)]);
    await expect(inOak(() => transport.cancelTransportRequest(P2(), req.id))).rejects.toMatchObject({ statusCode: 404 });
    const c = await inOak(() => transport.cancelTransportRequest(P(), req.id));
    expect(c.status).toBe('CANCELLED');
    expect(await inOak(() => TransportRequest.countDocuments({ status: 'PENDING' }))).toBe(0);
  });
});

describe('through the assistant', () => {
  afterAll(async () => { await resetMcpClient(); });
  it('a parent asks for a book for a named child after confirming; another family child is not a choice', async () => {
    await inOak(() => Book.create({ title: 'The Jungle Book', author: 'Rudyard Kipling', totalCopies: 1, availableCopies: 1 }));
    const p = await mcp(OAK, P(), 'request_book', { title: 'The Jungle Book', childName: 'Riya' });
    expect(p.success, JSON.stringify(p.error)).toBe(true);
    expect(p.action.summary).toMatch(/to Riya Kapoor/);
    const done = await mcp(OAK, P(), 'request_book', {}, { confirmationToken: p.action.confirmationToken });
    expect(done.success, JSON.stringify(done.error)).toBe(true);
    expect(String((await inOak(() => BookRequest.findOne().lean())).studentId)).toBe(id(s.riya));
    const other = await mcp(OAK, P(), 'request_book', { title: 'The Jungle Book', childName: 'Aman' });
    expect(other.success).toBe(false);
  });
});
