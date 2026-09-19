/**
 * CLI: generate | run | report | calibrate | assert | baseline (§20.6, §24).
 *
 *   pnpm eval:generate --count 40   build packs, no engine, no scoring
 *   pnpm eval:run --count 40        generate + faults + engine + score
 *   pnpm eval:report --count 200    per-fault rows for a scored run
 *   pnpm eval:assert                fail if detection regressed vs the baseline
 *   pnpm eval:baseline              deliberately accept the current run as the new baseline
 *   pnpm eval:calibrate             sweep τ over a held-out labelled split (not yet implemented)
 *
 * `report` re-runs the sweep rather than reading stored artifacts: packs are
 * regenerable from a seed, so the command stays stateless by construction.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareToBaseline, toBaseline, type Baseline } from './score/baseline';
import { scorePacksDetailed } from './score/confusion';
import { AS_OF, formatSummary, generateFaultedPack, runEval } from './run';

const here = dirname(fileURLToPath(import.meta.url));
const baselinePath = join(here, '..', 'baseline.json');

const args = process.argv.slice(2);
const command = args[0];

function flag(name: string, fallback: number): number {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const v = Number(args[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

function readBaseline(): Baseline {
  return JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline;
}

if (command === 'generate') {
  // Generation only: no engine run, no scoring. This is the command you reach
  // for when inspecting or debugging the corpus itself.
  const count = flag('--count', 40);
  console.log(`# fc-eval generate — ${count} packs @ ${AS_OF}`);
  for (let i = 0; i < count; i++) {
    const pack = generateFaultedPack(1000 + i);
    console.log(
      `${pack.caseId}  lines=${pack.billTable.rows.length}  faults=${pack.faults.length}  ` +
        `billTotal=${pack.billTotal}  lawfulPaid=${pack.lawfulPaid}  paid=${pack.actualPaid}`,
    );
  }
} else if (command === 'run') {
  const count = flag('--count', 40);
  const { summary } = runEval(count);
  console.log(`# fc-eval run — ${count} packs @ ${AS_OF}`);
  console.log(formatSummary(summary));
} else if (command === 'report') {
  const count = flag('--count', 40);
  const { packs, results, summary } = runEval(count);
  console.log(`# fc-eval report — ${count} packs @ ${AS_OF}`);
  console.log(formatSummary(summary));

  const { outcomes } = scorePacksDetailed(packs, results);
  console.log('\nseed      caseId            kind              clause             injected    cited  detected');
  for (const o of outcomes) {
    console.log(
      `${String(o.seed).padEnd(10)}${o.caseId.padEnd(18)}${o.kind.padEnd(18)}${o.clauseId.padEnd(19)}` +
        `${String(o.injectedPaise).padStart(9)}${String(o.citedPaise ?? 0).padStart(9)}  ${o.detected}`,
    );
  }
  const missed = outcomes.filter((o) => !o.detected);
  if (missed.length > 0) {
    console.log(`\nmissed faults (${missed.length}):`);
    for (const o of missed) console.log(`  seed ${o.seed} — ${o.kind} (${o.clauseId})`);
  }
} else if (command === 'assert') {
  const baseline = readBaseline();
  // Same seed base as when the baseline was recorded, so a failure is a real
  // behaviour change rather than a different sample.
  const count = flag('--count', baseline.packs);
  const { summary } = runEval(count);

  console.log(`# fc-eval assert — ${count} packs @ ${AS_OF}`);
  console.log(formatSummary(summary));

  const failures = compareToBaseline(baseline, summary);

  if (failures.length > 0) {
    console.error('\nFAILED — domain-correctness regression:');
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.error(
      '\nIf the movement is deliberate, re-record the baseline with `pnpm eval:baseline` ' +
        'and say in the commit message which behaviour changed and why.',
    );
    process.exitCode = 1;
  } else {
    console.log(`\nPASS — no regression against baseline.json (recorded ${baseline.generatedAt}).`);
  }
} else if (command === 'baseline') {
  const count = flag('--count', readBaselineOr(200));
  const { summary } = runEval(count);
  const baseline = toBaseline(summary, new Date().toISOString());
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  console.log(`# fc-eval baseline — recorded ${count} packs @ ${AS_OF}`);
  console.log(formatSummary(summary));
} else if (command === 'calibrate') {
  console.log('calibrate: τ sweep over a held-out labelled split — not yet implemented (see §20.7).');
  process.exitCode = 1;
} else {
  console.error('usage: cli.ts (generate|run|report|assert|baseline|calibrate) [--count N]');
  process.exitCode = 1;
}

function readBaselineOr(fallback: number): number {
  try {
    return readBaseline().packs;
  } catch {
    return fallback;
  }
}

