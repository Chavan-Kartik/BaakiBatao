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
 * A category pointing at a clause that does not exist would silently produce
 * findings with dangling citations — the exact failure that would embarrass us
 * in front of a judge who clicks through to the clause.
 */
function assertReferentialIntegrity(
  clauses: Rulepack['clauses'],
  categories: Rulepack['categories'],
): void {
  for (const [id, cat] of Object.entries(categories)) {
    if (cat.ameExclusionClause && !clauses[cat.ameExclusionClause]) {
      throw new Error(
        `category ${id} references clause ${cat.ameExclusionClause}, which is not in clauses.json`,
      );
    }
  }
}
