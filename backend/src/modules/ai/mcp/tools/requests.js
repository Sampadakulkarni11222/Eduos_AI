import * as library from '../../../library/library.service.js';
import * as transport from '../../../transport/transport.service.js';
import * as cocurricular from '../../../studentRequests/cocurricular.service.js';
import * as profileEdit from '../../../studentRequests/profileEdit.service.js';
import { AppError } from '../../../../utils/AppError.js';
import { ok, action } from '../protocol.js';
import {
  RISK, objectId, dateStr, noArgs, summarise, decidableSchema, thePendingRequest, raisedBy,
} from './_shared.js';

/**
 * Things a student asks for, and the decisions staff make on them.
 *
 * Two flows with one shape: a book off the library shelf, and a place on a bus
 * route. Both are requests rather than facts until somebody holding the
 * relevant permission decides, and the decision is what changes anything —
 * approving a book request issues the book, approving a transport request
 * creates the travel arrangement and raises the invoice for the fare.
 *
 * Nothing here decides who the student is. Every request tool resolves the
 * caller's own student record from the session profile inside the service, so
 * a studentId in the arguments is neither read nor honoured; the review and
 * decision tools are gated on the managing permission at school-wide scope.
 */

const DECISIONS = ['APPROVED', 'REJECTED'];

/**
 * A route, stop or book named the way a person names it.
 *
 * Every request and decision tool in this file took only ObjectIds, and a
 * student says "request Route 2 for me" and a librarian says "approve Rahul's
 * book request". Neither reached a capability at all: the id could not come
 * from the sentence, so the tool was not a candidate, and the assistant
 * answered with a list instead of doing what was asked.
 *
 * Each resolver below reads the SAME list service the corresponding screen
 * reads, at the caller's own scope, so nothing about what exists or who may
 * see it is decided here. A unique match is taken; anything ambiguous is
 * offered back as a question, because choosing would mean acting on a record
 * nobody named.
 */
function uniquely(rows, { what, describe, term }) {
  if (!rows.length) throw new AppError(`I could not find ${what} matching "${term}".`, 404, [], 'NOT_FOUND');
  if (rows.length > 1) {
    throw new AppError(
      `More than one ${what} matches "${term}": ${rows.slice(0, 5).map(describe).join(', ')}. Which one?`,
      400, [], 'AGENT_NEEDS_INPUT',
    );
  }
  return rows[0];
}

const looseMatch = (value, term) => String(value ?? '').trim().toLowerCase().includes(String(term).trim().toLowerCase());
const exactMatch = (value, term) => String(value ?? '').trim().toLowerCase() === String(term).trim().toLowerCase();

/** Narrows to exact matches when there are any, so "Route 2" does not also mean "Route 20". */
function preferExact(rows, term, field) {
  const exact = rows.filter((r) => exactMatch(r[field], term));
  return exact.length ? exact : rows.filter((r) => looseMatch(r[field], term));
}

/**
 * The one request of the caller's that a "cancel mine" really means.
 *
 * Every withdraw tool below used to REQUIRE an opaque request id, and nobody
 * types one. "Cancel my pending book request" therefore reached no capability
 * at all -- the id could not be derived from the sentence, so the tool was not
 * a candidate, and the assistant answered by listing the requests instead of
 * withdrawing one.
 *
 * The id is now optional, and when it is absent the caller's OWN pending
 * request is found through the same list service the screen reads. Three
 * outcomes, deliberately distinct:
 *
 *   exactly one pending   that is what "my request" means, and it is
 *                         summarised by name in the confirmation before
 *                         anything happens
 *   none pending          answered plainly, rather than with a service-level
 *                         "Request not found"
 *   more than one         ASKED, never guessed. Withdrawing the wrong one of a
 *                         student's two requests is not recoverable by them.
 *
 * Nothing about identity comes from the arguments: the list service resolves
 * whose requests these are from the session, exactly as it does for the screen,
 * and the cancel service re-checks ownership and state underneath. This only
 * decides WHICH of the caller's own requests a bare "my request" refers to.
 */
