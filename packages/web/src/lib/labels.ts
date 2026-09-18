import type { StepId } from '@fc/contracts';

/**
 * Display names for the waterfall. The rulepack's step IDs are the contract and
 * are never prettified in data — only here, at the edge, for reading.
 */
export const STEP_LABEL: Record<StepId, string> = {
  ADMISSIBILITY: 'Admissibility',
  NORMALISATION_GATE: 'Normalisation gate',
  NON_PAYABLE: 'Non-payable items',
  CAPS_SUBLIMITS: 'Caps and sub-limits',
  PROPORTIONATE: 'Proportionate deduction',
  COPAY_DEDUCTIBLE: 'Co-pay and deductible',
  SUM_INSURED: 'Sum insured cap',
};

/** One line on why each step exists, in the order a reader meets them. */
export const STEP_NOTE: Record<StepId, string> = {
  ADMISSIBILITY: 'Is the claim payable at all — policy in force, waiting periods served.',
  NORMALISATION_GATE: 'Lines we cannot categorise with confidence are withheld, not guessed.',
  NON_PAYABLE: 'Annexure II items, less anything a rider buys back.',
  CAPS_SUBLIMITS: 'Room rent, ICU and procedure sub-limits from this schedule.',
  PROPORTIONATE: 'The contested step. Four gates decide whether it may apply, and to what.',
  COPAY_DEDUCTIBLE: 'Applied in the order the rulepack declares, because order changes the total.',
  SUM_INSURED: 'The final ceiling, applied last so it cannot mask an earlier error.',
};

export const CATEGORY_LABEL: Record<string, string> = {
  ROOM_RENT: 'Room rent',
  ICU_CHARGE: 'ICU',
  SURGEON_FEE: 'Surgeon',
  ANAESTHETIST_FEE: 'Anaesthetist',
  OT_CHARGE: 'Operating theatre',
  PHARMACY: 'Pharmacy',
  CONSUMABLE: 'Consumables',
  IMPLANT_DEVICE: 'Implant',
  DIAGNOSTICS: 'Diagnostics',
  ADMIN_CHARGE: 'Administrative',
};
