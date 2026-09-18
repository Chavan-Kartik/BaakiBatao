import type { ReactNode } from 'react';
import type { Bucket } from '@fc/contracts';
import { cn } from '../lib/utils';

export function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[1080px] px-6 md:px-10">{children}</div>;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        'font-mono text-[11px] font-medium uppercase tracking-[0.13em] text-ink-faint',
        className,
      )}
    >
      {children}
    </p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lede,
}: {
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
}) {
  return (
    <header className="mb-10">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-3 font-serif text-[1.75rem] leading-[1.15] tracking-[-0.01em] text-ink md:text-[2.125rem]">
        {title}
      </h2>
      {lede && (
        <p className="mt-4 max-w-[64ch] text-[0.9375rem] leading-relaxed text-ink-soft">{lede}</p>
      )}
    </header>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-card border border-rule bg-card', className)}>{children}</div>
  );
}

const BUCKET_STYLE: Record<Bucket, { label: string; className: string }> = {
  CORRECTLY_APPLIED: {
    label: 'Lawful',
    className: 'bg-defended-soft text-defended border-defended/15',
  },
  INCORRECTLY_APPLIED: {
    label: 'Disputed',
    className: 'bg-disputed-soft text-disputed border-disputed/20',
  },
  UNRESOLVED: {
    label: 'Unexplained',
    className: 'bg-unresolved-soft text-unresolved border-unresolved/20',
  },
};

export function BucketBadge({ bucket, className }: { bucket: Bucket; className?: string }) {
  const style = BUCKET_STYLE[bucket];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-2 py-[0.1875rem] font-mono text-[10px] font-medium uppercase tracking-[0.08em]',
        style.className,
        className,
      )}
    >
      {style.label}
    </span>
  );
}

/** A clause ID rendered so it reads as a citation rather than a variable name. */
export function ClauseChip({ id, className }: { id: string; className?: string }) {
  return (
    <code
      className={cn(
        'rounded border border-rule bg-rule-soft px-1.5 py-0.5 font-mono text-[11px] text-ink-soft',
        className,
      )}
    >
      {id}
    </code>
  );
}

export function Figure({
  label,
  value,
  note,
  tone = 'neutral',
  className,
}: {
  label: string;
  value: string;
  note?: ReactNode;
  tone?: 'neutral' | 'disputed' | 'defended' | 'unresolved';
  className?: string;
}) {
  const toneClass = {
    neutral: 'text-ink',
    disputed: 'text-disputed',
    defended: 'text-defended',
    unresolved: 'text-unresolved',
  }[tone];

  return (
    <div className={cn('flex flex-col', className)}>
      <Eyebrow>{label}</Eyebrow>
      <p
        data-numeric
        className={cn('mt-2 font-serif text-[2rem] leading-none tracking-[-0.015em]', toneClass)}
      >
        {value}
      </p>
      {note && <p className="mt-2.5 text-[0.8125rem] leading-snug text-ink-muted">{note}</p>}
    </div>
  );
}
