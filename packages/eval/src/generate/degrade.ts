import type { ExtractedRow, ExtractedTable, NormTier, ReconstructInput } from '@fc/contracts';
import { unsafePaise } from '@fc/contracts';
import { buildLexicon, createNormaliser, DEFAULT_TIER1, type Normaliser } from '@fc/normalise';
import { loadRulepackV1 } from '@fc/rulepack';
import type { FaultedPack } from '../types';
import { chance, int, pick, type Rng } from './rng';

/**
 * Data-level degradation — the stand-in for §20.1 steps 5–6 until the render
 * and Textract path exists.
 *
 * Rendering a PDF, rotating it, adding noise and running Textract over it is
 * how the real system will be exercised. What that pipeline *produces* is rows
 * with misread characters, misread digits, missing rows and Textract
 * confidences below 90 — and every one of those has a downstream consequence
 * the engine already has a code path for: the normalisation gate, the sheet
 * matcher's refusal to pair rows that disagree, the residual bucket. This
 * module produces the same consequences directly from the generated rows, so
 * those paths are inside the measured loop now rather than after the AWS
 * increment.
 *
 * What it cannot stand in for: layout-dependent failures (a column shifted by
 * a merged cell, a page break through a table), which only rendering can
 * produce. PROVENANCE.md keeps that distinction on the record.
 */
export interface DegradeKnobs {
  /** Probability a bill row's description is misread. */
  readonly billDescriptionNoise: number;
  /** Probability a sheet row's description is misread — independently of the bill's. */
  readonly sheetDescriptionNoise: number;
  /** Probability a sheet row's claimed amount loses or swaps a digit. */
  readonly sheetAmountNoise: number;
  /** Probability a per-line sheet row is missing altogether. */
  readonly sheetRowDrop: number;
  /** Tier-1 fuzzy threshold the normaliser runs with. */
  readonly fuzzyThreshold: number;
}

/**
 * Rates in the region Textract lands on a fair scan of a laser-printed bill,
 * as a working assumption until the render path measures them. They are
 * knobs precisely so the measurement can replace the assumption.
 */
export const DEFAULT_DEGRADE: DegradeKnobs = {
  billDescriptionNoise: 0.12,
  sheetDescriptionNoise: 0.12,
  sheetAmountNoise: 0.03,
  sheetRowDrop: 0.02,
  fuzzyThreshold: DEFAULT_TIER1.fuzzyThreshold,
};

export interface DegradeReport {
  readonly billRowsPerturbed: number;
  readonly sheetRowsPerturbed: number;
  readonly sheetAmountErrors: number;
  readonly sheetRowsDropped: number;
  readonly tiers: Readonly<Record<NormTier, number>>;
}

export interface DegradedInput {
  readonly input: ReconstructInput;
  readonly report: DegradeReport;
}

const rulepack = loadRulepackV1();
const lexicon = buildLexicon(rulepack);
const normalisers = new Map<number, Normaliser>();

function normaliserAt(fuzzyThreshold: number): Normaliser {
  let n = normalisers.get(fuzzyThreshold);
  if (!n) {
    n = createNormaliser(lexicon, { ...DEFAULT_TIER1, fuzzyThreshold });
    normalisers.set(fuzzyThreshold, n);
  }
  return n;
}

