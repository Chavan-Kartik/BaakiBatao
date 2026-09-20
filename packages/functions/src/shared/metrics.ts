import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import type { Reconstruction } from '@fc/contracts';

/**
 * The business metrics on the dashboard (build spec §22.2), as EMF under the
 * `FC` namespace. Not p99 latency: how much of the bill the engine could not
 * place, whether the ledger balanced, how long the money math took, and
 * which normalisation tier answered. Emitted once per stage invocation by
 * the stage that knows the number.
 */
export const NAMESPACE = 'FC';

const metrics = new Metrics({ namespace: NAMESPACE, serviceName: 'pipeline' });

export function recordReconstruction(r: Reconstruction, engineMs: number): void {
  const total = Math.max(1, Math.abs(r.billTotal));
  metrics.addMetric('UnresolvedRatePct', MetricUnit.Percent, (100 * Math.abs(r.reconciliation.byBucket.UNRESOLVED)) / total);
  metrics.addMetric('ReconciliationResidualPaise', MetricUnit.Count, Math.abs(r.reconciliation.residual));
  metrics.addMetric('EngineDurationMs', MetricUnit.Milliseconds, engineMs);
  metrics.addMetric('FindingsPerCase', MetricUnit.Count, r.findings.length);
  for (const f of r.findings) {
    if (!f.clauseId) continue;
    metrics.singleMetric().addDimension('clauseId', f.clauseId).addMetric('FindingsByClause', MetricUnit.Count, 1);
  }
  metrics.publishStoredMetrics();
}

export function recordNormalisation(tiers: Readonly<Record<string, number>>): void {
  for (const [tier, n] of Object.entries(tiers)) {
    metrics.singleMetric().addDimension('tier', tier).addMetric('NormalisationTierDistribution', MetricUnit.Count, n);
  }
}
