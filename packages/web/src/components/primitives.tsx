import type { Bucket } from '@fc/contracts';
import { Check, Copy, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '../lib/utils';

/**
 * The workspace's component vocabulary.
 *
 * It borrows the landing page's *feel* — Geist set tight, paper and ink, one
 * teal accent, hairlines instead of shadows — and none of its scale. This is
 * an application: figures are read, not admired, so nothing here is set
 * larger than it needs to be to be legible at a glance.
 */

/* ---- Buttons ------------------------------------------------------ */

export type PillVariant = 'ink' | 'paper' | 'ghost' | 'brand' | 'danger' | 'outline';
export type PillSize = 'sm' | 'md' | 'lg';

const PILL_VARIANT: Record<PillVariant, string> = {
  ink: 'bg-ink text-paper hover:bg-ink-2',
  paper: 'bg-[#ebebe6] text-ink hover:bg-[#e2e2dc]',
  ghost: 'bg-transparent text-text-2 hover:bg-hover hover:text-text',
  brand: 'bg-brand text-white hover:bg-brand/90',
  danger: 'bg-disputed text-white hover:bg-disputed/90',
  outline: 'border border-border bg-surface text-text-2 hover:border-border-strong hover:text-text',
};

const PILL_SIZE: Record<PillSize, string> = {
  sm: 'h-7 px-2.5 text-[12px] gap-1.5 [&_svg]:size-3.5',
  md: 'h-8 px-3 text-[12.5px] gap-1.5 [&_svg]:size-3.5',
  lg: 'h-9 px-4 text-[13px] gap-2 [&_svg]:size-4',
};

export function pillClass(variant: PillVariant = 'ink', size: PillSize = 'md', className?: string) {
  return cn(
    'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-lg font-medium tracking-[-0.01em] transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
    PILL_VARIANT[variant],
    PILL_SIZE[size],
    className,
  );
}

export function PillButton({
  variant = 'ink',
  size = 'md',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: PillVariant; size?: PillSize }) {
  return <button type="button" className={pillClass(variant, size, className)} {...props} />;
}

export function PillLink({
  variant = 'ink',
  size = 'md',
  className,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: PillVariant; size?: PillSize }) {
  return <a className={pillClass(variant, size, className)} {...props} />;
}

/* ---- Marks -------------------------------------------------------- */

/** The landing page's teal square, kept small, for a mark or a bullet. */
export function Square({ className = '', size = 10 }: { className?: string; size?: number }) {
  return <span aria-hidden className={cn('block bg-brand', className)} style={{ width: size, height: size }} />;
}

/** `● LABEL` — the small-caps label that sits above a group. */
export function Eyebrow({
  children,
  accent = true,
  className,
}: {
  children: ReactNode;
  accent?: boolean;
  className?: string;
}) {
  return (
    <p
      className={cn(
        'flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-text-3',
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', accent ? 'bg-brand' : 'bg-current')} />
      {children}
    </p>
  );
}

/* ---- Buckets ------------------------------------------------------ */

export const BUCKET_META: Record<Bucket, { label: string; className: string; dot: string; bar: string }> = {
  CORRECTLY_APPLIED: {
    label: 'Lawful',
    className: 'bg-defended-soft text-defended',
    dot: 'bg-defended',
    bar: 'bg-[#374151]',
  },
  INCORRECTLY_APPLIED: {
    label: 'Disputed',
    className: 'bg-disputed-soft text-disputed',
    dot: 'bg-disputed',
    bar: 'bg-[#b42318]',
  },
  UNRESOLVED: {
    label: 'Unresolved',
    className: 'bg-unresolved-soft text-unresolved',
    dot: 'bg-unresolved',
    bar: 'bg-[#a16207]',
  },
};

export function Badge({ bucket, className }: { bucket: Bucket; className?: string }) {
  const m = BUCKET_META[bucket];
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[11px] font-medium tracking-[-0.01em]',
        m.className,
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', m.dot)} />
      {m.label}
    </span>
  );
}

/** A status chip for anything that is not a bucket. */
export function Chip({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: 'neutral' | 'brand' | 'disputed' | 'unresolved' | 'ink' | 'quiet';
  className?: string;
  children: ReactNode;
}) {
  const tones = {
    neutral: 'bg-defended-soft text-defended',
    brand: 'bg-brand-soft text-brand',
    disputed: 'bg-disputed-soft text-disputed',
    unresolved: 'bg-unresolved-soft text-unresolved',
    ink: 'bg-ink text-paper',
    quiet: 'border border-border bg-surface text-text-2',
  };
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[11px] font-medium tracking-[-0.01em]',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ---- Money -------------------------------------------------------- */

export function Money({
  value,
  className,
  tone,
}: {
  value: string;
  className?: string;
  tone?: 'default' | 'disputed' | 'accent' | 'muted' | 'lawful';
}) {
  return (
    <span
      data-numeric
      className={cn(
        'font-medium tracking-[-0.02em]',
        tone === 'disputed' && 'text-disputed',
        tone === 'accent' && 'text-brand',
        tone === 'muted' && 'text-text-3',
        tone === 'lawful' && 'text-defended',
        className,
      )}
    >
      {value}
    </span>
  );
}

/* ---- Surfaces ----------------------------------------------------- */

export const CARD = 'rounded-xl border border-border bg-surface';

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn(CARD, className)}>{children}</div>;
}

/**
 * One figure with its name above it. The emphasised variant is for the single
 * number a screen is actually about; everything else stays quiet so that one
 * can be found without reading.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
  className,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: 'default' | 'accent' | 'disputed';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-xl border px-3.5 py-3',
        tone === 'accent'
          ? 'border-brand/25 bg-brand-soft'
          : tone === 'disputed'
            ? 'border-disputed/20 bg-disputed-soft'
            : 'border-border bg-surface',
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        {Icon && (
          <Icon
            className={cn('size-3.5 shrink-0', tone === 'accent' ? 'text-brand' : 'text-text-3')}
            strokeWidth={1.75}
          />
        )}
        <span className="truncate text-[11px] font-medium text-text-3">{label}</span>
      </div>
      <Money
        value={value}
        tone={tone === 'accent' ? 'accent' : tone === 'disputed' ? 'disputed' : 'default'}
        className="mt-1.5 block text-[21px] leading-none tracking-[-0.035em]"
      />
      {hint && <div className="mt-1.5 text-[11px] leading-snug text-text-3">{hint}</div>}
    </div>
  );
}

export function Panel({
  title,
  subtitle,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn('flex min-h-0 flex-col overflow-hidden', CARD, className)}>
      {(title || action) && (
        <header className="flex min-h-[44px] shrink-0 items-center justify-between gap-3 border-b border-border px-3.5 py-2">
          <div className="min-w-0">
            <div className="truncate text-[12.5px] font-semibold tracking-[-0.02em] text-text">{title}</div>
            {subtitle && <div className="truncate text-[11px] text-text-3">{subtitle}</div>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
        </header>
      )}
      <div className={cn('scroll-quiet min-h-0 flex-1 overflow-auto', bodyClassName)}>{children}</div>
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
      aria-pressed={active}
      className={cn(
        'inline-flex h-6.5 items-center gap-1.5 rounded-md px-2 text-[11.5px] font-medium tracking-[-0.01em] transition-colors',
        active ? 'bg-ink text-paper' : 'text-text-2 hover:bg-hover hover:text-text',
      )}
    >
      {children}
      {count !== undefined && (
        <span className={cn('tabular-nums', active ? 'text-paper/55' : 'text-text-3')}>{count}</span>
      )}
    </button>
  );
}

/** Inline error, the one shape for every screen. */
export function ErrorNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      role="alert"
      className={cn(
        'rounded-lg border border-disputed/20 bg-disputed-soft px-3 py-2 text-[12.5px] font-medium text-disputed',
        className,
      )}
    >
      {children}
    </p>
  );
}

