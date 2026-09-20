import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { CaseRecord, CaseStore } from '@fc/api';
import { ttlInHours } from '../shared/config';

/**
 * `CaseStore` on the single table (build spec §17).
 *
 * The record is one item, `CASE#<id> / STATE#CURRENT`, exactly the JSON the
 * filesystem store writes — events included, so the SSE view and the timeline
 * read the same list either way. `listByOwner` is GSI1 (`OWNER#<id>`), newest
 * first by `createdAt`.
 *
 * `update` is read-modify-write under optimistic concurrency: every item
 * carries a `version`, the put is conditional on it, and a lost race retries
 * the mutation on the fresh record. That is what makes it safe for the API
 * Lambda and a pipeline Lambda to touch the same case at the same moment —
 * the correction route and `AwaitHumanCorrection`, for one.
 *
 * Every `CASE#` item carries a 24-hour `ttl`, refreshed on write: the
 * mechanism behind "nothing stores real personal data beyond the demo
 * session", next to the 1-day lifecycle on `raw/`.
 */
const CASE_TTL_HOURS = 24;
const RETRIES = 8;

export class DynamoCaseStore implements CaseStore {
  private readonly doc: DynamoDBDocumentClient;

  constructor(
    private readonly tableName: string,
    client: DynamoDBClient = new DynamoDBClient({}),
  ) {
    this.doc = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  }

  async create(record: CaseRecord): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: this.item(record, 1),
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
  }

  async get(caseId: string): Promise<CaseRecord | null> {
    const found = await this.read(caseId);
    return found?.record ?? null;
  }

  async listByOwner(ownerId: string): Promise<CaseRecord[]> {
    const records: CaseRecord[] = [];
    let cursor: Record<string, unknown> | undefined;
    do {
      const page = await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'gsi1',
          KeyConditionExpression: 'gsi1pk = :owner',
          ExpressionAttributeValues: { ':owner': ownerPk(ownerId) },
          ScanIndexForward: false,
          ExclusiveStartKey: cursor,
        }),
      );
      for (const item of page.Items ?? []) records.push((item as StoredItem).record);
      cursor = page.LastEvaluatedKey;
    } while (cursor);
    return records;
  }

  async update(caseId: string, mutate: (r: CaseRecord) => CaseRecord): Promise<CaseRecord> {
    for (let attempt = 0; ; attempt++) {
      const current = await this.read(caseId);
      if (!current) throw new Error(`case ${caseId} not found`);
      const updated: CaseRecord = { ...mutate(current.record), updatedAt: new Date().toISOString() };
      try {
        await this.doc.send(
          new PutCommand({
            TableName: this.tableName,
            Item: this.item(updated, current.version + 1),
            ConditionExpression: 'version = :expected',
            ExpressionAttributeValues: { ':expected': current.version },
          }),
        );
        return updated;
      } catch (e) {
        if (!(e instanceof ConditionalCheckFailedException) || attempt >= RETRIES) throw e;
        await new Promise((r) => setTimeout(r, 20 * (attempt + 1) + Math.random() * 40));
      }
    }
  }

  private async read(caseId: string): Promise<{ record: CaseRecord; version: number } | null> {
    const out = await this.doc.send(
      new GetCommand({ TableName: this.tableName, Key: { pk: casePk(caseId), sk: STATE_CURRENT }, ConsistentRead: true }),
    );
    const item = out.Item as StoredItem | undefined;
    return item ? { record: item.record, version: item.version } : null;
  }

  private item(record: CaseRecord, version: number): StoredItem {
    return {
      pk: casePk(record.caseId),
      sk: STATE_CURRENT,
      gsi1pk: ownerPk(record.ownerId),
      gsi1sk: record.createdAt,
      version,
      ttl: ttlInHours(CASE_TTL_HOURS),
      record,
    };
  }
}

interface StoredItem {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  version: number;
  ttl: number;
  record: CaseRecord;
}

const STATE_CURRENT = 'STATE#CURRENT';
export const casePk = (caseId: string): string => `CASE#${caseId}`;
export const ownerPk = (ownerId: string): string => `OWNER#${ownerId}`;
