import type { ClauseId, Finding, Paise, Reconstruction } from '@fc/contracts';
import { unsafePaise } from '@fc/contracts';
import type { EvalSummary, FaultKind, FaultedPack, PerClauseScore } from '../types';

const TOLERANCE_PAISE = 100;

/** What the scorer decided about one injected fault. */
export interface FaultOutcome {
  readonly seed: number;
  readonly caseId: string;
  readonly kind: FaultKind;
  readonly clauseId: ClauseId;
  /** The unlawful rupees the operator injected (positive magnitude). */
  readonly injectedPaise: Paise;
  readonly detected: boolean;
  /** The matched dispute's magnitude, when detected. */
  readonly citedPaise: Paise | null;
  /** |cited − injected| in paise, when detected. */
  readonly attributionErrorPaise: Paise | null;
}

export interface ScoreDetail {
  readonly summary: EvalSummary;
  /** One row per injected fault, in pack order. Control packs contribute none. */
  readonly outcomes: readonly FaultOutcome[];
}

/**
 * Per-clause precision/recall (§20.6) plus the control false-positive rate
 * (§20.3) and paise-level attribution error (§20.7).
 *
 * Detection rule: a fault counts as detected when the reconstruction carries
 * an INCORRECTLY_APPLIED finding citing the same clause with an amount within
 * ₹1 of the injected magnitude. A finding citing a clause no fault injected is
 * a false positive. Matching is per pack, greedy on clause then amount.
 */
export function scorePacksDetailed(
  packs: readonly FaultedPack[],
  results: readonly Reconstruction[],
): ScoreDetail {
  const tpBy = new Map<string, number>();
  const fpBy = new Map<string, number>();
  const fnBy = new Map<string, number>();
  let controlPacks = 0;
  let controlClean = 0;
  const attrErrors: number[] = [];
  const outcomes: FaultOutcome[] = [];

  packs.forEach((pack, pi) => {
    const result = results[pi];
    if (!result) throw new Error(`scorePacks: missing result for pack ${pi}`);
    if (pack.faults.length === 0) {
      controlPacks += 1;
      const flagged = result.findings.some((f) => f.bucket === 'INCORRECTLY_APPLIED');
      if (!flagged) controlClean += 1;
    }

    const disputed: Finding[] = result.findings.filter((f) => f.bucket === 'INCORRECTLY_APPLIED');
    const used = new Set<number>();
    for (const fault of pack.faults) {
      let best = -1;
      let bestErr = Number.POSITIVE_INFINITY;
      disputed.forEach((f, fi) => {
        if (used.has(fi) || f.clauseId !== fault.clauseId) return;
        const err = Math.abs(Math.abs(f.amount) - fault.amountPaise);
        if (err < bestErr) {
          bestErr = err;
          best = fi;
        }
      });
      const detected = best >= 0 && bestErr <= TOLERANCE_PAISE;
      if (detected) {
        const cited = Math.abs(disputed[best]?.amount ?? 0);
        used.add(best);
        tpBy.set(fault.clauseId, (tpBy.get(fault.clauseId) ?? 0) + 1);
        attrErrors.push(bestErr);
        outcomes.push({
          seed: pack.seed,
          caseId: pack.caseId,
          kind: fault.kind,
          clauseId: fault.clauseId,
          injectedPaise: fault.amountPaise,
          detected: true,
          citedPaise: unsafePaise(cited),
          attributionErrorPaise: unsafePaise(bestErr),
        });
      } else {
        fnBy.set(fault.clauseId, (fnBy.get(fault.clauseId) ?? 0) + 1);
        outcomes.push({
          seed: pack.seed,
          caseId: pack.caseId,
          kind: fault.kind,
          clauseId: fault.clauseId,
          injectedPaise: fault.amountPaise,
          detected: false,
          citedPaise: null,
          attributionErrorPaise: null,
        });
      }
    }
    disputed.forEach((f, fi) => {
      if (used.has(fi) || f.clauseId === null) return;
      fpBy.set(f.clauseId, (fpBy.get(f.clauseId) ?? 0) + 1);
    });
  });

  const clauses = [...new Set([...tpBy.keys(), ...fpBy.keys(), ...fnBy.keys()])].sort();
  const perClause: PerClauseScore[] = clauses.map((clauseId) => {
    const tp = tpBy.get(clauseId) ?? 0;
    const fp = fpBy.get(clauseId) ?? 0;
    const fn = fnBy.get(clauseId) ?? 0;
    return {
      clauseId, tp, fp, fn,
      precision: tp + fp === 0 ? 1 : tp / (tp + fp),
      recall: tp + fn === 0 ? 1 : tp / (tp + fn),
    };
  });

  const faults = packs.reduce((s, p) => s + p.faults.length, 0);
  const detected = [...tpBy.values()].reduce((s, n) => s + n, 0);

  return {
    summary: {
      packs: packs.length,
      faults,
      detected,
      perClause,
      controlPassRate: controlPacks === 0 ? 1 : controlClean / controlPacks,
      controlFalsePositiveRate: controlPacks === 0 ? 0 : 1 - controlClean / controlPacks,
      meanAttributionErrorPaise:
        attrErrors.length === 0 ? 0 : attrErrors.reduce((s, e) => s + e, 0) / attrErrors.length,
    },
    outcomes,
  };
}

/** Summary-only view; see scorePacksDetailed for the per-fault rows. */
export function scorePacks(
  packs: readonly FaultedPack[],
  results: readonly Reconstruction[],
): EvalSummary {
  return scorePacksDetailed(packs, results).summary;
}
