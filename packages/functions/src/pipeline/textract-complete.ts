import { GetDocumentAnalysisCommand, TextractClient, type Block } from '@aws-sdk/client-textract';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { SNSEvent } from 'aws-lambda';
import { required } from '../shared/config';
import { failWithCode, resumeWithOutput } from '../shared/task-tokens';
import { putJson } from '../store/documents';

/**
 * `textract-complete`: the SNS handler for Textract's notification channel
 * (§11.3). Looks the parked token up by `JobId`, pages through
 * `GetDocumentAnalysis` accumulating Blocks, writes them to the raw bucket
 * under `textract/<caseId>/<kind>.json` — a 14-page document's blocks do not
 * fit a Step Functions payload — and wakes the execution with the key. A
 * `FAILED` job fails the parked state with `TEXTRACT_NO_TABLE_FOUND`.
 *
 * Blocks are raw text, so they live in the raw bucket, on the near side of
 * the redaction gate.
 */
const textract = new TextractClient({});
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface TextractNotification {
  readonly JobId: string;
  readonly Status: 'SUCCEEDED' | 'FAILED' | 'PARTIAL_SUCCESS';
  readonly StatusMessage?: string;
}

interface TokenRow {
  readonly taskToken: string;
  readonly caseId: string;
  readonly kind: string;
  readonly key: string;
}

export const handler = async (event: SNSEvent): Promise<void> => {
  for (const record of event.Records) {
    const notice = JSON.parse(record.Sns.Message) as TextractNotification;
    await complete(notice);
  }
};

export async function complete(notice: TextractNotification): Promise<void> {
  const tableName = required('TABLE_NAME');
  const key = { pk: `TOKEN#${notice.JobId}`, sk: 'TOKEN' };
  const row = (await doc.send(new GetCommand({ TableName: tableName, Key: key }))).Item as TokenRow | undefined;
  if (!row) {
    // A duplicate delivery after the token was consumed, or a job nobody
    // parked. Either way there is nothing to wake.
    console.warn(`no parked task token for Textract job ${notice.JobId}`);
    return;
  }

  try {
    if (notice.Status === 'FAILED') {
      await failWithCode(
        row.taskToken,
        'TEXTRACT_NO_TABLE_FOUND',
        `Textract could not analyse the ${row.kind}: ${notice.StatusMessage ?? 'job failed'}`,
      );
      return;
    }

    const blocks = await allBlocks(notice.JobId);
    const blocksKey = await putJson(required('RAW_BUCKET'), `textract/${row.caseId}/${row.kind}.json`, {
      jobId: notice.JobId,
      status: notice.Status,
      blocks,
    });
    await resumeWithOutput(row.taskToken, JSON.stringify({ blocksKey, blockCount: blocks.length }));
  } finally {
    await doc.send(new DeleteCommand({ TableName: tableName, Key: key }));
  }
}

async function allBlocks(jobId: string): Promise<Block[]> {
  const blocks: Block[] = [];
  let nextToken: string | undefined;
  do {
    const page = await textract.send(new GetDocumentAnalysisCommand({ JobId: jobId, NextToken: nextToken }));
    blocks.push(...(page.Blocks ?? []));
    nextToken = page.NextToken;
  } while (nextToken);
  return blocks;
}
