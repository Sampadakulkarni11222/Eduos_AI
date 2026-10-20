import { describe, it, expect, beforeEach } from 'vitest';
import { Subject, SubjectOffering, Term } from '../src/models/academics.model.js';
import { Assignment, Submission } from '../src/models/assignment.model.js';
import { HostelRoom, HostelAllocation } from '../src/models/hostel.model.js';
import { Book, BookIssue } from '../src/models/library.model.js';
import * as dashboard from '../src/modules/dashboard/dashboard.service.js';
import { seedSchool, inSchool, OAK } from './support/mcpSchool.js';

/**
 * Figures on the student, parent and warden dashboards.
 *
 *  - "Pending Assignments" used to count Submission rows with status PENDING,
 *    so homework the student had not opened (no Submission row at all) was
 *    never counted and the tile said "0 — all done".
 *  - The parent dashboard now tags each child's figures so the tiles can
 *    follow the selected child.
 *  - The warden's "Total Rooms" tile added vacant beds to occupied beds; the
 *    API now returns rooms counted as rooms.
 */

const DAY = 86_400_000;
const todayUtc = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
};

let s;
let offering;

beforeEach(async () => {
  s = await seedSchool();
  offering = await inSchool(OAK, async () => {
    const term = await Term.create({ academicYearId: s.year._id, name: 'Term 1', startsOn: new Date('2026-04-01'), endsOn: new Date('2027-03-31') });
    const subject = await Subject.create({ name: 'Mathematics' });
    return SubjectOffering.create({ sectionId: s.sectionA._id, subjectId: subject._id, termId: term._id });
  });
});

async function homework(title, dueInDays, extra = {}) {
  return inSchool(OAK, () => Assignment.create({
    subjectOfferingId: offering._id, title, dueAt: new Date(todayUtc().getTime() + dueInDays * DAY), ...extra,
  }));
}

describe('student dashboard: pending assignments', () => {
  it('counts unopened homework that is still due, and nothing that is handed in, exempt, past or deleted', async () => {
    await homework('Not opened yet', 3);
    await homework('Due today, not opened', 0);
    const submitted = await homework('Handed in', 4);
    const exempt = await homework('Exempted', 5);
    const opened = await homework('Opened, still pending', 6);
    await homework('Already past', -2);
    await homework('Withdrawn by teacher', 2, { deletedAt: new Date() });

    await inSchool(OAK, async () => {
      await Submission.create({ assignmentId: submitted._id, enrollmentId: s.priya.enrollment._id, status: 'SUBMITTED' });
      await Submission.create({ assignmentId: exempt._id, enrollmentId: s.priya.enrollment._id, status: 'EXEMPT' });
      await Submission.create({ assignmentId: opened._id, enrollmentId: s.priya.enrollment._id, status: 'PENDING' });
    });

    const data = await inSchool(OAK, () => dashboard.getStudentDashboard(s.people.STUDENT.profile._id));
    // "Not opened yet", "Due today" and "Opened, still pending".
    expect(data.pendingAssignments).toBe(3);
  });

  it('is zero when nothing is due', async () => {
    await homework('Already past', -1);
    const data = await inSchool(OAK, () => dashboard.getStudentDashboard(s.people.STUDENT.profile._id));
    expect(data.pendingAssignments).toBe(0);
  });

  it('lists books lent against the Student id, which is how the lending screen records them', async () => {
    await inSchool(OAK, async () => {
      const book = await Book.create({ title: 'Wings of Fire', author: 'Kalam' });
      await BookIssue.create({ bookId: book._id, borrowerProfileId: s.priya.student._id, borrowerName: 'Priya', dueDate: new Date(Date.now() + 5 * DAY) });
    });
    const data = await inSchool(OAK, () => dashboard.getStudentDashboard(s.people.STUDENT.profile._id));
    expect(data.borrowedBooks.map((b) => b.title)).toEqual(['Wings of Fire']);
  });
});

describe('parent dashboard: figures per child', () => {
  it('tags each child with their own pending homework and fees', async () => {
    await homework('Not opened yet', 3);
    const data = await inSchool(OAK, () => dashboard.getParentDashboard(s.people.PARENT.profile._id));
    expect(data.linkedChildren).toHaveLength(1);
    const rahul = data.linkedChildren[0];
    expect(String(rahul.studentId)).toBe(String(s.rahul.student._id));
    expect(rahul.pendingAssignments).toBe(1);
    expect(rahul.pendingFeesPaise).toBe(800000);
    expect(rahul.sectionId).toBe(String(s.sectionA._id));
    expect(data.feeInvoices.every((i) => i.studentId === String(s.rahul.student._id))).toBe(true);
    // Another family's invoice (Aman's INV-1002) never appears.
    expect(data.feeInvoices.map((i) => i.invoiceNo)).toEqual(['INV-1001']);
  });
});

describe('warden dashboard: rooms are counted as rooms', () => {
  it('returns totalRooms and occupiedRooms as room counts, not beds', async () => {
    await inSchool(OAK, async () => {
      const rooms = await HostelRoom.insertMany([
        { roomNo: 'A01', capacity: 4 }, { roomNo: 'A02', capacity: 4 }, { roomNo: 'A03', capacity: 4, status: 'MAINTENANCE' },
        { roomNo: 'A04', capacity: 4, status: 'CLOSED' },
      ]);
      await HostelAllocation.create({ roomId: rooms[0]._id, studentId: s.rahul.student._id, status: 'ACTIVE' });
      await HostelAllocation.create({ roomId: rooms[0]._id, studentId: s.aman.student._id, status: 'ACTIVE' });
    });
    const data = await inSchool(OAK, () => dashboard.getWardenDashboard());
    expect(data.totalRooms).toBe(3); // closed room excluded
    expect(data.occupiedRooms).toBe(1); // two students, one room
    expect(data.occupiedBeds).toBe(2);
    expect(data.totalCapacity).toBe(8); // ACTIVE rooms only, as before
  });
});
