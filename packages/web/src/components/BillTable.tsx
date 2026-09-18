import type { Bucket } from '@fc/contracts';
import type { CaseView, LedgerRow } from '../lib/case';
import { inr } from '../lib/format';
import { CATEGORY_LABEL } from '../lib/labels';
import { cn } from '../lib/utils';
import { Badge, FilterChip, Money, Panel } from './ui';

export type LineFilter = 'all' | Bucket;

export function BillTable({
  view,
  selectedIndex,
  filter,
  onSelect,
  onFilter,
}: {
  view: CaseView;
  selectedIndex: number | null;
  filter: LineFilter;
  onSelect: (index: number) => void;
  onFilter: (filter: LineFilter) => void;
}) {
  const disputedCount = view.rows.filter((r) => r.disputed > 0).length;
  const lawfulCount = view.rows.filter((r) => r.defended > 0 && r.disputed === 0).length;

  const rows = view.rows.filter((row) => {
    if (filter === 'all') return true;
    if (filter === 'INCORRECTLY_APPLIED') return row.disputed > 0;
    if (filter === 'CORRECTLY_APPLIED') return row.defended > 0;
    return row.findings.some((f) => f.bucket === 'UNRESOLVED');
  });

  return (
    <Panel
      title="Bill lines"
      action={
        <div className="flex items-center gap-1.5">
          <FilterChip active={filter === 'all'} count={view.rows.length} onClick={() => onFilter('all')}>
            All
          </FilterChip>
          <FilterChip
            active={filter === 'INCORRECTLY_APPLIED'}
            count={disputedCount}
            onClick={() => onFilter('INCORRECTLY_APPLIED')}
          >
            Disputed
          </FilterChip>
          <FilterChip
            active={filter === 'CORRECTLY_APPLIED'}
            count={lawfulCount}
            onClick={() => onFilter('CORRECTLY_APPLIED')}
          >
            Lawful
          </FilterChip>
        </div>
      }
      className="min-h-0"
    >
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-10 bg-surface">
          <tr className="border-b border-border text-left text-[11px] text-text-3">
            <th className="px-3 py-2 font-medium">Line</th>
            <th className="px-3 py-2 text-right font-medium">Claimed</th>
            <th className="px-3 py-2 text-right font-medium">Paid</th>
            <th className="px-3 py-2 text-right font-medium">Cut</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <LineRow
              key={row.index}
              row={row}
              selected={selectedIndex === row.index}
              onSelect={() => onSelect(row.index)}
            />
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-8 text-center text-text-3">
                No lines in this filter
              </td>
            </tr>
          )}
          <tr
            onClick={() => onSelect(-1)}
            className={cn(
              'cursor-pointer border-t border-border bg-canvas/80',
              selectedIndex === -1 ? 'bg-selected' : 'hover:bg-hover',
            )}
          >
            <td className="px-3 py-2.5" colSpan={4}>
              <div className="font-medium text-text">Claim-level deductions</div>
              <div className="mt-0.5 text-[11px] text-text-3">
                Deductible, co-pay, unexplained residual
              </div>
            </td>
            <td className="px-3 py-2.5">
              <div className="flex flex-wrap gap-1">
                {[...new Set(view.claimLevel.map((f) => f.bucket))].map((b) => (
                  <Badge key={b} bucket={b} />
                ))}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </Panel>
  );
}

function LineRow({
  row,
  selected,
  onSelect,
}: {
  row: LedgerRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const buckets = [...new Set(row.findings.map((f) => f.bucket))];

  return (
    <tr
      onClick={onSelect}
      className={cn(
        'cursor-pointer border-b border-border/70 transition-colors',
        selected ? 'bg-selected' : 'hover:bg-hover',
        row.disputed > 0 && !selected && 'bg-disputed-soft/40',
      )}
    >
      <td className="px-3 py-2.5 align-top">
        <div className="font-medium text-text">{row.desc}</div>
        <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-text-3">
          {CATEGORY_LABEL[row.category] ?? row.category}
        </div>
      </td>
      <td className="px-3 py-2.5 text-right align-top">
        <Money value={inr(row.claimed)} />
      </td>
      <td className="px-3 py-2.5 text-right align-top">
        <Money value={inr(row.insurerPaid)} tone="muted" />
      </td>
      <td className="px-3 py-2.5 text-right align-top">
        <Money
          value={row.insurerCut === 0 ? '—' : inr(row.insurerCut)}
          tone={row.disputed > 0 ? 'disputed' : 'default'}
        />
      </td>
      <td className="px-3 py-2.5 align-top">
        <div className="flex flex-wrap gap-1">
          {buckets.length === 0 ? (
            <span className="text-[11px] text-text-3">ok</span>
          ) : (
            buckets.map((b) => <Badge key={b} bucket={b} />)
          )}
        </div>
      </td>
    </tr>
  );
}