export function degradeInput(
  pack: FaultedPack,
  rng: Rng,
  knobs: DegradeKnobs = DEFAULT_DEGRADE,
): DegradedInput {
  let billRowsPerturbed = 0;
  let sheetRowsPerturbed = 0;
  let sheetAmountErrors = 0;
  let sheetRowsDropped = 0;

  const billRows: ExtractedRow[] = pack.input.billTable.rows.map((row) => {
    if (!chance(rng, knobs.billDescriptionNoise)) return row;
    billRowsPerturbed += 1;
    return misread(rng, row, ocrNoise(rng, row.rawDescription), row.amountClaimed);
  });

  const nBill = pack.input.billTable.rows.length;
  const sheetRows: ExtractedRow[] = [];
  pack.input.deductionTable.rows.forEach((row, i) => {
    const perLine = i < nBill;
    if (perLine && chance(rng, knobs.sheetRowDrop)) {
      sheetRowsDropped += 1;
      return;
    }
    let desc = row.rawDescription;
    let claimed = row.amountClaimed;
    let touched = false;
    if (chance(rng, knobs.sheetDescriptionNoise)) {
      desc = ocrNoise(rng, desc);
      touched = true;
    }
    if (perLine && chance(rng, knobs.sheetAmountNoise)) {
      claimed = digitNoise(rng, claimed);
      sheetAmountErrors += 1;
      touched = true;
    }
    if (touched) sheetRowsPerturbed += 1;
    sheetRows.push(touched ? misread(rng, row, desc, claimed) : row);
  });

  // The normaliser sees the bill as extracted, and the engine sees whatever
  // the normaliser decided. No category is carried over from generation.
  const normaliser = normaliserAt(knobs.fuzzyThreshold);
  const tiers: Record<NormTier, number> = {
    LEXICON: 0, LEXICON_FUZZY: 0, EMBEDDING: 0, LLM: 0, UNRESOLVED: 0,
  };
  const normalisedLines = billRows.map((row) => {
    const line = normaliser.normalise(row.lineRef, row.rawDescription);
    tiers[line.tier] += 1;
    return line;
  });

  const billTable: ExtractedTable = { ...pack.input.billTable, rows: billRows };
  const deductionTable: ExtractedTable = { ...pack.input.deductionTable, rows: sheetRows };

  return {
    input: {
      ...pack.input,
      billTable,
      deductionTable,
      normalisedLines,
      pins: { ...pack.input.pins, lexiconVersion: normaliser.lexiconVersion },
    },
    report: { billRowsPerturbed, sheetRowsPerturbed, sheetAmountErrors, sheetRowsDropped, tiers },
  };
}

function misread(rng: Rng, row: ExtractedRow, rawDescription: string, amountClaimed: ExtractedRow['amountClaimed']): ExtractedRow {
  return {
    ...row,
    rawDescription,
    amountClaimed,
    provenance: { ...row.provenance, textractConfidence: int(rng, 55, 82) },
  };
}

/* -------------------------------------------------------------- the noise */

/**
 * Character-level confusions OCR actually makes on printed Latin text, chosen
 * so that they survive the lexicon's normalisation: a stray comma would be
 * stripped and prove nothing, but "0" for "o" changes the lookup key.
 */
const CONFUSIONS: readonly (readonly [string, string])[] = [
  ['o', '0'], ['0', 'o'], ['l', '1'], ['1', 'l'], ['i', 'l'], ['s', '5'], ['5', 's'],
  ['rn', 'm'], ['m', 'rn'], ['e', 'c'], ['c', 'e'], ['a', 'o'], ['u', 'v'], ['t', 'f'],
];

export function ocrNoise(rng: Rng, text: string): string {
  const edits = int(rng, 1, 2);
  let out = text;
  for (let k = 0; k < edits; k++) {
    const roll = rng();
    if (roll < 0.55) {
      const applicable = CONFUSIONS.filter(([from]) => out.toLowerCase().includes(from));
      if (applicable.length === 0) continue;
      const [from, to] = pick(rng, applicable);
      const at = out.toLowerCase().indexOf(from);
      out = out.slice(0, at) + to + out.slice(at + from.length);
    } else if (roll < 0.75 && out.length > 3) {
      const at = int(rng, 0, out.length - 1);
      out = out.slice(0, at) + out.slice(at + 1);
    } else if (roll < 0.9 && out.includes(' ')) {
      const spaces = [...out].map((c, i) => (c === ' ' ? i : -1)).filter((i) => i >= 0);
      const at = pick(rng, spaces);
      out = out.slice(0, at) + out.slice(at + 1);
    } else if (out.length > 4) {
      const at = int(rng, 2, out.length - 2);
      out = `${out.slice(0, at)} ${out.slice(at)}`;
    }
  }
  return out;
}

/** A rupee figure with one digit dropped, doubled or transposed. */
export function digitNoise(rng: Rng, amount: ExtractedRow['amountClaimed']): ExtractedRow['amountClaimed'] {
  const rupees = String(Math.floor(amount / 100));
  if (rupees.length < 2) return unsafePaise(amount + 100);
  const at = int(rng, 0, rupees.length - 1);
  const roll = rng();
  const digits =
    roll < 0.4 ? rupees.slice(0, at) + rupees.slice(at + 1)
    : roll < 0.7 ? rupees.slice(0, at) + rupees[at] + rupees.slice(at)
    : at + 1 < rupees.length
      ? rupees.slice(0, at) + rupees[at + 1] + rupees[at] + rupees.slice(at + 2)
      : rupees.slice(0, at) + String((Number(rupees[at]) + 1) % 10);
  const n = Number(digits);
  const out = Number.isFinite(n) && n > 0 ? n * 100 : amount + 100;
  return unsafePaise(out === amount ? amount + 100 : out);
}
