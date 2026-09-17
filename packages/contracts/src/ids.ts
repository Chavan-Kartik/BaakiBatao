import { z } from 'zod';

/** `sha256:<hex>` of the pack manifest. Content-addressed, so replay is exact. */
export const CaseId = z.string().min(1).brand<'CaseId'>();
export type CaseId = z.infer<typeof CaseId>;

export const DocId = z.string().min(1).brand<'DocId'>();
export type DocId = z.infer<typeof DocId>;

/** Stable row identity: `${docId}:${page}:${rowIndex}`. Survives re-extraction. */
export const LineRef = z.string().min(1).brand<'LineRef'>();
export type LineRef = z.infer<typeof LineRef>;

/**
 * A clause ID from the rulepack, e.g. `AME.EXCL.PHARMA`.
 *
 * Every finding must carry one, or it is not a finding — it is an opinion, and
 * it belongs in the unresolved bucket. See project brief §17.
 */
export const ClauseId = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]*(\.[A-Z0-9_]+)*$/, 'clause IDs look like AME.EXCL.PHARMA')
  .brand<'ClauseId'>();
export type ClauseId = z.infer<typeof ClauseId>;

/** A canonical line category, e.g. `PHARMACY_CONSUMABLE`. */
export const CategoryId = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]*$/)
  .brand<'CategoryId'>();
export type CategoryId = z.infer<typeof CategoryId>;

/**
 * The seven steps. Order matters more than any individual rule, and the order
 * itself lives in the rulepack's `steps.json` rather than in a function body.
 * See build spec §7.1.
 */
export const StepId = z.enum([
  'ADMISSIBILITY',
  'NORMALISATION_GATE',
  'NON_PAYABLE',
  'CAPS_SUBLIMITS',
  'PROPORTIONATE',
  'COPAY_DEDUCTIBLE',
  'SUM_INSURED',
]);
export type StepId = z.infer<typeof StepId>;

export const Sha256 = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export type Sha256 = z.infer<typeof Sha256>;
