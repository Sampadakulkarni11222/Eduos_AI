import { AppError } from '../../utils/AppError.js';

/**
 * Lab quantities: what people type (g, kg, mg, mL, L, pcs) and what is stored
 * (whole mg, µL or pieces). A conversion never crosses a dimension — grams
 * cannot become millilitres without a density, and the system does not guess
 * one — and a quantity finer than the stored unit is refused rather than
 * silently rounded.
 */
export const UNITS = {
  mg: { base: 'mg', factor: 1 },
  g: { base: 'mg', factor: 1000 },
  kg: { base: 'mg', factor: 1_000_000 },
  uL: { base: 'uL', factor: 1 },
  mL: { base: 'uL', factor: 1000 },
  L: { base: 'uL', factor: 1_000_000 },
  pcs: { base: 'pcs', factor: 1 },
};
const ALIASES = { ml: 'mL', l: 'L', ul: 'uL', 'µl': 'uL', gm: 'g', gms: 'g', grams: 'g', kgs: 'kg', nos: 'pcs', no: 'pcs', pc: 'pcs', pieces: 'pcs', units: 'pcs' };

export function normaliseUnit(unit) {
  const raw = String(unit ?? '').trim();
  const u = UNITS[raw] ? raw : ALIASES[raw.toLowerCase()] ?? (UNITS[raw.toLowerCase()] ? raw.toLowerCase() : null);
  if (!u) throw new AppError(`Unknown unit "${raw}". Use one of ${Object.keys(UNITS).join(', ')}.`, 400, [], 'BAD_UNIT');
  return u;
}

export const baseUnitOf = (unit) => UNITS[normaliseUnit(unit)].base;

/** A typed quantity in `unit` as whole base units of an item stored in `baseUnit`. */
export function toBase(quantity, unit, baseUnit, { allowZero = false, allowNegative = false } = {}) {
  const u = normaliseUnit(unit ?? baseUnit);
  const spec = UNITS[u];
  if (spec.base !== baseUnit) {
    throw new AppError(`This item is measured in ${baseUnit === 'mg' ? 'mass' : baseUnit === 'uL' ? 'volume' : 'pieces'}; ${u} cannot be converted to it.`, 400, [], 'UNIT_MISMATCH');
  }
  const n = typeof quantity === 'number' ? quantity : Number(String(quantity ?? '').replace(/,/g, ''));
  if (!Number.isFinite(n)) throw new AppError('quantity must be a number', 400);
  if (n < 0 && !allowNegative) throw new AppError('quantity cannot be negative', 400);
  if (n === 0 && !allowZero) throw new AppError('quantity must be more than zero', 400);
  const base = n * spec.factor;
  const rounded = Math.round(base);
  if (Math.abs(base - rounded) > 1e-6) throw new AppError(`That is finer than this item is counted in (${spec.base}).`, 400, [], 'TOO_PRECISE');
  if (!Number.isSafeInteger(rounded)) throw new AppError('quantity is too large', 400);
  return rounded;
}

/** Base units back to the item's display unit, for screens and messages. */
export function fromBase(quantity, displayUnit) {
  const u = normaliseUnit(displayUnit);
  return Math.round((quantity / UNITS[u].factor) * 1000) / 1000;
}

export const formatQty = (quantity, displayUnit) => `${fromBase(quantity, displayUnit)} ${normaliseUnit(displayUnit)}`;
