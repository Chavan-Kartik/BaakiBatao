import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

/**
 * The bar at the top of every screen: what you are looking at on the left,
 * what you can do about it on the right. Sticky, one line tall, and quiet —
 * it is a label, not a landing.
 */
export function AppHeader({
  title,
  subtitle,
  chips,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  chips?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'sticky top-0 z-20 flex min-h-[52px] shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border bg-canvas/85 px-4 py-2.5 backdrop-blur-md sm:px-6',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="min-w-0">
          <h1 className="truncate text-[14.5px] font-semibold leading-tight tracking-[-0.03em] text-text">
            {title}
          </h1>
          {subtitle && <p className="truncate text-[11.5px] leading-tight text-text-3">{subtitle}</p>}
        </div>
        {chips && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{chips}</div>}
      </div>

      {actions && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>}
    </header>
  );
}
