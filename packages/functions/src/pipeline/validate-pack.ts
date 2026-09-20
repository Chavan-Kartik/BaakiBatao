import { REQUIRED_DOCUMENT_KINDS } from '@fc/contracts';
import { PipelineFailure } from '@fc/api';
import { emit, rethrowCoded, stageDeps, transition } from '../store/io';

/**
 * `ValidatePack` (state 1): every required document kind is present, or the
 * run fails at once with `PACK_INCOMPLETE` and a sentence a person can act on.
 * A pack without the schedule and the wording is not usable (project brief
 * §4), so this is where that rule lives — not three states later.
 *
 * Output is the routing list the inline `Map` iterates: kind, key, type.
 */
export interface ValidateInput {
  readonly caseId: string;
}

export interface RoutedDocument {
  readonly kind: string;
  readonly key: string;
  readonly contentType: string;
}

export const handler = async (event: ValidateInput): Promise<{ documents: RoutedDocument[] }> => {
  const deps = stageDeps();
  try {
    const record = await transition(deps, event.caseId, 'VALIDATING');
    const present = new Set(record.documents.map((d) => d.kind));
    const missing = REQUIRED_DOCUMENT_KINDS.filter((k) => !present.has(k));
    if (missing.length > 0) {
      throw new PipelineFailure(
        'PACK_INCOMPLETE',
        `the pack is missing ${missing.join(', ')}; the schedule, wording, bill and deduction sheet are all required`,
      );
    }
    await emit(deps, event.caseId, 'PackValidated', { documents: record.documents.map((d) => d.kind) });
    return {
      documents: record.documents.map((d) => ({ kind: d.kind, key: d.key, contentType: d.contentType })),
    };
  } catch (e) {
    rethrowCoded(e);
  }
};
