import { numFromEnv } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';

/**
 * What a seat costs. The only place that answers that question.
 *
 * The arithmetic lives here and the *rate* comes from outside it: a school's own
 * per-seat price when the platform has set one (seatPrice.service.js), and the
 * deployment default otherwise. Splitting it that way is what keeps one pricing
 * implementation rather than two — the volume tiers, the rounding and the seat
 * validation are shared by every school whatever it pays per seat.
 *
 * `quoteSeats()` is a pure function of a seat count and a rate. It is called
 * when a request is created and again, against the request's own snapshot, when
 * its order is raised; neither call site reads an amount from a request body, so
 * there is no path by which a client figure can become a charge.
 */

/**
 * The platform's default per-seat price, in paise.
 *
 * What a school pays when the Super Admin has not priced it specifically. A
 * school with its own SeatPrice never reads this.
 */
export const defaultUnitPricePaise = () => numFromEnv('SEAT_UNIT_PRICE_PAISE', 50_000); // ₹500

/** The currency the deployment prices in unless a school is priced otherwise. */
export const DEFAULT_CURRENCY = 'INR';

/** The most seats one request may ask for. A typo should not become a ₹5,00,000 order. */
export const MAX_SEATS_PER_REQUEST = 5_000;

/**
 * The most a single seat may be priced at, in paise.
 *
 * A bound rather than a business rule: the difference between ₹100 and ₹100,000
 * a seat is one keystroke, and the request that results is a real charge. The
 * ceiling is deliberately far above any plausible price.
 */
export const MAX_UNIT_PRICE_PAISE = 10_000_000; // ₹1,00,000 a seat

/**
 * Volume discounts, largest threshold first.
 *
 * Platform policy, applied on top of whatever the school's per-seat rate is: a
 * school priced at ₹120 a seat gets the same 5% over a hundred seats as one
 * priced at ₹90. A discount is a percentage off the whole order, applied to the
 * gross in paise and rounded down — rounding a charge up in the seller's favour
 * is the kind of detail that erodes trust in the number.
 */
const TIERS = [
  { minSeats: 500, discountPct: 10 },
  { minSeats: 100, discountPct: 5 },
];

export const PRICE_LIST_VERSION = '2026-09-01';

/** The integer seat count in `value`, or a 400 explaining why it is not one. */
export function parseSeatCount(value) {
  const seats = Number(value);
  if (!Number.isInteger(seats) || seats <= 0) {
    throw new AppError('seats must be a whole number greater than zero', 400, [], 'INVALID_SEAT_COUNT');
  }
  if (seats > MAX_SEATS_PER_REQUEST) {
    throw new AppError(
      `A single request may ask for at most ${MAX_SEATS_PER_REQUEST} seats`,
      400, [], 'SEAT_COUNT_TOO_LARGE',
    );
  }
  return seats;
}

/**
 * The per-seat price in `value`, or a 400 explaining why it is not one.
 *
 * Zero is refused, and that is a rule inherited rather than invented: a seat
 * request is settled through the payment gateway, and `createGatewayOrder()`
 * rejects a non-positive amount outright — a ₹0 order cannot be created, so a
 * ₹0 price would produce a request nobody could ever pay and therefore one no
 * Super Admin could ever approve. Free seats already have a supported route:
 * the platform grants them directly with `grantSeats()`, which takes no
 * payment at all.
 */
export function parseUnitPrice(value) {
  const paise = Number(value);
  if (!Number.isFinite(paise) || !Number.isInteger(paise)) {
    throw new AppError('unitPricePaise must be a whole number of paise', 400, [], 'INVALID_SEAT_PRICE');
  }
  if (paise < 0) {
    throw new AppError('A per-seat price cannot be negative', 400, [], 'INVALID_SEAT_PRICE');
  }
  if (paise === 0) {
    throw new AppError(
      'A per-seat price of zero is not supported: a zero-amount order cannot be raised with the payment gateway. ' +
        'Grant the school seats directly instead.',
      400, [], 'ZERO_SEAT_PRICE',
    );
  }
  if (paise > MAX_UNIT_PRICE_PAISE) {
    throw new AppError(
      `A per-seat price may be at most ${MAX_UNIT_PRICE_PAISE} paise`,
      400, [], 'SEAT_PRICE_TOO_LARGE',
    );
  }
  return paise;
}

/** The ISO 4217 code in `value`, uppercased, or a 400. */
export function parseCurrency(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_CURRENCY;
  const code = String(value).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new AppError('currency must be a three-letter ISO 4217 code, e.g. INR', 400, [], 'INVALID_CURRENCY');
  }
  return code;
}

/**
 * The price of `seats` seats at a given rate, computed here and nowhere else.
 *
 * @param {number} seats  validated by parseSeatCount()
 * @param {object} [rate] { unitPricePaise, currency } — the school's price, or
 *                        the platform default when the school has none.
 * @returns {{seats, unitPricePaise, grossPaise, discountPct, discountPaise, amountPaise, currency, priceListVersion}}
 */
export function quoteSeats(seats, rate = {}) {
  const count = parseSeatCount(seats);
  const unit = parseUnitPrice(rate.unitPricePaise ?? defaultUnitPricePaise());
  const currency = parseCurrency(rate.currency);

  const grossPaise = count * unit;
  const discountPct = TIERS.find((t) => count >= t.minSeats)?.discountPct ?? 0;
  const discountPaise = Math.floor((grossPaise * discountPct) / 100);

  return {
    seats: count,
    unitPricePaise: unit,
    grossPaise,
    discountPct,
    discountPaise,
    amountPaise: grossPaise - discountPaise,
    currency,
    priceListVersion: PRICE_LIST_VERSION,
  };
}

/**
 * The price list as a screen should show it, at whatever rate applies.
 *
 * Takes the same `rate` as quoteSeats(), so a School Admin's seat page quotes
 * their own school's price rather than the platform's.
 */
export function priceList(rate = {}) {
  return {
    unitPricePaise: parseUnitPrice(rate.unitPricePaise ?? defaultUnitPricePaise()),
    currency: parseCurrency(rate.currency),
    source: rate.source ?? 'PLATFORM_DEFAULT',
    maxSeatsPerRequest: MAX_SEATS_PER_REQUEST,
    tiers: TIERS.map((t) => ({ ...t })),
    version: PRICE_LIST_VERSION,
  };
}
