import type { Arithmetic } from '@fc/contracts';
import { humaniseExpression, operands } from '../lib/arithmetic';
import { cn } from '../lib/utils';

/**
 * A finding's working, shown the way a bill is shown: the sentence, the
 * figures it rests on, and the line it comes to. Never the raw expression —
 * the engine writes that in paise for a hash, not for a person.
 */
export function Equation({
  arithmetic,
  resultLabel,
  className,
}: {
  arithmetic: Arithmetic;
  /** Omitted when the result restates a figure already on screen. */
  resultLabel?: string;
  className?: string;
}) {
  const ops = operands(arithmetic);
  const sentence = humaniseExpression(arithmetic);

  return (
    <div className={cn('rounded-lg border border-border bg-canvas/70 px-3 py-2.5', className)}>
      <p className="text-[12.5px] font-medium leading-[1.4] tracking-[-0.01em] text-text-2 first-letter:uppercase">
        {sentence}
      </p>

      {ops.length > 0 && (
        <dl className="mt-2.5 border-t border-border">
          {ops.map((o) => (
            <div
              key={o.key}
              className="flex items-baseline justify-between gap-4 border-b border-border/60 py-1.5 last:border-b-0"
            >
              <dt className="text-[11.5px] leading-tight text-text-3">{o.label}</dt>
              <dd
                data-numeric={o.money ? '' : undefined}
                className="shrink-0 text-[12px] font-medium tracking-[-0.01em] text-text"
              >
                {o.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {resultLabel && (
        <div className="mt-2 flex items-baseline justify-between gap-4 border-t-2 border-border-strong pt-2">
          <span className="text-[11.5px] font-medium text-text-2">{resultLabel}</span>
          <span data-numeric className="text-[13px] font-semibold tracking-[-0.02em] text-text">
            {arithmetic.result === 0 ? 'nothing' : formatResult(arithmetic.result)}
          </span>
        </div>
      )}
    </div>
  );
}

function formatResult(paise: number): string {
  // The engine's results are magnitudes here; the caller's label carries the sign.
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: Math.abs(paise) % 100 === 0 ? 0 : 2,
  }).format(Math.abs(paise) / 100);
}
