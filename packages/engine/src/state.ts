import type {
  AdmissionFacts,
  CategoryId,
  LineRef,
  NormTier,
  Paise,
  PolicySchedule,
  Rulepack,
  StepId,
} from '@fc/contracts';
import { ZERO, addPaise, unsafePaise } from '@fc/contracts';
import type { ClaimLevelCut, InsurerByLine } from './insurer';

/** One bill line as it moves through the waterfall. */
export interface LineState {
  readonly lineRef: LineRef;
  readonly rawDescription: string;
  readonly categoryId: CategoryId | null;
  /**
   * Which tier of the cascade produced `categoryId`, and the margin-derived
   * confidence in it — never the model's opinion of itself. Step 2 gates on
   * these, so they have to travel with the line rather than being looked up
   * again downstream.
   */
  readonly normTier: NormTier;
  readonly normConfidence: number;
  readonly claimed: Paise;
  /** What survives so far. Each step may only reduce this. */
  readonly allowed: Paise;
  /**
   * Which steps have already reduced this line. Used by the no-double-deduction
   * property test — two steps must never cut the same rupee.
   */
  readonly deductedBy: readonly StepId[];
  /**
   * How much of the insurer's own cut on this line earlier steps have already
   * explained. Steps classify against the remainder, so no rupee of theirs is
   * attributed twice.
   */
  readonly insurerAttributed: Paise;
  /** Excluded from every downstream step; carries its own UNRESOLVED finding. */
  readonly unresolved: boolean;
  /** ICU lines are immune to proportionate deduction under PD.ICU. */
  readonly proportionateImmune: boolean;
}

export interface WaterfallState {
  readonly lines: readonly LineState[];
  /** Running payable. Steps consume the output of the previous step. */
  readonly payable: Paise;
  readonly halted: boolean;
  readonly haltReason: string | null;
}

export interface ReducerContext {
  readonly rulepack: Rulepack;
  readonly policy: PolicySchedule;
  readonly admission: AdmissionFacts;
  readonly params: Record<string, unknown>;
  /**
   * What the insurer actually did to each bill line, matched off the deduction
   * sheet. A step needs this because findings decompose the insurer's
   * deduction, not ours: the reconciliation balances against
   * `billTotal − actualPaid`, so a step that only knew our own figure could not
   * tell a defensible cut from an excessive one.
   *
   * A line absent from this map means the sheet had no matching row, which is
   * "we do not know", never "they paid it in full".
   */
  readonly insurerByLine: InsurerByLine;
  /**
   * Deductions the insurer took against the whole claim rather than a line.
   * Steps 6 and 7 classify against these instead of against their own figures.
   */
  readonly insurerClaimLevel: readonly ClaimLevelCut[];
}

export const sumAllowed = (lines: readonly LineState[]): Paise =>
  addPaise(...lines.filter((l) => !l.unresolved).map((l) => l.allowed));

export const sumClaimed = (lines: readonly LineState[]): Paise =>
  addPaise(...lines.map((l) => l.claimed));

export const emptyState: WaterfallState = {
  lines: [],
  payable: ZERO,
  halted: false,
  haltReason: null,
};

/** Immutable line update, preserving the deduction audit trail. */
export const reduceLine = (
  line: LineState,
  stepId: StepId,
  newAllowed: Paise,
): LineState => ({
  ...line,
  allowed: newAllowed,
  deductedBy: newAllowed < line.allowed ? [...line.deductedBy, stepId] : line.deductedBy,
});

/**
 * What the insurer cut from this line that no step has explained yet, or `null`
 * when the deduction sheet had no matching row at all. The two are different
 * answers: zero means "they cut nothing more", null means "we do not know".
 */
export const remainingInsurerCut = (
  line: LineState,
  insurerByLine: InsurerByLine,
): Paise | null => {
  const outcome = insurerByLine.get(line.lineRef);
  if (outcome === undefined) return null;
  return unsafePaise(Math.max(0, outcome.deducted - line.insurerAttributed));
};

/** Records that `stepId` accounted for `attributed` paise of the insurer's cut. */
export const attribute = (line: LineState, attributed: Paise): LineState =>
  attributed === 0
    ? line
    : { ...line, insurerAttributed: addPaise(line.insurerAttributed, attributed) };
