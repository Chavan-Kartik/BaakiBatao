import { reconstruct } from '@fc/engine';
import type { Reconstruction } from '@fc/contracts';
import { loadRulepackV1 } from '@fc/rulepack';
import { injectFaults } from './faults/inject';
import { generatePack } from './generate/generator';
import { rngFromSeed } from './generate/rng';
import { scorePacks } from './score/confusion';
import type { EvalSummary, FaultedPack } from './types';

export const AS_OF = '2026-09-18T00:00:00.000Z';

/**
 * One pack, faults included, on the same seed schedule `runEval` uses: the
 * pack's seed also drives the fault rng (`seed * 7919 + 13`). The CLI's
 * `generate` command uses this to show the corpus without running the engine,
 * and it must agree with `runEval` so what you inspect is what scores.
 */
export function generateFaultedPack(seed: number): FaultedPack {
  return injectFaults(generatePack(seed), rngFromSeed(seed * 7919 + 13));
}

/**
 * Runs the detection-rate harness (§20.6): generate N seeded packs, inject
 * 0–3 faults each, settle through the real engine, score per-clause
 * precision/recall plus the control false-positive rate.
 */
export function runEval(
  count: number,
  seedBase = 1000,
): { packs: FaultedPack[]; results: Reconstruction[]; summary: EvalSummary } {
  const rulepack = loadRulepackV1();
  const packs: FaultedPack[] = [];
  for (let i = 0; i < count; i++) {
    const seed = seedBase + i;
    packs.push(injectFaults(generatePack(seed), rngFromSeed(seed * 7919 + 13)));
  }
  const results = packs.map((p) => reconstruct({ input: p.input, rulepack, now: AS_OF }));
  return { packs, results, summary: scorePacks(packs, results) };
}

export function formatSummary(summary: EvalSummary): string {
  const lines = [
    `packs: ${summary.packs}  faults: ${summary.faults}  detected: ${summary.detected}`,
    `control pass rate: ${(summary.controlPassRate * 100).toFixed(1)}%  ` +
      `FP rate: ${(summary.controlFalsePositiveRate * 100).toFixed(1)}%`,
    `mean attribution error: ${summary.meanAttributionErrorPaise.toFixed(0)} paise`,
    '',
    'clause              tp   fp   fn    prec   recall',
  ];
  for (const c of summary.perClause) {
    lines.push(
      `${c.clauseId.padEnd(18)}${String(c.tp).padStart(4)}${String(c.fp).padStart(5)}${String(c.fn).padStart(5)}` +
        `${c.precision.toFixed(2).padStart(8)}${c.recall.toFixed(2).padStart(8)}`,
    );
  }
  return lines.join('\n');
}
