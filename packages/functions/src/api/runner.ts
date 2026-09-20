import { randomUUID } from 'node:crypto';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import type { CaseRecord, CaseStore, PipelineRunner } from '@fc/api';
import { presignUpload } from '../shared/presign';
import { resumeWithOutput } from '../shared/task-tokens';
import { describeRawObject, rawKey } from '../store/documents';

/**
 * `PipelineRunner` on AWS: presigned S3 POSTs in, a Step Functions execution
 * per run, and a task token to redeem when a human correction arrives.
 *
 * Two things differ from the local runner and both are deliberate:
 *
 *  - `collect` exists because presigned uploads never pass through the API.
 *    It records what actually landed under `raw/<caseId>/` — size, type,
 *    SHA-256 — so `submit` checks storage, not the client's word.
 *  - `resume` has two shapes. A case parked on a checksum failure holds a
 *    real task token, and `SendTaskSuccess` wakes the parked execution at
 *    `Normalise`. A completed case being corrected again has no execution to
 *    wake, so a fresh one starts at `Normalise` (§11.7 — same path, second
 *    entry point).
 */
export interface SfnRunnerConfig {
  readonly store: CaseStore;
  readonly rawBucket: string;
  readonly stateMachineArn: string;
  readonly maxUploadBytes: number;
}

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function sfnRunner(config: SfnRunnerConfig): PipelineRunner {
  const sfn = new SFNClient({});

  return {
    name: 'step-functions',

    async uploadTargets(caseId, docs) {
      return Promise.all(
        docs.map(async (d) => {
          const post = await presignUpload({
            bucket: config.rawBucket,
            key: rawKey(caseId, d.kind),
            contentType: d.contentType,
            maxBytes: config.maxUploadBytes,
          });
          return { kind: d.kind, url: post.url, fields: post.fields };
        }),
      );
    },

    async collect(record) {
      const landed = await Promise.all(
        record.expected.map(async (slot) => {
          const already = record.documents.find((d) => d.kind === slot.kind);
          if (already) return already;
          const facts = await describeRawObject(config.rawBucket, rawKey(record.caseId, slot.kind));
          if (!facts) return null;
          return {
            kind: slot.kind,
            filename: slot.filename,
            contentType: facts.contentType,
            byteLength: facts.byteLength,
            sha256: facts.sha256,
            key: rawKey(record.caseId, slot.kind),
          };
        }),
      );
      const documents = landed.filter((d): d is NonNullable<typeof d> => d !== null);
      if (documents.length === record.documents.length) return record;
      return config.store.update(record.caseId, (r) => ({ ...r, documents }));
    },

    async start(caseId) {
      await sfn.send(
        new StartExecutionCommand({
          stateMachineArn: config.stateMachineArn,
          name: executionName(caseId),
          input: JSON.stringify({ caseId, resumeFrom: null }),
        }),
      );
    },

    async resume(record: CaseRecord) {
      if (record.status === 'AWAITING_CORRECTION' && record.correctionTaskToken) {
        await resumeWithOutput(record.correctionTaskToken, JSON.stringify({ caseId: record.caseId, corrected: true }));
        return;
      }
      await sfn.send(
        new StartExecutionCommand({
          stateMachineArn: config.stateMachineArn,
          name: executionName(record.caseId),
          input: JSON.stringify({ caseId: record.caseId, resumeFrom: 'Normalise' }),
        }),
      );
    },
  };
}

/** Execution names are unique per state machine for 90 days, so each run gets a suffix. */
function executionName(caseId: string): string {
  return `${caseId.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 60)}-${randomUUID().slice(0, 8)}`;
}
