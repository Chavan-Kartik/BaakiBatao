/**
 * @fc/eval — the harness that turns "a demo" into "a system with a measured
 * error rate".
 *
 * Local-only evaluation (§20.1 steps 1–4, §20.2, §20.6): seeded pack
 * generation, six unlawful fault operators, lawful controls, and per-clause
 * precision/recall scoring. Rendering/degradation to PDF (§20.1 steps 5–6) and
 * the τ calibration sweep (§20.7) need AWS / a labelled split and are tracked
 * as follow-ups, not silent gaps — see EVAL_TODO.
 */
export * from './types';
export { generatePack } from './generate/generator';
export { injectFaults, ALL_FAULT_KINDS } from './faults/inject';
export { scorePacks, scorePacksDetailed } from './score/confusion';
export type { ScoreDetail, FaultOutcome } from './score/confusion';
export { compareToBaseline, toBaseline } from './score/baseline';
export type { Baseline } from './score/baseline';
export { runEval, generateFaultedPack, formatSummary, AS_OF } from './run';

export const EVAL_TODO = [
  'generate/degrade.ts — rotate, noise, JPEG artefacts (a clean PDF is a cheat)',
  'score/calibrate.ts — sweep τ, emit the calibration curve (§20.7)',
] as const;

/**
 * Prerequisites for EVAL_TODO[1]: a τ sweep needs per-line truth ("this
 * description is a CONSUMABLE"), not the pack-level clause labels the fault
 * harness produces, so it waits on the §20.7 labelled split.
 */
export const CALIBRATION_PREREQ =
  'needs a held-out labelled split of normalisation decisions (§20.7), which the fault harness does not provide';

