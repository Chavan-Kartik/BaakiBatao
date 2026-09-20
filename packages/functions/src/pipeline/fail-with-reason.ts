import { FailureCode, type FailureCode as FailureCodeType } from '@fc/contracts';
import { emit, stageDeps } from '../store/io';

/**
 * `FailWithReason` (state 13): every `Catch` lands here. The record gets a
 * taxonomy code and the sentence the stage wrote, never a stack trace
 * (§11.2); a `CaseFailed` event carries the same to the UI. An error name
 * that is not in the taxonomy — a Lambda runtime error, a timeout — is
 * `PIPELINE_INTERNAL` with the cause kept as the message, so the operator
 * log and the user's screen say the same thing.
 */
export interface FailInput {
  readonly caseId: string;
  readonly error?: { readonly Error?: string; readonly Cause?: string };
}

export const handler = async (event: FailInput): Promise<{ code: FailureCodeType; message: string }> => {
  const deps = stageDeps();
  const failure = decode(event.error);
  try {
    await deps.store.update(event.caseId, (r) => ({ ...r, status: 'FAILED', failure, correctionTaskToken: null }));
    await emit(deps, event.caseId, 'CaseFailed', failure);
  } catch (inner) {
    console.error(`case ${event.caseId}: could not record failure ${failure.code}: ${String(inner)}`);
  }
  return failure;
};

export function decode(error: FailInput['error']): { code: FailureCodeType; message: string } {
  const name = error?.Error ?? 'PIPELINE_INTERNAL';
  const parsed = FailureCode.safeParse(name);
  const cause = error?.Cause ?? '';
  // A Lambda error arrives with its message JSON-encoded inside `Cause`.
  let message = cause;
  try {
    const inner = JSON.parse(cause) as { errorMessage?: string };
    if (typeof inner.errorMessage === 'string') message = inner.errorMessage;
  } catch {
    /* plain text cause */
  }
  if (name === 'States.Timeout') message = message || 'the step timed out';
  return {
    code: parsed.success ? parsed.data : 'PIPELINE_INTERNAL',
    message: message || (parsed.success ? name : `${name}: no further detail`),
  };
}
