import { GetParametersByPathCommand, SSMClient } from '@aws-sdk/client-ssm';

/**
 * Environment and runtime configuration for the handlers.
 *
 * Two kinds of setting reach a Lambda. Names of resources in the same or an
 * upstream stack arrive as environment variables at deploy time. Values that
 * only exist after a *downstream* stack deploys — the public web origin, which
 * `FcWebStack` mints after `FcApiStack` — arrive through SSM Parameter Store,
 * read on cold start and cached, so the stacks stay a DAG (build spec §10.2).
 */
export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

const ssm = new SSMClient({});
const cache = new Map<string, { at: number; values: Record<string, string> }>();
const TTL_MS = 5 * 60 * 1000;
/** A missing parameter is re-checked sooner: it is usually a stack that has not deployed yet. */
const MISSING_TTL_MS = 30 * 1000;

/**
 * Every parameter under `path`, keyed by the name relative to it, e.g.
 * `/fc/web/origin` → `{ origin: 'https://…cloudfront.net' }`.
 */
export async function parametersUnder(path: string): Promise<Record<string, string>> {
  const hit = cache.get(path);
  const ttl = hit && Object.keys(hit.values).length === 0 ? MISSING_TTL_MS : TTL_MS;
  if (hit && Date.now() - hit.at < ttl) return hit.values;

  const values: Record<string, string> = {};
  let nextToken: string | undefined;
  do {
    const page = await ssm.send(new GetParametersByPathCommand({ Path: path, NextToken: nextToken }));
    for (const p of page.Parameters ?? []) {
      if (p.Name && p.Value !== undefined) values[p.Name.slice(path.length).replace(/^\//, '')] = p.Value;
    }
    nextToken = page.NextToken;
  } while (nextToken);

  cache.set(path, { at: Date.now(), values });
  return values;
}

/** Seconds since the epoch, `hours` from now — the shape DynamoDB TTL wants. */
export const ttlInHours = (hours: number): number => Math.floor(Date.now() / 1000) + hours * 60 * 60;
