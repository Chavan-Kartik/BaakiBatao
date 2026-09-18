import type { CaseView } from '../lib/case';
import { inr } from '../lib/format';
import { STEP_LABEL, STEP_NOTE } from '../lib/labels';
import { Card, SectionHeading, Shell } from './ui';

/**
 * The order is the thesis.
 *
 * Proportionate deduction is step five of seven, not the whole product. Running
 * it before the non-payable and cap steps would change the base it applies to
 * and therefore the answer, which is why the order lives in the rulepack as
 * data and is pinned into every result.
 */
export function Waterfall({ view }: { view: CaseView }) {
  const { steps } = view.result;
  const opening = steps[0]?.openingBalance ?? view.billTotal;

  return (
    <Shell>
      <section className="border-b border-rule py-16 md:py-20">
        <SectionHeading
          eyebrow="The waterfall"
          title="Seven steps, in the order the rulepack declares."
          lede="Each step is a pure reducer over the same state, and each one may only reduce the
            balance by citing a clause. The balance below is what remains payable as the claim moves
            through them."
        />

        <Card className="overflow-hidden">
          <ol className="divide-y divide-rule-soft">
            {steps.map((step, i) => {
              const delta = step.closingBalance - step.openingBalance;
              const share = opening > 0 ? (step.closingBalance / opening) * 100 : 0;
              const contested = step.stepId === 'PROPORTIONATE';

              return (
                <li
                  key={step.stepId}
                  className={`grid grid-cols-[2rem_1fr] gap-x-4 px-6 py-5 sm:grid-cols-[2rem_1fr_auto] ${
                    contested ? 'bg-disputed-soft/40' : ''
                  }`}
                >
                  <span
                    data-numeric
                    className="font-mono text-[11px] leading-6 text-ink-faint"
                    aria-hidden
                  >
                    {String(i + 1).padStart(2, '0')}
                  </span>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <h3 className="text-[0.9375rem] font-medium text-ink">
                        {STEP_LABEL[step.stepId]}
                      </h3>
                      <code className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-faint">
                        {step.stepId}
                      </code>
                      {contested && (
                        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-disputed">
                          where this claim went wrong
                        </span>
                      )}
                    </div>

                    <p className="mt-1.5 max-w-[58ch] text-[0.8125rem] leading-relaxed text-ink-muted">
                      {STEP_NOTE[step.stepId]}
                    </p>

                    {/* Remaining payable, to scale against the opening balance. */}
                    <div className="mt-3 h-[3px] w-full max-w-[22rem] overflow-hidden rounded-full bg-rule-soft">
                      <div
                        className={contested ? 'h-full bg-disputed/55' : 'h-full bg-ink/25'}
                        style={{ width: `${Math.max(share, 0)}%` }}
                      />
                    </div>
                  </div>

                  <div className="col-span-2 mt-3 flex items-baseline gap-5 sm:col-span-1 sm:mt-0 sm:flex-col sm:items-end sm:gap-1 sm:text-right">
                    <p data-numeric className="font-serif text-[1.125rem] leading-none text-ink">
                      {inr(step.closingBalance)}
                    </p>
                    <p
                      data-numeric
                      className={`font-mono text-[11px] ${
                        delta === 0 ? 'text-ink-faint' : 'text-ink-muted'
                      }`}
                    >
                      {delta === 0 ? 'no change' : inr(delta as typeof step.closingBalance)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>
      </section>
    </Shell>
  );
}
