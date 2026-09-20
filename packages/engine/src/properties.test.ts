import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Finding, ReconstructInput, Rulepack } from '@fc/contracts';
import { reconstruct } from './interpreter';
import { resolveReducer } from './registry';
import type { LineState, ReducerContext } from './state';
import { R, admissionOf, contextOf, inputOf, policyOf, rulepackOf, stateOf, type TestLine } from './testing';

/**
 * The ten properties of §21.2. `fast-check` generates policies and bills;
 * these must hold for all of them. A failing property shrinks to a two-line
 * bill, which is worth more than the assertion.
 */
const rulepack = rulepackOf();
const NOW = '2026-09-18T00:00:00.000Z';

const CATEGORIES = [
  'ROOM_RENT', 'ICU_CHARGE', 'PHARMACY', 'CONSUMABLE', 'IMPLANT_DEVICE', 'DIAGNOSTICS',
  'SURGEON_FEE', 'ANAESTHETIST_FEE', 'OT_CHARGE', 'NURSING_CHARGE', 'DOCTOR_VISIT', 'ADMIN_CHARGE',
] as const;

/** A bill line, with a sheet row that paid some fraction of it. */
const arbLine = fc
  .record({
    category: fc.constantFrom(...CATEGORIES),
    claimed: fc.integer({ min: 1, max: 200_000 }),
    paidPct: fc.integer({ min: 0, max: 100 }),
    withRow: fc.boolean(),
  })
  .map((l): TestLine => ({
    desc: l.category,
    category: l.category,
    claimed: l.claimed,
    ...(l.withRow ? { paid: Math.floor((l.claimed * l.paidPct) / 100), reason: 'PROP-DEDUCT' } : {}),
  }));

const arbLines = fc
  .array(arbLine, { minLength: 1, maxLength: 8 })
  .map((ls) => ls.map((l, i) => ({ ...l, desc: `${l.category} line ${i}` })));

const arbPolicy = fc
  .record({
    cap: fc.constantFrom(4000, 5000, 6000, 8000),
    icuCap: fc.constantFrom(10_000, 12_000, 15_000),
    copay: fc.constantFrom(0, 10, 20),
    deductible: fc.constantFrom(0, 5000, 10_000),
    sumInsured: fc.constantFrom(100_000, 300_000, 500_000, 1_000_000),
    rider: fc.boolean(),
  })
  .map((p) =>
    policyOf({
      roomRentCapPerDay: R(p.cap),
      icuCapPerDay: R(p.icuCap),
      copayPercent: p.copay,
      deductible: p.deductible === 0 ? null : R(p.deductible),
      sumInsured: R(p.sumInsured),
      sumInsuredRemaining: R(p.sumInsured),
      riders: p.rider
        ? [{ riderId: 'CONSUMABLES_RIDER', label: 'Consumables', effectiveFrom: '2025-04-01', coversCategories: ['CONSUMABLE' as never] }]
        : [],
    }),
  );

const arbAdmission = fc
  .record({
    rate: fc.integer({ min: 1000, max: 20_000 }),
    roomDays: fc.integer({ min: 1, max: 10 }),
    icuDays: fc.integer({ min: 0, max: 5 }),
    diffBilling: fc.constantFrom(true, true, true, false, null),
  })
  .map((a) =>
    admissionOf({
      actualRoomRentPerDay: R(a.rate),
      roomDays: a.roomDays,
      icuDays: a.icuDays,
      hospitalUsesDifferentialBilling: a.diffBilling,
    }),
  );

const arbInput = fc
  .tuple(arbLines, arbPolicy, arbAdmission)
  .map(([lines, policy, admission]) => inputOf({ rulepack, lines, policy, admission }));

const run = (input: ReconstructInput, pack: Rulepack = rulepack) => reconstruct({ input, rulepack: pack, now: NOW });

/** Drives the reducers by hand so the final LineState is observable. */
function finalLines(input: ReconstructInput, pack: Rulepack = rulepack): readonly LineState[] {
  let state = stateOf(input, pack);
  for (const def of pack.steps) {
    const ctx: ReducerContext = contextOf(input, pack, def.id);
    const [next] = resolveReducer(def.reducer)(state, ctx);
    state = next;
    if (def.haltsOnFail && state.halted) break;
  }
  return state.lines;
}

