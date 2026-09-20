import type { ExtractedTable } from '@fc/contracts';

/**
 * The redaction gate — the deterministic half.
 *
 * ADR 004 makes this a boundary: nothing past it may carry raw personal data,
 * because everything past it may reach a model. Two detectors are specified:
 * Comprehend `DetectPiiEntities` for names and addresses, and format regexes
 * where a format beats a model. Only the second runs here; the gate reports
 * that, and a deployment that wants Bedrock prose must wire the first.
 *
 * Amounts, dates, line descriptions and clause references are the data and
 * are kept intact — the regexes are for identifiers that never belong in a
 * line description in the first place.
 */
export const PII_FORMAT_PATTERNS: Readonly<Record<string, RegExp>> = {
  AADHAAR: /\b\d{4}\s?\d{4}\s?\d{4}\b/g,
  PAN: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
  GSTIN: /\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z]\d\b/g,
  PHONE_IN: /\b(?:\+91[\s-]?)?[6-9]\d{9}\b/g,
  EMAIL: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g,
};

export interface RedactionResult {
  readonly billTable: ExtractedTable;
  readonly deductionTable: ExtractedTable;
  readonly wordingText: string;
  readonly countByType: Record<string, number>;
  /** False means fail closed: nothing downstream runs. */
  readonly confirmed: boolean;
  readonly detectors: readonly string[];
}

export function redactPack(a: {
  billTable: ExtractedTable;
  deductionTable: ExtractedTable;
  wordingText: string;
}): RedactionResult {
  const counts: Record<string, number> = {};
  const scrub = (text: string): string => {
    let out = text;
    for (const [type, pattern] of Object.entries(PII_FORMAT_PATTERNS)) {
      out = out.replace(pattern, () => {
        counts[type] = (counts[type] ?? 0) + 1;
        return `[${type}]`;
      });
    }
    return out;
  };

  const scrubTable = (t: ExtractedTable): ExtractedTable => ({
    ...t,
    rows: t.rows.map((r) => ({ ...r, rawDescription: scrub(r.rawDescription) })),
  });

  return {
    billTable: scrubTable(a.billTable),
    deductionTable: scrubTable(a.deductionTable),
    wordingText: scrub(a.wordingText),
    countByType: counts,
    // The deterministic pass always completes; it is the Comprehend pass whose
    // absence a Bedrock-calling stage must refuse to proceed without.
    confirmed: true,
    detectors: ['format-regex'],
  };
}
