import type { Bucket, Finding, Paise, Reconciliation } from '@fc/contracts';
import { ZERO, addPaise, negPaise, subPaise, unsafePaise } from '@fc/contracts';
import { ReconciliationResidualError } from '../errors';

/**
 * The zero-sum invariant — the single most important property in the system.
 *
 * Sign convention (the build spec §6.4): `Finding.amount` is negative when it
 * reduces payable. So for a balanced ledger:
 *
 *     observedDelta   = billTotal − actualPaid        (positive: they paid less)
 *     attributedDelta = Σ findings.amount             (negative: our deductions)
 *     residual        = observedDelta + attributedDelta
 *
 * A non-zero residual is a normal outcome, not a bug — it means the insurer cut
 * rupees we cannot account for. We do NOT adjust a number to make it balance.
 * We name the gap as an UNRESOLVED finding and let the UI show it.
 *
 * Every paise is either attributed to a clause we can quote, or explicitly
 * marked unattributed. There is no third state.
 */
export interface BalancedLedger {
  readonly findings: readonly Finding[];
  readonly reconciliation: Reconciliation;
}

export function balanceLedger(
  billTotal: Paise,
  actualPaid: Paise,
  findings: readonly Finding[],
): BalancedLedger {
  const observedDelta = subPaise(billTotal, actualPaid);
  const attributedDelta = addPaise(...findings.map((f) => f.amount));
  const residual = unsafePaise(observedDelta + attributedDelta);

  const out = [...findings];

  if (residual !== 0) {
    out.push({
      findingId: 'RESIDUAL',
      lineRef: null,
      stepId: 'SUM_INSURED',
      clauseId: null,
      bucket: 'UNRESOLVED',
      amount: negPaise(residual),
      unresolvedReason: 'RESIDUAL_UNATTRIBUTED',
      resolvedBy:
        'a complete deduction sheet, or the insurer’s internal reason codes for these lines',
      arithmetic: {
        expression: `observed ${observedDelta} − attributed ${-attributedDelta}`,
        inputs: { observedDelta, attributedDelta },
        result: residual,
      },
      confidence: 1,
    });
  }

  const finalAttributed = addPaise(...out.map((f) => f.amount));
  const finalResidual = unsafePaise(observedDelta + finalAttributed);

  // If this throws, residual materialisation is broken — a bug in this file,
  // not an unexplained rupee in the claim.
  if (finalResidual !== 0) {
    throw new ReconciliationResidualError(
      `ledger failed to balance after residual materialisation: ${finalResidual} paise`,
      finalResidual,
    );
  }

  return {
    findings: out,
    reconciliation: {
      observedDelta,
      attributedDelta: finalAttributed,
      residual: ZERO,
      invariantHeld: true,
      byBucket: sumByBucket(out),
    },
  };
}

export function sumByBucket(findings: readonly Finding[]): Record<Bucket, Paise> {
  const acc: Record<Bucket, Paise> = {
    CORRECTLY_APPLIED: ZERO,
    INCORRECTLY_APPLIED: ZERO,
    UNRESOLVED: ZERO,
  };
  for (const f of findings) {
    acc[f.bucket] = unsafePaise(acc[f.bucket] + f.amount);
  }
  return acc;
}
