import * as library from '../../../library/library.service.js';
import * as hostel from '../../../hostel/hostel.service.js';
import * as transport from '../../../transport/transport.service.js';
import { AppError } from '../../../../utils/AppError.js';
import { ok, action } from '../protocol.js';
import { applyFieldAllowList } from '../validate.js';
import {
  RISK, objectId, dateStr, summarise, shortDate, wrapAgentTool, resolveStudentId, studentIdentitySchema,
} from './_shared.js';

/**
 * Library, hostel and transport.
 *
 * Every schema mirrors its model and service: the library resource kinds and
 * lending statuses, the hostel room types, room statuses and enquiry fields,
 * and the bus-enrolment directions are the enums those models declare. An
 * earlier version of this file offered statuses that do not exist and enquiry
 * fields the model does not have, so several of these tools failed on every
 * call or silently dropped what they were given.
 *
 * Transport route, stop and enrolment writes used to live in
 * transport.controller.js with no service behind them; they were moved into
 * transport.service.js so the REST routes and these tools share one
 * implementation.
 */

const asList = (rows) => (Array.isArray(rows) ? rows : (rows?.items ?? []));

const RESOURCE_KINDS = ['BOOK', 'NOTE', 'QUESTION_PAPER'];
const ISSUE_STATUSES = ['ACTIVE', 'RETURNED', 'OVERDUE'];
const ROOM_TYPES = ['BOYS', 'GIRLS', 'STAFF', 'GENERAL'];
const ROOM_STATUSES = ['ACTIVE', 'MAINTENANCE', 'CLOSED'];
const INQUIRY_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED'];
const BUS_DIRECTIONS = ['BOTH', 'PICKUP', 'DROP'];

/**
 * Catalog fields the assistant may change. library.service.updateBook() is an
 * Object.assign over the book, so this is enforced in the tool as well as by
 * the schema: copy counts on loan, deletion state and ownership stay out of reach.
 */
export const BOOK_UPDATE_ALLOW_LIST = ['title', 'author', 'isbn', 'category', 'publisher', 'publishedYear', 'totalCopies'];

/** Hostel room fields the assistant may change. updateRoom() applies what it is given. */
export const ROOM_UPDATE_ALLOW_LIST = ['roomNo', 'block', 'floor', 'capacity', 'type', 'status', 'amenities'];

async function studentFor(ctx, args) {
  const studentId = await resolveStudentId(ctx, args);
  if (!studentId) throw new AppError('Which student? Give a name, admission number or id.', 400, [], 'AGENT_NEEDS_INPUT');
  return studentId;
}

