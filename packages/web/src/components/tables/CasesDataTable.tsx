import React, { useMemo, useState } from 'react';
import type { CaseSummary, CaseStatus } from '@fc/contracts';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { STATUS_LABEL } from '@/lib/labels';
import { href } from '@/lib/router';
import { cn } from '@/lib/utils';
import { ArrowUpDown, ChevronLeft, ChevronRight, FileText, Search, SlidersHorizontal } from 'lucide-react';

interface CasesDataTableProps {
  cases: CaseSummary[];
}

export function CasesDataTable({ cases }: CasesDataTableProps) {
  const [globalFilter, setGlobalFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'createdAt', desc: true }]);

  const filteredData = useMemo(() => {
    if (statusFilter === 'ALL') return cases;
    return cases.filter((c) => c.status === statusFilter);
  }, [cases, statusFilter]);

  const columns = useMemo<ColumnDef<CaseSummary>[]>(
    () => [
      {
        accessorKey: 'caseId',
        header: ({ column }) => (
          <button
            type="button"
            className="flex items-center gap-1 hover:text-text"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Case ID
            <ArrowUpDown className="size-3" />
          </button>
        ),
        cell: ({ row }) => {
          const c = row.original;
          const done = c.status === 'COMPLETE';
          return (
            <a
              href={href({ name: 'case', caseId: c.caseId, tab: done ? 'review' : 'pipeline' })}
              className="flex items-center gap-2 group"
            >
              <FileText className="size-4 text-brand/70 group-hover:text-brand" />
              <span className="font-mono text-[12px] font-medium text-text group-hover:text-brand group-hover:underline">
                {c.caseId}
              </span>
            </a>
          );
        },
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => {
          const status = row.getValue('status') as CaseStatus;
          const done = status === 'COMPLETE';
          const failed = status === 'FAILED';
          const paused = status === 'AWAITING_CORRECTION';

          return (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-sm px-2 py-0.5 font-mono text-[11px] font-medium',
                failed
                  ? 'bg-disputed-soft text-disputed'
                  : done
                  ? 'bg-brand-soft text-brand'
                  : paused
                  ? 'bg-unresolved-soft text-unresolved'
                  : 'bg-defended-soft text-defended',
              )}
            >
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  failed ? 'bg-disputed' : done ? 'bg-brand' : paused ? 'bg-unresolved' : 'bg-defended',
                )}
              />
              {STATUS_LABEL[status] ?? status}
            </span>
          );
        },
      },
      {
        accessorKey: 'documents',
        header: 'Documents',
        cell: ({ row }) => {
          const docs = row.original.documents || [];
          return (
            <div className="flex items-center gap-1">
              <span className="rounded bg-canvas px-1.5 py-0.5 font-mono text-[11px] text-text-2 border border-border/60">
                {docs.length} files
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: 'createdAt',
        header: ({ column }) => (
          <button
            type="button"
            className="flex items-center gap-1 hover:text-text"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Submitted
            <ArrowUpDown className="size-3" />
          </button>
        ),
        cell: ({ row }) => {
          const date = new Date(row.getValue('createdAt'));
          return (
            <span className="text-[12px] text-text-3 font-mono">
              {date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · {date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </span>
          );
        },
      },
      {
        id: 'action',
        header: '',
        cell: ({ row }) => {
          const c = row.original;
          const done = c.status === 'COMPLETE';
          return (
            <div className="text-right">
              <a
                href={href({ name: 'case', caseId: c.caseId, tab: done ? 'review' : 'pipeline' })}
                className="inline-flex h-7 items-center rounded-sm border border-border bg-surface px-2.5 text-[11px] font-medium text-text-2 hover:bg-hover hover:text-text"
              >
                {done ? 'Review' : 'Open'}
              </a>
            </div>
          );
        },
      },
    ],
    [],
  );

  const table = useReactTable({
    data: filteredData,
    columns,
    state: {
      sorting,
      globalFilter,
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: {
        pageSize: 8,
      },
    },
  });

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-3" />
          <input
            type="text"
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder="Search cases by ID..."
            className="h-8 w-full rounded-sm border border-border bg-surface pl-8 pr-2.5 text-[12px] text-text outline-none focus:border-brand"
          />
        </div>

        {/* Filter pills */}
        <div className="flex items-center gap-1 rounded-sm border border-border bg-surface p-0.5 text-[11px]">
          {['ALL', 'COMPLETE', 'RUNNING', 'AWAITING_CORRECTION', 'FAILED'].map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={cn(
                'rounded-xs px-2 py-1 font-medium transition-colors',
                statusFilter === st ? 'bg-brand text-white' : 'text-text-3 hover:text-text',
              )}
            >
              {st === 'ALL' ? 'All cases' : STATUS_LABEL[st] ?? st}
            </button>
          ))}
        </div>
      </div>

      {/* Table Body */}
      <div className="overflow-hidden rounded-md border border-border bg-surface">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-text-3">
                  No matching claims found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between px-1 text-[12px] text-text-3">
          <span>
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()} (
            {filteredData.length} total)
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
              className="inline-flex size-7 items-center justify-center rounded-sm border border-border bg-surface text-text-2 hover:bg-hover disabled:opacity-40"
            >
              <ChevronLeft className="size-3.5" />
            </button>
            <button
              type="button"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
              className="inline-flex size-7 items-center justify-center rounded-sm border border-border bg-surface text-text-2 hover:bg-hover disabled:opacity-40"
            >
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
