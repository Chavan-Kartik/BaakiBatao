import type { Certificate, VerifyResult } from '@fc/contracts';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { inr } from '../lib/format';

/**
 * The certificate, and a button that re-runs the engine on the server over
 * the pinned input and compares hashes. "Verified" here means the arithmetic
 * reproduced, not that anyone vouched for it.
 */
export function Verify({ caseId }: { caseId: string }) {
  const [cert, setCert] = useState<Certificate | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.certificate(caseId).then(setCert).catch((e: ApiError) => setError(e.message));
  }, [caseId]);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.verify(caseId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'verification failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <h1 className="text-[18px] font-semibold tracking-tight text-text">Certificate</h1>
      <p className="mt-1 text-[13px] text-text-2">
        A hash over the canonical reconstruction, with the engine, rulepack, lexicon and extraction it
        was computed against pinned inside it. Replaying with the same pins must reproduce the hash.
      </p>

      {error && <p className="mt-4 rounded-sm bg-disputed-soft px-3 py-2 text-[12px] text-disputed">{error}</p>}

      {cert && (
        <dl className="mt-5 grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2">
          <Row k="Case" v={cert.caseId} mono />
          <Row k="Issued" v={new Date(cert.issuedAt).toLocaleString()} />
          <Row k="Bill total" v={inr(cert.billTotal)} />
          <Row k="Expected payable" v={inr(cert.expectedPayable)} />
          <Row k="Insurer paid" v={inr(cert.actualPaid)} />
          <Row k="Invariant" v={cert.invariantHeld ? `held (residual ${cert.residual})` : 'BROKEN'} />
          <Row k="Engine" v={cert.pins.engineVersion} mono />
          <Row k="Rulepack" v={`${cert.pins.rulepackVersion} · ${cert.pins.rulepackHash.slice(0, 23)}…`} mono />
          <Row k="Extraction" v={`${cert.pins.extractionHash.slice(0, 23)}…`} mono />
          <Row k="Result hash" v={cert.resultHash} mono wide />
          <Row k="Signature" v={cert.signature ? `${cert.signature.alg} · ${cert.signature.keyId}` : 'unsigned — the KMS signing key is part of the pipeline stack'} wide />
        </dl>
      )}

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={busy || !cert}
          className="inline-flex h-9 items-center rounded-sm bg-brand px-4 text-[13px] font-medium text-white hover:bg-brand/90 disabled:opacity-50"
        >
          {busy ? 'Replaying…' : 'Replay on the server and compare'}
        </button>
        {result && (
          <span className={result.match ? 'text-[13px] font-medium text-brand' : 'text-[13px] font-medium text-disputed'}>
            {result.match ? `hash reproduced in ${result.recomputedInMs} ms` : 'hash DID NOT reproduce'}
          </span>
        )}
      </div>
      {result && (
        <div className="mt-3 font-mono text-[11px] text-text-3">
          stored {result.storedHash}
          <br />
          recomputed {result.recomputedHash}
        </div>
      )}
    </div>
  );
}

function Row({ k, v, mono, wide }: { k: string; v: string; mono?: boolean; wide?: boolean }) {
  return (
    <div className={wide ? 'bg-surface px-3 py-2.5 sm:col-span-2' : 'bg-surface px-3 py-2.5'}>
      <dt className="text-[11px] text-text-3">{k}</dt>
      <dd className={mono ? 'mt-0.5 break-all font-mono text-[12px] text-text' : 'mt-0.5 text-[13px] text-text'}>{v}</dd>
    </div>
  );
}
