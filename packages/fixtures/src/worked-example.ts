/**
 * The worked example from the README, as data.
 *
 * It lives in its own package because two very different consumers have to
 * agree on it to the paise:
 *
 *   the golden test  asserts the published figures, so a change to a step, a
 *                    clause or the step order fails the build instead of
 *                    quietly making the front page wrong.
 *
 *   the demo UI      settles this pack in the browser on load. Every number a
 *                    judge reads on screen is therefore a number the test
 *                    asserts, computed by the same engine, and not a
 *                    screenshot or a hardcoded string.
 *
 * The claim: a 7-day admission where the patient took a room above
 * eligibility, and the insurer applied the resulting 40% proportionate
 * deduction to the whole bill instead of to the associated medical expenses
 * alone.
 */
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

const R = (rupees: number): Paise => rupeesToPaise(rupees);

export interface FixtureLine {
  readonly desc: string;
  readonly category: string;
  readonly claimed: number;
  /** What the insurer paid on this line. */
  readonly paid: number;
  readonly reason: string | null;
}

/**
 * Bill total 4,15,000. The room was billed at 10,000/day against a 6,000
 * eligibility, so the insurer's ratio is 6,000/10,000 — a 40% cut.
 */
export const LINES: readonly FixtureLine[] = [
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
export const CLAIM_LEVEL: readonly { desc: string; amount: number; reason: string | null }[] = [
  { desc: 'Deductible', amount: 10_000, reason: 'DEDUCTIBLE' },
  { desc: 'Co-pay @ 10%', amount: 23_480, reason: 'CO-PAY' },
  { desc: 'Other Deductions', amount: 3_000, reason: null },
];

export const BILL_DOC = 'doc-bill' as DocId;
export const SHEET_DOC = 'doc-deduction-sheet' as DocId;

/**
 * 2,08,320 rather than the 2,11,320 the insurer's own arithmetic produces. The
 * extra 3,000 is an unexplained "OTHER DEDUCTIONS" line, and it is here on
 * purpose: it is what forces the unresolved bucket to be non-empty and the
 * zero-sum invariant to account for a gap nobody can cite.
 */
export const ACTUAL_PAID = R(208_320);

/**
 * Settlement is evaluated as of a fixed instant, not `Date.now()`.
 *
 * Step 1 tests the policy period and the waiting periods against a clock, so a
 * floating `now` would make the demo drift out of the policy year and the
 * golden test go red on a date nobody changed.
 */
export const AS_OF = '2026-09-18T00:00:00.000Z';

export const billRef = (i: number): LineRef => `${BILL_DOC}:1:${i}` as LineRef;

/** Resolves a finding's `lineRef` back to the description a human would read. */
export function lineDescription(ref: LineRef | null): string | null {
  if (ref === null) return null;
  const index = Number(ref.split(':')[2]);
  return LINES[index]?.desc ?? null;
}

export function buildInput(): ReconstructInput {
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