/** A page's content width and padding, under the app header. */
export function Page({
  className,
  wide = false,
  children,
}: {
  className?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn('mx-auto w-full px-4 py-5 sm:px-6', wide ? 'max-w-[1400px]' : 'max-w-[840px]', className)}>
      {children}
    </div>
  );
}

/* ---- Composition -------------------------------------------------- */

/** Where the money went, as one bar. No axis, no legend of its own. */
export function SplitBar({
  parts,
  className,
  height = 6,
}: {
  parts: readonly { bucket: Bucket; value: number }[];
  className?: string;
  height?: number;
}) {
  const total = parts.reduce((sum, p) => sum + Math.abs(p.value), 0);
  if (total === 0) return null;
  return (
    <div className={cn('flex w-full overflow-hidden rounded-full bg-border', className)} style={{ height }}>
      {parts
        .filter((p) => p.value !== 0)
        .map((p) => (
          <span
            key={p.bucket}
            className={BUCKET_META[p.bucket].bar}
            style={{ width: `${(Math.abs(p.value) / total) * 100}%` }}
          />
        ))}
    </div>
  );
}

/**
 * A hash, shown the way a person uses one: the ends, and a click to copy the
 * whole thing. Sixty-four hex characters on screen help nobody; that the
 * hash exists, and can be taken away and checked, is the entire point.
 */
export function Fingerprint({
  value,
  label,
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const hex = value.replace(/^sha256:/, '');
  const short = hex.length > 14 ? `${hex.slice(0, 6)}···${hex.slice(-4)}` : hex;

  return (
    <button
      type="button"
      title={value}
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }}
      className={cn(
        'group inline-flex h-6.5 items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-[11px] font-medium text-text-2 transition-colors hover:border-border-strong hover:text-text',
        className,
      )}
    >
      {label && <span className="text-text-3">{label}</span>}
      <span className="font-mono tabular-nums">{short}</span>
      {copied ? (
        <Check className="size-3 text-brand" strokeWidth={3} />
      ) : (
        <Copy className="size-3 opacity-0 transition-opacity group-hover:opacity-50" />
      )}
    </button>
  );
}
