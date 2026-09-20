import type { CaseView } from '../lib/case';
import { inr } from '../lib/format';
import { STEP_LABEL } from '../lib/labels';
import { cn } from '../lib/utils';
import { Money, Panel } from './primitives';

/**
 * The waterfall, drawn as one. Each bar is the balance still payable when the
 * step ended; the paler stub on its right is what that step took away. The
 * order is the policy's, not ours, and it is pinned into the certificate —
 * which is the whole reason a step can be argued with at all.
 */
export function StepsRail({ view }: { view: CaseView }) {
  const steps = view.result.steps;
  const ceiling = Math.max(view.billTotal, ...steps.map((s) => s.openingBalance), 1);

  return (
    <Panel
      title="Where the money went"
      subtitle="Seven steps, in the order this wording sets"
      className="shrink-0"
    >
      <ol className="divide-y divide-border">
        {steps.map((step, i) => {
          const removed = step.openingBalance - step.closingBalance;
          const closingPct = (step.closingBalance / ceiling) * 100;
          const removedPct = (Math.abs(removed) / ceiling) * 100;
          const contested = step.findingIds.length > 0 && removed !== 0;

          return (
            <li key={step.stepId} className="grid grid-cols-[22px_minmax(0,1fr)] gap-x-2.5 px-3.5 py-2.5">
              <span className="pt-[3px] text-[10.5px] font-medium tabular-nums text-text-3">
                {String(i + 1).padStart(2, '0')}
              </span>

              <div className="min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span
                    className={cn(
                      'truncate text-[12.5px] font-medium tracking-[-0.01em]',
                      removed === 0 ? 'text-text-3' : 'text-text',
                    )}
                  >
                    {STEP_LABEL[step.stepId]}
                  </span>
                  <Money
                    value={inr(step.closingBalance)}
                    className="shrink-0 text-[12.5px]"
                    tone={removed === 0 ? 'muted' : 'default'}
                  />
                </div>

                <div aria-hidden className="mt-1.5 flex h-[5px] w-full overflow-hidden rounded-full bg-border/70">
                  <span className="h-full bg-ink/85" style={{ width: `${closingPct}%` }} />
                  {removedPct > 0 && (
                    <span
                      className={cn('h-full', contested ? 'bg-disputed/70' : 'bg-defended/45')}
                      style={{ width: `${removedPct}%` }}
                    />
                  )}
                </div>

                {removed !== 0 && (
                  <div className="mt-1 text-[11px] text-text-3">
                    took {inr(Math.abs(removed))} off
                    {step.findingIds.length > 0 && (
                      <>
                        {' · '}
                        {step.findingIds.length} {step.findingIds.length === 1 ? 'finding' : 'findings'}
                      </>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <footer className="flex items-baseline justify-between gap-3 border-t border-border-strong bg-canvas/60 px-3.5 py-2.5">
        <span className="text-[11.5px] font-medium text-text-2">What the policy owed</span>
        <Money value={inr(view.expectedPayable)} className="text-[13px] font-semibold" tone="accent" />
      </footer>
    </Panel>
  );
}
