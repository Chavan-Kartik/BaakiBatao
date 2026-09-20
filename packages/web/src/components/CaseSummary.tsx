import { Banknote, Receipt, TrendingDown, Wallet } from 'lucide-react';
import type { CaseView } from '../lib/case';
import { inr } from '../lib/format';
import { cn } from '../lib/utils';
import { BUCKET_META, Card, Money, SplitBar, StatCard } from './primitives';

/**
 * The four figures a case comes down to, and one bar that shows how the gap
 * between two of them splits. Everything below this on the screen is the
 * working for these numbers.
 */
export function CaseSummary({ view }: { view: CaseView }) {
  const withheld = view.billTotal - view.actualPaid;

  const split = [
    {
      bucket: 'INCORRECTLY_APPLIED' as const,
      value: view.disputedGross,
      note: 'withheld with no clause behind it',
    },
    { bucket: 'CORRECTLY_APPLIED' as const, value: view.defendedTotal, note: 'the policy allows it' },
    { bucket: 'UNRESOLVED' as const, value: view.unexplained, note: 'no reason we can check' },
  ];

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.72fr)]">
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Recoverable"
          value={inr(view.recoverable)}
          tone="accent"
          icon={Wallet}
          hint={
            view.copayPercent === null
              ? 'Every rupee has a clause behind it'
              : `Net of the ${view.copayPercent}% co-pay that rides on it`
          }
        />
        <StatCard label="Hospital billed" value={inr(view.billTotal)} icon={Receipt} />
        <StatCard label="Insurer paid" value={inr(view.actualPaid)} icon={Banknote} />
        <StatCard
          label="Short by"
          value={inr(view.shortfall)}
          tone="disputed"
          icon={TrendingDown}
          hint={`Against ${inr(view.expectedPayable)} the policy owed`}
        />
      </div>

      <Card className="flex flex-col justify-between p-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[11px] font-medium text-text-3">Withheld by the insurer</span>
          <Money value={inr(withheld)} className="text-[13px]" />
        </div>

        <SplitBar parts={split} className="mt-2.5" height={7} />

        <ul className="mt-3 space-y-1.5">
          {split.map((s) => (
            <li key={s.bucket} className="flex items-baseline gap-2">
              <span className={cn('size-1.5 shrink-0 translate-y-[3px] rounded-full', BUCKET_META[s.bucket].dot)} />
              <span className="text-[12px] font-medium text-text">{BUCKET_META[s.bucket].label}</span>
              <span className="truncate text-[11px] text-text-3">{s.note}</span>
              <Money value={inr(s.value)} className="ml-auto shrink-0 text-[12px]" />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
