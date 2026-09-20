import React from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { inr } from '@/lib/format';

export interface WaterfallStepData {
  step: string;
  reconstructed: number;
  insurer: number;
}

interface WaterfallChartProps {
  data?: WaterfallStepData[];
  className?: string;
}

const DEFAULT_DATA: WaterfallStepData[] = [
  { step: 'Gross Bill', reconstructed: 410000, insurer: 410000 },
  { step: 'Non-Med', reconstructed: 380000, insurer: 360000 },
  { step: 'Room Rent', reconstructed: 365000, insurer: 330000 },
  { step: 'Proportionate', reconstructed: 365000, insurer: 275000 },
  { step: 'Consumables', reconstructed: 365000, insurer: 245000 },
  { step: 'Co-pay & Ded.', reconstructed: 328500, insurer: 220500 },
  { step: 'Final Settlement', reconstructed: 328500, insurer: 220500 },
];

export function SettlementWaterfallChart({ data = DEFAULT_DATA, className }: WaterfallChartProps) {
  const chartConfig = {
    reconstructed: {
      label: 'Lawful Reconstructed',
      color: 'hsl(175, 75%, 28%)', // Brand Teal
    },
    insurer: {
      label: 'Insurer Applied',
      color: 'hsl(355, 78%, 41%)', // Disputed Crimson
    },
  };

  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-4 text-[11px] font-medium">
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-xs bg-teal-700" />
            <span className="text-text">Reconstructed Waterfall</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-xs bg-rose-700" />
            <span className="text-text-3">Insurer Actual</span>
          </div>
        </div>
        <span className="font-mono text-[10px] text-text-3">Cumulative Rupees</span>
      </div>

      <ChartContainer config={chartConfig} className="h-[200px] w-full">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="reconstructedGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#0f766e" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#0f766e" stopOpacity={0.0} />
            </linearGradient>
            <linearGradient id="insurerGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#b42318" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#b42318" stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e5eb" />
          <XAxis
            dataKey="step"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tick={{ fontSize: 10, fill: '#6b7280' }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(v) => `₹${Math.round(v / 1000)}k`}
            tick={{ fontSize: 10, fill: '#6b7280' }}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(val) => (
                  <span className="font-mono text-xs font-semibold">{inr(Number(val))}</span>
                )}
              />
            }
          />
          <Area
            type="monotone"
            dataKey="reconstructed"
            stroke="#0f766e"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#reconstructedGrad)"
          />
          <Area
            type="monotone"
            dataKey="insurer"
            stroke="#b42318"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            fillOpacity={1}
            fill="url(#insurerGrad)"
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}
