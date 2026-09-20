import { randomUUID } from 'node:crypto';
import type { Certificate } from '@fc/contracts';
import { issueCertificate, PipelineFailure } from '@fc/api';
import { required } from '../shared/config';
import { signResultHash } from '../shared/kms-sign';
import { putJson } from '../store/documents';
import { emit, loadCase, rethrowCoded, stageDeps } from '../store/io';

/**
 * `IssueCertificate` (state 12): canonicalise → sha256 → KMS sign → S3.
 * `issueCertificate` is the same function the local runner uses, so the
 * hash is identical either way; the only difference is that here the
 * `signature` is filled in with `ECDSA_SHA_256` over it (§16). A certificate
 * that cannot be signed is not issued — the stage fails rather than writing
 * an unsigned one where a signed one was promised.
 *
 * The case ends `COMPLETE` with a fresh correction token: a completed case
 * stays correctable, and a correction re-runs it from `Normalise` under a
 * new execution, re-issuing the certificate (same path as the checksum
 * pause, second entry point).
 */
export const handler = async (event: { caseId: string }): Promise<{ resultHash: string; signed: boolean }> => {
  const deps = stageDeps();
  try {
    const record = await loadCase(deps, event.caseId);
    if (!record.reconstruction) throw new PipelineFailure('PIPELINE_INTERNAL', 'nothing was reconstructed to certify');

    const unsigned = issueCertificate(record.reconstruction, deps.now());
    const signature = await signResultHash(required('SIGNING_KEY_ID'), unsigned.resultHash);
    const certificate: Certificate = { ...unsigned, signature };

    await putJson(required('ARTIFACTS_BUCKET'), `certificates/${event.caseId}.json`, certificate);
    await deps.store.update(event.caseId, (r) => ({
      ...r,
      certificate,
      status: 'COMPLETE',
      correctionTaskToken: randomUUID(),
    }));
    await emit(deps, event.caseId, 'CertificateIssued', {
      resultHash: certificate.resultHash,
      signed: true,
      keyId: signature.keyId,
    });
    return { resultHash: certificate.resultHash, signed: true };
  } catch (e) {
    rethrowCoded(e);
  }
};
