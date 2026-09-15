import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Student, Enrollment } from '../src/models/student.model.js';
import { Grade, Section, AcademicYear } from '../src/models/academics.model.js';
import { Book, BookIssue } from '../src/models/library.model.js';
import { BookRequest } from '../src/models/bookRequest.model.js';
import { TransportRoute, TransportStop, BusEnrollment } from '../src/models/transport.model.js';
import { TransportRequest } from '../src/models/transportRequest.model.js';
import { Invoice, InvoiceLine } from '../src/models/fee.model.js';
import { Notification } from '../src/models/notification.model.js';
import * as library from '../src/modules/library/library.service.js';
import * as transport from '../src/modules/transport/transport.service.js';

/**
 * A student asks; the person who holds the permission decides.
 *
 * Two flows with the same shape, built on the one the elective registrations
 * already use: the asking is a request, not a fact, and only the decision
 * changes anything. What the decision changes differs — a book request that is
 * approved issues the book, a transport request that is approved creates the
 * travel arrangement and raises the invoice for the fare — so each is checked
 * for what it actually did, not merely for a status field.
 *
 * Identity is never taken from the caller's arguments: the student is resolved
 * from the session profile, which is what the foreign-student cases below pin.
 */

let student, otherStudent, year, enrollment, book, route, stop;
const librarian = { profileId: new mongoose.Types.ObjectId().toString(), roleKey: 'LIBRARIAN', ip: '10.0.0.1' };
const admin = { profileId: new mongoose.Types.ObjectId().toString(), roleKey: 'ADMIN', ip: '10.0.0.2' };

const actorFor = (s) => ({ profileId: s.profileId.toString(), roleKey: 'STUDENT', ip: '10.0.0.9' });

beforeEach(async () => {
  const grade = await Grade.create({ name: 'Class 7', level: 7 });
  const section = await Section.create({ gradeId: grade._id, name: 'A' });
  year = await AcademicYear.create({
    name: '2026-27', startsOn: new Date('2026-04-01'), endsOn: new Date('2027-03-31'), isCurrent: true,
  });

  student = await Student.create({
    admissionNo: 'REQ-1', firstName: 'Nina', lastName: 'Rao', status: 'ACTIVE',
    profileId: new mongoose.Types.ObjectId(),
  });
  enrollment = await Enrollment.create({
    studentId: student._id, sectionId: section._id, academicYearId: year._id, status: 'ACTIVE', rollNo: 1,
  });

  otherStudent = await Student.create({
    admissionNo: 'REQ-2', firstName: 'Omar', lastName: 'Shah', status: 'ACTIVE',
    profileId: new mongoose.Types.ObjectId(),
  });
  await Enrollment.create({
    studentId: otherStudent._id, sectionId: section._id, academicYearId: year._id, status: 'ACTIVE', rollNo: 2,
  });

  book = await Book.create({
    title: 'Wings of Fire', author: 'A. P. J. Abdul Kalam', totalCopies: 1, availableCopies: 1,
  });

  route = await TransportRoute.create({
    name: 'Route 4 — Gandhi Nagar', vehicleNo: 'MH-12-AB-1234',
    driverName: 'Suresh', driverPhone: '+919800000000',
    fareAmountPaise: 1200000, status: 'ACTIVE',
  });
  stop = await TransportStop.create({ routeId: route._id, name: 'Market Gate', sequenceNo: 1 });
});

/* ── Books ────────────────────────────────────────────────── */

