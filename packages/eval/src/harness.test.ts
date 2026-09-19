import { describe, expect, it } from 'vitest';
import { reconstruct } from '@fc/engine';
import { loadRulepackV1 } from '@fc/rulepack';
import { injectFaults } from './faults/inject';
import { generatePack } from './generate/generator';
import { rngFromSeed } from './generate/rng';
import { scorePacksDetailed, scorePacks } from './score/confusion';

/**
 * Eval-harness regression tests. The worked-example golden test pins the
 * published figures; these pin the harness itself: determinism, lawful
 * controls staying clean, and every fault kind being detectable.
 */
describe('eval harness', () => {
  it('is deterministic per seed', () => {
    const a = generatePack(7);
    const b = generatePack(7);
    expect(a.billTotal).toBe(b.billTotal);
    expect(a.lawfulPaid).toBe(b.lawfulPaid);
    expect(a.billTable.rows.map((r) => r.rawDescription)).toEqual(
      b.billTable.rows.map((r) => r.rawDescription),
    );
  });

  it('produces a lawful sheet the engine fully endorses on control packs', () => {
    const rulepack = loadRulepackV1();
    // First control pack across a sweep of seeds.
    for (let seed = 1; seed < 60; seed++) {
      const pack = generatePack(seed);
      const faulted = injectFaults(pack, rngFromSeed(seed * 7919 + 13));
      if (faulted.faults.length !== 0) continue;
      const result = reconstruct({ input: faulted.input, rulepack, now: '2026-09-18T00:00:00.000Z' });
      expect(result.findings.filter((f) => f.bucket === 'INCORRECTLY_APPLIED')).toEqual([]);
      return;
    }
    throw new Error('no control pack found in seeds 1..60');
  });

  it('detects each fault kind under its clause', () => {
    const rulepack = loadRulepackV1();
    const seen = new Set<string>();
    for (let seed = 1; seed < 400 && seen.size < 6; seed++) {
      const pack = generatePack(seed);
      const faulted = injectFaults(pack, rngFromSeed(seed * 7919 + 13));
      if (faulted.faults.length === 0) continue;
      const result = reconstruct({ input: faulted.input, rulepack, now: '2026-09-18T00:00:00.000Z' });
      const summary = scorePacks([faulted], [result]);
      for (const c of summary.perClause) {
        if (c.tp > 0) seen.add(c.clauseId);
      }
    }
    for (const clause of ['AME.EXCL.PHARMA', 'AME.EXCL.IMPLANT', 'AME.EXCL.DIAG', 'PD.ICU', 'PD.DIFFBILL', 'PD.LIMIT']) {
      expect(seen.has(clause), `fault kind for ${clause} never detected in seeds 1..400`).toBe(true);
    }
  });

  it('records one per-fault outcome per injected fault', () => {
    const rulepack = loadRulepackV1();
    const packs = [];
    const results = [];
    for (let seed = 1000; seed < 1030; seed++) {
      const pack = injectFaults(generatePack(seed), rngFromSeed(seed * 7919 + 13));
      if (pack.faults.length === 0) continue;
      packs.push(pack);
      results.push(reconstruct({ input: pack.input, rulepack, now: '2026-09-18T00:00:00.000Z' }));
    }
    const { summary, outcomes } = scorePacksDetailed(packs, results);
    expect(outcomes.length).toBe(summary.faults);
    expect(outcomes.every((o) => o.injectedPaise > 0)).toBe(true);
    for (const o of outcomes) {
      if (o.detected) {
        expect(o.citedPaise).not.toBeNull();
        expect(o.attributionErrorPaise).toBeLessThanOrEqual(100);
      } else {
        expect(o.citedPaise).toBeNull();
      }
    }
  });

  it('scores the same faults whether asked for detail or not', () => {
    const rulepack = loadRulepackV1();
    const pack = injectFaults(generatePack(1000), rngFromSeed(1000 * 7919 + 13));
    const result = reconstruct({ input: pack.input, rulepack, now: '2026-09-18T00:00:00.000Z' });
    expect(scorePacks([pack], [result])).toEqual(scorePacksDetailed([pack], [result]).summary);
  });
});
