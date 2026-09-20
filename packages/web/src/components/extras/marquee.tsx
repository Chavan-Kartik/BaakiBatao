import React from 'react';
import { cn } from '@/lib/utils';

interface MarqueeProps {
  children: React.ReactNode;
  direction?: 'left' | 'right';
  speed?: number;
  pauseOnHover?: boolean;
  className?: string;
}

export function Marquee({
  children,
  direction = 'left',
  speed = 40,
  pauseOnHover = true,
  className,
}: MarqueeProps) {
  return (
    <div
      className={cn(
        'group flex overflow-hidden select-none [mask-image:linear-gradient(to_right,transparent_0%,black_10%,black_90%,transparent_100%)]',
        className,
      )}
    >
      <div
        className={cn(
          'flex shrink-0 gap-6 items-center py-2 animate-marquee',
          pauseOnHover && 'group-hover:[animation-play-state:paused]',
          direction === 'right' && 'direction-reverse',
        )}
        style={{ animationDuration: `${speed}s` }}
      >
        {children}
      </div>
      <div
        aria-hidden="true"
        className={cn(
          'flex shrink-0 gap-6 items-center py-2 animate-marquee',
          pauseOnHover && 'group-hover:[animation-play-state:paused]',
          direction === 'right' && 'direction-reverse',
        )}
        style={{ animationDuration: `${speed}s` }}
      >
        {children}
      </div>
    </div>
  );
}

export function RegulatoryMarquee() {
  return (
    <Marquee speed={35} className="border-y border-border bg-surface/70 text-[11px] text-text-3 font-mono">
      <span className="flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-brand animate-pulse" />
        IRDAI circular 151/06/2020: Proportionate deduction restricted strictly to associated medical expenses
      </span>
      <span>·</span>
      <span className="flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-disputed" />
        FY2024-25 Insurers disallowed ₹18,521 crore (13.98% of claimed amount)
      </span>
      <span>·</span>
      <span className="flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-brand" />
        Zero Discretion: Deterministic 7-step waterfall settlement engine
      </span>
      <span>·</span>
      <span className="flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-defended" />
        Cryptographic KMS Hash Pinning: Invariant holds on every rupee
      </span>
    </Marquee>
  );
}
