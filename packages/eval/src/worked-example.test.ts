import { describe, expect, it } from 'vitest';
import type {
  CategoryId,
  DocId,
  ExtractedRow,
  ExtractedTable,
  LineRef,
  NormalisedLine,
  Paise,
  ReconstructInput,
} from '@fc/contracts';
import { rupeesToPaise } from '@fc/contracts';
import { loadRulepackV1 } from '@fc/rulepack';
import { reconstruct } from '@fc/engine';

/**
 * The worked example from the README, end to end.
 *
 * This is the test that stops the README from drifting into fiction. Every
 * rupee quoted there is asserted here, so a change to a step, a clause, or the
 * step order that would alter the published figures fails the build instead of
 * quietly making the front page wrong.
 *
 * The claim: a 7-day admission where the patient took a room above eligibility,
 * and the insurer applied the resulting 40% proportionate deduction to the
 * whole bill instead of to the associated medical expenses alone.
 */

const R = (rupees: number): Paise => rupeesToPaise(rupees);

interface Line {
  readonly desc: string;
  readonly category: string;
  readonly claimed: number;
  /** What the insurer paid on this line. */
  readonly paid: number;
  readonly reason: string | null;
}

// Bill total 4,15,000. The room was billed at 10,000/day against a 6,000
// eligibility, so the insurer's ratio is 6,000/10,000 — a 40% cut.
const LINES: readonly Line[] = [
  { desc: 'Room Rent - Deluxe (5 days)', category: 'ROOM_RENT', claimed: 50_000, paid: 30_000, reason: 'ROOM RENT LIMIT' },
  { desc: 'ICU Charges (2 days)', category: 'ICU_CHARGE', claimed: 24_000, paid: 14_400, reason: 'PROP-DEDUCT' },
  { desc: 'Surgeon Fee', category: 'SURGEON_FEE', claimed: 35_000, paid: 21_000, reason: 'PROP-DEDUCT' },
  { desc: 'Anaesthetist Fee', category: 'ANAESTHETIST_FEE', claimed: 12_000, paid: 7_200, reason: 'PROP-DEDUCT' },
  { desc: 'OT Charges', category: 'OT_CHARGE', claimed: 13_000, paid: 7_800, reason: 'PROP-DEDUCT' },
  // Billed separately, as an itemised bill should. Both are exempt from
  // proportionate deduction under the same clause, but they differ on
  // payability: the medicines are payable outright, and the disposables are an
  // Annexure II item that only the consumables rider buys back.
  { desc: 'Pharmacy', category: 'PHARMACY', claimed: 78_000, paid: 46_800, reason: 'PROP-DEDUCT' },
  { desc: 'Surgical Consumables', category: 'CONSUMABLE', claimed: 20_000, paid: 12_000, reason: 'PROP-DEDUCT' },
  { desc: 'Drug Eluting Stent', category: 'IMPLANT_DEVICE', claimed: 120_000, paid: 72_000, reason: 'PROP-DEDUCT' },
  { desc: 'Laboratory and Imaging', category: 'DIAGNOSTICS', claimed: 56_000, paid: 33_600, reason: 'PROP-DEDUCT' },
  { desc: 'Medical Records and Administrative Charges', category: 'ADMIN_CHARGE', claimed: 7_000, paid: 0, reason: 'NON-PAYABLE ANNEXURE II' },
];

/**
 * The summary rows at the foot of the deduction sheet.
 *
 * The insurer's co-pay is 23,480, not the 35,400 our reconstruction says is
 * lawful — because a co-pay is a percentage, and their unlawful upstream
 * deduction shrank the base it applied to. Reading it off the sheet rather than
 * recomputing it is what keeps the ledger a decomposition of *their* decision.
 */
const CLAIM_LEVEL: readonly { desc: string; amount: number; reason: string | null }[] = [
  { desc: 'Deductible', amount: 10_000, reason: 'DEDUCTIBLE' },
  { desc: 'Co-pay @ 10%', amount: 23_480, reason: 'CO-PAY' },
  { desc: 'Other Deductions', amount: 3_000, reason: null },
];

const BILL_DOC = 'doc-bill' as DocId;
const SHEET_DOC = 'doc-deduction-sheet' as DocId;

/**
 * 2,08,320 rather than the 2,11,320 the insurer's own arithmetic produces. The
 * extra 3,000 is an unexplained "OTHER DEDUCTIONS" line, and it is here on
 * purpose: it is what forces the unresolved bucket to be non-empty and the
 * zero-sum invariant to account for a gap nobody can cite.
 */
const ACTUAL_PAID = R(208_320);

