/**
 * Date arithmetic on ISO `YYYY-MM-DD` strings.
 *
 * Hand-rolled rather than pulled from a library because the engine has to stay
 * dependency-free enough to run in a browser bundle, and because these are the
 * only two operations the waterfall needs. ISO dates also compare correctly
 * with `<` and `>` as strings, so no comparison helper is needed.
 */

/** `2024-01-31` + 1 month → `2024-02-29`, clamped to the end of the month. */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];

  const zeroBased = m - 1 + months;
  const year = y + Math.floor(zeroBased / 12);
  const month = ((zeroBased % 12) + 12) % 12;

  // Clamping matters: a policy starting on the 31st with a one-month waiting
  // period must not roll into the following month, which is what naive
  // Date-setMonth arithmetic does.
  const day = Math.min(d, daysInMonth(year, month));

  return `${pad(year, 4)}-${pad(month + 1, 2)}-${pad(day, 2)}`;
}

/** Inclusive of both ends, which is how a hospital counts days of stay. */
export function daysBetween(fromIso: string, toIso: string): number {
  const ms = Date.UTC(...ymd(toIso)) - Date.UTC(...ymd(fromIso));
  return Math.round(ms / 86_400_000);
}

function ymd(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return [y, m - 1, d];
}

function daysInMonth(year: number, monthZeroBased: number): number {
  return new Date(Date.UTC(year, monthZeroBased + 1, 0)).getUTCDate();
}

const pad = (n: number, width: number): string => String(n).padStart(width, '0');
