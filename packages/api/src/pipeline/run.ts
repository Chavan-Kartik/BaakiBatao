import { createHash, randomUUID } from 'node:crypto';
import type {
  CaseEvent,
  CaseStatus,
  FailureCode,
  NormalisedLine,
  ReconstructInput,
  Reconstruction,
  Rulepack,
} from '@fc/contracts';
import { REQUIRED_DOCUMENT_KINDS, unsafePaise } from '@fc/contracts';
import { ENGINE_VERSION, reconstruct } from '@fc/engine';
import type { Normaliser } from '@fc/normalise';
import { canonicalise, issueCertificate } from './certificate';
import { ExtractionError, type Extractor } from './extract';
import { redactPack } from './redact';
import type { CaseRecord, CaseStore, DocumentStorage, ExtractedState } from '../store/case-store';

/**
 * The pipeline, state by state (IMPLEMENTATION.md §11), run in-process.
 *
 * On AWS each stage is a Lambda and the sequencing is a Step Functions
 * definition; here the sequencing is this file and the stages are the same
 * functions the Lambdas will wrap. The event log is identical either way —
 * `CaseEvent` is the contract — so the UI's pipeline view does not know which
 * runner produced it.
 *
 * Two stages pause on AWS with a task token: Textract completion and human
 * correction. The first has no local equivalent (structured input needs no
 * OCR). The second is real here: a checksum failure parks the case in
 * AWAITING_CORRECTION with a token, and `resumeAfterCorrection` continues.
 */
export interface PipelineDeps {
  readonly store: CaseStore;
  readonly documents: DocumentStorage;
  readonly extractor: Extractor;
  readonly rulepack: Rulepack;
  readonly normaliser: Normaliser;
  readonly now: () => string;
}

export class PipelineFailure extends Error {
  constructor(
    readonly code: FailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'PipelineFailure';
  }
}

/** The whole run, from an uploaded pack. Never throws: failures become events. */
export async function runPipeline(deps: PipelineDeps, caseId: string): Promise<void> {
  try {
    const extracted = await stageValidateAndExtract(deps, caseId);
    const checksum = await stageChecksum(deps, caseId, extracted);
    if (checksum === 'PAUSED') return;
    await stageNormaliseAndReconstruct(deps, caseId, extracted);
  } catch (e) {
    await fail(deps, caseId, e);
  }
}

/** Resumes a case parked on a checksum failure, with the corrected rows. */
export async function resumeAfterCorrection(deps: PipelineDeps, caseId: string): Promise<void> {
  try {
    const record = await deps.store.get(caseId);
    if (!record?.extracted) throw new PipelineFailure('PACK_INCOMPLETE', 'nothing to resume');
    await stageNormaliseAndReconstruct(deps, caseId, record.extracted);
  } catch (e) {
    await fail(deps, caseId, e);
  }
}

/* ------------------------------------------------------------------ stages */

async function stageValidateAndExtract(deps: PipelineDeps, caseId: string): Promise<ExtractedState> {
  const record = await transition(deps, caseId, 'VALIDATING');

  const present = new Set(record.documents.map((d) => d.kind));
  const missing = REQUIRED_DOCUMENT_KINDS.filter((k) => !present.has(k));
  if (missing.length > 0) {
    throw new PipelineFailure(
      'PACK_INCOMPLETE',
      `the pack is missing ${missing.join(', ')}; the schedule, wording, bill and deduction sheet are all required`,
    );
  }
  await emit(deps, caseId, 'PackValidated', { documents: record.documents.map((d) => d.kind) });

  await transition(deps, caseId, 'EXTRACTING');
  // Classification is by the kind the uploader declared. On AWS a Bedrock
  // call confirms it from the layout; the event is the same either way.
  for (const d of record.documents) {
    await emit(deps, caseId, 'DocumentClassified', { kind: d.kind, filename: d.filename, by: 'declared' });
  }

  const docs = await Promise.all(
    record.documents.map(async (doc) => ({ doc, bytes: await deps.documents.get(caseId, doc.key) })),
  );
  const pack = await deps.extractor.extract(docs);
  await emit(deps, caseId, 'PageExtracted', pack.detail);

  await transition(deps, caseId, 'REDACTING');
  const redacted = redactPack(pack);
  if (!redacted.confirmed) {
    throw new PipelineFailure('REDACTION_FAILED_OPEN', 'redaction could not be confirmed, so nothing proceeds');
  }
  await emit(deps, caseId, 'Redacted', {
    countByType: redacted.countByType,
    detectors: redacted.detectors,
    comprehend: 'not configured',
  });

  const extracted: ExtractedState = {
    billTable: redacted.billTable,
    deductionTable: redacted.deductionTable,
    policy: pack.policy,
    admission: pack.admission,
    actualPaid: pack.actualPaid ?? unsafePaise(0),
    wordingText: redacted.wordingText,
  };
  await deps.store.update(caseId, (r) => ({ ...r, extracted }));
  return extracted;
}

/**
 * Do the line items sum to the printed total? A mismatch means a row was
 * misread or missed, and adjudicating a bill that does not add up produces
 * confident arithmetic about the wrong numbers. So the case pauses for a
 * human, with a token that resumes it.
 */
