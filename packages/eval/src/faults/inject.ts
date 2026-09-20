import type { ClauseId, ExtractedRow, ExtractedTable, LineRef, Paise } from '@fc/contracts';
import { unsafePaise } from '@fc/contracts';
import { loadRulepackV1 } from '@fc/rulepack';
import type {
  ControlKind,
  FaultKind,
  FaultedPack,
  GeneratedPack,
  InjectedFault,
  Settlement,
} from '../types';
import { FAULT_CLAUSES } from '../types';
import type { Rng } from '../generate/rng';
import { int, shuffled } from '../generate/rng';
import {
  opDiag, opIcu, opImplant, opPharma, untouched, type Operator,
} from './operators-a';

const rulepack = loadRulepackV1();

const opNoDiffbill: Operator = (p, base, rng) => {
  const inner = opPharma(p, base, rng);
  if (!inner || inner.lineIndex === null) return null;
  return { ...inner, kind: 'pd-no-diffbill', clauseId: 'PD.DIFFBILL' as ClauseId, noDiffbill: true };
};

/**
 * Recovers more than the lawful proportionate figure on a line inside the AME
 * base.
 *
 * The bound is computed, not described: `lawfulPdPerLine` is what the engine's
 * own step-5 arithmetic says may be recovered on the line, and the lawful sheet
 * has already recovered exactly that much. The operator checks the two agree —
 * if the sheet's cut on the candidate line were anything other than the bound,
 * the injected excess would be measured from the wrong figure — and then cuts
 * further. Every rupee of the extra is therefore beyond the bound by
 * construction, including when the bound is zero because the room was within
 * eligibility and no proportionate recovery was permissible at all.
 */
const opOverRecovery: Operator = (p, base, rng) => {
  const candidates: number[] = [];
  p.lawfulInput.normalisedLines.forEach((line, i) => {
    if (line.categoryId === null) return;
    const category = rulepack.categories[line.categoryId];
    if (!category?.ameEligible || category.proportionateImmune) return;
    if (!p.policy.ameDefinitionCategories.includes(line.categoryId)) return;
    if (!untouched(p, base, i)) return;
    candidates.push(i);
  });
  if (candidates.length === 0) return null;

  const lineIndex = candidates[Math.floor(rng() * candidates.length)] as number;
  const claimed = p.billTable.rows[lineIndex]?.amountClaimed ?? unsafePaise(0);
  const paid = base.paidPerLine[lineIndex] ?? unsafePaise(0);
  const bound = base.lawfulPdPerLine[lineIndex] ?? unsafePaise(0);

  if (claimed - paid !== bound) {
    throw new Error(
      `pd-over-recovery: lawful sheet cut ${claimed - paid} paise on line ${lineIndex}, but the computed bound is ${bound}`,
    );
  }

  const extra = unsafePaise(Math.floor((paid * int(rng, 20, 40)) / 100));
  if (extra <= 0) return null;

  return {
    kind: 'pd-over-recovery',
    clauseId: 'PD.LIMIT' as ClauseId,
    amountPaise: extra,
    lineIndex,
    lawfulBoundPaise: bound,
    description: `proportionate recovery of ${bound + extra} paise where the lawful figure is ${bound}`,
    extraByLine: new Map([[lineIndex, extra]]),
    noDiffbill: false,
  };
};

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
  const touched = new Set<number>();

  kinds.forEach((kind, n) => {
    const applied = OPS[kind](pack, base, rng);
    if (!applied) return;

    // Two faults on one line would present the engine with a single cut and
    // ask it to cite two clauses for it. Whichever it chose, the other would
    // score as a miss the engine never had a chance at.
    if (applied.lineIndex !== null && touched.has(applied.lineIndex)) return;

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
      lineRef:
        applied.lineIndex === null
          ? null
          : (pack.billTable.rows[applied.lineIndex]?.lineRef ?? null),
      lawfulBoundPaise: applied.lawfulBoundPaise,
      description: applied.description,
    });
    if (applied.lineIndex !== null) touched.add(applied.lineIndex);
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
    controls: faults.length === 0 ? controlsFor(pack, base) : [],
  };
}

/**
 * Which lawful deductions a zero-fault pack actually demonstrates. Claiming
 * all seven for every control pack would count a pack with no co-pay as
 * evidence that co-pay is handled; a control is only evidence when the
 * deduction is on the sheet.
 */
export function controlsFor(pack: GeneratedPack, base: Settlement): ControlKind[] {
  const out = new Set<ControlKind>();
  const { policy } = pack;

  pack.billTable.rows.forEach((row, i) => {
    const category = pack.trueCategories[i];
    const paid = base.paidPerLine[i] ?? unsafePaise(0);
    const pd = base.lawfulPdPerLine[i] ?? unsafePaise(0);
    const cut = row.amountClaimed - paid;
    if (cut <= 0) return;

    if (pd > 0) out.add('lawful-proportionate');
    if (category === 'ROOM_RENT' && cut > pd) out.add('lawful-room-cap');
    if (category === 'ICU_CHARGE' && cut > pd) out.add('lawful-icu-cap');
    if (category === 'AMBULANCE' && cut > pd) out.add('lawful-sublimit');
    if (rulepack.categories[category ?? '']?.annexure === 'II' && paid === 0) out.add('lawful-annexure');
  });

  if ((policy.deductible ?? 0) > 0) out.add('lawful-deductible');
  if ((policy.copayPercent ?? 0) > 0) out.add('lawful-copay');

  return [...out];
}
