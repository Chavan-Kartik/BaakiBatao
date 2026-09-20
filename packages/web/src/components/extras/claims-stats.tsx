import React from 'react';
import { ArrowUpRight, CheckCircle2, ShieldAlert } from 'lucide-react';
import { inr } from '@/lib/format';
import { cn } from '@/lib/utils';

interface StatItemProps {
  label: string;
  value: string;
  subtext: string;
  change?: string;
  trend?: 'up' | 'down' | 'neutral';
  tone?: 'brand' | 'disputed' | 'unresolved' | 'neutral';
}

export function ClaimsSummaryStats({
  totalCases = 14,
  disputedAmount = 185420,
  recoveredAmount = 142300,
  invariantRate = 100,
}: {
  totalCases?: number;
  disputedAmount?: number;
  recoveredAmount?: number;
  invariantRate?: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6">
      <StatCard
        label="Cases Analyzed"
        value={`${totalCases}`}
        subtext="Health claim packs"
        change="+3 this week"
        trend="up"
        tone="neutral"
      />
      <StatCard
        label="Unlawful Deductions"
        value={inr(disputedAmount)}
        subtext="Against IRDAI circular"
        change="13.9% of claimed"
        trend="down"
        tone="disputed"
      />
      <StatCard
        label="Defensible Recovery"
        value={inr(recoveredAmount)}
        subtext="Challengeable with cited clauses"
        change="76.7% recovery potential"
        trend="up"
        tone="brand"
      />
      <StatCard
        label="Mathematical Integrity"
        value={`${invariantRate}%`}
        subtext="Zero rounding residual"
        change="PINNED SHA-256"
        trend="neutral"
        tone="brand"
      />
    </div>
  );
}

function StatCard({ label, value, subtext, change, trend, tone = 'neutral' }: StatItemProps) {
  const toneMap = {
    brand: 'text-brand border-brand/20 bg-brand-soft/30',
    disputed: 'text-disputed border-disputed/20 bg-disputed-soft/40',
    unresolved: 'text-unresolved border-unresolved/20 bg-unresolved-soft/40',
    neutral: 'text-text border-border bg-surface',
  };

  const badgeColors = {
    brand: 'bg-brand-soft text-brand',
    disputed: 'bg-disputed-soft text-disputed',
    unresolved: 'bg-unresolved-soft text-unresolved',
    neutral: 'bg-canvas text-text-3',
  };

  return (
    <div className={cn('rounded-md border p-3.5 shadow-2xs transition-all hover:shadow-xs', toneMap[tone])}>
      <div className="flex items-center justify-between text-[11px] text-text-3 font-medium">
        <span>{label}</span>
        {trend === 'up' ? (
          <ArrowUpRight className="size-3 text-brand" />
        ) : trend === 'down' ? (
          <ShieldAlert className="size-3 text-disputed" />
        ) : (
          <CheckCircle2 className="size-3 text-brand" />
        )}
      </div>

      <div className="mt-1.5 font-mono text-[18px] font-semibold tracking-tight text-text tabular-nums">
        {value}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1 text-[10px]">
        <span className="text-text-3 truncate max-w-[120px]">{subtext}</span>
        {change && (
          <span className={cn('rounded-xs px-1 py-0.2 font-mono font-medium', badgeColors[tone])}>
            {change}
          </span>
        )}
      </div>
    </div>
  );
}
