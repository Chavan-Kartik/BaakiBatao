import { describe, expect, it } from 'vitest';
import type { Paise } from '@fc/contracts';
import { rupeesToPaise } from '@fc/contracts';
import { reconstruct } from '@fc/engine';
import { AS_OF, buildInput, lineDescription } from '@fc/fixtures';
import { loadRulepackV1 } from '@fc/rulepack';

/**
 * The worked example from the README, end to end.
 *
 * This is the test that stops the README from drifting into fiction. Every
 * rupee quoted there is asserted here, so a change to a step, a clause, or the
 * step order that would alter the published figures fails the build instead of
 * quietly making the front page wrong.
 *
 * The pack itself lives in @fc/fixtures because the demo UI settles the same
 * one in the browser. The figures a judge reads on screen are therefore the
 * figures asserted below.
 */

const R = (rupees: number): Paise => rupeesToPaise(rupees);

describe('the worked example from the README', () => {
  const pack = loadRulepackV1();
  const result = reconstruct({ input: buildInput(), rulepack: pack, now: AS_OF });

  it('reads the bill total off the itemised bill', () => {
    expect(result.billTotal).toBe(R(415_000));
  });

  it('reconstructs a payable of 3,18,600 independently of what the insurer decided', () => {
    expect(result.expectedPayable).toBe(R(318_600));
  });

  it('holds the zero-sum invariant with nothing left over', () => {
    expect(result.reconciliation.invariantHeld).toBe(true);
    expect(result.reconciliation.residual).toBe(0);
    expect(result.reconciliation.observedDelta).toBe(R(206_680));
  });

  it('splits the 2,06,680 deducted into the three buckets from the README', () => {
    const { byBucket } = result.reconciliation;

    // Negative because the sign convention makes a deduction negative.
    expect(byBucket.CORRECTLY_APPLIED).toBe(-R(84_480));
    expect(byBucket.INCORRECTLY_APPLIED).toBe(-R(119_200));
    expect(byBucket.UNRESOLVED).toBe(-R(3_000));
  });

  it('accounts for every paise the insurer withheld', () => {
    const total =
      result.reconciliation.byBucket.CORRECTLY_APPLIED +
      result.reconciliation.byBucket.INCORRECTLY_APPLIED +
      result.reconciliation.byBucket.UNRESOLVED;

    expect(-total).toBe(result.reconciliation.observedDelta);
  });

  /**
   * The four bright lines, each against the line it was crossed on. These are
   * the citations that end up quoted verbatim in the reconsideration request,
   * so the amounts matter as much as the clause IDs.
   */
  it.each([
    ['AME.EXCL.PHARMA', 39_200],
    ['AME.EXCL.IMPLANT', 48_000],
    ['AME.EXCL.DIAG', 22_400],
    ['PD.ICU', 9_600],
  ])('disputes proportionate deduction worth %s under that clause', (clauseId, rupees) => {
    const found = result.findings.filter(
      (f) => f.clauseId === clauseId && f.bucket === 'INCORRECTLY_APPLIED',
    );

    expect(found.length, `no INCORRECTLY_APPLIED finding cites ${clauseId}`).toBeGreaterThan(0);
    expect(found.reduce((sum, f) => sum + f.amount, 0)).toBe(-R(rupees));

    // Every dispute is pinned to a specific bill line, because the letter
    // quotes the clause against the line rather than against the claim.
    for (const f of found) {
      expect(lineDescription(f.lineRef ?? null)).toBeTruthy();
    }
  });

  /**
   * The split that makes the pharmacy figure add up from two different routes.
   * Medicines were payable outright; the disposables were Annexure II and only
   * survived step 3 because the consumables rider bought them back. Both then
   * reach step 5 and are exempt from proportionate deduction under one clause.
   */
  it('disputes pharmacy and consumables separately under the same clause', () => {
    const byLine = new Map(
      result.findings
        .filter((f) => f.clauseId === 'AME.EXCL.PHARMA' && f.bucket === 'INCORRECTLY_APPLIED')
        .map((f) => [lineDescription(f.lineRef ?? null), f.amount]),
    );

    expect(byLine.get('Pharmacy')).toBe(-R(31_200));
    expect(byLine.get('Surgical Consumables')).toBe(-R(8_000));
  });

  /**
   * Exemption from proportionate deduction does not make a line payable. The
   * rider is what makes the consumables payable, and without it step 3 would
   * lawfully cut them in full — which is the §3 trap the whole waterfall exists
   * to avoid falling into.
   */
  it('does not cut the consumables under Annexure II, because the rider covers them', () => {
    const annexureCuts = result.findings.filter(
      (f) => f.clauseId === 'NP.ITEM.ANNEXURE_II' && f.lineRef !== null,
    );

    expect(annexureCuts.map((f) => lineDescription(f.lineRef))).toEqual([
      'Medical Records and Administrative Charges',
    ]);
  });

  it('defends the deductions the insurer was entitled to make', () => {
    const defended = (clauseId: string): number =>
      result.findings
        .filter((f) => f.clauseId === clauseId && f.bucket === 'CORRECTLY_APPLIED')
        .reduce((sum, f) => sum + f.amount, 0);

    expect(defended('NP.ITEM.ANNEXURE_II')).toBe(-R(7_000)); // administrative charges
    expect(defended('LIMIT.ROOM')).toBe(-R(20_000)); // room above the per-day cap
    expect(defended('PD.LIMIT')).toBe(-R(24_000)); // lawful PD on professional fees
    expect(defended('DEDUCT.AMT')).toBe(-R(10_000));
    expect(defended('COPAY.PCT')).toBe(-R(23_480));
  });

  it('names the unexplained 3,000 rather than absorbing it', () => {
    const residual = result.findings.filter(
      (f) => f.unresolvedReason === 'RESIDUAL_UNATTRIBUTED',
    );

    expect(residual).toHaveLength(1);
    expect(residual[0]?.amount).toBe(-R(3_000));
    expect(residual[0]?.clauseId).toBeNull();
    expect(residual[0]?.resolvedBy).toBeTruthy();
  });

  /**
   * The point the architecture alone cannot make, and the reason this
   * reconstructs a whole settlement instead of auditing lines in isolation.
   *
   * The gross unlawful deduction is 1,19,200, but that is not what the
   * policyholder is owed. Adding it back also restores the 10% co-pay that
   * lawfully applies to it, so the clause-backed claim is 1,07,280. Asking for
   * the gross figure would be wrong, and an insurer would be right to refuse it.
   */
  it('reduces the clause-backed claim by the co-pay that lawfully applies to it', () => {
    const gross = -result.reconciliation.byBucket.INCORRECTLY_APPLIED;
    const copayOnRestored = gross / 10; // the schedule's 10%

    expect(gross).toBe(R(119_200));
    expect(gross - copayOnRestored).toBe(R(107_280));
  });

  /**
   * The total shortfall is larger than the clause-backed claim, and the two are
   * deliberately not merged. 1,07,280 is what we will argue with a citation;
   * the remaining 3,000 is money the insurer withheld without saying why, which
   * we ask them to explain rather than assert a rule about.
   */
  it('separates the 1,10,280 shortfall into what we can argue and what we can only query', () => {
    const shortfall = result.expectedPayable - result.actualPaid;

    expect(shortfall).toBe(R(110_280));
    expect(shortfall).toBe(R(107_280) + R(3_000));
  });

  it('never asserts a verdict without a clause to quote', () => {
    for (const f of result.findings) {
      if (f.bucket === 'UNRESOLVED') continue;
      expect(f.clauseId, `${f.findingId} has no citation`).not.toBeNull();
      expect(pack.clauses[f.clauseId!], `${f.clauseId} is not in the rulepack`).toBeDefined();
    }
  });

  it('runs all seven steps in the order the rulepack declares', () => {
    expect(result.steps.map((s) => s.stepId)).toEqual([
      'ADMISSIBILITY',
      'NORMALISATION_GATE',
      'NON_PAYABLE',
      'CAPS_SUBLIMITS',
      'PROPORTIONATE',
      'COPAY_DEDUCTIBLE',
      'SUM_INSURED',
    ]);
  });
});
