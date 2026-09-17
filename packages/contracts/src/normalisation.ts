import { z } from 'zod';
import { CategoryId, LineRef } from './ids';

/**
 * Which tier of the cascade resolved this line. The model is the last resort,
 * and accepted LLM answers are written back to the lexicon so the next claim
 * with the same description resolves at tier 1 for free.
 * See build spec §14.
 */
export const NormTier = z.enum([
  'LEXICON', // exact alias hit — confidence 1.00
  'LEXICON_FUZZY', // trigram similarity ≥ 0.92, single candidate
  'EMBEDDING', // Titan kNN, accepted on top1−top2 margin ≥ τ
  'LLM', // Claude tie-break, n=3 unanimous
  'UNRESOLVED', // margin below τ, or a split vote
]);
export type NormTier = z.infer<typeof NormTier>;

export const NormalisedLine = z.object({
  lineRef: LineRef,
  rawDescription: z.string(),
  categoryId: CategoryId.nullable(),
  tier: NormTier,
  /**
   * Derived from the embedding margin and sample agreement — NOT from the
   * model's self-reported confidence, which is not calibrated. Using a model's
   * own stated confidence as a routing signal is the most common unforced error
   * in LLM pipelines. See build spec §14.1.
   */
  confidence: z.number().min(0).max(1),
  /** Cosine margin between the best and second-best category, when tier 2 ran. */
  embeddingMargin: z.number().nullable(),
  /** The candidates the LLM was allowed to choose between. It never invents one. */
  candidates: z.array(CategoryId),
});
export type NormalisedLine = z.infer<typeof NormalisedLine>;

export const LexiconEntry = z.object({
  normalisedText: z.string(),
  categoryId: CategoryId,
  /** Provenance for write-backs, so a learned alias is auditable. */
  learnedFrom: z.string().nullable(),
  learnedAt: z.string().datetime().nullable(),
  tier: NormTier,
});
export type LexiconEntry = z.infer<typeof LexiconEntry>;
