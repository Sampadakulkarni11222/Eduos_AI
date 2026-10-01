import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { runWithTenant } from '../../tenancy/tenantContext.js';
import * as service from './seat.service.js';
import * as pricing from './seatPrice.service.js';

/**
 * Seats over HTTP.
 *
 * Nothing here decides anything: every rule lives in seat.service.js, so the
 * REST routes and the MCP tools apply one set of them. The only thing these
 * handlers add is the tenant context a platform-level call needs — a Super
 * Admin naming a school in the path is the one caller whose school is not
 * already pinned by middleware/auth.js.
 */

export const getSummary = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.getSeatSummary(), 'Seat summary fetched');
});

export const getHistory = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.listSeatHistory(req.query), 'Seat history fetched');
});

export const listRequests = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.listSeatRequests(req.query), 'Seat requests fetched');
});

export const getRequest = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.getSeatRequest(req.params.id), 'Seat request fetched');
});

export const createRequest = asyncHandler(async (req, res) => {
  // Only `seats` and `reason` are read. The price comes from the server's own
  // price list — see seat.pricing.js.
  const request = await service.createSeatRequest(req.actor, {
    seats: req.body?.seats,
    reason: req.body?.reason,
  });
  sendSuccess(res, request, 'Extra seat request created', 201);
});

export const payRequest = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.startSeatPayment(req.actor, req.params.id), 'Seat payment started');
});

export const verifyPayment = asyncHandler(async (req, res) => {
  const result = await service.verifySeatCheckout(req.actor, {
    orderId: req.body?.orderId,
    paymentId: req.body?.paymentId,
    signature: req.body?.signature,
  });
  sendSuccess(res, result, 'Seat payment verified');
});

/* ── Platform ─────────────────────────────────────────────── */

export const listSchoolSeats = asyncHandler(async (_req, res) => {
  sendSuccess(res, await service.listSchoolSeatSummaries(), 'School seat summaries fetched');
});

/**
 * One school's seats, read by the platform.
 *
 * Re-enters that school's tenant context, so the counts come from the same
 * queries its own admin would run rather than from a hand-written filter.
 */
export const getSchoolSeats = asyncHandler(async (req, res) => {
  const slug = String(req.params.tenantId ?? '').trim().toLowerCase();
  const summary = await runWithTenant(slug, () => service.getSeatSummary());
  sendSuccess(res, summary, 'Seat summary fetched');
});

export const getSchoolSeatHistory = asyncHandler(async (req, res) => {
  const slug = String(req.params.tenantId ?? '').trim().toLowerCase();
  const history = await runWithTenant(slug, () => service.listSeatHistory(req.query));
  sendSuccess(res, history, 'Seat history fetched');
});

export const grantSchoolSeats = asyncHandler(async (req, res) => {
  const summary = await service.grantSeats(req.actor, req.params.tenantId, {
    seats: req.body?.seats,
    note: req.body?.note,
    event: req.body?.event,
  });
  sendSuccess(res, summary, 'Seats granted');
});

export const decideRequest = asyncHandler(async (req, res) => {
  const decided = await service.decideSeatRequest(req.actor, req.params.id, {
    decision: req.body?.decision,
    note: req.body?.note,
  });
  sendSuccess(res, decided, `Seat request ${decided.status.toLowerCase()}`);
});

/* ── Per-seat pricing (Super Admin) ───────────────────────── */
//
// Reading a price is part of `seats.read`, because a School Admin has to see
// what a seat costs before asking for one. Changing it is
// `seats.pricing.manage`, which is Super-Admin-only.

export const listSchoolPrices = asyncHandler(async (_req, res) => {
  sendSuccess(res, await pricing.listSchoolSeatPrices(), 'School seat prices fetched');
});

export const getSchoolPrice = asyncHandler(async (req, res) => {
  sendSuccess(res, await pricing.seatPriceList(req.params.tenantId), 'Seat price fetched');
});

export const getSchoolPriceHistory = asyncHandler(async (req, res) => {
  sendSuccess(res, await pricing.listSeatPrices(req.params.tenantId, req.query), 'Seat price history fetched');
});

export const setSchoolPrice = asyncHandler(async (req, res) => {
  const price = await pricing.setSeatPrice(req.actor, req.params.tenantId, {
    unitPricePaise: req.body?.unitPricePaise,
    currency: req.body?.currency,
    effectiveFrom: req.body?.effectiveFrom,
    note: req.body?.note,
  });
  sendSuccess(res, price, 'Seat price set', 201);
});

export const updatePrice = asyncHandler(async (req, res) => {
  const price = await pricing.updateSeatPrice(req.actor, req.params.priceId, {
    status: req.body?.status,
    note: req.body?.note,
  });
  sendSuccess(res, price, 'Seat price updated');
});

/** The acting school's own price — what the School Admin's seat page quotes. */
export const getMyPrice = asyncHandler(async (_req, res) => {
  sendSuccess(res, await pricing.seatPriceList(), 'Seat price fetched');
});

/** The acting school's own pricing history. */
export const getMyPriceHistory = asyncHandler(async (req, res) => {
  sendSuccess(res, await pricing.listSeatPrices(undefined, req.query), 'Seat price history fetched');
});
