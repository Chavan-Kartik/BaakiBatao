import { z } from 'zod';

/**
 * Every amount in this system is an integer number of paise.
 *
 * There is no `number` holding money anywhere. `0.1 + 0.2 !== 0.3` is not a bug
 * we are going to ship in a tool that drafts letters to insurers about rupee
 * figures. See the build spec §6.
 */
export const Paise = z.number().int().brand<'Paise'>();
export type Paise = z.infer<typeof Paise>;

/** Validating constructor. Throws on a non-integer. Use at system boundaries. */
export const paise = (n: number): Paise => Paise.parse(n);

/**
 * Non-validating constructor for arithmetic results that are integers by
 * construction. Used inside the engine's hot path where every input has already
 * been validated.
 */
export const unsafePaise = (n: number): Paise => n as Paise;

export const ZERO: Paise = unsafePaise(0);

export const addPaise = (...xs: readonly Paise[]): Paise =>
  unsafePaise(xs.reduce<number>((sum, x) => sum + x, 0));

export const subPaise = (a: Paise, b: Paise): Paise => unsafePaise(a - b);

export const negPaise = (a: Paise): Paise => unsafePaise(-a);

export const absPaise = (a: Paise): Paise => unsafePaise(Math.abs(a));

export const minPaise = (a: Paise, b: Paise): Paise => (a <= b ? a : b);

export const maxPaise = (a: Paise, b: Paise): Paise => (a >= b ? a : b);

export const rupeesToPaise = (rupees: number): Paise => paise(Math.round(rupees * 100));

export const paiseToRupees = (p: Paise): number => p / 100;

/** Indian-format display. `1234567` → `₹12,345.67` */
export const formatInr = (p: Paise): string => {
  const sign = p < 0 ? '-' : '';
  const abs = Math.abs(p);
  const rupees = Math.floor(abs / 100);
  const paisePart = String(abs % 100).padStart(2, '0');
  return `${sign}₹${rupees.toLocaleString('en-IN')}.${paisePart}`;
};

/**
 * Rounding is declared, not incidental.
 *
 * The proportionate-deduction ratio in step 5 is the only place a fraction
 * enters the arithmetic, and `rounding.json` in the rulepack fixes the policy.
 * Any drift surfaces in the reconciliation residual rather than being silently
 * absorbed — see the build spec §6.3.
 */
export const RoundingMode = z.enum(['ROUND_HALF_UP', 'ROUND_HALF_EVEN', 'FLOOR']);
export type RoundingMode = z.infer<typeof RoundingMode>;
