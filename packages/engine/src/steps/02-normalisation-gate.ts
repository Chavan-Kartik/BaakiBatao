import type { Reducer } from '../types';

/**
 * Step 2 — Normalisation gate.
 *
 * Not money-moving. Consumes NormalisedLine[] and enforces the confidence gate
 * from `params.minConfidence`: lines below it move to unresolved and are
 * excluded from every downstream step, each carrying an UNRESOLVED finding with
 * its tier and reason.
 *
 * This is where the model's uncertainty becomes a visible product feature
 * instead of a silent guess. A line we cannot categorise can be neither
 * deducted nor defended.
 *
 * Spec: build spec §7.3
 */
export const normalisationGate: Reducer = (state, _ctx) => {
  // TODO(W2): gate on ctx.params.minConfidence, mark lines unresolved, emit
  // one UNRESOLVED finding per gated line with its NormTier.
  return [state, []];
};
