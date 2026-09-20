import { emit, loadCase, rethrowCoded, stageDeps, transition } from '../store/io';

/**
 * `ClassifyDocuments` (state 2): one `DocumentClassified` event per document,
 * `by: 'declared'` — the kind the uploader put it in.
 *
 * The build spec has Bedrock confirm the kind from layout hints here. That
 * confirmation is not wired: it would need the layout text, which does not
 * exist until Textract has run in the next state, and the event shape the
 * UI consumes is the same either way. When it lands it lands after the
 * `Map`, as a check that fails the pack on a contradiction rather than
 * silently re-routing a document — never as a reason to read a raw document
 * into a model, which stays on the wrong side of the redaction gate.
 */
export const handler = async (event: { caseId: string }): Promise<{ classified: number }> => {
  const deps = stageDeps();
  try {
    const record = await loadCase(deps, event.caseId);
    await transition(deps, event.caseId, 'EXTRACTING');
    for (const d of record.documents) {
      await emit(deps, event.caseId, 'DocumentClassified', { kind: d.kind, filename: d.filename, by: 'declared' });
    }
    return { classified: record.documents.length };
  } catch (e) {
    rethrowCoded(e);
  }
};
