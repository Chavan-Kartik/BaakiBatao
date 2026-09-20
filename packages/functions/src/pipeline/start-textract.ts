import { StartDocumentAnalysisCommand, TextractClient, type FeatureType, type Query } from '@aws-sdk/client-textract';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { DocumentKind } from '@fc/contracts';
import { required, ttlInHours } from '../shared/config';
import { rethrowCoded } from '../store/io';

/**
 * `StartTextract` (state 3a, `.waitForTaskToken`): `StartDocumentAnalysis`
 * with the SNS notification channel, then park the task token in DynamoDB
 * keyed by the Textract `JobId`. There is no `.sync` integration for async
 * Textract, so the completion handler is what wakes the execution (§11.3).
 *
 * The write follows the call because the JobId comes back from it. The
 * token row carries a 6-hour TTL and the state a `TimeoutSeconds`, so a lost
 * SNS message surfaces as a timed-out state — never a hung execution.
 *
 * Features per document follow §12: `TABLES`+`LAYOUT` on the bill and the
 * deduction sheet, `QUERIES` on the schedule (and the letter, for the paid
 * figure), `LAYOUT` on the wording.
 */
const textract = new TextractClient({});
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const FEATURES: Record<DocumentKind, FeatureType[]> = {
  ITEMISED_BILL: ['TABLES', 'LAYOUT', 'QUERIES'],
  DEDUCTION_SHEET: ['TABLES', 'LAYOUT', 'QUERIES'],
  SETTLEMENT_LETTER: ['QUERIES', 'LAYOUT'],
  POLICY_SCHEDULE: ['QUERIES', 'LAYOUT'],
  POLICY_WORDING: ['LAYOUT'],
  ENDORSEMENT: ['QUERIES', 'LAYOUT'],
};

/**
 * The questions asked of each document (§12.1). Aliases are what
 * `parse-tables` reads back; the text is what Textract's query model sees.
 * A missing answer stays missing — the parser maps it to null, and the
 * engine to UNRESOLVED — never to a default.
 */
export const QUERIES: Partial<Record<DocumentKind, Query[]>> = {
  POLICY_SCHEDULE: [
    { Alias: 'SUM_INSURED', Text: 'What is the sum insured?' },
    { Alias: 'ROOM_RENT_CAP_PER_DAY', Text: 'What is the room rent limit per day?' },
    { Alias: 'ROOM_RENT_CAP_PERCENT', Text: 'What percentage of sum insured is the room rent limit?' },
    { Alias: 'ICU_CAP_PER_DAY', Text: 'What is the ICU charges limit per day?' },
    { Alias: 'COPAY_PERCENT', Text: 'What is the co-payment percentage?' },
    { Alias: 'DEDUCTIBLE', Text: 'What is the deductible amount?' },
    { Alias: 'POLICY_START', Text: 'What is the policy start date?' },
    { Alias: 'POLICY_END', Text: 'What is the policy end date?' },
    { Alias: 'ELIGIBLE_ROOM', Text: 'What room category is the insured eligible for?' },
    { Alias: 'INSURER', Text: 'What is the name of the insurance company?' },
  ],
  ITEMISED_BILL: [
    { Alias: 'ADMISSION_DATE', Text: 'What is the date of admission?' },
    { Alias: 'DISCHARGE_DATE', Text: 'What is the date of discharge?' },
    { Alias: 'ROOM_TYPE', Text: 'What type of room was occupied?' },
    { Alias: 'ROOM_RENT_PER_DAY', Text: 'What is the room rent per day?' },
    { Alias: 'BILL_TOTAL', Text: 'What is the total bill amount?' },
  ],
  DEDUCTION_SHEET: [
    { Alias: 'AMOUNT_PAID', Text: 'What is the total amount approved or paid?' },
    { Alias: 'AMOUNT_CLAIMED', Text: 'What is the total amount claimed?' },
  ],
  SETTLEMENT_LETTER: [
    { Alias: 'AMOUNT_PAID', Text: 'What is the settled or paid amount?' },
    { Alias: 'CLAIM_NUMBER', Text: 'What is the claim number?' },
  ],
  ENDORSEMENT: [
    { Alias: 'RIDER_NAME', Text: 'What rider or endorsement is added?' },
    { Alias: 'EFFECTIVE_FROM', Text: 'From which date is the endorsement effective?' },
  ],
};

export interface StartTextractInput {
  readonly caseId: string;
  readonly doc: { readonly kind: DocumentKind; readonly key: string; readonly contentType: string };
  readonly taskToken: string;
}

export const handler = async (event: StartTextractInput): Promise<{ jobId: string }> => {
  try {
    const kind = event.doc.kind;
    const started = await textract.send(
      new StartDocumentAnalysisCommand({
        DocumentLocation: { S3Object: { Bucket: required('RAW_BUCKET'), Name: event.doc.key } },
        FeatureTypes: FEATURES[kind],
        QueriesConfig: QUERIES[kind] ? { Queries: QUERIES[kind] } : undefined,
        NotificationChannel: { SNSTopicArn: required('TEXTRACT_TOPIC_ARN'), RoleArn: required('TEXTRACT_ROLE_ARN') },
        // Lets the completion handler find the case without a second lookup.
        JobTag: event.caseId.slice(0, 64),
      }),
    );
    const jobId = started.JobId;
    if (!jobId) throw new Error('Textract returned no JobId');

    await doc.send(
      new PutCommand({
        TableName: required('TABLE_NAME'),
        Item: {
          pk: `TOKEN#${jobId}`,
          sk: 'TOKEN',
          taskToken: event.taskToken,
          caseId: event.caseId,
          kind,
          key: event.doc.key,
          ttl: ttlInHours(6),
        },
      }),
    );
    return { jobId };
  } catch (e) {
    rethrowCoded(e);
  }
};
