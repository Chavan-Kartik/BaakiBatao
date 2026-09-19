import { describe, expect, it } from 'vitest';
import type { EvalSummary, PerClauseScore } from '../types';
import { compareToBaseline, toBaseline, type Baseline } from './baseline';

const clause = (over: Partial<PerClauseScore> & { clauseId: string }): PerClauseScore => ({
  tp: 10,
  fp: 0,
  fn: 0,
  precision: 1,
  recall: 1,
  ...over,
});

const summary = (over: Partial<EvalSummary> = {}): EvalSummary => ({
  packs: 200,
  faults: 170,
  detected: 170,
  perClause: [clause({ clauseId: 'AME.EXCL.PHARMA' }), clause({ clauseId: 'PD.ICU', tp: 4 })],
  controlPassRate: 1,
  controlFalsePositiveRate: 0,
  meanAttributionErrorPaise: 0,
  ...over,
});

const baseline: Baseline = toBaseline(summary(), '2026-09-18T00:00:00.000Z');

/**
 * The gate exists so a change to a step, a clause or the step order cannot
 * quietly cost us detections. That only works if it fails when it should, so
 * each way of regressing is pinned here.
 */
describe('the eval regression gate', () => {
  it('passes an unchanged run', () => {
    expect(compareToBaseline(baseline, summary())).toEqual([]);
  });

  it('fails when a lawful deduction starts being disputed', () => {
    const failures = compareToBaseline(
      baseline,
      summary({ controlPassRate: 0.9, controlFalsePositiveRate: 0.1 }),
    );

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('control false-positive rate');
  });

  it('fails when a fault it used to catch is missed', () => {
    const failures = compareToBaseline(
      baseline,
      summary({
        detected: 168,
        perClause: [
          clause({ clauseId: 'AME.EXCL.PHARMA', tp: 8, fn: 2, recall: 0.8 }),
          clause({ clauseId: 'PD.ICU', tp: 4 }),
        ],
      }),
    );

    expect(failures.some((f) => f.includes('AME.EXCL.PHARMA recall regressed'))).toBe(true);
    expect(failures.some((f) => f.includes('detection rate regressed'))).toBe(true);
  });

  it('fails when a clause stops being cited at all', () => {
    const failures = compareToBaseline(
      baseline,
      summary({ perClause: [clause({ clauseId: 'AME.EXCL.PHARMA' })] }),
    );

    expect(failures.some((f) => f.includes('PD.ICU is no longer detected'))).toBe(true);
  });

  it('fails on a false positive under a clause the baseline never disputed', () => {
    const failures = compareToBaseline(
      baseline,
      summary({
        perClause: [
          clause({ clauseId: 'AME.EXCL.PHARMA' }),
          clause({ clauseId: 'PD.ICU', tp: 4 }),
          clause({ clauseId: 'LIMIT.ROOM', tp: 0, fp: 3, precision: 0 }),
        ],
      }),
    );

    expect(failures.some((f) => f.includes('new false positives under LIMIT.ROOM'))).toBe(true);
  });

  it('fails when precision drops on a clause the baseline tracked', () => {
    const failures = compareToBaseline(
      baseline,
      summary({
        perClause: [
          clause({ clauseId: 'AME.EXCL.PHARMA', tp: 10, fp: 2, precision: 10 / 12 }),
          clause({ clauseId: 'PD.ICU', tp: 4 }),
        ],
      }),
    );

    expect(failures.some((f) => f.includes('AME.EXCL.PHARMA precision regressed'))).toBe(true);
  });
});