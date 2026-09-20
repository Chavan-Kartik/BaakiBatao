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
  IMAGING: 'Imaging',
  CARDIAC_DIAGNOSTICS: 'Cardiac',
  ADMIN_CHARGE: 'Admin',
  NURSING_CHARGE: 'Nursing',
  DOCTOR_VISIT: 'Consultation',
  AMBULANCE: 'Ambulance',
  VENTILATOR: 'Ventilator',
};

export const STATUS_LABEL: Record<string, string> = {
  AWAITING_UPLOAD: 'Awaiting upload',
  VALIDATING: 'Validating pack',
  EXTRACTING: 'Extracting documents',
  REDACTING: 'Redacting',
  AWAITING_CORRECTION: 'Needs correction',
  NORMALISING: 'Normalising lines',
  RECONSTRUCTING: 'Reconstructing',
  WRITING_PROSE: 'Writing prose',
  COMPLETE: 'Complete',
  FAILED: 'Failed',
};

/** Each failure code maps to a sentence a policyholder can act on, never a stack trace. */
export const FAILURE_LABEL: Record<string, string> = {
  PACK_INCOMPLETE: 'The pack is missing a required document.',
  TEXTRACT_LOW_CONFIDENCE: 'A document could not be read with enough confidence.',
  TEXTRACT_NO_TABLE_FOUND: 'No line-item table was found in a document.',
  SCHEDULE_UNPARSEABLE: 'The policy schedule could not be read.',
  REDACTION_FAILED_OPEN: 'Redaction could not be confirmed, so nothing was sent to a model.',
  NORMALISATION_EXHAUSTED: 'Too many lines could not be categorised.',
  RULEPACK_INVALID: 'The rulepack failed validation.',
  INVARIANT_VIOLATED: 'The ledger did not balance.',
  BEDROCK_THROTTLED: 'The model service throttled the request.',
  MODEL_UNAVAILABLE: 'The model is not available in this region.',
  EXTRACTOR_UNAVAILABLE: 'This deployment cannot read scanned documents yet.',
  PIPELINE_INTERNAL: 'Something failed inside the pipeline. Nothing was adjudicated.',
};
