import type { Bucket } from '@fc/contracts';
import { Layers } from 'lucide-react';
import type { CaseView, LedgerRow } from '../lib/case';
import { inr } from '../lib/format';
import { CATEGORY_LABEL } from '../lib/labels';
import { cn } from '../lib/utils';
import { CategoryIcon } from './CategoryIcon';
import { Badge, FilterChip, Money, Panel } from './primitives';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

export type LineFilter = 'all' | Bucket;

/**
 * The hospital's bill with the insurer's decision set against it, one row per
 * line. The bar under each amount is the share of that line the insurer kept
 * back — the shape of the deduction is visible before any of the numbers are
 * read.
 */
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
  const unresolvedCount = view.rows.filter((r) => r.findings.some((f) => f.bucket === 'UNRESOLVED')).length;

  const rows = view.rows.filter((row) => {
    if (filter === 'all') return true;
    if (filter === 'INCORRECTLY_APPLIED') return row.disputed > 0;
    if (filter === 'CORRECTLY_APPLIED') return row.defended > 0;
    return row.findings.some((f) => f.bucket === 'UNRESOLVED');
  });

  const claimLevelBuckets = [...new Set(view.claimLevel.map((f) => f.bucket))];

  return (
    <Panel
      title="The bill, line by line"
      subtitle={`${view.rows.length} lines · select one to read the reasoning`}
      action={
        <div className="flex items-center gap-0.5">
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
          {unresolvedCount > 0 && (
            <FilterChip
              active={filter === 'UNRESOLVED'}
              count={unresolvedCount}
              onClick={() => onFilter('UNRESOLVED')}
            >
              Unresolved
            </FilterChip>
          )}
        </div>
      }
      className="min-h-0"
    >
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-surface">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-full">Line</TableHead>
            <TableHead className="text-right">Charged</TableHead>
            <TableHead className="text-right">Paid</TableHead>
            <TableHead className="text-right">Withheld</TableHead>
            <TableHead>Verdict</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <LineRow
              key={row.index}
              row={row}
              selected={selectedIndex === row.index}
              onSelect={() => onSelect(row.index)}
            />
          ))}

          {rows.length === 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={5} className="py-10 text-center text-[12.5px] text-text-3">
                No lines fall in this filter.
              </TableCell>
            </TableRow>
          )}

          <TableRow
            onClick={() => onSelect(-1)}
            className={cn(
              'cursor-pointer border-t border-border-strong bg-canvas/60',
              selectedIndex === -1 && 'bg-selected',
            )}
          >
            <TableCell colSpan={4} className="whitespace-normal py-3">
              <div className="flex items-center gap-2.5">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-border bg-surface text-text-2">
                  <Layers className="size-3.5" strokeWidth={1.75} />
                </span>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-semibold tracking-[-0.01em] text-text">
                    Taken off the whole claim
                  </div>
                  <div className="text-[11px] text-text-3">Deductible, co-pay, and anything left unexplained</div>
                </div>
              </div>
            </TableCell>
            <TableCell className="py-3">
              <div className="flex flex-wrap gap-1">
                {claimLevelBuckets.map((b) => (
                  <Badge key={b} bucket={b} />
                ))}
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Panel>
  );
}

function LineRow({ row, selected, onSelect }: { row: LedgerRow; selected: boolean; onSelect: () => void }) {
  const buckets = [...new Set(row.findings.map((f) => f.bucket))];
  const tone = row.disputed > 0 ? 'disputed' : row.category === null ? 'unresolved' : 'default';
  const cutShare = row.claimed > 0 ? Math.min(1, row.insurerCut / row.claimed) : 0;

  return (
    <TableRow
      onClick={onSelect}
      data-state={selected ? 'selected' : undefined}
      className={cn(
        'relative cursor-pointer',
        selected && 'bg-selected',
        !selected && row.disputed > 0 && 'bg-disputed-soft/35',
      )}
    >
      <TableCell className="relative whitespace-normal py-2.5 align-top">
        <span
          aria-hidden
          className={cn(
            'absolute inset-y-0 left-0 w-[3px]',
            selected ? 'bg-brand' : row.disputed > 0 ? 'bg-disputed/40' : 'bg-transparent',
          )}
        />
        <div className="flex items-start gap-2.5">
          <CategoryIcon category={row.category} tone={tone} className="mt-px" />
          <div className="min-w-0">
            <div className="text-[12.5px] font-medium leading-tight tracking-[-0.01em] text-text">{row.desc}</div>
            <div className="mt-0.5 text-[11px] text-text-3">
              {row.category === null ? (
                <span className="text-unresolved">Could not be categorised</span>
              ) : (
                (CATEGORY_LABEL[row.category] ?? row.category)
              )}
            </div>
          </div>
        </div>
      </TableCell>

      <TableCell className="py-2.5 text-right align-top">
        <Money value={inr(row.claimed)} className="text-[12.5px]" />
      </TableCell>

      <TableCell className="py-2.5 text-right align-top">
        <Money
          value={row.insurerPaid === null ? '—' : inr(row.insurerPaid)}
          tone="muted"
          className="text-[12.5px]"
        />
      </TableCell>

      <TableCell className="py-2.5 text-right align-top">
        <Money
          value={row.insurerCut === 0 ? '—' : inr(row.insurerCut)}
          tone={row.disputed > 0 ? 'disputed' : 'default'}
          className="text-[12.5px]"
        />
        {cutShare > 0 && (
          <span aria-hidden className="mt-1 flex h-[3px] w-full justify-end overflow-hidden rounded-full bg-border">
            <span
              className={cn('h-full rounded-full', row.disputed > 0 ? 'bg-disputed' : 'bg-defended')}
              style={{ width: `${Math.max(4, cutShare * 100)}%` }}
            />
          </span>
        )}
      </TableCell>

      <TableCell className="py-2.5 align-top">
        <div className="flex flex-wrap gap-1">
          {buckets.length === 0 ? (
            <span className="text-[11px] text-text-3">Paid in full</span>
          ) : (
            buckets.map((b) => <Badge key={b} bucket={b} />)
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
