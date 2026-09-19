import type { ClauseId, Paise } from '@fc/contracts';
import { unsafePaise } from '@fc/contracts';
import type { FaultKind, GeneratedPack } from '../types';
import type { Rng } from '../generate/rng';
import { int } from '../generate/rng';

export interface AppliedFault {
  readonly kind: FaultKind;
  readonly clauseId: ClauseId;
  readonly amountPaise: Paise;
  readonly lineIndex: number | null;
  readonly description: string;
  readonly extraByLine: ReadonlyMap<number, Paise>;
  readonly noDiffbill: boolean;
}

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
 */
function exemptCut(
  pack: GeneratedPack,
  basePaid: readonly Paise[],
  rng: Rng,
  kind: FaultKind,
  clauseId: ClauseId,
  categories: ReadonlySet<string>,
  desc: string,
): AppliedFault | null {
  const candidates: number[] = [];
  pack.lawfulInput.normalisedLines.forEach((line, i) => {
    if (line.categoryId === null || !categories.has(line.categoryId)) return;
    if ((basePaid[i] ?? 0) > 0) candidates.push(i);
  });
  if (candidates.length === 0) return null;

  const lineIndex = candidates[Math.floor(rng() * candidates.length)] as number;
  const atStake = basePaid[lineIndex] ?? unsafePaise(0);
  const extra = unsafePaise(Math.floor((atStake * int(rng, 30, 60)) / 100));
  if (extra <= 0) return null;

  return {
    kind,
    clauseId,
    amountPaise: extra,
    lineIndex,
    description: desc,
    extraByLine: new Map([[lineIndex, extra]]),
    noDiffbill: false,
  };
}

const PHARMA = new Set(['PHARMACY', 'CONSUMABLE']);

export function opPharma(p: GeneratedPack, basePaid: readonly Paise[], rng: Rng): AppliedFault | null {
  return exemptCut(p, basePaid, rng, 'pd-on-pharma', 'AME.EXCL.PHARMA' as ClauseId, PHARMA,
    'proportionate deduction on a pharmacy/consumables line');
}

export function opImplant(p: GeneratedPack, basePaid: readonly Paise[], rng: Rng): AppliedFault | null {
  return exemptCut(p, basePaid, rng, 'pd-on-implant', 'AME.EXCL.IMPLANT' as ClauseId,
    new Set(['IMPLANT_DEVICE']), 'proportionate deduction on an implant line');
}

export function opDiag(p: GeneratedPack, basePaid: readonly Paise[], rng: Rng): AppliedFault | null {
  return exemptCut(p, basePaid, rng, 'pd-on-diag', 'AME.EXCL.DIAG' as ClauseId,
    new Set(['DIAGNOSTICS']), 'proportionate deduction on a diagnostics line');
}

export function opIcu(p: GeneratedPack, basePaid: readonly Paise[], rng: Rng): AppliedFault | null {
  return exemptCut(p, basePaid, rng, 'pd-on-icu', 'PD.ICU' as ClauseId,
    new Set(['ICU_CHARGE']), 'proportionate deduction on ICU charges');
}
