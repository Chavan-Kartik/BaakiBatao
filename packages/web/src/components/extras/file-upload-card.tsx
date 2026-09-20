import React, { useRef, useState } from 'react';
import type { DocumentKind } from '@fc/contracts';
import { DOCUMENT_LABEL } from '@/lib/api';
import { cn } from '@/lib/utils';
import { CheckCircle2, FileJson, FileText, FileUp, ShieldCheck, Trash2, X } from 'lucide-react';
import { ProgressBar } from './progress-bar';

export interface FileSlot {
  file: File;
  contentType: string;
}

interface UploadCardProps {
  kind: DocumentKind;
  hint: string;
  slot: FileSlot | null;
  required: boolean;
  state: 'pending' | 'done' | null;
  disabled: boolean;
  onFile: (f: File | null) => void;
}

export function FileUploadCard({
  kind,
  hint,
  slot,
  required,
  state,
  disabled,
  onFile,
}: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        const f = e.dataTransfer.files[0];
        if (f && !disabled) onFile(f);
      }}
      className={cn(
        'group relative flex flex-col justify-between rounded-md border bg-surface p-4 transition-all duration-200 shadow-2xs',
        isDragOver
          ? 'border-brand bg-brand-soft/40 ring-2 ring-brand/20'
          : slot
          ? 'border-brand/40 bg-surface'
          : 'border-dashed border-border hover:border-border-strong hover:bg-hover/40',
      )}
    >
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-semibold text-text">{DOCUMENT_LABEL[kind]}</span>
              {required ? (
                <span className="rounded-xs bg-disputed-soft px-1.5 py-0.2 font-mono text-[9px] font-semibold text-disputed uppercase">
                  Required
                </span>
              ) : (
                <span className="rounded-xs bg-canvas px-1.5 py-0.2 font-mono text-[9px] text-text-3 border border-border">
                  Optional
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] leading-snug text-text-3">{hint}</p>
          </div>

          {state === 'done' ? (
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand text-white">
              <CheckCircle2 className="size-3.5" />
            </span>
          ) : slot ? (
            <button
              type="button"
              onClick={() => onFile(null)}
              disabled={disabled}
              className="text-text-3 transition-colors hover:text-disputed disabled:opacity-40 p-1"
              aria-label="Remove uploaded file"
            >
              <Trash2 className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {slot ? (
        <div className="mt-3.5 space-y-2">
          <div className="flex items-center gap-2.5 rounded-sm border border-border/80 bg-canvas px-2.5 py-2 font-mono text-[11px] text-text-2">
            <div className="flex size-6 shrink-0 items-center justify-center rounded bg-surface border border-border">
              {slot.file.name.endsWith('.json') ? (
                <FileJson className="size-3.5 text-brand" />
              ) : (
                <FileText className="size-3.5 text-brand" />
              )}
            </div>
            <span className="truncate font-medium">{slot.file.name}</span>
            <span className="ml-auto shrink-0 text-text-3">{(slot.file.size / 1024).toFixed(1)} KB</span>
          </div>

          {state === 'pending' && (
            <ProgressBar value={75} size="sm" label="Encrypting & uploading..." showValue tone="brand" />
          )}
        </div>
      ) : (
        <div className="mt-3.5">
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-sm border border-border bg-surface text-[12px] font-medium text-text-2 transition-colors hover:bg-hover hover:text-text disabled:opacity-50"
          >
            <FileUp className="size-3.5 text-brand" />
            <span>Drop file or browse</span>
          </button>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.json,.png,.jpg,.jpeg,application/pdf,application/json,image/*"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}

export function FileCollectionsShelf({
  slots,
  onClear,
}: {
  slots: Partial<Record<DocumentKind, FileSlot>>;
  onClear: () => void;
}) {
  const activeEntries = Object.entries(slots).filter(([, s]) => s !== undefined) as [DocumentKind, FileSlot][];

  if (activeEntries.length === 0) return null;

  return (
    <div className="mt-4 rounded-md border border-border bg-surface p-3.5">
      <div className="mb-2.5 flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-1.5 font-medium text-text">
          <ShieldCheck className="size-3.5 text-brand" />
          <span>Staged Claim Documents ({activeEntries.length})</span>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-text-3 hover:text-disputed text-[11px] underline"
        >
          Clear all
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {activeEntries.map(([kind, slot]) => (
          <div
            key={kind}
            className="flex items-center gap-1.5 rounded-sm border border-border/70 bg-canvas px-2.5 py-1 text-[11px] font-mono text-text-2"
          >
            <FileText className="size-3 text-brand" />
            <span className="font-semibold text-text">{DOCUMENT_LABEL[kind]}:</span>
            <span className="truncate max-w-[140px] text-text-3">{slot.file.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
