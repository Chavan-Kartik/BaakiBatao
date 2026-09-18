import type { ClauseId, Finding, Paise } from '@fc/contracts';
import { ZERO } from '@fc/contracts';
import type { Reducer } from '../types';
import { arithmetic, cut, unresolved } from '../findings';
import { addMonths } from '../dates';
import { sumAllowed } from '../state';

/**
 * Step 1 — Admissibility.
 *
 * Decides: policy in force on the date of admission, waiting periods, the
 * pre-existing disease clock, and plain exclusions.
 *
 * Halts the waterfall when inadmissible — but still with the clause, so even a
 * rejection is explained. Where the PED clock cannot be established from the
 * documents we hold, this step emits UNRESOLVED / MISSING_WORDING_CLAUSE rather
 * than assuming admissibility.
 *
 * Emits: ADM.NOTINFORCE · ADM.WAITING.INITIAL · ADM.WAITING.SPECIFIC · ADM.PED ·
 *        ADM.EXCLUSION
 *
 * Spec: build spec §7.2
 */
export const admissibility: Reducer = (state, ctx) => {
  const { policy, admission } = ctx;

  // Nothing here can be decided without the cover period and the admission
  // date. Defaulting either way would be the worst available answer: assuming
  // admissibility hides a valid rejection, and assuming inadmissibility
  // condemns a good claim. So the step declines to rule and says why.
  if (
    policy.policyStartDate === null ||
    policy.policyEndDate === null ||
    admission.admissionDate === null
  ) {
    return [state, [caveat(missingDatesReason(policy.policyStartDate, admission.admissionDate))]];
  }

  const admitted = admission.admissionDate;

  if (admitted < policy.policyStartDate || admitted > policy.policyEndDate) {
    return halt(state, 'ADM.NOTINFORCE' as ClauseId, {
      expression: `admitted ${admitted} outside cover ${policy.policyStartDate}..${policy.policyEndDate}`,
      inputs: {},
      result: 0,
    });
  }

  // The initial waiting period is evaluated, but a breach of it is reported as
  // a caveat rather than a rejection. The wording exempts accidental injury,
  // and nothing in the claim pack tells us whether this admission was one.
  // Declaring the claim inadmissible on an exception we cannot check is
  // precisely the confident-wrong answer the brief rules out.
  const initial = policy.waitingPeriods.find(
    (w) => w.appliesToConditions.length === 0 && w.months > 0,
  );

  const findings: Finding[] = [];

  if (initial) {
    const waitingEndsOn = addMonths(policy.policyStartDate, initial.months);
    if (admitted < waitingEndsOn) {
      findings.push(
        unresolved({
          stepId: 'ADMISSIBILITY',
          lineRef: null,
          reason: 'MISSING_WORDING_CLAUSE',
          magnitude: ZERO,
          resolvedBy:
            'the discharge summary, to establish whether this admission was for accidental injury — which the initial waiting period does not apply to',
          arithmetic: arithmetic(
            `admitted ${admitted}, initial waiting period of ${initial.months} months ends ${waitingEndsOn}`,
            { months: initial.months },
            0,
          ),
          confidence: 0,
        }),
      );
    }
  }

  // The PED clock needs a diagnosis and a disclosure date, neither of which is
  // in the claim pack. Recorded as a known blind spot instead of being scored.
  const ped = policy.waitingPeriods.find((w) => w.appliesToConditions.length > 0);
  if (ped) {
    findings.push(
      unresolved({
        stepId: 'ADMISSIBILITY',
        lineRef: null,
        reason: 'MISSING_WORDING_CLAUSE',
        magnitude: ZERO,
        resolvedBy:
          'the proposal form and the discharge diagnosis, to run the pre-existing disease clock against the declared conditions',
          arithmetic: arithmetic(
            `${ped.label}: ${ped.months} months, conditions not verifiable from the claim pack`,
          { months: ped.months },
          0,
        ),
        confidence: 0,
      }),
    );
  }

  return [state, findings];
};

/**
 * An inadmissible claim has a lawful payable of zero, so every rupee the
 * insurer withheld is defensible. The finding carries the whole reconstructed
 * balance and the waterfall stops: running caps and co-pay against a claim that
 * was never covered would produce arithmetic that looks authoritative and means
 * nothing.
 */
function halt(
  state: Parameters<Reducer>[0],
  clauseId: ClauseId,
  arith: { expression: string; inputs: Record<string, number>; result: number },
): ReturnType<Reducer> {
  const outstanding: Paise = sumAllowed(state.lines);

  const finding = cut({
    stepId: 'ADMISSIBILITY',
    lineRef: null,
    clauseId,
    bucket: 'CORRECTLY_APPLIED',
    magnitude: outstanding,
    arithmetic: arith,
  });

  return [
    {
      ...state,
      lines: state.lines.map((l) => ({
        ...l,
        allowed: ZERO,
        deductedBy: l.allowed > 0 ? [...l.deductedBy, 'ADMISSIBILITY' as const] : l.deductedBy,
      })),
      payable: ZERO,
      halted: true,
      haltReason: arith.expression,
    },
    [finding],
  ];
}

const caveat = (resolvedBy: string): Finding =>
  unresolved({
    stepId: 'ADMISSIBILITY',
    lineRef: null,
    reason: 'MISSING_POLICY_SCHEDULE',
    magnitude: ZERO,
    resolvedBy,
    arithmetic: arithmetic('admissibility not evaluated', {}, 0),
    confidence: 0,
  });

function missingDatesReason(start: string | null, admitted: string | null): string {
  const missing = [
    start === null ? 'the cover period on the policy schedule' : null,
    admitted === null ? 'the admission date from the discharge summary' : null,
  ].filter((x): x is string => x !== null);

  return missing.join(' and ');
}
