import { describe, expect, it } from 'vitest';
import type { CategoryId, Finding } from '@fc/contracts';
import { admissibility } from './01-admissibility';
import { normalisationGate } from './02-normalisation-gate';
import { nonPayable } from './03-non-payable';
import { capsSublimits } from './04-caps-sublimits';
import { proportionate } from './05-proportionate';
import { copayDeductible } from './06-copay-deductible';
import { sumInsured } from './07-sum-insured';
import { R, admissionOf, billRef, contextOf, inputOf, policyOf, rulepackOf, stateOf } from '../testing';

const rulepack = rulepackOf();

const by = (findings: readonly Finding[], bucket: Finding['bucket'], clauseId?: string): Finding[] =>
  findings.filter((f) => f.bucket === bucket && (clauseId === undefined || f.clauseId === clauseId));

/**
 * Each reducer in isolation, against hand-computed expectations. The
 * interpreter, the invariant and the worked example cover the waterfall as a
 * whole; these pin what each step does with the state it is handed, so a
 * regression names the step.
 */
describe('step 1 — admissibility', () => {
  it('passes an admission inside the policy period with no findings', () => {
    const input = inputOf({ rulepack, lines: [{ desc: 'Room rent', category: 'ROOM_RENT', claimed: 50_000 }] });
    const [state, findings] = admissibility(stateOf(input, rulepack), contextOf(input, rulepack, 'ADMISSIBILITY'));
    expect(findings).toEqual([]);
    expect(state.halted).toBe(false);
    expect(state.payable).toBe(R(50_000));
  });

  it('halts with ADM.NOTINFORCE carrying the whole balance when the admission is outside cover', () => {
    const input = inputOf({
      rulepack,
      lines: [{ desc: 'Room rent', category: 'ROOM_RENT', claimed: 50_000, paid: 0 }],
      admission: admissionOf({ admissionDate: '2026-06-01' }),
    });
    const [state, findings] = admissibility(stateOf(input, rulepack), contextOf(input, rulepack, 'ADMISSIBILITY'));
    expect(state.halted).toBe(true);
    expect(state.payable).toBe(0);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ clauseId: 'ADM.NOTINFORCE', bucket: 'CORRECTLY_APPLIED', amount: -R(50_000) });
  });

  it('declines to rule, rather than defaulting, when the cover period is unreadable', () => {
    const input = inputOf({
      rulepack,
      lines: [{ desc: 'Room rent', category: 'ROOM_RENT', claimed: 50_000 }],
      policy: policyOf({ policyStartDate: null }),
    });
    const [state, findings] = admissibility(stateOf(input, rulepack), contextOf(input, rulepack, 'ADMISSIBILITY'));
    expect(state.halted).toBe(false);
    expect(findings[0]).toMatchObject({ bucket: 'UNRESOLVED', unresolvedReason: 'MISSING_POLICY_SCHEDULE', clauseId: null });
    expect(findings[0]?.resolvedBy).toContain('cover period');
  });

  it('reports a breach of the initial waiting period as a caveat, not a rejection', () => {
    const input = inputOf({
      rulepack,
      lines: [{ desc: 'Room rent', category: 'ROOM_RENT', claimed: 50_000 }],
      policy: policyOf({
        policyStartDate: '2025-08-01',
        waitingPeriods: [{ clauseId: 'ADM.WAITING.INITIAL' as never, label: 'Initial', months: 3, appliesToConditions: [] }],
      }),
    });
    const [state, findings] = admissibility(stateOf(input, rulepack), contextOf(input, rulepack, 'ADMISSIBILITY'));
    expect(state.halted).toBe(false);
    expect(state.payable).toBe(R(50_000));
    expect(findings[0]).toMatchObject({ bucket: 'UNRESOLVED', unresolvedReason: 'MISSING_WORDING_CLAUSE', amount: 0 });
    expect(findings[0]?.resolvedBy).toContain('accidental injury');
  });
});

