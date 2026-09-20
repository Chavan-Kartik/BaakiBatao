import type { ClauseId, Paise } from '@fc/contracts';
import { unsafePaise } from '@fc/contracts';
import type { FaultKind, GeneratedPack, Settlement } from '../types';
import type { Rng } from '../generate/rng';
import { int } from '../generate/rng';

export interface AppliedFault {
  readonly kind: FaultKind;
  readonly clauseId: ClauseId;
  readonly amountPaise: Paise;
  readonly lineIndex: number | null;
  /** The lawful figure the injected cut exceeds, where the operator computes one. */
  readonly lawfulBoundPaise: Paise | null;
  readonly description: string;
  readonly extraByLine: ReadonlyMap<number, Paise>;
  readonly noDiffbill: boolean;
}

export type Operator = (p: GeneratedPack, base: Settlement, rng: Rng) => AppliedFault | null;

/**
 * Cuts an extra slice out of a line the circular exempts from proportionate
 * deduction.
 *
 * The cut is taken from what the sheet was going to pay on that line, not from
 * what was claimed. An insurer cannot withhold rupees it had already disallowed
 * — and an operator that ignored this would inject a cut into a line the lawful
 * settlement pays nothing for (an Annexure II item with no rider), where it
 * would be clamped to zero and never appear in the pack at all. A fault that is
 * invisible is not a test.
 *
 * A line that already carries a lawful cut of another kind is skipped. The
 * engine's step 4 owns the excess on a line it capped, and would cite the cap
 * clause for it; that is a true statement about the rupees but not the clause
 * this operator is testing, and a harness that scored it as a miss would be
 * scoring its own sampling.
 */
function exemptCut(
  pack: GeneratedPack,
  base: Settlement,
  rng: Rng,
  kind: FaultKind,
  clauseId: ClauseId,
  categories: ReadonlySet<string>,
  desc: string,
): AppliedFault | null {
  const candidates: number[] = [];
  pack.lawfulInput.normalisedLines.forEach((line, i) => {
    if (line.categoryId === null || !categories.has(line.categoryId)) return;
    if (!untouched(pack, base, i)) return;
    candidates.push(i);
  });
  if (candidates.length === 0) return null;

  const lineIndex = candidates[Math.floor(rng() * candidates.length)] as number;
  const atStake = base.paidPerLine[lineIndex] ?? unsafePaise(0);
  const extra = unsafePaise(Math.floor((atStake * int(rng, 30, 60)) / 100));
  if (extra <= 0) return null;

  return {
    kind,
    clauseId,
    amountPaise: extra,
    lineIndex,
    lawfulBoundPaise: unsafePaise(0),
    description: desc,
    extraByLine: new Map([[lineIndex, extra]]),
    noDiffbill: false,
  };
}

/** Paid something, and cut nothing except (at most) the lawful proportionate share. */
export function untouched(pack: GeneratedPack, base: Settlement, i: number): boolean {
  const claimed = pack.billTable.rows[i]?.amountClaimed ?? unsafePaise(0);
  const paid = base.paidPerLine[i] ?? unsafePaise(0);
  const pd = base.lawfulPdPerLine[i] ?? unsafePaise(0);
  return paid > 0 && claimed - paid === pd;
}

const PHARMA = new Set(['PHARMACY', 'CONSUMABLE']);
const DIAG = new Set(['DIAGNOSTICS', 'IMAGING', 'CARDIAC_DIAGNOSTICS', 'ENDOSCOPY']);
const ICU = new Set(['ICU_CHARGE', 'VENTILATOR']);

export const opPharma: Operator = (p, base, rng) =>
  exemptCut(p, base, rng, 'pd-on-pharma', 'AME.EXCL.PHARMA' as ClauseId, PHARMA,
    'proportionate deduction on a pharmacy/consumables line');

export const opImplant: Operator = (p, base, rng) =>
  exemptCut(p, base, rng, 'pd-on-implant', 'AME.EXCL.IMPLANT' as ClauseId,
    new Set(['IMPLANT_DEVICE']), 'proportionate deduction on an implant line');

export const opDiag: Operator = (p, base, rng) =>
  exemptCut(p, base, rng, 'pd-on-diag', 'AME.EXCL.DIAG' as ClauseId, DIAG,
    'proportionate deduction on a diagnostics line');

export const opIcu: Operator = (p, base, rng) =>
  exemptCut(p, base, rng, 'pd-on-icu', 'PD.ICU' as ClauseId, ICU,
    'proportionate deduction on ICU charges');
