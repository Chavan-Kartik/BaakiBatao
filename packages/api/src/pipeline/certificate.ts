import { createHash } from 'node:crypto';
import type { Certificate, Reconstruction, Sha256 } from '@fc/contracts';

/**
 * Canonical JSON: keys sorted at every level, no whitespace, so the same
 * reconstruction hashes the same on every runtime. `computedAt` is excluded —
 * two runs over identical input must produce an identical hash, and the
 * clock is the one input that is never identical.
 */
export function canonicalise(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function resultHash(reconstruction: Reconstruction): Sha256 {
  const { computedAt: _computedAt, ...rest } = reconstruction;
  return `sha256:${createHash('sha256').update(canonicalise(rest), 'utf8').digest('hex')}`;
}

/**
 * Unsigned locally. The KMS asymmetric key and `ECDSA_SHA_256` signing
 * (IMPLEMENTATION.md §16) are part of the pipeline stack; `signature: null`
 * is the honest local value, and `GET /cases/{id}/verify` still proves the
 * hash reproduces.
 */
export function issueCertificate(reconstruction: Reconstruction, issuedAt: string): Certificate {
  return {
    caseId: reconstruction.caseId,
    issuedAt,
    pins: reconstruction.pins,
    billTotal: reconstruction.billTotal,
    expectedPayable: reconstruction.expectedPayable,
    actualPaid: reconstruction.actualPaid,
    residual: reconstruction.reconciliation.residual,
    invariantHeld: reconstruction.reconciliation.invariantHeld,
    resultHash: resultHash(reconstruction),
    signature: null,
  };
}
