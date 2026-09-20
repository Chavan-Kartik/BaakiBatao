import { PipelineFailure } from '@fc/api';
import { emit, loadCase, rethrowCoded, stageDeps } from '../store/io';

/**
 * `ChecksumRows` (state 5): do the bill's rows sum to its printed total,
 * within the rulepack's match tolerance? A mismatch means a row was misread
 * or missed, and adjudicating a bill that does not add up produces confident
 * arithmetic about the wrong numbers — so the answer is `ok: false` and the
 * `NeedsCorrection?` choice parks the case for a human, rather than carrying
 * on. No printed total means nothing to check against.
 */
export const handler = async (
  event: { caseId: string },
): Promise<{ ok: boolean; printedTotal: number | null; summedRows: number }> => {
  const deps = stageDeps();
  try {
    const record = await loadCase(deps, event.caseId);
    if (!record.extracted) throw new PipelineFailure('PIPELINE_INTERNAL', 'nothing was extracted to check');
    const table = record.extracted.billTable;
    const summed = table.rows.reduce((s, r) => s + r.amountClaimed, 0);
    const printed = table.printedTotal;
    if (printed === null) return { ok: true, printedTotal: null, summedRows: summed };

    const ok = Math.abs(summed - printed) <= deps.rulepack.rounding.matchTolerancePaise;
    if (!ok) {
      await emit(deps, event.caseId, 'ChecksumFailed', {
        printedTotal: printed,
        summedRows: summed,
        difference: summed - printed,
      });
    }
    return { ok, printedTotal: printed, summedRows: summed };
  } catch (e) {
    rethrowCoded(e);
  }
};
