import type { CaseView } from '../lib/case';
import { inr } from '../lib/format';
import { STEP_LABEL } from '../lib/labels';
import { cn } from '../lib/utils';
import { Panel } from './ui';

export function StepsRail({ view }: { view: CaseView }) {
  return (
    <Panel title="Waterfall" className="shrink-0 lg:max-h-[220px]">
      <ol className="divide-y divide-border">
        {view.result.steps.map((step, i) => {
          const delta = step.closingBalance - step.openingBalance;
          const hot = step.stepId === 'PROPORTIONATE';

          return (
            <li
              key={step.stepId}
              className={cn(
                'flex items-center gap-3 px-3 py-2',
                hot && 'bg-disputed-soft/50',
              )}
            >
              <span className="w-5 shrink-0 font-mono text-[10px] text-text-3">
                {String(i + 1).padStart(2, '0')}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium text-text">
                  {STEP_LABEL[step.stepId]}
                </div>
                {hot && (
                  <div className="font-mono text-[10px] text-disputed">contested on this claim</div>
                )}
              </div>
              <div className="shrink-0 text-right">
                <div data-numeric className="text-[12px] font-medium text-text">
                  {inr(step.closingBalance)}
                </div>
                <div data-numeric className="font-mono text-[10px] text-text-3">
                  {delta === 0 ? '—' : inr(delta)}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
