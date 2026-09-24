import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';

/**
 * Hostel room writes over real HTTP, as the warden's Add Room form sends them.
 *
 * BUG-01: the form offered a "Bed Type" of AC / NON_AC and sent it as `type`,
 * a field whose enum is BOYS / GIRLS / STAFF / GENERAL everywhere else (model,
 * CSV import, MCP tools). Every room added from the form failed with a 422.
 * Air conditioning is now an amenity, the field the model already has for it.
 *
 * BUG-02: POST and PATCH passed the body straight to Mongoose, and capacity
 * had no bounds, so -1, 2.5 or 100000 beds were stored. The rule already
 * stated by the form (min 1), the CSV importer (> 0, whole beds) and the MCP
 * tools (integer 1-50) is now enforced on every write path.
 */

const { default: apiRoutes } = await import('../src/routes/index.js');
const { errorHandler, notFoundHandler } = await import('../src/middleware/errorHandler.js');
const { signAccessToken } = await import('../src/utils/jwt.js');
const { HostelRoom } = await import('../src/models/hostel.model.js');
const hostel = await import('../src/modules/hostel/hostel.service.js');
const { seedRoles, seedPerson, inSchool, OAK } = await import('./support/mcpSchool.js');

let server;
let base;
let warden;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', apiRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  const roleIds = await seedRoles();
  warden = await seedPerson({ roleKey: 'WARDEN', roleId: roleIds.WARDEN });
});

async function call(method, path, body) {
  const token = signAccessToken({ accountId: warden.actor.accountId, profileId: warden.actor.profileId, door: null });
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const roomsIn = () => inSchool(OAK, () => HostelRoom.find().lean());

describe('BUG-01: adding a room from the warden form', () => {
  it('creates an air-conditioned room, recorded as an amenity', async () => {
    const res = await call('POST', '/hostel/rooms', {
      roomNo: '104', block: 'Block A', capacity: 2, type: 'GENERAL', amenities: ['AC'],
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ roomNo: '104', type: 'GENERAL', capacity: 2, amenities: ['AC'] });
  });

  it('creates a non-AC room', async () => {
    const res = await call('POST', '/hostel/rooms', { roomNo: '105', block: 'Block A', capacity: 2, type: 'BOYS', amenities: [] });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ roomNo: '105', type: 'BOYS', amenities: [] });
  });

  it('defaults the type to GENERAL when none is sent', async () => {
    const res = await call('POST', '/hostel/rooms', { roomNo: '106', capacity: 3 });
    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe('GENERAL');
  });

  it.each(['AC', 'NON_AC', 'NON-AC', 'boys'])('refuses %j as a room type with a message naming the valid ones', async (type) => {
    const res = await call('POST', '/hostel/rooms', { roomNo: '107', capacity: 2, type });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('INVALID_ROOM_TYPE');
    expect(res.body.message).toContain('BOYS, GIRLS, STAFF, GENERAL');
    expect(await roomsIn()).toHaveLength(0);
  });
});

describe('BUG-02: room capacity', () => {
  it.each([1, 4, 50])('accepts %j beds', async (capacity) => {
    const res = await call('POST', '/hostel/rooms', { roomNo: `R${capacity}`, capacity });
    expect(res.status).toBe(201);
    expect(res.body.data.capacity).toBe(capacity);
  });

  it.each([0, -1, -10, -999, 2.5, 51, 100000, 'abc', '', null, true])('refuses %j beds on create', async (capacity) => {
    const res = await call('POST', '/hostel/rooms', { roomNo: '201', capacity });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('INVALID_ROOM_CAPACITY');
    expect(await roomsIn()).toHaveLength(0);
  });

  it('refuses a room with no capacity at all', async () => {
    const res = await call('POST', '/hostel/rooms', { roomNo: '202' });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('INVALID_ROOM_CAPACITY');
  });

  it('accepts a numeric string, as a form or CSV would send it', async () => {
    const res = await call('POST', '/hostel/rooms', { roomNo: '203', capacity: '6' });
    expect(res.status).toBe(201);
    expect(res.body.data.capacity).toBe(6);
  });

  it.each([0, -1, -10, -999, 2.5, 51, 'abc', null])('refuses %j beds on update and leaves the room as it was', async (capacity) => {
    const created = await call('POST', '/hostel/rooms', { roomNo: '301', capacity: 4 });
    const res = await call('PATCH', `/hostel/rooms/${created.body.data._id}`, { capacity });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('INVALID_ROOM_CAPACITY');
    const [room] = await roomsIn();
    expect(room.capacity).toBe(4);
  });

  it('refuses an invalid type on update', async () => {
    const created = await call('POST', '/hostel/rooms', { roomNo: '302', capacity: 4 });
    const res = await call('PATCH', `/hostel/rooms/${created.body.data._id}`, { type: 'AC' });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('INVALID_ROOM_TYPE');
  });

  it('updates a valid capacity, and leaves capacity alone when the update does not name it', async () => {
    const created = await call('POST', '/hostel/rooms', { roomNo: '303', capacity: 4 });
    const id = created.body.data._id;
    expect((await call('PATCH', `/hostel/rooms/${id}`, { capacity: 6 })).body.data.capacity).toBe(6);
    const res = await call('PATCH', `/hostel/rooms/${id}`, { status: 'MAINTENANCE' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ capacity: 6, status: 'MAINTENANCE' });
  });

  it('the model refuses a negative or fractional capacity written around the service', async () => {
    await expect(inSchool(OAK, () => HostelRoom.create({ roomNo: 'X1', capacity: -1 }))).rejects.toThrow(/capacity/);
    await expect(inSchool(OAK, () => HostelRoom.create({ roomNo: 'X2', capacity: 2.5 }))).rejects.toThrow(/capacity/);
  });

  it('the CSV importer applies the same rule', async () => {
    const result = await inSchool(OAK, () => hostel.bulkCreateRooms([
      { roomno: 'C1', capacity: '4', type: 'BOYS' },
      { roomno: 'C2', capacity: '-1' },
      { roomno: 'C3', capacity: '2.5' },
      { roomno: 'C4', capacity: '51' },
    ]));
    expect(result.imported).toBe(1);
    expect(result.failed).toBe(3);
    expect(result.errors.map((e) => e.row)).toEqual([3, 4, 5]);
  });
});
