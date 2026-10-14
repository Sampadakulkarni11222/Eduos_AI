import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';

/**
 * Warden audit fixes.
 *
 * W1: allotment ignored gender -- a boy was placed in a GIRLS room (API and CSV).
 * W2: a CLOSED / maintenance room could take residents.
 * W3: count-then-create let two parallel allotments both take the last bed.
 * W4: a room could shrink below, or close on, its residents ("available -2").
 * W5: the residents list sort was on a populated path, so it was ignored.
 * W6: an inquiry was stored as sent, so raisedBy and status could be forged.
 */

const hostel = await import('../src/modules/hostel/hostel.service.js');
const { HostelRoom, HostelAllocation } = await import('../src/models/hostel.model.js');
const { Student } = await import('../src/models/student.model.js');
const { inSchool, OAK } = await import('./support/mcpSchool.js');

const oak = (fn) => inSchool(OAK, fn);

let boy; let girl; let unknown;

beforeEach(async () => {
  ({ boy, girl, unknown } = await oak(async () => ({
    boy: await Student.create({ admissionNo: 'H-1', firstName: 'Aarav', lastName: 'Zaveri', gender: 'MALE' }),
    girl: await Student.create({ admissionNo: 'H-2', firstName: 'Diya', lastName: 'Bhatt', gender: 'FEMALE' }),
    unknown: await Student.create({ admissionNo: 'H-3', firstName: 'Kiran', lastName: 'Mehta' }),
  })));
});

const room = (over = {}) => oak(() => HostelRoom.create({ roomNo: `R${Math.random().toString(36).slice(2, 7)}`, capacity: 2, type: 'GENERAL', ...over }));
const allot = (r, s) => oak(() => hostel.allocate({ roomId: String(r._id), studentId: String(s._id) }));

describe('W1: gender', () => {
  it('refuses a boy in a GIRLS room and a girl in a BOYS room with 409', async () => {
    const girls = await room({ type: 'GIRLS' });
    const boys = await room({ type: 'BOYS' });
    await expect(allot(girls, boy)).rejects.toMatchObject({ statusCode: 409, code: 'ROOM_GENDER_MISMATCH' });
    await expect(allot(boys, girl)).rejects.toMatchObject({ statusCode: 409, code: 'ROOM_GENDER_MISMATCH' });
    await expect(allot(boys, unknown)).rejects.toMatchObject({ statusCode: 409, code: 'ROOM_GENDER_MISMATCH' });
    await allot(girls, girl);
    await allot(boys, boy);
    expect(await oak(() => HostelAllocation.countDocuments({ status: 'ACTIVE' }))).toBe(2);
  });

  it('a GENERAL room takes anyone', async () => {
    const r = await room({ capacity: 3 });
    await allot(r, boy); await allot(r, girl); await allot(r, unknown);
  });

  it('the CSV import reports the mismatch on the row', async () => {
    const girls = await room({ type: 'GIRLS', roomNo: 'G-1' });
    const res = await oak(() => hostel.bulkAllocate([{ admissionno: 'H-1', roomno: 'G-1' }, { admissionno: 'H-2', roomno: 'G-1' }]));
    expect(res.imported).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.errors[0].problem ?? JSON.stringify(res.errors[0])).toMatch(/girls room/);
    expect(await oak(() => HostelAllocation.countDocuments({ roomId: girls._id, status: 'ACTIVE' }))).toBe(1);
  });

  it('a room cannot change to a type its residents cannot live in', async () => {
    const r = await room();
    await allot(r, boy);
    await expect(oak(() => hostel.updateRoom(r._id, { type: 'GIRLS' }))).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('W2/W4: room status and capacity against residents', () => {
  it.each(['CLOSED', 'MAINTENANCE'])('refuses to allot into a %s room', async (status) => {
    const r = await room({ status });
    await expect(allot(r, boy)).rejects.toMatchObject({ statusCode: 409, code: 'ROOM_NOT_ACTIVE' });
  });

  it('refuses to shrink a room below its residents or close it on them', async () => {
    const r = await room({ capacity: 3 });
    await allot(r, boy); await allot(r, girl);
    await expect(oak(() => hostel.updateRoom(r._id, { capacity: 1 }))).rejects.toMatchObject({ statusCode: 409, code: 'ROOM_OCCUPIED' });
    await expect(oak(() => hostel.updateRoom(r._id, { status: 'CLOSED' }))).rejects.toMatchObject({ statusCode: 409, code: 'ROOM_OCCUPIED' });
    const ok = await oak(() => hostel.updateRoom(r._id, { capacity: 2 }));
    expect(ok.capacity).toBe(2);
    const [listed] = await oak(() => hostel.listRooms({}));
    expect(listed.available).toBe(0);
  });

  it('closes an empty room', async () => {
    const r = await room();
    expect((await oak(() => hostel.updateRoom(r._id, { status: 'CLOSED' }))).status).toBe('CLOSED');
  });
});

describe('W3: the last bed', () => {
  it('is given once when two allotments race for it', async () => {
    const r = await room({ capacity: 1 });
    const results = await Promise.allSettled([allot(r, boy), allot(r, girl)]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((x) => x.status === 'rejected').reason).toMatchObject({ statusCode: 409 });
    expect(await oak(() => HostelAllocation.countDocuments({ roomId: r._id, status: 'ACTIVE' }))).toBe(1);
  });
});

describe('W5/W6: residents list and inquiries', () => {
  it('lists residents by last name', async () => {
    const r = await room({ capacity: 3 });
    await allot(r, boy); await allot(r, unknown); await allot(r, girl);
    const rows = await oak(() => hostel.listHostelStudents());
    expect(rows.map((x) => x.studentId.lastName)).toEqual(['Bhatt', 'Mehta', 'Zaveri']);
  });

  it('records the signed-in person as the raiser and always opens the inquiry', async () => {
    const actor = { profileId: String(new mongoose.Types.ObjectId()) };
    const forged = String(new mongoose.Types.ObjectId());
    const inq = await oak(() => hostel.createInquiry({
      subject: 'Fan not working', raisedByProfileId: forged, status: 'RESOLVED', resolvedAt: new Date(),
    }, actor));
    expect(String(inq.raisedByProfileId)).toBe(actor.profileId);
    expect(inq.status).toBe('OPEN');
    expect(inq.resolvedAt).toBeNull();
  });
});
