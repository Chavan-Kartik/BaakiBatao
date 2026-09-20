/**
 * CLI: generate | run | report | calibrate | assert | baseline | doc (§20.6, §24).
 *
 *   pnpm eval:generate --count 40                build packs, no engine, no scoring
 *   pnpm eval:run --count 40 [--profile degraded] generate + faults + engine + score
 *   pnpm eval:report --count 200 [--profile …]   per-fault rows for a scored run
 *   pnpm eval:assert                             fail if either profile regressed vs its baseline
 *   pnpm eval:baseline                           deliberately accept the current run as the new baselines
 *   pnpm eval:calibrate [--packs 300]            sweep the tier-1 threshold over a held-out split
 *   pnpm eval:doc                                regenerate docs/evaluation.md from a full run
 *
 * `report` re-runs the sweep rather than reading stored artifacts: packs are
 * regenerable from a seed, so the command stays stateless by construction.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareToBaseline, toBaseline, type Baseline } from './score/baseline';
import { DEFAULT_DEGRADE } from './generate/degrade';
import { formatCurve, heldOutSplit, knee, sweep } from './score/calibrate';
import { renderEvaluationDoc } from './score/report';
import { AS_OF, formatSummary, generateFaultedPack, runEval } from './run';
import type { Profile } from './types';

const here = dirname(fileURLToPath(import.meta.url));
const baselinePaths: Readonly<Record<Profile, string>> = {
  clean: join(here, '..', 'baseline.json'),
  degraded: join(here, '..', 'baseline.degraded.json'),
};
const docPath = join(here, '..', '..', '..', 'docs', 'evaluation.md');

const args = process.argv.slice(2);
const command = args[0];

function flag(name: string, fallback: number): number {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const v = Number(args[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

function profileFlag(): Profile {
  const i = args.indexOf('--profile');
  const v = i < 0 ? 'clean' : args[i + 1];
  if (v !== 'clean' && v !== 'degraded') {
    console.error(`--profile must be clean or degraded, got ${JSON.stringify(v)}`);
    process.exit(2);
  }
  return v;
}

function readBaseline(profile: Profile): Baseline {
  return JSON.parse(readFileSync(baselinePaths[profile], 'utf8')) as Baseline;
}

function readBaselineOr(profile: Profile, fallback: number): number {
  try {
    return readBaseline(profile).packs;
  } catch {
    return fallback;
  }
}

if (command === 'generate') {
  // Generation only: no engine run, no scoring. This is the command you reach
  // for when inspecting or debugging the corpus itself.
  const count = flag('--count', 40);
  console.log(`# fc-eval generate — ${count} packs @ ${AS_OF}`);
  for (let i = 0; i < count; i++) {
    const pack = generateFaultedPack(1000 + i);
    console.log(
      `${pack.caseId}  ${pack.archetype.padEnd(16)} lines=${String(pack.billTable.rows.length).padStart(2)}  ` +
        `faults=${pack.faults.length}  controls=${pack.controls.length}  ` +
        `billTotal=${pack.billTotal}  lawfulPaid=${pack.lawfulPaid}  paid=${pack.actualPaid}`,
    );
  }
} else if (command === 'run') {
  const count = flag('--count', 40);
  const profile = profileFlag();
  const { summary } = runEval(count, 1000, profile);
  console.log(`# fc-eval run — ${count} packs @ ${AS_OF}`);
  console.log(formatSummary(summary));
} else if (command === 'report') {
  const count = flag('--count', 40);
  const profile = profileFlag();
  const { summary, outcomes } = runEval(count, 1000, profile);
  console.log(`# fc-eval report — ${count} packs @ ${AS_OF}`);
  console.log(formatSummary(summary));

  console.log('\nseed      archetype         kind              clause             injected    bound    cited  detected  miss');
  for (const o of outcomes) {
    console.log(
      `${String(o.seed).padEnd(10)}${o.archetype.padEnd(18)}${o.kind.padEnd(18)}${o.clauseId.padEnd(19)}` +
        `${String(o.injectedPaise).padStart(9)}${String(o.lawfulBoundPaise ?? '-').padStart(9)}` +
        `${String(o.citedPaise ?? 0).padStart(9)}  ${String(o.detected).padEnd(8)}  ${o.missReason ?? ''}`,
    );
  }
  const missed = outcomes.filter((o) => !o.detected);
  if (missed.length > 0) {
    console.log(`\nmissed faults (${missed.length}):`);
    for (const o of missed) console.log(`  seed ${o.seed} — ${o.kind} (${o.clauseId}) — ${o.missReason}`);
  }
} else if (command === 'assert') {
  let failed = false;
  for (const profile of ['clean', 'degraded'] as const) {
    const baseline = readBaseline(profile);
    // Same seed base as when the baseline was recorded, so a failure is a real
    // behaviour change rather than a different sample.
    const count = flag('--count', baseline.packs);
    const { summary } = runEval(count, 1000, profile);

    console.log(`# fc-eval assert — ${profile}: ${count} packs @ ${AS_OF}`);
    console.log(formatSummary(summary));

    const failures = compareToBaseline(baseline, summary);
    if (failures.length > 0) {
      failed = true;
      console.error(`\nFAILED (${profile}) — domain-correctness regression:`);
      for (const f of failures) console.error(`  ✗ ${f}`);
    } else {
      console.log(`\nPASS (${profile}) — no regression against ${profile === 'clean' ? 'baseline.json' : 'baseline.degraded.json'} (recorded ${baseline.generatedAt}).`);
    }
    console.log('');
  }
  if (failed) {
    console.error(
      'If the movement is deliberate, re-record the baselines with `pnpm eval:baseline` ' +
        'and say in the commit message which behaviour changed and why.',
    );
    process.exitCode = 1;
  }
} else if (command === 'baseline') {
  const generatedAt = new Date().toISOString();
  for (const profile of ['clean', 'degraded'] as const) {
    const count = flag('--count', readBaselineOr(profile, 200));
    const { summary } = runEval(count, 1000, profile);
    const baseline = toBaseline(summary, generatedAt);
    writeFileSync(baselinePaths[profile], `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
    console.log(`# fc-eval baseline — ${profile}: recorded ${count} packs @ ${AS_OF}`);
    console.log(formatSummary(summary));
    console.log('');
  }
} else if (command === 'calibrate') {
  const packs = flag('--packs', 300);
  const split = heldOutSplit(packs);
  const points = sweep(split);
  const chosen = knee(points);
  console.log(
    `# fc-eval calibrate — tier-1 trigram threshold over ${split.length} held-out lines ` +
      `(${split.filter((l) => l.degraded).length} degraded) from ${packs} packs`,
  );
  console.log(formatCurve(points, chosen));
  if (chosen) {
    console.log(
      `\nknee: ${chosen.threshold.toFixed(2)} — ${(chosen.accuracyAmongAccepted * 100).toFixed(2)}% accurate among ` +
        `accepted, escalating ${(chosen.escalationRate * 100).toFixed(1)}%. Recorded in docs/evaluation.md by \`pnpm eval:doc\`.`,
    );
  }
} else if (command === 'doc') {
  const count = flag('--count', readBaselineOr('clean', 200));
  const packs = flag('--packs', 300);
  const clean = runEval(count, 1000, 'clean');
  const degraded = runEval(count, 1000, 'degraded');
  const split = heldOutSplit(packs);
  const curve = sweep(split);
  const chosen = knee(curve);
  const degradedAtKnee = chosen
    ? runEval(count, 1000, 'degraded', { ...DEFAULT_DEGRADE, fuzzyThreshold: chosen.threshold })
    : null;
  const doc = renderEvaluationDoc({
    clean,
    degraded,
    degradedAtKnee,
    curve,
    knee: chosen,
    heldOutLines: split.length,
    heldOutDegraded: split.filter((l) => l.degraded).length,
    generatedAt: new Date().toISOString(),
    seedBase: 1000,
  });
  writeFileSync(docPath, doc, 'utf8');
  console.log(`wrote ${docPath}`);
} else {
  console.error('usage: cli.ts (generate|run|report|assert|baseline|calibrate|doc) [--count N] [--profile clean|degraded] [--packs N]');
  process.exitCode = 1;
}
