import type {
  CategoryDefinition,
  ClauseDefinition,
  ClauseId,
  Finding,
  Paise,
  PolicySchedule,
  RoundingMode,
} from '@fc/contracts';
import { ZERO, maxPaise, subPaise } from '@fc/contracts';
import type { Reducer } from '../types';
import type { LineState, ReducerContext } from '../state';
import { attribute, reduceLine, remainingInsurerCut, sumAllowed } from '../state';
import { arithmetic, classifyCut, unresolved } from '../findings';
import { applyRatio, percentOf, survivingShare } from '../money';

const PD_LIMIT: ClauseId = 'PD.LIMIT' as ClauseId;
const PD_NOCLAUSE: ClauseId = 'PD.NOCLAUSE' as ClauseId;
const PD_DIFFBILL: ClauseId = 'PD.DIFFBILL' as ClauseId;
const PD_ICU: ClauseId = 'PD.ICU' as ClauseId;

/**
 * Step 5 — Proportionate deduction.
 *
 * This is the step with the clearest published rule, and it is step FIVE OF
 * SEVEN. It is not the thesis.
 *
 * Four bright-line gates from IRDAI/HLT/REG/CIR/151/06/2020 (11 June 2020),
 * evaluated in order:
 *
 *   Gate A — does this policy contain a proportionate-deduction clause at all?
 *            If not, any PD the insurer applied is INCORRECTLY_APPLIED →
 *            PD.NOCLAUSE.
 *
 *   Gate B — does the hospital follow differential billing by room category?
 *            Unknown → UNRESOLVED / HOSPITAL_BILLING_MODE_UNKNOWN, never
 *            assumed. Known-not → INCORRECTLY_APPLIED → PD.DIFFBILL.
 *
 *   Gate C — build the eligible AME set from the policy's own definition,
 *            MINUS pharmacy & consumables  → AME.EXCL.PHARMA
 *            MINUS implants & devices      → AME.EXCL.IMPLANT
 *            MINUS diagnostics             → AME.EXCL.DIAG
 *
 *   Gate D — exclude every ICU line unconditionally → PD.ICU
 *            (ICUs have no room categories, so the formula has no referent)
 *
 * Then:
 *   ratio     = min(1, eligibleRoomRentCap / actualRoomRentPerDay)
 *   deduction = Σ over eligible AME lines of applyRatio(line, cap, actual)
 *   PD.LIMIT  — the insurer's total PD recovery must not exceed that figure;
 *               any excess is INCORRECTLY_APPLIED, itemised per line.
 *
 * THE TRAP THIS STEP EXISTS TO AVOID: a line being exempt from proportionate
 * deduction does NOT make it payable. Steps 3, 4, 6 and 7 still apply to it
 * independently. A pharmacy line can be exempt under AME.EXCL.PHARMA and still
 * be lawfully cut under Annexure II in step 3. See project brief §3.
 *
 * Spec: build spec §7.6
 */
export const proportionate: Reducer = (state, ctx) => {
  const gate = evaluateGates(ctx);

  if (gate.kind === 'UNKNOWN') return reportUnknown(state, ctx, gate);

  const findings: Finding[] = [];

  const lines = state.lines.map((line) => {
    if (line.unresolved || line.categoryId === null) return line;

    const category = ctx.rulepack.categories[line.categoryId];
    if (!category) return line;

    const verdict = lineVerdict(line, category, gate, ctx.policy, ctx.rulepack.rounding.mode);

    const { findings: produced, attributed } = classifyCut({
      stepId: 'PROPORTIONATE',
      lineRef: line.lineRef,
      theirRemainingCut: remainingInsurerCut(line, ctx.insurerByLine),
      reasonStep: ctx.insurerByLine.get(line.lineRef)?.reasonStep ?? null,
      lawfulCut: verdict.lawfulCut,
      lawfulClause: PD_LIMIT,
      excessClause: verdict.excessClause,
      arithmetic: arithmetic(verdict.expression, verdict.inputs, verdict.lawfulCut),
      matchTolerancePaise: ctx.rulepack.rounding.matchTolerancePaise,
    });

    findings.push(...produced);

    const marked = attribute(line, attributed);
    return verdict.lawfulCut > 0
      ? reduceLine(marked, 'PROPORTIONATE', subPaise(marked.allowed, verdict.lawfulCut))
      : marked;
  });

  return [{ ...state, lines, payable: sumAllowed(lines) }, findings];
};

