import { z } from 'zod';
import { CaseId, Sha256 } from './ids';
import { Paise } from './money';
import { VersionPins } from './reconstruction';

export const Signature = z.object({
  alg: z.literal('ECDSA_SHA_256'),
  keyId: z.string(),
  value: z.string(), // base64
});
export type Signature = z.infer<typeof Signature>;

/**
 * Every completed case emits one of these.
 *
 * `resultHash` is taken over the JCS-canonicalised Reconstruction, so it is
 * reproducible across runtimes. `GET /cases/{id}/verify` re-runs the engine
 * against the pinned extraction and rulepack and confirms the hash matches.
 *
 * This is how we show that a rulepack correction did not retroactively rewrite
 * history: an old certificate still verifies against its own pins.
 * See build spec §16.
 */
export const Certificate = z.object({
  caseId: CaseId,
  issuedAt: z.string().datetime(),
  pins: VersionPins,
  billTotal: Paise,
  expectedPayable: Paise,
  actualPaid: Paise,
  residual: Paise,
  invariantHeld: z.boolean(),
  resultHash: Sha256,
  signature: Signature.nullable(),
});
export type Certificate = z.infer<typeof Certificate>;

export const VerifyResult = z.object({
  match: z.boolean(),
  storedHash: Sha256,
  recomputedHash: Sha256,
  recomputedInMs: z.number(),
  signatureValid: z.boolean().nullable(),
});
export type VerifyResult = z.infer<typeof VerifyResult>;
