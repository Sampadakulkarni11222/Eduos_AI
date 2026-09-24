import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { parseIntent } from '../src/modules/ai/agent/intent.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { Book, BookIssue } from '../src/models/library.model.js';
import { BookRequest } from '../src/models/bookRequest.model.js';
import { HostelRoom, HostelAllocation } from '../src/models/hostel.model.js';
import { seedSchool, mcp, inSchool, OAK, RIVER } from './support/mcpSchool.js';

/**
 * The reported failures, executed rather than merely routed.
 *
 * `mcp.manualScenarios.test.js` asserts that each sentence REACHES the right
 * capability with the right arguments. That is necessary and not sufficient:
 * the report's own standard was that a capability existing in the registry
 * does not mean the operation works. So each case here takes the sentence, runs
 * what it resolved to through the real MCP server, and then looks at the
 * DATABASE.
 *
 * For a write, the whole chain is asserted, in the order it has to happen:
 *
 *   sentence -> capability -> authorization -> proposal + summary
 *            -> confirmation -> re-authorization -> service -> row changed
 *            -> audit entry
 *
 * The summary is checked too, because a confirmation that cannot name what it
 * is about is not a confirmation -- and these are exactly the tools whose
 * subject is now resolved from a name rather than supplied as an id.
 */

let school;
beforeEach(async () => {
  school = await seedSchool();
});
afterAll(async () => {
  await resetMcpClient();
});

const actorOf = (role) => school.people[role].actor;

/** Routes a sentence and runs whatever it resolved to, through the MCP server. */
const say = async (role, message, opts = {}) => {
  const step = parseIntent(message, actorOf(role));
  expect(step, `"${message}" reached no capability`).toBeTruthy();
  const result = await mcp(OAK, actorOf(role), step.tool, step.args, opts);
  return { step, result };
};

/** Routes a sentence, then confirms the proposal it produced. */
const sayAndConfirm = async (role, message) => {
  const { step, result } = await say(role, message);
  expect(result.success, JSON.stringify(result.error ?? {})).toBe(true);
  expect(result.action?.status, `${step.tool} did not ask for confirmation`).toBe('confirmation_required');

  const done = await mcp(OAK, actorOf(role), step.tool, {}, {
    confirmationToken: result.action.confirmationToken,
  });
  return { step, proposal: result, done };
};

const auditFor = async (tool) =>
  inSchool(OAK, () => AuditLog.find({ action: new RegExp(tool, 'i') }).lean());

/* ── Library ──────────────────────────────────────────────── */

