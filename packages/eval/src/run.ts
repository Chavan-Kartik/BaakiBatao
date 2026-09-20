import { reconstruct } from '@fc/engine';
import type { ReconstructInput, Reconstruction } from '@fc/contracts';
import { loadRulepackV1 } from '@fc/rulepack';
import { injectFaults } from './faults/inject';
import { DEFAULT_DEGRADE, degradeInput, type DegradeKnobs, type DegradeReport } from './generate/degrade';
import { generatePack } from './generate/generator';
import { rngFromSeed } from './generate/rng';
import { scorePacksDetailed, type FaultOutcome } from './score/confusion';
import type { EvalSummary, FaultedPack, Profile } from './types';

export const AS_OF = '2026-09-18T00:00:00.000Z';

/** The fault rng and the degradation rng hang off the pack seed on their own schedules. */
export const faultSeed = (seed: number): number => seed * 7919 + 13;
export const degradeSeed = (seed: number): number => seed * 104_729 + 7;

/**
 * One pack, faults included, on the same seed schedule `runEval` uses. The
 * CLI's `generate` command uses this to show the corpus without running the
 * engine, and it must agree with `runEval` so what you inspect is what scores.
 */
export function generateFaultedPack(seed: number): FaultedPack {
  return injectFaults(generatePack(seed), rngFromSeed(faultSeed(seed)));
}

export interface EvalRun {
  readonly profile: Profile;
  readonly packs: FaultedPack[];
  /** What the engine was actually given — `pack.input`, or its degraded form. */
  readonly inputs: ReconstructInput[];
  readonly results: Reconstruction[];
  readonly summary: EvalSummary;
  readonly outcomes: readonly FaultOutcome[];
  readonly degradation: readonly DegradeReport[];
}

/**
 * Runs the detection-rate harness (§20.6): generate N seeded packs, inject
 * 0–3 faults each, settle through the real engine, score per-clause
 * precision/recall plus the control false-positive rate.
 *
 * Under the `degraded` profile the same packs are run through data-level
 * degradation first — misread descriptions and digits, dropped sheet rows, and
 * categories from the real tier-1 normaliser — so the score is of the system
 * as far as it exists locally, not of the waterfall alone.
 */
export function runEval(
  count: number,
  seedBase = 1000,
  profile: Profile = 'clean',
  knobs: DegradeKnobs = DEFAULT_DEGRADE,
): EvalRun {
  const rulepack = loadRulepackV1();
  const packs: FaultedPack[] = [];
  for (let i = 0; i < count; i++) packs.push(generateFaultedPack(seedBase + i));

  const degradation: DegradeReport[] = [];
  const inputs = packs.map((p) => {
    if (profile === 'clean') return p.input;
    const d = degradeInput(p, rngFromSeed(degradeSeed(p.seed)), knobs);
    degradation.push(d.report);
    return d.input;
  });

  const results = inputs.map((input) => reconstruct({ input, rulepack, now: AS_OF }));
  const { summary, outcomes } = scorePacksDetailed(packs, results, { profile, inputs });
  return { profile, packs, inputs, results, summary, outcomes, degradation };
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

export function formatSummary(summary: EvalSummary): string {
  const lines = [
    `profile: ${summary.profile}  packs: ${summary.packs}  faults: ${summary.faults}  detected: ${summary.detected}`,
    `control pass rate: ${pct(summary.controlPassRate)}  FP rate: ${pct(summary.controlFalsePositiveRate)}`,
    `mean attribution error: ${summary.meanAttributionErrorPaise.toFixed(0)} paise`,
    `lines gated: ${pct(summary.gatedLineRate)}  lines unmatched: ${pct(summary.unmatchedLineRate)}`,
    `misses — gated: ${summary.missesByReason.GATED}  unmatched: ${summary.missesByReason.UNMATCHED}  engine: ${summary.missesByReason.ENGINE}`,
    '',
    'clause              tp   fp   fn    prec   recall',
  ];
  for (const c of summary.perClause) {
    lines.push(
      `${c.clauseId.padEnd(18)}${String(c.tp).padStart(4)}${String(c.fp).padStart(5)}${String(c.fn).padStart(5)}` +
        `${c.precision.toFixed(2).padStart(8)}${c.recall.toFixed(2).padStart(8)}`,
    );
  }
  lines.push('', 'archetype           packs  faults  detected');
  for (const [name, a] of Object.entries(summary.byArchetype)) {
    lines.push(`${name.padEnd(18)}${String(a.packs).padStart(7)}${String(a.faults).padStart(8)}${String(a.detected).padStart(10)}`);
  }
  lines.push('', 'controls demonstrated (zero-fault packs):');
  for (const [name, n] of Object.entries(summary.controlCoverage)) {
    lines.push(`  ${name.padEnd(22)}${String(n).padStart(4)}`);
  }
  return lines.join('\n');
}
