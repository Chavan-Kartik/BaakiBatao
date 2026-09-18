import type { ExtractedTable, LineRef, Paise, StepId } from '@fc/contracts';
import { ZERO, subPaise, unsafePaise } from '@fc/contracts';

/**
 * What the insurer actually did to one bill line, read off the deduction sheet.
 *
 * Findings decompose the insurer's deductions, not ours. Our own reconstruction
 * decides what each cut *should* have been; this is what it *was*. The
 * difference is the product.
 *
 * Spec: build spec §8.2
 */
export interface InsurerLineOutcome {
  readonly claimed: Paise;
  readonly paid: Paise;
  /** claimed − paid. Positive means the insurer disallowed this much. */
  readonly deducted: Paise;
  /** The sheet's own reason code, where it prints one. Never interpreted as a clause. */
  readonly reasonCode: string | null;
  /**
   * Which step the reason code appears to be about, or null when the sheet gave
   * no usable reason.
   *
   * This decides *which step gets to dispute a cut*, and it matters more than it
   * looks. Several steps can independently observe "they cut money here and our
   * reconstruction cuts none", so without an owner the earliest step in the
   * waterfall wins the citation — and a pharmacy line cut for proportionate
   * reasons would be disputed under the rider clause instead of under
   * AME.EXCL.PHARMA. Same conclusion, wrong rule quoted in the letter.
   *
   * It is a routing hint, never a citation. The clause always comes from the
   * rulepack.
   */
  readonly reasonStep: StepId | null;
}

export type InsurerByLine = ReadonlyMap<LineRef, InsurerLineOutcome>;

/**
 * A deduction the insurer took against the claim as a whole rather than against
 * a bill line — the deductible, the co-pay, a sum-insured cap, or a summary row
 * with no stated basis.
 *
 * These have to be read from the sheet rather than recomputed, because the
 * reconciliation decomposes what the insurer actually withheld. Our own co-pay
 * figure is generally *larger* than theirs: a co-pay is a percentage, so an
 * insurer who over-deducts upstream shrinks the base it applies to. Emitting
 * our figure would over-explain the claim by the difference and bury the real
 * unexplained remainder.
 */
export interface ClaimLevelCut {
  readonly kind: 'DEDUCTIBLE' | 'COPAY' | 'SUM_INSURED' | 'OTHER';
  readonly label: string;
  readonly amount: Paise;
}

export interface InsurerView {
  readonly byLine: InsurerByLine;
  readonly claimLevel: readonly ClaimLevelCut[];
}

/**
 * A bill line's `lineRef` is `${docId}:${page}:${rowIndex}`, and the bill and
 * the deduction sheet are different documents — so their refs can never be
 * equal by construction. They have to be matched on content.
 *
 * We match on the normalised description, then require the claimed amounts to
 * agree within tolerance. Both must hold. Description alone would collide on
 * the repeated "PHARMACY" rows that every Indian hospital bill carries; amount
 * alone would collide on the many lines that happen to cost the same.
 *
 * An unmatched bill line is deliberately absent from the map rather than
 * defaulted to "fully paid". A missing entry means we do not know what the
 * insurer did with that line, and the steps must treat it that way — the
 * aggregate residual then surfaces it as RESIDUAL_UNATTRIBUTED instead of us
 * inventing a lawful deduction the sheet never claimed.
 */
