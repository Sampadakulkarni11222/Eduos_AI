import { describe, it, expect, beforeEach } from 'vitest';
import { Student, Enrollment } from '../src/models/student.model.js';
import { Grade, Section, AcademicYear } from '../src/models/academics.model.js';
import { Book } from '../src/models/library.model.js';
import { HostelRoom } from '../src/models/hostel.model.js';
import { Ticket } from '../src/models/ticket.model.js';
import { Invoice } from '../src/models/fee.model.js';
import { AttendanceRecord } from '../src/models/attendanceRecord.model.js';
import { Account } from '../src/models/account.model.js';
import { Role } from '../src/models/role.model.js';
import { Profile } from '../src/models/profile.model.js';
import mongoose from 'mongoose';
import { runWithTenant, runAcrossSchools, currentTenantId } from '../src/tenancy/tenantContext.js';

const someId = () => new mongoose.Types.ObjectId();

/**
 * Data isolation between schools.
 *
 * The guarantee under test is that a query written without a tenant clause —
 * which is nearly every query in the app — still cannot reach another school's
 * documents once a school context is set. That is what makes isolation a
 * property of the system rather than of ~300 individual call sites remembering
 * to filter.
 */

const inOak = (fn) => runWithTenant('oakridge', fn);
const inNvmp = (fn) => runWithTenant('nvmp', fn);

beforeEach(async () => {
  await inOak(async () => {
    await Student.create({ admissionNo: 'ADM-0001', firstName: 'Oak', lastName: 'Student' });
    await Book.create({ title: 'Oakridge Reader', author: 'A', totalCopies: 3, availableCopies: 3 });
    await HostelRoom.create({ roomNo: '101', block: 'A', capacity: 2 });
    await Ticket.create({ subject: 'Oak ticket', status: 'OPEN', raisedByProfileId: someId() });
  });
  await inNvmp(async () => {
    await Student.create({ admissionNo: 'ADM-0001', firstName: 'Nvmp', lastName: 'Student' });
    await Book.create({ title: 'NVMP Reader', author: 'B', totalCopies: 1, availableCopies: 1 });
    await HostelRoom.create({ roomNo: '101', block: 'A', capacity: 4 });
  });
});

describe('a school only sees its own documents', () => {
  it('find() returns only the acting school, with no tenant clause written', async () => {
    const oak = await inOak(() => Student.find().lean());
    const nvmp = await inNvmp(() => Student.find().lean());

    expect(oak).toHaveLength(1);
    expect(nvmp).toHaveLength(1);
    expect(oak[0].firstName).toBe('Oak');
    expect(nvmp[0].firstName).toBe('Nvmp');
  });

  it('counts are per school', async () => {
    expect(await inOak(() => Ticket.countDocuments())).toBe(1);
    expect(await inNvmp(() => Ticket.countDocuments())).toBe(0);
    expect(await inOak(() => Book.countDocuments())).toBe(1);
    expect(await inNvmp(() => Book.countDocuments())).toBe(1);
  });

  it('findOne cannot reach another school, even by exact id', async () => {
    const oakBook = await inOak(() => Book.findOne().lean());
    expect(await inNvmp(() => Book.findById(oakBook._id).lean())).toBeNull();
    expect(await inOak(() => Book.findById(oakBook._id).lean())).not.toBeNull();
  });

  it('aggregate is filtered too — the shape dashboards are built on', async () => {
    const count = async () =>
      (await Student.aggregate([{ $group: { _id: null, n: { $sum: 1 } } }]))[0]?.n ?? 0;
    expect(await inOak(count)).toBe(1);
    expect(await inNvmp(count)).toBe(1);
    expect(await runAcrossSchools(count)).toBe(2);
  });

  it('distinct does not leak values from another school', async () => {
    const titles = (fn) => fn(() => Book.distinct('title'));
    expect(await titles(inOak)).toEqual(['Oakridge Reader']);
    expect(await titles(inNvmp)).toEqual(['NVMP Reader']);
  });
});

