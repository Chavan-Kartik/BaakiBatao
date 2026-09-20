import type { ReconstructInput, Reconstruction } from '@fc/contracts';
import { reconstruct } from '@fc/engine';
import {
  AS_OF,
  DEFAULT_DEGRADE,
  degradeInput,
  degradeSeed,
  formatSummary,
  generateFaultedPack,
  rngFromSeed,
  scorePacksDetailed,
  type Profile,
} from '@fc/eval';
import { loadRulepackV1 } from '@fc/rulepack';
import { required } from '../shared/config';
import { getJson, putJson, putText } from '../store/documents';

/**
 * The evaluation sweep on AWS (§20.4, ADR 006): a Distributed Map over a
 * manifest of seeds, one Express child per pack, `MaxConcurrency: 40`, and a
 * summary written next to the results. Three handlers, one file, because
 * they share the seed schedule with the local harness — `runEval` and this
 * must agree, so what you inspect locally is what scores here.
 *
 *   plan      { runId, count, seedBase, profile } → manifest.json (the Map's ItemReader)
 *   settle    one manifest item → the reconstruction, to S3, and a small result
 *   summarise the run → summary.json + report.txt, the same text `pnpm eval:run` prints
 *
 * Every pack is generated from its seed inside the child, so nothing but a
 * list of integers crosses the Map boundary.
 */
export interface SweepRequest {
  readonly runId?: string;
  readonly count?: number;
  readonly seedBase?: number;
  readonly profile?: Profile;
}

export interface SweepItem {
  readonly runId: string;
  readonly seed: number;
  readonly profile: Profile;
}

const prefix = (runId: string): string => `eval-runs/${runId}`;

export const plan = async (
  event: SweepRequest,
): Promise<{ runId: string; manifestKey: string; bucket: string; count: number; profile: Profile }> => {
  const bucket = required('ARTIFACTS_BUCKET');
  const runId = event.runId ?? new Date().toISOString().replace(/[:.]/g, '-');
  const count = event.count ?? 200;
  const seedBase = event.seedBase ?? 1000;
  const profile = event.profile ?? 'clean';
  const items: SweepItem[] = Array.from({ length: count }, (_, i) => ({ runId, seed: seedBase + i, profile }));
  const manifestKey = await putJson(bucket, `${prefix(runId)}/manifest.json`, items);
  await putJson(bucket, `${prefix(runId)}/request.json`, { runId, count, seedBase, profile, startedAt: new Date().toISOString() });
  return { runId, manifestKey, bucket, count, profile };
};

export const settle = async (
  item: SweepItem,
): Promise<{ seed: number; invariantHeld: boolean; findings: number; ms: number }> => {
  const bucket = required('ARTIFACTS_BUCKET');
  const rulepack = loadRulepackV1();
  const pack = generateFaultedPack(item.seed);
  const input =
    item.profile === 'clean'
      ? pack.input
      : degradeInput(pack, rngFromSeed(degradeSeed(item.seed)), DEFAULT_DEGRADE).input;

  const started = performance.now();
  const result = reconstruct({ input, rulepack, now: AS_OF });
  const ms = Math.round((performance.now() - started) * 100) / 100;

  await putJson(bucket, `${prefix(item.runId)}/results/${item.seed}.json`, { seed: item.seed, input, result, ms });
  return { seed: item.seed, invariantHeld: result.reconciliation.invariantHeld, findings: result.findings.length, ms };
};

export const summarise = async (event: {
  runId: string;
  profile: Profile;
  count: number;
  seedBase?: number;
}): Promise<{ summaryKey: string; reportKey: string; packs: number }> => {
  const bucket = required('ARTIFACTS_BUCKET');
  const items = await getJson<SweepItem[]>(bucket, `${prefix(event.runId)}/manifest.json`);

  const packs = items.map((i) => generateFaultedPack(i.seed));
  const stored = await Promise.all(
    items.map((i) => getJson<{ input: ReconstructInput; result: Reconstruction; ms: number }>(
      bucket,
      `${prefix(event.runId)}/results/${i.seed}.json`,
    )),
  );
  const results = stored.map((s) => s.result);
  const inputs = stored.map((s) => s.input);
  const { summary } = scorePacksDetailed(packs, results, { profile: event.profile, inputs });

  const summaryKey = await putJson(bucket, `${prefix(event.runId)}/summary.json`, {
    ...summary,
    runId: event.runId,
    engineMsMean: stored.reduce((s, r) => s + r.ms, 0) / Math.max(1, stored.length),
    finishedAt: new Date().toISOString(),
  });
  const reportKey = await putText(bucket, `${prefix(event.runId)}/report.txt`, formatSummary(summary));
  return { summaryKey, reportKey, packs: packs.length };
};