describe('step 2 — normalisation gate', () => {
  it('gates a line below minConfidence and carries the insurer’s cut as unplaceable', () => {
    const input = inputOf({
      rulepack,
      lines: [
        { desc: 'Surgeon fee', category: 'SURGEON_FEE', claimed: 30_000, paid: 30_000 },
        { desc: 'Misc', category: 'PHARMACY', claimed: 10_000, paid: 4_000, tier: 'EMBEDDING', confidence: 0.7 },
      ],
    });
    const [state, findings] = normalisationGate(stateOf(input, rulepack), contextOf(input, rulepack, 'NORMALISATION_GATE'));
    expect(state.payable).toBe(R(30_000));
    expect(state.lines[1]?.unresolved).toBe(true);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      lineRef: billRef(1),
      bucket: 'UNRESOLVED',
      unresolvedReason: 'LOW_EXTRACTION_CONFIDENCE',
      amount: -R(6_000),
    });
  });

  it('gates an uncategorised line as AMBIGUOUS_DESCRIPTION', () => {
    const input = inputOf({
      rulepack,
      lines: [{ desc: 'Pharmacy & consumables', category: null, claimed: 10_000, paid: 10_000 }],
    });
    const [, findings] = normalisationGate(stateOf(input, rulepack), contextOf(input, rulepack, 'NORMALISATION_GATE'));
    expect(findings[0]).toMatchObject({ unresolvedReason: 'AMBIGUOUS_DESCRIPTION', amount: 0 });
  });

  it('passes a line at exactly the gate', () => {
    const input = inputOf({
      rulepack,
      lines: [{ desc: 'Surgeon fee', category: 'SURGEON_FEE', claimed: 30_000, tier: 'EMBEDDING', confidence: 0.82 }],
    });
    const [state, findings] = normalisationGate(stateOf(input, rulepack), contextOf(input, rulepack, 'NORMALISATION_GATE'));
    expect(findings).toEqual([]);
    expect(state.lines[0]?.unresolved).toBe(false);
  });

  it('refuses a rulepack with no minConfidence rather than defaulting one', () => {
    const input = inputOf({ rulepack, lines: [{ desc: 'x', category: 'PHARMACY', claimed: 1 }] });
    expect(() =>
      normalisationGate(stateOf(input, rulepack), contextOf(input, rulepack, 'NORMALISATION_GATE', {})),
    ).toThrow(RangeError);
  });
});

describe('step 3 — non-payable items', () => {
  it('defends a full Annexure II cut with no rider under NP.ITEM.ANNEXURE_II', () => {
    const input = inputOf({
      rulepack,
      lines: [{ desc: 'Admin charges', category: 'ADMIN_CHARGE', claimed: 7_000, paid: 0, reason: 'NON-PAYABLE' }],
    });
    const [state, findings] = nonPayable(stateOf(input, rulepack), contextOf(input, rulepack, 'NON_PAYABLE'));
    expect(state.payable).toBe(0);
    expect(state.lines[0]?.deductedBy).toEqual(['NON_PAYABLE']);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ clauseId: 'NP.ITEM.ANNEXURE_II', bucket: 'CORRECTLY_APPLIED', amount: -R(7_000) });
  });

  it('checks the rider first, and disputes a cut on a line the rider covers under NP.RIDER.COVERED', () => {
    const input = inputOf({
      rulepack,
      lines: [{ desc: 'Consumables', category: 'CONSUMABLE', claimed: 20_000, paid: 0, reason: 'NON-PAYABLE' }],
      policy: policyOf({
        riders: [{ riderId: 'CONSUMABLES_RIDER', label: 'Consumables', effectiveFrom: '2025-04-01', coversCategories: ['CONSUMABLE' as CategoryId] }],
      }),
    });
    const [state, findings] = nonPayable(stateOf(input, rulepack), contextOf(input, rulepack, 'NON_PAYABLE'));
    expect(state.payable).toBe(R(20_000));
    expect(by(findings, 'CORRECTLY_APPLIED')).toEqual([]);
    expect(by(findings, 'INCORRECTLY_APPLIED', 'NP.RIDER.COVERED')[0]?.amount).toBe(-R(20_000));
  });

  it('does not let a rider bought after the admission rescue the line', () => {
    const input = inputOf({
      rulepack,
      lines: [{ desc: 'Consumables', category: 'CONSUMABLE', claimed: 20_000, paid: 0, reason: 'NON-PAYABLE' }],
      policy: policyOf({
        riders: [{ riderId: 'CONSUMABLES_RIDER', label: 'Consumables', effectiveFrom: '2025-10-01', coversCategories: ['CONSUMABLE' as CategoryId] }],
      }),
    });
    const [state, findings] = nonPayable(stateOf(input, rulepack), contextOf(input, rulepack, 'NON_PAYABLE'));
    expect(state.payable).toBe(0);
    expect(findings[0]?.clauseId).toBe('NP.ITEM.ANNEXURE_II');
  });

  it('leaves a payable line alone, and says nothing when the sheet has no row for the line', () => {
    const input = inputOf({
      rulepack,
      lines: [
        { desc: 'Pharmacy', category: 'PHARMACY', claimed: 10_000, paid: 6_000 },
        { desc: 'Admin charges', category: 'ADMIN_CHARGE', claimed: 7_000 },
      ],
    });
    const [state, findings] = nonPayable(stateOf(input, rulepack), contextOf(input, rulepack, 'NON_PAYABLE'));
    expect(findings).toEqual([]);
    expect(state.lines[0]?.allowed).toBe(R(10_000));
    // Our own reconstruction still cuts the non-payable line; only the
    // finding is withheld, because there is no insurer figure to decompose.
    expect(state.lines[1]?.allowed).toBe(0);
  });
});