describe('writes stay inside the acting school', () => {
  it('stamps new documents without the caller passing a tenant', async () => {
    const created = await inNvmp(() => Ticket.create({ subject: 'NVMP ticket', status: 'OPEN', raisedByProfileId: someId() }));
    expect(created.tenantId).toBe('nvmp');
    expect(await inOak(() => Ticket.countDocuments())).toBe(1);
    expect(await inNvmp(() => Ticket.countDocuments())).toBe(1);
  });

  it('updateMany cannot touch another school', async () => {
    await inNvmp(() => Student.updateMany({}, { $set: { lastName: 'Renamed' } }));
    expect((await inOak(() => Student.findOne().lean())).lastName).toBe('Student');
    expect((await inNvmp(() => Student.findOne().lean())).lastName).toBe('Renamed');
  });

  it('deleteMany cannot empty another school', async () => {
    await inNvmp(() => Book.deleteMany({}));
    expect(await inNvmp(() => Book.countDocuments())).toBe(0);
    expect(await inOak(() => Book.countDocuments())).toBe(1);
  });

  it('an upsert creates in the acting school, not globally', async () => {
    await inNvmp(() => Invoice.updateOne(
      { invoiceNo: 'INV-NVMP-1' },
      { $set: { enrollmentId: someId(), totalPaise: 10000, dueOn: new Date() } },
      { upsert: true },
    ));
    expect(await inNvmp(() => Invoice.countDocuments())).toBe(1);
    expect(await inOak(() => Invoice.countDocuments())).toBe(0);
    expect((await inNvmp(() => Invoice.findOne().lean())).tenantId).toBe('nvmp');
  });

  it('bulkWrite stamps too — the shape attendance and marks are written with', async () => {
    // bulkWrite is a model-level operation, so none of the query hooks fire for
    // it. Without explicit support these rows landed with no tenantId: absent
    // from every school-scoped read, and owned by nobody.
    const enrollmentId = someId();
    await inNvmp(() => AttendanceRecord.bulkWrite([{
      updateOne: {
        filter: { enrollmentId, date: new Date('2026-03-10'), periodNo: null },
        update: { $set: { status: 'PRESENT' } },
        upsert: true,
      },
    }]));

    expect(await inNvmp(() => AttendanceRecord.countDocuments())).toBe(1);
    expect(await inOak(() => AttendanceRecord.countDocuments())).toBe(0);
    expect((await inNvmp(() => AttendanceRecord.findOne().lean())).tenantId).toBe('nvmp');
  });

  it('insertMany stamps every document', async () => {
    await inNvmp(() => Book.insertMany([
      { title: 'B1', author: 'x', totalCopies: 1, availableCopies: 1 },
      { title: 'B2', author: 'y', totalCopies: 1, availableCopies: 1 },
    ]));
    expect(await inNvmp(() => Book.countDocuments())).toBe(3);
    expect(await inOak(() => Book.countDocuments())).toBe(1);
  });
});

describe('identifiers a school picks for itself are unique per school, not globally', () => {
  it('two schools can both use admission no. ADM-0001', async () => {
    const all = await runAcrossSchools(() => Student.find({ admissionNo: 'ADM-0001' }).lean());
    expect(all).toHaveLength(2);
    expect(all.map((s) => s.tenantId).sort()).toEqual(['nvmp', 'oakridge']);
  });

  it('two schools can both have room 101 and a Class 5', async () => {
    expect(await runAcrossSchools(() => HostelRoom.countDocuments({ roomNo: '101' }))).toBe(2);

    await inOak(() => Grade.create({ name: 'Class 5', level: 5 }));
    await inNvmp(() => Grade.create({ name: 'Class 5', level: 5 }));
    expect(await runAcrossSchools(() => Grade.countDocuments({ name: 'Class 5' }))).toBe(2);
  });

  it('still rejects a duplicate inside one school', async () => {
    await expect(
      inOak(() => Student.create({ admissionNo: 'ADM-0001', firstName: 'Duplicate' })),
    ).rejects.toThrow();
  });
});

describe('the platform view', () => {
  it('reads across schools when explicitly asked to', async () => {
    expect(await runAcrossSchools(() => Student.countDocuments())).toBe(2);
    expect(await runAcrossSchools(() => Book.countDocuments())).toBe(2);
  });

  it('leaves no tenant set outside a scope, so scripts and seeds still work', async () => {
    expect(currentTenantId()).toBeNull();
    expect(await Student.countDocuments()).toBe(2);
  });

  it('keeps identity collections global — an account is not owned by a school', async () => {
    const role = await Role.create({ key: 'ADMIN', name: 'Admin', permissions: [] });
    const account = await Account.create({ phoneE164: '+919812300001', email: 'shared@example.com' });
    await Profile.create({ accountId: account._id, roleId: role._id, displayName: 'Oak Admin', tenantId: 'oakridge' });

    // Sign-in has to find the account before any school is known.
    expect(await inNvmp(() => Account.findOne({ email: 'shared@example.com' }).lean())).not.toBeNull();
    expect(await inOak(() => Account.findOne({ email: 'shared@example.com' }).lean())).not.toBeNull();
  });
});

describe('linked records follow their school', () => {
  it('an enrolment written in one school is invisible in the other', async () => {
    await inOak(async () => {
      const year = await AcademicYear.create({ name: '2026-27', startsOn: new Date(), endsOn: new Date() });
      const grade = await Grade.create({ name: 'Class 6', level: 6 });
      const section = await Section.create({ gradeId: grade._id, name: 'A' });
      const student = await Student.findOne();
      await Enrollment.create({ studentId: student._id, sectionId: section._id, academicYearId: year._id, status: 'ACTIVE' });
    });

    expect(await inOak(() => Enrollment.countDocuments())).toBe(1);
    expect(await inNvmp(() => Enrollment.countDocuments())).toBe(0);
    expect(await inNvmp(() => Section.countDocuments())).toBe(0);
  });
});
