import type { CaseView } from '../lib/case';
import { inr } from '../lib/format';
import { Card, Eyebrow, SectionHeading, Shell } from './ui';

/**
 * The three buckets, then the number we would actually put in a letter.
 *
 * The gross unlawful deduction and the recoverable amount differ, and the
 * difference is the point: restoring an unlawful cut also restores the lawful
 * co-pay that rides on it. A tool that asked for the gross figure would be
 * making a claim the insurer could correctly refuse.
 */
export function Verdict({ view }: { view: CaseView }) {
  return (
    <Shell>
      <section className="border-b border-rule py-16 md:py-20">
        <SectionHeading
          eyebrow="The ledger"
          title="Every rupee withheld lands in one of three buckets."
          lede="A blanket classifier tells you a deduction looks wrong. A reconstruction tells you which
            deductions were the insurer's right, which broke a clause, and which they never explained
            — and it has to account for all of it, because the arithmetic is checked."
        />

        <div className="grid gap-4 md:grid-cols-3">
          <BucketCard
            label="Lawfully applied"
            amount={inr(view.defendedTotal)}
            tone="defended"
            body="Deductions the policy entitled them to make: the room above the per-day cap, the
              administrative charges under Annexure II, the deductible, the co-pay, and the
              proportionate deduction on the professional fees it may lawfully touch. We defend
              these, because a request that disputes them loses credibility on the rest."
          />
          <BucketCard
            label="Applied in breach of a clause"
            amount={inr(view.disputedGross)}
            tone="disputed"
            body="Proportionate deduction charged against the implant, the medicines, the consumables,
              the diagnostics and the ICU. Each is exempt under a named clause, and each dispute is
              pinned to the bill line it was taken from."
          />
          <BucketCard
            label="Withheld without a reason"
            amount={inr(view.unexplained)}
            tone="unresolved"
            body={`An "Other Deductions" line on their own sheet with no clause and no explanation. We
              do not assert a rule about it and we do not quietly absorb it — we name it and ask them
              to account for it.`}
          />
        </div>

        {/* The honest arithmetic, shown rather than asserted. */}
        <Card className="mt-6 overflow-hidden">
          <div className="border-b border-rule px-6 py-4">
            <Eyebrow>What we would actually ask for</Eyebrow>
          </div>

          <dl className="divide-y divide-rule-soft">
            <CalcRow
              label="Deducted in breach of a clause"
              detail="gross, before the co-pay that rides on it"
              value={inr(view.disputedGross)}
            />
            {view.copayPercent !== null && (
              <CalcRow
                label={`Less the co-pay that lawfully applies at ${view.copayPercent}%`}
                detail="restoring the deduction restores the co-pay on it too"
                value={`− ${inr(view.copayOnRestored)}`}
              />
            )}
            <CalcRow
              label="Recoverable, with a clause quoted for every rupee"
              detail="this is the figure the reconsideration request claims"
              value={inr(view.recoverable)}
              emphasis
            />
            <CalcRow
              label="Queried separately, not claimed"
              detail="the unexplained deduction — we ask them to justify it"
              value={inr(view.unexplained)}
            />
            <CalcRow
              label="Total shortfall against the reconstructed payable"
              detail="what the policyholder is out of pocket"
              value={inr(view.shortfall)}
            />
          </dl>
        </Card>
      </section>
    </Shell>
  );
}

function BucketCard({
  label,
  amount,
  body,
  tone,
}: {
  label: string;
  amount: string;
  body: string;
  tone: 'defended' | 'disputed' | 'unresolved';
}) {
  const accent = {
    defended: 'text-defended',
    disputed: 'text-disputed',
    unresolved: 'text-unresolved',
  }[tone];

  const rail = {
    defended: 'bg-defended/35',
    disputed: 'bg-disputed',
    unresolved: 'bg-unresolved',
  }[tone];

  return (
    <Card className="relative overflow-hidden p-6">
      <span className={`absolute inset-y-0 left-0 w-[3px] ${rail}`} aria-hidden />
      <Eyebrow>{label}</Eyebrow>
      <p
        data-numeric
        className={`mt-3 font-serif text-[2.25rem] leading-none tracking-[-0.015em] ${accent}`}
      >
        {amount}
      </p>
      <p className="mt-4 text-[0.8125rem] leading-relaxed text-ink-muted">{body}</p>
    </Card>
  );
}

function CalcRow({
  label,
  detail,
  value,
  emphasis = false,
}: {
  label: string;
  detail: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-6 px-6 py-4 ${
        emphasis ? 'bg-rule-soft/60' : ''
      }`}
    >
      <div className="min-w-0">
        <dt className={`text-[0.875rem] ${emphasis ? 'font-medium text-ink' : 'text-ink-soft'}`}>
          {label}
        </dt>
        <p className="mt-1 text-[0.75rem] leading-snug text-ink-faint">{detail}</p>
      </div>
      <dd
        data-numeric
        className={`shrink-0 font-serif tracking-[-0.01em] ${
          emphasis ? 'text-[1.5rem] text-ink' : 'text-[1.125rem] text-ink-soft'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
