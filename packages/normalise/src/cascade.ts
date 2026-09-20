import type { CategoryId, LineRef, NormalisedLine } from '@fc/contracts';
import type { Lexicon } from './lexicon';
import { normaliseText } from './text';
import { similarity, trigrams } from './trigram';

/**
 * Tier 1 of the cascade (§14).
 *
 *   exact hit                                    → confidence 1.00, tier LEXICON
 *   trigram similarity ≥ τ, one category above τ → confidence 0.95, tier LEXICON_FUZZY
 *   otherwise                                    → escalate
 *
 * The confidences are the fixed values the spec assigns to the tier, never a
 * score dressed up as a probability. What the fuzzy tier is allowed to accept
 * is governed by one number, `fuzzyThreshold`, and that number is calibrated
 * by `pnpm eval:calibrate` rather than chosen — see docs/evaluation.md.
 *
 * Escalation here goes straight to UNRESOLVED. Tiers 2 and 3 (Titan
 * embeddings, the Claude tie-break) need Bedrock and are plugged in through
 * `escalate`; without them a line the lexicon cannot place is a line the
 * engine must not adjudicate, which is the honest local answer.
 */
export interface Tier1Options {
  /** Minimum trigram similarity for a fuzzy hit. Default 0.92 per §14. */
  readonly fuzzyThreshold: number;
  /** How many ranked candidates to hand the next tier. Default 5. */
  readonly candidateCount: number;
}

export const DEFAULT_TIER1: Tier1Options = { fuzzyThreshold: 0.92, candidateCount: 5 };

export interface Tier1Result {
  readonly categoryId: CategoryId | null;
  readonly tier: NormalisedLine['tier'];
  readonly confidence: number;
  /** Best trigram similarity seen, whichever tier answered. */
  readonly similarity: number;
  /** Categories ranked by similarity, best first — what tier 2/3 would choose among. */
  readonly candidates: readonly CategoryId[];
}

export function resolveTier1(
  rawDescription: string,
  lexicon: Lexicon,
  options: Tier1Options = DEFAULT_TIER1,
): Tier1Result {
  const key = normaliseText(rawDescription);

  const exact = lexicon.exact.get(key);
  if (exact !== undefined) {
    return { categoryId: exact, tier: 'LEXICON', confidence: 1, similarity: 1, candidates: [exact] };
  }

  const grams = trigrams(key);
  const bestByCategory = new Map<CategoryId, number>();
  for (const entry of lexicon.entries) {
    const s = similarity(grams, entry.grams);
    if (s > (bestByCategory.get(entry.categoryId) ?? 0)) bestByCategory.set(entry.categoryId, s);
  }

  const ranked = [...bestByCategory.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, options.candidateCount);

  const top = ranked[0];
  const candidates = ranked.map(([c]) => c);
  const best = top?.[1] ?? 0;

  // "Single candidate" is the guard that matters: two categories both above
  // the threshold means the text is genuinely between them, and picking the
  // higher one by a hair is exactly the confident guess this tier must not
  // make. It escalates instead, carrying both as candidates.
  const above = ranked.filter(([, s]) => s >= options.fuzzyThreshold);
  if (top && above.length === 1) {
    return { categoryId: top[0], tier: 'LEXICON_FUZZY', confidence: 0.95, similarity: best, candidates };
  }

  return { categoryId: null, tier: 'UNRESOLVED', confidence: 0, similarity: best, candidates };
}

/**
 * A later tier, given what tier 1 could not place. Returns null to leave the
 * line unresolved. Bedrock-backed implementations live in packages/functions;
 * the harness runs with none.
 */
export type Escalation = (
  rawDescription: string,
  candidates: readonly CategoryId[],
) => Pick<NormalisedLine, 'categoryId' | 'tier' | 'confidence' | 'embeddingMargin'> | null;

export interface Normaliser {
  readonly lexiconVersion: string;
  normalise(lineRef: LineRef, rawDescription: string): NormalisedLine;
}

export function createNormaliser(
  lexicon: Lexicon,
  options: Tier1Options = DEFAULT_TIER1,
  escalate: Escalation | null = null,
): Normaliser {
  return {
    lexiconVersion: lexicon.version,
    normalise(lineRef, rawDescription) {
      const t1 = resolveTier1(rawDescription, lexicon, options);
      if (t1.categoryId !== null) {
        return {
          lineRef,
          rawDescription,
          categoryId: t1.categoryId,
          tier: t1.tier,
          confidence: t1.confidence,
          embeddingMargin: null,
          candidates: [...t1.candidates],
        };
      }

      const later = escalate?.(rawDescription, t1.candidates) ?? null;
      return {
        lineRef,
        rawDescription,
        categoryId: later?.categoryId ?? null,
        tier: later?.tier ?? 'UNRESOLVED',
        confidence: later?.confidence ?? 0,
        embeddingMargin: later?.embeddingMargin ?? null,
        candidates: [...t1.candidates],
      };
    },
  };
}
