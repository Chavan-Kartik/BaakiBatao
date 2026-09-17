import type { Reducer } from '../types';

/**
 * Step 4 — Caps and sub-limits.
 *
 * Read from THIS schedule, never a generic template. Room rent per day, ICU per
 * day, disease-wise and procedure-wise sub-limits, ambulance, pre/post
 * hospitalisation.
 *
 * If a cap the deduction sheet appears to rely on is absent from the extracted
 * schedule, that is UNRESOLVED / MISSING_POLICY_SCHEDULE — never an assumption
 * that the cap does not exist.
 *
 * Emits: LIMIT.ROOM · LIMIT.ICU · LIMIT.DISEASE · LIMIT.PROC · LIMIT.AMBULANCE
 *
 * Spec: build spec §7.5
 */
export const capsSublimits: Reducer = (state, _ctx) => {
  // TODO(W2): apply each cap present on ctx.policy; emit UNRESOLVED for absent
  // caps the insurer appears to have relied on.
  return [state, []];
};
