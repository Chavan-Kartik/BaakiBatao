import type { CaseSummary } from '@fc/contracts';
import { ArrowRight, FileStack, FlaskConical, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { Chip, ErrorNote, Page, PillLink } from '../components/primitives';
import { Skeleton } from '../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { api } from '../lib/api';
import { DOCUMENT_LABEL } from '../lib/api';
import { STATUS_LABEL } from '../lib/labels';
import { href } from '../lib/router';

/** Complete, failed, or still moving — the three things a row can be. */
function statusTone(status: string): 'neutral' | 'brand' | 'disputed' | 'unresolved' {
  if (status === 'FAILED') return 'disputed';
  if (status === 'COMPLETE') return 'brand';
  if (status === 'AWAITING_CORRECTION') return 'unresolved';
  return 'neutral';
}

export function CasesList() {
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listCases()
      .then(setCases)
      .catch((e: unknown) => {
        setCases([]);
        setError(e instanceof Error ? e.message : 'Could not load your cases.');
      });
  }, []);

  return (
    <>
      <AppHeader
        title="Cases"
        subtitle="Every claim pack that has been through the pipeline"
        actions={
          <PillLink href={href({ name: 'new' })} size="sm">
            <Plus />
            New case
          </PillLink>
        }
      />

      <Page wide className="space-y-3">
        {error && <ErrorNote>{error}</ErrorNote>}

        <a
          href={href({ name: 'demo' })}
          className="group flex items-center gap-3.5 rounded-xl border border-brand/25 bg-brand-soft px-4 py-3.5 transition-colors hover:border-brand/40"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand text-white">
            <FlaskConical className="size-4" strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold tracking-[-0.02em] text-text">
              The worked example
            </span>
            <span className="mt-0.5 block text-[11.5px] leading-snug text-text-2">
              A full claim settled in your browser by the same engine the server runs. No upload, no
              account, no waiting.
            </span>
          </span>
          <ArrowRight className="size-4 shrink-0 text-brand transition-transform group-hover:translate-x-0.5" />
        </a>

        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          {cases === null ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-11 rounded-lg" />
              ))}
            </div>
          ) : cases.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
              <span className="grid size-9 place-items-center rounded-lg border border-border bg-canvas text-text-3">
                <FileStack className="size-4" strokeWidth={1.75} />
              </span>
              <p className="text-[13px] font-semibold tracking-[-0.02em] text-text">No cases yet</p>
              <p className="max-w-[40ch] text-[12px] leading-relaxed text-text-3">
                Upload a schedule, a wording, an itemised bill and the insurer's deduction sheet, and the
                pipeline will do the rest.
              </p>
              <PillLink href={href({ name: 'new' })} size="sm" className="mt-1.5">
                <Plus />
                Upload a claim pack
              </PillLink>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-full">Case</TableHead>
                  <TableHead>Documents</TableHead>
                  <TableHead>Opened</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cases.map((c) => {
                  const done = c.status === 'COMPLETE';
                  return (
                    <TableRow
                      key={c.caseId}
                      className="cursor-pointer"
                      onClick={() => {
                        window.location.hash = href({
                          name: 'case',
                          caseId: c.caseId,
                          tab: done ? 'review' : 'pipeline',
                        });
                      }}
                    >
                      <TableCell className="py-2.5">
                        <a
                          href={href({ name: 'case', caseId: c.caseId, tab: done ? 'review' : 'pipeline' })}
                          className="text-[12.5px] font-medium tracking-[-0.01em] text-text hover:underline"
                        >
                          Claim opened {new Date(c.createdAt).toLocaleDateString(undefined, {
                            day: 'numeric',
                            month: 'short',
                          })}
                        </a>
                        <div className="mt-0.5 truncate text-[11px] text-text-3">
                          {c.documents.map((d) => DOCUMENT_LABEL[d] ?? d).join(' · ')}
                        </div>
                      </TableCell>
                      <TableCell className="py-2.5 text-[12px] text-text-2">{c.documents.length}</TableCell>
                      <TableCell className="py-2.5 text-[12px] text-text-2">
                        {new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </TableCell>
                      <TableCell className="py-2.5 text-right">
                        <Chip tone={statusTone(c.status)}>{STATUS_LABEL[c.status] ?? c.status}</Chip>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </section>
      </Page>
    </>
  );
}
