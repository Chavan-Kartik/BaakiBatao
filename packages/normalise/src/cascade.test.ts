import { describe, expect, it } from 'vitest';
import { loadRulepackV1 } from '@fc/rulepack';
import { buildLexicon } from './lexicon';
import { createNormaliser, resolveTier1 } from './cascade';
import { normaliseText } from './text';
import { similarity, trigrams } from './trigram';

const lexicon = buildLexicon(loadRulepackV1());

describe('tier 1 — the lexicon', () => {
  it('builds from the v1 rulepack without an alias collision after expansion', () => {
    expect(lexicon.entries.length).toBeGreaterThan(200);
  });

  it('resolves an exact alias at confidence 1.00', () => {
    const r = resolveTier1('Surgeon Fee', lexicon);
    expect(r).toMatchObject({ categoryId: 'SURGEON_FEE', tier: 'LEXICON', confidence: 1 });
  });

  it('normalises case, punctuation, whitespace and abbreviations before looking up', () => {
    expect(normaliseText('  ROOM-RENT / Bed  Chgs. ')).toBe('room rent bed charges');
    expect(resolveTier1('X-RAY', lexicon).categoryId).toBe('IMAGING');
    expect(resolveTier1('Dr. Visit', lexicon).categoryId).toBe('DOCTOR_VISIT');
    expect(resolveTier1('Anaesthetist Chgs', lexicon).categoryId).toBe('ANAESTHETIST_FEE');
  });

  it('accepts a near miss at the fuzzy tier, at the fixed 0.95', () => {
    const r = resolveTier1('Anaesthetist fee s', lexicon, { fuzzyThreshold: 0.8, candidateCount: 5 });
    expect(r.tier).toBe('LEXICON_FUZZY');
    expect(r.categoryId).toBe('ANAESTHETIST_FEE');
    expect(r.confidence).toBe(0.95);
  });

  /**
   * The rulepack deliberately gives "pharmacy & consumables" to nobody. The
   * lexicon must not resolve it by proximity either: it is closer to both
   * halves than to anything else, and that is exactly the split the cascade
   * has to surface rather than settle.
   */
  it('escalates the ambiguous combined pharmacy-and-consumables line', () => {
    const r = resolveTier1('Pharmacy & Consumables', lexicon);
    expect(r.categoryId).toBeNull();
    expect(r.tier).toBe('UNRESOLVED');
    expect(r.candidates.slice(0, 2)).toEqual(expect.arrayContaining(['PHARMACY', 'CONSUMABLE']));
  });

  it('escalates when two categories both clear the threshold, rather than picking by a hair', () => {
    // Below the default threshold both halves would qualify at a lax one.
    const r = resolveTier1('pharmacy consumables', lexicon, { fuzzyThreshold: 0.3, candidateCount: 5 });
    expect(r.categoryId).toBeNull();
    expect(r.candidates.length).toBeGreaterThan(1);
  });

  it('escalates free text the lexicon has never seen', () => {
    const r = resolveTier1('Inj Pantoprazole 40mg IV BD', lexicon);
    expect(r.tier).toBe('UNRESOLVED');
    expect(r.confidence).toBe(0);
  });

  it('hands escalation a ranked candidate list and honours its answer', () => {
    const n = createNormaliser(lexicon, undefined, (_text, candidates) => ({
      categoryId: candidates[0] ?? null,
      tier: 'LLM',
      confidence: 0.9,
      embeddingMargin: null,
    }));
    const line = n.normalise('doc:1:0' as never, 'Inj Pantoprazole 40mg IV BD');
    expect(line.tier).toBe('LLM');
    expect(line.candidates.length).toBeGreaterThan(0);
    expect(line.categoryId).toBe(line.candidates[0]);
  });

  it('is deterministic', () => {
    const a = resolveTier1('Laboratory & Imaging', lexicon);
    const b = resolveTier1('Laboratory & Imaging', lexicon);
    expect(a).toEqual(b);
  });
});

describe('trigram similarity', () => {
  it('is 1 for identical text and 0 for disjoint text', () => {
    expect(similarity(trigrams('pharmacy'), trigrams('pharmacy'))).toBe(1);
    expect(similarity(trigrams('pharmacy'), trigrams('xyzzy'))).toBe(0);
  });

  it('falls with a suffix rather than collapsing to zero', () => {
    const base = trigrams('pharmacy');
    const suffixed = similarity(base, trigrams('pharmacy day 2'));
    expect(suffixed).toBeGreaterThan(0.3);
    expect(suffixed).toBeLessThan(0.92);
  });
});
