import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Finding, Paise } from '@fc/contracts';
import { unsafePaise } from '@fc/contracts';
import { balanceLedger } from './invariant';

const p = (n: number): Paise => unsafePaise(n);

const finding = (id: string, amount: number, over: Partial<Finding> = {}): Finding => ({
  findingId: id,
  lineRef: null,
  stepId: 'CAPS_SUBLIMITS',
  clauseId: 'LIMIT.ROOM' as Finding['clauseId'],
  bucket: 'CORRECTLY_APPLIED',
  amount: p(amount),
  arithmetic: { expression: 'test', inputs: {}, result: amount },
  unresolvedReason: null,
  resolvedBy: null,
  confidence: 1,
  ...over,
});

describe('the zero-sum invariant', () => {
  it('balances when our findings fully explain the insurer’s deduction', () => {
    // bill 1,00,000 · paid 80,000 · we explain the whole 20,000
    const { findings, reconciliation } = balanceLedger(p(10_000_000), p(8_000_000), [
      finding('a', -1_500_000),
      finding('b', -500_000),
    ]);

    expect(reconciliation.residual).toBe(0);
    expect(reconciliation.invariantHeld).toBe(true);
    expect(findings).toHaveLength(2);
    expect(findings.some((f) => f.findingId === 'RESIDUAL')).toBe(false);
  });

  it('names the gap instead of adjusting a number, when we cannot explain it all', () => {
    // bill 1,00,000 · paid 75,000 · we can only explain 20,000 of the 25,000 cut
    const { findings, reconciliation } = balanceLedger(p(10_000_000), p(7_500_000), [
      finding('a', -2_000_000),
    ]);

    const residual = findings.find((f) => f.findingId === 'RESIDUAL');

    expect(residual).toBeDefined();
    expect(residual?.bucket).toBe('UNRESOLVED');
    expect(residual?.unresolvedReason).toBe('RESIDUAL_UNATTRIBUTED');
    expect(residual?.clauseId).toBeNull();
    expect(residual?.amount).toBe(-500_000); // the unexplained ₹5,000
    expect(residual?.resolvedBy).toBeTruthy();

    // and the ledger still balances afterwards
    expect(reconciliation.residual).toBe(0);
    expect(reconciliation.invariantHeld).toBe(true);
  });

  it('flags an over-explanation too — findings exceeding the observed cut', () => {
    // we claim 30,000 of deductions but only 20,000 was actually cut
    const { findings } = balanceLedger(p(10_000_000), p(8_000_000), [finding('a', -3_000_000)]);

    const residual = findings.find((f) => f.findingId === 'RESIDUAL');
    expect(residual?.amount).toBe(1_000_000);
    expect(residual?.unresolvedReason).toBe('RESIDUAL_UNATTRIBUTED');
  });

  it('buckets every paise, and the bucket totals sum to the attributed delta', () => {
    const { reconciliation } = balanceLedger(p(10_000_000), p(7_000_000), [
      finding('a', -1_000_000, { bucket: 'CORRECTLY_APPLIED' }),
      finding('b', -1_200_000, { bucket: 'INCORRECTLY_APPLIED' }),
    ]);

    const bucketed =
      reconciliation.byBucket.CORRECTLY_APPLIED +
      reconciliation.byBucket.INCORRECTLY_APPLIED +
      reconciliation.byBucket.UNRESOLVED;

    expect(bucketed).toBe(reconciliation.attributedDelta);
  });

  /**
   * The headline property: for ANY bill, ANY amount paid and ANY set of
   * findings, the returned ledger balances. Every paise is either attributed to
   * a clause or explicitly marked unattributed. There is no third state.
   */
  it('holds for arbitrary inputs (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50_000_000 }),
        fc.integer({ min: 0, max: 50_000_000 }),
        fc.array(fc.integer({ min: -5_000_000, max: 5_000_000 }), { maxLength: 20 }),
        (billTotal, actualPaid, amounts) => {
          const { reconciliation } = balanceLedger(
            p(billTotal),
            p(actualPaid),
            amounts.map((a, i) => finding(`f${i}`, a)),
          );
          expect(reconciliation.residual).toBe(0);
          expect(reconciliation.invariantHeld).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });
});
