import type { CreateCaseResponse } from '@fc/contracts';
import type { CaseRecord } from '../store/case-store';
import { resumeAfterCorrection, runPipeline, type PipelineDeps } from './run';

/**
 * How a case gets from "uploaded" to "running", behind an interface.
 *
 * Locally the pipeline is `runPipeline` in this process and uploads are `PUT`
 * routes on this server. On AWS the uploads are presigned S3 POSTs that never
 * touch the API, and the pipeline is a Step Functions execution. The routes
 * call these four methods and do not know which they got.
 */
export interface PipelineRunner {
  readonly name: string;
  /** One upload target per declared document. */
  uploadTargets(caseId: string, docs: CaseRecord['expected']): Promise<CreateCaseResponse['uploads']>;
  /**
   * Uploads that bypassed the API (presigned POSTs) are recorded on the case
   * here, before `submit` checks that every declared document arrived. The
   * local runner has nothing to collect: its uploads went through `PUT`.
   */
  collect(record: CaseRecord): Promise<CaseRecord>;
  /** Run the pipeline from the top. Returns once the run is launched, not finished. */
  start(caseId: string): Promise<void>;
  /**
   * Resume after a correction. `record` is the case as it was before the
   * correction was applied — its status says whether the run is parked on a
   * checksum failure (a task token to redeem) or complete (a fresh run from
   * normalisation).
   */
  resume(record: CaseRecord): Promise<void>;
}

export function localRunner(deps: PipelineDeps, baseUrl: string): PipelineRunner {
  return {
    name: 'in-process',
    async uploadTargets(caseId, docs) {
      return docs.map((d) => ({
        kind: d.kind,
        url: `${baseUrl}/api/cases/${caseId}/documents/${d.kind}`,
        fields: {},
      }));
    },
    async collect(record) {
      return record;
    },
    async start(caseId) {
      void runPipeline(deps, caseId);
    },
    async resume(record) {
      void resumeAfterCorrection(deps, record.caseId);
    },
  };
}
