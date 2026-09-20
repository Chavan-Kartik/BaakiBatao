import type {
  AdmissionFacts,
  DocId,
  ExtractedRow,
  ExtractedTable,
  LineRef,
  Paise,
  PolicySchedule,
} from '@fc/contracts';
import { unsafePaise } from '@fc/contracts';
import { applyRatio, survivingShare } from '@fc/engine';
import { loadRulepackV1 } from '@fc/rulepack';
import type { SampledBillLine } from './bill';

const pack = loadRulepackV1();

export interface ClaimRow {
  readonly desc: string;
  readonly amount: Paise;
  readonly reason: string;
}

export interface SettleResult {
  readonly paidPerLine: readonly Paise[];
  /** The lawful step-5 cut on each line; zero outside the AME base. */
  readonly lawfulPdPerLine: readonly Paise[];
  readonly claimRows: readonly ClaimRow[];
  readonly paid: Paise;
}

/**
 * Settles a sampled bill lawfully: step 3 (Annexure II, unless a rider in force
 * rescues the line), step 4 (room and ICU per-day caps, and any sub-limit on
 * the schedule), step 5 (the room category ratio, only where the circular
 * permits it), then step 6 (deductible then co-pay, the order the rulepack
 * declares).
 *
 * `pdApplies` is the step-5 gate B answer. It is a parameter rather than a
 * constant because a fault can flip it, and a ground-truth sheet has to be
 * lawful under the admission facts the engine will see.
 *
 * The proportionate arithmetic is the engine's own — `survivingShare` for the
 * ratio, `applyRatio` with the rulepack's rounding mode for the surviving
 * amount — rather than a float multiplication that happens to agree within a
 * paise. The corpus is settled by our engine by design (§20.1 step 3); doing
 * it with a private approximation would make the ground truth a second
 * implementation to keep in sync, and the over-recovery bound the operator
 * injects beyond would be off by whatever the two disagree on.
 */
export function settle(
  policy: PolicySchedule,
  admission: AdmissionFacts,
  lines: readonly SampledBillLine[],
  pdApplies: boolean,
): SettleResult {
  const roomCapPerDay = policy.roomRentCapPerDay ?? null;
  const icuCapPerDay = policy.icuCapPerDay ?? null;
  const actualRate = admission.actualRoomRentPerDay ?? null;

  const share =
    pdApplies && roomCapPerDay !== null && actualRate !== null
      ? survivingShare(roomCapPerDay, actualRate)
      : { numerator: 1, denominator: 1 };

  const paidPerLine: Paise[] = [];
  const lawfulPdPerLine: Paise[] = [];

  for (const line of lines) {
    const category = pack.categories[line.category];
    let allowed = line.claimed;

    if (
      category?.annexure === 'II' &&
      !policy.riders.some(
        (r) =>
          r.coversCategories.includes(category.categoryId) &&
          admission.admissionDate !== null &&
          r.effectiveFrom <= admission.admissionDate,
      )
    ) {
      paidPerLine.push(unsafePaise(0));
      lawfulPdPerLine.push(unsafePaise(0));
      continue;
    }

    if (line.category === 'ROOM_RENT' && roomCapPerDay !== null && admission.roomDays !== null) {
      allowed = unsafePaise(Math.min(allowed, roomCapPerDay * admission.roomDays));
    }
    if (line.category === 'ICU_CHARGE' && icuCapPerDay !== null && admission.icuDays !== null) {
      allowed = unsafePaise(Math.min(allowed, icuCapPerDay * admission.icuDays));
    }
    const subLimit = policy.subLimits.find((s) =>
      s.appliesToCategories.includes(line.category as never),
    );
    if (subLimit?.capAmount != null && !subLimit.perDay) {
      allowed = unsafePaise(Math.min(allowed, subLimit.capAmount));
    }

    // The circular's bright line, in the one place a fraction touches money:
    // pharmacy, consumables, implants and diagnostics are outside the base, the
    // policy's own definition is checked too, and ICU is immune because a
    // room-category ratio has no referent in a unit with no categories.
    const inBase =
      category?.proportionateImmune === false &&
      category.ameEligible &&
      policy.ameDefinitionCategories.includes(category.categoryId);

    let pd = unsafePaise(0);
    if (pdApplies && inBase && share.numerator < share.denominator) {
      const surviving = applyRatio(allowed, share.numerator, share.denominator, pack.rounding.mode);
      pd = unsafePaise(Math.max(0, allowed - surviving));
      allowed = unsafePaise(allowed - pd);
    }

    paidPerLine.push(allowed);
    lawfulPdPerLine.push(pd);
  }

  let running = paidPerLine.reduce((s, p) => unsafePaise(s + p), unsafePaise(0));
  const claimRows: ClaimRow[] = [];

  const deductible = policy.deductible;
  if (deductible !== null && deductible > 0) {
    const cut = unsafePaise(Math.min(deductible, running));
    claimRows.push({ desc: 'Deductible', amount: cut, reason: 'DEDUCTIBLE' });
    running = unsafePaise(running - cut);
  }

  const copayPercent = policy.copayPercent;
  if (copayPercent !== null && copayPercent > 0) {
    const cut = applyRatio(running, copayPercent, 100, pack.rounding.mode);
    claimRows.push({ desc: `Co-pay @ ${copayPercent}%`, amount: cut, reason: 'CO-PAY' });
    running = unsafePaise(running - cut);
  }

  return { paidPerLine, lawfulPdPerLine, claimRows, paid: running };
}

/** The settlement as a sheet: one row per bill line, then the summary rows. */
export function sheetFor(
  sheetDoc: DocId,
  lines: readonly SampledBillLine[],
  result: SettleResult,
): ExtractedTable {
  const perLine: ExtractedRow[] = lines.map((line, i) => {
    const paid = result.paidPerLine[i] ?? unsafePaise(0);
    return {
      lineRef: `${sheetDoc}:1:${i}` as LineRef,
      rawDescription: line.desc,
      quantity: null,
      amountClaimed: line.claimed,
      amountPaid: paid,
      insurerReasonCode: paid === line.claimed ? null : 'LAWFUL',
      provenance: {
        docId: sheetDoc,
        bbox: { page: 1, left: 0.1, top: 0.1 + i * 0.02, width: 0.8, height: 0.015 },
        textractConfidence: 99,
        corrected: false,
      },
    };
  });

  const claim: ExtractedRow[] = result.claimRows.map((row, i) => ({
    lineRef: `${sheetDoc}:1:${lines.length + i}` as LineRef,
    rawDescription: row.desc,
    quantity: null,
    amountClaimed: row.amount,
    amountPaid: unsafePaise(0),
    insurerReasonCode: row.reason,
    provenance: {
      docId: sheetDoc,
      bbox: { page: 1, left: 0.1, top: 0.9, width: 0.8, height: 0.015 },
      textractConfidence: 99,
      corrected: false,
    },
  }));

  return {
    docId: sheetDoc,
    rows: [...perLine, ...claim],
    printedTotal: result.paid,
  };
}