describe('step 4 — caps and sub-limits', () => {
  const room = (paid: number) =>
    inputOf({
      rulepack,
      lines: [{ desc: 'Room rent', category: 'ROOM_RENT', claimed: 50_000, paid, reason: 'ROOM RENT LIMIT' }],
    });

  it('defends a room rent cut down to cap × days under LIMIT.ROOM', () => {
    // 6,000 × 5 = 30,000 allowed; they paid exactly that.
    const input = room(30_000);
    const [state, findings] = capsSublimits(stateOf(input, rulepack), contextOf(input, rulepack, 'CAPS_SUBLIMITS'));
    expect(state.payable).toBe(R(30_000));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ clauseId: 'LIMIT.ROOM', bucket: 'CORRECTLY_APPLIED', amount: -R(20_000) });
    expect(findings[0]?.arithmetic.inputs).toMatchObject({ perDay: R(6000), days: 5 });
  });

  it('splits an over-cut into the lawful part and the excess, both under LIMIT.ROOM', () => {
    const input = room(25_000);
    const [, findings] = capsSublimits(stateOf(input, rulepack), contextOf(input, rulepack, 'CAPS_SUBLIMITS'));
    expect(by(findings, 'CORRECTLY_APPLIED', 'LIMIT.ROOM')[0]?.amount).toBe(-R(20_000));
    expect(by(findings, 'INCORRECTLY_APPLIED', 'LIMIT.ROOM')[0]?.amount).toBe(-R(5_000));
  });

  it('reports a cut it cannot check as unplaceable when the cap is unreadable, never as lawful', () => {
    const input = inputOf({
      rulepack,
      lines: [{ desc: 'Room rent', category: 'ROOM_RENT', claimed: 50_000, paid: 30_000 }],
      policy: policyOf({ roomRentCapPerDay: null }),
    });
    const [state, findings] = capsSublimits(stateOf(input, rulepack), contextOf(input, rulepack, 'CAPS_SUBLIMITS'));
    expect(findings[0]).toMatchObject({ bucket: 'UNRESOLVED', unresolvedReason: 'MISSING_POLICY_SCHEDULE', amount: -R(20_000) });
    expect(state.lines[0]?.insurerAttributed).toBe(R(20_000));
    expect(state.payable).toBe(R(50_000));
  });

  it('derives the room cap from a percentage of sum insured when no amount is printed', () => {
    const input = inputOf({
      rulepack,
      lines: [{ desc: 'Room rent', category: 'ROOM_RENT', claimed: 50_000, paid: 25_000 }],
      policy: policyOf({ roomRentCapPerDay: null, roomRentCapPercentOfSumInsured: 1 }),
    });
    // 1% of 5,00,000 = 5,000/day × 5 = 25,000.
    const [state, findings] = capsSublimits(stateOf(input, rulepack), contextOf(input, rulepack, 'CAPS_SUBLIMITS'));
    expect(state.payable).toBe(R(25_000));
    expect(findings[0]).toMatchObject({ clauseId: 'LIMIT.ROOM', bucket: 'CORRECTLY_APPLIED', amount: -R(25_000) });
  });

  it('applies a per-claim sub-limit from the schedule under its own clause', () => {
    const input = inputOf({
      rulepack,
      lines: [{ desc: 'Ambulance', category: 'AMBULANCE', claimed: 5_000, paid: 2_000, reason: 'SUB-LIMIT' }],
      policy: policyOf({
        subLimits: [{ clauseId: 'LIMIT.AMBULANCE' as never, label: 'Ambulance', appliesToCategories: ['AMBULANCE' as CategoryId], capAmount: R(2_000), capPercentOfSumInsured: null, perDay: false }],
      }),
    });
    const [state, findings] = capsSublimits(stateOf(input, rulepack), contextOf(input, rulepack, 'CAPS_SUBLIMITS'));
    expect(state.payable).toBe(R(2_000));
    expect(findings[0]).toMatchObject({ clauseId: 'LIMIT.AMBULANCE', bucket: 'CORRECTLY_APPLIED', amount: -R(3_000) });
  });
});

