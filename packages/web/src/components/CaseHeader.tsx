import type { CaseView } from '../lib/case';
import { inr } from '../lib/format';
import { Money } from './primitives';

export function CaseHeader({ view }: { view: CaseView }) {
  const held = view.result.reconciliation.invariantHeld;

  return (
    <header className="shrink-0 border-b border-border bg-surface">
      <div className="flex h-12 items-center justify-between gap-4 px-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-[15px] font-semibold tracking-tight text-text">
              Case review
            </h1>
            <span className="rounded-sm bg-brand-soft px-1.5 py-0.5 font-mono text-[11px] text-brand">
              reconstructed
            </span>
            <span
              className={
                held
                  ? 'rounded-sm bg-defended-soft px-1.5 py-0.5 font-mono text-[11px] text-defended'
                  : 'rounded-sm bg-disputed-soft px-1.5 py-0.5 font-mono text-[11px] text-disputed'
              }
            >
              invariant {held ? 'held' : 'broken'}
            </span>
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] text-text-3">
            {view.result.caseId} · rulepack {view.result.pins.rulepackVersion} · engine{' '}
            {view.result.pins.engineVersion}
          </p>
        </div>

        <button
          type="button"
          className="inline-flex h-8 shrink-0 items-center rounded-sm bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand/90"
        >
          Draft reconsideration
        </button>
      </div>

      <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Bill total" value={inr(view.billTotal)} />
        <Metric label="Expected payable" value={inr(view.expectedPayable)} />
        <Metric label="Insurer paid" value={inr(view.actualPaid)} />
        <Metric label="Shortfall" value={inr(view.shortfall)} tone="disputed" />
        <Metric label="Recoverable" value={inr(view.recoverable)} tone="accent" />
        <Metric label="Unexplained" value={inr(view.unexplained)} />
      </div>
    </header>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'default' | 'disputed' | 'accent';
}) {
  return (
    <div className="bg-surface px-3 py-2.5">
      <div className="text-[11px] text-text-3">{label}</div>
      <Money value={value} tone={tone} className="mt-0.5 block text-[15px]" />
    </div>
  );
}
