import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { RedactedText } from './redacted';

/**
 * The only Bedrock entry point in the system. The branded `RedactedText`
 * parameter is the compile-time half of the redaction boundary (§13) — raw
 * document text cannot be passed here by accident — and IAM is the runtime
 * half: the Lambdas that call this have no `s3:GetObject` on the raw bucket.
 *
 * The client's region is `BEDROCK_REGION`, which may differ from the
 * function's own: only redacted text crosses that line (ADR 004).
 */
let client: BedrockRuntimeClient | null = null;

function bedrock(): BedrockRuntimeClient {
  client ??= new BedrockRuntimeClient({ region: process.env['BEDROCK_REGION'] || undefined });
  return client;
}

export interface BedrockCall {
  readonly modelId: string;
  readonly prompt: RedactedText;
  readonly system?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly guardrail?: { readonly id: string; readonly version: string };
}

export async function converseText(call: BedrockCall): Promise<string> {
  const out = await bedrock().send(
    new ConverseCommand({
      modelId: call.modelId,
      inferenceConfig: { temperature: call.temperature ?? 0, maxTokens: call.maxTokens ?? 400 },
      system: call.system ? [{ text: call.system }] : undefined,
      guardrailConfig: call.guardrail
        ? { guardrailIdentifier: call.guardrail.id, guardrailVersion: call.guardrail.version }
        : undefined,
      messages: [{ role: 'user', content: [{ text: call.prompt }] }],
    }),
  );
  const text = out.output?.message?.content?.map((c) => c.text ?? '').join('') ?? '';
  if (!text) throw new Error('empty Bedrock response');
  return text;
}
