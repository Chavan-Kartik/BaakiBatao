import { describe, expect, it } from 'vitest';
import type { ClauseId, Finding, LineRef, Paise } from '@fc/contracts';
import { unsafePaise } from '@fc/contracts';
import { reconstruct } from '@fc/engine';
import { loadRulepackV1 } from '@fc/rulepack';
import { controlsFor, injectFaults } from './faults/inject';
import { degradeInput } from './generate/degrade';
import { generatePack } from './generate/generator';
import { rngFromSeed } from './generate/rng';
import { bestAssignment, scorePacksDetailed, scorePacks } from './score/confusion';
import { degradeSeed, faultSeed, runEval } from './run';
import { ARCHETYPES, CONTROL_KINDS } from './types';

const rulepack = loadRulepackV1();
const NOW = '2026-09-18T00:00:00.000Z';
const faulted = (seed: number) => injectFaults(generatePack(seed), rngFromSeed(faultSeed(seed)));

/**
 * Eval-harness regression tests. The worked-example golden test pins the
 * published figures; these pin the harness itself: determinism, lawful
 * controls staying clean, every fault kind being detectable, and the scorer
 * not flattering the engine.
 */
describe('eval harness', () => {
  it('is deterministic per seed', () => {
    const a = generatePack(7);
    const b = generatePack(7);
    expect(a.billTotal).toBe(b.billTotal);
    expect(a.lawfulPaid).toBe(b.lawfulPaid);
    expect(a.archetype).toBe(b.archetype);
    expect(a.billTable.rows.map((r) => r.rawDescription)).toEqual(
      b.billTable.rows.map((r) => r.rawDescription),
    );
  });

  it('produces a lawful sheet the engine fully endorses on every control pack in a sweep', () => {
    let controls = 0;
    for (let seed = 1; seed < 120; seed++) {
      const pack = faulted(seed);
      if (pack.faults.length !== 0) continue;
      controls += 1;
      const result = reconstruct({ input: pack.input, rulepack, now: NOW });
      expect(result.findings.filter((f) => f.bucket === 'INCORRECTLY_APPLIED'), `seed ${seed}`).toEqual([]);
    }
    expect(controls).toBeGreaterThan(10);
  });

  it('detects each fault kind under its clause', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed < 400 && seen.size < 6; seed++) {
      const pack = faulted(seed);
      if (pack.faults.length === 0) continue;
      const result = reconstruct({ input: pack.input, rulepack, now: NOW });
      for (const c of scorePacks([pack], [result]).perClause) if (c.tp > 0) seen.add(c.clauseId);
    }
    for (const clause of ['AME.EXCL.PHARMA', 'AME.EXCL.IMPLANT', 'AME.EXCL.DIAG', 'PD.ICU', 'PD.DIFFBILL', 'PD.LIMIT']) {
      expect(seen.has(clause), `fault kind for ${clause} never detected in seeds 1..400`).toBe(true);
    }
  });

  it('samples every archetype and every lawful control across a sweep', () => {
    const archetypes = new Set<string>();
    const controls = new Set<string>();
    for (let seed = 1; seed < 200; seed++) {
      const pack = faulted(seed);
      archetypes.add(pack.archetype);
      for (const c of pack.controls) controls.add(c);
    }
    for (const a of ARCHETYPES) expect(archetypes.has(a), a).toBe(true);
    for (const c of CONTROL_KINDS) expect(controls.has(c), c).toBe(true);
  });

  /**
   * Correlation, not prevalence: an implant line with no surgeon and no
   * theatre is a bill no hospital would print, and a bill generator that can
   * print it is sampling a distribution the engine will never see.
   */
  it('never bills an implant without a surgeon and a theatre', () => {
    for (let seed = 1; seed < 300; seed++) {
      const cats = new Set(generatePack(seed).trueCategories);
      if (cats.has('IMPLANT_DEVICE')) {
        expect(cats.has('SURGEON_FEE'), `seed ${seed}`).toBe(true);
        expect(cats.has('OT_CHARGE'), `seed ${seed}`).toBe(true);
      }
      if (cats.has('VENTILATOR') || cats.has('DIALYSIS')) {
        expect(cats.has('ICU_CHARGE'), `seed ${seed}`).toBe(true);
      }
    }
  });

  it('records one per-fault outcome per injected fault', () => {
    const packs = [];
    const results = [];
    for (let seed = 1000; seed < 1030; seed++) {
      const pack = faulted(seed);
      if (pack.faults.length === 0) continue;
      packs.push(pack);
      results.push(reconstruct({ input: pack.input, rulepack, now: NOW }));
    }
    const { summary, outcomes } = scorePacksDetailed(packs, results);
    expect(outcomes.length).toBe(summary.faults);
    expect(outcomes.every((o) => o.injectedPaise > 0)).toBe(true);
    for (const o of outcomes) {
      if (o.detected) {
        expect(o.citedPaise).not.toBeNull();
        expect(o.attributionErrorPaise).toBeLessThanOrEqual(100);
        expect(o.missReason).toBeNull();
      } else {
        expect(o.citedPaise).toBeNull();
        expect(o.missReason).not.toBeNull();
      }
    }
  });

  it('scores the same faults whether asked for detail or not', () => {
    const pack = faulted(1000);
    const result = reconstruct({ input: pack.input, rulepack, now: NOW });
    expect(scorePacks([pack], [result])).toEqual(scorePacksDetailed([pack], [result]).summary);
  });
});

