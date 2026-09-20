import type { Paise, RoundingMode } from '@fc/contracts';
import { unsafePaise } from '@fc/contracts';

/**
 * Integer-only ratio application.
 *
 * The proportionate-deduction ratio in step 5 is the only place a fraction
 * enters the arithmetic. Rounding is declared by the rulepack rather than being
 * whatever the floating-point unit happened to do, and any drift surfaces in
 * the reconciliation residual instead of being silently absorbed.
 * See build spec §6.2.
 */
export const applyRatio = (
  amount: Paise,
  numerator: number,
  denominator: number,
  mode: RoundingMode = 'ROUND_HALF_UP',
): Paise => {
  if (denominator === 0) throw new RangeError('applyRatio: zero denominator');
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) {
    throw new RangeError('applyRatio: non-finite ratio');
  }

  const scaled = amount * numerator;
  switch (mode) {
    case 'FLOOR':
      return unsafePaise(Math.floor(scaled / denominator));
    case 'ROUND_HALF_EVEN': {
      const q = scaled / denominator;
      const floor = Math.floor(q);
      const diff = q - floor;
      if (diff > 0.5) return unsafePaise(floor + 1);
      if (diff < 0.5) return unsafePaise(floor);
      return unsafePaise(floor % 2 === 0 ? floor : floor + 1);
    }
    case 'ROUND_HALF_UP':
    default:
      return unsafePaise(Math.floor((scaled + denominator / 2) / denominator));
  }
};

/**
 * The proportionate-deduction ratio itself: the share of an eligible expense
 * that survives. Capped at 1 — occupying a room *below* your entitlement never
 * increases what you are paid.
 */
export const survivingShare = (
  eligibleRoomRentCap: Paise,
  actualRoomRentPerDay: Paise,
): { numerator: number; denominator: number } => {
  if (actualRoomRentPerDay <= 0) return { numerator: 1, denominator: 1 };
  if (eligibleRoomRentCap >= actualRoomRentPerDay) return { numerator: 1, denominator: 1 };
  return { numerator: eligibleRoomRentCap, denominator: actualRoomRentPerDay };
};

export const percentOf = (
  amount: Paise,
  percent: number,
  mode: RoundingMode = 'ROUND_HALF_UP',
): Paise => applyRatio(amount, percent, 100, mode);
