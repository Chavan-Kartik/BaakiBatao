import type { DocumentKind } from '@fc/contracts';
import { REQUIRED_DOCUMENT_KINDS } from '@fc/contracts';
import { buildDemoPack } from '@fc/fixtures';
import { FileJson } from 'lucide-react';
import { useState } from 'react';
import { BackButton } from '../components/extras/back-button';
import { FileCollectionsShelf, FileUploadCard, type FileSlot } from '../components/extras/file-upload-card';
import { LoadingButton } from '../components/extras/loading-button';
import { ProgressBar } from '../components/extras/progress-bar';
import { api, ApiError } from '../lib/api';
import { href, navigate } from '../lib/router';

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

type Slot = FileSlot;

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
  const staged = KINDS.filter((k) => slots[k]).length;
  const uploaded = KINDS.filter((k) => progress[k] === 'done').length;

  const busy = phase !== 'idle';
  const busyLabel =
    phase === 'creating' ? 'Creating case…' : phase === 'uploading' ? 'Uploading…' : 'Starting pipeline…';

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
        const s = slots[target.kind];
        // Unreachable through the UI — the shelf's clear is disabled while the
        // pack is in flight — but a skipped document surfaces as the server's
        // named PACK_INCOMPLETE, which is a better failure than a crash here.
        if (!s) continue;
        setProgress((p) => ({ ...p, [target.kind]: 'pending' }));
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
      <BackButton href={href({ name: 'cases' })} className="-ml-2.5 mb-2" />

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
          disabled={busy}
          className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border bg-surface px-3 text-[12px] text-text-2 hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FileJson className="size-3.5" />
          Load demo pack
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {KINDS.map((kind) => (
          <FileUploadCard
            key={kind}
            kind={kind}
            hint={HINT[kind]}
            slot={slots[kind] ?? null}
            required={REQUIRED_DOCUMENT_KINDS.includes(kind)}
            state={progress[kind] ?? null}
            disabled={busy}
            onFile={(f) => put(kind, f)}
          />
        ))}
      </div>

      <FileCollectionsShelf slots={slots} onClear={() => setSlots({})} disabled={busy} />

      {phase === 'uploading' && (
        <div className="mt-4 rounded-md border border-border bg-surface p-3.5">
          <ProgressBar
            value={uploaded}
            max={staged || 1}
            label={`Sending the pack — ${uploaded} of ${staged} documents`}
            showValue
          />
        </div>
      )}

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
        <LoadingButton type="button" disabled={!ready || busy} loading={busy} loadingText={busyLabel} onClick={submit}>
          Reconstruct settlement
        </LoadingButton>
      </div>
    </div>
  );
}

function guessType(name: string): string {
  const ext = name.toLowerCase().split('.').pop();
  return ext === 'json' ? 'application/json' : ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'application/octet-stream';
}

