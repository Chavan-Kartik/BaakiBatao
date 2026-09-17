import { z } from 'zod';
import { CaseId, Sha256, StepId } from './ids';
import { Paise } from './money';
import { Finding } from './finding';
import { AdmissionFacts, PolicySchedule } from './policy';
import { ExtractedTable } from './extraction';
import { NormalisedLine } from './normalisation';

export const VersionPins = z.object({
  engineVersion: z.string(),
  rulepackVersion: z.string(),
  rulepackHash: Sha256,
  lexiconVersion: z.string(),
  extractionHash: Sha256,
  /** The order actually used, pinned so a later rulepack cannot rewrite history. */
  stepOrder: z.array(StepId),
});
export type VersionPins = z.infer<typeof VersionPins>;

export const StepResult = z.object({
  stepId: StepId,
  openingBalance: Paise,
  closingBalance: Paise,
  findingIds: z.array(z.string()),
  halted: z.boolean(),
});
export type StepResult = z.infer<typeof StepResult>;

/**
 * The invariant. `residual` must be 0 in any returned Reconstruction, because
 * any remainder has already been materialised as an UNRESOLVED finding with
 * reason RESIDUAL_UNATTRIBUTED.
 *
 * Every paise is either attributed to a clause we can quote, or explicitly
 * marked unattributed. There is no third state. See build spec §8.1.
 */
export const Reconciliation = z.object({
  observedDelta: Paise, // billTotal − actualPaid
  attributedDelta: Paise, // Σ findings.amount
  residual: Paise, // must be 0
  invariantHeld: z.boolean(),
  /**
   * Spelled out rather than `z.record(Bucket, …)` so the three buckets are
   * statically exhaustive — a missing bucket should be a type error, not a
   * runtime `undefined` in a rupee total.
   */
  byBucket: z.object({
    CORRECTLY_APPLIED: Paise,
    INCORRECTLY_APPLIED: Paise,
    UNRESOLVED: Paise,
  }),
});
export type Reconciliation = z.infer<typeof Reconciliation>;

export const ReconstructInput = z.object({
  caseId: CaseId,
  pins: VersionPins,
  policy: PolicySchedule,
  admission: AdmissionFacts,
  billTable: ExtractedTable,
  deductionTable: ExtractedTable,
  normalisedLines: z.array(NormalisedLine),
  actualPaid: Paise,
});
export type ReconstructInput = z.infer<typeof ReconstructInput>;

export const Reconstruction = z.object({
  caseId: CaseId,
  pins: VersionPins,
  billTotal: Paise,
  /** Ours, computed independently of what the insurer decided. */
  expectedPayable: Paise,
  /** Theirs, read off the settlement letter. */
  actualPaid: Paise,
  steps: z.array(StepResult),
  findings: z.array(Finding),
  reconciliation: Reconciliation,
  computedAt: z.string().datetime(),
});
export type Reconstruction = z.infer<typeof Reconstruction>;
