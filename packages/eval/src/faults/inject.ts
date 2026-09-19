import type { ClauseId, ExtractedRow, ExtractedTable, LineRef, Paise } from '@fc/contracts';
import { unsafePaise } from '@fc/contracts';
import { CONTROL_KINDS, type FaultKind, type FaultedPack, type GeneratedPack, type InjectedFault, type Settlement } from '../types';
import { FAULT_CLAUSES } from '../types';
import type { Rng } from '../generate/rng';
import { int, shuffled } from '../generate/rng';
import { opDiag, opIcu, opImplant, opPharma, type AppliedFault } from './operators-a';

function opNoDiffbill(p: GeneratedPack, basePaid: readonly Paise[], rng: Rng): AppliedFault | null {
  const inner = opPharma(p, basePaid, rng);
  if (!inner || inner.lineIndex === null) return null;
  return { ...inner, kind: 'pd-no-diffbill', clauseId: 'PD.DIFFBILL' as ClauseId, noDiffbill: true };
}

/**
 * Recovers more than the lawful PD figure allows, on a line that is inside the
 * AME base. The cut comes out of what the line was going to be paid, so the
 * engine sees rupees it would not itself have withheld.
 */
function opOverRecovery(p: GeneratedPack, basePaid: readonly Paise[], rng: Rng): AppliedFault | null {
  const candidates: number[] = [];
  p.lawfulInput.normalisedLines.forEach((line, i) => {
    if (line.categoryId === null) return;
    if (!['SURGEON_FEE', 'ANAESTHETIST_FEE', 'OT_CHARGE'].includes(line.categoryId)) return;
    if ((basePaid[i] ?? 0) > 0) candidates.push(i);
  });
  if (candidates.length === 0) return null;

  const lineIndex = candidates[Math.floor(rng() * candidates.length)] as number;
  const atStake = basePaid[lineIndex] ?? unsafePaise(0);
  const extra = unsafePaise(Math.floor((atStake * int(rng, 20, 40)) / 100));
  if (extra <= 0) return null;

  return {
    kind: 'pd-over-recovery',
    clauseId: 'PD.LIMIT' as ClauseId,
    amountPaise: extra,
    lineIndex,
    description: 'proportionate recovery beyond the lawful AME-bound figure',
    extraByLine: new Map([[lineIndex, extra]]),
    noDiffbill: false,
  };
}

type Operator = (p: GeneratedPack, basePaid: readonly Paise[], rng: Rng) => AppliedFault | null;

const OPS: Readonly<Record<FaultKind, Operator>> = {
  'pd-on-pharma': opPharma,
  'pd-on-implant': opImplant,
  'pd-on-diag': opDiag,
  'pd-on-icu': opIcu,
  'pd-no-diffbill': opNoDiffbill,
  'pd-over-recovery': opOverRecovery,
};

export const ALL_FAULT_KINDS: readonly FaultKind[] = [
  'pd-on-pharma', 'pd-on-implant', 'pd-on-diag',
  'pd-on-icu', 'pd-no-diffbill', 'pd-over-recovery',
];

/**
 * Applies 0–3 faults (§20.4). Zero faults = the lawful control set (§20.3).
 *
 * `pd-no-diffbill` is applied alone when it is drawn. It is a whole-gate fault:
 * the hospital does not bill by room category, so no proportionate deduction is
 * permissible anywhere in the claim — including the lawful one the generator
 * would otherwise have applied. Settling the sheet under the same admission
 * fact the engine will see is what keeps the fault's rupees the only unlawful
 * ones in the pack.
 */
export function injectFaults(pack: GeneratedPack, rng: Rng): FaultedPack {
  const drawn = shuffled(rng, ALL_FAULT_KINDS).slice(0, int(rng, 0, 3));
  const noDiffbill = drawn.includes('pd-no-diffbill');
  const kinds: readonly FaultKind[] = noDiffbill ? ['pd-no-diffbill'] : drawn;
  const base: Settlement = noDiffbill ? pack.settlementWithoutPd : pack.settlementWithPd;
  const admission = noDiffbill
    ? { ...pack.admission, hospitalUsesDifferentialBilling: false }
    : pack.admission;

  const faults: InjectedFault[] = [];
  const extraByLine = new Map<number, Paise>();

  kinds.forEach((kind, n) => {
    const applied = OPS[kind](pack, base.paidPerLine, rng);
    if (!applied) return;

    // The declaration in FAULT_CLAUSES is what the score is measured against,
    // so an operator that drifted from it must fail loudly rather than quietly
    // scoring itself as a false positive.
    const expected = FAULT_CLAUSES[applied.kind];
    if (applied.clauseId !== expected) {
      throw new Error(`fault ${applied.kind} cites ${applied.clauseId}, expected ${expected}`);
    }

    faults.push({
      faultId: `fault-${n}-${kind}`,
      kind: applied.kind,
      clauseId: applied.clauseId,
      amountPaise: applied.amountPaise,
      lineIndex: applied.lineIndex,
      description: applied.description,
    });
    for (const [i, e] of applied.extraByLine) {
      extraByLine.set(i, unsafePaise((extraByLine.get(i) ?? unsafePaise(0)) + e));
    }
  });

  const sheetDoc = base.deductionTable.docId;
  const nBill = pack.billTable.rows.length;
  const perLine = base.deductionTable.rows.slice(0, nBill);
  const claimRows = base.deductionTable.rows.slice(nBill);

  const rows: ExtractedRow[] = perLine.map((row, i) => {
    const extra = extraByLine.get(i) ?? unsafePaise(0);
    if (extra <= 0) return row;
    return {
      ...row,
      lineRef: `${sheetDoc}:1:${i}` as LineRef,
      amountPaid: unsafePaise(Math.max(0, (row.amountPaid ?? unsafePaise(0)) - extra)),
      insurerReasonCode: 'PROP-DEDUCT',
    };
  });

  const deductionTable: ExtractedTable = {
    docId: sheetDoc,
    rows: [...rows, ...claimRows],
    printedTotal: unsafePaise(0),
  };
  const perLinePaid = rows.reduce((s, r) => unsafePaise(s + (r.amountPaid ?? unsafePaise(0))), unsafePaise(0));
  const claimCut = claimRows.reduce(
    (s, r) => unsafePaise(s + (r.amountClaimed - (r.amountPaid ?? unsafePaise(0)))), unsafePaise(0));
  const actualPaid = unsafePaise(Math.max(0, perLinePaid - claimCut));

  return {
    ...pack,
    admission,
    faults,
    deductionTable,
    actualPaid,
    input: { ...pack.lawfulInput, admission, deductionTable, actualPaid },
    controls: faults.length === 0 ? CONTROL_KINDS : [],
  };
}
