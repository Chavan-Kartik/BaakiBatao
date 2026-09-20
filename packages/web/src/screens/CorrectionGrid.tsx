import type { ExtractedTable, LineRef, SubmitCorrectionsRequest } from '@fc/contracts';
import { PenLine } from 'lucide-react';
import { useState } from 'react';
import { Chip, ErrorNote, Panel, PillButton } from '../components/primitives';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { api, ApiError } from '../lib/api';
import { inr } from '../lib/format';
import { navigate } from '../lib/router';
import { cn } from '../lib/utils';

/**
 * Editable cells for the rows a human has to settle: a description the
 * lexicon could not place, or a bill that does not add up to its printed
 * total. Submitting resumes the pipeline from normalisation; nothing is
 * adjudicated on the edited rows until the engine has re-run over them.
 */
export function CorrectionGrid({
  caseId,
  taskToken,
  bill,
  flagged,
  reason,
}: {
  caseId: string;
  taskToken: string;
  bill: ExtractedTable;
  /** Rows worth the reviewer's attention first; the rest are editable too. */
  flagged: ReadonlySet<LineRef>;
  reason: string;
}) {
  const [edits, setEdits] = useState<Record<string, { rawDescription?: string; amountClaimed?: string }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changed = Object.entries(edits).filter(
    ([, e]) => e.rawDescription !== undefined || e.amountClaimed !== undefined,
  );

  async function submit() {
    const rows: SubmitCorrectionsRequest['rows'] = [];
    for (const [lineRef, e] of changed) {
      if (e.rawDescription !== undefined)
        rows.push({ lineRef: lineRef as LineRef, field: 'rawDescription', value: e.rawDescription });
      if (e.amountClaimed !== undefined)
        rows.push({
          lineRef: lineRef as LineRef,
          field: 'amountClaimed',
          value: String(Math.round(Number(e.amountClaimed) * 100)),
        });
    }
    setBusy(true);
    setError(null);
    try {
      await api.corrections(caseId, { taskToken, rows });
      navigate({ name: 'case', caseId, tab: 'pipeline' });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The correction could not be submitted.');
      setBusy(false);
    }
  }

  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <PenLine className="size-3.5 text-unresolved" strokeWidth={2} />
          Your turn
        </span>
      }
      subtitle={`Paused because ${reason}.`}
      action={
        <PillButton
          variant={changed.length > 0 ? 'brand' : 'outline'}
          size="sm"
          disabled={busy || changed.length === 0}
          onClick={submit}
        >
          {busy ? 'Resuming…' : changed.length === 0 ? 'No edits yet' : `Apply ${changed.length} and re-run`}
        </PillButton>
      }
      className="border-unresolved/30"
    >
      {error && <ErrorNote className="m-3">{error}</ErrorNote>}

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-full">Line as we read it</TableHead>
            <TableHead className="w-[38%]">What it should say</TableHead>
            <TableHead className="text-right">Amount (₹)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {bill.rows.map((row) => {
            const e = edits[row.lineRef] ?? {};
            const hot = flagged.has(row.lineRef);
            return (
              <TableRow key={row.lineRef} className={cn(hot && 'bg-unresolved-soft/60')}>
                <TableCell className="whitespace-normal py-2 align-middle">
                  <div className="text-[12.5px] text-text">{row.rawDescription}</div>
                  {hot && (
                    <Chip tone="unresolved" className="mt-1">
                      Needs a category
                    </Chip>
                  )}
                </TableCell>
                <TableCell className="py-2 align-middle">
                  <input
                    value={e.rawDescription ?? ''}
                    placeholder="e.g. Room rent"
                    onChange={(ev) =>
                      setEdits((s) => ({
                        ...s,
                        [row.lineRef]: { ...s[row.lineRef], rawDescription: ev.target.value || undefined },
                      }))
                    }
                    className="h-8 w-full rounded-lg border border-border bg-canvas px-2.5 text-[12.5px] outline-none transition-colors focus:border-brand focus:bg-surface"
                  />
                </TableCell>
                <TableCell className="py-2 text-right align-middle">
                  <input
                    value={e.amountClaimed ?? ''}
                    placeholder={inr(row.amountClaimed).replace('₹', '')}
                    inputMode="decimal"
                    onChange={(ev) =>
                      setEdits((s) => ({
                        ...s,
                        [row.lineRef]: { ...s[row.lineRef], amountClaimed: ev.target.value || undefined },
                      }))
                    }
                    className="h-8 w-28 rounded-lg border border-border bg-canvas px-2.5 text-right text-[12.5px] tabular-nums outline-none transition-colors focus:border-brand focus:bg-surface"
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <p className="border-t border-border px-4 py-3 text-[11.5px] leading-relaxed text-text-3">
        Edits are recorded on the row as human corrections, so the provenance survives into the
        certificate. "Room rent", "ICU charges", "Laboratory" and "Administrative charges" are all
        spellings the lexicon already knows.
      </p>
    </Panel>
  );
}
