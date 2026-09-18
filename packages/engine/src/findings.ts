import type {
  Arithmetic,
  Bucket,
  ClauseId,
  Finding,
  LineRef,
  Paise,
  StepId,
  UnresolvedReason,
} from '@fc/contracts';
import { ZERO, minPaise, negPaise, subPaise, unsafePaise } from '@fc/contracts';

/**
 * Finding constructors and the bucket rule.
 *
 * Centralised for one reason: the sign convention and the citation requirement
 * are easy to get right once and easy to get wrong seven times. Steps call
 * these rather than building object literals.
 *
 * Sign convention (build spec §6.4): `amount` is negative when it reduces
 * payable. Callers pass the magnitude of the cut and these negate it.
 */

export interface CutArgs {
  readonly stepId: StepId;
  readonly lineRef: LineRef | null;
  readonly clauseId: ClauseId;
  readonly bucket: Extract<Bucket, 'CORRECTLY_APPLIED' | 'INCORRECTLY_APPLIED'>;
  /** Magnitude of the cut, non-negative. */
  readonly magnitude: Paise;
  readonly arithmetic: Arithmetic;
  readonly confidence?: number;
}

export const cut = (a: CutArgs): Finding => ({
  findingId: findingId(a.stepId, a.lineRef, a.clauseId, a.bucket),
  lineRef: a.lineRef,
  stepId: a.stepId,
  clauseId: a.clauseId,
  bucket: a.bucket,
  amount: negPaise(a.magnitude),
  arithmetic: a.arithmetic,
  unresolvedReason: null,
  resolvedBy: null,
  confidence: a.confidence ?? 1,
});

export interface UnresolvedArgs {
  readonly stepId: StepId;
  readonly lineRef: LineRef | null;
  readonly reason: UnresolvedReason;
  /** Magnitude of the rupees we cannot place, non-negative. */
  readonly magnitude: Paise;
  /** The document or fact that would settle it. Always populated. */
  readonly resolvedBy: string;
  readonly arithmetic: Arithmetic;
  readonly confidence?: number;
}

/**
 * The unresolved bucket is a feature, not an embarrassment. It carries no
 * clause ID by design — `findingIsWellFormed` permits null only here, which is
 * what stops an uncitable claim from being dressed up as a verdict.
 */
export const unresolved = (a: UnresolvedArgs): Finding => ({
  findingId: findingId(a.stepId, a.lineRef, a.reason, 'UNRESOLVED'),
  lineRef: a.lineRef,
  stepId: a.stepId,
  clauseId: null,
  bucket: 'UNRESOLVED',
  amount: negPaise(a.magnitude),
  arithmetic: a.arithmetic,
  unresolvedReason: a.reason,
  resolvedBy: a.resolvedBy,
  confidence: a.confidence ?? 1,
});

export const arithmetic = (
  expression: string,
  inputs: Record<string, number>,
  result: number,
): Arithmetic => ({ expression, inputs, result });

/**
 * Deterministic and stable across runs, because the certificate is hashed and
 * two runs over identical input must produce an identical document.
 */
function findingId(
  stepId: StepId,
  lineRef: LineRef | null,
  discriminator: string,
  bucket: string,
): string {
  return [stepId, lineRef ?? 'CLAIM', discriminator, bucket].join('|');
}

/**
 * The bucket rule, in one place.
 *
 * Our waterfall decides what a cut on this line *should* have been. The
 * deduction sheet says what it *was*. Findings have to decompose the insurer's
 * deduction — not ours — because the reconciliation invariant balances against
 * `billTotal − actualPaid`.
 *
 * Three cases, and the asymmetry between them is the whole product:
 *
 *   they cut ≤ lawful   the cut they made is defensible in full. We do not
 *                       emit the shortfall as a finding: they were entitled to
 *                       cut more and chose not to, which is not a dispute.
 *
 *   they cut > lawful   the lawful part is CORRECTLY_APPLIED, and the excess is
 *                       INCORRECTLY_APPLIED against `excessClause` — the clause
 *                       that forbids the excess, which is usually not the
 *                       clause that authorised the lawful part.
 *
 *   unknown             the sheet had no matching row, so we do not know what
 *                       they did. We assert nothing and let the aggregate
 *                       residual name it.
 */
