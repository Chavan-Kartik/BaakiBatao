/**
 * Regenerates data/v1.lock.json.
 *
 * The hash is taken over the canonicalised rule data with editorial `_comment`
 * keys stripped, so reformatting or re-wording a comment does not invalidate
 * every certificate ever issued.
 *
 *   pnpm --filter @fc/rulepack lock
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');

const stripComments = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripComments);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (key.startsWith('_')) continue;
      out[key] = stripComments((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
};

/** Stable key order, so the hash is reproducible across runtimes. */
const canonicalise = (value: unknown): string => JSON.stringify(stripComments(value));

const files = ['v1/steps.json', 'v1/clauses.json', 'v1/categories.json', 'v1/rounding.json'];

const canonical = files
  .map((f) => `${f}:${canonicalise(JSON.parse(readFileSync(join(dataDir, f), 'utf8')))}`)
  .join('\n');

const hash = `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;

const lockPath = join(dataDir, 'v1.lock.json');
const existing = JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, unknown>;

writeFileSync(
  lockPath,
  `${JSON.stringify(
    {
      _comment: existing['_comment'],
      version: 'v1',
      hash,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
  'utf8',
);

console.log(`rulepack v1 → ${hash}`);
