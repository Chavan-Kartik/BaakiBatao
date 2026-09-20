import { z } from 'zod';
import { AdmissionFacts, Paise, PolicySchedule } from '@fc/contracts';

/**
 * The structured pack: the same four documents a claim pack contains, as
 * JSON in the contract's own shapes (amounts in paise), for deployments with
 * no Textract. It is what `pipeline/extract.ts` produces from a PDF once the
 * extraction Lambdas exist, so the pipeline downstream of extraction is the
 * same code either way — and it is what the UI's "load demo pack" button
 * uploads.
 */
export const StructuredBill = z.object({
  admission: AdmissionFacts,
  rows: z.array(
    z.object({
      description: z.string().min(1),
      amountClaimed: Paise,
      quantity: z.number().nullable().optional(),
    }),
  ),
  /** The total printed at the foot of the bill, for the row checksum. */
  printedTotal: Paise.nullable().optional(),
});
export type StructuredBill = z.infer<typeof StructuredBill>;

export const StructuredSheet = z.object({
  rows: z.array(
    z.object({
      description: z.string().min(1),
      amountClaimed: Paise,
      amountPaid: Paise.nullable(),
      reason: z.string().nullable().optional(),
    }),
  ),
  actualPaid: Paise,
});
export type StructuredSheet = z.infer<typeof StructuredSheet>;

export const StructuredSchedule = PolicySchedule;

export const StructuredWording = z.object({
  text: z.string(),
});

export const STRUCTURED_CONTENT_TYPE = 'application/json';
