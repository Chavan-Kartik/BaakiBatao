import type { CaseEvent, DocumentKind, GetCaseResponse } from '@fc/contracts';
import { ArrowRight, Check, CircleDashed, Loader, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { Chip, Page, PillLink } from '../components/primitives';
import { api, DOCUMENT_LABEL } from '../lib/api';
import { inr } from '../lib/format';
import { FAILURE_LABEL, STATUS_LABEL } from '../lib/labels';
import { href } from '../lib/router';
import { cn } from '../lib/utils';

/**
 * The execution, state by state, as it happens. The same event log the
 * Step Functions execution emits (`CaseEvent` is the contract), rendered live
 * over server-sent events — and then kept, so a finished case still shows how
 * it got there.
 */
const STAGES: readonly { label: string; blurb: string; events: readonly CaseEvent['kind'][] }[] = [
  { label: 'Pack received', blurb: 'Documents stored, encrypted, and checksummed', events: ['PackUploaded'] },
  { label: 'Pack validated', blurb: 'Every required document is present', events: ['PackValidated'] },
  { label: 'Documents identified', blurb: 'Which file is the bill, the sheet, the schedule', events: ['DocumentClassified'] },
  { label: 'Tables read', blurb: 'Line items lifted off the bill and the sheet', events: ['PageExtracted'] },
  { label: 'Personal details masked', blurb: 'Nothing identifying reaches a model', events: ['Redacted'] },
  { label: 'Rows checked against the total', blurb: 'The lines must add up to the printed total', events: ['ChecksumFailed', 'RowsCorrected'] },
  { label: 'Lines categorised', blurb: 'Free text matched to the rulepack’s categories', events: ['Normalised'] },
  { label: 'Settlement reconstructed', blurb: 'The waterfall, in the order the policy sets', events: ['Reconstructed'] },
  { label: 'Explanation written', blurb: 'Prose over figures the engine already fixed', events: ['ProseWritten'] },
  { label: 'Certificate issued', blurb: 'Hashed, pinned, and signed', events: ['CertificateIssued'] },
];

export function Pipeline({ caseId }: { caseId: string }) {
  const [events, setEvents] = useState<CaseEvent[]>([]);
  const [status, setStatus] = useState<string>('…');
  const [failure, setFailure] = useState<GetCaseResponse['failure']>(null);

  useEffect(() => {
    let cancelled = false;
    api.getCase(caseId).then((c) => {
      if (cancelled) return;
      setStatus(c.status);
      setFailure(c.failure);
    });
    const stop = api.events(
      caseId,
      (e) =>
        setEvents((prev) => (prev.some((p) => p.seq === e.seq) ? prev : [...prev, e].sort((a, b) => a.seq - b.seq))),
      (s) => {
        setStatus(s);
        api.getCase(caseId).then((c) => !cancelled && setFailure(c.failure));
      },
    );
    return () => {
      cancelled = true;
      stop();
    };
  }, [caseId]);

  const seen = new Set(events.map((e) => e.kind));
  const failed = status === 'FAILED';
  const done = status === 'COMPLETE';
  const paused = status === 'AWAITING_CORRECTION';

  return (
    <>
      <AppHeader
        title="Pipeline"
        subtitle="Fourteen functions, one state machine, and nothing adjudicated until the ledger balances"
        chips={
          <Chip tone={failed ? 'disputed' : done ? 'brand' : paused ? 'unresolved' : 'neutral'}>
            {STATUS_LABEL[status] ?? status}
          </Chip>
        }
        actions={
          (done || paused) && (
            <PillLink href={href({ name: 'case', caseId, tab: 'review' })} size="sm">
              {paused ? 'Open the correction grid' : 'Open the review'}
              <ArrowRight />
            </PillLink>
          )
        }
      />

      <Page className="space-y-3">
        <ol className="overflow-hidden rounded-xl border border-border bg-surface">
          {STAGES.map((stage, i) => {
            const hit = stage.events.filter((k) => seen.has(k));
            // A stage with no event of its own (a checksum that passed) is done
            // once anything after it has happened.
            const reached = hit.length > 0 || STAGES.slice(i + 1).some((s) => s.events.some((k) => seen.has(k)));
            const failedHere =
              failed && !reached && STAGES.slice(0, i).every((s) => s.events.some((k) => seen.has(k)));
            const running = !reached && !failedHere && !done && !failed;
            const detail = events.filter((e) => stage.events.includes(e.kind));
            const flagged = hit.includes('ChecksumFailed');

            return (
              <li key={stage.label} className="relative flex gap-3 px-4 py-3 last:pb-4">
                {i < STAGES.length - 1 && (
                  <span
                    aria-hidden
                    className={cn(
                      'absolute bottom-0 left-[27px] top-9 w-px',
                      reached ? 'bg-brand/35' : 'bg-border',
                    )}
                  />
                )}

                <span
                  className={cn(
                    'relative z-10 grid size-6 shrink-0 place-items-center rounded-full border',
                    reached && !flagged && 'border-brand bg-brand text-white',
                    reached && flagged && 'border-unresolved bg-unresolved text-white',
                    failedHere && 'border-disputed bg-disputed text-white',
                    running && 'border-border bg-surface text-text-3',
                    !reached && !failedHere && !running && 'border-border bg-canvas text-text-3',
                  )}
                >
                  {reached ? (
                    <Check className="size-3" strokeWidth={3} />
                  ) : failedHere ? (
                    <TriangleAlert className="size-3" strokeWidth={2.5} />
                  ) : running ? (
                    <Loader className="size-3 animate-spin" strokeWidth={2.5} />
                  ) : (
                    <CircleDashed className="size-3" strokeWidth={2} />
                  )}
                </span>

                <div className="min-w-0 flex-1 pt-0.5">
                  <div
                    className={cn(
                      'text-[12.5px] font-medium tracking-[-0.01em]',
                      reached || failedHere ? 'text-text' : 'text-text-3',
                    )}
                  >
                    {stage.label}
                  </div>
                  <div className="mt-0.5 text-[11.5px] leading-snug text-text-3">{stage.blurb}</div>

                  {detail.map((e) => {
                    const text = summarise(e.kind, e.detail);
                    if (!text) return null;
                    return (
                      <div
                        key={e.seq}
                        className="mt-1.5 flex items-baseline gap-2 rounded-md bg-canvas/70 px-2 py-1 text-[11.5px]"
                      >
                        <span className="shrink-0 tabular-nums text-text-3">
                          {new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                        <span className="text-text-2">{text}</span>
                      </div>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ol>

        {failure && (
          <div className="rounded-xl border border-disputed/25 bg-disputed-soft p-4">
            <div className="flex items-center gap-2">
              <TriangleAlert className="size-4 shrink-0 text-disputed" strokeWidth={2} />
              <p className="text-[13px] font-semibold tracking-[-0.02em] text-disputed">
                {FAILURE_LABEL[failure.code] ?? 'The pipeline stopped.'}
              </p>
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-text-2">{failure.message}</p>
            <p className="mt-2 text-[11.5px] text-text-3">
              Nothing was adjudicated. A pack that cannot be settled says why, and is never settled
              approximately.
            </p>
          </div>
        )}

        {paused && (
          <div className="rounded-xl border border-unresolved/25 bg-unresolved-soft p-4 text-[12px] leading-relaxed text-text-2">
            The line items do not add up to the printed total on the bill, so the run is paused rather than
            carried on over numbers we know are wrong. Open the review to correct the rows and resume.
          </div>
        )}
      </Page>
    </>
  );
}

/** One plain sentence per event. The detail object never reaches the screen. */
function summarise(kind: CaseEvent['kind'], d: Record<string, unknown>): string {
  switch (kind) {
    case 'PackUploaded': {
      const n = (d['documents'] as unknown[] | undefined)?.length ?? 0;
      return `${n} ${n === 1 ? 'document' : 'documents'} received`;
    }
    case 'DocumentClassified':
      return `Read as the ${(DOCUMENT_LABEL[d['kind'] as DocumentKind] ?? String(d['kind'])).toLowerCase()}`;
    case 'PageExtracted':
      return `${num(d['billRows'])} bill lines and ${num(d['sheetRows'])} deduction rows lifted out`;
    case 'Redacted': {
      const total = Object.values((d['countByType'] as Record<string, number>) ?? {}).reduce((a, b) => a + b, 0);
      return total === 0
        ? 'No personal identifiers found to mask'
        : `${total} personal ${total === 1 ? 'identifier' : 'identifiers'} masked before anything left the bucket`;
    }
    case 'ChecksumFailed':
      return `Lines add up to ${money(d['summedRows'])} against a printed ${money(d['printedTotal'])} — paused for a correction`;
    case 'RowsCorrected':
      return `${num(d['edits'])} ${num(d['edits']) === '1' ? 'row' : 'rows'} corrected by hand, resuming`;
    case 'Normalised':
      return describeTiers((d['tiers'] as Record<string, number>) ?? {});
    case 'Reconstructed':
      return `${num(d['findings'])} findings — the policy owed ${money(d['expectedPayable'])}, the insurer paid ${money(d['actualPaid'])}`;
    case 'ProseWritten':
      return d['skipped'] ? `Skipped — ${String(d['reason'])}` : 'Written over figures the engine had already fixed';
    case 'CertificateIssued':
      return d['signed']
        ? 'Issued and signed — replay it and you get the same paise'
        : 'Issued — this deployment has no signing key, so it is unsigned';
    case 'CaseFailed':
      return String(d['message']);
    default:
      return '';
  }
}

const TIER_WORDS: Record<string, (n: number) => string> = {
  LEXICON: (n) => `${n} matched exactly`,
  LEXICON_FUZZY: (n) => `${n} matched by similarity`,
  EMBEDDING: (n) => `${n} placed by nearest meaning`,
  LLM: (n) => `${n} needed a model to break the tie`,
  UNRESOLVED: (n) => `${n} left uncategorised`,
};

function describeTiers(tiers: Record<string, number>): string {
  const parts = Object.entries(tiers)
    .filter(([, n]) => n > 0)
    .map(([tier, n]) => (TIER_WORDS[tier] ?? ((k: number) => `${k} via ${tier.toLowerCase()}`))(n));
  return parts.length === 0 ? 'No lines to categorise' : `${parts.join(', ')}`;
}

const num = (v: unknown): string => (typeof v === 'number' ? String(v) : '—');
const money = (paise: unknown): string => (typeof paise === 'number' ? inr(paise) : '—');
