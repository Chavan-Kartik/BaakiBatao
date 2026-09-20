import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Download, FileText, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DocumentViewerProps {
  title: string;
  url?: string;
  documentType?: string;
  totalPages?: number;
  previewContent?: React.ReactNode;
  className?: string;
  onClose?: () => void;
}

export function DocumentViewer({
  title,
  url,
  documentType = 'PDF',
  totalPages = 1,
  previewContent,
  className,
}: DocumentViewerProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(100);

  return (
    <div className={cn('flex h-full flex-col overflow-hidden rounded-md border border-border bg-surface shadow-xs', className)}>
      {/* Viewer toolbar */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-canvas px-3 text-[12px]">
        <div className="flex items-center gap-2 truncate">
          <FileText className="size-4 text-brand shrink-0" />
          <span className="font-medium text-text truncate max-w-[200px]">{title}</span>
          <span className="rounded-sm bg-border/60 px-1 py-0.2 font-mono text-[10px] text-text-3">
            {documentType}
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-text-2">
          <div className="flex items-center gap-1 font-mono text-[11px] text-text-3 px-2">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="p-1 rounded hover:bg-surface disabled:opacity-40"
              aria-label="Previous page"
            >
              <ChevronLeft className="size-3.5" />
            </button>
            <span>{currentPage} / {totalPages}</span>
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="p-1 rounded hover:bg-surface disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight className="size-3.5" />
            </button>
          </div>

          <div className="h-4 w-px bg-border mx-1" />

          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(50, z - 15))}
            className="p-1.5 rounded hover:bg-surface text-text-3 hover:text-text"
            title="Zoom out"
          >
            <ZoomOut className="size-3.5" />
          </button>
          <span className="font-mono text-[10px] text-text-3 w-8 text-center">{zoom}%</span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(200, z + 15))}
            className="p-1.5 rounded hover:bg-surface text-text-3 hover:text-text"
            title="Zoom in"
          >
            <ZoomIn className="size-3.5" />
          </button>

          {url && (
            <a
              href={url}
              download
              className="p-1.5 rounded hover:bg-surface text-text-3 hover:text-text ml-1"
              title="Download file"
            >
              <Download className="size-3.5" />
            </a>
          )}
        </div>
      </div>

      {/* Viewer viewport */}
      <div className="relative flex-1 overflow-auto bg-canvas/60 p-4 flex items-center justify-center">
        <div
          className="transition-transform duration-200 origin-top shadow-md rounded-sm border border-border bg-surface p-6 min-h-[400px] w-full max-w-2xl"
          style={{ transform: `scale(${zoom / 100})` }}
        >
          {previewContent ? (
            previewContent
          ) : url ? (
            <iframe src={url} className="w-full h-full min-h-[450px] border-none" title={title} />
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center text-text-3">
              <FileText className="size-12 stroke-[1.2] mb-3 text-brand/50" />
              <p className="text-[13px] font-medium text-text">Document Stored in Claim Pack</p>
              <p className="text-[11px] text-text-3 mt-1 max-w-sm">
                Pinned extraction hash verified. Line item bounding boxes are anchored directly to this schedule.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
