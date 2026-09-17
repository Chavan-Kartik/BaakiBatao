/**
 * @fc/eval — the harness that turns "a demo" into "a system with a measured
 * error rate".
 *
 * The shape of the work (the build spec §20):
 *
 *   generate/  seeded claim packs. Each pack is settled by our OWN engine to
 *              produce a lawful deduction sheet, so ground truth is exact by
 *              construction rather than annotated by hand.
 *
 *   faults/    injected on top of that lawful settlement, so every unlawful
 *              rupee has a known clause ID and a known amount:
 *                pd-on-pharma      → AME.EXCL.PHARMA
 *                pd-on-implant     → AME.EXCL.IMPLANT
 *                pd-on-diag        → AME.EXCL.DIAG
 *                pd-on-icu         → PD.ICU
 *                pd-no-diffbill    → PD.DIFFBILL
 *                pd-over-recovery  → PD.LIMIT
 *
 *   faults/controls/  LAWFUL cuts the engine must NOT flag. This is the
 *              important half — anyone can build something that flags
 *              deductions; proving we do not flag a lawful sub-limit cut is
 *              what separates a reconstructor from the blanket classifier.
 *
 *   score/     per-clause precision and recall, the false-positive rate on the
 *              control set, and the τ calibration curve.
 */

export const EVAL_TODO = [
  'generate/index.ts — seeded pack generator',
  'generate/degrade.ts — rotate, noise, JPEG artefacts (a clean PDF is a cheat)',
  'faults/*.ts — six unlawful operators',
  'faults/controls/*.ts — four lawful controls',
  'score/confusion.ts — per-clause precision/recall + control FP rate',
  'score/calibrate.ts — sweep τ, emit the calibration curve',
  'cli.ts — generate | run | report | calibrate',
] as const;
