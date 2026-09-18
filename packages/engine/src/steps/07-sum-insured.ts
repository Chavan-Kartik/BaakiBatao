import type { ClauseId, Finding, Paise } from '@fc/contracts';
import { ZERO, addPaise, maxPaise, minPaise, subPaise } from '@fc/contracts';
import type { Reducer } from '../types';
import { arithmetic, cut, unresolved } from '../findings';

const SI_EXHAUSTED: ClauseId = 'SI.EXHAUSTED' as ClauseId;

/**
 * Step 7 — Sum insured.
 *
 * Caps at the remaining sum insured, applying no-claim bonus and restore
 * benefit only if the schedule actually grants them.
 *
 * Emits: SI.EXHAUSTED · SI.RESTORE.APPLIED · SI.BONUS.APPLIED
 *
 * Reconciliation happens after this step, in the interpreter — see
 * reconcile/invariant.ts.
 *
 * Spec: build spec §7.8
 */
export const sumInsured: Reducer = (state, ctx) => {
  const { policy } = ctx;

  const ceiling = availableCover(policy);

  // A schedule we could not read the sum insured from cannot be used to cap
  // anything. Treating an unreadable sum insured as unlimited would silently
  // drop the last constraint on the figure we put in a letter.
  if (ceiling === null) {
    return [
      state,
      [
        unresolved({
          stepId: 'SUM_INSURED',
          lineRef: null,
          reason: 'MISSING_POLICY_SCHEDULE',
          magnitude: ZERO,
          resolvedBy:
            'the sum insured and the balance remaining on the policy schedule, which cap the payable amount',
          arithmetic: arithmetic('sum insured ceiling not established', {}, 0),
          confidence: 0,
        }),
      ],
    ];
  }

  const excess = subPaise(state.payable, ceiling);
  if (excess <= 0) return [state, []];

  // As in step 6, we defend the smaller of our figure and theirs: the ledger
  // decomposes what the insurer withheld, not what they could have withheld.
  const theirs = addPaise(
    ...ctx.insurerClaimLevel.filter((c) => c.kind === 'SUM_INSURED').map((c) => c.amount),
  );
  const defensible = minPaise(theirs, maxPaise(ZERO, excess));

  const findings: Finding[] =
    defensible > 0
      ? [
          cut({
            stepId: 'SUM_INSURED',
            lineRef: null,
            clauseId: SI_EXHAUSTED,
            bucket: 'CORRECTLY_APPLIED',
            magnitude: defensible,
            arithmetic: arithmetic(
              `payable ${state.payable} capped at available cover ${ceiling}`,
              { payable: state.payable, ceiling, insurerApplied: theirs },
              defensible,
            ),
          }),
        ]
      : [];

  return [{ ...state, payable: ceiling }, findings];
};

/**
 * What is actually available to pay this claim.
 *
 * `sumInsuredRemaining` is preferred over `sumInsured` because a second claim
 * in a policy year is capped by the balance, not the headline figure. The
 * no-claim bonus and restore benefit are added only where the schedule grants
 * them — a restore benefit assumed into existence would inflate the ceiling and
 * understate a lawful SI.EXHAUSTED cut.
 */
function availableCover(policy: Parameters<Reducer>[1]['policy']): Paise | null {
  const base = policy.sumInsuredRemaining ?? policy.sumInsured;
  if (base === null) return null;

  const bonus = policy.noClaimBonus ?? ZERO;

  // The restore benefit reinstates the base sum insured once it is exhausted.
  // It needs the headline figure, so it is only honoured when we have one.
  const restore =
    policy.restoreBenefitGranted && policy.sumInsured !== null ? policy.sumInsured : ZERO;

  return addPaise(base, bonus, restore);
}
