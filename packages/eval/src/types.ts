import type {
  AdmissionFacts,
  ClauseId,
  ExtractedTable,
  LineRef,
  Paise,
  PolicySchedule,
  ReconstructInput,
} from '@fc/contracts';

/**
 * @fc/eval shared types — the harness that turns "a demo" into "a system with
 * a measured error rate" (IMPLEMENTATION.md §20).
 *
 * Generation is local-only: seeded claim packs whose ground truth is exact by
 * construction, because the lawful sheet is settled by our own engine and every
 * unlawful rupee is injected by a named fault operator with a known clause ID
 * and amount. No PDFs, no Textract, no Bedrock in this slice — those need AWS
 * credentials and belong to a later increment. What the slice does have is a
 * data-level stand-in for them: the `degraded` profile perturbs the extracted
 * rows the way OCR does and routes them through the real tier-1 normaliser,
 * so the gate, the sheet matcher and low-confidence routing are inside the
 * measured path rather than assumed.
 */

/** Which unlawful behaviour was injected, and which clause it violates. */
export const FAULT_CLAUSES = {
  'pd-on-pharma': 'AME.EXCL.PHARMA',
  'pd-on-implant': 'AME.EXCL.IMPLANT',
  'pd-on-diag': 'AME.EXCL.DIAG',
  'pd-on-icu': 'PD.ICU',
  'pd-no-diffbill': 'PD.DIFFBILL',
  'pd-over-recovery': 'PD.LIMIT',
} as const;

export type FaultKind = keyof typeof FAULT_CLAUSES;

/**
 * Lawful controls — deductions the engine must NOT flag. This is the important
 * half: anyone can build something that flags deductions; proving we do not
 * flag a lawful cut is what separates a reconstructor from a blanket
 * classifier.
 *
 * A control is only claimed for a pack that actually contains that deduction:
 * a zero-fault pack with no co-pay proves nothing about co-pay.
 */
export const CONTROL_KINDS = [
  'lawful-room-cap',
  'lawful-icu-cap',
  'lawful-sublimit',
  'lawful-proportionate',
  'lawful-copay',
  'lawful-annexure',
  'lawful-deductible',
] as const;

export type ControlKind = (typeof CONTROL_KINDS)[number];

/**
 * What kind of admission this is. The bill's composition follows from it —
 * a day-care cataract has a surgeon, a theatre and a lens and no fourth day;
 * a medical admission has neither theatre nor implant but pharmacy every day.
 * Independent per-category prevalences cannot produce that structure, and
 * an implant line with no surgeon is a bill no hospital would print.
 */
export const ARCHETYPES = ['MEDICAL', 'DAYCARE_SURGERY', 'MAJOR_SURGERY', 'CRITICAL_CARE'] as const;
export type Archetype = (typeof ARCHETYPES)[number];

export interface InjectedFault {
  readonly faultId: string;
  readonly kind: FaultKind;
  /** The clause the engine should cite when it disputes this. */
  readonly clauseId: ClauseId;
  /** Unlawful rupees injected, as a positive magnitude in paise. */
  readonly amountPaise: Paise;
  /** Which bill line carried the extra cut. Null for whole-claim faults. */
  readonly lineIndex: number | null;
  /** The bill row the engine should cite, when the fault is line-level. */
  readonly lineRef: LineRef | null;
  /** The lawful figure the injected cut exceeds, where the operator computes one. */
  readonly lawfulBoundPaise: Paise | null;
  readonly description: string;
}

/**
 * One lawful settlement of the same bill.
 *
 * Two are generated, because the step-5 gate depends on an admission fact that
 * a fault can flip: with differential billing the room-category ratio is
 * applied, without it no proportionate deduction is permissible at all. A
 * ground-truth sheet has to be lawful under the facts the engine will see, not
 * under the facts we happened to sample.
 */
