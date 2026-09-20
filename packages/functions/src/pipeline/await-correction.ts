import { rethrowCoded, stageDeps } from '../store/io';

/**
 * `AwaitHumanCorrection` (state 7, `.waitForTaskToken`): park the execution.
 * The token goes on the case record as `correctionTaskToken` and the status
 * becomes `AWAITING_CORRECTION`, which is what the UI's correction grid
 * keys on. `POST /cases/{id}/corrections` applies the edits, clears the
 * token and calls `SendTaskSuccess`; the execution resumes at `Normalise`
 * with the corrected rows already on the record.
 *
 * The state's own `TimeoutSeconds` (24 h) is what ends a correction nobody
 * makes — the Lambda returns immediately and holds nothing open.
 */
export const handler = async (event: { caseId: string; taskToken: string }): Promise<{ parked: true }> => {
  const deps = stageDeps();
  try {
    await deps.store.update(event.caseId, (r) => ({
      ...r,
      status: 'AWAITING_CORRECTION',
      correctionTaskToken: event.taskToken,
    }));
    return { parked: true };
  } catch (e) {
    rethrowCoded(e);
  }
};
