import type { NormalisedLine } from '@fc/contracts';
import { PipelineFailure } from '@fc/api';
import { buildLexicon, createNormaliser, DEFAULT_TIER1, type Lexicon } from '@fc/normalise';
import { required } from '../shared/config';
import { recordNormalisation } from '../shared/metrics';
import { emit, rethrowCoded, stageDeps, transition } from '../store/io';
import { readLexicon, writeLexicon } from '../store/lexicon';

/**
 * `Normalise` (state 8): the tier-1 cascade over the redacted bill rows —
 * exact and trigram-fuzzy against the lexicon, pure, the same code the eval
 * harness calibrates. Tiers 2 and 3 (Titan embeddings with a margin gate,
 * Claude as a tie-break) plug in through the normaliser's `Escalation` hook
 * and are not wired; a line tier 1 cannot place stays `null` and becomes an
 * UNRESOLVED finding, never a guess.
 *
 * The lexicon lives in the single table, seeded on first use from the
 * rulepack's aliases — the same seed the harness measures, which is the only
 * reason a Lambda can trust it. Accepted tier-3 answers will write back to
 * the same item with provenance (§14.2), so the next claim with that
 * description resolves at tier 1 for free.
 */
export const handler = async (
  event: { caseId: string },
): Promise<{ lines: NormalisedLine[]; tiers: Record<string, number> }> => {
  const deps = stageDeps();
  try {
    const record = await transition(deps, event.caseId, 'NORMALISING');
    if (!record.extracted) throw new PipelineFailure('PIPELINE_INTERNAL', 'nothing was extracted to normalise');

    const tableName = required('TABLE_NAME');
    const stored = await readLexicon({ tableName });
    const lexicon: Lexicon = stored ?? buildLexicon(deps.rulepack);
    if (!stored) await writeLexicon({ tableName }, lexicon);

    const normaliser = createNormaliser(lexicon, DEFAULT_TIER1, null);
    const lines = record.extracted.billTable.rows.map((row) => normaliser.normalise(row.lineRef, row.rawDescription));
    const tiers: Record<string, number> = {};
    for (const l of lines) tiers[l.tier] = (tiers[l.tier] ?? 0) + 1;
    recordNormalisation(tiers);

    await emit(deps, event.caseId, 'Normalised', {
      tiers,
      lexiconVersion: normaliser.lexiconVersion,
      unresolved: lines.filter((l) => l.categoryId === null).map((l) => l.rawDescription),
    });
    return { lines, tiers };
  } catch (e) {
    rethrowCoded(e);
  }
};