async function stageChecksum(
  deps: PipelineDeps,
  caseId: string,
  extracted: ExtractedState,
): Promise<'OK' | 'PAUSED'> {
  const printed = extracted.billTable.printedTotal;
  if (printed === null) return 'OK';
  const summed = extracted.billTable.rows.reduce((s, r) => s + r.amountClaimed, 0);
  const tolerance = deps.rulepack.rounding.matchTolerancePaise;
  if (Math.abs(summed - printed) <= tolerance) return 'OK';

  const token = randomUUID();
  await emit(deps, caseId, 'ChecksumFailed', { printedTotal: printed, summedRows: summed, difference: summed - printed });
  await deps.store.update(caseId, (r) => ({ ...r, status: 'AWAITING_CORRECTION', correctionTaskToken: token }));
  return 'PAUSED';
}

async function stageNormaliseAndReconstruct(
  deps: PipelineDeps,
  caseId: string,
  extracted: ExtractedState,
): Promise<void> {
  await transition(deps, caseId, 'NORMALISING');
  const normalisedLines: NormalisedLine[] = extracted.billTable.rows.map((row) =>
    deps.normaliser.normalise(row.lineRef, row.rawDescription),
  );
  const tiers: Record<string, number> = {};
  for (const l of normalisedLines) tiers[l.tier] = (tiers[l.tier] ?? 0) + 1;
  await emit(deps, caseId, 'Normalised', {
    tiers,
    lexiconVersion: deps.normaliser.lexiconVersion,
    unresolved: normalisedLines.filter((l) => l.categoryId === null).map((l) => l.rawDescription),
  });

  await transition(deps, caseId, 'RECONSTRUCTING');
  const input: ReconstructInput = {
    caseId: caseId as ReconstructInput['caseId'],
    pins: {
      engineVersion: ENGINE_VERSION,
      rulepackVersion: deps.rulepack.version,
      rulepackHash: deps.rulepack.hash,
      lexiconVersion: deps.normaliser.lexiconVersion,
      extractionHash: extractionHash(extracted),
      stepOrder: deps.rulepack.steps.map((s) => s.id),
    },
    policy: extracted.policy,
    admission: extracted.admission,
    billTable: extracted.billTable,
    deductionTable: extracted.deductionTable,
    normalisedLines,
    actualPaid: extracted.actualPaid,
  };

  let reconstruction: Reconstruction;
  try {
    reconstruction = reconstruct({ input, rulepack: deps.rulepack, now: deps.now() });
  } catch (e) {
    throw new PipelineFailure('RULEPACK_INVALID', e instanceof Error ? e.message : String(e));
  }
  if (!reconstruction.reconciliation.invariantHeld) {
    throw new PipelineFailure('INVARIANT_VIOLATED', 'the ledger did not balance');
  }
  await deps.store.update(caseId, (r) => ({ ...r, input, reconstruction }));
  await emit(deps, caseId, 'Reconstructed', {
    billTotal: reconstruction.billTotal,
    expectedPayable: reconstruction.expectedPayable,
    actualPaid: reconstruction.actualPaid,
    byBucket: reconstruction.reconciliation.byBucket,
    findings: reconstruction.findings.length,
  });

  // Prose needs Bedrock behind the redaction gate. Skipped rather than faked:
  // the UI renders clause text and arithmetic from the findings themselves.
  await transition(deps, caseId, 'WRITING_PROSE');
  await emit(deps, caseId, 'ProseWritten', { skipped: true, reason: 'Bedrock not configured' });

  // A completed case stays correctable: a line the normaliser could not place
  // is fixed in the grid and the case re-runs from normalisation under a fresh
  // token, re-issuing its certificate. Same path as the checksum pause.
  const certificate = issueCertificate(reconstruction, deps.now());
  await deps.store.update(caseId, (r) => ({ ...r, certificate, status: 'COMPLETE', correctionTaskToken: randomUUID() }));
  await emit(deps, caseId, 'CertificateIssued', {
    resultHash: certificate.resultHash,
    signed: certificate.signature !== null,
  });
}

/* ----------------------------------------------------------------- helpers */

async function transition(deps: PipelineDeps, caseId: string, status: CaseStatus): Promise<CaseRecord> {
  return deps.store.update(caseId, (r) => ({ ...r, status }));
}

async function emit(deps: PipelineDeps, caseId: string, kind: CaseEvent['kind'], detail: Record<string, unknown>): Promise<void> {
  await deps.store.update(caseId, (r) => ({
    ...r,
    events: [...r.events, { seq: r.events.length, at: deps.now(), kind, detail }],
  }));
}

async function fail(deps: PipelineDeps, caseId: string, e: unknown): Promise<void> {
  const failure =
    e instanceof PipelineFailure || e instanceof ExtractionError
      ? { code: e.code, message: e.message }
      : { code: 'PIPELINE_INTERNAL' as FailureCode, message: e instanceof Error ? e.message : String(e) };
  try {
    await deps.store.update(caseId, (r) => ({ ...r, status: 'FAILED', failure, correctionTaskToken: null }));
    await emit(deps, caseId, 'CaseFailed', failure);
  } catch (inner) {
    // The store itself is what failed; the record keeps its last status and
    // the operator log carries the reason.
    console.error(`case ${caseId}: could not record failure ${failure.code}: ${String(inner)}`);
  }
}

/** Content-addresses what the engine was given, so the certificate pins it. */
function extractionHash(e: ExtractedState): ReconstructInput['pins']['extractionHash'] {
  const canonical = canonicalise([e.billTable, e.deductionTable, e.policy, e.admission, e.actualPaid]);
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}
