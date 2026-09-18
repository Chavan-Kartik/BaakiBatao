import type { CaseView } from '../lib/case';
import { Shell } from './ui';

export function Masthead({ view }: { view: CaseView }) {
  const { pins } = view.result;

  return (
    <div className="sticky top-0 z-20 border-b border-rule bg-paper/85 backdrop-blur-md">
      <Shell>
        <div className="flex h-14 items-center justify-between gap-6">
          <div className="flex items-baseline gap-3">
            <span className="font-serif text-[1.0625rem] tracking-[-0.01em] text-ink">
              Settlement Reconstructor
            </span>
            <span className="hidden font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-faint sm:inline">
              Deterministic claims audit
            </span>
          </div>

          {/* The pins are the provenance of every figure below, so they are not
              buried in a footer. */}
          <dl className="flex items-center gap-4 font-mono text-[10.5px] text-ink-muted">
            <div className="hidden items-baseline gap-1.5 md:flex">
              <dt className="text-ink-faint">engine</dt>
              <dd>{pins.engineVersion}</dd>
            </div>
            <div className="hidden items-baseline gap-1.5 sm:flex">
              <dt className="text-ink-faint">rulepack</dt>
              <dd>{pins.rulepackVersion}</dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="text-ink-faint">hash</dt>
              <dd title={pins.rulepackHash}>{pins.rulepackHash.replace('sha256:', '').slice(0, 8)}</dd>
            </div>
          </dl>
        </div>
      </Shell>
    </div>
  );
}
