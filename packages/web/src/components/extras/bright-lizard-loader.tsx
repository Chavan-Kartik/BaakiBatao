import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Bright Lizard glowing orbital pulse loader.
 * Inspired by dexter-st on UIverse, adapted to BaakiBatao's
 * brand palette (brand teal #0f766e, amber #a16207, and crimson #b42318).
 */
export function BrightLizardLoader({
  size = 'md',
  tone = 'brand',
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  tone?: 'brand' | 'disputed' | 'unresolved';
  className?: string;
}) {
  const sizeMap = {
    sm: 'size-6',
    md: 'size-10',
    lg: 'size-16',
  };

  const ringMap = {
    sm: 'border-2',
    md: 'border-[2.5px]',
    lg: 'border-3',
  };

  const glowColors = {
    brand: 'shadow-[0_0_25px_rgba(15,118,110,0.55)] border-teal-500/80',
    disputed: 'shadow-[0_0_25px_rgba(180,35,24,0.55)] border-rose-500/80',
    unresolved: 'shadow-[0_0_25px_rgba(161,98,7,0.55)] border-amber-500/80',
  };

  const coreColors = {
    brand: 'bg-teal-500 shadow-[0_0_12px_#14b8a6]',
    disputed: 'bg-rose-500 shadow-[0_0_12px_#f43f5e]',
    unresolved: 'bg-amber-500 shadow-[0_0_12px_#f59e0b]',
  };

  return (
    <div className={cn('relative flex items-center justify-center', sizeMap[size], className)}>
      {/* Outer pulsing atmospheric glow */}
      <span
        className={cn(
          'absolute inset-0 rounded-full animate-ping opacity-35',
          coreColors[tone],
        )}
      />

      {/* Rotating gradient ring */}
      <span
        className={cn(
          'absolute inset-0 rounded-full border-t-transparent border-b-transparent animate-spin duration-1000',
          ringMap[size],
          glowColors[tone],
        )}
      />

      {/* Counter-rotating dashed radar ring */}
      <span
        className={cn(
          'absolute inset-1 rounded-full border border-dashed border-white/60 animate-spin duration-3000 direction-reverse',
        )}
      />

      {/* Inner illuminated nucleus */}
      <span
        className={cn(
          'relative rounded-full transition-transform duration-300',
          size === 'sm' ? 'size-2' : size === 'md' ? 'size-3.5' : 'size-5',
          coreColors[tone],
        )}
      />
    </div>
  );
}
