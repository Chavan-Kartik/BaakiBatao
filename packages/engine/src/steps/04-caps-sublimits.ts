import type { ClauseId, Finding, Paise, PolicySchedule, SubLimit } from '@fc/contracts';
import { ZERO, maxPaise, subPaise, unsafePaise } from '@fc/contracts';
import type { Reducer } from '../types';
import type { LineState, ReducerContext } from '../state';
import { attribute, reduceLine, remainingInsurerCut, sumAllowed } from '../state';
import { arithmetic, classifyCut, unresolved } from '../findings';
import { percentOf } from '../money';

const LIMIT_ROOM: ClauseId = 'LIMIT.ROOM' as ClauseId;
const LIMIT_ICU: ClauseId = 'LIMIT.ICU' as ClauseId;

/**
 * Step 4 — Caps and sub-limits.
 *
 * Read from THIS schedule, never a generic template. Room rent per day, ICU per
 * day, disease-wise and procedure-wise sub-limits, ambulance, pre/post
 * hospitalisation.
 *
 * If a cap the deduction sheet appears to rely on is absent from the extracted
 * schedule, that is UNRESOLVED / MISSING_POLICY_SCHEDULE — never an assumption
 * that the cap does not exist.
 *
 * Emits: LIMIT.ROOM · LIMIT.ICU · LIMIT.DISEASE · LIMIT.PROC · LIMIT.AMBULANCE
 *
 * Spec: build spec §7.5
 */
export const capsSublimits: Reducer = (state, ctx) => {
  const findings: Finding[] = [];

  const lines = state.lines.map((line) => {
    if (line.unresolved || line.categoryId === null) return line;

    const cap = resolveCap(line, ctx);
    if (cap === null) return line;

    // The distinction that makes this step honest. A cap we could not read is
    // not a cap that does not exist. Treating an unextracted room rent limit as
    // "no limit" would hand the policyholder a confident claim that the entire
    // room rent cut was unlawful, which is the single most likely way this
    // product could embarrass someone in front of an insurer.
    if (cap.kind === 'UNKNOWN') {
      const theirCut = remainingInsurerCut(line, ctx.insurerByLine) ?? ZERO;
      if (theirCut <= 0) return line;

      findings.push(
        unresolved({
          stepId: 'CAPS_SUBLIMITS',
          lineRef: line.lineRef,
          reason: 'MISSING_POLICY_SCHEDULE',
          magnitude: theirCut,
          resolvedBy: cap.resolvedBy,
          arithmetic: arithmetic(
            `insurer cut ${theirCut} paise from ${line.rawDescription}, but ${cap.missing} could not be read from the schedule`,
            { insurerDeducted: theirCut },
            theirCut,
          ),
          confidence: 0,
        }),
      );

      // Their cut is now accounted for — as unplaceable, not as defensible —
      // so a later step must not attribute the same rupees to a clause.
      return attribute(line, theirCut);
    }

    const lawfulCut = maxPaise(ZERO, subPaise(line.allowed, cap.amount));

    const { findings: produced, attributed } = classifyCut({
      stepId: 'CAPS_SUBLIMITS',
      lineRef: line.lineRef,
      theirRemainingCut: remainingInsurerCut(line, ctx.insurerByLine),
      reasonStep: ctx.insurerByLine.get(line.lineRef)?.reasonStep ?? null,
      lawfulCut,
      lawfulClause: cap.clauseId,
      excessClause: cap.clauseId,
      arithmetic: arithmetic(cap.expression, cap.inputs, lawfulCut),
      matchTolerancePaise: ctx.rulepack.rounding.matchTolerancePaise,
    });

    findings.push(...produced);

    const marked = attribute(line, attributed);
    return lawfulCut > 0
      ? reduceLine(marked, 'CAPS_SUBLIMITS', subPaise(marked.allowed, lawfulCut))
      : marked;
  });

  return [{ ...state, lines, payable: sumAllowed(lines) }, findings];
};