describe('step 5 — proportionate deduction', () => {
  // Room 10,000/day against 6,000 eligible: 40% off the AME base, nothing else.
  const lines = [
    { desc: 'Surgeon fee', category: 'SURGEON_FEE', claimed: 35_000, paid: 21_000, reason: 'PROP-DEDUCT' },
    { desc: 'Pharmacy', category: 'PHARMACY', claimed: 10_000, paid: 6_000, reason: 'PROP-DEDUCT' },
    { desc: 'ICU charges', category: 'ICU_CHARGE', claimed: 24_000, paid: 14_400, reason: 'PROP-DEDUCT' },
    { desc: 'Stent', category: 'IMPLANT_DEVICE', claimed: 100_000, paid: 60_000, reason: 'PROP-DEDUCT' },
    { desc: 'Laboratory', category: 'DIAGNOSTICS', claimed: 5_000, paid: 3_000, reason: 'PROP-DEDUCT' },
  ];

  it('applies the ratio to the AME base and disputes it on every exempt line under the exempting clause', () => {
    const input = inputOf({ rulepack, lines });
    const [state, findings] = proportionate(stateOf(input, rulepack), contextOf(input, rulepack, 'PROPORTIONATE'));

    expect(by(findings, 'CORRECTLY_APPLIED', 'PD.LIMIT')[0]?.amount).toBe(-R(14_000));
    expect(by(findings, 'INCORRECTLY_APPLIED', 'AME.EXCL.PHARMA')[0]?.amount).toBe(-R(4_000));
    expect(by(findings, 'INCORRECTLY_APPLIED', 'PD.ICU')[0]?.amount).toBe(-R(9_600));
    expect(by(findings, 'INCORRECTLY_APPLIED', 'AME.EXCL.IMPLANT')[0]?.amount).toBe(-R(40_000));
    expect(by(findings, 'INCORRECTLY_APPLIED', 'AME.EXCL.DIAG')[0]?.amount).toBe(-R(2_000));
    expect(state.payable).toBe(R(35_000 - 14_000 + 10_000 + 24_000 + 100_000 + 5_000));
  });

  it('disputes recovery beyond the lawful figure under PD.LIMIT, itemised on the line', () => {
    const input = inputOf({
      rulepack,
      lines: [{ desc: 'Surgeon fee', category: 'SURGEON_FEE', claimed: 35_000, paid: 15_000, reason: 'PROP-DEDUCT' }],
    });
    const [, findings] = proportionate(stateOf(input, rulepack), contextOf(input, rulepack, 'PROPORTIONATE'));
    expect(by(findings, 'CORRECTLY_APPLIED', 'PD.LIMIT')[0]?.amount).toBe(-R(14_000));
    expect(by(findings, 'INCORRECTLY_APPLIED', 'PD.LIMIT')[0]).toMatchObject({ lineRef: billRef(0), amount: -R(6_000) });
  });

  it('forbids any PD at a hospital without differential billing — PD.DIFFBILL, including on AME lines', () => {
    const input = inputOf({ rulepack, lines, admission: admissionOf({ hospitalUsesDifferentialBilling: false }) });
    const [, findings] = proportionate(stateOf(input, rulepack), contextOf(input, rulepack, 'PROPORTIONATE'));
    expect(by(findings, 'CORRECTLY_APPLIED')).toEqual([]);
    expect(by(findings, 'INCORRECTLY_APPLIED', 'PD.DIFFBILL')).toHaveLength(5);
  });

  it('forbids any PD under a wording with no proportionate clause — PD.NOCLAUSE', () => {
    const input = inputOf({ rulepack, lines, policy: policyOf({ hasProportionateDeductionClause: false }) });
    const [, findings] = proportionate(stateOf(input, rulepack), contextOf(input, rulepack, 'PROPORTIONATE'));
    expect(by(findings, 'INCORRECTLY_APPLIED', 'PD.NOCLAUSE')).toHaveLength(5);
  });

  it('refuses to rule when the billing mode is unknown, carrying each cut as HOSPITAL_BILLING_MODE_UNKNOWN', () => {
    const input = inputOf({ rulepack, lines, admission: admissionOf({ hospitalUsesDifferentialBilling: null }) });
    const [state, findings] = proportionate(stateOf(input, rulepack), contextOf(input, rulepack, 'PROPORTIONATE'));
    expect(findings).toHaveLength(5);
    for (const f of findings) expect(f).toMatchObject({ bucket: 'UNRESOLVED', unresolvedReason: 'HOSPITAL_BILLING_MODE_UNKNOWN' });
    expect(state.payable).toBe(R(174_000));
  });

  it('will not apply the 2020 circular to a policy it does not reach', () => {
    const input = inputOf({ rulepack, lines, policy: policyOf({ productFiledOn: '2017-01-01', lastRenewedOn: '2019-04-01' }) });
    const [, findings] = proportionate(stateOf(input, rulepack), contextOf(input, rulepack, 'PROPORTIONATE'));
    for (const f of findings) expect(f).toMatchObject({ bucket: 'UNRESOLVED', unresolvedReason: 'MISSING_WORDING_CLAUSE' });
    expect(findings[0]?.resolvedBy).toContain('renewal');
  });

  it('does nothing to a line the policy’s own AME definition never claimed', () => {
    const input = inputOf({
      rulepack,
      lines: [{ desc: 'Physiotherapy', category: 'PHYSIOTHERAPY', claimed: 10_000, paid: 6_000, reason: 'PROP-DEDUCT' }],
    });
    const [, findings] = proportionate(stateOf(input, rulepack), contextOf(input, rulepack, 'PROPORTIONATE'));
    expect(by(findings, 'CORRECTLY_APPLIED')).toEqual([]);
    expect(by(findings, 'INCORRECTLY_APPLIED', 'PD.LIMIT')[0]?.amount).toBe(-R(4_000));
  });

  it('rounds the surviving share by the rulepack’s declared mode, not the float unit’s', () => {
    // 1,001 paise × 1/3: ROUND_HALF_UP survives 334, FLOOR survives 333.
    const mk = (mode: 'ROUND_HALF_UP' | 'FLOOR') => {
      const pack = rulepackOf({ rounding: { mode, matchTolerancePaise: rulepack.rounding.matchTolerancePaise } });
      const input = inputOf({
        rulepack: pack,
        lines: [{ desc: 'Surgeon fee', category: 'SURGEON_FEE', claimed: 10.01, paid: 0, reason: 'PROP-DEDUCT' }],
        policy: policyOf({ roomRentCapPerDay: R(1) }),
        admission: admissionOf({ actualRoomRentPerDay: R(3) }),
      });
      const [state] = proportionate(stateOf(input, pack), contextOf(input, pack, 'PROPORTIONATE'));
      return state.lines[0]?.allowed;
    };
    expect(mk('ROUND_HALF_UP')).toBe(334);
    expect(mk('FLOOR')).toBe(333);
  });
});