/* ---------------------------------------------------------------- the gates */

type Gate =
  /** PD may be applied, at this ratio. */
  | { readonly kind: 'APPLY'; readonly numerator: number; readonly denominator: number }
  /** PD may not be applied at all, and this clause is why. */
  | { readonly kind: 'FORBIDDEN'; readonly clauseId: ClauseId; readonly why: string }
  /** We cannot tell, and will not guess. */
  | {
      readonly kind: 'UNKNOWN';
      readonly reason: 'HOSPITAL_BILLING_MODE_UNKNOWN' | 'MISSING_WORDING_CLAUSE';
      readonly why: string;
      readonly resolvedBy: string;
    };

function evaluateGates(ctx: ReducerContext): Gate {
  const { policy, admission } = ctx;

  // Gate A — is there a proportionate-deduction clause in the wording at all?
  if (policy.hasProportionateDeductionClause === false) {
    return {
      kind: 'FORBIDDEN',
      clauseId: PD_NOCLAUSE,
      why: 'this wording contains no proportionate-deduction clause',
    };
  }
  if (policy.hasProportionateDeductionClause === null) {
    return {
      kind: 'UNKNOWN',
      reason: 'MISSING_WORDING_CLAUSE',
      why: 'we could not establish whether this wording contains a proportionate-deduction clause',
      resolvedBy: 'the policy wording section on room category and associated medical expenses',
    };
  }

  // The circular is only binding on policies it actually reaches. Applying a
  // 2020 bright line to a policy filed in 2017 would be the clearest possible
  // example of a confident wrong answer, so the commencement dates are checked
  // before the exclusions are used.
  const circular = ctx.rulepack.clauses['PD.LIMIT'];
  if (circular && !clauseIsInForce(circular, policy)) {
    return {
      kind: 'UNKNOWN',
      reason: 'MISSING_WORDING_CLAUSE',
      why: `circular ${circular.source} binds products filed from ${circular.appliesFrom} and existing products on renewal from ${circular.appliesToExistingOnRenewalFrom}, and neither date could be established for this policy`,
      resolvedBy:
        'the product filing date or the last renewal date, either of which decides whether the 2020 circular binds this policy',
    };
  }

  // Gate B — differential billing by room category.
  if (admission.hospitalUsesDifferentialBilling === false) {
    return {
      kind: 'FORBIDDEN',
      clauseId: PD_DIFFBILL,
      why: 'this hospital does not bill differentially by room category',
    };
  }
  if (admission.hospitalUsesDifferentialBilling === null) {
    return {
      kind: 'UNKNOWN',
      reason: 'HOSPITAL_BILLING_MODE_UNKNOWN',
      why: 'we could not establish whether this hospital bills differentially by room category',
      resolvedBy: "the hospital's tariff card, or its published room-category rate list",
    };
  }

  const cap = eligibleRoomRentCap(policy);
  if (cap === null || admission.actualRoomRentPerDay === null) {
    return {
      kind: 'UNKNOWN',
      reason: 'MISSING_WORDING_CLAUSE',
      why: 'the proportionate ratio needs both the eligible room rent limit and the rate actually charged',
      resolvedBy:
        'the room rent limit on the policy schedule, and the per-day room rate from the bill',
    };
  }

  const { numerator, denominator } = survivingShare(cap, admission.actualRoomRentPerDay);
  return { kind: 'APPLY', numerator, denominator };
}

/**
 * The 2020 circular binds products filed from 2020-10-01, and existing products
 * on renewal from 2021-04-01. Either route is enough; neither being
 * establishable is not.
 */
function clauseIsInForce(clause: ClauseDefinition, policy: PolicySchedule): boolean {
  const filedInScope =
    clause.appliesFrom !== null &&
    policy.productFiledOn !== null &&
    policy.productFiledOn >= clause.appliesFrom;

  const renewedInScope =
    clause.appliesToExistingOnRenewalFrom !== null &&
    policy.lastRenewedOn !== null &&
    policy.lastRenewedOn >= clause.appliesToExistingOnRenewalFrom;

  return filedInScope || renewedInScope;
}

