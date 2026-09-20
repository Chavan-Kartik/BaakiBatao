import type { NormalisedLine, ReconstructInput, Reconstruction } from '@fc/contracts';
import { extractionHash, PipelineFailure } from '@fc/api';
import { ENGINE_VERSION, reconstruct } from '@fc/engine';
import { recordReconstruction } from '../shared/metrics';
import { emit, rethrowCoded, stageDeps, transition } from '../store/io';

/**
 * `Reconstruct` (state 9): `@fc/engine` runs here as the authority — pure,
 * ~5 ms, no network. The input it was given is pinned on the record
 * (engine version, rulepack hash, extraction hash, step order) so the
 * certificate can be replayed later against exactly these bytes.
 *
 * An unbalanced ledger is `INVARIANT_VIOLATED`. The engine materialises any
 * residual as an UNRESOLVED finding, so this should not happen; the
 * `InvariantHeld?` choice after this state re-checks the flag anyway.
 */
export const handler = async (
  event: { caseId: string; lines: NormalisedLine[] },
): Promise<{ invariantHeld: boolean; expectedPayable: number; findings: number }> => {
  const deps = stageDeps();
  try {
    const record = await transition(deps, event.caseId, 'RECONSTRUCTING');
    const extracted = record.extracted;
    if (!extracted) throw new PipelineFailure('PIPELINE_INTERNAL', 'nothing was extracted to reconstruct');

    const input: ReconstructInput = {
      caseId: record.caseId as ReconstructInput['caseId'],
      pins: {
        engineVersion: ENGINE_VERSION,
        rulepackVersion: deps.rulepack.version,
        rulepackHash: deps.rulepack.hash,
        lexiconVersion: deps.rulepack.version,
        extractionHash: extractionHash(extracted),
        stepOrder: deps.rulepack.steps.map((s) => s.id),
      },
      policy: extracted.policy,
      admission: extracted.admission,
      billTable: extracted.billTable,
      deductionTable: extracted.deductionTable,
      normalisedLines: event.lines,
      actualPaid: extracted.actualPaid,
    };

    let reconstruction: Reconstruction;
    const started = performance.now();
    try {
      reconstruction = reconstruct({ input, rulepack: deps.rulepack, now: deps.now() });
    } catch (e) {
      throw new PipelineFailure('RULEPACK_INVALID', e instanceof Error ? e.message : String(e));
    }
    recordReconstruction(reconstruction, performance.now() - started);
    if (!reconstruction.reconciliation.invariantHeld) {
      throw new PipelineFailure('INVARIANT_VIOLATED', 'the ledger did not balance');
    }

    await deps.store.update(event.caseId, (r) => ({ ...r, input, reconstruction }));
    await emit(deps, event.caseId, 'Reconstructed', {
      billTotal: reconstruction.billTotal,
      expectedPayable: reconstruction.expectedPayable,
      actualPaid: reconstruction.actualPaid,
      byBucket: reconstruction.reconciliation.byBucket,
      findings: reconstruction.findings.length,
    });
    return {
      invariantHeld: reconstruction.reconciliation.invariantHeld,
      expectedPayable: reconstruction.expectedPayable,
      findings: reconstruction.findings.length,
    };
  } catch (e) {
    rethrowCoded(e);
  }
};
