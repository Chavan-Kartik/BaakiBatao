/**
 * The lookup key for the lexicon (§14, tier 1): casefold, drop punctuation,
 * collapse whitespace, expand the abbreviations hospital billing software
 * actually prints.
 *
 * This is the same key `@fc/rulepack` checks alias uniqueness on, so a
 * collision the lexicon would see is a collision the rulepack refuses to load
 * with. It is deliberately not fuzzy: fuzziness is a separate tier with its
 * own calibrated threshold, and folding it in here would make "exact hit,
 * confidence 1.00" a lie.
 */

/**
 * Whole-token expansions only. A substring rule ("chg" anywhere) would turn
 * "discharge" into "disCHARGES", which is the kind of clever that costs a
 * category.
 */
const ABBREVIATIONS: ReadonlyMap<string, string> = new Map([
  ['chgs', 'charges'],
  ['chg', 'charges'],
  ['chrgs', 'charges'],
  ['charge', 'charges'],
  ['inj', 'injection'],
  ['consult', 'consultation'],
  ['consultn', 'consultation'],
  ['anaes', 'anaesthesia'],
  ['anaesth', 'anaesthesia'],
  ['anesth', 'anaesthesia'],
  ['physio', 'physiotherapy'],
  ['med', 'medicines'],
  ['meds', 'medicines'],
  ['medicine', 'medicines'],
  ['fees', 'fee'],
  ['investigations', 'investigation'],
  ['xray', 'x ray'],
  ['o2', 'oxygen'],
  ['amb', 'ambulance'],
  ['regn', 'registration'],
  ['reg', 'registration'],
  ['admn', 'admission'],
  ['dr', 'doctor'],
]);

export function normaliseText(s: string): string {
  const folded = s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return folded
    .split(' ')
    .map((token) => ABBREVIATIONS.get(token) ?? token)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
