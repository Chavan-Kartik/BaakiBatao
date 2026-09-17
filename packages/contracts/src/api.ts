import { z } from 'zod';
import { CaseId, LineRef } from './ids';
import { CaseStatus, DocumentKind, FailureCode } from './pack';
import { RoomCategory } from './policy';
import { Paise } from './money';
import { Reconstruction } from './reconstruction';

// POST /cases
export const CreateCaseRequest = z.object({
  docs: z.array(
    z.object({
      kind: DocumentKind,
      filename: z.string(),
      contentType: z.string(),
    }),
  ),
});
export type CreateCaseRequest = z.infer<typeof CreateCaseRequest>;

export const CreateCaseResponse = z.object({
  caseId: CaseId,
  uploads: z.array(
    z.object({
      kind: DocumentKind,
      url: z.string().url(),
      fields: z.record(z.string(), z.string()),
    }),
  ),
});
export type CreateCaseResponse = z.infer<typeof CreateCaseResponse>;

// GET /cases/{id}
export const GetCaseResponse = z.object({
  caseId: CaseId,
  status: CaseStatus,
  reconstruction: Reconstruction.nullable(),
  failure: z
    .object({
      code: FailureCode,
      /** The specific user-facing sentence, not a stack trace. */
      message: z.string(),
    })
    .nullable(),
  /** Present only while status is AWAITING_CORRECTION. */
  correctionTaskToken: z.string().nullable(),
});
export type GetCaseResponse = z.infer<typeof GetCaseResponse>;

// POST /cases/{id}/corrections — resumes a paused Step Functions execution
export const SubmitCorrectionsRequest = z.object({
  taskToken: z.string(),
  rows: z.array(
    z.object({
      lineRef: LineRef,
      field: z.enum(['rawDescription', 'amountClaimed', 'amountPaid']),
      value: z.string(),
    }),
  ),
});
export type SubmitCorrectionsRequest = z.infer<typeof SubmitCorrectionsRequest>;

// POST /simulate — the server-authoritative what-if, used to prove the browser agrees
export const SimulateRequest = z.object({
  caseId: CaseId,
  overrides: z.object({
    occupiedRoomCategory: RoomCategory.nullable(),
    sumInsured: Paise.nullable(),
    consumablesRiderPresent: z.boolean().nullable(),
    copayPercent: z.number().min(0).max(100).nullable(),
  }),
});
export type SimulateRequest = z.infer<typeof SimulateRequest>;

// Server-sent events on GET /cases/{id}/events
export const CaseEvent = z.object({
  seq: z.number().int().nonnegative(),
  at: z.string().datetime(),
  kind: z.enum([
    'PackUploaded',
    'PackValidated',
    'DocumentClassified',
    'PageExtracted',
    'Redacted',
    'ChecksumFailed',
    'RowsCorrected',
    'Normalised',
    'Reconstructed',
    'ProseWritten',
    'CertificateIssued',
    'CaseFailed',
  ]),
  detail: z.record(z.string(), z.unknown()),
});
export type CaseEvent = z.infer<typeof CaseEvent>;
