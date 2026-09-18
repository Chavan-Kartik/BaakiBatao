import type { ClauseId, Finding, Paise } from '@fc/contracts';
import { ZERO, addPaise, maxPaise, minPaise, subPaise } from '@fc/contracts';
import type { Reducer } from '../types';
import type { ClaimLevelCut } from '../insurer';
import { cut, arithmetic } from '../findings';
import { percentOf } from '../money';

const COPAY_PCT: ClauseId = 'COPAY.PCT' as ClauseId;
const DEDUCT_AMT: ClauseId = 'DEDUCT.AMT' as ClauseId;

type Lever = 'DEDUCTIBLE' | 'COPAY';

/**
 * Step 6 — Co-pay and deductible.
 *
 * The order comes from `params.order` and is genuinely insurer-specific: some
 * wordings apply co-pay before the deductible, others after, and the two
 * produce different answers.
 *
 * That is why the order lives in the rulepack rather than in this file. Insurer
 * wording differences are configuration, not a code branch.
 *
 * The arithmetic string records which order was used, so the UI can show
 * "deductible first, then co-pay, per clause 4.2 of your wording".
 *
 * Emits: COPAY.PCT · COPAY.ZONE · DEDUCT.AMT
 *
 * Spec: build spec §7.7
 */
export const copayDeductible: Reducer = (state, ctx) => {
  const order = readOrder(ctx.params);
  const findings: Finding[] = [];

  // Claim-level, not per-line: a deductible is borne against the claim as a
  // whole, so there is no line to attribute it to and `lineRef` stays null.
  let running: Paise = state.payable;

  for (const lever of order) {
    const applied = lever === 'DEDUCTIBLE' ? deductible(running, ctx) : copay(running, ctx);
    if (applied === null) continue;

    // What the insurer actually took under this lever, from the sheet's own
    // summary row. Where they took less than the wording entitled them to, the
    // smaller figure is what we defend — they were allowed to take more and
    // chose not to, which is not a dispute. Where the sheet shows no such row
    // at all, they did not apply it, so there is nothing to defend.
    const theirs = claimLevelTotal(ctx.insurerClaimLevel, lever);
    const defensible = minPaise(theirs, applied.magnitude);

    if (defensible > 0) {
      findings.push(
        cut({
          stepId: 'COPAY_DEDUCTIBLE',
          lineRef: null,
          clauseId: applied.clauseId,
          bucket: 'CORRECTLY_APPLIED',
          magnitude: defensible,
          arithmetic: arithmetic(
            `${applied.expression} — applied in the order ${order.join(' then ')}`,
            { balanceBefore: running, insurerApplied: theirs, ...applied.inputs },
            defensible,
          ),
        }),
      );
    }

    // Our own balance falls by the lawful figure, not by theirs. `payable` is
    // the independent reconstruction — the number we would defend in a letter —
    // and it must not inherit an error the insurer made upstream of this step.
    running = subPaise(running, applied.magnitude);
  }

  return [{ ...state, payable: running }, findings];
};

const claimLevelTotal = (cuts: readonly ClaimLevelCut[], lever: Lever): Paise =>
  addPaise(...cuts.filter((c) => c.kind === lever).map((c) => c.amount));

interface Applied {
  readonly clauseId: ClauseId;
  readonly magnitude: Paise;
  readonly expression: string;
  readonly inputs: Record<string, number>;
}

/**
 * The deductible cannot exceed the balance it is applied to. Without the clamp
 * a deductible larger than the surviving balance would produce a negative
 * payable, and the reconciliation would then report the insurer as owing a
 * refund it does not owe.
 */
function deductible(running: Paise, ctx: Parameters<Reducer>[1]): Applied | null {
  const amount = ctx.policy.deductible;
  if (amount === null || amount <= 0) return null;

  const magnitude = minPaise(amount, maxPaise(ZERO, running));
  if (magnitude <= 0) return null;

  return {
    clauseId: DEDUCT_AMT,
    magnitude,
    expression: `deductible of ${amount} paise against a balance of ${running}`,
    inputs: { deductible: amount },
  };
}

function copay(running: Paise, ctx: Parameters<Reducer>[1]): Applied | null {
  const percent = ctx.policy.copayPercent;
  if (percent === null || percent <= 0) return null;

  const base = maxPaise(ZERO, running);
  const magnitude = percentOf(base, percent);
  if (magnitude <= 0) return null;

  return {
    clauseId: COPAY_PCT,
    magnitude,
    expression: `co-pay of ${percent}% on ${base} paise`,
    inputs: { copayPercent: percent, base },
  };
}

/**
 * A malformed order is a broken rulepack, not something to paper over. Silently
 * defaulting it would change the answer on a real claim while every test still
 * passed, because both orders produce a plausible-looking number.
 */
function readOrder(params: Record<string, unknown>): readonly Lever[] {
  const raw = params['order'];

  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    !raw.every((x): x is Lever => x === 'DEDUCTIBLE' || x === 'COPAY') ||
    new Set(raw).size !== raw.length
  ) {
    throw new RangeError(
      `copay/deductible: params.order must be a non-repeating list of "DEDUCTIBLE" and "COPAY", got ${JSON.stringify(raw)}`,
    );
  }

  return raw;
}
