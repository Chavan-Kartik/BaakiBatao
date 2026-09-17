import type { Reducer } from '../types';

/**
 * Step 7 — Sum insured.
 *
 * Caps at the remaining sum insured, applying no-claim bonus and restore
 * benefit only if the schedule actually grants them.
 *
 * Emits: SI.EXHAUSTED · SI.RESTORE.APPLIED · SI.BONUS.APPLIED
 *
 * Reconciliation happens after this step, in the interpreter — see
 * reconcile/invariant.ts.
 *
 * Spec: build spec §7.8
 */
export const sumInsured: Reducer = (state, _ctx) => {
  // TODO(W2): cap at ctx.policy.sumInsuredRemaining, honouring restore/bonus
  // only where granted.
  return [state, []];
};
