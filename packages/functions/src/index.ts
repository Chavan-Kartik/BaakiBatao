/**
 * @fc/functions — the Lambda handlers.
 *
 * Every handler is a wrapper: parse the event, do I/O, call into @fc/engine
 * or @fc/api, write the result. No money math lives here.
 *
 *   api/       app · http (HTTP API) · events (Function URL, streaming) · runner
 *              — the same Hono app `packages/api` serves locally, with
 *              DynamoDB, S3, Step Functions and KMS behind its interfaces
 *
 *   pipeline/  validate-pack · classify-docs · start-textract ·
 *              textract-complete · parse-tables · extract · redact ·
 *              checksum-rows · await-correction · normalise · reconstruct ·
 *              write-prose · issue-certificate · fail-with-reason
 *              — one per state of the build spec §11 state machine
 *
 *   eval/      sweep — plan · settle · summarise, for the Distributed Map
 *
 *   store/     DynamoCaseStore · S3DocumentStorage · the better-auth
 *              DynamoDB adapter · the lexicon item
 *
 * Two patterns worth getting right rather than improvising:
 *
 *   start-textract / textract-complete — there is no `.sync` service
 *   integration for async Textract, so the task token is stored keyed by the
 *   Textract JobId and SendTaskSuccess is called from the SNS completion
 *   handler. §11.3.
 *
 *   redact — fails CLOSED. If redaction cannot be confirmed, the execution
 *   stops with REDACTION_FAILED_OPEN and nothing reaches Bedrock. §13.
 */
export { markRedacted, PII_ENTITY_TYPES, PII_FORMAT_PATTERNS } from './shared/redacted';
export type { RedactedText, RedactionOutcome } from './shared/redacted';
export { DynamoCaseStore } from './store/dynamo-store';
export { S3DocumentStorage } from './store/documents';
export { dynamoAuthAdapter } from './store/auth-adapter';
export { readLearnedAliases, learnAlias } from './store/lexicon';
export { sfnRunner } from './api/runner';
export { parseBlocks, money, moneyLike } from './pipeline/parse-tables';
export type { ParsedDocument } from './pipeline/parse-tables';
export { applyEntities } from './pipeline/redact';
export { decode as decodeFailure } from './pipeline/fail-with-reason';
export { containsDigitClaim } from './pipeline/write-prose';
