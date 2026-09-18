import { useMemo, useState } from 'react';
import { BillTable, type LineFilter } from './components/BillTable';
import { CaseHeader } from './components/CaseHeader';
import { FindingPanel } from './components/FindingPanel';
import { Sidebar } from './components/Sidebar';
import { StepsRail } from './components/StepsRail';
import { buildCaseView } from './lib/case';

/**
 * Product shell for case review.
 *
 * Settles the reference claim in-browser via @fc/engine, then presents it as a
 * working claims workspace: sidebar · metrics · bill table · finding inspector.
 */
export function App() {
  const view = useMemo(() => buildCaseView(), []);
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const firstDisputed = view.rows.findIndex((r) => r.disputed > 0);
    return firstDisputed >= 0 ? firstDisputed : 0;
  });
  const [filter, setFilter] = useState<LineFilter>('all');

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <CaseHeader view={view} />

        <div className="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.9fr)]">
          <div className="flex min-h-0 flex-col gap-3">
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
      </div>
    </div>
  );
}
