import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { Lexicon } from '@fc/normalise';

/**
 * The tier-1 lexicon lives in the single table as `LEXICON#v1/LEXICON` and is
 * seeded from `@fc/normalise`'s `buildLexicon` — the same seed the local
 * harness measures, which is the only reason a Lambda can trust it. Tier-3
 * write-backs (§14.2) land on the same item with provenance, so the next
 * claim with that description resolves at tier 1 for free.
 */
const client = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });

export interface LexiconStoreConfig {
  readonly tableName: string;
}

const LEXICON_PK = 'LEXICON#v1';
const LEXICON_SK = 'LEXICON';

export async function readLexicon(config: LexiconStoreConfig): Promise<Lexicon | null> {
  const out = await doc.send(
    new GetCommand({ TableName: config.tableName, Key: { pk: LEXICON_PK, sk: LEXICON_SK } }),
  );
  return ((out.Item as { lexicon?: Lexicon } | undefined)?.lexicon ?? null);
}

export async function writeLexicon(config: LexiconStoreConfig, lexicon: Lexicon): Promise<void> {
  await doc.send(
    new PutCommand({
      TableName: config.tableName,
      Item: { pk: LEXICON_PK, sk: LEXICON_SK, lexicon },
    }),
  );
}
