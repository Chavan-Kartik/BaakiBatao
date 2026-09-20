/**
 * @fc/eval — the harness that turns "a demo" into "a system with a measured
 * error rate".
 *
 * Local-only evaluation (§20.1 steps 1–4, §20.2, §20.6, §20.7): seeded pack
 * generation over four admission archetypes, six unlawful fault operators,
 * derived lawful controls, per-clause precision/recall scoring under a clean
 * and a degraded extraction profile, and the tier-1 threshold sweep. What
 * still needs AWS is tracked in EVAL_TODO, not implied by a green gate.
 */
export * from './types';
export { generatePack } from './generate/generator';
export { degradeInput, DEFAULT_DEGRADE, ocrNoise, digitNoise } from './generate/degrade';
export type { DegradeKnobs, DegradeReport, DegradedInput } from './generate/degrade';
export { injectFaults, controlsFor, ALL_FAULT_KINDS } from './faults/inject';
export { scorePacks, scorePacksDetailed, bestAssignment, pairCost } from './score/confusion';
export type { ScoreDetail, ScoreOptions, FaultOutcome } from './score/confusion';
export { compareToBaseline, toBaseline } from './score/baseline';
export type { Baseline } from './score/baseline';
export { heldOutSplit, sweep, knee, formatCurve, DEFAULT_THRESHOLDS } from './score/calibrate';
export type { CalibrationPoint, LabelledLine } from './score/calibrate';
export { renderEvaluationDoc } from './score/report';
export type { ReportInput } from './score/report';
export { runEval, generateFaultedPack, formatSummary, faultSeed, degradeSeed, AS_OF } from './run';
export type { EvalRun } from './run';

export const EVAL_TODO = [
  'generate/render.ts — HTML/CSS layouts → PNG → rotate, noise, JPEG, shear → PDF (§20.1 steps 5–7); needs the render toolchain and is what converts the data-level degradation into a measurement of Textract',
  'score/calibrate.ts — the tier-2 embedding-margin τ sweep (§14.1); needs Titan embeddings, the tier-1 sweep is in place and uses the same split',
] as const;
