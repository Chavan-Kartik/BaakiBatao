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
  readonly claimRows: readonly ClaimRow[];
  readonly paid: Paise;
}

/**
 * Settles a sampled bill lawfully: step 3 (Annexure II, unless a rider in force
 * rescues the line), step 4 (room and ICU per-day caps), step 5 (the room
 * category ratio, only where the circular permits it), then step 6 (deductible
 * then co-pay, the order the rulepack declares).
 *
 * `pdApplies` is the step-5 gate B answer. It is a parameter rather than a
 * constant because a fault can flip it, and a ground-truth sheet has to be
 * lawful under the admission facts the engine will see.
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

  const ratio =
    pdApplies && roomCapPerDay !== null && actualRate !== null && actualRate > 0
      ? Math.min(1, roomCapPerDay / actualRate)
      : 1;

  const hasRider = policy.riders.some((r) => r.riderId === 'CONSUMABLES_RIDER');

  const paidPerLine: Paise[] = lines.map((line) => {
    const category = pack.categories[line.category];
    let allowed = line.claimed;

    if (category?.annexure === 'II' && !(hasRider && category.riderCanCover.includes('CONSUMABLES_RIDER'))) {
      return unsafePaise(0);
    }
    if (line.category === 'ROOM_RENT' && roomCapPerDay !== null && admission.roomDays !== null) {
      allowed = unsafePaise(Math.min(allowed, roomCapPerDay * admission.roomDays));
    }
    if (line.category === 'ICU_CHARGE' && icuCapPerDay !== null && admission.icuDays !== null) {
      allowed = unsafePaise(Math.min(allowed, icuCapPerDay * admission.icuDays));
    }

    // The circular's bright line, in the one place a fraction touches money:
    // pharmacy, consumables, implants and diagnostics are outside the base, the
    // policy's own definition is checked too, and ICU is immune because a
    // room-category ratio has no referent in a unit with no categories.
    const inBase =
      category?.proportionateImmune === false &&
      category.ameEligible &&
      policy.ameDefinitionCategories.includes(category.categoryId);

    if (pdApplies && inBase && ratio < 1) {
      allowed = unsafePaise(Math.floor(allowed * ratio));
    }
    return allowed;
  });

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
    const cut = unsafePaise(Math.round((running * copayPercent) / 100));
    claimRows.push({ desc: `Co-pay @ ${copayPercent}%`, amount: cut, reason: 'CO-PAY' });
    running = unsafePaise(running - cut);
  }

  return { paidPerLine, claimRows, paid: running };
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
