import * as library from '../../../library/library.service.js';
import * as transport from '../../../transport/transport.service.js';
import { ok, action } from '../protocol.js';
import { RISK, objectId, dateStr, noArgs, summarise } from './_shared.js';

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
const asList = (rows) => (Array.isArray(rows) ? rows : (rows?.items ?? []));
const rupees = (paise) => `₹${(Number(paise ?? 0) / 100).toLocaleString('en-IN')}`;

export const requestTools = {
  /* ── Library: asking for a book ──────────────────────── */

  request_book: {
    module: 'Library',
    operation: 'CREATE',
    risk: RISK.LOW,
    description:
      "Ask the library to issue a book to the caller. The book must be a physical copy in this school's catalogue — an online resource is read where it lives and cannot be issued. The request goes to the librarian and changes nothing until it is approved, so it runs without confirmation. Use list_books to find the book id.",
    inputSchema: {
      type: 'object',
      properties: { bookId: objectId('From list_books') },
      required: ['bookId'],
      additionalProperties: false,
    },
    permission: 'library.request',
    service: 'library.service.requestBook()',
    summarise: (args) => `Ask the library to issue book ${args.bookId} to you`,
    async run(ctx, args) {
      const request = await library.requestBook(ctx.actor, args.bookId);
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
      'Approve or reject a book request. Approving issues the book to the student and takes a copy off the shelf; if no copy is free the approval is refused and the request stays waiting. Use get_book_requests to find the request id. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        requestId: objectId('From get_book_requests'),
        status: { type: 'string', enum: DECISIONS },
        note: { type: 'string', maxLength: 500, description: 'Shown to the student with the decision' },
        dueAt: dateStr('When the book is due back; defaults to a fortnight from today'),
      },
      required: ['requestId', 'status'],
      additionalProperties: false,
    },
    permission: 'library.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'library.service.decideBookRequest()',
    summarise: (args) =>
      `${args.status === 'APPROVED' ? 'Approve' : 'Reject'} book request ${args.requestId}` +
      `${args.status === 'APPROVED' ? ' — this issues the book' : ''}`,
    async run(ctx, args) {
      const result = await library.decideBookRequest(ctx.actor, args.requestId, {
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
      'Ask for a place on a bus route, from a particular stop. The stop must be one on that route. The request goes to the school office and changes nothing until it is approved — the fare is only charged once a place is granted, so it runs without confirmation. Use get_transport_routes to find the route and stop ids.',
    inputSchema: {
      type: 'object',
      properties: {
        routeId: objectId('From get_transport_routes'),
        stopId: objectId('A stop on that route'),
        direction: {
          type: 'string',
          enum: ['BOTH', 'PICKUP', 'DROP'],
          description: 'Both ways by default',
        },
      },
      required: ['routeId', 'stopId'],
      additionalProperties: false,
    },
    permission: 'transport.request',
    service: 'transport.service.requestRoute()',
    summarise: (args) => `Ask for a place on route ${args.routeId}`,
    async run(ctx, args) {
      const request = await transport.requestRoute(ctx.actor, {
        routeId: args.routeId,
        stopId: args.stopId,
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
        requestId: objectId('From get_transport_requests'),
        status: { type: 'string', enum: DECISIONS },
        note: { type: 'string', maxLength: 500, description: 'Shown to the student with the decision' },
      },
      required: ['requestId', 'status'],
      additionalProperties: false,
    },
    permission: 'transport.manage',
    minScope: 'ALL',
    affectsOthers: true,
    service: 'transport.service.decideTransportRequest()',
    summarise: (args) =>
      `${args.status === 'APPROVED' ? 'Approve' : 'Reject'} transport request ${args.requestId}` +
      `${args.status === 'APPROVED' ? ' — this grants the place and bills the fare' : ''}`,
    async run(ctx, args) {
      const result = await transport.decideTransportRequest(ctx.actor, args.requestId, {
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
};
