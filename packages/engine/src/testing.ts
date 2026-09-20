import type {
  AdmissionFacts,
  CategoryId,
  DocId,
  ExtractedRow,
  ExtractedTable,
  LineRef,
  NormalisedLine,
  Paise,
  PolicySchedule,
  ReconstructInput,
  Rulepack,
  StepDefinition,
} from '@fc/contracts';
import { rupeesToPaise, unsafePaise } from '@fc/contracts';
import { matchDeductionSheet } from './insurer';
import { initialState } from './interpreter';
import type { ReducerContext, WaterfallState } from './state';

/**
 * Builders for reducer tests. Not exported from the package: the engine's
 * public surface is `reconstruct`, and these exist so a step can be tested
 * in isolation against a hand-computed expectation without twenty lines of
 * fixture per case.
 */
export const R = (rupees: number): Paise => rupeesToPaise(rupees);

export const BILL = 'bill' as DocId;
export const SHEET = 'sheet' as DocId;

export interface TestLine {
  readonly desc: string;
  readonly category: string | null;
  readonly claimed: number;
  /** Rupees the insurer paid on this line. Omit for "no sheet row". */
  readonly paid?: number;
  readonly reason?: string | null;
  readonly tier?: NormalisedLine['tier'];
  readonly confidence?: number;
}

export interface TestClaimRow {
  readonly desc: string;
  readonly amount: number;
  readonly reason?: string | null;
}

export const billRef = (i: number): LineRef => `${BILL}:1:${i}` as LineRef;

export function policyOf(over: Partial<PolicySchedule> = {}): PolicySchedule {
  return {
    insurerWordingId: 'test',
    policyStartDate: '2025-04-01',
    policyEndDate: '2026-03-31',
    productFiledOn: '2021-06-01',
    lastRenewedOn: '2025-04-01',
    sumInsured: R(500_000),
    sumInsuredRemaining: R(500_000),
    restoreBenefitGranted: false,
    noClaimBonus: null,
    roomRentCapPerDay: R(6000),
    roomRentCapPercentOfSumInsured: null,
    eligibleRoomCategory: 'SINGLE_PRIVATE',
    icuCapPerDay: R(12_000),
    copayPercent: 0,
    deductible: null,
    subLimits: [],
    waitingPeriods: [],
    riders: [],
    hasProportionateDeductionClause: true,
    ameDefinitionCategories: [
      'SURGEON_FEE', 'ANAESTHETIST_FEE', 'OT_CHARGE', 'NURSING_CHARGE', 'DOCTOR_VISIT',
      'PHARMACY', 'CONSUMABLE', 'IMPLANT_DEVICE', 'DIAGNOSTICS', 'ICU_CHARGE',
    ] as CategoryId[],
    ...over,
  };
}

export function admissionOf(over: Partial<AdmissionFacts> = {}): AdmissionFacts {
  return {
    admissionDate: '2025-09-10',
    dischargeDate: '2025-09-17',
    occupiedRoomCategory: 'DELUXE',
    actualRoomRentPerDay: R(10_000),
    roomDays: 5,
    icuDays: 2,
    hospitalUsesDifferentialBilling: true,
    ...over,
  };
}

const provenance = (docId: DocId, i: number): ExtractedRow['provenance'] => ({
  docId,
  bbox: { page: 1, left: 0.1, top: 0.1 + i * 0.02, width: 0.8, height: 0.015 },
  textractConfidence: 99,
  corrected: false,
});

