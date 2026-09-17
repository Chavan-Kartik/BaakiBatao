/**
 * The redaction boundary, expressed in the type system.
 *
 * `RedactedText` can only be produced by the redaction gate. The Bedrock client
 * wrapper accepts nothing else, so handing it raw document text is a COMPILE
 * ERROR rather than a runtime incident.
 *
 * This is one of three enforcement layers (the build spec §13):
 *   1. this type
 *   2. IAM — Bedrock-calling Lambdas have no s3:GetObject on the raw/ prefix
 *   3. lifecycle — raw/ expires after 1 day, case items carry a 24h TTL
 *
 * It is also what makes running Bedrock outside ap-south-1 defensible: only
 * redacted text ever leaves Mumbai.
 */
declare const redactedBrand: unique symbol;

export type RedactedText = string & { readonly [redactedBrand]: 'RedactedText' };

export interface RedactionOutcome {
  readonly text: RedactedText;
  readonly countByType: Record<string, number>;
  /** False means fail closed — nothing downstream runs. */
  readonly confirmed: boolean;
}

/**
 * The ONLY way to mint a RedactedText. Call this from redact.ts after
 * Comprehend DetectPiiEntities and the deterministic format regexes have both
 * run and the result has been confirmed.
 */
export const markRedacted = (text: string): RedactedText => text as RedactedText;

/**
 * Amounts, service dates, line descriptions and clause references are kept
 * intact — they are the data. See project brief §8.
 */
export const PII_ENTITY_TYPES = [
  'NAME',
  'ADDRESS',
  'PHONE',
  'EMAIL',
  'AGE',
  'SSN',
] as const;

/** Formats where a deterministic regex beats a model. */
export const PII_FORMAT_PATTERNS: Readonly<Record<string, RegExp>> = {
  AADHAAR: /\b\d{4}\s?\d{4}\s?\d{4}\b/g,
  PAN: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
  GSTIN: /\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z]\d\b/g,
};
