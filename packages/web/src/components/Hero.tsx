import type { CaseView } from '../lib/case';
import { inr, rupeesOnly } from '../lib/format';
import { Eyebrow, Shell } from './ui';

export function Hero({ view }: { view: CaseView }) {
  return (
    <Shell>
      <section className="border-b border-rule py-16 md:py-24">
        <Eyebrow>Case {view.result.caseId}</Eyebrow>

        <h1 className="mt-5 max-w-[24ch] font-serif text-[2.5rem] leading-[1.06] tracking-[-0.02em] text-ink md:text-[3.75rem]">
          The insurer withheld{' '}
          <span className="text-disputed">₹{rupeesOnly(view.shortfall)}</span> it was not entitled
          to keep.
        </h1>

        <p className="mt-7 max-w-[62ch] text-[1.0625rem] leading-relaxed text-ink-soft">
          A seven-day admission. The patient took a room above eligibility, so a proportionate
          deduction was lawfully triggered — and the insurer then applied it to the{' '}
          <em className="font-serif not-italic">entire bill</em>, including the implant, the
          medicines, the diagnostics and the ICU. A 2020 IRDAI circular says it may not. This page
          reconstructs the settlement line by line and shows exactly where their arithmetic and the
          policy part company.
        </p>

        <dl className="mt-12 grid grid-cols-2 gap-x-8 gap-y-8 sm:grid-cols-4">
          <Stat label="Bill claimed" value={inr(view.billTotal)} />
          <Stat
            label="Payable, reconstructed"
            value={inr(view.expectedPayable)}
            note="computed from the policy, not from their letter"
          />
          <Stat label="Insurer paid" value={inr(view.actualPaid)} />
          <Stat
            label="Shortfall"
            value={inr(view.shortfall)}
            tone="disputed"
            note="every rupee of it accounted for below"
          />
        </dl>
      </section>
    </Shell>
  );
}

function Stat({
  label,
  value,
  note,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  note?: string;
  tone?: 'neutral' | 'disputed';
}) {
  return (
    <div>
      <Eyebrow>{label}</Eyebrow>
      <p
        data-numeric
        className={`mt-2.5 font-serif text-[1.75rem] leading-none tracking-[-0.015em] ${
          tone === 'disputed' ? 'text-disputed' : 'text-ink'
        }`}
      >
        {value}
      </p>
      {note && <p className="mt-2 text-[0.75rem] leading-snug text-ink-muted">{note}</p>}
    </div>
  );
}
