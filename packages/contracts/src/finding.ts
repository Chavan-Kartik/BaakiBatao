import { z } from 'zod';
import { ClauseId, LineRef, StepId } from './ids';
import { Paise } from './money';

export const Bucket = z.enum(['CORRECTLY_APPLIED', 'INCORRECTLY_APPLIED', 'UNRESOLVED']);
export type Bucket = z.infer<typeof Bucket>;

/**
 * The unresolved bucket is a feature, not an embarrassment. Every unresolved
 * finding names why we could not decide, and what document would settle it.
 * See project brief §4.
 */
export const UnresolvedReason = z.enum([
  'MISSING_POLICY_SCHEDULE',
  'MISSING_WORDING_CLAUSE',
  'AMBIGUOUS_DESCRIPTION', // normalisation tier-3 split vote
  'LOW_EXTRACTION_CONFIDENCE',
  'HOSPITAL_BILLING_MODE_UNKNOWN', // cannot evaluate PD.DIFFBILL either way
  'RESIDUAL_UNATTRIBUTED', // the zero-sum invariant's escape hatch
  'ROUNDING', // sub-tolerance drift, reported rather than absorbed
]);
export type UnresolvedReason = z.infer<typeof UnresolvedReason>;

/**
 * Shown verbatim in the UI. No prose in here — the expression is rendered as an
 * equation beside the clause, and the model is never asked to restate the maths.
 */
export const Arithmetic = z.object({
  expression: z.string(), // "18,400 × (1 − 4,000/6,500)"
  inputs: z.record(z.string(), z.number()),
  result: z.number(),
});
export type Arithmetic = z.infer<typeof Arithmetic>;

export const Finding = z.object({
  findingId: z.string().min(1),
  /** Null for whole-claim findings such as the deductible or the sum insured cap. */
  lineRef: LineRef.nullable(),
  stepId: StepId,
  /**
   * Null is permitted ONLY when the bucket is UNRESOLVED. A finding without a
   * clause ID is not a finding — it is an opinion. The engine asserts this at
   * construction time. See project brief §17 and build spec §5.
   */
  clauseId: ClauseId.nullable(),
  bucket: Bucket,
  /** Signed: negative reduces payable. See the sign convention in §6.4. */
  amount: Paise,
  arithmetic: Arithmetic,
  unresolvedReason: UnresolvedReason.nullable(),
  /** "the hospital's tariff card would resolve this" */
  resolvedBy: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
export type Finding = z.infer<typeof Finding>;

/**
 * The construction rule, as a predicate. The engine throws on violation rather
 * than emitting a confident claim it cannot cite.
 */
export const findingIsWellFormed = (f: Finding): boolean =>
  f.clauseId !== null || f.bucket === 'UNRESOLVED';