export function matchDeductionSheet(
  billTable: ExtractedTable,
  deductionTable: ExtractedTable,
  matchTolerancePaise: Paise,
): InsurerView {
  const unclaimed = deductionTable.rows.map((row) => ({ row, taken: false }));
  const out = new Map<LineRef, InsurerLineOutcome>();

  for (const billRow of billTable.rows) {
    const key = normaliseDescription(billRow.rawDescription);

    const candidate = unclaimed.find(
      (c) =>
        !c.taken &&
        normaliseDescription(c.row.rawDescription) === key &&
        Math.abs(c.row.amountClaimed - billRow.amountClaimed) <= matchTolerancePaise,
    );

    if (!candidate) continue;
    candidate.taken = true;

    // A sheet that prints no paid column tells us the line was disallowed in
    // full. That is a statement, not an absence, so it is recorded.
    const paid = candidate.row.amountPaid ?? ZERO;

    out.set(billRow.lineRef, {
      claimed: billRow.amountClaimed,
      paid,
      deducted: clampToZero(subPaise(billRow.amountClaimed, paid)),
      reasonCode: candidate.row.insurerReasonCode,
      reasonStep: classifyReasonCode(candidate.row.insurerReasonCode),
    });
  }

  // Whatever the sheet lists that is not a bill line is a claim-level cut. A
  // deduction sheet carries both: per-line disallowances, then summary rows for
  // the deductible, the co-pay, and often an "other deductions" line with no
  // stated basis at all — which is exactly the row this product exists to make
  // visible rather than to quietly accept.
  const claimLevel = unclaimed
    .filter((c) => !c.taken)
    .map(({ row }): ClaimLevelCut => {
      const amount = clampToZero(subPaise(row.amountClaimed, row.amountPaid ?? ZERO));
      return {
        kind: classifyClaimLevel(`${row.rawDescription} ${row.insurerReasonCode ?? ''}`),
        label: row.rawDescription,
        amount,
      };
    })
    .filter((c) => c.amount > 0);

  return { byLine: out, claimLevel };
}

/**
 * Ordered for the same reason as `classifyReasonCode`: "co-pay" and
 * "deductible" both contain substrings of each other's vocabulary in practice,
 * and anything unrecognised is OTHER rather than a guess. An OTHER cut is never
 * attributed to a clause by any step, so it surfaces as RESIDUAL_UNATTRIBUTED.
 */
export function classifyClaimLevel(text: string): ClaimLevelCut['kind'] {
  const rules: readonly (readonly [RegExp, ClaimLevelCut['kind']])[] = [
    [/co.?pay|copayment|co.?insur/i, 'COPAY'],
    [/deductib|franchise/i, 'DEDUCTIBLE'],
    [/sum.?insur|\bsi\b|exhaust|balance.?avail/i, 'SUM_INSURED'],
  ];

  return rules.find(([pattern]) => pattern.test(text))?.[1] ?? 'OTHER';
}

/**
 * Map a deduction sheet's free-text reason code onto the step it concerns.
 *
 * Deliberately ordered, not a lookup: "PROP-DEDUCT" contains "DEDUCT", so a
 * naive scan would route a proportionate deduction to the deductible step. The
 * more specific rules therefore come first, and anything unrecognised returns
 * null rather than a guess — an unrouted cut ends up in the unresolved bucket,
 * which is the correct answer when the insurer told us nothing.
 */
export function classifyReasonCode(code: string | null): StepId | null {
  if (code === null) return null;

  const rules: readonly (readonly [RegExp, StepId])[] = [
    [/prop|\bpd\b|ratio|room.?categ|higher.?room|eligib.*room/i, 'PROPORTIONATE'],
    [/non.?pay|annex|exclu|not.?admissible.?item|nme\b/i, 'NON_PAYABLE'],
    [/cap|sub.?limit|\blimit|room.?rent|icu.?rent|tariff/i, 'CAPS_SUBLIMITS'],
    [/co.?pay|deductible|franchise/i, 'COPAY_DEDUCTIBLE'],
    [/sum.?insur|\bsi\b|exhaust|balance/i, 'SUM_INSURED'],
    [/waiting|pre.?exis|\bped\b|not.?in.?force|inadmis/i, 'ADMISSIBILITY'],
    [/categor|unclear|ambigu/i, 'NORMALISATION_GATE'],
  ];

  return rules.find(([pattern]) => pattern.test(code))?.[1] ?? null;
}

/**
 * Casefold, collapse whitespace, drop punctuation. Deliberately not fuzzy:
 * fuzzy matching here would silently pair a bill line with the wrong deduction
 * row, and every downstream finding would then cite a clause against an amount
 * the insurer never deducted. Tier-2 similarity belongs in normalisation, where
 * a wrong answer routes to UNRESOLVED instead of to a confident citation.
 */
export function normaliseDescription(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const clampToZero = (p: Paise): Paise => (p < 0 ? ZERO : unsafePaise(p));