export function inputOf(a: {
  lines: readonly TestLine[];
  claimRows?: readonly TestClaimRow[];
  policy?: PolicySchedule;
  admission?: AdmissionFacts;
  actualPaid?: number;
  rulepack: Rulepack;
}): ReconstructInput {
  const policy = a.policy ?? policyOf();
  const admission = a.admission ?? admissionOf();

  const billRows: ExtractedRow[] = a.lines.map((l, i) => ({
    lineRef: billRef(i),
    rawDescription: l.desc,
    quantity: null,
    amountClaimed: R(l.claimed),
    amountPaid: null,
    insurerReasonCode: null,
    provenance: provenance(BILL, i),
  }));

  const sheetRows: ExtractedRow[] = [];
  a.lines.forEach((l, i) => {
    if (l.paid === undefined) return;
    sheetRows.push({
      lineRef: `${SHEET}:1:${sheetRows.length}` as LineRef,
      rawDescription: l.desc,
      quantity: null,
      amountClaimed: R(l.claimed),
      amountPaid: R(l.paid),
      insurerReasonCode: l.reason ?? null,
      provenance: provenance(SHEET, i),
    });
  });
  for (const c of a.claimRows ?? []) {
    sheetRows.push({
      lineRef: `${SHEET}:1:${sheetRows.length}` as LineRef,
      rawDescription: c.desc,
      quantity: null,
      amountClaimed: R(c.amount),
      amountPaid: unsafePaise(0),
      insurerReasonCode: c.reason ?? null,
      provenance: provenance(SHEET, 90),
    });
  }

  const billTable: ExtractedTable = {
    docId: BILL,
    rows: billRows,
    printedTotal: billRows.reduce((s, r) => unsafePaise(s + r.amountClaimed), unsafePaise(0)),
  };
  const deductionTable: ExtractedTable = { docId: SHEET, rows: sheetRows, printedTotal: null };

  const paidOnLines = a.lines.reduce((s, l) => s + (l.paid ?? l.claimed), 0);
  const claimCuts = (a.claimRows ?? []).reduce((s, c) => s + c.amount, 0);

  return {
    caseId: 'case-test' as ReconstructInput['caseId'],
    pins: {
      engineVersion: '0.1.0',
      rulepackVersion: a.rulepack.version,
      rulepackHash: a.rulepack.hash,
      lexiconVersion: 'v1',
      extractionHash: `sha256:${'0'.repeat(64)}`,
      stepOrder: a.rulepack.steps.map((s) => s.id),
    },
    policy,
    admission,
    billTable,
    deductionTable,
    normalisedLines: a.lines.map((l, i) => ({
      lineRef: billRef(i),
      rawDescription: l.desc,
      categoryId: l.category as CategoryId | null,
      tier: l.tier ?? (l.category === null ? 'UNRESOLVED' : 'LEXICON'),
      confidence: l.confidence ?? (l.category === null ? 0 : 1),
      embeddingMargin: null,
      candidates: l.category === null ? [] : [l.category as CategoryId],
    })),
    actualPaid: R(a.actualPaid ?? Math.max(0, paidOnLines - claimCuts)),
  };
}

/** The context a reducer would receive from the interpreter for `stepId`. */
export function contextOf(
  input: ReconstructInput,
  rulepack: Rulepack,
  stepId: StepDefinition['id'],
  paramsOverride?: Record<string, unknown>,
): ReducerContext {
  const def = rulepack.steps.find((s) => s.id === stepId);
  if (!def) throw new Error(`no step ${stepId} in rulepack`);
  const insurer = matchDeductionSheet(
    input.billTable,
    input.deductionTable,
    rulepack.rounding.matchTolerancePaise,
  );
  return {
    rulepack,
    policy: input.policy,
    admission: input.admission,
    params: paramsOverride ?? def.params,
    insurerByLine: insurer.byLine,
    insurerClaimLevel: insurer.claimLevel,
  };
}

export const stateOf = (input: ReconstructInput, rulepack: Rulepack): WaterfallState =>
  initialState(input, rulepack);

/* ------------------------------------------------------------ the rulepack */

const clause = (
  clauseId: string,
  effect: Rulepack['clauses'][string]['effect'],
  circular = false,
): Rulepack['clauses'][string] => ({
  clauseId: clauseId as Rulepack['clauses'][string]['clauseId'],
  source: circular ? 'IRDAI/HLT/REG/CIR/151/06/2020' : 'POLICY_WORDING',
  sourceDate: circular ? '2020-06-11' : null,
  paragraph: null,
  text: `text of ${clauseId}`,
  effect,
  appliesFrom: circular ? '2020-10-01' : null,
  appliesToExistingOnRenewalFrom: circular ? '2021-04-01' : null,
  citationUrl: null,
});

const category = (
  categoryId: string,
  a: Partial<Rulepack['categories'][string]> = {},
): Rulepack['categories'][string] => ({
  categoryId: categoryId as CategoryId,
  label: categoryId,
  ameEligible: false,
  ameExclusionClause: null,
  proportionateImmune: false,
  annexure: 'I',
  riderCanCover: [],
  aliases: [categoryId.toLowerCase()],
  ...a,
});

/**
 * A rulepack with the shape of v1 and just enough of its content for the
 * reducers to be exercised. Built here rather than loaded from @fc/rulepack
 * because the engine may depend on nothing but contracts — the tests included
 * — and because a step's behaviour should be pinned against a rulepack the
 * test controls, not one that can change under it.
 */
