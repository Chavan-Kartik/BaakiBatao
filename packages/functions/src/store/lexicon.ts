import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { LearnedAliases } from '@fc/normalise';

/**
 * What the lexicon actually persists: accepted tier-3 answers (§14.2), as
 * `normalised key → categoryId` strings on one item,
 * `LEXICON#<version> / ALIASES`.
 *
 * The seed is **not** stored. It is built from the rulepack on every
 * invocation — pure, milliseconds, and the rulepack is hash-pinned, so a
 * cached copy could only be stale. Storing the built `Lexicon` was also a
 * latent crash: it holds a `Map` and `Set`s, DynamoDB unmarshals a map as a
 * plain object, and the next read produced a lexicon whose `exact.get` was
 * `undefined` — which failed every case, including the demo. Keeping only
 * plain strings here means a row that comes back cannot be the wrong shape.
 *
 * The write is an `UpdateCommand` on one nested key, so two Lambdas learning
 * different aliases at the same time do not overwrite each other.
 */
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export interface LexiconStoreConfig {
  readonly tableName: string;
  /** The rulepack version whose lexicon this is. Aliases do not cross versions. */
  readonly version: string;
}

const key = (config: LexiconStoreConfig) => ({ pk: `LEXICON#${config.version}`, sk: 'ALIASES' });

/**
 * Every learned alias for this rulepack version. An absent item, a malformed
 * one, or anything that is not a string pair is treated as "nothing learned
 * yet": the seed alone is a correct lexicon, so this must never be the reason
 * a case fails.
 */
export async function readLearnedAliases(config: LexiconStoreConfig): Promise<LearnedAliases> {
  try {
    const out = await doc.send(new GetCommand({ TableName: config.tableName, Key: key(config) }));
    const aliases = (out.Item as { aliases?: unknown } | undefined)?.aliases;
    if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) return {};
    const clean: Record<string, string> = {};
    for (const [alias, categoryId] of Object.entries(aliases as Record<string, unknown>)) {
      if (typeof alias === 'string' && typeof categoryId === 'string') clean[alias] = categoryId;
    }
    return clean;
  } catch (e) {
    console.warn(`lexicon: could not read learned aliases (${String(e)}); using the rulepack seed alone`);
    return {};
  }
}

/** Records one accepted tier-3 answer. Idempotent, and independent of every other alias. */
export async function learnAlias(
  config: LexiconStoreConfig,
  normalisedKey: string,
  categoryId: string,
): Promise<void> {
  await doc.send(
    new UpdateCommand({
      TableName: config.tableName,
      Key: key(config),
      UpdateExpression: 'SET #aliases = if_not_exists(#aliases, :empty), #aliases.#key = :categoryId, #at = :now',
      ExpressionAttributeNames: { '#aliases': 'aliases', '#key': normalisedKey, '#at': 'updatedAt' },
      ExpressionAttributeValues: { ':empty': {}, ':categoryId': categoryId, ':now': new Date().toISOString() },
    }),
  );
}
