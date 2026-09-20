import type { DocumentKind } from '@fc/contracts';
import { REQUIRED_DOCUMENT_KINDS } from '@fc/contracts';
import { buildDemoPack } from '@fc/fixtures';
import { Info, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { FileCollectionsShelf, FileUploadCard, type FileSlot } from '../components/extras/file-upload-card';
import { LoadingButton } from '../components/extras/loading-button';
import { ProgressBar } from '../components/extras/progress-bar';
import { Chip, ErrorNote, Page, PillButton } from '../components/primitives';
import { api, ApiError } from '../lib/api';
import { navigate } from '../lib/router';

const KINDS: readonly DocumentKind[] = [
  'POLICY_SCHEDULE',
  'POLICY_WORDING',
  'ITEMISED_BILL',
  'DEDUCTION_SHEET',
  'SETTLEMENT_LETTER',
  'ENDORSEMENT',
];

const HINT: Record<DocumentKind, string> = {
  POLICY_SCHEDULE: 'Sum insured, room rent limit, co-pay, deductible.',
  POLICY_WORDING: 'The full wording — the definition of associated medical expenses lives here.',
  ITEMISED_BILL: 'Every line the hospital charged.',
  DEDUCTION_SHEET: 'What the insurer paid on each line, and why.',
  SETTLEMENT_LETTER: 'The final figure. The deduction sheet usually carries it.',
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
  const have = REQUIRED_DOCUMENT_KINDS.filter((k) => slots[k]).length;

  const busy = phase !== 'idle';
  const busyLabel =
    phase === 'creating' ? 'Opening the case…' : phase === 'uploading' ? 'Uploading…' : 'Starting the pipeline…';

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
        // named incomplete-pack failure, which is a better failure than a crash.
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
    <>
      <AppHeader
        title="New case"
        subtitle="Four documents are required; the other two help when you have them"
        chips={
          <Chip tone={ready ? 'brand' : 'quiet'}>
            {have} of {REQUIRED_DOCUMENT_KINDS.length} required
          </Chip>
        }
        actions={
          <PillButton variant="outline" size="sm" onClick={loadDemo} disabled={busy}>
            <Wand2 />
            Fill with the worked example
          </PillButton>
        }
      />

      <Page className="space-y-3">
        <p className="max-w-[62ch] text-[12.5px] leading-relaxed text-text-2">
          Nothing is adjudicated until the schedule, the wording, the bill and the deduction sheet are all
          present. The rest cannot be guessed, and guessing is the one thing this tool will not do.
        </p>

        <div className="grid gap-2.5 sm:grid-cols-2">
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
          <div className="rounded-xl border border-border bg-surface p-3.5">
            <ProgressBar
              value={uploaded}
              max={staged || 1}
              label={`Sending the pack — ${uploaded} of ${staged} documents`}
              showValue
            />
          </div>
        )}

        <div className="flex gap-2.5 rounded-xl border border-border bg-surface px-3.5 py-3">
          <Info className="mt-px size-3.5 shrink-0 text-text-3" strokeWidth={1.75} />
          <p className="text-[12px] leading-relaxed text-text-2">
            <span className="font-medium text-text">What this deployment can read.</span> Claim packs in the
            structured format that "fill with the worked example" produces. A scanned PDF uploads and is
            stored, but reading it needs Textract — until that is wired in it fails with a reason, rather
            than inventing a bill.
          </p>
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}

        <div className="flex items-center justify-end gap-3 pb-2">
          <span className="text-[11.5px] text-text-3">
            {ready ? 'The pack is complete.' : `${REQUIRED_DOCUMENT_KINDS.length - have} still missing.`}
          </span>
          <LoadingButton
            type="button"
            disabled={!ready || busy}
            loading={busy}
            loadingText={busyLabel}
            onClick={submit}
          >
            Reconstruct the settlement
          </LoadingButton>
        </div>
      </Page>
    </>
  );
}

function guessType(name: string): string {
  const ext = name.toLowerCase().split('.').pop();
  return ext === 'json'
    ? 'application/json'
    : ext === 'pdf'
      ? 'application/pdf'
      : ext === 'png'
        ? 'image/png'
        : ext === 'jpg' || ext === 'jpeg'
          ? 'image/jpeg'
          : 'application/octet-stream';
}
