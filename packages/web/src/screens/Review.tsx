import type { GetCaseResponse, LineRef } from '@fc/contracts';
import { loadRulepackV1 } from '@fc/rulepack';
import { ArrowRight, FileDown, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { BillTable, type LineFilter } from '../components/BillTable';
import { CaseSummary } from '../components/CaseSummary';
import { FindingPanel } from '../components/FindingPanel';
import { StepsRail } from '../components/StepsRail';
import { Chip, ErrorNote, Fingerprint, Page, PillButton, PillLink } from '../components/primitives';
import { Skeleton } from '../components/ui/skeleton';
import { api } from '../lib/api';
import { buildCaseView, buildDemoCaseView, type CaseView } from '../lib/case';
import { STATUS_LABEL } from '../lib/labels';
import { href } from '../lib/router';
import { CorrectionGrid } from './CorrectionGrid';

/**
 * The workspace: the four figures, the bill they came from, and the reasoning
 * for whichever line is selected. Three surfaces on one screen — an argument
 * is not something a reader should have to navigate.
 */
function Workspace({
  view,
  subtitle,
  origin,
  correction,
}: {
  view: CaseView;
  subtitle?: string;
  origin?: string;
  correction?: React.ReactNode;
}) {
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const firstDisputed = view.rows.findIndex((r) => r.disputed > 0);
    return firstDisputed >= 0 ? firstDisputed : 0;
  });
  const [filter, setFilter] = useState<LineFilter>('all');
  const held = view.result.reconciliation.invariantHeld;

  return (
    <>
      <AppHeader
        title="Case review"
        subtitle={subtitle}
        chips={
          <>
            {origin && <Chip tone="brand">{origin}</Chip>}
            <Chip tone={held ? 'neutral' : 'disputed'}>
              {held ? <ShieldCheck className="size-3" /> : <TriangleAlert className="size-3" />}
              {held ? 'Every rupee accounted for' : 'Ledger does not balance'}
            </Chip>
            <Chip tone="quiet">Rulepack {view.result.pins.rulepackVersion}</Chip>
          </>
        }
        actions={
          <>
            <Fingerprint value={view.result.caseId} label="Case" />
            <PillButton variant="ink" size="sm">
              <FileDown />
              Draft reconsideration
            </PillButton>
          </>
        }
      />

      <Page wide className="space-y-3">
        <CaseSummary view={view} />

        {correction}

        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(340px,0.8fr)]">
          <div className="flex min-w-0 flex-col gap-3">
            <BillTable
              view={view}
              selectedIndex={selectedIndex}
              filter={filter}
              onSelect={setSelectedIndex}
              onFilter={setFilter}
            />
            <StepsRail view={view} />
          </div>

          <FindingPanel view={view} selectedIndex={selectedIndex} />
        </div>
      </Page>
    </>
  );
}

/** The reference claim, settled in this browser by the module the API runs. */
export function DemoReview() {
  const view = useMemo(() => buildDemoCaseView(), []);
  return (
    <Workspace
      view={view}
      origin="Settled in your browser"
      subtitle="The worked example — no upload, no server, no account"
    />
  );
}

export function CaseReview({ caseId }: { caseId: string }) {
  const [data, setData] = useState<GetCaseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rulepack = useMemo(() => loadRulepackV1(), []);

  useEffect(() => {
    setData(null);
    setError(null);
    api.getCase(caseId).then(setData).catch((e: Error) => setError(e.message));
  }, [caseId]);

  if (error) {
    return (
      <>
        <AppHeader title="Case review" />
        <Page>
          <ErrorNote>{error}</ErrorNote>
        </Page>
      </>
    );
  }

  if (!data) return <ReviewSkeleton />;

  if (data.status === 'AWAITING_CORRECTION' && data.extractedBill && data.correctionTaskToken) {
    return (
      <>
        <AppHeader
          title="Correction needed"
          subtitle="The pipeline is paused until these rows are right"
          chips={<Chip tone="unresolved">Paused</Chip>}
        />
        <Page wide>
          <CorrectionGrid
            caseId={caseId}
            taskToken={data.correctionTaskToken}
            bill={data.extractedBill}
            flagged={new Set<LineRef>()}
            reason="the line items do not sum to the printed bill total"
          />
        </Page>
      </>
    );
  }

  if (!data.input || !data.reconstruction) {
    const status = (STATUS_LABEL[data.status] ?? data.status).toLowerCase();
    return (
      <>
        <AppHeader title="Case review" chips={<Chip tone="quiet">{STATUS_LABEL[data.status] ?? data.status}</Chip>} />
        <Page>
          <div className="rounded-xl border border-border bg-surface px-5 py-8 text-center">
            <h2 className="text-[16px] font-semibold tracking-[-0.03em] text-text">
              Nothing to review yet — this case is {status}.
            </h2>
            <p className="mx-auto mt-2 max-w-[46ch] text-[12.5px] leading-relaxed text-text-2">
              Nothing is adjudicated until the pack has been read, checksummed and normalised. A wrong
              number stated confidently is worse than no number.
            </p>
            <PillLink href={href({ name: 'case', caseId, tab: 'pipeline' })} className="mt-5">
              Watch the pipeline
              <ArrowRight />
            </PillLink>
          </div>
        </Page>
      </>
    );
  }

  const view = buildCaseView(data.input, data.reconstruction, rulepack);
  const unresolved = new Set<LineRef>(
    data.input.normalisedLines.filter((l) => l.categoryId === null).map((l) => l.lineRef),
  );
  const correction =
    unresolved.size > 0 && data.correctionTaskToken && data.extractedBill ? (
      <CorrectionGrid
        caseId={caseId}
        taskToken={data.correctionTaskToken}
        bill={data.extractedBill}
        flagged={unresolved}
        reason={`${unresolved.size} line${unresolved.size === 1 ? '' : 's'} could not be categorised, so ${unresolved.size === 1 ? 'it was' : 'they were'} not adjudicated`}
      />
    ) : undefined;

  return <Workspace key={caseId} view={view} correction={correction} />;
}

function ReviewSkeleton() {
  return (
    <>
      <AppHeader title="Case review" subtitle="Loading" />
      <Page wide className="space-y-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.72fr)]">
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[86px] rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-[86px] rounded-xl lg:h-full" />
        </div>
        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(340px,0.8fr)]">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </Page>
    </>
  );
}