export interface Settlement {
  readonly deductionTable: ExtractedTable;
  readonly actualPaid: Paise;
  /** What the sheet paid on each bill line, before any fault is injected. */
  readonly paidPerLine: readonly Paise[];
  /**
   * The lawful proportionate cut on each line, by the engine's own step-5
   * arithmetic. Zero on lines outside the AME base. This is the bound the
   * over-recovery operator injects beyond, so "beyond the lawful figure" is a
   * computed fact rather than a description string.
   */
  readonly lawfulPdPerLine: readonly Paise[];
}

export interface GeneratedPack {
  readonly seed: number;
  readonly caseId: string;
  readonly archetype: Archetype;
  readonly policy: PolicySchedule;
  readonly admission: AdmissionFacts;
  readonly billTable: ExtractedTable;
  /** The category each bill line truly belongs to, by construction. */
  readonly trueCategories: readonly string[];
  readonly lawfulDeductionTable: ExtractedTable;
  /** What a lawful insurer would have paid. */
  readonly lawfulPaid: Paise;
  readonly billTotal: Paise;
  /** Input that reproduces the lawful settlement (actualPaid = lawfulPaid). */
  readonly lawfulInput: ReconstructInput;
  /** Lawful settlement with the room-category proportionate ratio applied. */
  readonly settlementWithPd: Settlement;
  /** Lawful settlement for a hospital that does not bill by room category. */
  readonly settlementWithoutPd: Settlement;
}

/** A generated pack with 0–3 faults applied on top of the lawful settlement. */
export interface FaultedPack extends GeneratedPack {
  readonly faults: readonly InjectedFault[];
  /** Deduction sheet after fault injection. */
  readonly deductionTable: ExtractedTable;
  /** What the (faulty) insurer actually paid. */
  readonly actualPaid: Paise;
  /** Input to feed the engine under test. */
  readonly input: ReconstructInput;
  /** Lawful deductions this pack demonstrably contains. Empty unless zero faults. */
  readonly controls: readonly ControlKind[];
}

/**
 * Which extraction the engine is scored against.
 *
 *   clean     rows exactly as generated, categories by construction. Measures
 *             the waterfall alone — the engine gate.
 *
 *   degraded  descriptions and amounts perturbed the way OCR perturbs them,
 *             categories from the real tier-1 normaliser, some sheet rows
 *             missing. Measures the system as far as it exists locally — the
 *             gate, the sheet matcher and the waterfall together.
 */
export type Profile = 'clean' | 'degraded';

/** Why a fault under the degraded profile went undetected, when it did. */
export type MissReason =
  /** The fault's line was gated by step 2: the normaliser could not place it. */
  | 'GATED'
  /** The sheet row for the fault's line no longer matched the bill row. */
  | 'UNMATCHED'
  /** The line reached the waterfall intact and the engine still missed it. */
  | 'ENGINE';

export interface PerClauseScore {
  readonly clauseId: string;
  readonly tp: number;
  readonly fp: number;
  readonly fn: number;
  readonly precision: number;
  readonly recall: number;
}

export interface EvalSummary {
  readonly profile: Profile;
  readonly packs: number;
  readonly faults: number;
  readonly detected: number;
  readonly perClause: readonly PerClauseScore[];
  /** Fraction of control packs with zero INCORRECTLY_APPLIED findings. */
  readonly controlPassRate: number;
  readonly controlFalsePositiveRate: number;
  /** How many control packs demonstrated each lawful deduction. */
  readonly controlCoverage: Readonly<Record<ControlKind, number>>;
  /** Mean absolute paise error on matched fault amounts. */
  readonly meanAttributionErrorPaise: number;
  /** Bill lines the normalisation gate excluded, as a fraction of all lines. */
  readonly gatedLineRate: number;
  /** Bill lines with no matching deduction-sheet row, as a fraction of all lines. */
  readonly unmatchedLineRate: number;
  readonly missesByReason: Readonly<Record<MissReason, number>>;
  readonly byArchetype: Readonly<Record<Archetype, { packs: number; faults: number; detected: number }>>;
}
