import type { CategoryDefinition, ClauseId, Finding, Paise, Rider } from '@fc/contracts';
import { ZERO, subPaise } from '@fc/contracts';
import type { Reducer } from '../types';
import { attribute, reduceLine, remainingInsurerCut, sumAllowed } from '../state';
import { arithmetic, classifyCut } from '../findings';

const ANNEXURE_II: ClauseId = 'NP.ITEM.ANNEXURE_II' as ClauseId;
const RIDER_COVERED: ClauseId = 'NP.RIDER.COVERED' as ClauseId;

/**
 * Step 3 — Non-payable items.
 *
 * Master-list screening against Annexure II.
 *
 * The rider check happens FIRST (`params.checkRidersFirst`). A consumables
 * rider changes the answer for an entire class of lines, and getting this order
 * wrong produces exactly the class of confident-wrong answer the project brief
 * §3 warns about.
 *
 * Emits: NP.ITEM.<code> per cut line, NP.RIDER.COVERED where a rider rescues it.
 *
 * Spec: build spec §7.4
 */
export const nonPayable: Reducer = (state, ctx) => {
  const checkRidersFirst = ctx.params['checkRidersFirst'] !== false;
  const tolerance = ctx.rulepack.rounding.matchTolerancePaise;
  const findings: Finding[] = [];

  const lines = state.lines.map((line) => {
    if (line.unresolved || line.categoryId === null) return line;

    const category = ctx.rulepack.categories[line.categoryId];
    if (!category || category.annexure !== 'II') return line;

    // The rider question is asked before the exclusion is applied, not after.
    // Asked in the other order, a consumables rider becomes a post-hoc
    // adjustment to a cut we already asserted was lawful, and the letter ends
    // up quoting Annexure II against a line the policyholder actually bought
    // cover for.
    const rider = checkRidersFirst
      ? findRescuingRider(category, ctx.policy.riders, ctx.admission.admissionDate)
      : undefined;

    const lawfulCut: Paise = rider ? ZERO : line.allowed;

    const { findings: produced, attributed } = classifyCut({
      stepId: 'NON_PAYABLE',
      lineRef: line.lineRef,
      theirRemainingCut: remainingInsurerCut(line, ctx.insurerByLine),
      reasonStep: ctx.insurerByLine.get(line.lineRef)?.reasonStep ?? null,
      lawfulCut,
      // With a rider in force the lawful cut is nil, so `lawfulClause` is never
      // reached — anything they cut is excess, cited to the rider.
      lawfulClause: ANNEXURE_II,
      excessClause: rider ? RIDER_COVERED : ANNEXURE_II,
      arithmetic: rider
        ? arithmetic(
            `${category.label} is on Annexure II, but rider ${rider.riderId} (${rider.label}, effective ${rider.effectiveFrom}) covers it`,
            { claimed: line.claimed, lawfulCut: 0 },
            0,
          )
        : arithmetic(
            `${category.label} is listed non-payable under Annexure II, with no rider covering it`,
            { claimed: line.claimed, lawfulCut },
            lawfulCut,
          ),
      matchTolerancePaise: tolerance,
    });

    findings.push(...produced);

    const attributed_ = attribute(line, attributed);
    return lawfulCut > 0
      ? reduceLine(attributed_, 'NON_PAYABLE', subPaise(attributed_.allowed, lawfulCut))
      : attributed_;
  });

  return [{ ...state, lines, payable: sumAllowed(lines) }, findings];
};


/**
 * A rider only rescues a line if it was in force on the date of admission.
 * An endorsement bought after the admission does not retrospectively cover it,
 * and an unknown admission date is not grounds to assume it did.
 */
function findRescuingRider(
  category: CategoryDefinition,
  riders: readonly Rider[],
  admissionDate: string | null,
): Rider | undefined {
  return riders.find(
    (r) =>
      r.coversCategories.includes(category.categoryId) &&
      admissionDate !== null &&
      r.effectiveFrom <= admissionDate,
  );
}
