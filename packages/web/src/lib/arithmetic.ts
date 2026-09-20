import type { Arithmetic } from '@fc/contracts';
import { inr } from './format';

/**
 * The engine writes its arithmetic for a machine: amounts are integers of
 * paise, because that is the only unit it is allowed to think in. A person
 * reading "Room rent capped at 500000 paise/day × 3 days" learns nothing they
 * could check.
 *
 * This module does the one safe translation there is. It does not parse the
 * expression — it substitutes the exact integers the engine already handed us
 * in `inputs`, so a number only becomes rupees when the engine itself called
 * that number an amount. Everything else (days, months, percentages,
 * confidences) is left alone.
 */

/** Input keys whose value is a quantity of paise. Everything else is a count. */
const PAISE_KEYS: ReadonlySet<string> = new Set([
  'perDay',
  'cap',
  'claimed',
  'lawfulCut',
  'insurerDeducted',
  'insurerApplied',
  'allowed',
  'eligibleCap',
  'actualRate',
  'deductible',
  'base',
  'balanceBefore',
  'payable',
  'ceiling',
  'observedDelta',
  'attributedDelta',
]);

const LABEL: Record<string, string> = {
  perDay: 'Daily cap in the schedule',
  days: 'Days billed',
  cap: 'Cap in the schedule',
  claimed: 'Charged by the hospital',
  lawfulCut: 'Lawful to withhold',
  insurerDeducted: 'Withheld by the insurer',
  insurerApplied: 'Applied by the insurer',
  allowed: 'Allowed into this step',
  eligibleCap: 'Room rate the policy allows',
  actualRate: 'Room rate actually charged',
  deductible: 'Deductible on the schedule',
  copayPercent: 'Co-pay on the schedule',
  base: 'Balance it was applied to',
  balanceBefore: 'Balance before this step',
  payable: 'Payable before the ceiling',
  ceiling: 'Cover still available',
  months: 'Waiting period',
  confidence: 'Match confidence',
  minConfidence: 'Confidence the gate requires',
  observedDelta: 'Difference on the face of the bill',
  attributedDelta: 'Difference we could place',
};

export interface Operand {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  /** True when the value is money, so the column can be set in tabular figures. */
  readonly money: boolean;
}

function formatValue(key: string, value: number): { text: string; money: boolean } {
  if (PAISE_KEYS.has(key)) return { text: inr(value), money: true };
  if (key === 'copayPercent') return { text: `${value}%`, money: false };
  if (key === 'days') return { text: `${value} ${value === 1 ? 'day' : 'days'}`, money: false };
  if (key === 'months') return { text: `${value} ${value === 1 ? 'month' : 'months'}`, money: false };
  if (key === 'confidence' || key === 'minConfidence') {
    return { text: `${Math.round(value * 100)}%`, money: false };
  }
  return { text: String(value), money: false };
}

/** The operands, labelled and formatted, in the order the engine supplied them. */
export function operands(a: Arithmetic): readonly Operand[] {
  return Object.entries(a.inputs).map(([key, value]) => {
    const { text, money } = formatValue(key, value);
    return { key, label: LABEL[key] ?? sentence(key), value: text, money };
  });
}

/**
 * The expression with every amount the engine named turned into rupees.
 * Substitution is by exact integer and guarded on both sides, so "3 days"
 * survives a `days: 3` and only a genuine paise figure is rewritten.
 */
export function humaniseExpression(a: Arithmetic): string {
  let out = a.expression;

  const amounts = Object.entries(a.inputs)
    .filter(([key]) => PAISE_KEYS.has(key))
    .map(([, value]) => Math.round(value))
    .filter((value) => Math.abs(value) >= 1)
    // Longest first: rewriting 5000 before 500000 would corrupt the longer one.
    .sort((x, y) => String(Math.abs(y)).length - String(Math.abs(x)).length);

  for (const value of new Set(amounts)) {
    out = out.replace(new RegExp(`(?<![\\d.,])${value}(?![\\d.,])`, 'g'), inr(value));
  }

  // "500000 paise/day" has become "₹5,000 paise/day"; the unit is now the ₹.
  return out.replaceAll(' paise/day', '/day').replaceAll(' paise', '').replace(/\s+/g, ' ').trim();
}

/** `insurerDeducted` → `Insurer deducted`, for any key the map above missed. */
function sentence(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
