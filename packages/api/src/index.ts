/**
 * @fc/api — sign-in, cases, uploads, the pipeline runner, events, certificates.
 * `main.ts` serves it; everything else is importable for tests.
 */
export { createServer } from './server';
export { createAuth, migrateAuth } from './auth';
export type { Auth, Session } from './auth';
export { loadEnv } from './env';
export type { Env } from './env';
export { runPipeline, resumeAfterCorrection, PipelineFailure } from './pipeline/run';
export type { PipelineDeps } from './pipeline/run';
export { structuredExtractor, textractExtractor, ExtractionError } from './pipeline/extract';
export type { Extractor, ExtractedPack } from './pipeline/extract';
export { redactPack, PII_FORMAT_PATTERNS } from './pipeline/redact';
export { canonicalise, resultHash, issueCertificate } from './pipeline/certificate';
export { StructuredBill, StructuredSheet, StructuredSchedule, StructuredWording } from './pipeline/structured';
export { FsCaseStore, FsDocumentStorage } from './store/case-store';
export type { CaseStore, DocumentStorage, CaseRecord, StoredDocument, ExtractedState } from './store/case-store';
