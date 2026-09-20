import type { CaseEvent, CaseStatus, FailureCode, Rulepack } from '@fc/contracts';
import { ExtractionError, PipelineFailure, type CaseRecord, type CaseStore } from '@fc/api';
import { loadRulepackV1 } from '@fc/rulepack';
import { required } from '../shared/config';
import { DynamoCaseStore } from './dynamo-store';

/**
 * What every pipeline Lambda needs, built once per container from the
 * environment: the case store, the rulepack, a clock. Stages read their case
 * from the store rather than trusting the Step Functions payload for case
 * state — the payload carries routing (`caseId`, keys), the record is the
 * authority. `emit` and `transition` are the same two operations the local
 * runner uses, so the event log is identical whichever runner produced it.
 */
export interface StageDeps {
  readonly store: CaseStore;
  readonly rulepack: Rulepack;
  readonly now: () => string;
}

let cached: StageDeps | null = null;

export function stageDeps(): StageDeps {
  if (cached) return cached;
  cached = {
    store: new DynamoCaseStore(required('TABLE_NAME')),
    rulepack: loadRulepackV1(),
    now: () => new Date().toISOString(),
  };
  return cached;
}

export async function loadCase(deps: StageDeps, caseId: string): Promise<CaseRecord> {
  const record = await deps.store.get(caseId);
  if (!record) throw new PipelineFailure('PIPELINE_INTERNAL', `case ${caseId} not found`);
  return record;
}

export async function transition(deps: StageDeps, caseId: string, status: CaseStatus): Promise<CaseRecord> {
  return deps.store.update(caseId, (r) => ({ ...r, status }));
}

export async function emit(
  deps: StageDeps,
  caseId: string,
  kind: CaseEvent['kind'],
  detail: Record<string, unknown>,
): Promise<void> {
  await deps.store.update(caseId, (r) => ({
    ...r,
    events: [...r.events, { seq: r.events.length, at: deps.now(), kind, detail }],
  }));
}

/** The taxonomy code and sentence for whatever a stage threw; never a bare stack trace (§11.2). */
export function failureOf(e: unknown): { code: FailureCode; message: string } {
  if (e instanceof PipelineFailure || e instanceof ExtractionError) return { code: e.code, message: e.message };
  const named = e as { code?: unknown; message?: unknown };
  if (typeof named.code === 'string' && typeof named.message === 'string') {
    return { code: named.code as FailureCode, message: named.message };
  }
  return { code: 'PIPELINE_INTERNAL', message: e instanceof Error ? e.message : String(e) };
}

/**
 * Step Functions surfaces a Lambda error by its `name`, which is what the
 * `Catch` on every state matches and what `FailWithReason` records. So a
 * stage throws with the taxonomy code as the error name.
 */
export function rethrowCoded(e: unknown): never {
  const failure = failureOf(e);
  const error = new Error(failure.message);
  error.name = failure.code;
  throw error;
}
