import { loadRulepackV1 } from '@fc/rulepack';
import { describe, expect, it } from 'vitest';
import { buildLexicon } from './lexicon';
import { resolveTier1 } from './cascade';
import { normaliseText } from './text';

const rulepack = loadRulepackV1();

describe('buildLexicon', () => {
  it('builds from the rulepack alone', () => {
    const lexicon = buildLexicon(rulepack);
    expect(lexicon.version).toBe(rulepack.version);
    expect(lexicon.exact.size).toBeGreaterThan(0);
    expect(lexicon.entries.length).toBe(lexicon.exact.size);
  });

  it('adds learned aliases, and resolves them at tier 1', () => {
    const categoryId = Object.keys(rulepack.categories)[0]!;
    const phrase = 'Hospital-Specific Widget Charge';
    const seed = buildLexicon(rulepack);
    expect(resolveTier1(phrase, seed).categoryId).toBeNull();

    const learned = buildLexicon(rulepack, { [normaliseText(phrase)]: categoryId });
    const hit = resolveTier1(phrase, learned);
    expect(hit.categoryId).toBe(categoryId);
    expect(hit.tier).toBe('LEXICON');
  });

  it('never lets a learned alias override the rulepack', () => {
    const [first, second] = Object.keys(rulepack.categories);
    const seed = buildLexicon(rulepack);
    const [existingKey, owner] = [...seed.exact.entries()][0]!;
    const other = owner === first ? second! : first!;

    const learned = buildLexicon(rulepack, { [existingKey]: other });
    expect(learned.exact.get(existingKey)).toBe(owner);
  });

  it('skips a learned alias naming a category the rulepack no longer has', () => {
    const lexicon = buildLexicon(rulepack, { 'some old phrase': 'CATEGORY_DELETED_IN_V2' });
    expect(lexicon.exact.has('some old phrase')).toBe(false);
  });
});

/**
 * The lexicon holds a `Map` and `Set`s, so it cannot be persisted: DynamoDB
 * unmarshals a map as a plain object and `exact.get` comes back `undefined`,
 * which broke every case in production once one had been written. It is built
 * from the rulepack on every use instead, and only plain `key → categoryId`
 * strings are stored. This test is what keeps that true.
 */
describe('the lexicon is derived, not stored', () => {
  it('does not survive a JSON round-trip, which is why nothing round-trips it', () => {
    const revived = JSON.parse(JSON.stringify(buildLexicon(rulepack))) as { exact: unknown };
    expect(typeof (revived.exact as { get?: unknown }).get).toBe('undefined');
  });

  it('learned aliases do survive one, because they are plain strings', () => {
    const categoryId = Object.keys(rulepack.categories)[0]!;
    const phrase = 'Hospital Widget Charge';
    const learned = { [normaliseText(phrase)]: categoryId };
    const revived = JSON.parse(JSON.stringify(learned)) as typeof learned;
    expect(revived).toEqual(learned);
    // Resolved through the matcher, not by key lookup: that is what the
    // pipeline actually does with a row it reads off a bill.
    expect(resolveTier1(phrase, buildLexicon(rulepack, revived)).categoryId).toBe(categoryId);
  });
});
