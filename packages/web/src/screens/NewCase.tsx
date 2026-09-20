import type { DocumentKind } from '@fc/contracts';
import { REQUIRED_DOCUMENT_KINDS } from '@fc/contracts';
import { buildDemoPack } from '@fc/fixtures';
import { CheckCircle2, FileJson, FileUp, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { api, ApiError, DOCUMENT_LABEL } from '../lib/api';
import { navigate } from '../lib/router';
import { cn } from '../lib/utils';

const KINDS: readonly DocumentKind[] = [
  'POLICY_SCHEDULE', 'POLICY_WORDING', 'ITEMISED_BILL', 'DEDUCTION_SHEET', 'SETTLEMENT_LETTER', 'ENDORSEMENT',
];

const HINT: Record<DocumentKind, string> = {
  POLICY_SCHEDULE: 'Sum insured, room rent limit, co-pay, deductible. Required.',
  POLICY_WORDING: 'The full wording — the definition of associated medical expenses lives here. Required.',
  ITEMISED_BILL: 'Every line the hospital charged. Required.',
  DEDUCTION_SHEET: 'What the insurer paid on each line and why. Required.',
  SETTLEMENT_LETTER: 'The final figure. Optional; the deduction sheet usually carries it.',
  ENDORSEMENT: 'A consumables rider or other endorsement, if you bought one.',
};

type Slot = { file: File; contentType: string };

/**
 * Six typed dropzones. The type is what matters: a pack is not a pile of
 * PDFs but a schedule, a wording, a bill and a sheet, and the pipeline needs
 * to know which is which before it reads a byte. Four are required; the
 * button stays disabled until they are in.
 */
export function NewCase() {
  const [slots, setSlots] = useState<Partial<Record<DocumentKind, Slot>>>({});
  const [phase, setPhase] = useState<'idle' | 'creating' | 'uploading' | 'submitting'>('idle');
  const [progress, setProgress] = useState<Partial<Record<DocumentKind, 'pending' | 'done'>>>({});
  const [error, setError] = useState<string | null>(null);

  const ready = REQUIRED_DOCUMENT_KINDS.every((k) => slots[k]);

  function put(kind: DocumentKind, file: File | null) {
    setSlots((s) => {
      const next = { ...s };
      if (file) next[kind] = { file, contentType: file.type || guessType(file.name) };
      else delete next[kind];
      return next;
    });
  }

  function loadDemo() {
    const next: Partial<Record<DocumentKind, Slot>> = {};
    for (const p of buildDemoPack()) {
      next[p.kind] = { file: new File([p.body], p.filename, { type: p.contentType }), contentType: p.contentType };
    }
    setSlots(next);
    setError(null);
  }

  async function submit() {
    setError(null);
    const docs = KINDS.filter((k) => slots[k]).map((k) => {
      const s = slots[k] as Slot;
      return { kind: k, filename: s.file.name, contentType: s.contentType };
    });
    try {
      setPhase('creating');
      const created = await api.createCase({ docs });
      setPhase('uploading');
      for (const target of created.uploads) {
        setProgress((p) => ({ ...p, [target.kind]: 'pending' }));
        const s = slots[target.kind] as Slot;
        await api.upload(target, new Blob([await s.file.arrayBuffer()], { type: s.contentType }));
        setProgress((p) => ({ ...p, [target.kind]: 'done' }));
      }
      setPhase('submitting');
      await api.submit(created.caseId);
      navigate({ name: 'case', caseId: created.caseId, tab: 'pipeline' });
    } catch (e) {
      setPhase('idle');
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold tracking-tight text-text">New case</h1>
          <p className="mt-1 text-[13px] text-text-2">
            Upload the claim pack. Nothing is adjudicated until the schedule, the wording, the bill and
            the deduction sheet are all present — the rest cannot be guessed.
          </p>
        </div>
        <button
          type="button"
          onClick={loadDemo}
          className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border bg-surface px-3 text-[12px] text-text-2 hover:bg-hover"
        >
          <FileJson className="size-3.5" />
          Load demo pack
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {KINDS.map((kind) => (
          <Dropzone
            key={kind}
            kind={kind}
            slot={slots[kind] ?? null}
            required={REQUIRED_DOCUMENT_KINDS.includes(kind)}
            state={progress[kind] ?? null}
            disabled={phase !== 'idle'}
            onFile={(f) => put(kind, f)}
          />
        ))}
      </div>

      <div className="mt-5 rounded-md border border-border bg-surface p-4 text-[12px] leading-relaxed text-text-2">
        <p>
          <span className="font-medium text-text">What this deployment reads.</span> Structured JSON in
          the pack format (what "load demo pack" fills in). Scanned PDFs upload and are stored, but
          extraction fails with a named reason until Textract is wired in — it will not guess.
        </p>
      </div>

      {error && (
        <p className="mt-4 rounded-sm bg-disputed-soft px-3 py-2 text-[12px] text-disputed">{error}</p>
      )}

      <div className="mt-5 flex items-center justify-end gap-3">
        <span className="text-[12px] text-text-3">
          {REQUIRED_DOCUMENT_KINDS.filter((k) => slots[k]).length} of {REQUIRED_DOCUMENT_KINDS.length} required documents
        </span>
        <button
          type="button"
          disabled={!ready || phase !== 'idle'}
          onClick={submit}
          className="inline-flex h-9 items-center rounded-sm bg-brand px-4 text-[13px] font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {phase === 'idle' ? 'Reconstruct settlement' : phase === 'creating' ? 'Creating case…' : phase === 'uploading' ? 'Uploading…' : 'Starting pipeline…'}
        </button>
      </div>
    </div>
  );
}

function Dropzone({
  kind, slot, required, state, disabled, onFile,
}: {
  kind: DocumentKind;
  slot: Slot | null;
  required: boolean;
  state: 'pending' | 'done' | null;
  disabled: boolean;
  onFile: (f: File | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f && !disabled) onFile(f);
      }}
      className={cn(
        'relative rounded-md border bg-surface p-3.5 transition-colors',
        over ? 'border-brand bg-brand-soft' : slot ? 'border-border-strong' : 'border-dashed border-border',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-medium text-text">{DOCUMENT_LABEL[kind]}</span>
            {required && <span className="font-mono text-[10px] text-disputed">required</span>}
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-text-3">{HINT[kind]}</p>
        </div>
        {state === 'done' ? (
          <CheckCircle2 className="size-4 shrink-0 text-brand" />
        ) : slot ? (
          <button type="button" onClick={() => onFile(null)} disabled={disabled} className="text-text-3 hover:text-text" aria-label="remove">
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {slot ? (
        <div className="mt-2.5 flex items-center gap-2 rounded-sm bg-canvas px-2 py-1.5 font-mono text-[11px] text-text-2">
          <FileJson className="size-3.5 shrink-0 text-text-3" />
          <span className="truncate">{slot.file.name}</span>
          <span className="ml-auto shrink-0 text-text-3">{(slot.file.size / 1024).toFixed(1)} KB</span>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => input.current?.click()}
          className="mt-2.5 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-sm border border-border text-[12px] text-text-2 hover:bg-hover"
        >
          <FileUp className="size-3.5" />
          Drop a file or choose
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept=".pdf,.json,.png,.jpg,.jpeg,application/pdf,application/json,image/*"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}

function guessType(name: string): string {
  const ext = name.toLowerCase().split('.').pop();
  return ext === 'json' ? 'application/json' : ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'application/octet-stream';
}
