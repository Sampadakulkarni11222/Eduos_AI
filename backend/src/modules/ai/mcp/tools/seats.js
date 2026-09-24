import * as seatService from '../../../seats/seat.service.js';
import { ok, action } from '../protocol.js';
import { RISK, rupees, shortDate, summarise } from './_shared.js';

/**
 * Seats: how many people a school may have, and how it asks for more.
 *
 * Two tools, and the pair is deliberately lopsided.
 *
 * A School Admin can ask the assistant where their school stands and can raise
 * a request for more seats — both are things they already do on the seat page,
 * through the same service, so the screen and the assistant cannot drift apart.
 *
 * What is NOT here is the decision. Approving a paid request is a platform act
 * held by SUPER_ADMIN, and SUPER_ADMIN is the one role deliberately withheld
 * `ai.copilot.use` (see constants/permissions.js), so it has no assistant to
 * expose it through. Adding an approval tool would mean either granting the
 * platform role an assistant that can answer across schools, or granting a
 * school-level role the authority to release its own seats. Both are the thing
 * this feature exists to prevent, so the decision stays on the console.
 *
 * Payment is likewise absent, for the reason record_payment's neighbours give:
 * a gateway checkout returns an order id and a key that only a browser SDK can
 * consume, and writing that into a chat transcript is not a payment flow. The
 * request this tool raises is picked up and paid for on the seat page.
 *
 * Per-seat PRICING adds no tool either, for both halves of the same reason.
 * Setting what a school pays is `seats.pricing.manage`, another Super-Admin-only
 * key, so it has no assistant to be exposed through. And reading the rate needs
 * no tool of its own: get_seat_summary already carries the price in force for
 * the caller's school, resolved by the same function that prices a real
 * request — so the assistant quotes the figure the school will actually be
 * charged rather than a second opinion about it.
 */

export const seatTools = {
  get_seat_summary: {
    module: 'Seats',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      "How many seats this school has bought, how many the platform has approved for use, how many are in use and how many are free. Also reports the school's own per-seat price — what extra seats would cost it — and seats that are paid for but still waiting for platform approval, which cannot be used yet. Read-only.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    permission: 'seats.read',
    minScope: 'ALL',
    service: 'seat.service.getSeatSummary()',
    // A figure about the school, not the rows behind it — the same shape
    // get_attendance_statistics declares, and what makes "how many seats do we
    // have left" resolve here rather than to the request list.
    resultShape: 'SUMMARY',
    async run() {
      const summary = await seatService.getSeatSummary();
      const waiting = summary.awaitingApprovalSeats
        ? ` ${summary.awaitingApprovalSeats} more are paid for and waiting for platform approval, so they cannot be used yet.`
        : '';
      // The rate this school is actually priced at, so "what would ten more
      // seats cost?" is answered with its own figure and not the platform's.
      const rate = summary.priceList?.unitPricePaise
        ? ` Extra seats are priced at ${rupees(summary.priceList.unitPricePaise)} each for this school.`
        : '';
      return ok(summary, {
        speak:
          `${summary.usedSeats} of ${summary.approvedSeats} approved seats are in use, ` +
          `leaving ${summary.availableSeats} free.${waiting}${rate}`,
      });
    },
  },

  get_seat_requests: {
    module: 'Seats',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      "This school's extra-seat requests and where each one has got to: awaiting payment, paid and waiting for the platform to decide, approved, or rejected. Read-only.",
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['PENDING_PAYMENT', 'PAID', 'APPROVED', 'REJECTED'],
          description: 'Narrow to one stage of the request lifecycle',
        },
      },
      additionalProperties: false,
    },
    permission: 'seats.read',
    minScope: 'ALL',
    service: 'seat.service.listSeatRequests()',
    resultShape: 'LIST',
    async run(_ctx, args) {
      const rows = await seatService.listSeatRequests({ status: args?.status });
      const view = summarise(rows, (r) => `${r.seats} seats — ${r.status.toLowerCase().replace(/_/g, ' ')} (${shortDate(r.createdAt)})`);
      return ok(
        { requests: rows, count: rows.length },
        {
          speak: rows.length
            ? `${rows.length} extra-seat request(s): ${view.list}.`
            : 'This school has not asked for any extra seats.',
        },
      );
    },
  },

  request_extra_seats: {
    module: 'Seats',
    operation: 'CREATE',
    risk: RISK.HIGH,
    // Confirmed without exception: the request carries a price, and a person
    // should see that price before it is raised in their name.
    confirm: true,
    description:
      "Ask the platform for extra seats for this school. The price is calculated by the server from the seat count and this school's own per-seat rate — it cannot be set here. Raising the request allocates nothing: it has to be paid for on the seat page and then approved by the platform before the seats can be used.",
    inputSchema: {
      type: 'object',
      properties: {
        seats: { type: 'integer', minimum: 1, maximum: 5000, description: 'How many extra seats to ask for' },
        reason: { type: 'string', maxLength: 500, description: 'Why the school needs them' },
      },
      required: ['seats'],
      additionalProperties: false,
    },
    permission: 'seats.request',
    minScope: 'ALL',
    service: 'seat.service.createSeatRequest()',
    summarise: (args) => `Ask the platform for ${args.seats} extra seats for this school`,
    async run(ctx, args) {
      const request = await seatService.createSeatRequest(ctx.actor, {
        seats: args.seats,
        reason: args.reason,
      });
      return action({
        type: 'extra_seats_requested',
        id: request.id,
        data: request,
        speak:
          `Requested ${request.seats} extra seats at ${rupees(request.unitPricePaise)} a seat — ` +
          `${rupees(request.amountPaise)} in total. ` +
          'Pay for it on the seat page; the seats become usable once the platform approves the request.',
      });
    },
  },
};