/* ------------------------------------------------------------- per-line PDs */

interface Verdict {
  readonly lawfulCut: Paise;
  readonly excessClause: ClauseId;
  readonly expression: string;
  readonly inputs: Record<string, number>;
}

function lineVerdict(
  line: LineState,
  category: CategoryDefinition,
  gate: Extract<Gate, { kind: 'APPLY' | 'FORBIDDEN' }>,
  policy: PolicySchedule,
  rounding: RoundingMode,
): Verdict {
  if (gate.kind === 'FORBIDDEN') {
    return {
      lawfulCut: ZERO,
      excessClause: gate.clauseId,
      expression: `no proportionate deduction is permissible here: ${gate.why}`,
      inputs: { lawfulCut: 0 },
      };
  }

  // Gate D, before gate C: ICU is immune whatever the policy's own AME
  // definition says, because a proportionate formula keyed on room category has
  // no referent in a unit that has no categories.
  if (category.proportionateImmune) {
    return {
      lawfulCut: ZERO,
      excessClause: category.ameExclusionClause ?? PD_ICU,
      expression: `${category.label} is immune to proportionate deduction — ICU has no room categories`,
      inputs: { lawfulCut: 0 },
    };
  }

  // Gate C. Two independent ways a line can fall outside the lawful AME base:
  // the circular forbids it, or this policy's own definition never claimed it.
  if (!category.ameEligible) {
    return {
      lawfulCut: ZERO,
      excessClause: category.ameExclusionClause ?? PD_LIMIT,
      expression: `${category.label} may not form part of associated medical expenses`,
      inputs: { lawfulCut: 0 },
    };
  }

  if (!policy.ameDefinitionCategories.includes(category.categoryId)) {
    return {
      lawfulCut: ZERO,
      excessClause: PD_LIMIT,
      expression: `${category.label} is not within this policy's own definition of associated medical expenses`,
      inputs: { lawfulCut: 0 },
    };
  }

  // Inside the lawful base. This is the only place in the engine where a
  // fraction touches money, and the rounding mode comes from the rulepack.
  const surviving = applyRatio(line.allowed, gate.numerator, gate.denominator, rounding);
  const lawfulCut = maxPaise(ZERO, subPaise(line.allowed, surviving));

  return {
    lawfulCut,
    excessClause: PD_LIMIT,
    expression: `${line.allowed} × (1 − ${gate.numerator}/${gate.denominator})`,
    inputs: {
      allowed: line.allowed,
      eligibleCap: gate.numerator,
      actualRate: gate.denominator,
      lawfulCut,
    },
  };
}

/**
 * Where a gate could not be evaluated, every rupee the insurer cut and no
 * earlier step explained is reported as unplaceable, with the document that
 * would settle it. We do not fall back to applying the deduction, and we do not
 * fall back to declaring it unlawful.
 */
function reportUnknown(
  state: Parameters<Reducer>[0],
  ctx: ReducerContext,
  gate: Extract<Gate, { kind: 'UNKNOWN' }>,
): ReturnType<Reducer> {
  const findings: Finding[] = [];

  const lines = state.lines.map((line) => {
    if (line.unresolved) return line;

    const theirCut = remainingInsurerCut(line, ctx.insurerByLine) ?? ZERO;
    if (theirCut <= 0) return line;

    findings.push(
      unresolved({
        stepId: 'PROPORTIONATE',
        lineRef: line.lineRef,
        reason: gate.reason,
        magnitude: theirCut,
        resolvedBy: gate.resolvedBy,
        arithmetic: arithmetic(gate.why, { insurerDeducted: theirCut }, theirCut),
        confidence: 0,
      }),
    );

    return attribute(line, theirCut);
  });

  return [{ ...state, lines, payable: sumAllowed(lines) }, findings];
}

/** Room rent limit as an amount, or derived from its percentage of sum insured. */
function eligibleRoomRentCap(policy: PolicySchedule): Paise | null {
  if (policy.roomRentCapPerDay !== null) return policy.roomRentCapPerDay;
  if (policy.roomRentCapPercentOfSumInsured !== null && policy.sumInsured !== null) {
    return percentOf(policy.sumInsured, policy.roomRentCapPercentOfSumInsured);
  }
  return null;
}