describe('§21.2 properties', () => {
  it('zero-sum invariant: the ledger balances for every generated claim', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const r = run(input);
        expect(r.reconciliation.residual).toBe(0);
        expect(r.reconciliation.invariantHeld).toBe(true);
        expect(r.reconciliation.attributedDelta + 0).toBe(-r.reconciliation.observedDelta + 0);
      }),
      { numRuns: 300 },
    );
  });

  it('monotonicity in room category: a dearer room never increases the expected payable', () => {
    fc.assert(
      fc.property(arbInput, fc.integer({ min: 1, max: 15_000 }), (input, more) => {
        const dearer: ReconstructInput = {
          ...input,
          admission: {
            ...input.admission,
            actualRoomRentPerDay: R((input.admission.actualRoomRentPerDay ?? 0) / 100 + more),
          },
        };
        expect(run(dearer).expectedPayable).toBeLessThanOrEqual(run(input).expectedPayable);
      }),
      { numRuns: 300 },
    );
  });

  it('bounds: 0 ≤ expectedPayable ≤ min(billTotal, sum insured)', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const r = run(input);
        expect(r.expectedPayable).toBeGreaterThanOrEqual(0);
        expect(r.expectedPayable).toBeLessThanOrEqual(r.billTotal);
        expect(r.expectedPayable).toBeLessThanOrEqual(input.policy.sumInsured ?? Number.POSITIVE_INFINITY);
      }),
      { numRuns: 300 },
    );
  });

  it('no double deduction: no line is reduced twice by the same step, and allowed never exceeds claimed', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        for (const line of finalLines(input)) {
          expect(new Set(line.deductedBy).size).toBe(line.deductedBy.length);
          expect(line.allowed).toBeLessThanOrEqual(line.claimed);
          expect(line.allowed).toBeGreaterThanOrEqual(0);
          // The insurer's cut is attributed at most once, in total.
          const theirCut = input.deductionTable.rows.find((r) => r.rawDescription === line.rawDescription);
          if (theirCut) {
            expect(line.insurerAttributed).toBeLessThanOrEqual(
              Math.max(0, theirCut.amountClaimed - (theirCut.amountPaid ?? 0)),
            );
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('ICU immunity: an ICU line’s outcome is invariant under any change of room category', () => {
    fc.assert(
      fc.property(arbInput, fc.integer({ min: 1000, max: 30_000 }), (input, rate) => {
        const other: ReconstructInput = {
          ...input,
          admission: { ...input.admission, actualRoomRentPerDay: R(rate) },
        };
        const a = finalLines(input).filter((l) => l.categoryId === 'ICU_CHARGE');
        const b = finalLines(other).filter((l) => l.categoryId === 'ICU_CHARGE');
        expect(b.map((l) => l.allowed)).toEqual(a.map((l) => l.allowed));
        for (const l of [...a, ...b]) expect(l.deductedBy).not.toContain('PROPORTIONATE');
      }),
      { numRuns: 200 },
    );
  });

  /**
   * The §3 trap, asserted: a line exempt from proportionate deduction is not
   * thereby payable. Consumables are PD-exempt under AME.EXCL.PHARMA and,
   * with no rider, still cut in full by step 3.
   */
  it('exemption ≠ payable: a PD-exempt Annexure II line is still cut by step 3 without a rider', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000 }), arbAdmission, (claimed, admission) => {
        const input = inputOf({
          rulepack,
          lines: [{ desc: 'Consumables', category: 'CONSUMABLE', claimed, paid: 0, reason: 'PROP-DEDUCT' }],
          policy: policyOf({ riders: [] }),
          admission,
        });
        const [line] = finalLines(input);
        expect(line?.allowed).toBe(0);
        expect(line?.deductedBy).toEqual(['NON_PAYABLE']);
        expect(run(input).expectedPayable).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Deductible-first pays (B − D)(1 − c); co-pay-first pays B(1 − c) − D.
   * They differ by exactly D·c whenever the deductible bites — so the order
   * is a real parameter, and the rulepack owns it.
   */
  it('order sensitivity: swapping COPAY_DEDUCTIBLE order changes the payable by exactly deductible × co-pay', () => {
    const swapped = rulepackOf({
      steps: rulepack.steps.map((s) =>
        s.id === 'COPAY_DEDUCTIBLE' ? { ...s, params: { order: ['COPAY', 'DEDUCTIBLE'] } } : s,
      ),
    });
    fc.assert(
      fc.property(
        fc.integer({ min: 50_000, max: 500_000 }),
        fc.constantFrom(10, 20),
        fc.constantFrom(5000, 10_000),
        (claimed, copay, deductible) => {
          const input = inputOf({
            rulepack,
            lines: [{ desc: 'Surgeon fee', category: 'SURGEON_FEE', claimed, paid: claimed }],
            policy: policyOf({ copayPercent: copay, deductible: R(deductible), roomRentCapPerDay: R(10_000) }),
            admission: admissionOf({ actualRoomRentPerDay: R(5000) }),
          });
          const dedFirst = run(input).expectedPayable;
          const copayFirst = run(input, swapped).expectedPayable;
          expect(Math.abs(dedFirst - copayFirst - R((deductible * copay) / 100))).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('sign convention: every cut is non-positive, and the findings sum to the observed delta', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const r = run(input);
        for (const f of r.findings) {
          if (f.bucket !== 'UNRESOLVED') expect(f.amount).toBeLessThanOrEqual(0);
        }
        const sum = r.findings.reduce((s, f) => s + f.amount, 0);
        expect(sum + 0).toBe(-(r.billTotal - r.actualPaid) + 0);
      }),
      { numRuns: 300 },
    );
  });

  it('clause ID totality: every non-UNRESOLVED finding cites a clause that exists in the rulepack', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        for (const f of run(input).findings) {
          if (f.bucket === 'UNRESOLVED') {
            expect(f.unresolvedReason).not.toBeNull();
            expect(f.resolvedBy).toBeTruthy();
          } else {
            expect(f.clauseId).not.toBeNull();
            expect(rulepack.clauses[f.clauseId as string], `clause ${f.clauseId}`).toBeDefined();
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('determinism: two runs over identical input are identical', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const a = run(input);
        const b = run(structuredClone(input));
        expect(b).toEqual(a);
        expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      }),
      { numRuns: 100 },
    );
  });

  it('a lawful sheet is never disputed: paying exactly our reconstruction yields no INCORRECTLY_APPLIED', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        // Settle the bill by our own waterfall, then hand that back as the sheet.
        const lines = finalLines(input);
        const lawful: TestLine[] = input.billTable.rows.map((row, i) => ({
          desc: row.rawDescription,
          category: input.normalisedLines[i]?.categoryId ?? null,
          claimed: row.amountClaimed / 100,
          paid: (lines[i]?.allowed ?? 0) / 100,
          reason: 'LAWFUL',
        }));
        const settled = inputOf({
          rulepack,
          lines: lawful,
          policy: { ...input.policy, copayPercent: 0, deductible: null },
          admission: input.admission,
        });
        const disputed: Finding[] = run(settled).findings.filter((f) => f.bucket === 'INCORRECTLY_APPLIED');
        expect(disputed).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });
});
