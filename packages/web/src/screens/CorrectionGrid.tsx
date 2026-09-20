import type { ExtractedTable, LineRef, SubmitCorrectionsRequest } from '@fc/contracts';
import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { inr } from '../lib/format';
import { navigate } from '../lib/router';
import { Panel } from '../components/primitives';

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

  const changed = Object.entries(edits).filter(([, e]) => e.rawDescription !== undefined || e.amountClaimed !== undefined);

  async function submit() {
    const rows: SubmitCorrectionsRequest['rows'] = [];
    for (const [lineRef, e] of changed) {
      if (e.rawDescription !== undefined) rows.push({ lineRef: lineRef as LineRef, field: 'rawDescription', value: e.rawDescription });
      if (e.amountClaimed !== undefined) rows.push({ lineRef: lineRef as LineRef, field: 'amountClaimed', value: String(Math.round(Number(e.amountClaimed) * 100)) });
    }
    setBusy(true);
    setError(null);
    try {
      await api.corrections(caseId, { taskToken, rows });
      navigate({ name: 'case', caseId, tab: 'pipeline' });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'could not submit');
      setBusy(false);
    }
  }

  return (
    <Panel
      title={
        <div>
          <div>Correction grid</div>
          <div className="font-mono text-[10px] font-normal text-text-3">{reason}</div>
        </div>
      }
      action={
        <button
          type="button"
          disabled={busy || changed.length === 0}
          onClick={submit}
          className="inline-flex h-7 items-center rounded-sm bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand/90 disabled:opacity-50"
        >
          {busy ? 'Resuming…' : `Apply ${changed.length} and re-run`}
        </button>
      }
    >
      {error && <p className="m-3 rounded-sm bg-disputed-soft px-3 py-2 text-[12px] text-disputed">{error}</p>}
      <table className="w-full text-[12px]">
        <thead className="sticky top-0 bg-surface text-left text-[11px] text-text-3">
          <tr>
            <th className="px-3 py-2 font-medium">Line as extracted</th>
            <th className="px-3 py-2 font-medium">Corrected description</th>
            <th className="px-3 py-2 text-right font-medium">Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          {bill.rows.map((row) => {
            const e = edits[row.lineRef] ?? {};
            const hot = flagged.has(row.lineRef);
            return (
              <tr key={row.lineRef} className={hot ? 'bg-unresolved-soft/60' : ''}>
                <td className="px-3 py-2 align-top">
                  <div className="text-text">{row.rawDescription}</div>
                  {hot && <div className="font-mono text-[10px] text-unresolved">needs a category</div>}
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    value={e.rawDescription ?? ''}
                    placeholder="e.g. Room rent"
                    onChange={(ev) => setEdits((s) => ({ ...s, [row.lineRef]: { ...s[row.lineRef], rawDescription: ev.target.value || undefined } }))}
                    className="h-8 w-full rounded-sm border border-border bg-canvas px-2 text-[12px] outline-none focus:border-brand"
                  />
                </td>
                <td className="px-3 py-2 text-right align-top">
                  <input
                    value={e.amountClaimed ?? ''}
                    placeholder={inr(row.amountClaimed).replace('₹', '')}
                    inputMode="decimal"
                    onChange={(ev) => setEdits((s) => ({ ...s, [row.lineRef]: { ...s[row.lineRef], amountClaimed: ev.target.value || undefined } }))}
                    className="h-8 w-28 rounded-sm border border-border bg-canvas px-2 text-right font-mono text-[12px] outline-none focus:border-brand"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-3 py-3 text-[11px] text-text-3">
        Corrections are recorded on the row's provenance as human edits. The lexicon matches the
        corrected text exactly or by trigram similarity; "Room rent", "ICU charges", "Laboratory"
        and "Administrative charges" are all aliases it knows.
      </p>
    </Panel>
  );
}
