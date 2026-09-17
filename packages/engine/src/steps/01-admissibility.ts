import type { Reducer } from '../types';

/**
 * Step 1 — Admissibility.
 *
 * Decides: policy in force on the date of admission, waiting periods, the
 * pre-existing disease clock, and plain exclusions.
 *
 * Halts the waterfall when inadmissible — but still with the clause, so even a
 * rejection is explained. Where the PED clock cannot be established from the
 * documents we hold, this step emits UNRESOLVED / MISSING_WORDING_CLAUSE rather
 * than assuming admissibility.
 *
 * Emits: ADM.NOTINFORCE · ADM.WAITING.INITIAL · ADM.WAITING.SPECIFIC · ADM.PED ·
 *        ADM.EXCLUSION
 *
 * Spec: build spec §7.2
 */
export const admissibility: Reducer = (state, _ctx) => {
  // TODO(W2): implement. Until then the step is a no-op so the interpreter and
  // the reconciliation invariant can be exercised end to end.
  return [state, []];
};
