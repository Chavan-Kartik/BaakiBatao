import type { CaseView } from '../lib/case';
import { inr, inrAbs } from '../lib/format';
import { Card, Eyebrow, SectionHeading, Shell } from './ui';

/**
 * The zero-sum check, shown as arithmetic a reader can follow.
 *
 * `residual` is required to be exactly 0 in any returned reconstruction. That
 * is not achieved by rounding the remainder away — any leftover has already
 * been materialised as an UNRESOLVED finding with reason RESIDUAL_UNATTRIBUTED.
 * Every paise is either attributed to a clause or explicitly marked
 * unattributed, and there is no third state.
 */
export function Invariant({ view }: { view: CaseView }) {
  const { reconciliation } = view.result;
  const held = reconciliation.invariantHeld && reconciliation.residual === 0;

  return (
    <Shell>
      <section className="border-b border-rule py-16 md:py-20">
        <SectionHeading
          eyebrow="The invariant"
          title="The arithmetic is checked, not asserted."
          lede="A reconstruction that does not add up is refused rather than returned. This is the
            check that makes the three buckets above trustworthy: they are not a summary of the
            findings, they are required to equal the money the insurer actually withheld."
        />

        <Card className="overflow-hidden">
          <div className="grid gap-px bg-rule sm:grid-cols-3">
            <Panel
              label="Withheld, per their letter"
              value={inr(reconciliation.observedDelta)}
              detail="bill total less the amount paid"
            />
            <Panel
              label="Attributed by the engine"
              value={inrAbs(reconciliation.attributedDelta)}
              detail="the sum of every finding it produced"
            />
            <Panel
              label="Residual"
              value={inr(reconciliation.residual)}
              detail={held ? 'nothing unaccounted for' : 'invariant breached'}
              tone={held ? 'ok' : 'bad'}
            />
          </div>

          <div className="border-t border-rule px-6 py-6">
            <Eyebrow>Decomposition</Eyebrow>

            {/* Written as an equation because the claim is arithmetic. */}
            <div
              data-numeric
              className="mt-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-2 font-serif text-[1.125rem] text-ink-soft"
            >
              <span className="text-defended">{inrAbs(view.defendedTotal)}</span>
              <span className="text-ink-faint">+</span>
              <span className="text-disputed">{inrAbs(view.disputedGross)}</span>
              <span className="text-ink-faint">+</span>
              <span className="text-unresolved">{inrAbs(view.unexplained)}</span>
              <span className="text-ink-faint">=</span>
              <span className="text-ink">{inr(reconciliation.observedDelta)}</span>
            </div>

            <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-faint">
              lawful + disputed + unexplained = withheld
            </p>
          </div>
        </Card>
      </section>
    </Shell>
  );
}

function Panel({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  detail: string;
  tone?: 'neutral' | 'ok' | 'bad';
}) {
  return (
    <div className="bg-card px-6 py-6">
      <Eyebrow>{label}</Eyebrow>
      <p
        data-numeric
        className={`mt-2.5 font-serif text-[1.75rem] leading-none tracking-[-0.015em] ${
          tone === 'bad' ? 'text-disputed' : 'text-ink'
        }`}
      >
        {value}
      </p>
      <p className="mt-2 flex items-center gap-1.5 text-[0.75rem] text-ink-muted">
        {tone === 'ok' && (
          <span className="inline-block size-1.5 rounded-full bg-defended/60" aria-hidden />
        )}
        {detail}
      </p>
    </div>
  );
}
