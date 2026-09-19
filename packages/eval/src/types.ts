import type {
  AdmissionFacts,
  ClauseId,
  ExtractedTable,
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
 * credentials and belong to a later increment.
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
 */
export const CONTROL_KINDS = [
  'lawful-sublimit',
  'lawful-copay',
  'lawful-annexure',
  'lawful-deductible',
] as const;

export type ControlKind = (typeof CONTROL_KINDS)[number];

export interface InjectedFault {
  readonly faultId: string;
  readonly kind: FaultKind;
  /** The clause the engine should cite when it disputes this. */
  readonly clauseId: ClauseId;
  /** Unlawful rupees injected, as a positive magnitude in paise. */
  readonly amountPaise: Paise;
  /** Which bill line carried the extra cut. Null for whole-claim faults. */
  readonly lineIndex: number | null;
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
}

export interface GeneratedPack {
  readonly seed: number;
  readonly caseId: string;
  readonly policy: PolicySchedule;
  readonly admission: AdmissionFacts;
  readonly billTable: ExtractedTable;
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
  readonly controls: readonly ControlKind[];
}

export interface PerClauseScore {
  readonly clauseId: string;
  readonly tp: number;
  readonly fp: number;
  readonly fn: number;
  readonly precision: number;
  readonly recall: number;
}

export interface EvalSummary {
  readonly packs: number;
  readonly faults: number;
  readonly detected: number;
  readonly perClause: readonly PerClauseScore[];
  /** Fraction of control packs with zero INCORRECTLY_APPLIED findings. */
  readonly controlPassRate: number;
  readonly controlFalsePositiveRate: number;
  /** Mean absolute paise error on matched fault amounts. */
  readonly meanAttributionErrorPaise: number;
}