describe('step 6 — co-pay and deductible', () => {
  const policy = policyOf({ deductible: R(10_000), copayPercent: 10 });
  const line = { desc: 'Surgeon fee', category: 'SURGEON_FEE', claimed: 100_000, paid: 100_000 };

  it('applies the deductible then the co-pay in the order the rulepack declares', () => {
    const input = inputOf({
      rulepack,
      lines: [line],
      policy,
      claimRows: [{ desc: 'Deductible', amount: 10_000, reason: 'DEDUCTIBLE' }, { desc: 'Co-pay @ 10%', amount: 9_000, reason: 'CO-PAY' }],
    });
    const [state, findings] = copayDeductible(stateOf(input, rulepack), contextOf(input, rulepack, 'COPAY_DEDUCTIBLE'));
    expect(state.payable).toBe(R(81_000));
    expect(findings.map((f) => [f.clauseId, f.amount])).toEqual([['DEDUCT.AMT', -R(10_000)], ['COPAY.PCT', -R(9_000)]]);
    expect(findings[1]?.arithmetic.expression).toContain('DEDUCTIBLE then COPAY');
  });

  it('produces a different answer in the other order — which is why the order is data', () => {
    const input = inputOf({
      rulepack,
      lines: [line],
      policy,
      claimRows: [{ desc: 'Co-pay @ 10%', amount: 10_000, reason: 'CO-PAY' }, { desc: 'Deductible', amount: 10_000, reason: 'DEDUCTIBLE' }],
    });
    const [state] = copayDeductible(
      stateOf(input, rulepack),
      contextOf(input, rulepack, 'COPAY_DEDUCTIBLE', { order: ['COPAY', 'DEDUCTIBLE'] }),
    );
    expect(state.payable).toBe(R(80_000));
  });

  it('defends only what the sheet shows the insurer took, never more', () => {
    // Their co-pay is 7,000 on a base they had already shrunk. Ours would be
    // 9,000; the ledger decomposes theirs.
    const input = inputOf({
      rulepack,
      lines: [line],
      policy,
      claimRows: [{ desc: 'Deductible', amount: 10_000, reason: 'DEDUCTIBLE' }, { desc: 'Co-pay @ 10%', amount: 7_000, reason: 'CO-PAY' }],
    });
    const [state, findings] = copayDeductible(stateOf(input, rulepack), contextOf(input, rulepack, 'COPAY_DEDUCTIBLE'));
    expect(findings.find((f) => f.clauseId === 'COPAY.PCT')?.amount).toBe(-R(7_000));
    // Our own balance still falls by our lawful figure.
    expect(state.payable).toBe(R(81_000));
  });

  it('emits nothing for a lever the sheet shows was not applied', () => {
    const input = inputOf({ rulepack, lines: [line], policy });
    const [state, findings] = copayDeductible(stateOf(input, rulepack), contextOf(input, rulepack, 'COPAY_DEDUCTIBLE'));
    expect(findings).toEqual([]);
    expect(state.payable).toBe(R(81_000));
  });

  it('clamps the deductible to the balance rather than going negative', () => {
    const input = inputOf({
      rulepack,
      lines: [{ ...line, claimed: 4_000, paid: 4_000 }],
      policy: policyOf({ deductible: R(10_000) }),
      claimRows: [{ desc: 'Deductible', amount: 4_000, reason: 'DEDUCTIBLE' }],
    });
    const [state, findings] = copayDeductible(stateOf(input, rulepack), contextOf(input, rulepack, 'COPAY_DEDUCTIBLE'));
    expect(state.payable).toBe(0);
    expect(findings[0]?.amount).toBe(-R(4_000));
  });

  it('refuses a malformed order rather than defaulting one', () => {
    const input = inputOf({ rulepack, lines: [line], policy });
    for (const order of [[], ['COPAY', 'COPAY'], ['DEDUCTIBLE', 'SOMETHING'], 'COPAY']) {
      expect(() =>
        copayDeductible(stateOf(input, rulepack), contextOf(input, rulepack, 'COPAY_DEDUCTIBLE', { order })),
      ).toThrow(RangeError);
    }
  });
});

