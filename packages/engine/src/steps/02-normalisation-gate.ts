import type { Finding } from '@fc/contracts';
import { ZERO } from '@fc/contracts';
import type { Reducer } from '../types';
import { arithmetic, unresolved } from '../findings';
import { sumAllowed } from '../state';

/**
 * Step 2 — Normalisation gate.
 *
 * Not money-moving. Consumes NormalisedLine[] and enforces the confidence gate
 * from `params.minConfidence`: lines below it move to unresolved and are
 * excluded from every downstream step, each carrying an UNRESOLVED finding with
 * its tier and reason.
 *
 * This is where the model's uncertainty becomes a visible product feature
 * instead of a silent guess. A line we cannot categorise can be neither
 * deducted nor defended.
 *
 * Spec: build spec §7.3
 */
export const normalisationGate: Reducer = (state, ctx) => {
  const minConfidence = readMinConfidence(ctx.params);
  const findings: Finding[] = [];

  const lines = state.lines.map((line) => {
    if (line.unresolved) return line;

    // Two distinct failures, same consequence. An uncategorised line has no
    // category to look up in the rulepack, so no step downstream can cite a
    // clause about it; a low-confidence line has one we do not trust enough to
    // quote in a letter. Neither may be deducted or defended.
    const uncategorised = line.categoryId === null;
    const belowGate = line.normConfidence < minConfidence;

    if (!uncategorised && !belowGate) return line;

    // The insurer's own treatment of the line is what we cannot adjudicate, so
    // that is the amount reported as unplaceable. Where the sheet had no
    // matching row, there is nothing to report but the line is still gated.
    const theirCut = ctx.insurerByLine.get(line.lineRef)?.deducted ?? ZERO;

    findings.push(
      unresolved({
        stepId: 'NORMALISATION_GATE',
        lineRef: line.lineRef,
        reason: uncategorised ? 'AMBIGUOUS_DESCRIPTION' : 'LOW_EXTRACTION_CONFIDENCE',
        magnitude: theirCut,
        resolvedBy: uncategorised
          ? `a category for "${line.rawDescription}" — the hospital's tariff card, or a one-click correction in the grid, would settle it`
          : `confirmation of the category for "${line.rawDescription}", resolved at tier ${line.normTier} with confidence ${line.normConfidence.toFixed(2)} against a gate of ${minConfidence.toFixed(2)}`,
        arithmetic: arithmetic(
          `tier ${line.normTier}, confidence ${line.normConfidence.toFixed(2)} < gate ${minConfidence.toFixed(2)}`,
          { confidence: line.normConfidence, minConfidence, insurerDeducted: theirCut },
          theirCut,
        ),
        confidence: line.normConfidence,
      }),
    );

    return { ...line, unresolved: true };
  });

  // Gated lines leave the payable base: sumAllowed already skips unresolved
  // lines, so this reduces the running balance by exactly their claimed value.
  // The rupees do not vanish — they are now carried by the findings above.
  return [{ ...state, lines, payable: sumAllowed(lines) }, findings];
};


/**
 * The gate comes from the rulepack, so it can be recalibrated against a
 * held-out split without a redeploy. A missing or malformed value is a broken
 * rulepack, and a silently defaulted threshold here would quietly change which
 * lines get adjudicated — so it fails loudly instead.
 */
function readMinConfidence(params: Record<string, unknown>): number {
  const raw = params['minConfidence'];
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 1) {
    throw new RangeError(
      `normalisation gate: params.minConfidence must be a number in [0,1], got ${JSON.stringify(raw)}`,
    );
  }
  return raw;
}