describe('LIBRARIAN — the library writes the report found unreachable', () => {
  const shelve = (over = {}) => inSchool(OAK, () => Book.create({
    title: 'Harry Potter', author: 'J K Rowling', totalCopies: 1, availableCopies: 0, ...over,
  }));

  it('5.11 — "Return the overdue Harry Potter book" returns it', async () => {
    const book = await shelve();
    const issue = await inSchool(OAK, () => BookIssue.create({
      bookId: book._id,
      borrowerProfileId: school.people.STUDENT.profile._id,
      borrowerName: 'Priya Verma',
      dueDate: new Date(Date.now() - 7 * 86_400_000),
      status: 'OVERDUE',
    }));

    const { step, proposal, done } = await sayAndConfirm('LIBRARIAN', 'Return the overdue Harry Potter book.');
    expect(step.tool).toBe('return_book');
    // The confirmation names the book, not an id the person never typed.
    expect(proposal.action.summary).toMatch(/Harry Potter/);

    expect(done.success, JSON.stringify(done.error ?? {})).toBe(true);
    const after = await inSchool(OAK, () => BookIssue.findById(issue._id).lean());
    expect(after.status, 'the lending record was not returned').toBe('RETURNED');
    expect(after.returnedAt).toBeTruthy();
    expect(await auditFor('return_book')).not.toHaveLength(0);
  }, 60000);

  it('5.13 — "Issue Clean Code to Rahul" issues that book to that student', async () => {
    await shelve({ title: 'Clean Code', author: 'Robert Martin', totalCopies: 3, availableCopies: 3 });

    // The lending period is the one thing the sentence does not carry, so the
    // tool asks for it rather than inventing one -- and then does the work.
    const asked = await say('LIBRARIAN', 'Issue Clean Code to Rahul.');
    expect(asked.step.tool).toBe('issue_book');
    expect(asked.result.success).toBe(false);
    expect(asked.result.error.message).toMatch(/due/i);

    const due = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    const proposal = await mcp(OAK, actorOf('LIBRARIAN'), 'issue_book', { ...asked.step.args, dueAt: due });
    expect(proposal.action?.status).toBe('confirmation_required');
    expect(proposal.action.summary).toMatch(/Clean Code/);

    const done = await mcp(OAK, actorOf('LIBRARIAN'), 'issue_book', {}, {
      confirmationToken: proposal.action.confirmationToken,
    });
    expect(done.success, JSON.stringify(done.error ?? {})).toBe(true);

    const issues = await inSchool(OAK, () => BookIssue.find({ status: 'ACTIVE' }).lean());
    expect(issues, 'no lending record was written').toHaveLength(1);
    const book = await inSchool(OAK, () => Book.findOne({ title: 'Clean Code' }).lean());
    expect(book.availableCopies, 'a copy was not taken off the shelf').toBe(2);
  }, 60000);

  it('5.6 — "Update Clean Code to 5 copies" changes that catalog row', async () => {
    await shelve({ title: 'Clean Code', author: 'Robert Martin', totalCopies: 3, availableCopies: 3 });

    const { step, proposal, done } = await sayAndConfirm('LIBRARIAN', 'Update Clean Code to 5 copies.');
    expect(step.tool).toBe('update_book');
    expect(proposal.action.summary).toMatch(/Clean Code/);
    expect(done.success, JSON.stringify(done.error ?? {})).toBe(true);

    const book = await inSchool(OAK, () => Book.findOne({ title: 'Clean Code' }).lean());
    expect(book.totalCopies).toBe(5);
  }, 60000);

  it('an ambiguous title is refused, never guessed at', async () => {
    await shelve({ title: 'Clean Code', author: 'Robert Martin', totalCopies: 1, availableCopies: 1 });
    await shelve({ title: 'Clean Code in Practice', author: 'Someone Else', totalCopies: 1, availableCopies: 1 });

    const { result } = await say('LIBRARIAN', 'Update Clean Code to 5 copies.');
    // Two titles match by substring and neither is an exact match for the
    // whole phrase... the exact one wins outright, so this asserts the case
    // that has no exact match.
    const vague = await mcp(OAK, actorOf('LIBRARIAN'), 'update_book', { title: 'Clean', totalCopies: 5 });
    expect(vague.success).toBe(false);
    expect(vague.error.message).toMatch(/which one/i);
    expect(result).toBeTruthy();

    const untouched = await inSchool(OAK, () => Book.find({ totalCopies: 5 }).lean());
    expect(untouched, 'a guess was acted on').toHaveLength(0);
  }, 60000);
});

describe('LIBRARIAN — approving a request runs the approval workflow', () => {
  it("5.9, 5.10 — \"Approve Rahul's book request\" approves it AND issues the book", async () => {
    // The request is made the way a student makes one, through the same
    // capability their own screen calls, so what is approved here is a real
    // row in the real queue rather than a fixture shaped like one.
    const book = await inSchool(OAK, () => Book.create({
      title: 'Panchatantra', author: 'Vishnu Sharma', totalCopies: 2, availableCopies: 2,
    }));
    const asked = await mcp(OAK, actorOf('STUDENT'), 'request_book', { bookId: String(book._id) });
    expect(asked.success, JSON.stringify(asked.error ?? {})).toBe(true);

    // The student profile in the fixture is Priya's, so that is whose request
    // the librarian approves by name.
    const { step, proposal, done } = await sayAndConfirm('LIBRARIAN', "Approve Priya's book request.");
    expect(step.tool).toBe('decide_book_request');
    expect(step.args.status).toBe('APPROVED');
    expect(step.args.requestId, 'an id was invented from the sentence').toBeUndefined();
    // The confirmation names whose request and which book, both resolved from
    // the queue rather than supplied.
    expect(proposal.action.summary).toMatch(/Panchatantra/);
    expect(done.success, JSON.stringify(done.error ?? {})).toBe(true);

    const request = await inSchool(OAK, () => BookRequest.findById(asked.data.id).lean());
    expect(request.status).toBe('APPROVED');

    // Approving issues the book: that is the workflow, and the whole point of
    // reusing it rather than writing a status change.
    const issues = await inSchool(OAK, () => BookIssue.find({ bookId: book._id }).lean());
    expect(issues, 'approval did not issue the book').toHaveLength(1);
    const after = await inSchool(OAK, () => Book.findById(book._id).lean());
    expect(after.availableCopies, 'a copy was not taken off the shelf').toBe(1);
    expect(await auditFor('decide_book_request')).not.toHaveLength(0);
  }, 60000);

  it('a request that does not exist is refused, and nothing is decided', async () => {
    const result = await mcp(OAK, actorOf('LIBRARIAN'), 'decide_book_request', {
      studentName: 'Aman Gupta', status: 'APPROVED',
    });
    expect(result.success).toBe(false);
    expect(result.error.message).toMatch(/could not find/i);
  }, 60000);
});