describe('the worked example from the README', () => {
  const pack = loadRulepackV1();
  const result = reconstruct({ input: buildInput(), rulepack: pack, now: '2026-09-18T00:00:00.000Z' });

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

/* ------------------------------------------------------------- the fixture */

const billRef = (i: number): LineRef => `${BILL_DOC}:1:${i}` as LineRef;

function lineDescription(ref: LineRef | null): string | null {
  if (ref === null) return null;
  const index = Number(ref.split(':')[2]);
  return LINES[index]?.desc ?? null;
}

function buildInput(): ReconstructInput {
  return {
    caseId: 'case-readme-worked-example' as ReconstructInput['caseId'],
    pins: {
      engineVersion: '0.1.0',
      rulepackVersion: 'v1',
      rulepackHash: loadRulepackV1().hash,
      lexiconVersion: 'v1',
      extractionHash: `sha256:${'0'.repeat(64)}`,
      stepOrder: [
        'ADMISSIBILITY',
        'NORMALISATION_GATE',
        'NON_PAYABLE',
        'CAPS_SUBLIMITS',
        'PROPORTIONATE',
        'COPAY_DEDUCTIBLE',
        'SUM_INSURED',
      ],
    },
    policy: {
      insurerWordingId: 'demo-insurer-v1',
      policyStartDate: '2026-04-01',
      policyEndDate: '2027-03-31',
      // Filed after the circular's commencement date, so its bright lines bind.
      productFiledOn: '2021-06-01',
      lastRenewedOn: '2026-04-01',

      sumInsured: R(500_000),
      sumInsuredRemaining: R(500_000),
      restoreBenefitGranted: false,
      noClaimBonus: null,

      roomRentCapPerDay: R(6_000),
      roomRentCapPercentOfSumInsured: null,
      eligibleRoomCategory: 'SINGLE_PRIVATE',
      icuCapPerDay: R(15_000),

      copayPercent: 10,
      deductible: R(10_000),

      subLimits: [],
      waitingPeriods: [],
      // A consumables rider, so pharmacy is not cut by Annexure II in step 3.
      // Without it this claim never reaches the proportionate question on that
      // line, because exemption from PD does not make a line payable.
      riders: [
        {
          riderId: 'CONSUMABLES_RIDER',
          label: 'Consumables cover',
          effectiveFrom: '2026-04-01',
          coversCategories: ['CONSUMABLE' as CategoryId],
        },
      ],

      // The insurer's own definition is deliberately broad — it claims every
      // category below as an associated medical expense. The circular is what
      // narrows it, and that narrowing is the finding.
      hasProportionateDeductionClause: true,
      ameDefinitionCategories: [
        'SURGEON_FEE',
        'ANAESTHETIST_FEE',
        'OT_CHARGE',
        'NURSING_CHARGE',
        'DOCTOR_VISIT',
        'PHARMACY',
        'CONSUMABLE',
        'IMPLANT_DEVICE',
        'DIAGNOSTICS',
        'ICU_CHARGE',
      ] as CategoryId[],
    },
    admission: {
      admissionDate: '2026-08-10',
      dischargeDate: '2026-08-17',
      occupiedRoomCategory: 'DELUXE',
      actualRoomRentPerDay: R(10_000),
      roomDays: 5,
      icuDays: 2,
      hospitalUsesDifferentialBilling: true,
    },
    billTable: table(BILL_DOC, LINES.map((l, i) => row(BILL_DOC, i, l.desc, l.claimed, null, null))),
    // Per-line disallowances, then the summary rows every real sheet carries.
    // The last one is the unexplained 3,000.
    deductionTable: table(SHEET_DOC, [
      ...LINES.map((l, i) => row(SHEET_DOC, i, l.desc, l.claimed, l.paid, l.reason)),
      ...CLAIM_LEVEL.map((c, i) =>
        row(SHEET_DOC, LINES.length + i, c.desc, c.amount, 0, c.reason),
      ),
    ]),
    normalisedLines: LINES.map((l, i): NormalisedLine => ({
      lineRef: billRef(i),
      rawDescription: l.desc,
      categoryId: l.category as CategoryId,
      tier: 'LEXICON',
      confidence: 1,
      embeddingMargin: null,
      candidates: [l.category as CategoryId],
    })),
    actualPaid: ACTUAL_PAID,
  };
}

function table(docId: DocId, rows: readonly ExtractedRow[]): ExtractedTable {
  return {
    docId,
    rows: [...rows],
    printedTotal: rows.reduce((sum, r) => (sum + r.amountClaimed) as Paise, 0 as Paise),
  };
}

function row(
  docId: DocId,
  index: number,
  rawDescription: string,
  claimed: number,
  paid: number | null,
  insurerReasonCode: string | null,
): ExtractedRow {
  return {
    lineRef: `${docId}:1:${index}` as LineRef,
    rawDescription,
    quantity: null,
    amountClaimed: R(claimed),
    amountPaid: paid === null ? null : R(paid),
    insurerReasonCode,
    provenance: {
      docId,
      bbox: { page: 1, left: 0.1, top: 0.1 + index * 0.05, width: 0.8, height: 0.04 },
      textractConfidence: 99,
      corrected: false,
    },
  };
}
