/**
 * @fc/api — sign-in, cases, uploads, the pipeline runner, events, certificates.
 * `main.ts` serves it; everything else is importable for tests and for the
 * Lambda that runs the same app on AWS (`@fc/functions`).
 */
export { createServer, createApp } from './server';
export type { AppParts } from './server';
export { createAuth, migrateAuth } from './auth';
export type { Auth, Session, AuthOverrides } from './auth';
export { loadEnv, readCognito } from './env';
export type { Env, CognitoConfig } from './env';
export { runPipeline, resumeAfterCorrection, PipelineFailure, extractionHash } from './pipeline/run';
export type { PipelineDeps } from './pipeline/run';
export { localRunner } from './pipeline/runner';
export type { PipelineRunner } from './pipeline/runner';
export { structuredExtractor, textractExtractor, ExtractionError } from './pipeline/extract';
export type { Extractor, ExtractedPack } from './pipeline/extract';
export { redactPack, PII_FORMAT_PATTERNS } from './pipeline/redact';
export type { RedactionResult } from './pipeline/redact';
export { canonicalise, resultHash, issueCertificate } from './pipeline/certificate';
export { StructuredBill, StructuredSheet, StructuredSchedule, StructuredWording, STRUCTURED_CONTENT_TYPE } from './pipeline/structured';
export { FsCaseStore, FsDocumentStorage } from './store/case-store';
export type { CaseStore, DocumentStorage, CaseRecord, StoredDocument, ExtractedState } from './store/case-store';
export type { CaseRouteOptions } from './routes/cases';