/* ── Hostel ───────────────────────────────────────────────── */

describe('WARDEN — the hostel writes the report found unreachable', () => {
  const buildRoom = (over = {}) => inSchool(OAK, () => HostelRoom.create({
    roomNo: '101', block: 'Main', capacity: 2, type: 'GENERAL', status: 'ACTIVE', ...over,
  }));

  it('6.3 — "How many beds are available in Room 101?" answers about Room 101', async () => {
    await buildRoom();
    await buildRoom({ roomNo: '202', capacity: 9 });

    const { step, result } = await say('WARDEN', 'How many beds are available in Room 101?');
    expect(step.args.roomNo).toBe('101');
    expect(result.success, JSON.stringify(result.error ?? {})).toBe(true);
    expect(result.data.rooms, 'the whole hostel was returned').toHaveLength(1);
    expect(result.data.rooms[0].roomNo).toBe('101');
    // The reported failure was the hostel's overall occupancy answering this.
    expect(result.speak).toMatch(/Room 101/);
    expect(result.speak).not.toMatch(/\b9\b/);
  }, 60000);

  it('6.9 — a bed is allocated to the named student, in the named room', async () => {
    const room = await buildRoom();

    const proposal = await mcp(OAK, actorOf('WARDEN'), 'allocate_hostel_bed', {
      roomNo: '101', studentName: 'Rahul Sharma',
    });
    expect(proposal.action?.status).toBe('confirmation_required');
    expect(proposal.action.summary).toMatch(/101/);
    expect(proposal.action.summary).toMatch(/Rahul/);

    const done = await mcp(OAK, actorOf('WARDEN'), 'allocate_hostel_bed', {}, {
      confirmationToken: proposal.action.confirmationToken,
    });
    expect(done.success, JSON.stringify(done.error ?? {})).toBe(true);

    const rows = await inSchool(OAK, () => HostelAllocation.find({ status: 'ACTIVE' }).lean());
    expect(rows, 'no allocation was written').toHaveLength(1);
    expect(String(rows[0].roomId)).toBe(String(room._id));
    expect(String(rows[0].studentId)).toBe(String(school.rahul.student._id));
    expect(await auditFor('allocate_hostel_bed')).not.toHaveLength(0);
  }, 60000);

  it('6.8 — an allocation with no room named asks which room, rather than answering with statistics', async () => {
    await buildRoom();
    const { step, result } = await say('WARDEN', 'Allocate a bed to Diya Sharma.');
    expect(step.tool).toBe('allocate_hostel_bed');
    expect(result.success).toBe(false);
    // Either "which room?" or "no student called Diya Sharma" is a correct
    // answer here; occupancy statistics are not, and that is what it used to
    // give.
    expect(result.error.message).toMatch(/which room|no student named/i);
  }, 60000);

  it('6.10 — "Vacate Rahul Sharma\'s bed" vacates that student\'s bed', async () => {
    const room = await buildRoom();
    const allocation = await inSchool(OAK, () => HostelAllocation.create({
      roomId: room._id, studentId: school.rahul.student._id, status: 'ACTIVE', allottedAt: new Date(),
    }));

    const { step, proposal, done } = await sayAndConfirm('WARDEN', "Vacate Rahul Sharma's bed.");
    expect(step.tool).toBe('vacate_hostel_bed');
    expect(proposal.action.summary).toMatch(/Rahul/);
    expect(done.success, JSON.stringify(done.error ?? {})).toBe(true);

    const after = await inSchool(OAK, () => HostelAllocation.findById(allocation._id).lean());
    expect(after.status).toBe('VACATED');
    expect(after.vacatedAt).toBeTruthy();
  }, 60000);

  it('a student with no allocation is answered, not guessed at', async () => {
    await buildRoom();
    const result = await mcp(OAK, actorOf('WARDEN'), 'vacate_hostel_bed', { studentName: 'Aman Gupta' });
    expect(result.success).toBe(false);
    expect(result.error.message).toMatch(/no active hostel allocation/i);
  }, 60000);
});

