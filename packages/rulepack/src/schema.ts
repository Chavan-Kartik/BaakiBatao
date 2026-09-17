import { z } from 'zod';
import { CategoryDefinition, ClauseDefinition, RoundingPolicy, StepDefinition } from '@fc/contracts';

/**
 * Keys beginning with `_` in the data files are editorial comments — JSON has
 * no comment syntax and these rules need explaining to whoever edits them next.
 * They are stripped before validation.
 */
export const stripComments = <T>(obj: Record<string, unknown>): Record<string, T> => {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!k.startsWith('_')) out[k] = v as T;
  }
  return out;
};

export const StepsFile = z.object({
  rulepackVersion: z.string(),
  steps: z.array(StepDefinition).min(1),
});

export const ClausesFile = z.record(z.string(), ClauseDefinition);

export const CategoriesFile = z.record(z.string(), CategoryDefinition);

export const RoundingFile = RoundingPolicy;

export const LockFile = z.object({
  version: z.string(),
  hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  generatedAt: z.string(),
});
