import type { GetCaseResponse, LineRef } from '@fc/contracts';
import { loadRulepackV1 } from '@fc/rulepack';
import { useEffect, useMemo, useState } from 'react';
import { BillTable, type LineFilter } from '../components/BillTable';
import { CaseHeader } from '../components/CaseHeader';
import { FindingPanel } from '../components/FindingPanel';
import { StepsRail } from '../components/StepsRail';
import { api } from '../lib/api';
import { buildCaseView, buildDemoCaseView, type CaseView } from '../lib/case';
import { STATUS_LABEL } from '../lib/labels';
import { href } from '../lib/router';
import { CorrectionGrid } from './CorrectionGrid';

/** The workspace: metrics · bill table · finding inspector · waterfall. */
function Workspace({ view, correction }: { view: CaseView; correction?: React.ReactNode }) {
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const firstDisputed = view.rows.findIndex((r) => r.disputed > 0);
    return firstDisputed >= 0 ? firstDisputed : 0;
  });
  const [filter, setFilter] = useState<LineFilter>('all');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CaseHeader view={view} />
      {correction && <div className="max-h-[42vh] shrink-0 overflow-hidden px-3 pt-3 [&>section]:max-h-[42vh]">{correction}</div>}
      <div className="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.9fr)]">
        <div className="flex min-h-0 flex-col gap-3">
          <BillTable view={view} selectedIndex={selectedIndex} filter={filter} onSelect={setSelectedIndex} onFilter={setFilter} />
          <StepsRail view={view} />
        </div>
        <FindingPanel view={view} selectedIndex={selectedIndex} />
      </div>
    </div>
  );
}

export function DemoReview() {
  const view = useMemo(() => buildDemoCaseView(), []);
  return <Workspace view={view} />;
}

export function CaseReview({ caseId }: { caseId: string }) {
  const [data, setData] = useState<GetCaseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rulepack = useMemo(() => loadRulepackV1(), []);

  useEffect(() => {
    setData(null);
    api.getCase(caseId).then(setData).catch((e: Error) => setError(e.message));
  }, [caseId]);

  if (error) return <Notice>{error}</Notice>;
  if (!data) return <Notice>Loading…</Notice>;

  if (data.status === 'AWAITING_CORRECTION' && data.extractedBill && data.correctionTaskToken) {
    return (
      <div className="mx-auto w-full max-w-4xl p-4">
        <CorrectionGrid
          caseId={caseId}
          taskToken={data.correctionTaskToken}
          bill={data.extractedBill}
          flagged={new Set<LineRef>()}
          reason="the line items do not sum to the printed bill total"
        />
      </div>
    );
  }

  if (!data.input || !data.reconstruction) {
    return (
      <Notice>
        This case is {STATUS_LABEL[data.status] ?? data.status}.{' '}
        <a className="text-brand hover:underline" href={href({ name: 'case', caseId, tab: 'pipeline' })}>
          Watch the pipeline
        </a>
        .
      </Notice>
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
        reason={`${unresolved.size} line${unresolved.size === 1 ? '' : 's'} could not be categorised and ${unresolved.size === 1 ? 'was' : 'were'} not adjudicated`}
      />
    ) : undefined;

  return <Workspace key={caseId} view={view} correction={correction} />;
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="px-6 py-10 text-[13px] text-text-2">{children}</div>;
}
