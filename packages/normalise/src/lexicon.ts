import type { CategoryId, Rulepack } from '@fc/contracts';
import { normaliseText } from './text';
import { trigrams } from './trigram';

export interface LexiconEntry {
  readonly key: string;
  readonly categoryId: CategoryId;
  readonly grams: ReadonlySet<string>;
}

/**
 * The tier-1 lexicon, built from the rulepack's category aliases plus any
 * aliases a tier-3 answer has been accepted for (§14.2).
 *
 * **This object is derived, never stored.** It holds a `Map` and `Set`s, which
 * do not survive a JSON or DynamoDB round-trip — an unmarshalled `Map` comes
 * back as a plain object and `lexicon.exact.get` is then `undefined`. Building
 * it is pure and takes milliseconds, and the rulepack it is built from is
 * hash-pinned, so a cache would be a staleness bug on top of a
 * deserialisation one. What *is* persisted is `learnedAliases`: plain
 * `key → categoryId` strings, passed back in here.
 */
export interface Lexicon {
  readonly version: string;
  readonly exact: ReadonlyMap<string, CategoryId>;
  readonly entries: readonly LexiconEntry[];
}

/**
 * Accepted tier-3 answers, as the only shape worth storing: already
 * normalised keys mapped to category IDs. Plain strings, so any store can
 * hold them and reading one back cannot produce a broken `Lexicon`.
 */
export type LearnedAliases = Readonly<Record<string, string>>;

/**
 * Two aliases from different categories collapsing onto one key after
 * normalisation is a lexicon that answers the same question two ways, so it
 * refuses to build. The rulepack loader checks the same thing on a plainer
 * key; this catches what abbreviation expansion adds.
 */
export function buildLexicon(rulepack: Rulepack, learned: LearnedAliases = {}): Lexicon {
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

  // Learned aliases are added, never allowed to override the rulepack: a
  // write-back that contradicts a rule the system cites is a rule change, and
  // rule changes go through the rulepack. An entry naming a category the
  // rulepack does not have is skipped rather than fatal, so a stale row
  // survives a rulepack version bump without taking the pipeline down.
  for (const [rawKey, categoryId] of Object.entries(learned)) {
    const key = normaliseText(rawKey);
    if (key.length === 0 || exact.has(key)) continue;
    if (!(categoryId in rulepack.categories)) continue;
    const id = categoryId as CategoryId;
    exact.set(key, id);
    entries.push({ key, categoryId: id, grams: trigrams(key) });
  }

  return { version: rulepack.version, exact, entries };
}
