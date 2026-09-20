import type { ClauseId, Finding, LineRef, Paise, ReconstructInput, Reconstruction } from '@fc/contracts';
import { unsafePaise } from '@fc/contracts';
import { matchDeductionSheet } from '@fc/engine';
import { loadRulepackV1 } from '@fc/rulepack';
import type {
  Archetype,
  EvalSummary,
  FaultKind,
  FaultedPack,
  MissReason,
  PerClauseScore,
  Profile,
} from '../types';
import { ARCHETYPES, CONTROL_KINDS } from '../types';

const TOLERANCE_PAISE = 100;
const rulepack = loadRulepackV1();

/** What the scorer decided about one injected fault. */
export interface FaultOutcome {
  readonly seed: number;
  readonly caseId: string;
  readonly archetype: Archetype;
  readonly kind: FaultKind;
  readonly clauseId: ClauseId;
  readonly lineRef: LineRef | null;
  /** The unlawful rupees the operator injected (positive magnitude). */
  readonly injectedPaise: Paise;
  /** The lawful figure the fault exceeds, where the operator computed one. */
  readonly lawfulBoundPaise: Paise | null;
  readonly detected: boolean;
  /** The matched dispute's magnitude, when detected. */
  readonly citedPaise: Paise | null;
  /** |cited − injected| in paise, when detected. */
  readonly attributionErrorPaise: Paise | null;
  /** Why it was missed, when it was. */
  readonly missReason: MissReason | null;
}

export interface ScoreDetail {
  readonly summary: EvalSummary;
  /** One row per injected fault, in pack order. Control packs contribute none. */
  readonly outcomes: readonly FaultOutcome[];
}

export interface ScoreOptions {
  readonly profile: Profile;
  /**
   * The inputs the engine was actually run on, when they differ from
   * `pack.input` — the degraded profile substitutes perturbed rows. Used to
   * tell an unmatched sheet row from an engine miss.
   */
  readonly inputs?: readonly ReconstructInput[];
}

/**
 * Per-clause precision/recall (§20.6) plus the control false-positive rate
 * (§20.3) and paise-level attribution error (§20.7).
 *
 * Detection rule: a fault counts as detected when the reconstruction carries an
 * INCORRECTLY_APPLIED finding citing the same clause, on the same bill line
 * when the fault is line-level, with an amount within ₹1 of the injected
 * magnitude. A dispute no fault accounts for is a false positive.
 *
 * Matching within a pack is an exact assignment, not a greedy pass: the
 * pairing that detects the most faults, and among those the one with the least
 * total attribution error. Greedy matching can hand the first fault the dispute
 * the second one needed and then score the second as a miss the engine did not
 * make. Packs carry at most three faults, so the search is a few hundred
 * combinations at worst.
 */
