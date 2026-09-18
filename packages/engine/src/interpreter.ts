import type {
  Finding,
  NormalisedLine,
  ReconstructInput,
  Reconstruction,
  Rulepack,
  StepResult,
} from '@fc/contracts';
import { ZERO, findingIsWellFormed } from '@fc/contracts';
import type { LineState, ReducerContext, WaterfallState } from './state';
import { sumAllowed, sumClaimed } from './state';
import { resolveReducer } from './registry';
import { balanceLedger } from './reconcile/invariant';
import { matchDeductionSheet } from './insurer';
import { UncitedFindingError } from './errors';

export interface ReconstructOptions {
  readonly input: ReconstructInput;
  readonly rulepack: Rulepack;
  /**
   * Passed in rather than read from a clock, so the engine stays a pure
   * function and two runs over identical input produce an identical result.
   * `computedAt` is excluded from the certificate's canonical hash.
   */
  readonly now: string;
}

/**
 * The waterfall.
 *
 * Order matters more than any individual rule, and the order is data: the
 * interpreter walks `rulepack.steps`, resolves each to a registered pure
 * reducer, and threads the state through. Whether co-pay applies before or
 * after the deductible is a rulepack version, not a branch in this file.
 *
 * Spec: build spec §7.1
 */
export function reconstruct({ input, rulepack, now }: ReconstructOptions): Reconstruction {
  let state = initialState(input, rulepack);
  const findings: Finding[] = [];
  const steps: StepResult[] = [];

  // Matched once, before the waterfall, so every step sees the same view of
  // what the insurer did and two steps cannot disagree about it.
  const insurer = matchDeductionSheet(
    input.billTable,
    input.deductionTable,
    rulepack.rounding.matchTolerancePaise,
  );

  for (const def of rulepack.steps) {
    const openingBalance = state.payable;
    const reducer = resolveReducer(def.reducer);

    const ctx: ReducerContext = {
      rulepack,
      policy: input.policy,
      admission: input.admission,
      params: def.params,
      insurerByLine: insurer.byLine,
      insurerClaimLevel: insurer.claimLevel,
    };

    const [next, produced] = reducer(state, ctx);
    assertCited(produced);

    findings.push(...produced);
    steps.push({
      stepId: def.id,
      openingBalance,
      closingBalance: next.payable,
      findingIds: produced.map((f) => f.findingId),
      halted: next.halted,
    });

    state = next;
    if (def.haltsOnFail && state.halted) break;
  }

  const billTotal = sumClaimed(state.lines);
  const { findings: balanced, reconciliation } = balanceLedger(
    billTotal,
    input.actualPaid,
    findings,
  );

  return {
    caseId: input.caseId,
    pins: input.pins,
    billTotal,
    expectedPayable: state.payable,
    actualPaid: input.actualPaid,
    steps,
    findings: [...balanced],
    reconciliation,
    computedAt: now,
  };
}

/**
 * A finding without a clause ID is not a finding — it is an opinion, and it
 * belongs in the unresolved bucket. See project brief §17.
 */
function assertCited(findings: readonly Finding[]): void {
  for (const f of findings) {
    if (!findingIsWellFormed(f)) {
      throw new UncitedFindingError(
        `finding ${f.findingId} claims ${f.bucket} with no clause ID`,
      );
    }
  }
}

export function initialState(input: ReconstructInput, rulepack: Rulepack): WaterfallState {
  const byRef = new Map<string, NormalisedLine>(
    input.normalisedLines.map((n) => [n.lineRef, n]),
  );

  const lines: LineState[] = input.billTable.rows.map((row) => {
    const norm = byRef.get(row.lineRef);
    const category = norm?.categoryId ? rulepack.categories[norm.categoryId] : undefined;

    return {
      lineRef: row.lineRef,
      rawDescription: row.rawDescription,
      categoryId: norm?.categoryId ?? null,
      // A bill row with no normalisation result at all is treated exactly like
      // one the cascade gave up on, rather than being quietly waved through.
      normTier: norm?.tier ?? 'UNRESOLVED',
      normConfidence: norm?.confidence ?? 0,
      claimed: row.amountClaimed,
      allowed: row.amountClaimed,
      deductedBy: [],
      insurerAttributed: ZERO,
      unresolved: false,
      proportionateImmune: category?.proportionateImmune ?? false,
    };
  });

  return {
    lines,
    payable: sumAllowed(lines),
    halted: false,
    haltReason: null,
  };
}