export const facilityTools = {
  /* ── Library ─────────────────────────────────────────── */
  get_library_summary: wrapAgentTool('get_library_summary', {
    module: 'Library',
    description: 'Library totals: catalog size, unique titles, books currently on loan and how many are overdue. Read-only.',
    service: 'library.service.getSummary()',
  }),

  get_overdue_books: wrapAgentTool('get_overdue_books', {
    module: 'Library',
    description: 'Books past their return date, with who is holding each and when it was due. Read-only.',
    service: 'library.service.listIssues({ status: OVERDUE })',
  }),

  list_books: {
    module: 'Library',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'Search the library catalog by title, author, ISBN, category or publisher, with how many copies are available. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', maxLength: 120 },
        category: { type: 'string', maxLength: 80 },
        author: { type: 'string', maxLength: 120 },
        resourceKind: { type: 'string', enum: RESOURCE_KINDS },
        availableOnly: { type: 'boolean', description: 'Only items with a copy on the shelf' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    permission: 'library.read',
    service: 'library.service.listBooks()',
    async run(_ctx, args) {
      const items = asList(await library.listBooks({
        search: args.search, category: args.category, author: args.author, resourceKind: args.resourceKind,
      }));
      const filtered = args.availableOnly ? items.filter((b) => (b.availableCopies ?? 0) > 0) : items;
      const limited = filtered.slice(0, Math.min(Number(args.limit) || 20, 100));
      const view = summarise(limited, (b) => `${b.title}${b.author ? ` — ${b.author}` : ''} (${b.availableCopies ?? 0} available)`);
      return ok(
        { books: limited, total: filtered.length, returned: limited.length },
        { speak: filtered.length ? `${filtered.length} matching item(s): ${view.list}.` : 'Nothing in the catalog matches that.' },
      );
    },
  },

  get_book: {
    module: 'Library',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'One catalog item in full, with total and available copies. Read-only.',
    inputSchema: { type: 'object', properties: { bookId: objectId() }, required: ['bookId'], additionalProperties: false },
    permission: 'library.read',
    service: 'library.service.getBookById()',
    async run(_ctx, args) {
      const book = await library.getBookById(args.bookId);
      return ok(book, {
        speak: `${book.title}${book.author ? ` by ${book.author}` : ''} — ${book.availableCopies ?? 0} of ${book.totalCopies ?? 0} copies available.`,
      });
    },
  },

  list_book_issues: {
    module: 'Library',
    operation: 'GET',
    risk: RISK.LOW,
    description: "Lending records — what is on loan, to whom, when it is due, and what has been returned. A student or parent sees only their own. Read-only.",
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ISSUE_STATUSES, description: 'ACTIVE means currently on loan' },
        bookId: objectId(),
        studentId: objectId(),
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    permission: 'library.read',
    service: 'library.service.listIssues()',
    async run(ctx, args) {
      const rows = asList(await library.listIssues(ctx.actor, ctx.scope, {
        status: args.status, bookId: args.bookId, studentId: args.studentId,
      }));
      const limited = rows.slice(0, Math.min(Number(args.limit) || 20, 100));
      const view = summarise(limited, (i) => `${i.bookTitle} → ${i.studentName ?? i.borrowerName ?? '—'} (due ${shortDate(i.dueAt ?? i.dueDate)})`);
      return ok(
        { issues: limited, total: rows.length, returned: limited.length },
        { speak: rows.length ? `${rows.length} lending record(s): ${view.list}.` : 'No lending records match that.' },
      );
    },
  },

  create_book: {
    module: 'Library',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description:
      'Add an item to the library catalog. A BOOK is a physical title with shelf copies; a NOTE or QUESTION_PAPER is digital and needs a resourceUrl. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 300 },
        author: { type: 'string', maxLength: 200 },
        isbn: { type: 'string', maxLength: 40 },
        category: { type: 'string', maxLength: 80, description: 'Defaults to General' },
        totalCopies: { type: 'integer', minimum: 1, maximum: 1000, description: 'Physical copies; default 1' },
        resourceKind: { type: 'string', enum: RESOURCE_KINDS, description: 'Default BOOK' },
        resourceUrl: { type: 'string', maxLength: 500, description: 'Required for NOTE and QUESTION_PAPER' },
        publisher: { type: 'string', maxLength: 200 },
        publishedYear: { type: 'integer', minimum: 1500, maximum: 2100 },
      },
      // Book.title and Book.author are both required by the model.
      required: ['title', 'author'],
      additionalProperties: false,
    },
    permission: 'library.manage',
    minScope: 'ALL',
    service: 'library.service.createBook()',
    summarise: (args) =>
      `Add "${args.title}" by ${args.author} to the catalog` +
      `${args.totalCopies ? ` (${args.totalCopies} copies)` : ''}`,
    async run(ctx, args) {
      const book = await library.createBook(args, ctx.actor);
      return action({
        type: 'book_created',
        id: book._id ?? book.id,
        data: { bookId: String(book._id ?? book.id), title: book.title },
        speak: `"${book.title}" has been added to the catalog.`,
      });
    },
  },

  update_book: {
    module: 'Library',
    operation: 'UPDATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description:
      'Correct a catalog entry — title, author, ISBN, category, publisher, year or total copies. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        bookId: objectId(),
        title: { type: 'string', maxLength: 300 },
        author: { type: 'string', maxLength: 200 },
        isbn: { type: 'string', maxLength: 40 },
        category: { type: 'string', maxLength: 80 },
        publisher: { type: 'string', maxLength: 200 },
        publishedYear: { type: 'integer', minimum: 1500, maximum: 2100 },
        totalCopies: { type: 'integer', minimum: 0, maximum: 1000 },
      },
      required: ['bookId'],
      additionalProperties: false,
    },
    permission: 'library.manage',
    minScope: 'ALL',
    service: 'library.service.updateBook() — behind an MCP field allow-list',
    summarise: (args) => `Update ${Object.keys(args).filter((k) => k !== 'bookId').join(', ')} on catalog item ${args.bookId}`,
    async run(_ctx, args) {
      const { bookId, ...patch } = args;
      const { ok: allowed, fields, rejected } = applyFieldAllowList(patch, BOOK_UPDATE_ALLOW_LIST);
      if (rejected.length) throw new AppError(`I cannot change ${rejected.join(', ')} on a catalog item.`, 400, [], 'FIELD_NOT_ALLOWED');
      if (!allowed) throw new AppError('Which details should I change?', 400, [], 'AGENT_NEEDS_INPUT');
      const book = await library.updateBook(bookId, fields);
      return action({ type: 'book_updated', id: bookId, data: { bookId, changed: Object.keys(fields) }, speak: `"${book.title}" has been updated.` });
    },
  },

  delete_book: {
    module: 'Library',
    operation: 'DELETE',
    risk: RISK.HIGH,
    confirm: true,
    description:
      'Remove an item from the library catalog. It is hidden from the catalog, not erased, and its lending history is kept. It does not check for copies currently on loan, so make sure they are returned first. Always needs confirmation.',
    inputSchema: { type: 'object', properties: { bookId: objectId() }, required: ['bookId'], additionalProperties: false },
    permission: 'library.manage',
    minScope: 'ALL',
    service: 'library.service.deleteBook()',
    summarise: (args, _actor, prepared) => `Remove "${prepared?.title ?? args.bookId}" from the library catalog`,
    async prepare(_ctx, args) {
      const book = await library.getBookById(args.bookId);
      return { title: book.title, totalCopies: book.totalCopies, availableCopies: book.availableCopies };
    },
    async snapshot(_ctx, args, prepared) {
      return prepared ? { bookId: String(args.bookId), ...prepared } : null;
    },
    async run(_ctx, args, prepared) {
      await library.deleteBook(args.bookId);
      return action({
        type: 'book_deleted',
        id: args.bookId,
        data: { bookId: args.bookId, title: prepared?.title ?? null },
        speak: `"${prepared?.title ?? 'The item'}" has been removed from the catalog.`,
      });
    },
  },

  issue_book: {
    module: 'Library',
    operation: 'ACTION',
    risk: RISK.MEDIUM,
    confirm: true,
    description:
      'Lend a library item to a student until a due date. Name the student by name, admission number or id. A copy is claimed atomically, so two simultaneous requests cannot both take the last one. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        bookId: objectId(),
        ...studentIdentitySchema,
        dueAt: dateStr('When it must be returned'),
      },
      required: ['bookId', 'dueAt'],
      additionalProperties: false,
    },
    permission: 'library.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'library.service.issueBook()',
    summarise: (args, _actor, prepared) =>
      `Lend "${prepared?.title ?? args.bookId}" to ${args.studentName ?? args.admissionNo ?? args.studentId}, due ${args.dueAt}`,
    async prepare(ctx, args) {
      const [studentId, book] = await Promise.all([studentFor(ctx, args), library.getBookById(args.bookId)]);
      return { studentId, title: book.title };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const issue = await library.issueBook({ bookId: args.bookId, studentId: plan.studentId, dueAt: args.dueAt });
      return action({
        type: 'book_issued',
        id: issue?.id ?? issue?._id,
        data: { issueId: String(issue?.id ?? issue?._id), bookId: args.bookId, dueAt: args.dueAt },
        speak: `"${plan.title}" issued, due ${shortDate(args.dueAt)}.`,
      });
    },
  },

  return_book: {
    module: 'Library',
    operation: 'ACTION',
    risk: RISK.MEDIUM,
    confirm: true,
    description: 'Record the return of a lent item. Returning an item already returned is refused rather than counted twice. Needs confirmation.',
    inputSchema: { type: 'object', properties: { issueId: objectId('From list_book_issues') }, required: ['issueId'], additionalProperties: false },
    permission: 'library.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'library.service.returnBook()',
    summarise: (args) => `Record the return of lending record ${args.issueId}`,
    async run(_ctx, args) {
      const issue = await library.returnBook(args.issueId);
      return action({ type: 'book_returned', id: args.issueId, data: { issueId: args.issueId, status: issue?.status ?? 'RETURNED' }, speak: 'The item has been returned.' });
    },
  },

  /* ── Hostel ──────────────────────────────────────────── */
  get_hostel_summary: wrapAgentTool('get_hostel_summary', {
    module: 'Hostel',
    description: 'Hostel occupancy: beds occupied and free, occupancy rate, room count and open enquiries. Read-only.',
    service: 'hostel.service.getSummary()',
  }),

  get_hostel_residents: wrapAgentTool('get_hostel_residents', {
    module: 'Hostel',
    description: 'The students currently allocated a hostel bed, with room and block. Read-only.',
    service: 'hostel.service.listHostelStudents()',
  }),

  list_hostel_rooms: {
    module: 'Hostel',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'Hostel rooms with capacity, beds occupied and beds free — use it to find a room with space. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ROOM_TYPES },
        status: { type: 'string', enum: ROOM_STATUSES },
      },
      additionalProperties: false,
    },
    permission: 'hostel.read',
    minScope: 'ALL',
    service: 'hostel.service.listRooms()',
    async run(_ctx, args) {
      const rooms = await hostel.listRooms({ type: args.type, status: args.status });
      // listRooms() attaches `occupied` and `available` to every room.
      const withSpace = rooms.filter((r) => (r.available ?? 0) > 0);
      const view = summarise(withSpace, (r) => `${r.roomNo}${r.block ? ` (block ${r.block})` : ''}: ${r.available} free`, { limit: 10 });
      return ok(
        {
          rooms: rooms.map((r) => ({
            roomId: String(r._id), roomNo: r.roomNo, block: r.block, floor: r.floor ?? null,
            type: r.type, status: r.status, capacity: r.capacity, occupied: r.occupied, available: r.available,
          })),
          count: rooms.length,
          withFreeBeds: withSpace.length,
        },
        { speak: `${rooms.length} room(s), ${withSpace.length} with a free bed${withSpace.length ? `: ${view.list}` : ''}.` },
      );
    },
  },

  list_hostel_allocations: {
    module: 'Hostel',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'Bed allocations — which student is in which room, active or vacated. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        roomId: objectId(),
        status: { type: 'string', enum: ['ACTIVE', 'VACATED'], description: 'Default ACTIVE' },
      },
      additionalProperties: false,
    },
    permission: 'hostel.read',
    minScope: 'ALL',
    service: 'hostel.service.listAllocations()',
    async run(_ctx, args) {
      const rows = asList(await hostel.listAllocations({ roomId: args.roomId, status: args.status ?? 'ACTIVE' }));
      return ok({ allocations: rows, count: rows.length }, { speak: `${rows.length} ${(args.status ?? 'active').toLowerCase()} allocation(s).` });
    },
  },

  list_hostel_inquiries: {
    module: 'Hostel',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'Hostel enquiries raised by students, parents or staff, and their status. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { status: { type: 'string', enum: INQUIRY_STATUSES } },
      additionalProperties: false,
    },
    permission: 'hostel.read',
    service: 'hostel.service.listInquiries()',
    async run(_ctx, args) {
      const rows = asList(await hostel.listInquiries({ status: args.status }));
      const view = summarise(rows, (q) => `${q.subject} (${q.status})`);
      return ok(
        { inquiries: rows, count: rows.length },
        { speak: rows.length ? `${rows.length} hostel enquiry/enquiries: ${view.list}.` : 'There are no hostel enquiries.' },
      );
    },
  },

  create_hostel_room: {
    module: 'Hostel',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description: 'Add a hostel room with its bed capacity. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        roomNo: { type: 'string', maxLength: 40 },
        block: { type: 'string', maxLength: 40, description: 'Default Main' },
        floor: { type: 'string', maxLength: 20 },
        capacity: { type: 'integer', minimum: 1, maximum: 50 },
        type: { type: 'string', enum: ROOM_TYPES, description: 'Default GENERAL' },
        amenities: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 60 } },
      },
      required: ['roomNo', 'capacity'],
      additionalProperties: false,
    },
    permission: 'hostel.manage',
    minScope: 'ALL',
    service: 'hostel.service.createRoom()',
    summarise: (args) => `Add hostel room ${args.roomNo}${args.block ? ` in block ${args.block}` : ''} with ${args.capacity} bed(s)`,
    async run(_ctx, args) {
      const room = await hostel.createRoom(args);
      return action({ type: 'hostel_room_created', id: room._id, data: { roomId: String(room._id), roomNo: room.roomNo }, speak: `Room ${room.roomNo} has been added.` });
    },
  },

  update_hostel_room: {
    module: 'Hostel',
    operation: 'UPDATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description: "Change a hostel room's number, block, floor, capacity, type, status or amenities. Needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        roomId: objectId(),
        roomNo: { type: 'string', maxLength: 40 },
        block: { type: 'string', maxLength: 40 },
        floor: { type: 'string', maxLength: 20 },
        capacity: { type: 'integer', minimum: 1, maximum: 50 },
        type: { type: 'string', enum: ROOM_TYPES },
        status: { type: 'string', enum: ROOM_STATUSES },
        amenities: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 60 } },
      },
      required: ['roomId'],
      additionalProperties: false,
    },
    permission: 'hostel.manage',
    minScope: 'ALL',
    service: 'hostel.service.updateRoom() — behind an MCP field allow-list',
    summarise: (args) => `Update ${Object.keys(args).filter((k) => k !== 'roomId').join(', ')} on hostel room ${args.roomId}`,
    async run(_ctx, args) {
      const { roomId, ...patch } = args;
      const { ok: allowed, fields, rejected } = applyFieldAllowList(patch, ROOM_UPDATE_ALLOW_LIST);
      if (rejected.length) throw new AppError(`I cannot change ${rejected.join(', ')} on a room.`, 400, [], 'FIELD_NOT_ALLOWED');
      if (!allowed) throw new AppError('Which details should I change?', 400, [], 'AGENT_NEEDS_INPUT');
      const room = await hostel.updateRoom(roomId, fields);
      return action({ type: 'hostel_room_updated', id: roomId, data: { roomId, changed: Object.keys(fields) }, speak: `Room ${room?.roomNo ?? ''} has been updated.`.replace('  ', ' ') });
    },
  },

  create_hostel_inquiry: {
    module: 'Hostel',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    description:
      'Raise a hostel enquiry — a subject and optional description, optionally about one student. It is recorded as raised by the caller. Low impact, so it runs without confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        subject: { type: 'string', maxLength: 200 },
        description: { type: 'string', maxLength: 2000 },
        studentId: objectId('The student it concerns, if any'),
      },
      required: ['subject'],
      additionalProperties: false,
    },
    permission: 'hostel.read',
    service: 'hostel.service.createInquiry()',
    summarise: (args) => `Raise a hostel enquiry: "${args.subject}"`,
    async run(ctx, args) {
      // Who raised it comes from the session, never from the arguments.
      const inquiry = await hostel.createInquiry({ ...args, raisedByProfileId: ctx.actor.profileId });
      return action({
        type: 'hostel_inquiry_created',
        id: inquiry._id,
        data: { inquiryId: String(inquiry._id), subject: inquiry.subject, status: inquiry.status },
        speak: 'The hostel enquiry has been recorded.',
      });
    },
  },

  update_hostel_inquiry: {
    module: 'Hostel',
    operation: 'UPDATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description: 'Move a hostel enquiry to OPEN, IN_PROGRESS or RESOLVED. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: { inquiryId: objectId(), status: { type: 'string', enum: INQUIRY_STATUSES } },
      required: ['inquiryId', 'status'],
      additionalProperties: false,
    },
    permission: 'hostel.manage',
    minScope: 'ALL',
    service: 'hostel.service.updateInquiry()',
    summarise: (args) => `Set hostel enquiry ${args.inquiryId} to ${args.status}`,
    async run(_ctx, args) {
      const inquiry = await hostel.updateInquiry(args.inquiryId, { status: args.status });
      return action({ type: 'hostel_inquiry_updated', id: args.inquiryId, data: { inquiryId: args.inquiryId, status: inquiry.status }, speak: `The enquiry is now ${args.status.toLowerCase().replace('_', ' ')}.` });
    },
  },

  allocate_hostel_bed: {
    module: 'Hostel',
    operation: 'ACTION',
    risk: RISK.MEDIUM,
    confirm: true,
    description:
      'Allocate a bed in a hostel room to a student, named by name, admission number or id. A student who already holds an active allocation is refused rather than given a second bed. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        roomId: objectId(),
        ...studentIdentitySchema,
        academicYearId: objectId(),
        allottedAt: dateStr(),
      },
      required: ['roomId'],
      additionalProperties: false,
    },
    permission: 'hostel.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'hostel.service.allocate()',
    summarise: (args) => `Allocate a bed in room ${args.roomId} to ${args.studentName ?? args.admissionNo ?? args.studentId}`,
    async prepare(ctx, args) {
      return { studentId: await studentFor(ctx, args) };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const allocation = await hostel.allocate({
        roomId: args.roomId, studentId: plan.studentId, academicYearId: args.academicYearId, allottedAt: args.allottedAt,
      });
      return action({ type: 'hostel_bed_allocated', id: allocation._id, data: { allocationId: String(allocation._id), roomId: args.roomId }, speak: 'The bed has been allocated.' });
    },
  },

  vacate_hostel_bed: {
    module: 'Hostel',
    operation: 'ACTION',
    risk: RISK.MEDIUM,
    confirm: true,
    description: 'Vacate a hostel allocation, freeing the bed. An allocation already vacated is refused. Needs confirmation.',
    inputSchema: { type: 'object', properties: { allocationId: objectId() }, required: ['allocationId'], additionalProperties: false },
    permission: 'hostel.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'hostel.service.vacate()',
    summarise: (args) => `Vacate hostel allocation ${args.allocationId}`,
    async run(_ctx, args) {
      await hostel.vacate(args.allocationId);
      return action({ type: 'hostel_bed_vacated', id: args.allocationId, data: { allocationId: args.allocationId }, speak: 'The bed has been vacated.' });
    },
  },

  /* ── Transport ───────────────────────────────────────── */
  get_my_bus: {
    module: 'Transport',
    operation: 'GET',
    risk: RISK.LOW,
    description: "The caller's own (or their child's) bus route, vehicle, driver and stop. Read-only.",
    inputSchema: { type: 'object', properties: { studentId: objectId() }, additionalProperties: false },
    permission: 'transport.read',
    service: 'transport.service.getOwnBus()',
    async run(ctx, args) {
      const bus = await transport.getOwnBus(ctx.actor, args.studentId);
      if (!bus) return ok(null, { speak: 'No bus route is assigned yet — contact the school office to enrol.' });
      return ok(bus, {
        speak: `Route ${bus.route?.name ?? '—'} (${bus.route?.vehicleNo ?? 'vehicle TBD'}), driver ${bus.route?.driverName ?? 'TBD'}. Stop: ${bus.stop?.name ?? '—'}.`,
      });
    },
  },

  get_transport_roster: {
    module: 'Transport',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'Which students travel on which route, optionally for one section. Read-only.',
    inputSchema: { type: 'object', properties: { sectionId: objectId() }, additionalProperties: false },
    permission: 'transport.read',
    minScope: 'ALL',
    service: 'transport.service.listTransportRoster()',
    async run(ctx, args) {
      const items = asList(await transport.listTransportRoster(ctx.actor, { sectionId: args.sectionId }));
      const onBus = items.filter((r) => r.route);
      const view = summarise(onBus, (r) => `${r.studentName} → ${r.route?.name ?? '—'}`);
      return ok(
        { roster: items, count: items.length, onTransport: onBus.length },
        { speak: onBus.length ? `${onBus.length} student(s) on transport: ${view.list}.` : 'No students are enrolled on a bus route.' },
      );
    },
  },

  list_transport_routes: {
    module: 'Transport',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'Active bus routes with vehicle, driver, number of stops and number of students enrolled. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    permission: 'transport.read',
    service: 'transport.service.listRoutes()',
    async run() {
      const routes = await transport.listRoutes();
      const view = summarise(routes, (r) => `${r.name} (${r.stopsCount} stops, ${r.enrollmentsCount} students)`);
      return ok(
        { routes: routes.map((r) => ({ ...r, id: String(r.id) })), count: routes.length },
        { speak: routes.length ? `${routes.length} active route(s): ${view.list}.` : 'There are no active bus routes.' },
      );
    },
  },

  list_transport_stops: {
    module: 'Transport',
    operation: 'GET',
    risk: RISK.LOW,
    description: "One route's stops, in the order the bus reaches them. Read-only.",
    inputSchema: { type: 'object', properties: { routeId: objectId() }, required: ['routeId'], additionalProperties: false },
    permission: 'transport.read',
    service: 'transport.service.listStops()',
    async run(_ctx, args) {
      const stops = await transport.listStops(args.routeId);
      return ok(
        { stops: stops.map((s) => ({ ...s, id: String(s.id), routeId: String(s.routeId) })), count: stops.length },
        { speak: stops.length ? `${stops.length} stop(s): ${stops.map((s) => s.name).join(', ')}.` : 'That route has no stops yet.' },
      );
    },
  },

  create_transport_route: {
    module: 'Transport',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description: 'Create a bus route with its vehicle and driver. Add stops afterwards with create_transport_stop. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', maxLength: 120 },
        operatorName: { type: 'string', maxLength: 120 },
        vehicleNo: { type: 'string', maxLength: 30 },
        driverName: { type: 'string', maxLength: 120 },
        driverPhone: { type: 'string', maxLength: 20 },
      },
      required: ['name'],
      additionalProperties: false,
    },
    permission: 'transport.manage',
    minScope: 'ALL',
    service: 'transport.service.createRoute()',
    summarise: (args) => `Create bus route "${args.name}"${args.vehicleNo ? ` (${args.vehicleNo})` : ''}`,
    async run(_ctx, args) {
      const route = await transport.createRoute(args);
      return action({ type: 'transport_route_created', id: route._id, data: { routeId: String(route._id), name: route.name }, speak: `Route "${route.name}" has been created.` });
    },
  },

  create_transport_stop: {
    module: 'Transport',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description: 'Add a stop to a bus route at a position in its order. Two stops cannot share a position on one route. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        routeId: objectId(),
        name: { type: 'string', maxLength: 120 },
        sequenceNo: { type: 'integer', minimum: 1, maximum: 200, description: 'Position along the route, 1 = first' },
        etaMinutesFromStart: { type: 'integer', minimum: 0, maximum: 600 },
      },
      required: ['routeId', 'name', 'sequenceNo'],
      additionalProperties: false,
    },
    permission: 'transport.manage',
    minScope: 'ALL',
    service: 'transport.service.createStop()',
    summarise: (args, _actor, prepared) =>
      `Add stop "${args.name}" as stop ${args.sequenceNo} on route "${prepared?.name ?? args.routeId}"`,
    /** The route must exist in this school — checked before anyone is asked to confirm, and named in the prompt. */
    async prepare(_ctx, args) {
      const route = await transport.getRoute(args.routeId);
      return { routeId: route.id, name: route.name };
    },
    async run(_ctx, args) {
      const stop = await transport.createStop(args);
      return action({ type: 'transport_stop_created', id: stop._id, data: { stopId: String(stop._id), name: stop.name }, speak: `Stop "${stop.name}" has been added.` });
    },
  },

  enroll_in_transport: {
    module: 'Transport',
    operation: 'ACTION',
    risk: RISK.MEDIUM,
    confirm: true,
    description:
      'Put a student on a bus route and stop for an academic year (the current one if not given). A student has one enrolment per year, so enrolling again moves them. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        ...studentIdentitySchema,
        routeId: objectId(),
        stopId: objectId('A stop on that route, from list_transport_stops'),
        academicYearId: objectId(),
        direction: { type: 'string', enum: BUS_DIRECTIONS, description: 'Default BOTH' },
      },
      required: ['routeId', 'stopId'],
      additionalProperties: false,
    },
    permission: 'transport.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'transport.service.enrollStudent()',
    summarise: (args, _actor, prepared) =>
      `Enrol ${prepared?.studentName ?? args.studentName ?? args.admissionNo ?? args.studentId} ` +
      `on route "${prepared?.routeName ?? args.routeId}" at stop "${prepared?.stopName ?? args.stopId}"` +
      `${prepared?.academicYearName ? ` for ${prepared.academicYearName}` : ''}` +
      `${args.direction && args.direction !== 'BOTH' ? ` (${args.direction.toLowerCase()} only)` : ''}`,
    /**
     * Resolves the student and checks the route, the stop (on that route) and
     * the year all exist in this school — the same check the service makes —
     * so the prompt names them and a wrong id is refused before confirmation.
     */
    async prepare(ctx, args) {
      const studentId = await studentFor(ctx, args);
      return transport.resolveEnrollment({
        studentId, routeId: args.routeId, stopId: args.stopId, academicYearId: args.academicYearId,
      });
    },
    /** The student's bus before and after: enrolling again moves them, so the audit keeps where they were. */
    async snapshot(ctx, args, prepared) {
      const studentId = prepared?.studentId ?? (await studentFor(ctx, args));
      const bus = await transport.getOwnBus(ctx.actor, studentId);
      return bus
        ? {
            route: bus.route?.name ?? null,
            routeId: bus.route?.id ? String(bus.route.id) : null,
            stop: bus.stop?.name ?? null,
            stopId: bus.stop?.id ? String(bus.stop.id) : null,
            direction: bus.direction ?? null,
          }
        : { route: null };
    },
    async run(ctx, args, prepared) {
      // A proposal stored before prepare() resolved names carries only the id.
      const plan = prepared?.routeName ? prepared : await this.prepare(ctx, args);
      const enrollment = await transport.enrollStudent({
        studentId: plan.studentId, routeId: plan.routeId, stopId: plan.stopId,
        academicYearId: plan.academicYearId, direction: args.direction,
      });
      return action({
        type: 'transport_enrolled',
        id: enrollment._id,
        data: {
          busEnrollmentId: String(enrollment._id),
          student: plan.studentName, route: plan.routeName, stop: plan.stopName,
          direction: enrollment.direction,
        },
        speak: `${plan.studentName} is now on route "${plan.routeName}", boarding at "${plan.stopName}".`,
      });
    },
  },
};