export function rulepackOf(over: Partial<Rulepack> = {}): Rulepack {
  const excl = (id: string) => ({ ameExclusionClause: id as Rulepack['categories'][string]['ameExclusionClause'] });
  return {
    version: 'test',
    hash: `sha256:${'a'.repeat(64)}`,
    steps: [
      { id: 'ADMISSIBILITY', reducer: '01-admissibility', haltsOnFail: true, params: {} },
      { id: 'NORMALISATION_GATE', reducer: '02-normalisation-gate', haltsOnFail: false, params: { minConfidence: 0.82 } },
      { id: 'NON_PAYABLE', reducer: '03-non-payable', haltsOnFail: false, params: { checkRidersFirst: true } },
      { id: 'CAPS_SUBLIMITS', reducer: '04-caps-sublimits', haltsOnFail: false, params: {} },
      { id: 'PROPORTIONATE', reducer: '05-proportionate', haltsOnFail: false, params: {} },
      { id: 'COPAY_DEDUCTIBLE', reducer: '06-copay-deductible', haltsOnFail: false, params: { order: ['DEDUCTIBLE', 'COPAY'] } },
      { id: 'SUM_INSURED', reducer: '07-sum-insured', haltsOnFail: false, params: {} },
    ],
    clauses: {
      'AME.EXCL.PHARMA': clause('AME.EXCL.PHARMA', 'EXCLUDE_FROM_AME', true),
      'AME.EXCL.IMPLANT': clause('AME.EXCL.IMPLANT', 'EXCLUDE_FROM_AME', true),
      'AME.EXCL.DIAG': clause('AME.EXCL.DIAG', 'EXCLUDE_FROM_AME', true),
      'PD.LIMIT': clause('PD.LIMIT', 'BOUNDS_PROPORTIONATE_RECOVERY', true),
      'PD.ICU': clause('PD.ICU', 'IMMUNE_TO_PROPORTIONATE', true),
      'PD.DIFFBILL': clause('PD.DIFFBILL', 'REQUIRES_DIFFERENTIAL_BILLING', true),
      'PD.NOCLAUSE': clause('PD.NOCLAUSE', 'BOUNDS_PROPORTIONATE_RECOVERY'),
      'LIMIT.ROOM': clause('LIMIT.ROOM', 'CAP'),
      'LIMIT.ICU': clause('LIMIT.ICU', 'CAP'),
      'LIMIT.AMBULANCE': clause('LIMIT.AMBULANCE', 'CAP'),
      'COPAY.PCT': clause('COPAY.PCT', 'COPAY'),
      'DEDUCT.AMT': clause('DEDUCT.AMT', 'DEDUCTIBLE'),
      'SI.EXHAUSTED': clause('SI.EXHAUSTED', 'SUM_INSURED'),
      'NP.ITEM.ANNEXURE_II': clause('NP.ITEM.ANNEXURE_II', 'NON_PAYABLE'),
      'NP.RIDER.COVERED': clause('NP.RIDER.COVERED', 'PAYABLE_IF_PART_OF_TREATMENT'),
      'ADM.NOTINFORCE': clause('ADM.NOTINFORCE', 'ADMISSIBILITY'),
      'ADM.WAITING.INITIAL': clause('ADM.WAITING.INITIAL', 'ADMISSIBILITY'),
    },
    categories: {
      ROOM_RENT: category('ROOM_RENT'),
      ICU_CHARGE: category('ICU_CHARGE', { proportionateImmune: true, ...excl('PD.ICU') }),
      PHARMACY: category('PHARMACY', excl('AME.EXCL.PHARMA')),
      CONSUMABLE: category('CONSUMABLE', { annexure: 'II', riderCanCover: ['CONSUMABLES_RIDER'], ...excl('AME.EXCL.PHARMA') }),
      IMPLANT_DEVICE: category('IMPLANT_DEVICE', excl('AME.EXCL.IMPLANT')),
      DIAGNOSTICS: category('DIAGNOSTICS', excl('AME.EXCL.DIAG')),
      SURGEON_FEE: category('SURGEON_FEE', { ameEligible: true }),
      ANAESTHETIST_FEE: category('ANAESTHETIST_FEE', { ameEligible: true }),
      OT_CHARGE: category('OT_CHARGE', { ameEligible: true }),
      NURSING_CHARGE: category('NURSING_CHARGE', { ameEligible: true }),
      DOCTOR_VISIT: category('DOCTOR_VISIT', { ameEligible: true }),
      PHYSIOTHERAPY: category('PHYSIOTHERAPY', { ameEligible: true }),
      AMBULANCE: category('AMBULANCE'),
      ADMIN_CHARGE: category('ADMIN_CHARGE', { annexure: 'II' }),
    },
    rounding: { mode: 'ROUND_HALF_UP', matchTolerancePaise: unsafePaise(100) },
    ...over,
  };
}
