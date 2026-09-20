import React from 'react';
import { Check, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BrightLizardLoader } from './bright-lizard-loader';

export interface StepItem {
  id: string;
  label: string;
  description?: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
}

interface LoadingStateProps {
  title?: string;
  subtitle?: string;
  steps: StepItem[];
  className?: string;
}

export function MultiStepLoadingState({
  title = 'Processing Claim Pack',
  subtitle = 'Deterministic waterfall evaluation in progress',
  steps,
  className,
}: LoadingStateProps) {
  const completedCount = steps.filter((s) => s.status === 'completed').length;
  const progressPercent = Math.round((completedCount / steps.length) * 100);

  return (
    <div className={cn('rounded-md border border-border bg-surface p-5 shadow-xs', className)}>
      <div className="mb-4 flex items-center justify-between border-b border-border/80 pb-3">
        <div>
          <h3 className="text-[14px] font-semibold text-text">{title}</h3>
          <p className="text-[12px] text-text-3">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-brand tabular-nums">{progressPercent}%</span>
          <div className="h-2 w-20 overflow-hidden rounded-full bg-border">
            <div
              className="h-full bg-brand transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {steps.map((step, idx) => {
          const isCompleted = step.status === 'completed';
          const isActive = step.status === 'active';
          const isFailed = step.status === 'failed';

          return (
            <div
              key={step.id}
              className={cn(
                'flex items-start gap-3 rounded-sm p-2 transition-colors',
                isActive ? 'bg-selected/70 border border-brand/20' : 'hover:bg-hover/50',
              )}
            >
              <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
                {isCompleted ? (
                  <span className="flex size-4 items-center justify-center rounded-full bg-brand text-white">
                    <Check className="size-2.5" strokeWidth={3} />
                  </span>
                ) : isActive ? (
                  <BrightLizardLoader size="sm" tone="brand" />
                ) : isFailed ? (
                  <span className="flex size-4 items-center justify-center rounded-full bg-disputed text-white">
                    <AlertCircle className="size-2.5" />
                  </span>
                ) : (
                  <span className="size-2 rounded-full bg-border-strong" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      'text-[12px] font-medium leading-tight',
                      isActive ? 'text-brand' : isCompleted ? 'text-text' : 'text-text-3',
                    )}
                  >
                    {step.label}
                  </span>
                  <span className="font-mono text-[10px] text-text-3">Step {idx + 1}</span>
                </div>
                {step.description && (
                  <p className="mt-0.5 text-[11px] leading-relaxed text-text-3 truncate">
                    {step.description}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
