import type { CaseEvent, GetCaseResponse } from '@fc/contracts';
import { AlertTriangle, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { FAILURE_LABEL, STATUS_LABEL } from '../lib/labels';
import { href } from '../lib/router';
import { cn } from '../lib/utils';

/**
 * The execution, state by state, as it happens. The same event log the
 * Step Functions execution will emit (`CaseEvent` is the contract), rendered
 * live over server-sent events — and then kept, so a finished case still
 * shows how it got there.
 */
const STAGES: readonly { label: string; events: readonly CaseEvent['kind'][] }[] = [
  { label: 'Pack uploaded', events: ['PackUploaded'] },
  { label: 'Pack validated', events: ['PackValidated'] },
  { label: 'Documents classified', events: ['DocumentClassified'] },
  { label: 'Tables extracted', events: ['PageExtracted'] },
  { label: 'Redaction gate', events: ['Redacted'] },
  { label: 'Row checksum', events: ['ChecksumFailed', 'RowsCorrected'] },
  { label: 'Lines normalised', events: ['Normalised'] },
  { label: 'Settlement reconstructed', events: ['Reconstructed'] },
  { label: 'Prose', events: ['ProseWritten'] },
  { label: 'Certificate issued', events: ['CertificateIssued'] },
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
      (e) => setEvents((prev) => (prev.some((p) => p.seq === e.seq) ? prev : [...prev, e].sort((a, b) => a.seq - b.seq))),
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
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold tracking-tight text-text">Pipeline</h1>
          <p className="mt-1 font-mono text-[11px] text-text-3">{caseId}</p>
        </div>
        <span
          className={cn(
            'rounded-sm px-2 py-1 font-mono text-[11px]',
            failed ? 'bg-disputed-soft text-disputed' : done ? 'bg-brand-soft text-brand' : paused ? 'bg-unresolved-soft text-unresolved' : 'bg-defended-soft text-defended',
          )}
        >
          {STATUS_LABEL[status] ?? status}
        </span>
      </div>

      <ol className="rounded-md border border-border bg-surface">
        {STAGES.map((stage, i) => {
          const hit = stage.events.filter((k) => seen.has(k));
          // A stage with no event of its own (a checksum that passed) is done
          // once anything after it has happened.
          const reached = hit.length > 0 || STAGES.slice(i + 1).some((s) => s.events.some((k) => seen.has(k)));
          const isFailedHere = failed && !reached && STAGES.slice(0, i).every((s) => s.events.some((k) => seen.has(k)));
          const detail = events.filter((e) => stage.events.includes(e.kind));
          return (
            <li key={stage.label} className="flex gap-3 border-b border-border/70 px-4 py-3 last:border-b-0">
              <div className="mt-0.5">
                {reached ? (
                  <CheckCircle2 className={cn('size-4', hit.includes('ChecksumFailed') ? 'text-unresolved' : 'text-brand')} />
                ) : isFailedHere ? (
                  <AlertTriangle className="size-4 text-disputed" />
                ) : done || failed ? (
                  <Circle className="size-4 text-text-3" />
                ) : (
                  <Loader2 className="size-4 animate-spin text-text-3" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-text">{stage.label}</div>
                {detail.map((e) => (
                  <Detail key={e.seq} event={e} />
                ))}
              </div>
            </li>
          );
        })}
      </ol>

      {failure && (
        <div className="mt-4 rounded-md border border-disputed/30 bg-disputed-soft p-4">
          <div className="text-[13px] font-medium text-disputed">{FAILURE_LABEL[failure.code] ?? failure.code}</div>
          <p className="mt-1 text-[12px] text-text-2">{failure.message}</p>
          <code className="mt-2 inline-block font-mono text-[10px] text-text-3">{failure.code}</code>
        </div>
      )}

      {paused && (
        <div className="mt-4 rounded-md border border-unresolved/30 bg-unresolved-soft p-4 text-[12px] text-text-2">
          The line items do not sum to the printed bill total. The case is paused for a correction —
          open the review to fix the rows and resume.
        </div>
      )}

      {(done || paused) && (
        <div className="mt-5 flex justify-end">
          <a
            href={href({ name: 'case', caseId, tab: 'review' })}
            className="inline-flex h-9 items-center rounded-sm bg-brand px-4 text-[13px] font-medium text-white hover:bg-brand/90"
          >
            {paused ? 'Open correction grid' : 'Open case review'}
          </a>
        </div>
      )}
    </div>
  );
}

function Detail({ event }: { event: CaseEvent }) {
  const d = event.detail;
  const text = summarise(event.kind, d);
  return (
    <div className="mt-1 flex items-baseline gap-2 font-mono text-[11px] text-text-3">
      <span className="shrink-0 text-text-3/70">{new Date(event.at).toLocaleTimeString()}</span>
      <span className="text-text-2">{text}</span>
    </div>
  );
}

function summarise(kind: CaseEvent['kind'], d: Record<string, unknown>): string {
  switch (kind) {
    case 'PackUploaded': return `${(d['documents'] as unknown[] | undefined)?.length ?? 0} documents`;
    case 'DocumentClassified': return `${String(d['kind'])} ← ${String(d['filename'])}`;
    case 'PageExtracted': return `${String(d['extractor'])}: ${String(d['billRows'])} bill rows, ${String(d['sheetRows'])} sheet rows`;
    case 'Redacted': return `${Object.values((d['countByType'] as Record<string, number>) ?? {}).reduce((a, b) => a + b, 0)} identifiers masked · ${(d['detectors'] as string[] | undefined)?.join(', ')} · comprehend ${String(d['comprehend'])}`;
    case 'ChecksumFailed': return `rows sum to ${String(d['summedRows'])} against a printed ${String(d['printedTotal'])} — paused`;
    case 'RowsCorrected': return `${String(d['edits'])} rows corrected, resuming`;
    case 'Normalised': {
      const tiers = (d['tiers'] as Record<string, number>) ?? {};
      return Object.entries(tiers).map(([t, n]) => `${t.toLowerCase()} ${n}`).join(' · ');
    }
    case 'Reconstructed': return `${String(d['findings'])} findings · expected ${fmt(d['expectedPayable'])} · paid ${fmt(d['actualPaid'])}`;
    case 'ProseWritten': return d['skipped'] ? `skipped — ${String(d['reason'])}` : 'written';
    case 'CertificateIssued': return `${String(d['resultHash']).slice(0, 23)}… · ${d['signed'] ? 'signed' : 'unsigned (no KMS key locally)'}`;
    case 'CaseFailed': return String(d['message']);
    default: return '';
  }
}

const fmt = (paise: unknown): string =>
  typeof paise === 'number' ? `₹${(paise / 100).toLocaleString('en-IN')}` : '—';
