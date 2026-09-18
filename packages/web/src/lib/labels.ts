import type { StepId } from '@fc/contracts';

export const STEP_LABEL: Record<StepId, string> = {
  ADMISSIBILITY: 'Admissibility',
  NORMALISATION_GATE: 'Normalisation',
  NON_PAYABLE: 'Non-payable',
  CAPS_SUBLIMITS: 'Caps / sub-limits',
  PROPORTIONATE: 'Proportionate',
  COPAY_DEDUCTIBLE: 'Co-pay / deductible',
  SUM_INSURED: 'Sum insured',
};

export const CATEGORY_LABEL: Record<string, string> = {
  ROOM_RENT: 'Room rent',
  ICU_CHARGE: 'ICU',
  SURGEON_FEE: 'Surgeon',
  ANAESTHETIST_FEE: 'Anaesthetist',
  OT_CHARGE: 'OT',
  PHARMACY: 'Pharmacy',
  CONSUMABLE: 'Consumables',
  IMPLANT_DEVICE: 'Implant',
  DIAGNOSTICS: 'Diagnostics',
  ADMIN_CHARGE: 'Admin',
};
