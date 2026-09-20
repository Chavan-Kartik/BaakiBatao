import type { ControlKind, EvalSummary, PerClauseScore, Profile } from '../types';

/**
 * The detection-rate baseline the regression gate compares against (§24).
 *
 * These are numbers against a *generated* corpus with injected faults, not a
 * claim about real-world accuracy — see fixtures/corpus/PROVENANCE.md. What
 * they are good for is exactly what a gate needs: if a change to a step, a
 * clause or the step order starts missing a fault it used to catch, or starts
 * disputing a lawful deduction, the build says so.
 */
export interface Baseline {
  readonly profile: Profile;
  readonly packs: number;
  readonly faults: number;
  readonly detected: number;
  readonly controlPassRate: number;
  readonly controlFalsePositiveRate: number;
  readonly perClause: readonly PerClauseScore[];
  /** Zero-fault packs that demonstrated each lawful deduction. */
  readonly controlCoverage: Readonly<Record<ControlKind, number>>;
  readonly generatedAt: string;
}

export const toBaseline = (summary: EvalSummary, generatedAt: string): Baseline => ({
  profile: summary.profile,
  packs: summary.packs,
  faults: summary.faults,
  detected: summary.detected,
  controlPassRate: summary.controlPassRate,
  controlFalsePositiveRate: summary.controlFalsePositiveRate,
  perClause: summary.perClause,
  controlCoverage: summary.controlCoverage,
  generatedAt,
});

const EPSILON = 1e-9;
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

/**
 * Every way the current run is worse than the baseline. Empty means the gate
 * passes. Regressions are reported as sentences, because a gate that fails with
 * a bare exit code gets disabled rather than fixed.
 */
export function compareToBaseline(baseline: Baseline, summary: EvalSummary): string[] {
  const failures: string[] = [];

  // A lawful deduction flagged as unlawful is the failure this product cannot
  // afford: it is a wrong claim made in writing. It is checked first and with
  // no tolerance.
  if (summary.controlFalsePositiveRate > baseline.controlFalsePositiveRate + EPSILON) {
    failures.push(
      `control false-positive rate regressed: ${pct(summary.controlFalsePositiveRate)} of lawful ` +
        `control packs now carry a dispute, baseline ${pct(baseline.controlFalsePositiveRate)}`,
    );
  }

  const rate = (s: { detected: number; faults: number }): number =>
    s.faults === 0 ? 1 : s.detected / s.faults;

  if (rate(summary) + EPSILON < rate(baseline)) {
    failures.push(
      `detection rate regressed: ${summary.detected}/${summary.faults} faults detected ` +
        `(${pct(rate(summary))}), baseline ${baseline.detected}/${baseline.faults} (${pct(rate(baseline))})`,
    );
  }

  const now = new Map(summary.perClause.map((c) => [c.clauseId, c]));

  for (const was of baseline.perClause) {
    const is = now.get(was.clauseId);
    if (!is) {
      failures.push(`clause ${was.clauseId} is no longer detected at all (baseline tp=${was.tp})`);
      continue;
    }
    if (is.recall + EPSILON < was.recall) {
      failures.push(
        `clause ${was.clauseId} recall regressed: ${is.recall.toFixed(2)} (tp=${is.tp} fn=${is.fn}), ` +
          `baseline ${was.recall.toFixed(2)}`,
      );
    }
    if (is.precision + EPSILON < was.precision) {
      failures.push(
        `clause ${was.clauseId} precision regressed: ${is.precision.toFixed(2)} (fp=${is.fp}), ` +
          `baseline ${was.precision.toFixed(2)}`,
      );
    }
  }

  for (const is of summary.perClause) {
    if (is.fp > 0 && !baseline.perClause.some((was) => was.clauseId === is.clauseId)) {
      failures.push(
        `new false positives under ${is.clauseId} (fp=${is.fp}), which no baseline pack disputed`,
      );
    }
  }

  // The control set is only evidence while it contains the deductions it
  // claims to. A lawful cut that stops appearing in any zero-fault pack has
  // silently left the measured set, and a 0% false-positive rate over a set
  // that no longer contains co-pay says nothing about co-pay.
  for (const [control, was] of Object.entries(baseline.controlCoverage ?? {})) {
    const is = summary.controlCoverage[control as ControlKind] ?? 0;
    if (was > 0 && is === 0) {
      failures.push(
        `control ${control} is no longer demonstrated by any zero-fault pack (baseline ${was} packs)`,
      );
    }
  }

  return failures;
}