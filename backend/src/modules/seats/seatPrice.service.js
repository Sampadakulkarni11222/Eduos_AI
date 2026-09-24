import { SeatPrice } from '../../models/seat.model.js';
import { School } from '../../models/school.model.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import { recordAudit } from '../../utils/auditTrail.js';
import { runInTransaction } from '../../utils/transaction.js';
import { currentTenantId, runWithTenant } from '../../tenancy/tenantContext.js';
import {
  parseUnitPrice, parseCurrency, defaultUnitPricePaise, DEFAULT_CURRENCY, priceList,
} from './seat.pricing.js';

/**
 * Per-school seat pricing: School A at ₹100 a seat, School B at ₹120, School C
 * at ₹90.
 *
 * A price is a VERSION, never a field that gets overwritten. Setting a new one
 * closes the old one and inserts a successor, so the row that priced a paid
 * request is still there, still saying what it said. That is what makes
 * "changing the price must not modify historical payments" true by
 * construction rather than by everybody remembering to snapshot — although the
 * request snapshots the figures as well (see seat.model.js), because two
 * independent guarantees is the right number for money.
 *
 * Resolution is a query, not a scheduler: the price in force at an instant is
 * the newest ACTIVE version whose effective window contains it. A school with
 * no version resolves to the platform default, which is why a deployment that
 * prices every school the same needs no records at all.
 *
 * Authority: every write here is reached only through `seats.pricing.manage`,
 * which is in SUPER_ADMIN_ONLY — so a School Admin cannot change what their own
 * school pays, and cannot be granted the ability through the roles API either
 * (roles/role.service.js refuses those keys).
 */

/**
 * The school this call may act on.
 *
 * Only a caller who is NOT already inside a school may name one. For everybody
 * else the acting school wins and a different slug is refused outright — it
 * must not be honoured, because these functions re-enter the named school's
 * tenant context to read it, and a slug that could do that would be a way for
 * one school to read another's prices by asking nicely.
 *
 * Refused as a 404 rather than a 403: whether some other school exists is not
 * this caller's business either.
 */
function schoolOf(slug) {
  const acting = currentTenantId();
  const named = String(slug ?? '').trim().toLowerCase();

  if (acting) {
    if (named && named !== acting) {
      throw new AppError(`No school with id "${named}"`, 404, [], 'SCHOOL_NOT_FOUND');
    }
    return acting;
  }
  if (!named) throw new AppError('Name the school to price.', 400, [], 'SCHOOL_REQUIRED');
  return named;
}

async function assertSchoolExists(slug) {
  const school = await School.findOne({ slug }).lean();
  if (!school) throw new AppError(`No school with id "${slug}"`, 404, [], 'SCHOOL_NOT_FOUND');
  return school;
}

