import { type Paise, formatInr } from '@fc/contracts';

/**
 * Display helpers take a plain `number` of paise on purpose.
 *
 * The `Paise` brand exists to stop unbranded arithmetic reaching the engine.
 * At the render edge every value is already final, and demanding the brand here
 * would only litter the components with casts — which is worse for safety than
 * accepting a number, because a cast hides real mistakes too.
 */
export function inr(paise: number): string {
  const formatted = formatInr(paise as Paise);
  return paise % 100 === 0 ? formatted.replace(/\.00$/, '') : formatted;
}

/** Magnitude only. Used where a column header already carries the sign. */
export function inrAbs(paise: number): string {
  return inr(Math.abs(paise));
}

/** `-11028000` → `1,10,280` for prose, where the ₹ sign is already in the sentence. */
export function rupeesOnly(paise: number): string {
  return inrAbs(paise).replace('₹', '');
}
