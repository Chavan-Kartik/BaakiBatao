import type { Certificate, VerifyResult } from '@fc/contracts';
import { BadgeCheck, CircleDashed, Equal, RefreshCw, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { Chip, ErrorNote, Fingerprint, Page, PillButton } from '../components/primitives';
import { Skeleton } from '../components/ui/skeleton';
import { api, ApiError } from '../lib/api';
import { inr } from '../lib/format';
import { cn } from '../lib/utils';

/**
 * The certificate, and a button that re-runs the engine on the server over
 * the pinned input and compares. "Verified" here means the arithmetic
 * reproduced — not that anyone vouched for it, which is a different and much
 * weaker claim.
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
      setError(e instanceof ApiError ? e.message : 'The replay could not be run.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AppHeader
        title="Certificate"
        subtitle="Replay the case and you must get the same paise"
        chips={
          cert && (
            <Chip tone={cert.invariantHeld ? 'brand' : 'disputed'}>
              {cert.invariantHeld ? <ShieldCheck className="size-3" /> : <TriangleAlert className="size-3" />}
              {cert.invariantHeld ? 'Ledger balanced' : 'Ledger did not balance'}
            </Chip>
          )
        }
        actions={
          <PillButton onClick={run} disabled={busy || !cert} size="sm">
            <RefreshCw className={busy ? 'animate-spin' : undefined} />
            {busy ? 'Replaying…' : 'Replay on the server'}
          </PillButton>
        }
      />

      <Page className="space-y-3">
        {error && <ErrorNote>{error}</ErrorNote>}

        {!cert && !error && <Skeleton className="h-64 rounded-xl" />}

        {cert && (
          <>
            {result && <Verdict result={result} />}

            <section className="overflow-hidden rounded-xl border border-border bg-surface">
              <header className="border-b border-border px-4 py-2.5">
                <h2 className="text-[12.5px] font-semibold tracking-[-0.02em] text-text">
                  What this certificate settles
                </h2>
                <p className="mt-0.5 text-[11.5px] text-text-3">
                  Issued {new Date(cert.issuedAt).toLocaleString()}
                </p>
              </header>
              <dl className="grid gap-px bg-border sm:grid-cols-3">
                <Fact label="Hospital billed" value={inr(cert.billTotal)} />
                <Fact label="The policy owed" value={inr(cert.expectedPayable)} />
                <Fact label="The insurer paid" value={inr(cert.actualPaid)} />
              </dl>
              <p className="border-t border-border px-4 py-2.5 text-[11.5px] leading-relaxed text-text-2">
                {cert.invariantHeld
                  ? 'Every rupee of the difference is attributed to a clause or explicitly marked unattributed. Nothing was rounded away.'
                  : 'The ledger did not balance, so this result is not safe to act on.'}
              </p>
            </section>

            <section className="overflow-hidden rounded-xl border border-border bg-surface">
              <header className="border-b border-border px-4 py-2.5">
                <h2 className="text-[12.5px] font-semibold tracking-[-0.02em] text-text">What it is pinned to</h2>
                <p className="mt-0.5 text-[11.5px] text-text-3">
                  A later rulepack cannot rewrite this case: an old certificate still verifies against its own
                  pins.
                </p>
              </header>

              <ul className="divide-y divide-border">
                <Pin
                  label="Rules"
                  value={`Rulepack ${cert.pins.rulepackVersion}`}
                  aside={<Fingerprint value={cert.pins.rulepackHash} />}
                />
                <Pin label="Engine" value={`Version ${cert.pins.engineVersion}`} />
                <Pin label="Lexicon" value={`Version ${cert.pins.lexiconVersion}`} />
                <Pin
                  label="What was read off the documents"
                  value="Fixed at the moment of extraction"
                  aside={<Fingerprint value={cert.pins.extractionHash} />}
                />
                <Pin
                  label="The result itself"
                  value="Hashed over the canonical reconstruction"
                  aside={<Fingerprint value={cert.resultHash} />}
                />
                <Pin
                  label="Signature"
                  value={
                    cert.signature
                      ? `Signed with an asymmetric key you can check offline`
                      : 'Unsigned — the signing key lives in the pipeline stack, not here'
                  }
                  aside={
                    cert.signature ? (
                      <Chip tone="brand">
                        <BadgeCheck className="size-3" />
                        {cert.signature.alg.replaceAll('_', ' ')}
                      </Chip>
                    ) : (
                      <Chip tone="quiet">
                        <CircleDashed className="size-3" />
                        Not signed here
                      </Chip>
                    )
                  }
                />
              </ul>

              <p className="border-t border-border px-4 py-2.5 text-[11.5px] leading-relaxed text-text-2">
                The steps were run in this order:{' '}
                <span className="text-text">{cert.pins.stepOrder.length} steps, pinned</span> — so an argument
                about the result is an argument about a rule, not about what the code happened to do that day.
              </p>
            </section>
          </>
        )}
      </Page>
    </>
  );
}

function Verdict({ result }: { result: VerifyResult }) {
  const ok = result.match;
  return (
    <section
      className={cn(
        'rounded-xl border p-4',
        ok ? 'border-brand/25 bg-brand-soft' : 'border-disputed/25 bg-disputed-soft',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-lg text-white',
            ok ? 'bg-brand' : 'bg-disputed',
          )}
        >
          {ok ? <BadgeCheck className="size-4" /> : <X className="size-4" />}
        </span>
        <div className="min-w-0">
          <p className={cn('text-[14px] font-semibold tracking-[-0.025em]', ok ? 'text-brand' : 'text-disputed')}>
            {ok ? 'Reproduced, to the paise' : 'It did not reproduce'}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-text-2">
            {ok
              ? `The server re-ran the engine over the pinned input in ${result.recomputedInMs} ms and arrived at the same result.`
              : 'The replay produced a different result. Treat the stored figure as unverified.'}
            {result.signatureValid !== null &&
              (result.signatureValid ? ' The signature checked out.' : ' The signature did not check out.')}
          </p>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Fingerprint value={result.storedHash} label="Stored" />
            {ok ? (
              <Equal className="size-3.5 text-brand" strokeWidth={2.5} />
            ) : (
              <X className="size-3.5 text-disputed" strokeWidth={2.5} />
            )}
            <Fingerprint value={result.recomputedHash} label="Replayed" />
          </div>
        </div>
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-4 py-3">
      <dt className="text-[11px] font-medium text-text-3">{label}</dt>
      <dd data-numeric className="mt-1 text-[18px] font-medium leading-none tracking-[-0.03em] text-text">
        {value}
      </dd>
    </div>
  );
}

function Pin({ label, value, aside }: { label: string; value: string; aside?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-2.5">
      <div className="min-w-0">
        <p className="text-[12px] font-medium tracking-[-0.01em] text-text">{label}</p>
        <p className="mt-0.5 text-[11.5px] leading-snug text-text-3">{value}</p>
      </div>
      {aside}
    </li>
  );
}
