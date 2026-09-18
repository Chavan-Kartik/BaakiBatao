import type { Bucket } from '@fc/contracts';
import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

export function Badge({
  bucket,
  className,
}: {
  bucket: Bucket;
  className?: string;
}) {
  const map = {
    CORRECTLY_APPLIED: {
      label: 'Lawful',
      className: 'bg-defended-soft text-defended',
    },
    INCORRECTLY_APPLIED: {
      label: 'Disputed',
      className: 'bg-disputed-soft text-disputed',
    },
    UNRESOLVED: {
      label: 'Unexplained',
      className: 'bg-unresolved-soft text-unresolved',
    },
  }[bucket];

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm px-1.5 py-0.5 text-[11px] font-medium',
        map.className,
        className,
      )}
    >
      {map.label}
    </span>
  );
}

export function Money({
  value,
  className,
  tone,
}: {
  value: string;
  className?: string;
  tone?: 'default' | 'disputed' | 'accent' | 'muted';
}) {
  return (
    <span
      data-numeric
      className={cn(
        'font-medium tracking-tight',
        tone === 'disputed' && 'text-disputed',
        tone === 'accent' && 'text-accent',
        tone === 'muted' && 'text-text-3',
        className,
      )}
    >
      {value}
    </span>
  );
}

export function Panel({
  title,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-surface',
        className,
      )}
    >
      {(title || action) && (
        <header className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border px-3">
          <div className="text-[13px] font-medium text-text">{title}</div>
          {action}
        </header>
      )}
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}

export function FilterChip({
  active,
  count,
  children,
  onClick,
}: {
  active: boolean;
  count?: number;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-sm border px-2 text-[12px] transition-colors',
        active
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-border bg-surface text-text-2 hover:bg-hover',
      )}
    >
      {children}
      {count !== undefined && (
        <span className={cn('font-mono text-[11px]', active ? 'text-accent' : 'text-text-3')}>
          {count}
        </span>
      )}
    </button>
  );
}
