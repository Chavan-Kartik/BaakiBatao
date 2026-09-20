/**
 * Turns a reconstruction into what the review screen renders.
 *
 * Two callers: the demo case, which settles the reference claim in the
 * browser (this import of `reconstruct` from @fc/engine is the architectural
 * argument in one line — the same module the API runs, with no fetch), and a
 * case that came back from the API, whose input and result are already
 * computed. Both produce the same view, so the screen does not know which.
 */
import type {
  Finding,
  LineRef,
  Paise,
  ReconstructInput,
  Reconstruction,
  Rulepack,
} from '@fc/contracts';
import { unsafePaise } from '@fc/contracts';
import { matchDeductionSheet, reconstruct } from '@fc/engine';
import { AS_OF, buildInput } from '@fc/fixtures';
import { loadRulepackV1 } from '@fc/rulepack';

export interface LedgerRow {
  readonly index: number;
  readonly lineRef: LineRef;
  readonly desc: string;
  readonly category: string | null;
  readonly tier: string;
  readonly claimed: Paise;
  /** Null when the deduction sheet had no row for this line. */
  readonly insurerPaid: Paise | null;
  /** What the insurer withheld on this line, as a positive magnitude. */
  readonly insurerCut: Paise;
  readonly findings: readonly Finding[];
  /** Positive magnitudes, for display against a column header that carries the sign. */
  readonly disputed: Paise;
  readonly defended: Paise;
  readonly unresolved: Paise;
}

export interface CaseView {
  readonly input: ReconstructInput;
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

function sumWhere(findings: readonly Finding[], bucket: Finding['bucket']): Paise {
  return unsafePaise(
    findings.filter((f) => f.bucket === bucket).reduce((sum, f) => sum + Math.abs(f.amount), 0),
  );
}

export function buildCaseView(
  input: ReconstructInput,
  result: Reconstruction,
  rulepack: Rulepack,
): CaseView {
  const byLine = new Map<LineRef, Finding[]>();
  const claimLevel: Finding[] = [];
  for (const finding of result.findings) {
    if (finding.lineRef === null) {
      claimLevel.push(finding);
      continue;
    }
    const bucketed = byLine.get(finding.lineRef) ?? [];
    bucketed.push(finding);
    byLine.set(finding.lineRef, bucketed);
  }

  const insurer = matchDeductionSheet(
    input.billTable,
    input.deductionTable,
    rulepack.rounding.matchTolerancePaise,
  ).byLine;
  const normalised = new Map(input.normalisedLines.map((n) => [n.lineRef, n]));

  const rows: LedgerRow[] = input.billTable.rows.map((row, index) => {
    const findings = byLine.get(row.lineRef) ?? [];
    const theirs = insurer.get(row.lineRef);
    const norm = normalised.get(row.lineRef);
    return {
      index,
      lineRef: row.lineRef,
      desc: row.rawDescription,
      category: norm?.categoryId ?? null,
      tier: norm?.tier ?? 'UNRESOLVED',
      claimed: row.amountClaimed,
      insurerPaid: theirs?.paid ?? null,
      insurerCut: theirs?.deducted ?? unsafePaise(0),
      findings,
      disputed: sumWhere(findings, 'INCORRECTLY_APPLIED'),
      defended: sumWhere(findings, 'CORRECTLY_APPLIED'),
      unresolved: sumWhere(findings, 'UNRESOLVED'),
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
    input,
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

/** The reference claim, settled here in the browser. */
export function buildDemoCaseView(): CaseView {
  const rulepack = loadRulepackV1();
  const input = buildInput();
  return buildCaseView(input, reconstruct({ input, rulepack, now: AS_OF }), rulepack);
}

/** A finding's line, for the panel. */
export function describeLine(view: CaseView, ref: LineRef | null): string | null {
  if (ref === null) return null;
  return view.rows.find((r) => r.lineRef === ref)?.desc ?? null;
}
