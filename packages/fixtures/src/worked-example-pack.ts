import type { DocumentKind } from '@fc/contracts';
import { buildInput } from './worked-example';

/**
 * The worked example as an uploadable claim pack: the four required
 * documents, in the structured JSON form the API's local extractor reads
 * (`@fc/api` `pipeline/structured.ts`). Amounts are in paise, as everywhere.
 *
 * Shared by the UI's "load demo pack" button and the API's tests, so what a
 * judge clicks and what CI verifies are the same bytes.
 */
export interface PackFile {
  readonly kind: DocumentKind;
  readonly filename: string;
  readonly contentType: 'application/json';
  readonly body: string;
}

export function buildDemoPack(): readonly PackFile[] {
  const input = buildInput();
  const json = (v: unknown): string => JSON.stringify(v, null, 2);

  return [
    {
      kind: 'POLICY_SCHEDULE',
      filename: 'policy-schedule.json',
      contentType: 'application/json',
      body: json(input.policy),
    },
    {
      kind: 'POLICY_WORDING',
      filename: 'policy-wording.json',
      contentType: 'application/json',
      body: json({
        text:
          'Associate Medical Expenses means surgeon, anaesthetist, operation theatre, nursing, ' +
          'consultation, pharmacy, consumables, implants, diagnostics and ICU charges. Where the ' +
          'insured occupies a room category above the eligible one, the associate medical expenses ' +
          'are payable in the proportion the eligible room rent bears to the room rent actually incurred.',
      }),
    },
    {
      kind: 'ITEMISED_BILL',
      filename: 'itemised-bill.json',
      contentType: 'application/json',
      body: json({
        admission: input.admission,
        rows: input.billTable.rows.map((r) => ({
          description: r.rawDescription,
          amountClaimed: r.amountClaimed,
          quantity: r.quantity,
        })),
        printedTotal: input.billTable.printedTotal,
      }),
    },
    {
      kind: 'DEDUCTION_SHEET',
      filename: 'deduction-sheet.json',
      contentType: 'application/json',
      body: json({
        rows: input.deductionTable.rows.map((r) => ({
          description: r.rawDescription,
          amountClaimed: r.amountClaimed,
          amountPaid: r.amountPaid,
          reason: r.insurerReasonCode,
        })),
        actualPaid: input.actualPaid,
      }),
    },
  ];
}