/* ── The student's own requests ───────────────────────────── */

describe('STUDENT — "cancel my request" cancels the right one', () => {
  it('2.5 — with one pending request, no id is needed and that request is withdrawn', async () => {
    const book = await inSchool(OAK, () => Book.create({
      title: 'Panchatantra', author: 'Vishnu Sharma', totalCopies: 2, availableCopies: 2,
    }));
    const made = await mcp(OAK, actorOf('STUDENT'), 'request_book', { bookId: String(book._id) });
    expect(made.success, JSON.stringify(made.error ?? {})).toBe(true);

    const { step, proposal, done } = await sayAndConfirm('STUDENT', 'Cancel my pending book request.');
    expect(step.tool).toBe('cancel_book_request');
    expect(step.args.requestId, 'an id was invented from the sentence').toBeUndefined();
    // The confirmation names the book, resolved from the caller's own single
    // pending request.
    expect(proposal.action.summary).toMatch(/Panchatantra/);
    expect(done.success, JSON.stringify(done.error ?? {})).toBe(true);
  }, 60000);

  it('with nothing pending, it says so rather than failing obscurely', async () => {
    const result = await mcp(OAK, actorOf('STUDENT'), 'cancel_book_request', {});
    expect(result.success).toBe(false);
    expect(result.error.message).toMatch(/no pending book request/i);
  }, 60000);

  it('with two pending, it asks which rather than withdrawing one', async () => {
    const books = await inSchool(OAK, () => Book.insertMany([
      { title: 'Panchatantra', author: 'Vishnu Sharma', totalCopies: 2, availableCopies: 2 },
      { title: 'Malgudi Days', author: 'R K Narayan', totalCopies: 2, availableCopies: 2 },
    ]));
    for (const book of books) {
      // eslint-disable-next-line no-await-in-loop -- two, in order
      await mcp(OAK, actorOf('STUDENT'), 'request_book', { bookId: String(book._id) });
    }

    const result = await mcp(OAK, actorOf('STUDENT'), 'cancel_book_request', {});
    expect(result.success).toBe(false);
    expect(result.error.message).toMatch(/which one/i);
    expect(result.error.message).toMatch(/Panchatantra/);
  }, 60000);
});

/* ── Isolation, on the paths that now resolve by name ─────── */

describe('resolving by name cannot cross a school', () => {
  it("a warden cannot vacate another school's student by naming them", async () => {
    const room = await inSchool(OAK, () => HostelRoom.create({
      roomNo: '101', block: 'Main', capacity: 2, type: 'GENERAL', status: 'ACTIVE',
    }));
    // Riverside has its own Rahul, and its own allocation.
    const foreign = await inSchool(RIVER, () => HostelAllocation.create({
      roomId: room._id, studentId: school.river.student._id, status: 'ACTIVE', allottedAt: new Date(),
    }));

    const result = await mcp(OAK, actorOf('WARDEN'), 'vacate_hostel_bed', { studentName: 'Rahul Riverside' });
    expect(result.success).toBe(false);

    const after = await inSchool(RIVER, () => HostelAllocation.findById(foreign._id).lean());
    expect(after.status, "another school's allocation was changed").toBe('ACTIVE');
  }, 60000);

  it("a librarian cannot return another school's loan by naming the title", async () => {
    const foreignBook = await inSchool(RIVER, () => Book.create({
      title: 'Harry Potter', author: 'J K Rowling', totalCopies: 1, availableCopies: 0,
    }));
    const foreignIssue = await inSchool(RIVER, () => BookIssue.create({
      bookId: foreignBook._id, borrowerName: 'Riverside pupil',
      dueDate: new Date(Date.now() - 86_400_000), status: 'OVERDUE',
    }));

    const result = await mcp(OAK, actorOf('LIBRARIAN'), 'return_book', { title: 'Harry Potter' });
    expect(result.success).toBe(false);

    const after = await inSchool(RIVER, () => BookIssue.findById(foreignIssue._id).lean());
    expect(after.status, "another school's loan was returned").toBe('OVERDUE');
  }, 60000);
});
