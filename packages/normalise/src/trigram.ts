/**
 * Trigram similarity, pg_trgm style: each word is padded with two leading
 * and one trailing space before being cut into 3-grams, so word boundaries
 * count as evidence. Similarity is |A ∩ B| / |A ∪ B|.
 *
 * Chosen over Levenshtein because billing text varies by whole tokens
 * ("pharmacy" / "pharmacy charges" / "pharmacy day 2") far more than by
 * single characters, and a set measure degrades gracefully with a suffix
 * while an edit distance does not.
 */
export function trigrams(normalised: string): Set<string> {
  const out = new Set<string>();
  for (const word of normalised.split(' ')) {
    if (word.length === 0) continue;
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}

export function similarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}
