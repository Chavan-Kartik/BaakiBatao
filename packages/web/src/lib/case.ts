/**
 * Settles the reference claim in the browser.
 *
 * This module is the whole architectural argument in one file: it imports
 * `reconstruct` from @fc/engine — the same module the Lambda authority runs —
 * and calls it directly. There is no fetch, no API client and no serialised
 * result baked at build time. If the engine had reached for the AWS SDK or a
 * Node built-in, this import would not resolve, which is why purity is
 * enforced by a required CI check rather than by convention.
 */
import type { Finding, LineRef, Paise, Reconstruction, Rulepack } from '@fc/contracts';
import { unsafePaise } from '@fc/contracts';
import { reconstruct } from '@fc/engine';
import { AS_OF, LINES, buildInput } from '@fc/fixtures';
import { loadRulepackV1 } from '@fc/rulepack';

export interface LedgerRow {
  readonly index: number;
  readonly desc: string;
  readonly category: string;
  readonly claimed: Paise;
  readonly insurerPaid: Paise;
  /** What the insurer withheld on this line, as a positive magnitude. */
  readonly insurerCut: Paise;
  readonly findings: readonly Finding[];
  /** Positive magnitudes, for display against a column header that carries the sign. */
  readonly disputed: Paise;
  readonly defended: Paise;
}

export interface CaseView {
  readonly result: Reconstruction;
  readonly rulepack: Rulepack;
  readonly rows: readonly LedgerRow[];
  /** Findings with no line of their own: the deductible, the co-pay, the residual. */
  readonly claimLevel: readonly Finding[];
  readonly billTotal: Paise;
  readonly actualPaid: Paise;
  readonly expectedPayable: Paise;
  /** expectedPayable − actualPaid. What the policyholder is short. */
  readonly shortfall: Paise;
  /** The gross unlawful deduction, before the co-pay that rides on it. */
  readonly disputedGross: Paise;
  /** Null when the schedule carries no co-pay, in which case nothing rides on a restored cut. */
  readonly copayPercent: number | null;
  readonly copayOnRestored: Paise;
  /** What we will actually argue for, with a clause attached to every rupee. */
  readonly recoverable: Paise;
  readonly defendedTotal: Paise;
  /** Withheld with no reason stated. We ask, rather than assert. */
  readonly unexplained: Paise;
}

/** `doc-bill:1:7` → `7`. Findings carry the ref; the index is how we join. */
function lineIndex(ref: LineRef | null): number | null {
  if (ref === null) return null;
  const parsed = Number(ref.split(':')[2]);
  return Number.isInteger(parsed) ? parsed : null;
}

function sumWhere(findings: readonly Finding[], bucket: Finding['bucket']): Paise {
  return unsafePaise(
    findings.filter((f) => f.bucket === bucket).reduce((sum, f) => sum + Math.abs(f.amount), 0),
  );
}

export function buildCaseView(): CaseView {
  const rulepack = loadRulepackV1();
  const input = buildInput();
  const result = reconstruct({ input, rulepack, now: AS_OF });

  const byLine = new Map<number, Finding[]>();
  const claimLevel: Finding[] = [];

  for (const finding of result.findings) {
    const index = lineIndex(finding.lineRef ?? null);
    if (index === null) {
      claimLevel.push(finding);
      continue;
    }
    const bucketed = byLine.get(index) ?? [];
    bucketed.push(finding);
    byLine.set(index, bucketed);
  }

  const rows: LedgerRow[] = LINES.map((line, index) => {
    const findings = byLine.get(index) ?? [];
    const claimed = unsafePaise(line.claimed * 100);
    const insurerPaid = unsafePaise(line.paid * 100);

    return {
      index,
      desc: line.desc,
      category: line.category,
      claimed,
      insurerPaid,
      insurerCut: unsafePaise(claimed - insurerPaid),
      findings,
      disputed: sumWhere(findings, 'INCORRECTLY_APPLIED'),
      defended: sumWhere(findings, 'CORRECTLY_APPLIED'),
    };
  });

  const { byBucket } = result.reconciliation;
  const disputedGross = unsafePaise(Math.abs(byBucket.INCORRECTLY_APPLIED));
  const copayPercent = input.policy.copayPercent;

  /**
   * Restoring an unlawful deduction also restores the lawful co-pay that would
   * have applied to it. Asking for the gross figure would overstate the claim,
   * and an insurer would be right to refuse it — so the headline number is net.
   */
  const copayOnRestored = unsafePaise(
    copayPercent === null ? 0 : Math.round((disputedGross * copayPercent) / 100),
  );

  return {
    result,
    rulepack,
    rows,
    claimLevel,
    billTotal: result.billTotal,
    actualPaid: result.actualPaid,
    expectedPayable: result.expectedPayable,
    shortfall: unsafePaise(result.expectedPayable - result.actualPaid),
    disputedGross,
    copayPercent,
    copayOnRestored,
    recoverable: unsafePaise(disputedGross - copayOnRestored),
    defendedTotal: unsafePaise(Math.abs(byBucket.CORRECTLY_APPLIED)),
    unexplained: unsafePaise(Math.abs(byBucket.UNRESOLVED)),
  };
}
