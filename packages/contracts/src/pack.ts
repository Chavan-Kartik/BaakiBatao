import { z } from 'zod';
import { CaseId, DocId, Sha256 } from './ids';

/**
 * A pack without the schedule and the wording is not usable — sum insured, room
 * rent cap, co-pay and the definition of associate medical expenses are
 * per-policy and cannot be guessed. See project brief §4.
 */
export const DocumentKind = z.enum([
  'ITEMISED_BILL',
  'DEDUCTION_SHEET',
  'SETTLEMENT_LETTER',
  'POLICY_SCHEDULE',
  'POLICY_WORDING',
  'ENDORSEMENT',
]);
export type DocumentKind = z.infer<typeof DocumentKind>;

export const REQUIRED_DOCUMENT_KINDS: readonly DocumentKind[] = [
  'ITEMISED_BILL',
  'DEDUCTION_SHEET',
  'POLICY_SCHEDULE',
  'POLICY_WORDING',
] as const;

export const PackDocument = z.object({
  docId: DocId,
  kind: DocumentKind,
  filename: z.string(),
  contentType: z.string(),
  byteLength: z.number().int().nonnegative(),
  sha256: Sha256,
  pageCount: z.number().int().positive().nullable(),
  s3KeyRaw: z.string(),
  s3KeyRedacted: z.string().nullable(),
});
export type PackDocument = z.infer<typeof PackDocument>;

/** Canonicalised and hashed to produce the `caseId`, which is what makes replay exact. */
export const PackManifest = z.object({
  documents: z.array(PackDocument),
  submittedAt: z.string().datetime(),
});
export type PackManifest = z.infer<typeof PackManifest>;

export const ClaimPack = z.object({
  caseId: CaseId,
  manifest: PackManifest,
});
export type ClaimPack = z.infer<typeof ClaimPack>;

export const CaseStatus = z.enum([
  'AWAITING_UPLOAD',
  'VALIDATING',
  'EXTRACTING',
  'REDACTING',
  'AWAITING_CORRECTION',
  'NORMALISING',
  'RECONSTRUCTING',
  'WRITING_PROSE',
  'COMPLETE',
  'FAILED',
]);
export type CaseStatus = z.infer<typeof CaseStatus>;

/**
 * Failures get a taxonomy code, never a bare stack trace — each maps to a
 * specific user-facing sentence in the UI. See build spec §11.2.
 */
export const FailureCode = z.enum([
  'PACK_INCOMPLETE',
  'TEXTRACT_LOW_CONFIDENCE',
  'TEXTRACT_NO_TABLE_FOUND',
  'SCHEDULE_UNPARSEABLE',
  'REDACTION_FAILED_OPEN',
  'NORMALISATION_EXHAUSTED',
  'RULEPACK_INVALID',
  'INVARIANT_VIOLATED',
  'BEDROCK_THROTTLED',
  'MODEL_UNAVAILABLE',
]);
export type FailureCode = z.infer<typeof FailureCode>;
