import type {
  CategoryId,
  DocId,
  ExtractedRow,
  ExtractedTable,
  LineRef,
  ReconstructInput,
} from '@fc/contracts';
import { unsafePaise } from '@fc/contracts';
import { loadRulepackV1 } from '@fc/rulepack';
import type { GeneratedPack, Settlement } from '../types';
import { sampleBillLines } from './bill';
import { sampleAdmission, samplePolicy } from './policy';
import { rngFromSeed } from './rng';
import { settle, sheetFor } from './settle';

const pack = loadRulepackV1();

/**
 * Builds a seeded claim pack whose ground truth is exact by construction
 * (§20.1): the bill is sampled, then settled lawfully for the policy and the
 * admission facts the engine will see, so the deduction sheet carries no
 * unlawful rupee until a fault operator puts one there.
 */
export function generatePack(seed: number): GeneratedPack {
  const rng = rngFromSeed(seed);
  const policy = samplePolicy(rng);
  const admission = sampleAdmission(rng, policy);
  const sampled = sampleBillLines(rng, policy, admission);

  const billDoc = `eval-bill-${seed}` as DocId;
  const sheetDoc = `eval-sheet-${seed}` as DocId;
  const pins = {
    engineVersion: '0.1.0',
    rulepackVersion: 'v1',
    rulepackHash: pack.hash,
    lexiconVersion: 'v1',
    extractionHash: `sha256:${'0'.repeat(64)}` as ReconstructInput['pins']['extractionHash'],
    stepOrder: pack.steps.map((s) => s.id),
  };

  const billRows: ExtractedRow[] = sampled.map((l, i) => ({
    lineRef: `${billDoc}:1:${i}` as LineRef,
    rawDescription: l.desc,
    quantity: null,
    amountClaimed: l.claimed,
    amountPaid: null,
    insurerReasonCode: null,
    provenance: {
      docId: billDoc,
      bbox: { page: 1, left: 0.1, top: 0.1 + i * 0.02, width: 0.8, height: 0.015 },
      textractConfidence: 99,
      corrected: false,
    },
  }));

  const withPd = settle(policy, admission, sampled, true);
  const withoutPd = settle(policy, admission, sampled, false);

  const settlementWithPd: Settlement = {
    deductionTable: sheetFor(sheetDoc, sampled, withPd),
    actualPaid: withPd.paid,
    paidPerLine: withPd.paidPerLine,
  };
  const settlementWithoutPd: Settlement = {
    deductionTable: sheetFor(sheetDoc, sampled, withoutPd),
    actualPaid: withoutPd.paid,
    paidPerLine: withoutPd.paidPerLine,
  };

  const billTable: ExtractedTable = {
    docId: billDoc,
    rows: billRows,
    printedTotal: billRows.reduce((s, r) => unsafePaise(s + r.amountClaimed), unsafePaise(0)),
  };

  const billTotal = billTable.printedTotal ?? unsafePaise(0);
  const caseId = `eval-seed-${seed}`;

  const lawfulInput: ReconstructInput = {
    caseId: caseId as ReconstructInput['caseId'],
    pins,
    policy,
    admission,
    billTable,
    deductionTable: settlementWithPd.deductionTable,
    normalisedLines: sampled.map((l, i) => ({
      lineRef: billRows[i]?.lineRef as LineRef,
      rawDescription: l.desc,
      categoryId: l.category as CategoryId,
      tier: 'LEXICON' as const,
      confidence: 1,
      embeddingMargin: null,
      candidates: [l.category as CategoryId],
    })),
    actualPaid: settlementWithPd.actualPaid,
  };

  return {
    seed,
    caseId,
    policy,
    admission,
    billTable,
    lawfulDeductionTable: settlementWithPd.deductionTable,
    lawfulPaid: settlementWithPd.actualPaid,
    billTotal,
    lawfulInput,
    settlementWithPd,
    settlementWithoutPd,
  };
}