export const seatPriceDto = (p) => ({
  id: p._id.toString(),
  tenantId: p.tenantId,
  unitPricePaise: p.unitPricePaise,
  currency: p.currency,
  status: p.status,
  effectiveFrom: p.effectiveFrom,
  effectiveTo: p.effectiveTo ?? null,
  supersededByPriceId: p.supersededByPriceId ? p.supersededByPriceId.toString() : null,
  note: p.note ?? null,
  setBy: p.setByName ?? null,
  deactivatedBy: p.deactivatedByName ?? null,
  deactivatedAt: p.deactivatedAt ?? null,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

/**
 * The price in force for a school at an instant, or the platform default.
 *
 * The single answer to "what does a seat cost here", used by every quote. It
 * returns a rate rather than a record, so callers cannot accidentally depend on
 * a price document that may later be superseded or deactivated.
 *
 * @returns {{unitPricePaise, currency, source: 'SCHOOL'|'PLATFORM_DEFAULT', seatPriceId: string|null}}
 */
export async function resolveSeatPrice(slug, at = new Date()) {
  const tenantId = schoolOf(slug);

  const price = await runWithTenant(tenantId, () =>
    SeatPrice.findOne({
      tenantId,
      status: 'ACTIVE',
      effectiveFrom: { $lte: at },
      $or: [{ effectiveTo: null }, { effectiveTo: { $gt: at } }],
    })
      .sort({ effectiveFrom: -1 })
      .lean(),
  );

  if (!price) {
    return {
      unitPricePaise: defaultUnitPricePaise(),
      currency: DEFAULT_CURRENCY,
      source: 'PLATFORM_DEFAULT',
      seatPriceId: null,
    };
  }
  return {
    unitPricePaise: price.unitPricePaise,
    currency: price.currency,
    source: 'SCHOOL',
    seatPriceId: price._id.toString(),
  };
}

/** The resolved rate, shaped as the price list a screen shows. */
export async function seatPriceList(slug, at = new Date()) {
  const rate = await resolveSeatPrice(slug, at);
  return { ...priceList(rate), seatPriceId: rate.seatPriceId };
}

/**
 * Every version of one school's price, newest first — the pricing history.
 *
 * Includes superseded and deactivated versions, which is the point: the history
 * exists to explain a charge that a current price no longer accounts for.
 */
export async function listSeatPrices(slug, { limit } = {}) {
  const tenantId = schoolOf(slug);
  const requested = Number(limit);
  const take = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 200) : 50;

  const rows = await runWithTenant(tenantId, () =>
    SeatPrice.find({ tenantId }).sort({ effectiveFrom: -1, createdAt: -1 }).limit(take).lean(),
  );
  return rows.map(seatPriceDto);
}

/** One version, for a screen that has drilled into it. */
export async function getSeatPrice(priceId) {
  const price = await SeatPrice.findById(priceId).lean();
  if (!price) throw new AppError('Seat price not found', 404, [], 'SEAT_PRICE_NOT_FOUND');
  return seatPriceDto(price);
}

/**
 * Every school's current rate — the pricing management table.
 *
 * A school with no version of its own is reported at the platform default with
 * `source: 'PLATFORM_DEFAULT'`, rather than omitted: "not priced specifically"
 * is a state the Super Admin needs to see, not an absence.
 */
export async function listSchoolSeatPrices() {
  const schools = await School.find().sort({ slug: 1 }).lean();
  return Promise.all(
    schools.map(async (school) => {
      const rate = await resolveSeatPrice(school.slug);
      const versions = await runWithTenant(school.slug, () =>
        SeatPrice.countDocuments({ tenantId: school.slug }),
      );
      return {
        tenantId: school.slug,
        tenantName: school.name,
        status: school.status,
        unitPricePaise: rate.unitPricePaise,
        currency: rate.currency,
        source: rate.source,
        seatPriceId: rate.seatPriceId,
        versionCount: versions,
      };
    }),
  );
}

/**
 * Sets a school's per-seat price, as a new version.
 *
 * This is both "set the price" and "change the price": there is deliberately no
 * operation that edits an amount in place. A rise from ₹100 to ₹120 closes the
 * ₹100 version at the moment the ₹120 one begins, and both rows remain — so the
 * request that was quoted ₹100 can still be explained by a row that says ₹100.
 *
 * `effectiveFrom` may be dated into the future, which schedules the change
 * without needing a scheduler: resolution compares against the clock at read
 * time. It may NOT be dated into the past — backdating would claim to change
 * what was charged for requests already quoted, which is the one thing this
 * design exists to prevent.
 *
 * Concurrency: a school has at most one open-ended version, and this is what
 * maintains that. The supersede is an atomic claim on the version being closed,
 * a set that arrives behind a version already standing at or after its own
 * instant is refused, and the unique index on (tenantId, effectiveFrom) catches
 * two beginning at the very same moment. Two Super Admins repricing a school at
 * once therefore produce one new price and one 409, never two live prices.
 */
export async function setSeatPrice(actor, slug, { unitPricePaise, currency, effectiveFrom, note } = {}) {
  const tenantId = schoolOf(slug);
  await assertSchoolExists(tenantId);

  const price = parseUnitPrice(unitPricePaise);
  const code = parseCurrency(currency);
  const trimmedNote = note === undefined || note === null ? null : String(note).trim().slice(0, 500) || null;

  const now = new Date();
  let from = now;
  if (effectiveFrom !== undefined && effectiveFrom !== null && effectiveFrom !== '') {
    from = new Date(effectiveFrom);
    if (Number.isNaN(from.getTime())) {
      throw new AppError('effectiveFrom must be a date', 400, [], 'INVALID_EFFECTIVE_FROM');
    }
    // A minute of slack, so a clock skew between the browser and the server
    // does not reject a price the operator meant to take effect now.
    if (from.getTime() < now.getTime() - 60_000) {
      throw new AppError(
        'effectiveFrom cannot be in the past: a price change cannot alter what has already been quoted.',
        400, [], 'EFFECTIVE_FROM_IN_PAST',
      );
    }
  }

  const created = await runWithTenant(tenantId, () =>
    runInTransaction(async (session) => {
      // The version this one replaces: the open-ended one, of which there is at
      // most one per school and this transaction is what keeps that true.
      //
      // Read without an `effectiveFrom` bound on purpose. Bounding it to
      // versions that had already begun looked right and was not: concurrent
      // repricings are assigned their instants when they are called and commit
      // in whatever order the database serialises them, so a call with an
      // EARLIER instant can commit last, match nothing, and insert a second
      // open-ended version beside the one that won. Reading the open version
      // whatever its date is what makes that case visible.
      const current = await SeatPrice.findOne({ tenantId, effectiveTo: null })
        .sort({ effectiveFrom: -1 })
        .session(session ?? null)
        .lean();

      if (current && current.effectiveFrom.getTime() >= from.getTime()) {
        // A price already stands at or after this one's start. Inserting behind
        // it would either backdate a change or leave two open versions racing
        // to be "current", so it is refused and the operator is told which.
        throw new AppError(
          current.effectiveFrom.getTime() > Date.now()
            ? 'A later price change is already scheduled for this school. Deactivate it before setting another.'
            : 'This school was repriced by someone else a moment ago. Read the current price and try again.',
          409, [], 'SEAT_PRICE_CONFLICT',
        );
      }

      const [next] = await SeatPrice.create(
        [{
          tenantId,
          unitPricePaise: price,
          currency: code,
          status: 'ACTIVE',
          effectiveFrom: from,
          effectiveTo: null,
          note: trimmedNote,
          setByProfileId: actor?.profileId ?? null,
          setByName: actor?.displayName ?? null,
        }],
        session ? { session } : {},
      );

      if (current) {
        // Atomic claim: only the writer that finds it still open closes it. A
        // concurrent reprice that got there first leaves nothing to close, and
        // the unique index has already refused an identical start instant.
        const closed = await SeatPrice.findOneAndUpdate(
          { _id: current._id, effectiveTo: null },
          { $set: { effectiveTo: from, supersededByPriceId: next._id } },
          { new: true, ...(session ? { session } : {}) },
        );
        if (!closed) {
          throw new AppError(
            'This school was repriced by someone else a moment ago. Read the current price and try again.',
            409, [], 'SEAT_PRICE_CONFLICT',
          );
        }
      }

      return { current, next };
    }),
  ).catch((err) => {
    // The unique index on (tenantId, effectiveFrom) — two versions starting at
    // the same instant, which is what a genuine race looks like.
    if (err?.code === 11000) {
      throw new AppError(
        'This school was repriced by someone else at the same moment. Read the current price and try again.',
        409, [], 'SEAT_PRICE_CONFLICT',
      );
    }
    throw err;
  });

  await recordAudit({
    actor,
    action: 'seats.price.set',
    entityType: 'SeatPrice',
    entityId: created.next._id,
    before: created.current
      ? { tenantId, unitPricePaise: created.current.unitPricePaise, currency: created.current.currency }
      : { tenantId, unitPricePaise: defaultUnitPricePaise(), currency: DEFAULT_CURRENCY, source: 'PLATFORM_DEFAULT' },
    after: {
      tenantId, unitPricePaise: price, currency: code,
      effectiveFrom: from.toISOString(), note: trimmedNote,
    },
  });

  logger.info(`Seat price for ${tenantId} set to ${price} ${code} per seat, effective ${from.toISOString()}`);

  return seatPriceDto(created.next.toObject());
}

/**
 * Deactivates or reactivates a price version, and edits its note.
 *
 * The only in-place edit there is, and deliberately so: it changes whether a
 * version is *resolvable*, never what it charged. A deactivated version still
 * explains the requests it priced; the school simply falls back to whatever
 * else resolves — an earlier open version, or the platform default.
 */
export async function updateSeatPrice(actor, priceId, { status, note } = {}) {
  const existing = await SeatPrice.findById(priceId).lean();
  if (!existing) throw new AppError('Seat price not found', 404, [], 'SEAT_PRICE_NOT_FOUND');

  const updates = {};
  if (status !== undefined) {
    const wanted = String(status).trim().toUpperCase();
    if (!['ACTIVE', 'INACTIVE'].includes(wanted)) {
      throw new AppError('status must be ACTIVE or INACTIVE', 400, [], 'INVALID_SEAT_PRICE_STATUS');
    }
    updates.status = wanted;
    updates.deactivatedAt = wanted === 'INACTIVE' ? new Date() : null;
    updates.deactivatedByName = wanted === 'INACTIVE' ? (actor?.displayName ?? null) : null;
  }
  if (note !== undefined) {
    updates.note = note === null ? null : String(note).trim().slice(0, 500) || null;
  }
  if (!Object.keys(updates).length) throw new AppError('Nothing to update', 400);

  // Claimed on the status it was read at, so two administrators toggling the
  // same version at once produce one change and one 409 rather than a silent
  // last-writer-wins.
  const updated = await runWithTenant(existing.tenantId, () =>
    SeatPrice.findOneAndUpdate(
      { _id: existing._id, status: existing.status },
      { $set: updates },
      { new: true },
    ),
  );
  if (!updated) {
    throw new AppError(
      'This price was changed by someone else a moment ago. Read it again and retry.',
      409, [], 'SEAT_PRICE_CONFLICT',
    );
  }

  await recordAudit({
    actor,
    action: updates.status === 'INACTIVE' ? 'seats.price.deactivated' : 'seats.price.updated',
    entityType: 'SeatPrice',
    entityId: updated._id,
    before: { tenantId: existing.tenantId, status: existing.status, note: existing.note ?? null },
    after: {
      tenantId: updated.tenantId, status: updated.status, note: updated.note ?? null,
      unitPricePaise: updated.unitPricePaise, currency: updated.currency,
    },
  });

  return seatPriceDto(updated.toObject());
}
