import { z } from 'zod';
import { CategoryId, ClauseId, Sha256, StepId } from './ids';
import { Paise, RoundingMode } from './money';

/**
 * Rules live here as data, not code.
 *
 * The types are in @fc/contracts so the engine can type its input while
 * depending on nothing but this package. The JSON data, the zod validation and
 * the loader live in @fc/rulepack. A rule can be corrected during judging with
 * a DynamoDB PutItem and an SSM pointer bump — no redeploy.
 * See build spec §9.
 */
export const ClauseEffect = z.enum([
  'EXCLUDE_FROM_AME',
  'IMMUNE_TO_PROPORTIONATE',
  'BOUNDS_PROPORTIONATE_RECOVERY',
  'REQUIRES_DIFFERENTIAL_BILLING',
  'NON_PAYABLE',
  'PAYABLE_IF_PART_OF_TREATMENT',
  'CAP',
  'COPAY',
  'DEDUCTIBLE',
  'ADMISSIBILITY',
  'SUM_INSURED',
  'TURNAROUND_TIME',
]);
export type ClauseEffect = z.infer<typeof ClauseEffect>;

export const ClauseDefinition = z.object({
  clauseId: ClauseId,
  /** e.g. "IRDAI/HLT/REG/CIR/151/06/2020", or "POLICY_WORDING" for policy-derived clauses. */
  source: z.string(),
  sourceDate: z.string().date().nullable(),
  paragraph: z.string().nullable(),
  /** Quoted verbatim in the UI and in the reconsideration letter. Never paraphrased. */
  text: z.string(),
  effect: ClauseEffect,
  /**
   * The 2020 circular binds products filed from 2020-10-01 and existing
   * products on renewal from 2021-04-01. The engine checks these before
   * applying a clause — applying it to an older policy would be exactly the
   * confident-wrong answer we claim not to produce.
   */
  appliesFrom: z.string().date().nullable(),
  appliesToExistingOnRenewalFrom: z.string().date().nullable(),
  citationUrl: z.string().url().nullable(),
});
export type ClauseDefinition = z.infer<typeof ClauseDefinition>;

export const CategoryDefinition = z.object({
  categoryId: CategoryId,
  label: z.string(),
  /**
   * Whether this category may form part of a policy's "associate medical
   * expenses" definition. `false` here with an `ameExclusionClause` set is what
   * makes step 5 a table lookup rather than a pile of conditionals.
   */
  ameEligible: z.boolean(),
  ameExclusionClause: ClauseId.nullable(),
  /** ICU charges: proportionate deduction has no referent, so it cannot apply. */
  proportionateImmune: z.boolean(),
  annexure: z.enum(['I', 'II', 'NONE']),
  riderCanCover: z.array(z.string()),
  aliases: z.array(z.string()),
});
export type CategoryDefinition = z.infer<typeof CategoryDefinition>;

export const StepDefinition = z.object({
  id: StepId,
  reducer: z.string(),
  haltsOnFail: z.boolean().default(false),
  params: z.record(z.string(), z.unknown()).default({}),
});
export type StepDefinition = z.infer<typeof StepDefinition>;

export const RoundingPolicy = z.object({
  mode: RoundingMode,
  /** Below this, a difference is reported as ROUNDING rather than as a dispute. */
  matchTolerancePaise: Paise,
});
export type RoundingPolicy = z.infer<typeof RoundingPolicy>;

export const Rulepack = z.object({
  version: z.string(),
  hash: Sha256,
  /** THE ORDER. Order matters more than any individual rule. */
  steps: z.array(StepDefinition),
  clauses: z.record(z.string(), ClauseDefinition),
  categories: z.record(z.string(), CategoryDefinition),
  rounding: RoundingPolicy,
});
export type Rulepack = z.infer<typeof Rulepack>;
