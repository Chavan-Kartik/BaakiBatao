import type {
  AdmissionFacts,
  CategoryId,
  LineRef,
  Paise,
  PolicySchedule,
  Rulepack,
  StepId,
} from '@fc/contracts';
import { ZERO, addPaise } from '@fc/contracts';

/** One bill line as it moves through the waterfall. */
export interface LineState {
  readonly lineRef: LineRef;
  readonly rawDescription: string;
  readonly categoryId: CategoryId | null;
  readonly claimed: Paise;
  /** What survives so far. Each step may only reduce this. */
  readonly allowed: Paise;
  /**
   * Which steps have already reduced this line. Used by the no-double-deduction
   * property test — two steps must never cut the same rupee.
   */
  readonly deductedBy: readonly StepId[];
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