describe('the over-recovery bound', () => {
  /**
   * "Beyond the lawful figure" has to be a computed fact. Every over-recovery
   * fault carries the bound the engine's own step-5 arithmetic produced for
   * the line, and the sheet before injection recovered exactly that much.
   */
  it('injects beyond a bound computed from the lawful settlement, never from a description', () => {
    let seen = 0;
    for (let seed = 1; seed < 400 && seen < 15; seed++) {
      const pack = faulted(seed);
      for (const f of pack.faults) {
        if (f.kind !== 'pd-over-recovery' || f.lineIndex === null) continue;
        seen += 1;
        expect(f.lawfulBoundPaise).not.toBeNull();
        const lawfulRow = pack.lawfulDeductionTable.rows[f.lineIndex];
        const lawfulCut = (lawfulRow?.amountClaimed ?? 0) - (lawfulRow?.amountPaid ?? 0);
        expect(lawfulCut).toBe(f.lawfulBoundPaise);
        expect(pack.settlementWithPd.lawfulPdPerLine[f.lineIndex]).toBe(f.lawfulBoundPaise);
        const faultyRow = pack.deductionTable.rows[f.lineIndex];
        const faultyCut = (faultyRow?.amountClaimed ?? 0) - (faultyRow?.amountPaid ?? 0);
        expect(faultyCut).toBe((f.lawfulBoundPaise ?? 0) + f.amountPaise);
      }
    }
    expect(seen).toBeGreaterThan(5);
  });

  it('cites a bound of zero, not a guess, when the room was within eligibility', () => {
    let seen = 0;
    for (let seed = 1; seed < 600 && seen < 3; seed++) {
      const pack = faulted(seed);
      const cap = pack.policy.roomRentCapPerDay ?? 0;
      const rate = pack.admission.actualRoomRentPerDay ?? 0;
      if (rate > cap) continue;
      for (const f of pack.faults) {
        if (f.kind !== 'pd-over-recovery') continue;
        seen += 1;
        expect(f.lawfulBoundPaise).toBe(0);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('derived controls', () => {
  it('claims a control only for a deduction the pack actually contains', () => {
    for (let seed = 1; seed < 60; seed++) {
      const pack = generatePack(seed);
      const controls = controlsFor(pack, pack.settlementWithPd);
      if ((pack.policy.copayPercent ?? 0) === 0) expect(controls).not.toContain('lawful-copay');
      if ((pack.policy.deductible ?? 0) === 0) expect(controls).not.toContain('lawful-deductible');
      const cap = pack.policy.roomRentCapPerDay ?? 0;
      const rate = pack.admission.actualRoomRentPerDay ?? 0;
      if (rate <= cap) {
        expect(controls).not.toContain('lawful-room-cap');
        expect(controls).not.toContain('lawful-proportionate');
      }
    }
  });
});

describe('fault ↔ dispute assignment', () => {
  const dispute = (clauseId: string, amount: number, lineRef: string | null = null): Finding => ({
    findingId: `${clauseId}|${amount}`,
    lineRef: lineRef as LineRef | null,
    stepId: 'PROPORTIONATE',
    clauseId: clauseId as ClauseId,
    bucket: 'INCORRECTLY_APPLIED',
    amount: unsafePaise(-amount),
    arithmetic: { expression: '', inputs: {}, result: -amount },
    unresolvedReason: null,
    resolvedBy: null,
    confidence: 1,
  });
  const fault = (clauseId: string, amountPaise: number, lineRef: string | null = null) => ({
    clauseId: clauseId as ClauseId,
    amountPaise: unsafePaise(amountPaise) as Paise,
    lineRef: lineRef as LineRef | null,
  });

  /**
   * The case greedy gets wrong. Fault A (1000) sees dispute X (1050) first
   * and takes it at error 50; fault B (1050) is left with Y (900) at error
   * 150, outside tolerance, and scores as a miss the engine did not make.
   * The right pairing is A→Y (100), B→X (0): both detected.
   */
  it('finds the pairing that detects the most faults, where greedy would drop one', () => {
    const faults = [fault('PD.LIMIT', 1000), fault('PD.LIMIT', 1050)];
    const disputes = [dispute('PD.LIMIT', 1050), dispute('PD.LIMIT', 900)];
    expect(bestAssignment(faults, disputes)).toEqual([1, 0]);
  });

  it('prefers the lower total error among pairings that detect the same number', () => {
    const faults = [fault('PD.LIMIT', 1000), fault('PD.LIMIT', 2000)];
    const disputes = [dispute('PD.LIMIT', 1010), dispute('PD.LIMIT', 2000), dispute('PD.LIMIT', 1000)];
    expect(bestAssignment(faults, disputes)).toEqual([2, 1]);
  });

  it('never pairs across clauses, and never pairs a line-level fault with another line', () => {
    const faults = [fault('PD.ICU', 1000, 'bill:1:3')];
    expect(bestAssignment(faults, [dispute('PD.LIMIT', 1000, 'bill:1:3')])).toEqual([-1]);
    expect(bestAssignment(faults, [dispute('PD.ICU', 1000, 'bill:1:4')])).toEqual([-1]);
    expect(bestAssignment(faults, [dispute('PD.ICU', 1000, 'bill:1:3')])).toEqual([0]);
  });

  it('leaves a fault unmatched rather than accept a dispute outside tolerance', () => {
    expect(bestAssignment([fault('PD.LIMIT', 1000)], [dispute('PD.LIMIT', 1200)])).toEqual([-1]);
  });
});

describe('the degraded profile', () => {
  it('is deterministic per seed', () => {
    const pack = faulted(1000);
    const a = degradeInput(pack, rngFromSeed(degradeSeed(1000)));
    const b = degradeInput(pack, rngFromSeed(degradeSeed(1000)));
    expect(a.input).toEqual(b.input);
    expect(a.report).toEqual(b.report);
  });

  it('assigns categories through the normaliser, not from the generator', () => {
    const pack = faulted(1000);
    const { input } = degradeInput(pack, rngFromSeed(degradeSeed(1000)));
    const tiers = new Set(input.normalisedLines.map((l) => l.tier));
    expect(tiers.has('UNRESOLVED')).toBe(true);
    for (const line of input.normalisedLines) {
      if (line.tier === 'UNRESOLVED') expect(line.categoryId).toBeNull();
      if (line.tier === 'LEXICON') expect(line.confidence).toBe(1);
    }
  });

  /**
   * The property that makes the degraded profile a gate rather than a demo:
   * whatever the extraction layer does to the rows, the engine must not
   * dispute a lawful cut, and every miss must be traceable to a gated or
   * unmatched line rather than to the waterfall.
   */
  it('produces no false positives and no engine-attributed misses over a sweep', () => {
    const { summary } = runEval(60, 1000, 'degraded');
    expect(summary.controlFalsePositiveRate).toBe(0);
    expect(summary.missesByReason.ENGINE).toBe(0);
    expect(summary.gatedLineRate).toBeGreaterThan(0);
    expect(summary.unmatchedLineRate).toBeGreaterThan(0);
  });
});