describe('step 7 — sum insured', () => {
  const line = { desc: 'Surgeon fee', category: 'SURGEON_FEE', claimed: 600_000, paid: 600_000 };

  it('caps the payable at the remaining sum insured and defends what the sheet took under SI.EXHAUSTED', () => {
    const input = inputOf({
      rulepack,
      lines: [line],
      policy: policyOf({ sumInsured: R(500_000), sumInsuredRemaining: R(400_000) }),
      claimRows: [{ desc: 'Sum insured exhausted', amount: 200_000, reason: 'SI' }],
    });
    const [state, findings] = sumInsured(stateOf(input, rulepack), contextOf(input, rulepack, 'SUM_INSURED'));
    expect(state.payable).toBe(R(400_000));
    expect(findings[0]).toMatchObject({ clauseId: 'SI.EXHAUSTED', bucket: 'CORRECTLY_APPLIED', amount: -R(200_000) });
  });

  it('honours a restore benefit and a no-claim bonus only when the schedule grants them', () => {
    const input = inputOf({
      rulepack,
      lines: [line],
      policy: policyOf({ sumInsured: R(300_000), sumInsuredRemaining: R(300_000), restoreBenefitGranted: true, noClaimBonus: R(50_000) }),
    });
    const [state, findings] = sumInsured(stateOf(input, rulepack), contextOf(input, rulepack, 'SUM_INSURED'));
    // 3,00,000 + 50,000 bonus + 3,00,000 restore = 6,50,000 > 6,00,000: no cap.
    expect(state.payable).toBe(R(600_000));
    expect(findings).toEqual([]);
  });

  it('refuses to cap against an unreadable sum insured', () => {
    const input = inputOf({ rulepack, lines: [line], policy: policyOf({ sumInsured: null, sumInsuredRemaining: null }) });
    const [state, findings] = sumInsured(stateOf(input, rulepack), contextOf(input, rulepack, 'SUM_INSURED'));
    expect(state.payable).toBe(R(600_000));
    expect(findings[0]).toMatchObject({ bucket: 'UNRESOLVED', unresolvedReason: 'MISSING_POLICY_SCHEDULE' });
  });
});
