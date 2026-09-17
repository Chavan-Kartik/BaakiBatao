import type { Reducer } from '../types';

/**
 * Step 5 — Proportionate deduction.
 *
 * This is the step with the clearest published rule, and it is step FIVE OF
 * SEVEN. It is not the thesis.
 *
 * Four bright-line gates from IRDAI/HLT/REG/CIR/151/06/2020 (11 June 2020),
 * evaluated in order:
 *
 *   Gate A — does this policy contain a proportionate-deduction clause at all?
 *            If not, any PD the insurer applied is INCORRECTLY_APPLIED →
 *            PD.NOCLAUSE.
 *
 *   Gate B — does the hospital follow differential billing by room category?
 *            Unknown → UNRESOLVED / HOSPITAL_BILLING_MODE_UNKNOWN, never
 *            assumed. Known-not → INCORRECTLY_APPLIED → PD.DIFFBILL.
 *
 *   Gate C — build the eligible AME set from the policy's own definition,
 *            MINUS pharmacy & consumables  → AME.EXCL.PHARMA
 *            MINUS implants & devices      → AME.EXCL.IMPLANT
 *            MINUS diagnostics             → AME.EXCL.DIAG
 *
 *   Gate D — exclude every ICU line unconditionally → PD.ICU
 *            (ICUs have no room categories, so the formula has no referent)
 *
 * Then:
 *   ratio     = min(1, eligibleRoomRentCap / actualRoomRentPerDay)
 *   deduction = Σ over eligible AME lines of applyRatio(line, cap, actual)
 *   PD.LIMIT  — the insurer's total PD recovery must not exceed that figure;
 *               any excess is INCORRECTLY_APPLIED, itemised per line.
 *
 * THE TRAP THIS STEP EXISTS TO AVOID: a line being exempt from proportionate
 * deduction does NOT make it payable. Steps 3, 4, 6 and 7 still apply to it
 * independently. A pharmacy line can be exempt under AME.EXCL.PHARMA and still
 * be lawfully cut under Annexure II in step 3. See project brief §3.
 *
 * Spec: build spec §7.6
 */
export const proportionate: Reducer = (state, _ctx) => {
  // TODO(W2): implement gates A–D, then the bounded recovery check.
  // Use survivingShare() and applyRatio() from ../money — never raw division.
  return [state, []];
};
