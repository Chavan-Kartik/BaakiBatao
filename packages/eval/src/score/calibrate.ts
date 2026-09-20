import { buildLexicon, resolveTier1, DEFAULT_TIER1 } from '@fc/normalise';
import { loadRulepackV1 } from '@fc/rulepack';
import { DEFAULT_DEGRADE, ocrNoise, type DegradeKnobs } from '../generate/degrade';
import { generatePack } from '../generate/generator';
import { chance, rngFromSeed } from '../generate/rng';

/**
 * The τ sweep (§14.1, §20.7) — for the one threshold the local cascade has.
 *
 * §14 calibrates the embedding margin τ that gates tier 2. Tier 2 needs Titan
 * and is not here yet; what is here is tier 1's trigram threshold, which plays
 * the same role one tier earlier (accept the lexicon's fuzzy answer, or
 * escalate) and calibrates the same way: accuracy among the lines it accepted
 * against the fraction it escalated, swept over the threshold, on a labelled
 * split the fault harness never sees.
 *
 * The split is held out by seed range, and its labels are exact by
 * construction — the generator knows which category it printed each line
 * from, and the degradation is applied on top of that knowledge. What the
 * curve therefore measures is the matcher against *our* phrasing of *our*
 * categories under *our* noise model; docs/evaluation.md says so beside it.
 */
export interface LabelledLine {
  readonly text: string;
  readonly categoryId: string;
  readonly degraded: boolean;
}

export interface CalibrationPoint {
  readonly threshold: number;
  readonly total: number;
  readonly accepted: number;
  readonly correct: number;
  readonly escalated: number;
  readonly accuracyAmongAccepted: number;
  readonly escalationRate: number;
}

export const HELD_OUT_SEED_BASE = 50_000;

export function heldOutSplit(
  packs: number,
  seedBase = HELD_OUT_SEED_BASE,
  knobs: DegradeKnobs = DEFAULT_DEGRADE,
): LabelledLine[] {
  const out: LabelledLine[] = [];
  for (let i = 0; i < packs; i++) {
    const seed = seedBase + i;
    const pack = generatePack(seed);
    const rng = rngFromSeed(seed * 15_485_863 + 3);
    pack.billTable.rows.forEach((row, li) => {
      const degraded = chance(rng, knobs.billDescriptionNoise);
      out.push({
        text: degraded ? ocrNoise(rng, row.rawDescription) : row.rawDescription,
        categoryId: pack.trueCategories[li] ?? '',
        degraded,
      });
    });
  }
  return out;
}

export const DEFAULT_THRESHOLDS: readonly number[] = Array.from({ length: 36 }, (_, i) =>
  Number((0.3 + i * 0.02).toFixed(2)),
);

export function sweep(
  lines: readonly LabelledLine[],
  thresholds: readonly number[] = DEFAULT_THRESHOLDS,
): CalibrationPoint[] {
  const lexicon = buildLexicon(loadRulepackV1());
  return thresholds.map((threshold) => {
    let accepted = 0;
    let correct = 0;
    for (const line of lines) {
      const r = resolveTier1(line.text, lexicon, { ...DEFAULT_TIER1, fuzzyThreshold: threshold });
      if (r.categoryId === null) continue;
      accepted += 1;
      if (r.categoryId === line.categoryId) correct += 1;
    }
    const escalated = lines.length - accepted;
    return {
      threshold,
      total: lines.length,
      accepted,
      correct,
      escalated,
      accuracyAmongAccepted: accepted === 0 ? 1 : correct / accepted,
      escalationRate: lines.length === 0 ? 0 : escalated / lines.length,
    };
  });
}

/**
 * The knee: the lowest threshold whose accuracy among accepted lines is still
 * at or above `minAccuracy`. Lower accepts more and starts guessing; higher
 * escalates lines the lexicon was right about. A wrong category is a wrong
 * clause in a letter, so the floor is set high and the escalation rate is
 * what gives.
 */
export function knee(points: readonly CalibrationPoint[], minAccuracy = 0.999): CalibrationPoint | null {
  const ok = points.filter((p) => p.accuracyAmongAccepted >= minAccuracy);
  return ok.reduce<CalibrationPoint | null>(
    (best, p) => (best === null || p.threshold < best.threshold ? p : best),
    null,
  );
}

export function formatCurve(points: readonly CalibrationPoint[], chosen: CalibrationPoint | null): string {
  const lines = ['threshold  accepted  correct  escalated   acc@accepted  escalation'];
  for (const p of points) {
    const mark = chosen && p.threshold === chosen.threshold ? '  ← knee' : '';
    lines.push(
      `${p.threshold.toFixed(2).padStart(9)}${String(p.accepted).padStart(10)}${String(p.correct).padStart(9)}` +
        `${String(p.escalated).padStart(11)}${(p.accuracyAmongAccepted * 100).toFixed(2).padStart(13)}%` +
        `${(p.escalationRate * 100).toFixed(1).padStart(11)}%${mark}`,
    );
  }
  return lines.join('\n');
}