export function scorePacksDetailed(
  packs: readonly FaultedPack[],
  results: readonly Reconstruction[],
  options: ScoreOptions = { profile: 'clean' },
): ScoreDetail {
  const tpBy = new Map<string, number>();
  const fpBy = new Map<string, number>();
  const fnBy = new Map<string, number>();
  let controlPacks = 0;
  let controlClean = 0;
  const controlCoverage = zeroed(CONTROL_KINDS);
  const missesByReason: Record<MissReason, number> = { GATED: 0, UNMATCHED: 0, ENGINE: 0 };
  const byArchetype = Object.fromEntries(
    ARCHETYPES.map((a) => [a, { packs: 0, faults: 0, detected: 0 }]),
  ) as Record<Archetype, { packs: number; faults: number; detected: number }>;
  const attrErrors: number[] = [];
  const outcomes: FaultOutcome[] = [];
  let lines = 0;
  let gatedLines = 0;
  let unmatchedLines = 0;

  packs.forEach((pack, pi) => {
    const result = results[pi];
    if (!result) throw new Error(`scorePacks: missing result for pack ${pi}`);
    const input = options.inputs?.[pi] ?? pack.input;

    const arch = byArchetype[pack.archetype];
    arch.packs += 1;
    arch.faults += pack.faults.length;

    if (pack.faults.length === 0) {
      controlPacks += 1;
      const flagged = result.findings.some((f) => f.bucket === 'INCORRECTLY_APPLIED');
      if (!flagged) controlClean += 1;
      for (const c of pack.controls) controlCoverage[c] += 1;
    }

    // Where each bill line ended up: gated by step 2, or with no sheet row to
    // classify against. Both are reasons a fault can be missed that say nothing
    // about the waterfall, and the report has to separate them from the ones
    // that do.
    const gated = new Set<LineRef>(
      result.findings
        .filter((f) => f.stepId === 'NORMALISATION_GATE' && f.bucket === 'UNRESOLVED' && f.lineRef !== null)
        .map((f) => f.lineRef as LineRef),
    );
    const matched = matchDeductionSheet(
      input.billTable,
      input.deductionTable,
      rulepack.rounding.matchTolerancePaise,
    ).byLine;
    lines += input.billTable.rows.length;
    gatedLines += gated.size;
    unmatchedLines += input.billTable.rows.filter((r) => !matched.has(r.lineRef)).length;

    const disputed: Finding[] = result.findings.filter((f) => f.bucket === 'INCORRECTLY_APPLIED');
    const assignment = bestAssignment(pack.faults, disputed);

    pack.faults.forEach((fault, fi) => {
      const di = assignment[fi] ?? -1;
      const dispute = di >= 0 ? disputed[di] : undefined;
      const base = {
        seed: pack.seed,
        caseId: pack.caseId,
        archetype: pack.archetype,
        kind: fault.kind,
        clauseId: fault.clauseId,
        lineRef: fault.lineRef,
        injectedPaise: fault.amountPaise,
        lawfulBoundPaise: fault.lawfulBoundPaise,
      };

      if (dispute) {
        const cited = Math.abs(dispute.amount);
        const err = Math.abs(cited - fault.amountPaise);
        tpBy.set(fault.clauseId, (tpBy.get(fault.clauseId) ?? 0) + 1);
        arch.detected += 1;
        attrErrors.push(err);
        outcomes.push({
          ...base,
          detected: true,
          citedPaise: unsafePaise(cited),
          attributionErrorPaise: unsafePaise(err),
          missReason: null,
        });
      } else {
        const reason: MissReason =
          fault.lineRef !== null && gated.has(fault.lineRef) ? 'GATED'
          : fault.lineRef !== null && !matched.has(fault.lineRef) ? 'UNMATCHED'
          : 'ENGINE';
        fnBy.set(fault.clauseId, (fnBy.get(fault.clauseId) ?? 0) + 1);
        missesByReason[reason] += 1;
        outcomes.push({
          ...base,
          detected: false,
          citedPaise: null,
          attributionErrorPaise: null,
          missReason: reason,
        });
      }
    });

    const used = new Set(assignment.filter((d) => d >= 0));
    disputed.forEach((f, di) => {
      if (used.has(di) || f.clauseId === null) return;
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
      profile: options.profile,
      packs: packs.length,
      faults,
      detected,
      perClause,
      controlPassRate: controlPacks === 0 ? 1 : controlClean / controlPacks,
      controlFalsePositiveRate: controlPacks === 0 ? 0 : 1 - controlClean / controlPacks,
      controlCoverage,
      meanAttributionErrorPaise:
        attrErrors.length === 0 ? 0 : attrErrors.reduce((s, e) => s + e, 0) / attrErrors.length,
      gatedLineRate: lines === 0 ? 0 : gatedLines / lines,
      unmatchedLineRate: lines === 0 ? 0 : unmatchedLines / lines,
      missesByReason,
      byArchetype,
    },
    outcomes,
  };
}

/** Summary-only view; see scorePacksDetailed for the per-fault rows. */
export function scorePacks(
  packs: readonly FaultedPack[],
  results: readonly Reconstruction[],
  options: ScoreOptions = { profile: 'clean' },
): EvalSummary {
  return scorePacksDetailed(packs, results, options).summary;
}

/* ------------------------------------------------------------- assignment */

/** Cost of pairing a fault with a dispute, or null when they cannot be paired. */
export function pairCost(
  fault: { clauseId: ClauseId; lineRef: LineRef | null; amountPaise: Paise },
  dispute: Finding,
): number | null {
  if (dispute.clauseId !== fault.clauseId) return null;
  if (fault.lineRef !== null && dispute.lineRef !== fault.lineRef) return null;
  const err = Math.abs(Math.abs(dispute.amount) - fault.amountPaise);
  return err <= TOLERANCE_PAISE ? err : null;
}

/**
 * The assignment of faults to disputes that detects the most faults, and
 * among those the one with the least total error. Returns, per fault, the
 * index of its dispute or −1. Exhaustive: faults per pack are few by design.
 */
export function bestAssignment(
  faults: readonly { clauseId: ClauseId; lineRef: LineRef | null; amountPaise: Paise }[],
  disputes: readonly Finding[],
): number[] {
  let best: { matched: number; cost: number; assignment: number[] } = {
    matched: -1,
    cost: Number.POSITIVE_INFINITY,
    assignment: [],
  };

  const current: number[] = [];
  const used = new Set<number>();

  const visit = (fi: number, matched: number, cost: number): void => {
    if (fi === faults.length) {
      if (matched > best.matched || (matched === best.matched && cost < best.cost)) {
        best = { matched, cost, assignment: [...current] };
      }
      return;
    }
    const fault = faults[fi] as (typeof faults)[number];

    disputes.forEach((dispute, di) => {
      if (used.has(di)) return;
      const c = pairCost(fault, dispute);
      if (c === null) return;
      used.add(di);
      current.push(di);
      visit(fi + 1, matched + 1, cost + c);
      current.pop();
      used.delete(di);
    });

    current.push(-1);
    visit(fi + 1, matched, cost);
    current.pop();
  };

  visit(0, 0, 0);
  return best.assignment;
}

function zeroed<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
}
