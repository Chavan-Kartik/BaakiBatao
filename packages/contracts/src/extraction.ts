import { z } from 'zod';
import { DocId, LineRef, Sha256 } from './ids';
import { Paise } from './money';

/** Normalised 0–1 against page dimensions, exactly as Textract returns it. */
export const BBox = z.object({
  page: z.number().int().positive(),
  left: z.number().min(0).max(1),
  top: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});
export type BBox = z.infer<typeof BBox>;

/**
 * Captured during table parsing or lost forever.
 *
 * The bounding box is what makes the provenance-crop UI possible: click a rupee
 * figure, see the pixels on the original scan it was read from. It cannot be
 * recovered later, so `parse-tables` must preserve it from day one.
 * See build spec §12.2, §19.3.
 */
export const Provenance = z.object({
  docId: DocId,
  bbox: BBox,
  /** Textract's own OCR confidence for the cell, 0–100. Not a model confidence. */
  textractConfidence: z.number().min(0).max(100),
  /** True once a human has edited this cell through the correction grid. */
  corrected: z.boolean().default(false),
});
export type Provenance = z.infer<typeof Provenance>;

export const ExtractedRow = z.object({
  lineRef: LineRef,
  rawDescription: z.string(),
  quantity: z.number().nullable(),
  amountClaimed: Paise,
  /** Null on the itemised bill; present on the deduction sheet. */
  amountPaid: Paise.nullable(),
  /** The insurer's own internal code, where the sheet prints one. */
  insurerReasonCode: z.string().nullable(),
  provenance: Provenance,
});
export type ExtractedRow = z.infer<typeof ExtractedRow>;

export const ExtractedTable = z.object({
  docId: DocId,
  rows: z.array(ExtractedRow),
  /** The total printed on the document, used for the row checksum. */
  printedTotal: Paise.nullable(),
});
export type ExtractedTable = z.infer<typeof ExtractedTable>;

/**
 * A Textract QUERIES answer. Below-threshold or absent answers become
 * UNRESOLVED / MISSING_POLICY_SCHEDULE — never a defaulted value. Defaulting a
 * room rent cap would silently fabricate the most important number in step 4.
 */
export const QueryAnswer = z.object({
  alias: z.string(),
  text: z.string().nullable(),
  confidence: z.number().min(0).max(100),
  bbox: BBox.nullable(),
});
export type QueryAnswer = z.infer<typeof QueryAnswer>;

export const ExtractionResult = z.object({
  extractionHash: Sha256,
  tables: z.array(ExtractedTable),
  queryAnswers: z.array(QueryAnswer),
  /** Section-aware chunks of the policy wording, for clause citation. */
  wordingChunks: z.array(
    z.object({
      chunkId: z.string(),
      heading: z.string().nullable(),
      text: z.string(),
      bbox: BBox,
    }),
  ),
});
export type ExtractionResult = z.infer<typeof ExtractionResult>;

export const RedactionReport = z.object({
  countByType: z.record(z.string(), z.number().int().nonnegative()),
  /** Fail closed: if redaction cannot be confirmed, nothing proceeds to Bedrock. */
  confirmed: z.boolean(),
});
export type RedactionReport = z.infer<typeof RedactionReport>;