export interface ClassifyArgs {
  readonly stepId: StepId;
  readonly lineRef: LineRef;
  /**
   * The part of the insurer's cut on this line that no earlier step has
   * accounted for yet, or `null` when the deduction sheet had no matching row.
   *
   * This has to be the *remaining* cut, not the total. Seven steps each looking
   * at the same total would attribute the same rupee up to seven times, and the
   * reconciliation would over-explain the claim while still technically
   * balancing.
   */
  readonly theirRemainingCut: Paise | null;
  /** What our reconstruction says this step may lawfully cut from this line. */
  readonly lawfulCut: Paise;
  /** Authorises the lawful part. */
  readonly lawfulClause: ClauseId;
  /** Forbids anything beyond the lawful part. */
  readonly excessClause: ClauseId;
  readonly arithmetic: Arithmetic;
  /** Below this, our figure and theirs are treated as agreeing. */
  readonly matchTolerancePaise: Paise;
  /**
   * Whether this step is entitled to dispute a cut it would not have made.
   *
   * See `ownsExcess` below for why this is not simply always true.
   */
  readonly reasonStep: StepId | null;
  readonly stepOwnsUnexplainedCuts?: boolean;
}

export interface ClassifyResult {
  readonly findings: readonly Finding[];
  /** How much of the insurer's cut this step just accounted for. */
  readonly attributed: Paise;
}

export function classifyCut(a: ClassifyArgs): ClassifyResult {
  if (a.theirRemainingCut === null) return NOTHING_ATTRIBUTED;

  const findings: Finding[] = [];
  const theirs = a.theirRemainingCut;

  const defensible = minPaise(theirs, a.lawfulCut);
  if (defensible > 0) {
    findings.push(
      cut({
        stepId: a.stepId,
        lineRef: a.lineRef,
        clauseId: a.lawfulClause,
        bucket: 'CORRECTLY_APPLIED',
        magnitude: defensible,
        arithmetic: a.arithmetic,
      }),
    );
  }

  const excess = subPaise(theirs, a.lawfulCut);
  const disputed =
    excess > a.matchTolerancePaise && ownsExcess(a) ? unsafePaise(excess) : ZERO;

  if (disputed > 0) {
    findings.push(
      cut({
        stepId: a.stepId,
        lineRef: a.lineRef,
        clauseId: a.excessClause,
        bucket: 'INCORRECTLY_APPLIED',
        magnitude: disputed,
        arithmetic: a.arithmetic,
      }),
    );
  }

  return { findings, attributed: unsafePaise(defensible + disputed) };
}

export const NOTHING_ATTRIBUTED: ClassifyResult = { findings: [], attributed: ZERO };

/**
 * May this step dispute a cut it would not itself have made?
 *
 * Yes in two cases, and no otherwise:
 *
 *   it made a lawful cut here        the line is demonstrably within this
 *                                    step's rule, so the overshoot is this
 *                                    step's to explain.
 *
 *   the sheet's reason names it      the insurer said which rule they were
 *                                    applying, so we dispute it under that one.
 *
 * Otherwise the step stays silent and lets a later, more specific step claim
 * the cut. Without this, every step would race to dispute the same rupees and
 * the earliest one in the waterfall would win — so a pharmacy line cut for
 * proportionate reasons gets challenged under the Annexure II rider clause in
 * step 3 and never reaches AME.EXCL.PHARMA in step 5. Both call it unlawful;
 * only one quotes the rule the insurer actually broke, and the letter is only
 * as good as its citation.
 *
 * When no step claims a cut, it is not lost: the zero-sum invariant materialises
 * it as RESIDUAL_UNATTRIBUTED. "They cut this and told us nothing, and our
 * reconstruction cuts nothing here" is a true statement, and a better one than a
 * confident citation of a rule we picked by accident of ordering.
 */
function ownsExcess(a: ClassifyArgs): boolean {
  if (a.stepOwnsUnexplainedCuts === true) return true;
  if (a.lawfulCut > 0) return true;
  return a.reasonStep === a.stepId;
}
