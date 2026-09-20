import React from 'react';
import { cn } from '@/lib/utils';

interface ProgressBarProps {
  value: number; // 0 to 100
  max?: number;
  label?: string;
  showValue?: boolean;
  tone?: 'brand' | 'disputed' | 'unresolved' | 'neutral';
  size?: 'sm' | 'md' | 'lg';
  animated?: boolean;
  /**
   * For work of unknown duration — an upload in flight, a step we have no
   * byte count for. The bar fills the track and sheens, instead of showing a
   * percentage we would have had to invent.
   */
  indeterminate?: boolean;
  className?: string;
}

export function ProgressBar({
  value,
  max = 100,
  label,
  showValue = false,
  tone = 'brand',
  size = 'md',
  animated = true,
  indeterminate = false,
  className,
}: ProgressBarProps) {
  const percentage = indeterminate ? 100 : Math.min(100, Math.max(0, Math.round((value / max) * 100)));

  const toneColors = {
    brand: 'bg-brand',
    disputed: 'bg-disputed',
    unresolved: 'bg-unresolved',
    neutral: 'bg-defended',
  };

  const heights = {
    sm: 'h-1.5',
    md: 'h-2.5',
    lg: 'h-4',
  };

  return (
    <div className={cn('w-full space-y-1.5', className)}>
      {(label || showValue) && (
        <div className="flex items-center justify-between text-[11px] font-mono">
          {label && <span className="text-text-2 font-medium">{label}</span>}
          {showValue && !indeterminate && (
            <span className="text-text-3 tabular-nums">{percentage}%</span>
          )}
        </div>
      )}

      <div
        className={cn(
          'relative w-full overflow-hidden rounded-full bg-border/60 p-[1px]',
          heights[size],
        )}
      >
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500 ease-out',
            toneColors[tone],
            animated && 'relative overflow-hidden',
          )}
          style={{ width: `${percentage}%` }}
        >
          {animated && (
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent animate-[shimmer_1.5s_infinite] [background-size:200%_100%]" />
          )}
        </div>
      </div>
    </div>
  );
}
