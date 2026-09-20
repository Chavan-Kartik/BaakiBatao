import type { CaseSummary } from '@fc/contracts';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { STATUS_LABEL } from '../lib/labels';
import { href } from '../lib/router';
import { cn } from '../lib/utils';

export function CasesList() {
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listCases().then(setCases).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold tracking-tight text-text">Cases</h1>
          <p className="mt-1 text-[13px] text-text-2">Every claim pack you have submitted, and where it got to.</p>
        </div>
        <a
          href={href({ name: 'new' })}
          className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand/90"
        >
          <Plus className="size-3.5" />
          New case
        </a>
      </div>

      {error && <p className="rounded-sm bg-disputed-soft px-3 py-2 text-[12px] text-disputed">{error}</p>}

      <div className="rounded-md border border-border bg-surface">
        <a href={href({ name: 'demo' })} className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 hover:bg-hover">
          <div>
            <div className="text-[13px] font-medium text-text">Demo case — the worked example</div>
            <div className="mt-0.5 text-[11px] text-text-3">Settled in your browser by the same engine. No upload, no account needed.</div>
          </div>
          <span className="rounded-sm bg-brand-soft px-1.5 py-0.5 font-mono text-[10px] text-brand">in-browser</span>
        </a>

        {cases === null ? (
          <div className="px-4 py-8 text-center text-[12px] text-text-3">Loading…</div>
        ) : cases.length === 0 ? (
          <div className="px-4 py-8 text-center text-[12px] text-text-3">No cases yet. Upload a claim pack to start one.</div>
        ) : (
          cases.map((c) => {
            const done = c.status === 'COMPLETE';
            const failed = c.status === 'FAILED';
            return (
              <a
                key={c.caseId}
                href={href({ name: 'case', caseId: c.caseId, tab: done ? 'review' : 'pipeline' })}
                className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3 last:border-b-0 hover:bg-hover"
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-[12px] text-text">{c.caseId}</div>
                  <div className="mt-0.5 text-[11px] text-text-3">
                    {new Date(c.createdAt).toLocaleString()} · {c.documents.length} documents
                  </div>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[10px]',
                    failed ? 'bg-disputed-soft text-disputed' : done ? 'bg-brand-soft text-brand' : 'bg-defended-soft text-defended',
                  )}
                >
                  {STATUS_LABEL[c.status] ?? c.status}
                </span>
              </a>
            );
          })
        )}
      </div>
    </div>
  );
}
