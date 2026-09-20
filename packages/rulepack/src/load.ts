import type { Rulepack, Sha256 } from '@fc/contracts';
import stepsJson from '../data/v1/steps.json';
import clausesJson from '../data/v1/clauses.json';
import categoriesJson from '../data/v1/categories.json';
import roundingJson from '../data/v1/rounding.json';
import lockJson from '../data/v1.lock.json';
import {
  CategoriesFile,
  ClausesFile,
  LockFile,
  RoundingFile,
  StepsFile,
  stripComments,
} from './schema';

/**
 * Loads, validates and freezes a rulepack.
 *
 * Validation is not ceremony: a malformed rule is the one input that could make
 * the engine produce a confident wrong number, so it fails at load time rather
 * than mid-waterfall. The hash is pinned into every certificate, which is what
 * lets an old certificate still verify after a rule is corrected.
 *
 * Spec: build spec §9.3
 */
export function loadRulepackV1(): Rulepack {
  const steps = StepsFile.parse(stepsJson);
  const clauses = ClausesFile.parse(stripComments(clausesJson as Record<string, unknown>));
  const categories = CategoriesFile.parse(
    stripComments(categoriesJson as Record<string, unknown>),
  );
  const rounding = RoundingFile.parse(stripComments(roundingJson as Record<string, unknown>));
  const lock = LockFile.parse(lockJson);

  assertReferentialIntegrity(clauses, categories);

  return Object.freeze({
    version: lock.version,
    hash: lock.hash as Sha256,
    steps: steps.steps,
    clauses,
    categories,
    rounding,
  });
}

/**
 * The category ↔ clause contract, asserted at load time.
 *
 * A category pointing at a clause that does not exist would silently produce
 * findings with dangling citations — the exact failure that would embarrass us
 * in front of a judge who clicks through to the clause. The remaining rules are
 * the same failure one step removed: a clause that exists but says something
 * other than what the finding will use it to say.
 *
 *   an AME exclusion must cite a clause whose effect is EXCLUDE_FROM_AME, or
 *   IMMUNE_TO_PROPORTIONATE when the category is immune (ICU and its kin);
 *
 *   an AME-eligible category cannot also carry an exclusion clause — step 5
 *   would be told both "in the base" and "cited out of it";
 *
 *   a rider can only buy back an item that is on the non-payable list;
 *
 *   aliases are unique after the normalisation the lexicon applies, not just
 *   as spelled — "X-ray" and "x ray" are the same lookup key.
 */
function assertReferentialIntegrity(
  clauses: Rulepack['clauses'],
  categories: Rulepack['categories'],
): void {
  const seenAlias = new Map<string, string>();

  for (const [id, cat] of Object.entries(categories)) {
    if (cat.categoryId !== id) {
      throw new Error(`category ${id} declares categoryId ${cat.categoryId}`);
    }

    if (cat.ameExclusionClause) {
      const clause = clauses[cat.ameExclusionClause];
      if (!clause) {
        throw new Error(
          `category ${id} references clause ${cat.ameExclusionClause}, which is not in clauses.json`,
        );
      }
      const expected = cat.proportionateImmune ? 'IMMUNE_TO_PROPORTIONATE' : 'EXCLUDE_FROM_AME';
      if (clause.effect !== expected) {
        throw new Error(
          `category ${id} cites ${cat.ameExclusionClause} as its AME exclusion, but that clause's effect is ${clause.effect}, not ${expected}`,
        );
      }
      if (cat.ameEligible) {
        throw new Error(`category ${id} is AME-eligible and also carries an AME exclusion clause`);
      }
    }

    if (cat.proportionateImmune && !cat.ameExclusionClause) {
      throw new Error(`category ${id} is immune to proportionate deduction but cites no clause for it`);
    }

    if (cat.riderCanCover.length > 0 && cat.annexure !== 'II') {
      throw new Error(`category ${id} names a rider but is not on the non-payable list`);
    }

    for (const alias of cat.aliases) {
      const key = normaliseAlias(alias);
      const owner = seenAlias.get(key);
      if (owner !== undefined && owner !== id) {
        throw new Error(`alias "${alias}" is claimed by both ${owner} and ${id}`);
      }
      seenAlias.set(key, id);
    }
  }
}

/** The lexicon's lookup key: casefold, drop punctuation, collapse whitespace. */
export const normaliseAlias = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