const PENDING = 'PENDING';

async function theOnlyPendingRequest(rows, { label, describe }) {
  const pending = asList(rows).filter((r) => String(r.status ?? '').toUpperCase() === PENDING);
  if (!pending.length) {
    throw new AppError(`You have no pending ${label} to withdraw.`, 404, [], 'NOTHING_TO_CANCEL');
  }
  if (pending.length > 1) {
    throw new AppError(
      `You have ${pending.length} pending ${label}: ${pending.map(describe).join(', ')}. Which one?`,
      400, [], 'AGENT_NEEDS_INPUT',
    );
  }
  return pending[0];
}

/** The schema every withdraw tool shares: an id if you have one, nothing if you do not. */
const cancellableSchema = (source) => ({
  type: 'object',
  properties: {
    requestId: objectId(`From ${source}. Omit it when you have only one pending request.`),
  },
  additionalProperties: false,
});
const asList = (rows) => (Array.isArray(rows) ? rows : (rows?.items ?? []));
const rupees = (paise) => `₹${(Number(paise ?? 0) / 100).toLocaleString('en-IN')}`;

export const requestTools = {
  /* ── Library: asking for a book ──────────────────────── */

  request_book: {
    module: 'Library',
    operation: 'CREATE',
    risk: RISK.LOW,
    description:
      "Ask the library to issue a book to the caller. Name it by title or by id. The book must be a physical copy in this school's catalogue — an online resource is read where it lives and cannot be issued. The request goes to the librarian and changes nothing until it is approved, so it runs without confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        bookId: objectId('From list_books'),
        title: { type: 'string', maxLength: 300, description: 'The book as a person names it, e.g. "Introduction to Algorithms". An ambiguous title is refused, never guessed.' },
      },
      additionalProperties: false,
    },
    permission: 'library.request',
    service: 'library.service.listBooks() + requestBook()',
    summarise: (args, _actor, prepared) =>
      `Ask the library to issue "${prepared?.title ?? args.title ?? args.bookId}" to you`,
    async prepare(_ctx, args) {
      if (args.bookId) return { bookId: String(args.bookId) };
      const term = String(args.title ?? '').trim();
      if (!term) throw new AppError('Which book? Give its title.', 400, [], 'AGENT_NEEDS_INPUT');
      const rows = asList(await library.listBooks({ search: term }));
      const book = uniquely(preferExact(rows, term, 'title'), {
        what: 'a book',
        term,
        describe: (b) => `"${b.title}"${b.author ? ` by ${b.author}` : ''}`,
      });
      return { bookId: String(book.id ?? book._id), title: book.title };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const request = await library.requestBook(ctx.actor, plan.bookId);
      return action({
        type: 'book_requested',
        id: request.id,
        data: request,
        speak: `Your request for "${request.bookTitle}" has been sent to the librarian.`,
      });
    },
  },

  get_my_book_requests: {
    module: 'Library',
    operation: 'GET',
    risk: RISK.LOW,
    description: "The caller's own book requests and what was decided on each. Read-only.",
    inputSchema: noArgs,
    permission: 'library.request',
    service: 'library.service.listMyBookRequests()',
    resultShape: 'LIST',
    async run(ctx) {
      const rows = await library.listMyBookRequests(ctx.actor);
      const view = summarise(rows, (r) => `${r.bookTitle} — ${r.status.toLowerCase()}`);
      return ok(
        { requests: rows, count: rows.length },
        { speak: rows.length ? `${rows.length} book request(s): ${view.list}.` : 'You have not asked for any books yet.' },
      );
    },
  },

  get_book_requests: {
    module: 'Library',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      'Book requests waiting for the librarian to decide, with who asked and whether a copy is free. Defaults to the pending ones. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ALL'] },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    permission: 'library.manage',
    minScope: 'ALL',
    service: 'library.service.listBookRequestsForReview()',
    resultShape: 'LIST',
    async run(ctx, args) {
      const page = await library.listBookRequestsForReview(ctx.actor, ctx.scope, {
        status: args.status ?? 'PENDING',
        pageSize: Math.min(Number(args.limit) || 25, 100),
      });
      const rows = asList(page);
      const view = summarise(rows, (r) => `${r.studentName ?? 'A student'} — ${r.bookTitle}`);
      return ok(
        { requests: rows, count: rows.length },
        { speak: rows.length ? `${rows.length} book request(s): ${view.list}.` : 'No book requests are waiting.' },
      );
    },
  },

  decide_book_request: {
    module: 'Library',
    operation: 'ACTION',
    risk: RISK.MEDIUM,
    confirm: true,
    description:
      'Approve or reject a book request. Name the request by the student who made it, by the book, or by id. Approving issues the book to the student and takes a copy off the shelf; if no copy is free the approval is refused and the request stays waiting. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        requestId: objectId('From get_book_requests'),
        studentName: { type: 'string', maxLength: 80, description: 'The student who asked, e.g. "Rahul". More than one pending request matching is refused, never guessed.' },
        title: { type: 'string', maxLength: 300, description: 'The book that was asked for' },
        status: { type: 'string', enum: DECISIONS },
        note: { type: 'string', maxLength: 500, description: 'Shown to the student with the decision' },
        dueAt: dateStr('When the book is due back; defaults to a fortnight from today'),
      },
      required: ['status'],
      additionalProperties: false,
    },
    permission: 'library.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'library.service.listBookRequestsForReview() + decideBookRequest()',
    summarise: (args, _actor, prepared) =>
      `${args.status === 'APPROVED' ? 'Approve' : 'Reject'} ` +
      `${prepared?.label ?? `book request ${args.requestId}`}` +
      `${args.status === 'APPROVED' ? ' — this issues the book' : ''}`,
    async prepare(ctx, args) {
      if (args.requestId) return { requestId: String(args.requestId) };

      const term = args.studentName ?? args.title;
      if (!term) throw new AppError('Whose book request? Name the student or the book.', 400, [], 'AGENT_NEEDS_INPUT');

      // The pending queue, read exactly as the review screen reads it, then
      // narrowed by what was said. Only PENDING requests are decidable, so a
      // request already decided is never silently decided again.
      const queue = asList(await library.listBookRequestsForReview(ctx.actor, ctx.scope, { status: 'PENDING' }));
      const field = args.studentName ? 'studentName' : 'bookTitle';
      const matched = uniquely(preferExact(queue, term, field), {
        what: 'a pending book request',
        term,
        describe: (r) => `${r.studentName ?? 'a student'} — "${r.bookTitle ?? 'a book'}"`,
      });
      return {
        requestId: String(matched.id ?? matched._id),
        label: `${matched.studentName ?? 'the student'}'s request for "${matched.bookTitle ?? 'a book'}"`,
      };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const result = await library.decideBookRequest(ctx.actor, plan.requestId, {
        status: args.status,
        note: args.note ?? null,
        dueAt: args.dueAt ?? null,
      });
      return action({
        type: args.status === 'APPROVED' ? 'book_request_approved' : 'book_request_rejected',
        id: result.id,
        data: result,
        speak: args.status === 'APPROVED'
          ? `"${result.bookTitle}" has been issued to ${result.studentName ?? 'the student'}.`
          : `The request for "${result.bookTitle}" has been rejected.`,
      });
    },
  },

  /* ── Transport: asking for a place on a route ────────── */

  get_transport_routes: {
    module: 'Transport',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      "The bus routes the caller can ask for, with each route's stops and what a place on it costs for the year. Also says whether the caller already has a request or a place. Read-only.",
    inputSchema: noArgs,
    permission: 'transport.request',
    service: 'transport.service.listRoutesForStudent()',
    resultShape: 'LIST',
    async run(ctx) {
      const view = await transport.listRoutesForStudent(ctx.actor);
      const list = summarise(
        view.routes,
        (r) => `${r.name}${r.fareAmountPaise ? ` (${rupees(r.fareAmountPaise)} a year)` : ''}`,
      );
      const already = view.myRequest && ['PENDING', 'APPROVED'].includes(view.myRequest.status)
        ? ` You already have a ${view.myRequest.status.toLowerCase()} request for ${view.myRequest.routeName}.`
        : '';
      return ok(view, {
        speak: view.routes.length
          ? `${view.routes.length} route(s): ${list.list}.${already}`
          : 'No bus routes are running at the moment.',
      });
    },
  },

  request_transport_route: {
    module: 'Transport',
    operation: 'CREATE',
    risk: RISK.LOW,
    description:
      'Ask for a place on a bus route, from a particular stop. Name the route the way it is written ("Route 2") and, where the route has more than one stop, name the stop too. The stop must be one on that route. The request goes to the school office and changes nothing until it is approved — the fare is only charged once a place is granted, so it runs without confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        routeId: objectId('From get_transport_routes'),
        routeName: { type: 'string', maxLength: 120, description: 'The route as it is written, e.g. "Route 2"' },
        stopId: objectId('A stop on that route'),
        stopName: { type: 'string', maxLength: 120, description: 'The stop as it is written' },
        direction: {
          type: 'string',
          enum: ['BOTH', 'PICKUP', 'DROP'],
          description: 'Both ways by default',
        },
      },
      additionalProperties: false,
    },
    permission: 'transport.request',
    service: 'transport.service.listRoutesForStudent() + requestRoute()',
    summarise: (args, _actor, prepared) =>
      `Ask for a place on ${prepared?.routeName ?? args.routeName ?? `route ${args.routeId}`}` +
      `${prepared?.stopName ? ` from ${prepared.stopName}` : ''}`,
    async prepare(ctx, args) {
      if (args.routeId && args.stopId) {
        return { routeId: String(args.routeId), stopId: String(args.stopId) };
      }

      // The routes this caller may ask for, read from the same service their
      // own screen reads -- so a route they cannot request is not a candidate
      // here either.
      const view = await transport.listRoutesForStudent(ctx.actor);
      const routes = view.routes ?? [];
      if (!routes.length) throw new AppError('No bus routes are running at the moment.', 404, [], 'NO_ROUTES');

      const route = args.routeId
        ? routes.find((r) => String(r.id ?? r._id) === String(args.routeId))
        : args.routeName
          ? uniquely(preferExact(routes, args.routeName, 'name'), {
            what: 'a route', term: args.routeName, describe: (r) => r.name,
          })
          : null;
      if (!route) {
        throw new AppError(
          `Which route? ${routes.map((r) => r.name).slice(0, 8).join(', ')}.`,
          400, [], 'AGENT_NEEDS_INPUT',
        );
      }

      const stops = route.stops ?? [];
      // One stop is not a choice; several are, and picking one would put a
      // child on the wrong corner.
      const stop = args.stopId
        ? stops.find((st) => String(st.id ?? st._id) === String(args.stopId))
        : args.stopName
          ? uniquely(preferExact(stops, args.stopName, 'name'), {
            what: 'a stop', term: args.stopName, describe: (st) => st.name,
          })
          : stops.length === 1
            ? stops[0]
            : null;
      if (!stop) {
        throw new AppError(
          stops.length
            ? `Which stop on ${route.name}? ${stops.map((st) => st.name).slice(0, 8).join(', ')}.`
            : `${route.name} has no stops listed yet.`,
          400, [], 'AGENT_NEEDS_INPUT',
        );
      }

      return {
        routeId: String(route.id ?? route._id),
        stopId: String(stop.id ?? stop._id),
        routeName: route.name,
        stopName: stop.name,
      };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const request = await transport.requestRoute(ctx.actor, {
        routeId: plan.routeId,
        stopId: plan.stopId,
        direction: args.direction ?? 'BOTH',
      });
      return action({
        type: 'transport_requested',
        id: request.id,
        data: request,
        speak: `Your request for a place on ${request.routeName} from ${request.stopName} has been sent to the school office.`,
      });
    },
  },

  get_my_transport_requests: {
    module: 'Transport',
    operation: 'GET',
    risk: RISK.LOW,
    description: "The caller's own transport requests and what was decided on each. Read-only.",
    inputSchema: noArgs,
    permission: 'transport.request',
    service: 'transport.service.listMyTransportRequests()',
    resultShape: 'LIST',
    async run(ctx) {
      const rows = await transport.listMyTransportRequests(ctx.actor);
      const view = summarise(rows, (r) => `${r.routeName} — ${r.status.toLowerCase()}`);
      return ok(
        { requests: rows, count: rows.length },
        { speak: rows.length ? `${rows.length} transport request(s): ${view.list}.` : 'You have not asked for a bus place yet.' },
      );
    },
  },

  get_transport_requests: {
    module: 'Transport',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      'Transport requests waiting for a decision, with who asked, which route and stop, and the fare. Defaults to the pending ones. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ALL'] },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    permission: 'transport.manage',
    minScope: 'ALL',
    service: 'transport.service.listTransportRequestsForReview()',
    resultShape: 'LIST',
    async run(ctx, args) {
      const page = await transport.listTransportRequestsForReview(ctx.actor, ctx.scope, {
        status: args.status ?? 'PENDING',
        pageSize: Math.min(Number(args.limit) || 25, 100),
      });
      const rows = asList(page);
      const view = summarise(rows, (r) => `${r.studentName ?? 'A student'} — ${r.routeName} (${r.stopName})`);
      return ok(
        { requests: rows, count: rows.length },
        { speak: rows.length ? `${rows.length} transport request(s): ${view.list}.` : 'No transport requests are waiting.' },
      );
    },
  },

  decide_transport_request: {
    module: 'Transport',
    operation: 'ACTION',
    risk: RISK.MEDIUM,
    confirm: true,
    description:
      "Approve or reject a request for a place on a bus route. Approving puts the student on the route and, when the route carries a fare, raises an invoice for it against their fees. Use get_transport_requests to find the request id. Needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        ...decidableSchema('get_transport_requests'),
        status: { type: 'string', enum: DECISIONS },
        note: { type: 'string', maxLength: 500, description: 'Shown to the student with the decision' },
      },
      required: ['status'],
      additionalProperties: false,
    },
    permission: 'transport.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'transport.service.listTransportRequestsForReview() + decideTransportRequest()',
    summarise: (args, _actor, prepared) =>
      `${args.status === 'APPROVED' ? 'Approve' : 'Reject'} the transport request ` +
      `${prepared?.who ? `from ${prepared.who}` : `${args.requestId ?? ''}`}`.trimEnd() +
      `${args.status === 'APPROVED' ? ' — this grants the place and bills the fare' : ''}`,
    async prepare(ctx, args) {
      if (args.requestId) return { id: String(args.requestId) };
      const chosen = thePendingRequest(
        await transport.listTransportRequestsForReview(ctx.actor, ctx.scope, { status: 'PENDING' }),
        { studentName: args.studentName, label: 'transport request' },
      );
      return { id: String(chosen.id ?? chosen._id), who: raisedBy(chosen) };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const result = await transport.decideTransportRequest(ctx.actor, plan.id, {
        status: args.status,
        note: args.note ?? null,
      });
      const billed = result.invoiceId ? ` ${rupees(result.fareAmountPaise)} has been added to their fees.` : '';
      return action({
        type: args.status === 'APPROVED' ? 'transport_request_approved' : 'transport_request_rejected',
        id: result.id,
        data: result,
        speak: args.status === 'APPROVED'
          ? `${result.studentName ?? 'The student'} now has a place on ${result.routeName}.${billed}`
          : `The transport request for ${result.routeName} has been rejected.`,
      });
    },
  },

  /* ── Withdrawing a request that has not been decided ─── */

  /**
   * The other half of every self-service request.
   *
   * Each of these fronts the same actor-aware service the web route calls, and
   * each resolves the caller's own student record from the session inside that
   * service — so the id names WHICH of the caller's own requests, never whose.
   * A request belonging to somebody else is not found rather than refused,
   * which is the same answer the web gives and discloses nothing about it.
   *
   * They are DELETE-shaped and confirmed: withdrawing is the caller's own
   * decision about their own request, but it is not reversible, and the
   * elective withdrawal that has always been exposed sets that precedent.
   */

  cancel_book_request: {
    module: 'Library',
    operation: 'DELETE',
    risk: RISK.LOW,
    confirm: true,
    description:
      "Withdraw the caller's own book request, while the librarian has not yet decided on it. A request already approved or rejected cannot be withdrawn. With no request id, the caller's single pending request is withdrawn; with several pending, the caller is asked which. Needs confirmation.",
    inputSchema: cancellableSchema('get_my_book_requests'),
    permission: 'library.request',
    service: 'library.service.listMyBookRequests() + cancelBookRequest()',
    summarise: (args, _actor, prepared) =>
      `Withdraw your book request${prepared?.label ? ` for "${prepared.label}"` : ` ${args.requestId ?? ''}`.trimEnd()}`,
    async prepare(ctx, args) {
      if (args.requestId) return { requestId: String(args.requestId) };
      const chosen = await theOnlyPendingRequest(await library.listMyBookRequests(ctx.actor), {
        label: 'book request',
        describe: (r) => `"${r.bookTitle ?? 'a book'}"`,
      });
      return { requestId: String(chosen.id ?? chosen._id), label: chosen.bookTitle ?? null };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const request = await library.cancelBookRequest(ctx.actor, plan.requestId);
      return action({
        type: 'book_request_cancelled',
        id: request.id,
        data: request,
        speak: `Your request for "${request.bookTitle}" has been withdrawn.`,
      });
    },
  },

  cancel_transport_request: {
    module: 'Transport',
    operation: 'DELETE',
    risk: RISK.LOW,
    confirm: true,
    description:
      "Withdraw the caller's own request for a place on a bus route, while the school office has not yet decided on it. A request already granted or refused cannot be withdrawn. With no request id, the caller's single pending request is withdrawn; with several pending, the caller is asked which. Needs confirmation.",
    inputSchema: cancellableSchema('get_my_transport_requests'),
    permission: 'transport.request',
    service: 'transport.service.listMyTransportRequests() + cancelTransportRequest()',
    summarise: (args, _actor, prepared) =>
      `Withdraw your transport request${prepared?.label ? ` for ${prepared.label}` : ` ${args.requestId ?? ''}`.trimEnd()}`,
    async prepare(ctx, args) {
      if (args.requestId) return { requestId: String(args.requestId) };
      const chosen = await theOnlyPendingRequest(await transport.listMyTransportRequests(ctx.actor), {
        label: 'transport request',
        describe: (r) => String(r.routeName ?? 'a route'),
      });
      return { requestId: String(chosen.id ?? chosen._id), label: chosen.routeName ?? null };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const request = await transport.cancelTransportRequest(ctx.actor, plan.requestId);
      return action({
        type: 'transport_request_cancelled',
        id: request.id,
        data: request,
        speak: `Your request for a place on ${request.routeName} has been withdrawn.`,
      });
    },
  },

  cancel_cocurricular_request: {
    module: 'Student requests',
    operation: 'DELETE',
    risk: RISK.LOW,
    confirm: true,
    description:
      "Withdraw the caller's own co-curricular request, while the class teacher has not yet decided on it. A request already approved or rejected cannot be withdrawn. With no request id, the caller's single pending request is withdrawn; with several pending, the caller is asked which. Needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        requestId: objectId('From list_cocurricular. Omit it when you have only one pending request.'),
        // The activity as the student names it -- "my football activity
        // request" -- which is how they refer to it and never by id. It only
        // narrows the caller's OWN pending requests; it cannot reach anybody
        // else's.
        name: { type: 'string', maxLength: 120, description: 'The activity, e.g. "football"' },
      },
      additionalProperties: false,
    },
    permission: 'cocurricular.request',
    service: 'cocurricular.service.listForStudent() + withdraw()',
    summarise: (args, _actor, prepared) =>
      `Withdraw your co-curricular request${prepared?.label ? ` for ${prepared.label}` : ` ${args.requestId ?? ''}`.trimEnd()}`,
    async prepare(ctx, args) {
      if (args.requestId) return { requestId: String(args.requestId) };
      const mine = asList(await cocurricular.listForStudent(ctx.actor, ctx.scope, {}));
      const wanted = args.name ? String(args.name).trim().toLowerCase() : null;
      const narrowed = wanted
        ? mine.filter((r) => String(r.name ?? '').toLowerCase().includes(wanted))
        : mine;
      const chosen = await theOnlyPendingRequest(narrowed, {
        label: wanted ? `co-curricular request for "${args.name}"` : 'co-curricular request',
        describe: (r) => String(r.name ?? 'an activity'),
      });
      return { requestId: String(chosen.id ?? chosen._id), label: chosen.name ?? null };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      await cocurricular.withdraw(ctx.actor, plan.requestId);
      return action({
        type: 'cocurricular_request_cancelled',
        id: plan.requestId,
        data: { requestId: plan.requestId },
        speak: `Your co-curricular request${plan.label ? ` for ${plan.label}` : ''} has been withdrawn.`,
      });
    },
  },

  cancel_profile_edit_request: {
    module: 'Student requests',
    operation: 'DELETE',
    risk: RISK.LOW,
    confirm: true,
    description:
      "Withdraw the caller's own profile-correction request, while it has not yet been decided. A request already approved or rejected cannot be withdrawn. With no request id, the caller's single pending request is withdrawn; with several pending, the caller is asked which. Needs confirmation.",
    inputSchema: cancellableSchema('get_my_profile_edit_requests'),
    permission: 'profile.edit.request',
    service: 'profileEdit.service.listMine() + withdraw()',
    summarise: (args, _actor, prepared) =>
      `Withdraw your profile-correction request${prepared?.label ? ` to ${prepared.label}` : ` ${args.requestId ?? ''}`.trimEnd()}`,
    async prepare(ctx, args) {
      if (args.requestId) return { requestId: String(args.requestId) };
      const chosen = await theOnlyPendingRequest(await profileEdit.listMine(ctx.actor, ctx.scope, {}), {
        label: 'profile-correction request',
        describe: (r) => String(r.field ?? 'a correction'),
      });
      return { requestId: String(chosen.id ?? chosen._id), label: chosen.field ?? null };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      await profileEdit.withdraw(ctx.actor, plan.requestId);
      return action({
        type: 'profile_edit_request_cancelled',
        id: plan.requestId,
        data: { requestId: plan.requestId },
        speak: 'Your profile-correction request has been withdrawn.',
      });
    },
  },

  get_my_profile_edit_requests: {
    module: 'Student requests',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      "The caller's own profile-correction requests and what was decided on each. A parent sees their children's. Read-only.",
    inputSchema: noArgs,
    permission: 'profile.edit.request',
    service: 'profileEdit.service.listMine()',
    resultShape: 'LIST',
    async run(ctx) {
      // The service resolves whose requests these are from the session — a
      // student their own, a parent their children's — so no studentId is
      // passed and none would be honoured.
      const rows = await profileEdit.listMine(ctx.actor, ctx.scope, {});
      const view = summarise(rows, (r) => `${r.field ?? 'a correction'} — ${String(r.status).toLowerCase()}`);
      return ok(
        { requests: rows, count: rows.length },
        {
          speak: rows.length
            ? `${rows.length} profile-correction request(s): ${view.list}.`
            : 'You have no profile-correction requests.',
        },
      );
    },
  },
};
