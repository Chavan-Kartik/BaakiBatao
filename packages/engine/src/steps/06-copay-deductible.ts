import type { Reducer } from '../types';

/**
 * Step 6 — Co-pay and deductible.
 *
 * The order comes from `params.order` and is genuinely insurer-specific: some
 * wordings apply co-pay before the deductible, others after, and the two
 * produce different answers.
 *
 * That is why the order lives in the rulepack rather than in this file. Insurer
 * wording differences are configuration, not a code branch.
 *
 * The arithmetic string records which order was used, so the UI can show
 * "deductible first, then co-pay, per clause 4.2 of your wording".
 *
 * Emits: COPAY.PCT · COPAY.ZONE · DEDUCT.AMT
 *
 * Spec: build spec §7.7
 */
export const copayDeductible: Reducer = (state, _ctx) => {
  // TODO(W2): read ctx.params.order, apply in that sequence, record it in the
  // arithmetic expression.
  return [state, []];
};
