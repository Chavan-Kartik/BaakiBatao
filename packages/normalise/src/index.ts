/**
 * @fc/normalise — tier 1 of the normalisation cascade (§14).
 *
 * Pure, like the engine: the same matcher runs in the Lambda that seeds the
 * DynamoDB lexicon, in the browser's correction grid, and in the eval harness
 * that calibrates its one threshold. Tiers 2 and 3 are Bedrock calls and plug
 * in through `Escalation`; nothing here imports them.
 */
export { normaliseText } from './text';
export { trigrams, similarity } from './trigram';
export { buildLexicon } from './lexicon';
export type { Lexicon, LexiconEntry, LearnedAliases } from './lexicon';
export { resolveTier1, createNormaliser, DEFAULT_TIER1 } from './cascade';
export type { Tier1Options, Tier1Result, Normaliser, Escalation } from './cascade';
