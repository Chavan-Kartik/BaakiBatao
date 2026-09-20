import type { CategoryId, Rulepack } from '@fc/contracts';
import { normaliseText } from './text';
import { trigrams } from './trigram';

export interface LexiconEntry {
  readonly key: string;
  readonly categoryId: CategoryId;
  readonly grams: ReadonlySet<string>;
}

/**
 * The tier-1 lexicon, built from the rulepack's category aliases.
 *
 * In production this is the `LEXICON#v1 / ALIAS#<normalised>` DynamoDB table
 * with tier-3 write-backs on top; here it is the seed that table starts from,
 * which is the only part the local harness can measure. The shape is the same
 * so the matcher does not care which one it was given.
 */
export interface Lexicon {
  readonly version: string;
  readonly exact: ReadonlyMap<string, CategoryId>;
  readonly entries: readonly LexiconEntry[];
}

/**
 * Two aliases from different categories collapsing onto one key after
 * normalisation is a lexicon that answers the same question two ways, so it
 * refuses to build. The rulepack loader checks the same thing on a plainer
 * key; this catches what abbreviation expansion adds.
 */
export function buildLexicon(rulepack: Rulepack): Lexicon {
  const exact = new Map<string, CategoryId>();
  const entries: LexiconEntry[] = [];

  for (const category of Object.values(rulepack.categories)) {
    for (const alias of category.aliases) {
      const key = normaliseText(alias);
      if (key.length === 0) continue;
      const owner = exact.get(key);
      if (owner !== undefined && owner !== category.categoryId) {
        throw new Error(
          `lexicon: alias "${alias}" normalises to "${key}", claimed by both ${owner} and ${category.categoryId}`,
        );
      }
      if (owner === undefined) {
        exact.set(key, category.categoryId);
        entries.push({ key, categoryId: category.categoryId, grams: trigrams(key) });
      }
    }
  }

  return { version: rulepack.version, exact, entries };
}
