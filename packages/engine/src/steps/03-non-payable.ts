import type { Reducer } from '../types';

/**
 * Step 3 — Non-payable items.
 *
 * Master-list screening against Annexure II.
 *
 * The rider check happens FIRST (`params.checkRidersFirst`). A consumables
 * rider changes the answer for an entire class of lines, and getting this order
 * wrong produces exactly the class of confident-wrong answer the project brief
 * §3 warns about.
 *
 * Emits: NP.ITEM.<code> per cut line, NP.RIDER.COVERED where a rider rescues it.
 *
 * Spec: build spec §7.4
 */
export const nonPayable: Reducer = (state, _ctx) => {
  // TODO(W2): resolve ctx.policy.riders first, then screen against Annexure II.
  return [state, []];
};