type Cap =
  | {
      readonly kind: 'AMOUNT';
      readonly amount: Paise;
      readonly clauseId: ClauseId;
      readonly expression: string;
      readonly inputs: Record<string, number>;
    }
  | { readonly kind: 'UNKNOWN'; readonly missing: string; readonly resolvedBy: string };

/**
 * Which cap governs this line. Room rent and ICU are named in the schedule's
 * own fields; everything else comes from the sub-limit list, which is why a
 * disease-wise limit is data rather than another branch in this function.
 */
function resolveCap(line: LineState, ctx: ReducerContext): Cap | null {
  const { policy, admission } = ctx;

  if (line.categoryId === 'ROOM_RENT') {
    return perDayCap({
      label: 'room rent',
      perDay: effectiveRoomRentCap(policy),
      days: admission.roomDays,
      clauseId: LIMIT_ROOM,
      resolvedBy:
        'the room rent limit on the policy schedule, and the number of non-ICU days from the bill',
    });
  }

  if (line.categoryId === 'ICU_CHARGE') {
    return perDayCap({
      label: 'ICU charges',
      perDay: policy.icuCapPerDay,
      days: admission.icuDays,
      clauseId: LIMIT_ICU,
      resolvedBy: 'the ICU limit on the policy schedule, and the number of ICU days from the bill',
    });
  }

  const subLimit = policy.subLimits.find((s) => s.appliesToCategories.includes(line.categoryId!));
  if (!subLimit) return null;

  return subLimitCap(subLimit, policy, admission.roomDays);
}

/**
 * Room rent may be stated as an amount or as a percentage of sum insured. Where
 * both are present the schedule's own amount wins, because a printed figure is
 * what the policyholder was sold.
 */
function effectiveRoomRentCap(policy: PolicySchedule): Paise | null {
  if (policy.roomRentCapPerDay !== null) return policy.roomRentCapPerDay;
  if (policy.roomRentCapPercentOfSumInsured !== null && policy.sumInsured !== null) {
    return percentOf(policy.sumInsured, policy.roomRentCapPercentOfSumInsured);
  }
  return null;
}

function perDayCap(a: {
  label: string;
  perDay: Paise | null;
  days: number | null;
  clauseId: ClauseId;
  resolvedBy: string;
}): Cap {
  if (a.perDay === null || a.days === null) {
    return {
      kind: 'UNKNOWN',
      missing: a.perDay === null ? `the ${a.label} per-day limit` : `the number of ${a.label} days`,
      resolvedBy: a.resolvedBy,
    };
  }

  return {
    kind: 'AMOUNT',
    amount: unsafePaise(a.perDay * a.days),
    clauseId: a.clauseId,
    expression: `${a.label} capped at ${a.perDay} paise/day × ${a.days} days`,
    inputs: { perDay: a.perDay, days: a.days },
  };
}

function subLimitCap(s: SubLimit, policy: PolicySchedule, days: number | null): Cap {
  const base =
    s.capAmount ??
    (s.capPercentOfSumInsured !== null && policy.sumInsured !== null
      ? percentOf(policy.sumInsured, s.capPercentOfSumInsured)
      : null);

  if (base === null) {
    return {
      kind: 'UNKNOWN',
      missing: `the cap amount for ${s.label}`,
      resolvedBy: `the ${s.label} sub-limit on the policy schedule`,
    };
  }

  if (!s.perDay) {
    return {
      kind: 'AMOUNT',
      amount: base,
      clauseId: s.clauseId,
      expression: `${s.label} capped at ${base} paise`,
      inputs: { cap: base },
    };
  }

  if (days === null) {
    return {
      kind: 'UNKNOWN',
      missing: `the number of days for the per-day ${s.label} sub-limit`,
      resolvedBy: 'the length of stay from the bill',
    };
  }

  return {
    kind: 'AMOUNT',
    amount: unsafePaise(base * days),
    clauseId: s.clauseId,
    expression: `${s.label} capped at ${base} paise/day × ${days} days`,
    inputs: { perDay: base, days },
  };
}
