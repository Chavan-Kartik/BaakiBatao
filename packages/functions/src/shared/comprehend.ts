import { ComprehendClient, DetectPiiEntitiesCommand, type LanguageCode } from '@aws-sdk/client-comprehend';

/**
 * Comprehend `DetectPiiEntities` — the model half of the redaction gate
 * (§13). Runs on raw text, which the caller accepted custody of precisely by
 * having `s3:GetObject` on `raw/`; its output is entity spans that `redact.ts`
 * merges with the deterministic format regexes before the result may be
 * minted as `RedactedText`.
 */
const client = new ComprehendClient({});

export interface PiiEntity {
  readonly type: string;
  readonly score: number;
  readonly beginOffset: number;
  readonly endOffset: number;
}

export async function detectPiiEntities(text: string, languageCode: LanguageCode = 'en'): Promise<PiiEntity[]> {
  const out = await client.send(new DetectPiiEntitiesCommand({ Text: text, LanguageCode: languageCode }));
  return (out.Entities ?? []).map((entity) => ({
    type: entity.Type ?? 'UNKNOWN',
    score: entity.Score ?? 0,
    beginOffset: entity.BeginOffset ?? 0,
    endOffset: entity.EndOffset ?? 0,
  }));
}
