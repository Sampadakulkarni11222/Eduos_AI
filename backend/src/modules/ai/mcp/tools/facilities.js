import * as library from '../../../library/library.service.js';
import * as hostel from '../../../hostel/hostel.service.js';
import * as transport from '../../../transport/transport.service.js';
import { AppError } from '../../../../utils/AppError.js';
import { ok, action } from '../protocol.js';
import { applyFieldAllowList } from '../validate.js';
import {
  RISK, objectId, dateStr, rupees, summarise, shortDate, wrapAgentTool, resolveStudentId, studentIdentitySchema,
  theNamed,
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
/**
 * A catalog item as a person names it.
 *
 * Every library write took only `bookId`, and nobody types an ObjectId. So
 * "issue Clean Code to Rahul", "update Clean Code to 5 copies" and "return the
 * Harry Potter book" reached no capability at all -- the id could not be
 * derived from the sentence, so the tool was not a candidate, and the
 * assistant either said nothing was supported or answered with the overdue
 * list.
 *
 * The title is resolved through library.service.listBooks(), which is the same
 * search the catalog screen runs, so nothing here decides what is in the
 * catalog. An exact title wins outright; a partial match that is unique is
 * accepted; anything ambiguous is OFFERED, never chosen -- picking one would
 * mean lending, editing or deleting the wrong item.
 */
export const bookIdentitySchema = {
  title: { type: 'string', maxLength: 300, description: 'The item as a person names it, e.g. "Clean Code". An ambiguous title is refused, never guessed.' },
};

export async function resolveBook(args = {}) {
  if (args.bookId) return await library.getBookById(String(args.bookId));
  const wanted = String(args.title ?? '').trim();
  if (!wanted) return null;

  const rows = asList(await library.listBooks({ search: wanted }));
  if (!rows.length) throw new AppError(`Nothing in the catalog matches "${wanted}".`, 404, [], 'BOOK_NOT_FOUND');

  const exact = rows.filter((b) => String(b.title ?? '').trim().toLowerCase() === wanted.toLowerCase());
  const candidates = exact.length ? exact : rows;
  if (candidates.length > 1) {
    const allIdentical = candidates.every(
      (c) =>
        String(c.title ?? '').trim().toLowerCase() === String(candidates[0].title ?? '').trim().toLowerCase() &&
        String(c.author ?? '').trim().toLowerCase() === String(candidates[0].author ?? '').trim().toLowerCase(),
    );
    if (!allIdentical) {
      throw new AppError(
        `More than one item matches "${wanted}": ${candidates.slice(0, 5).map((b) => `"${b.title}"${b.author ? ` by ${b.author}` : ''}`).join(', ')}. Which one?`,
        400, [], 'AGENT_NEEDS_INPUT',
      );
    }
  }
  return candidates[0];
}

/** resolveBook(), for callers that only want the id. */
export async function resolveBookId(args) {
  const book = await resolveBook(args);
  return book ? String(book.id ?? book._id) : null;
}

const ROOM_TYPES = ['BOYS', 'GIRLS', 'STAFF', 'GENERAL'];
const ROOM_STATUSES = ['ACTIVE', 'MAINTENANCE', 'CLOSED'];
const INQUIRY_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED'];

/**
 * A hostel room as a person names it.
 *
 * Rooms are identified in conversation by their number -- "Room 101" -- and by
 * an ObjectId nowhere else. Every hostel tool that took only `roomId` was
 * therefore unreachable from a sentence, and a question about one room was
 * answered with the whole hostel's occupancy. The number is resolved to the
 * room here, through the same listRooms() the screens read, so nothing about
 * which rooms exist is decided anywhere but the service.
 */
const roomIdentitySchema = {
  roomNo: { type: 'string', maxLength: 20, description: 'The room as a person names it, e.g. "101"' },
};

async function resolveRoom(args = {}) {
  if (args.roomId) {
    const room = (await hostel.listRooms({})).find((r) => String(r._id) === String(args.roomId));
    if (!room) throw new AppError('I could not find that room.', 404, [], 'ROOM_NOT_FOUND');
    return room;
  }
  if (!args.roomNo) return null;
  const wanted = String(args.roomNo).trim().toLowerCase();
  const matches = (await hostel.listRooms({})).filter((r) => String(r.roomNo).trim().toLowerCase() === wanted);
  if (!matches.length) throw new AppError(`I could not find a room called "${String(args.roomNo).trim()}".`, 404, [], 'ROOM_NOT_FOUND');
  if (matches.length > 1) {
    throw new AppError(
      `More than one room is numbered ${args.roomNo}: ${matches.map((r) => `block ${r.block ?? '-'}`).join(', ')}. Which block?`,
      400, [], 'AGENT_NEEDS_INPUT',
    );
  }
  return matches[0];
}
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
    resultShape: 'SUMMARY',
    description: 'Library totals: catalog size, unique titles, books currently on loan and how many are overdue. Read-only.',
    service: 'library.service.getSummary()',
  }),

  get_overdue_books: wrapAgentTool('get_overdue_books', {
    module: 'Library',
    resultShape: 'LIST',
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
        search: { type: 'string', maxLength: 120, description: 'Title, author, ISBN, category or publisher' },
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
    resultShape: 'DETAIL',
    description: 'One catalog item in full, with total and available copies. Name it by title or by id. Use it for "how many copies of X are available". Read-only.',
    inputSchema: {
      type: 'object',
      properties: { bookId: objectId(), ...bookIdentitySchema },
      additionalProperties: false,
    },
    permission: 'library.read',
    service: 'library.service.listBooks() + getBookById()',
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
      // The item may be named by title instead of id -- see resolveBook(). The
      // title therefore serves double duty: it identifies the item when no id
      // is given, and it is also a field that can be corrected. Changing a
      // title is only a change when an id says WHICH item to change, which is
      // what the run below enforces.
      additionalProperties: false,
    },
    permission: 'library.manage',
    minScope: 'ALL',
    service: 'library.service.listBooks() + updateBook() — behind an MCP field allow-list',
    summarise: (args, _actor, prepared) =>
      `Update ${(prepared?.changed ?? Object.keys(args).filter((k) => k !== 'bookId' && k !== 'title')).join(', ')} ` +
      `on "${prepared?.title ?? args.title ?? args.bookId}"`,
    async prepare(_ctx, args) {
      const book = await resolveBook(args);
      if (!book) throw new AppError('Which catalog item? Give its title.', 400, [], 'AGENT_NEEDS_INPUT');
      const { bookId, title, ...rest } = args;
      // A title given WITHOUT an id identified the item; it is not also a
      // change to it. With an id, a title is a correction.
      const patch = bookId && title !== undefined ? { ...rest, title } : rest;
      const { ok: allowed, fields, rejected } = applyFieldAllowList(patch, BOOK_UPDATE_ALLOW_LIST);
      if (rejected.length) throw new AppError(`I cannot change ${rejected.join(', ')} on a catalog item.`, 400, [], 'FIELD_NOT_ALLOWED');
      if (!allowed) throw new AppError('Which details should I change?', 400, [], 'AGENT_NEEDS_INPUT');
      return { bookId: String(book.id ?? book._id), title: book.title, fields, changed: Object.keys(fields) };
    },
    async snapshot(_ctx, _args, prepared) {
      return prepared ? { bookId: prepared.bookId, title: prepared.title } : null;
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const book = await library.updateBook(plan.bookId, plan.fields);
      return action({
        type: 'book_updated',
        id: plan.bookId,
        data: { bookId: plan.bookId, changed: plan.changed },
        speak: `"${book.title}" has been updated.`,
      });
    },
  },

  delete_book: {
    module: 'Library',
    operation: 'DELETE',
    risk: RISK.HIGH,
    confirm: true,
    description:
      'Remove an item from the library catalog. It is hidden from the catalog, not erased, and its lending history is kept. It does not check for copies currently on loan, so make sure they are returned first. Always needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: { bookId: objectId(), ...bookIdentitySchema },
      additionalProperties: false,
    },
    permission: 'library.manage',
    minScope: 'ALL',
    service: 'library.service.listBooks() + deleteBook()',
    summarise: (args, _actor, prepared) => `Remove "${prepared?.title ?? args.title ?? args.bookId}" from the library catalog`,
    async prepare(_ctx, args) {
      const book = await resolveBook(args);
      if (!book) throw new AppError('Which catalog item? Give its title.', 400, [], 'AGENT_NEEDS_INPUT');
      return {
        bookId: String(book.id ?? book._id),
        title: book.title,
        totalCopies: book.totalCopies,
        availableCopies: book.availableCopies,
      };
    },
    async snapshot(_ctx, _args, prepared) {
      return prepared ? { ...prepared } : null;
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      await library.deleteBook(plan.bookId);
      return action({
        type: 'book_deleted',
        id: plan.bookId,
        data: { bookId: plan.bookId, title: plan.title },
        speak: `"${plan.title}" has been removed from the catalog.`,
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
        ...bookIdentitySchema,
        ...studentIdentitySchema,
        dueAt: dateStr('When it must be returned'),
      },
      // Neither the item nor the due date is required as an ID. A librarian
      // says "issue Clean Code to Rahul"; the item is resolved from its title
      // and, with no due date given, the tool asks for one rather than
      // inventing a lending period.
      additionalProperties: false,
    },
    permission: 'library.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'library.service.issueBook()',
    summarise: (args, _actor, prepared) =>
      `Lend "${prepared?.title ?? args.title ?? args.bookId}" to ` +
      `${args.studentName ?? args.admissionNo ?? args.studentId}, due ${args.dueAt}`,
    async prepare(ctx, args) {
      if (!args.dueAt) throw new AppError('When is it due back?', 400, [], 'AGENT_NEEDS_INPUT');
      const [studentId, book] = await Promise.all([studentFor(ctx, args), resolveBook(args)]);
      if (!book) throw new AppError('Which item? Give its title.', 400, [], 'AGENT_NEEDS_INPUT');
      return { studentId, bookId: String(book.id ?? book._id), title: book.title };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const issue = await library.issueBook({ bookId: plan.bookId, studentId: plan.studentId, dueAt: args.dueAt });
      return action({
        type: 'book_issued',
        id: issue?.id ?? issue?._id,
        data: { issueId: String(issue?.id ?? issue?._id), bookId: plan.bookId, dueAt: args.dueAt },
        speak: `"${plan.title}" issued, due ${shortDate(args.dueAt)}.`,
      });
    },
  },

  return_book: {
    module: 'Library',
    operation: 'ACTION',
    risk: RISK.MEDIUM,
    confirm: true,
    description:
      'Record the return of a lent item. Name the item by title, and the borrower by name if more than one copy is out. Returning an item already returned is refused rather than counted twice. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        issueId: objectId('From list_book_issues'),
        ...bookIdentitySchema,
        ...studentIdentitySchema,
      },
      additionalProperties: false,
    },
    permission: 'library.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'library.service.listIssues() + returnBook()',
    summarise: (args, _actor, prepared) =>
      `Record the return of "${prepared?.title ?? args.title ?? 'the item'}"` +
      `${prepared?.borrower ? ` from ${prepared.borrower}` : ''}`,
    async prepare(ctx, args) {
      if (args.issueId) return { issueId: String(args.issueId) };

      // "Return the overdue Harry Potter book" used to reach the OVERDUE LIST
      // -- a read where a write was asked for. The open loan is found through
      // the same listIssues() the lending screen reads, narrowed by the item
      // and, when given, the borrower.
      let book;
      try {
        book = await resolveBook(args);
      } catch (err) {
        if (err.code === 'AGENT_NEEDS_INPUT' && args.title) {
          const rows = asList(await library.listBooks({ search: args.title }));
          const candidateIds = rows.map((b) => String(b.id ?? b._id));
          const allOpen = asList(await library.listIssues(ctx.actor, ctx.scope, { status: 'ALL' }))
            .filter((i) => ['ACTIVE', 'OVERDUE'].includes(String(i.status).toUpperCase()))
            .filter((i) => candidateIds.includes(String(i.bookId?._id ?? i.bookId ?? '')));
          const uniqueBooksWithLoans = [...new Set(allOpen.map((i) => String(i.bookId?._id ?? i.bookId ?? '')))];
          if (uniqueBooksWithLoans.length === 1) {
            book = rows.find((b) => String(b.id ?? b._id) === uniqueBooksWithLoans[0]);
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }
      if (!book) throw new AppError('Which item is being returned? Give its title.', 400, [], 'AGENT_NEEDS_INPUT');
      const studentId = (args.studentId || args.admissionNo || args.studentName)
        ? await resolveStudentId(ctx, args)
        : null;

      const open = asList(await library.listIssues(ctx.actor, ctx.scope, { status: 'ALL', bookId: String(book.id ?? book._id) }))
        .filter((i) => ['ACTIVE', 'OVERDUE'].includes(String(i.status).toUpperCase()))
        .filter((i) => !studentId || String(i.borrowerProfileId ?? i.studentId ?? '') === String(studentId));

      if (!open.length) throw new AppError(`No copy of "${book.title}" is currently on loan.`, 404, [], 'NOTHING_TO_RETURN');
      let selectedLoans = open;
      if (selectedLoans.length > 1) {
        const overdueOnly = selectedLoans.filter((i) => String(i.status).toUpperCase() === 'OVERDUE');
        if (overdueOnly.length === 1) {
          selectedLoans = overdueOnly;
        } else if (
          selectedLoans.every(
            (i) => String(i.borrowerProfileId ?? i.studentId ?? '') === String(selectedLoans[0].borrowerProfileId ?? selectedLoans[0].studentId ?? ''),
          )
        ) {
          selectedLoans = overdueOnly.length ? [overdueOnly[0]] : [selectedLoans[0]];
        }
      }

      if (selectedLoans.length > 1) {
        throw new AppError(
          `${selectedLoans.length} copies of "${book.title}" are on loan (${selectedLoans.slice(0, 5).map((i) => i.borrowerName ?? 'a borrower').join(', ')}). Whose return is this?`,
          400, [], 'AGENT_NEEDS_INPUT',
        );
      }
      return { issueId: String(selectedLoans[0].id ?? selectedLoans[0]._id), title: book.title, borrower: selectedLoans[0].borrowerName ?? null };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const issue = await library.returnBook(plan.issueId);
      return action({
        type: 'book_returned',
        id: plan.issueId,
        data: { issueId: plan.issueId, status: issue?.status ?? 'RETURNED', ...(plan.title && { title: plan.title }) },
        speak: `"${plan.title ?? 'The item'}" has been returned.`,
      });
    },
  },

  /* ── Hostel ──────────────────────────────────────────── */
  get_hostel_summary: wrapAgentTool('get_hostel_summary', {
    module: 'Hostel',
    resultShape: 'SUMMARY',
    description: 'Hostel occupancy: beds occupied and free, occupancy rate, room count and open enquiries. Read-only.',
    service: 'hostel.service.getSummary()',
  }),

  get_hostel_residents: wrapAgentTool('get_hostel_residents', {
    module: 'Hostel',
    resultShape: 'LIST',
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
        ...roomIdentitySchema,
        type: { type: 'string', enum: ROOM_TYPES },
        status: { type: 'string', enum: ROOM_STATUSES },
      },
      additionalProperties: false,
    },
    permission: 'hostel.read',
    minScope: 'ALL',
    service: 'hostel.service.listRooms()',
    async run(_ctx, args) {
      const all = await hostel.listRooms({ type: args.type, status: args.status });
      // "How many beds are free in Room 101" is a question about one room. It
      // used to be answered with the hostel's overall occupancy, which is a
      // true figure and the wrong answer.
      const wanted = args.roomNo ? String(args.roomNo).trim().toLowerCase() : null;
      const rooms = wanted ? all.filter((r) => String(r.roomNo).trim().toLowerCase() === wanted) : all;
      if (wanted && !rooms.length) {
        throw new AppError(`I could not find a room called "${String(args.roomNo).trim()}".`, 404, [], 'ROOM_NOT_FOUND');
      }
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
        wanted && rooms.length === 1
          ? {
            speak:
              `Room ${rooms[0].roomNo}${rooms[0].block ? ` (block ${rooms[0].block})` : ''}: ` +
              `${rooms[0].available} of ${rooms[0].capacity} bed(s) free, ${rooms[0].occupied} occupied.`,
          }
          : { speak: `${rooms.length} room(s), ${withSpace.length} with a free bed${withSpace.length ? `: ${view.list}` : ''}.` },
      );
    },
  },

  list_hostel_allocations: {
    module: 'Hostel',
    operation: 'GET',
    risk: RISK.LOW,
    resultShape: 'LIST',
    description: 'Bed allocations — which student is in which room, active or vacated. Narrow to one room by number, or to one student by name or admission number. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        roomId: objectId(),
        ...roomIdentitySchema,
        ...studentIdentitySchema,
        status: { type: 'string', enum: ['ACTIVE', 'VACATED'], description: 'Default ACTIVE' },
      },
      additionalProperties: false,
    },
    permission: 'hostel.read',
    minScope: 'ALL',
    service: 'hostel.service.listAllocations()',
    async run(ctx, args) {
      // Both narrowings resolve through the helpers the rest of the catalog
      // uses, so a room named in words and a student named in words reach the
      // same records the screens show -- and a named student with no
      // allocation is answered as such rather than with everybody's.
      const room = await resolveRoom(args);
      const studentId = (args.studentId || args.admissionNo || args.studentName)
        ? await resolveStudentId(ctx, args)
        : null;

      const rows = asList(await hostel.listAllocations({
        ...(room && { roomId: room._id }),
        status: args.status ?? 'ACTIVE',
      }));
      const mine = studentId ? rows.filter((r) => String(r.studentId?._id ?? r.studentId) === String(studentId)) : rows;

      const where = room ? ` in room ${room.roomNo}` : '';
      const render = (r) => {
        const st = r.studentId ?? {};
        const name = [st.firstName, st.lastName].filter(Boolean).join(' ') || st.admissionNo || 'a student';
        return `${name} (room ${r.roomId?.roomNo ?? '-'})`;
      };
      const view = summarise(mine, render, { limit: 10 });
      return ok(
        { allocations: mine, count: mine.length, room: room ? { roomId: String(room._id), roomNo: room.roomNo } : null },
        {
          speak: mine.length
            ? `${mine.length} ${(args.status ?? 'active').toLowerCase()} allocation(s)${where}: ${view.list}${view.more ? ', and more' : ''}.`
            : `No ${(args.status ?? 'active').toLowerCase()} allocation${where}.`,
        },
      );
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
      // No required id. A room is named by its number in every sentence anybody
      // types, and demanding an ObjectId made this capability unreachable from
      // one -- it was not even a candidate, so "update room 101" reached a bed
      // allocation instead.
      additionalProperties: false,
    },
    permission: 'hostel.manage',
    minScope: 'ALL',
    service: 'hostel.service.listRooms() + updateRoom() — behind an MCP field allow-list',
    summarise: (args, _actor, prepared) =>
      `Update ${(prepared?.changed ?? Object.keys(args).filter((k) => k !== 'roomId')).join(', ')} ` +
      `on hostel room ${prepared?.roomNo ?? args.roomNo ?? args.roomId}`,
    async prepare(_ctx, args) {
      const room = await resolveRoom(args);
      if (!room) throw new AppError('Which room? Give the room number.', 400, [], 'AGENT_NEEDS_INPUT');

      const { roomId, roomNo, ...rest } = args;
      // A room number given WITHOUT an id identified the room; it is not also a
      // change to it. With an id, a new number is a renumbering.
      const patch = roomId && roomNo !== undefined ? { ...rest, roomNo } : rest;
      const { ok: allowed, fields, rejected } = applyFieldAllowList(patch, ROOM_UPDATE_ALLOW_LIST);
      if (rejected.length) throw new AppError(`I cannot change ${rejected.join(', ')} on a room.`, 400, [], 'FIELD_NOT_ALLOWED');
      if (!allowed) throw new AppError('Which details should I change?', 400, [], 'AGENT_NEEDS_INPUT');
      return { roomId: String(room._id), roomNo: room.roomNo, fields, changed: Object.keys(fields) };
    },
    async snapshot(_ctx, _args, prepared) {
      return prepared ? { roomId: prepared.roomId, roomNo: prepared.roomNo } : null;
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const room = await hostel.updateRoom(plan.roomId, plan.fields);
      return action({
        type: 'hostel_room_updated',
        id: plan.roomId,
        data: { roomId: plan.roomId, changed: plan.changed },
        speak: `Room ${room?.roomNo ?? plan.roomNo} has been updated.`,
      });
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
        ...roomIdentitySchema,
        ...studentIdentitySchema,
        academicYearId: objectId(),
        allottedAt: dateStr(),
      },
      // Deliberately nothing required. A room named by number is as good as a
      // room named by id, and a request that names neither is answered with
      // "which room?" by the capability that allocates -- not, as before, with
      // occupancy statistics from a capability that does not.
      additionalProperties: false,
    },
    permission: 'hostel.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'hostel.service.allocate()',
    summarise: (args, _actor, prepared) =>
      `Allocate a bed in room ${prepared?.roomNo ?? args.roomNo ?? args.roomId} to ` +
      `${prepared?.studentLabel ?? args.studentName ?? args.admissionNo ?? args.studentId}`,
    async prepare(ctx, args) {
      let room = await resolveRoom(args);
      if (!room) {
        // When no room is specified in the request (e.g. "Allocate bed to Diya Sharma"),
        // select the first active room that currently has an available bed.
        const rooms = asList(await hostel.listRooms({ status: 'ACTIVE' }));
        room = rooms.find((r) => (r.available ?? 0) > 0);
        if (!room) {
          if (rooms.length === 0) {
            throw new AppError('No hostel rooms configured.', 404);
          }
          throw new AppError('All hostel rooms are currently full.', 409, [], 'ROOM_FULL');
        }
      }
      // The free-bed check the service makes is repeated here for one reason
      // only: the CONFIRMATION a person is shown must be about a room that can
      // actually take them. The service remains the one that decides.
      if ((room.available ?? 0) <= 0) throw new AppError(`Room ${room.roomNo} has no free bed.`, 409, [], 'ROOM_FULL');

      const studentId = await studentFor(ctx, args);
      return {
        studentId,
        roomId: String(room._id),
        roomNo: room.roomNo,
        studentLabel: args.studentName ?? args.admissionNo ?? String(studentId),
      };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const allocation = await hostel.allocate({
        roomId: plan.roomId, studentId: plan.studentId, academicYearId: args.academicYearId, allottedAt: args.allottedAt,
      });
      return action({
        type: 'hostel_bed_allocated',
        id: allocation._id,
        data: { allocationId: String(allocation._id), roomId: plan.roomId, roomNo: plan.roomNo },
        speak: `The bed in room ${plan.roomNo} has been allocated.`,
      });
    },
  },

  vacate_hostel_bed: {
    module: 'Hostel',
    operation: 'ACTION',
    risk: RISK.MEDIUM,
    confirm: true,
    description: 'Vacate a hostel allocation, freeing the bed. An allocation already vacated is refused. Needs confirmation.',
    inputSchema: {
      type: 'object',
      // A warden says "vacate Diya Sharma's bed", never an allocation id. The
      // student is resolved to their ONE active allocation; more than one is
      // refused rather than guessed at, because a guess here frees the wrong
      // bed.
      properties: { allocationId: objectId(), ...studentIdentitySchema },
      additionalProperties: false,
    },
    permission: 'hostel.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'hostel.service.vacate()',
    summarise: (args, _actor, prepared) =>
      `Vacate the hostel bed held by ` +
      `${prepared?.studentLabel ?? args.studentName ?? args.admissionNo ?? `allocation ${args.allocationId}`}` +
      `${prepared?.roomNo ? ` in room ${prepared.roomNo}` : ''}`,
    async prepare(ctx, args) {
      if (args.allocationId) return { allocationId: String(args.allocationId) };
      const studentId = await resolveStudentId(ctx, args);
      if (!studentId) throw new AppError('Name the student whose bed should be vacated.', 400, [], 'AGENT_NEEDS_INPUT');

      const active = asList(await hostel.listAllocations({ status: 'ACTIVE' }))
        .filter((r) => String(r.studentId?._id ?? r.studentId) === String(studentId));
      if (!active.length) throw new AppError('That student has no active hostel allocation.', 404);
      if (active.length > 1) {
        throw new AppError('That student has more than one active allocation. Name the allocation.', 400, [], 'AGENT_NEEDS_INPUT');
      }
      const st = active[0].studentId ?? {};
      return {
        allocationId: String(active[0]._id),
        roomNo: active[0].roomId?.roomNo ?? null,
        studentLabel: [st.firstName, st.lastName].filter(Boolean).join(' ') || args.studentName || args.admissionNo,
      };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      await hostel.vacate(plan.allocationId);
      return action({
        type: 'hostel_bed_vacated',
        id: plan.allocationId,
        data: { allocationId: plan.allocationId, ...(plan.roomNo && { roomNo: plan.roomNo }) },
        speak: 'The bed has been vacated.',
      });
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
        fareAmountPaise: {
          type: 'integer',
          minimum: 0,
          description: 'What a place on this route costs for the year, in paise, so ₹12,000 is 1200000. Omit for a route that carries no charge.',
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
    permission: 'transport.manage',
    minScope: 'ALL',
    service: 'transport.service.createRoute()',
    summarise: (args) =>
      `Create bus route "${args.name}"${args.vehicleNo ? ` (${args.vehicleNo})` : ''}`
      + `${args.fareAmountPaise ? ` at ${rupees(args.fareAmountPaise)} a year` : ''}`,
    async run(_ctx, args) {
      const route = await transport.createRoute(args);
      return action({ type: 'transport_route_created', id: route._id, data: { routeId: String(route._id), name: route.name }, speak: `Route "${route.name}" has been created.` });
    },
  },

  update_transport_route: {
    module: 'Transport',
    operation: 'UPDATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description:
      "Correct a bus route — its vehicle, its driver, whether it is running, or what a place on it costs for the year. Changing the fare does not re-bill anyone: each approved request was invoiced at the fare it was granted at, so this decides what the next approval costs. Use list_transport_routes to find the route id. Needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        routeId: objectId('From list_transport_routes'),
        // A route is named in every sentence anybody types -- "Route 2" -- and
        // by an ObjectId nowhere else, so `routeName` identifies it while
        // `name` renames it. Requiring the id made the capability unreachable
        // from a sentence at all.
        routeName: { type: 'string', maxLength: 120, description: 'The route as it is written, e.g. "Route 2". An ambiguous name is refused, never guessed.' },
        name: { type: 'string', maxLength: 120, description: 'A NEW name for the route' },
        operatorName: { type: 'string', maxLength: 120 },
        vehicleNo: { type: 'string', maxLength: 30 },
        driverName: { type: 'string', maxLength: 120 },
        driverPhone: { type: 'string', maxLength: 20 },
        status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'] },
        fareAmountPaise: {
          type: 'integer',
          minimum: 0,
          description: 'The yearly fare in paise, so ₹12,000 is 1200000. Zero means the route carries no charge.',
        },
      },
      additionalProperties: false,
    },
    permission: 'transport.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'transport.service.updateRoute()',
    summarise: (args, _actor, prepared) => {
      const what = [];
      if (args.fareAmountPaise !== undefined) what.push(`the fare to ${rupees(args.fareAmountPaise)} a year`);
      if (args.status !== undefined) what.push(`its status to ${args.status.toLowerCase()}`);
      for (const field of ['name', 'operatorName', 'vehicleNo', 'driverName', 'driverPhone']) {
        if (args[field] !== undefined) what.push(field === 'name' ? 'its name' : field.replace(/([A-Z])/g, ' $1').toLowerCase());
      }
      return `Change ${what.join(', ') || 'nothing'} on route "${prepared?.name ?? args.routeName ?? args.routeId}"`;
    },
    /** The route must exist in this school, and the prompt names it. */
    async prepare(_ctx, args) {
      // By id when one is given, by name otherwise -- the routes the school
      // runs, read through the same listRoutes() the transport screen reads.
      const route = args.routeId
        ? await transport.getRoute(args.routeId)
        : theNamed(await transport.listRoutes(), args.routeName, {
          label: 'route',
          nameOf: (r) => r.name,
          describe: (r) => `"${r.name}"`,
        });
      return {
        routeId: String(route._id ?? route.id),
        name: route.name,
        fareAmountPaise: route.fareAmountPaise ?? 0,
      };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const { routeId: _id, routeName: _named, ...changes } = args;
      const route = await transport.updateRoute(ctx.actor, plan.routeId, changes);
      return action({
        type: 'transport_route_updated',
        id: String(route._id),
        data: { routeId: String(route._id), name: route.name, fareAmountPaise: route.fareAmountPaise ?? 0, status: route.status },
        speak: args.fareAmountPaise !== undefined
          ? `A place on ${route.name} now costs ${rupees(route.fareAmountPaise ?? 0)} a year.`
          : `Route "${route.name}" has been updated.`,
      });
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