describe('a student asks for a book and a librarian decides', () => {
  it('records the ask without taking a copy off the shelf', async () => {
    const request = await library.requestBook(actorFor(student), book._id.toString());

    expect(request.status).toBe('PENDING');
    expect(request.bookTitle).toBe('Wings of Fire');
    // A request is an ask. Holding a copy for every ask would empty the
    // catalogue to requests that may never be approved.
    expect((await Book.findById(book._id)).availableCopies).toBe(1);
    expect(await BookIssue.countDocuments({})).toBe(0);
  });

  it('issues the book on approval, and only then', async () => {
    const request = await library.requestBook(actorFor(student), book._id.toString());
    const decided = await library.decideBookRequest(librarian, request.id, { status: 'APPROVED' });

    expect(decided.status).toBe('APPROVED');
    expect(decided.issueId).toBeTruthy();

    // The copy is claimed through the same issueBook() the lending screen uses.
    expect((await Book.findById(book._id)).availableCopies).toBe(0);
    const issue = await BookIssue.findById(decided.issueId);
    expect(issue.status).toBe('ACTIVE');
    expect(String(issue.borrowerProfileId)).toBe(String(student._id));
    expect(issue.dueDate.getTime()).toBeGreaterThan(Date.now());
  });

  it('changes nothing on the shelf when it is rejected', async () => {
    const request = await library.requestBook(actorFor(student), book._id.toString());
    const decided = await library.decideBookRequest(librarian, request.id, {
      status: 'REJECTED', note: 'Reserved for the exam shelf',
    });

    expect(decided.status).toBe('REJECTED');
    expect(decided.decisionNote).toBe('Reserved for the exam shelf');
    expect(decided.issueId).toBeNull();
    expect((await Book.findById(book._id)).availableCopies).toBe(1);
    expect(await BookIssue.countDocuments({})).toBe(0);
  });

  it('tells the student what was decided', async () => {
    const request = await library.requestBook(actorFor(student), book._id.toString());
    await library.decideBookRequest(librarian, request.id, { status: 'APPROVED' });

    const note = await Notification.findOne({ recipientProfileId: student.profileId }).lean();
    expect(note?.type).toBe('LIBRARY');
    expect(note?.title).toMatch(/Wings of Fire/);
    expect(note?.link).toBe('/student/library');
  });

  it('refuses a second open request for the same book', async () => {
    await library.requestBook(actorFor(student), book._id.toString());
    await expect(library.requestBook(actorFor(student), book._id.toString()))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('lets a student ask again after a rejection', async () => {
    const first = await library.requestBook(actorFor(student), book._id.toString());
    await library.decideBookRequest(librarian, first.id, { status: 'REJECTED' });

    // The unique index is partial on PENDING/APPROVED precisely so this works.
    const second = await library.requestBook(actorFor(student), book._id.toString());
    expect(second.status).toBe('PENDING');
    expect(second.id).not.toBe(first.id);
  });

  it('leaves the request pending when no copy is free, rather than losing it', async () => {
    await Book.findByIdAndUpdate(book._id, { availableCopies: 0 });
    const request = await library.requestBook(actorFor(student), book._id.toString());

    await expect(library.decideBookRequest(librarian, request.id, { status: 'APPROVED' }))
      .rejects.toMatchObject({ statusCode: 409 });

    // Still decidable once a copy comes back — the alternative would be a
    // request silently marked approved with no book behind it.
    expect((await BookRequest.findById(request.id)).status).toBe('PENDING');
  });

  it('refuses to decide the same request twice', async () => {
    const request = await library.requestBook(actorFor(student), book._id.toString());
    await library.decideBookRequest(librarian, request.id, { status: 'APPROVED' });

    await expect(library.decideBookRequest(librarian, request.id, { status: 'REJECTED' }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(await BookIssue.countDocuments({})).toBe(1);
  });

  it('will not issue a digital resource, which has no copy to hand over', async () => {
    const ebook = await Book.create({
      title: 'Algebra Notes', author: 'Staff', resourceType: 'DIGITAL',
      resourceUrl: 'https://example.invalid/a', totalCopies: 0, availableCopies: 0,
    });
    await expect(library.requestBook(actorFor(student), ebook._id.toString()))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('shows each student only their own requests', async () => {
    await library.requestBook(actorFor(student), book._id.toString());
    await library.requestBook(actorFor(otherStudent), book._id.toString());

    const mine = await library.listMyBookRequests(actorFor(student));
    expect(mine).toHaveLength(1);
    expect(mine[0].admissionNo ?? null).not.toBe('REQ-2');
    expect(mine[0].studentId).toBe(String(student._id));
  });

  it('will not let a student cancel someone else\'s request', async () => {
    const theirs = await library.requestBook(actorFor(otherStudent), book._id.toString());
    // The request is found by (id AND own studentId), so another student's id
    // simply does not exist for this caller.
    await expect(library.cancelBookRequest(actorFor(student), theirs.id))
      .rejects.toMatchObject({ statusCode: 404 });
    expect((await BookRequest.findById(theirs.id)).status).toBe('PENDING');
  });

  it('refuses a request from an account with no student record', async () => {
    const orphan = { profileId: new mongoose.Types.ObjectId().toString(), roleKey: 'STUDENT' };
    await expect(library.requestBook(orphan, book._id.toString()))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});

/* ── Transport ────────────────────────────────────────────── */

describe('a student asks for a place on a route and staff decide', () => {
  it('offers the routes with stops and fare, without the driver\'s contact details', async () => {
    const view = await transport.listRoutesForStudent(actorFor(student));

    expect(view.routes).toHaveLength(1);
    const [offered] = view.routes;
    expect(offered.name).toBe('Route 4 — Gandhi Nagar');
    expect(offered.fareAmountPaise).toBe(1200000);
    expect(offered.stops.map((s) => s.name)).toEqual(['Market Gate']);
    expect(view.canRequest).toBe(true);
    expect(view.myRequest).toBeNull();

    // Choosing a route needs the name, the stops and the price. A family gets
    // the driver's name and number for the route they are actually on, from
    // /my-bus — not for every route in the school.
    const serialised = JSON.stringify(view);
    expect(serialised).not.toMatch(/Suresh/);
    expect(serialised).not.toMatch(/919800000000/);
  });

  it('records the ask without creating a travel arrangement or an invoice', async () => {
    const request = await transport.requestRoute(actorFor(student), {
      routeId: route._id.toString(), stopId: stop._id.toString(), direction: 'BOTH',
    });

    expect(request.status).toBe('PENDING');
    expect(request.routeName).toBe('Route 4 — Gandhi Nagar');
    expect(await BusEnrollment.countDocuments({})).toBe(0);
    expect(await Invoice.countDocuments({})).toBe(0);
  });

  it('creates the arrangement and bills the fare on approval', async () => {
    const request = await transport.requestRoute(actorFor(student), {
      routeId: route._id.toString(), stopId: stop._id.toString(),
    });
    const decided = await transport.decideTransportRequest(admin, request.id, { status: 'APPROVED' });

    expect(decided.status).toBe('APPROVED');
    expect(decided.busEnrollmentId).toBeTruthy();
    expect(decided.invoiceId).toBeTruthy();
    expect(decided.fareAmountPaise).toBe(1200000);

    const bus = await BusEnrollment.findOne({ studentId: student._id });
    expect(String(bus.routeId)).toBe(String(route._id));
    expect(String(bus.stopId)).toBe(String(stop._id));

    // Billed against the enrolment for the year, like every other invoice.
    const invoice = await Invoice.findById(decided.invoiceId);
    expect(String(invoice.enrollmentId)).toBe(String(enrollment._id));
    expect(invoice.totalPaise).toBe(1200000);
    const [line] = await InvoiceLine.find({ invoiceId: invoice._id });
    expect(line.description).toMatch(/transport/i);
    expect(line.amountPaise).toBe(1200000);
  });

  it('bills the fare as it stood when the place was granted', async () => {
    const request = await transport.requestRoute(actorFor(student), {
      routeId: route._id.toString(), stopId: stop._id.toString(),
    });
    // The school re-prices the route while the request is waiting.
    await TransportRoute.findByIdAndUpdate(route._id, { fareAmountPaise: 9900000 });

    const decided = await transport.decideTransportRequest(admin, request.id, { status: 'APPROVED' });
    // The student is billed what it costs now, at the moment the place is
    // granted — and that figure is snapshotted so a later change cannot move it.
    expect(decided.fareAmountPaise).toBe(9900000);
    expect((await Invoice.findById(decided.invoiceId)).totalPaise).toBe(9900000);

    await TransportRoute.findByIdAndUpdate(route._id, { fareAmountPaise: 100 });
    expect((await TransportRequest.findById(request.id)).fareAmountPaise).toBe(9900000);
  });

  it('bills the fare a route was re-priced to, for the next approval', async () => {
    // The gap this closes: a route's fare could be set at creation and never
    // afterwards, so routes predating the field billed nothing for ever.
    await transport.updateRoute(admin, route._id.toString(), { fareAmountPaise: 2500000 });
    expect((await TransportRoute.findById(route._id)).fareAmountPaise).toBe(2500000);

    const request = await transport.requestRoute(actorFor(student), {
      routeId: route._id.toString(), stopId: stop._id.toString(),
    });
    const decided = await transport.decideTransportRequest(admin, request.id, { status: 'APPROVED' });
    expect(decided.fareAmountPaise).toBe(2500000);
    expect((await Invoice.findById(decided.invoiceId)).totalPaise).toBe(2500000);
  });

  it('refuses a fare that is negative or fractional', async () => {
    for (const fareAmountPaise of [-1, 12.5]) {
      await expect(transport.updateRoute(admin, route._id.toString(), { fareAmountPaise }))
        .rejects.toMatchObject({ statusCode: 400 });
    }
    // Unchanged by the refusals.
    expect((await TransportRoute.findById(route._id)).fareAmountPaise).toBe(1200000);
  });

  it('accepts zero as "no charge", and then raises no invoice', async () => {
    await transport.updateRoute(admin, route._id.toString(), { fareAmountPaise: 0 });
    const request = await transport.requestRoute(actorFor(student), {
      routeId: route._id.toString(), stopId: stop._id.toString(),
    });
    const decided = await transport.decideTransportRequest(admin, request.id, { status: 'APPROVED' });
    expect(decided.invoiceId).toBeNull();
    expect(await Invoice.countDocuments({})).toBe(0);
  });

  it('reports the fare in the staff route listing, defaulting to nothing', async () => {
    const [listed] = await transport.listRoutes();
    expect(listed.fareAmountPaise).toBe(1200000);

    const bare = await TransportRoute.create({ name: 'Legacy route', status: 'ACTIVE' });
    const rows = await transport.listRoutes();
    expect(rows.find((r) => String(r.id) === String(bare._id)).fareAmountPaise).toBe(0);
  });

  it('raises no invoice for a route that carries no fare', async () => {
    await TransportRoute.findByIdAndUpdate(route._id, { fareAmountPaise: 0 });
    const request = await transport.requestRoute(actorFor(student), {
      routeId: route._id.toString(), stopId: stop._id.toString(),
    });
    const decided = await transport.decideTransportRequest(admin, request.id, { status: 'APPROVED' });

    expect(decided.status).toBe('APPROVED');
    expect(decided.busEnrollmentId).toBeTruthy();
    expect(decided.invoiceId).toBeNull();
    expect(await Invoice.countDocuments({})).toBe(0);
  });

  it('changes nothing when it is rejected', async () => {
    const request = await transport.requestRoute(actorFor(student), {
      routeId: route._id.toString(), stopId: stop._id.toString(),
    });
    const decided = await transport.decideTransportRequest(admin, request.id, {
      status: 'REJECTED', note: 'That stop is full this term',
    });

    expect(decided.status).toBe('REJECTED');
    expect(await BusEnrollment.countDocuments({})).toBe(0);
    expect(await Invoice.countDocuments({})).toBe(0);
  });

  it('tells the student what was decided', async () => {
    const request = await transport.requestRoute(actorFor(student), {
      routeId: route._id.toString(), stopId: stop._id.toString(),
    });
    await transport.decideTransportRequest(admin, request.id, { status: 'APPROVED' });

    const note = await Notification.findOne({ recipientProfileId: student.profileId }).lean();
    expect(note?.type).toBe('TRANSPORT');
    expect(note?.link).toBe('/student/transport');
    expect(note?.meta?.invoiceId).toBeTruthy();
  });

  it('refuses a stop that is not on the route asked for', async () => {
    const otherRoute = await TransportRoute.create({ name: 'Route 9', status: 'ACTIVE' });
    const otherStop = await TransportStop.create({ routeId: otherRoute._id, name: 'Far Gate', sequenceNo: 1 });

    await expect(transport.requestRoute(actorFor(student), {
      routeId: route._id.toString(), stopId: otherStop._id.toString(),
    })).rejects.toMatchObject({ statusCode: 400 });
    expect(await TransportRequest.countDocuments({})).toBe(0);
  });

  it('refuses a route that is not running', async () => {
    await TransportRoute.findByIdAndUpdate(route._id, { status: 'SUSPENDED' });
    await expect(transport.requestRoute(actorFor(student), {
      routeId: route._id.toString(), stopId: stop._id.toString(),
    })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuses a second open request for the year', async () => {
    await transport.requestRoute(actorFor(student), {
      routeId: route._id.toString(), stopId: stop._id.toString(),
    });
    // BusEnrollment is unique per student per year, so a second open request
    // could only ever die at its decision.
    await expect(transport.requestRoute(actorFor(student), {
      routeId: route._id.toString(), stopId: stop._id.toString(),
    })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('shows each student only their own requests', async () => {
    await transport.requestRoute(actorFor(student), {
      routeId: route._id.toString(), stopId: stop._id.toString(),
    });
    await transport.requestRoute(actorFor(otherStudent), {
      routeId: route._id.toString(), stopId: stop._id.toString(),
    });

    const mine = await transport.listMyTransportRequests(actorFor(student));
    expect(mine).toHaveLength(1);
    expect(mine[0].studentId).toBe(String(student._id));
  });

  it('will not let a student cancel someone else\'s request', async () => {
    const theirs = await transport.requestRoute(actorFor(otherStudent), {
      routeId: route._id.toString(), stopId: stop._id.toString(),
    });
    await expect(transport.cancelTransportRequest(actorFor(student), theirs.id))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('frees the year again once a request is cancelled', async () => {
    const request = await transport.requestRoute(actorFor(student), {
      routeId: route._id.toString(), stopId: stop._id.toString(),
    });
    const cancelled = await transport.cancelTransportRequest(actorFor(student), request.id);
    expect(cancelled.status).toBe('CANCELLED');

    const again = await transport.requestRoute(actorFor(student), {
      routeId: route._id.toString(), stopId: stop._id.toString(),
    });
    expect(again.status).toBe('PENDING');
  });

  it('refuses to decide the same request twice', async () => {
    const request = await transport.requestRoute(actorFor(student), {
      routeId: route._id.toString(), stopId: stop._id.toString(),
    });
    await transport.decideTransportRequest(admin, request.id, { status: 'APPROVED' });

    await expect(transport.decideTransportRequest(admin, request.id, { status: 'REJECTED' }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(await Invoice.countDocuments({})).toBe(1);
  });

  it('shows staff the queue of pending requests', async () => {
    await transport.requestRoute(actorFor(student), {
      routeId: route._id.toString(), stopId: stop._id.toString(),
    });
    const page = await transport.listTransportRequestsForReview(admin, 'ALL', { status: 'PENDING' });
    const rows = page.items ?? page;
    expect(rows).toHaveLength(1);
    expect(rows[0].admissionNo).toBe('REQ-1');
    expect(rows[0].routeName).toBe('Route 4 — Gandhi Nagar');
  });
});
